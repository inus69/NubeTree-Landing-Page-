import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { DateTime } from "luxon";
import { call, listen, memoryStore, recordingServices } from "./helpers.js";
import { createServer } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { createGoogleCalendar } from "../src/calendar.js";
import { setLogListener } from "../src/log.js";

var ZONE = "America/New_York";
var ENV = {
  BOOKING_TIMEZONE: ZONE,
  BOOKING_DURATION_MINUTES: "30",
  BOOKING_HORIZON_DAYS: "14",
  BOOKING_MIN_LEAD_MINUTES: "0",
  RATE_LIMIT_MAX_REQUESTS: "100",
  RATE_LIMIT_WINDOW_SECONDS: "600"
};

var person = {
  name: "Amina Shah",
  email: "amina@example.com",
  company: "Northwind",
  services: ["API / System Integration"],
  project_stage: "MVP",
  budget: "$25K – $50K",
  timezone: ZONE,
  project_description: "Connect the billing system to the CRM."
};

/**
 * Starts a test server and closes it when the test ends, even if an assertion fails.
 * @param {import("node:test").TestContext} t
 * @param {Record<string, string>} env
 * @param {Parameters<typeof listen>[1]} [options]
 */
async function open(t, env, options) {
  var running = await listen(env, options);
  t.after(function () {
    running.server.closeAllConnections();
    running.server.close();
  });
  return running;
}

/** @param {number} port */
async function firstSlot(port) {
  var now = DateTime.now().setZone(ZONE);
  for (var month of [now, now.plus({ months: 1 })]) {
    var res = await call(port, "GET", "/api/discovery-call/availability?timezone=" + ZONE + "&year=" + month.year + "&month=" + month.month);
    var slot = ((res.json.data && res.json.data.days) || []).flatMap(function (day) { return day.slots; })[0];
    if (slot) return slot.startUtc;
  }
  throw new Error("no open slot in the test calendar");
}

/**
 * @param {string} origin
 * @param {string} path
 * @param {RequestInit} init
 */
async function raw(origin, path, init) {
  var res = await fetch(origin + path, init);
  var text = await res.text();
  return { status: res.status, headers: res.headers, text: text, json: JSON.parse(text || "{}") };
}

test("the booking endpoint answers with precise status codes", async function (t) {
  var running = await open(t, ENV, { serveStatic: false });
  var origin = running.origin;
  var sameSite = { Origin: origin };
  var form = await raw(origin, "/api/discovery-call/book", { method: "POST", headers: Object.assign({ "Content-Type": "application/x-www-form-urlencoded" }, sameSite), body: "name=x" });
  assert.equal(form.status, 415);
  assert.equal(form.json.code, "UNSUPPORTED_MEDIA_TYPE");
  var broken = await raw(origin, "/api/discovery-call/book", { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, sameSite), body: "{not json" });
  assert.equal(broken.status, 400);
  assert.equal(broken.json.code, "INVALID_JSON");
  var huge = await raw(origin, "/api/discovery-call/book", { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, sameSite), body: JSON.stringify({ name: "x".repeat(30000) }) });
  assert.equal(huge.status, 413);
  var wrongMethod = await raw(origin, "/api/discovery-call/book", { method: "GET" });
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get("allow"), "POST");
  var wrongAvailability = await raw(origin, "/api/discovery-call/availability", { method: "DELETE", headers: sameSite });
  assert.equal(wrongAvailability.status, 405);
  assert.equal(wrongAvailability.headers.get("allow"), "GET");
  var foreign = await raw(origin, "/api/discovery-call/book", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://evil.example" }, body: JSON.stringify(person) });
  assert.equal(foreign.status, 403);
  assert.equal(foreign.json.code, "FORBIDDEN");
  var missing = await raw(origin, "/api/nothing-here", { method: "GET" });
  assert.equal(missing.status, 404);
  running.server.close();
});

test("production refuses localhost origins that development allows", async function (t) {
  var running = await open(t, Object.assign({}, ENV, { NEXT_PUBLIC_SITE_URL: "https://nubetree.com" }), { serveStatic: false });
  var res = await raw(running.origin, "/api/discovery-call/book", { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" }, body: JSON.stringify(person) });
  assert.equal(res.status, 403);
  running.server.close();
});

test("HTTPS API responses include HSTS", async function (t) {
  var running = await open(t, Object.assign({}, ENV, { NEXT_PUBLIC_SITE_URL: "https://nubetree.com" }), { serveStatic: false });
  var res = await raw(running.origin, "/api/health", { method: "GET" });
  assert.equal(res.headers.get("strict-transport-security"), "max-age=31536000; includeSubDomains");
  running.server.close();
});

test("a new booking is 201 and returns only fields meant for the visitor", async function (t) {
  var running = await open(t, ENV, { serveStatic: false });
  var slot = await firstSlot(running.port);
  var res = await call(running.port, "POST", "/api/discovery-call/book", Object.assign({}, person, { selected_time: slot }), { "Idempotency-Key": "contract-1" });
  assert.equal(res.status, 201);
  assert.deepEqual(Object.keys(res.json.data || {}).sort(), [
    "booking_id", "budget", "cancel_url", "company", "confirmationEmailStatus", "email", "internalEmailStatus",
    "meeting_link", "mode", "name", "phone", "project_description", "project_stage", "reschedule_token",
    "selected_time", "services", "timezone"
  ]);
  var text = JSON.stringify(res.json);
  assert.ok(!text.includes("calendar.google.com"), "no internal calendar link");
  assert.ok(!text.includes("evt-"), "no calendar event id");
  assert.ok(!text.includes("contract-1"), "no idempotency key");
  running.server.close();
});

test("unexpected failures reach the browser as a generic 500 with a request id", async function (t) {
  var store = memoryStore();
  store.activeStarts = async function () {
    throw new Error("connect ECONNREFUSED postgresql://nubetree:s3cret@db.internal:5432/nubetree");
  };
  var running = await open(t, ENV, { serveStatic: false, store: store });
  var now = DateTime.now().setZone(ZONE);
  /** @type {string[]} */
  var logged = [];
  setLogListener(function (row) { logged.push(JSON.stringify(row)); });
  try {
    var res = await raw(running.origin, "/api/discovery-call/availability?timezone=" + ZONE + "&year=" + now.year + "&month=" + now.month, { method: "GET" });
    assert.equal(res.status, 500);
    assert.equal(res.json.code, "INTERNAL_ERROR");
    assert.equal(res.json.success, false);
    assert.equal(res.json.message, "Something went wrong. Please try again.");
    assert.equal(res.json.requestId, res.headers.get("x-request-id"));
    for (var leak of ["postgres", "s3cret", "ECONNREFUSED", "db.internal", "at ", "stack"]) {
      assert.ok(!res.text.includes(leak), "response leaked " + leak);
      assert.ok(!logged.join("\n").includes(leak), "log leaked " + leak);
    }
  } finally {
    setLogListener(null);
    running.server.close();
  }
});

test("a calendar failure is a 503 and frees the claimed slot", async function (t) {
  var running = await open(t, ENV, { serveStatic: false, services: { failCalendar: true } });
  var slot = await firstSlot(running.port);
  var res = await call(running.port, "POST", "/api/discovery-call/book", Object.assign({}, person, { selected_time: slot }));
  assert.equal(res.status, 503);
  assert.equal(res.json.code, "SERVICE_UNAVAILABLE");
  assert.ok(!JSON.stringify(res.json).includes("calendar down"));
  assert.equal(running.store.bookings[0].status, "FAILED");
  assert.equal(running.store.bookings[0].slotKey, null);
  running.server.close();
});

test("if the database cannot record the event, the event is removed and the slot freed", async function (t) {
  var store = memoryStore();
  store.attachEvent = async function () { throw new Error("write failed"); };
  var running = await open(t, ENV, { serveStatic: false, store: store });
  var slot = await firstSlot(running.port);
  var res = await call(running.port, "POST", "/api/discovery-call/book", Object.assign({}, person, { selected_time: slot }));
  assert.equal(res.status, 500);
  assert.deepEqual(running.events.map(/** @param {object} item */ function (item) { return "cancelled" in item ? "cancelled" : "created"; }), ["created", "cancelled"]);
  assert.equal(store.bookings[0].status, "FAILED");
  assert.equal(running.emails.length, 0);
  running.server.close();
});

test("missing calendar credentials give a 503 that names no provider", async function (t) {
  var config = loadConfig(Object.assign({ PORT: "0", NEXT_PUBLIC_SITE_URL: "http://127.0.0.1" }, ENV));
  var services = recordingServices();
  var server = createServer({ config: config, store: memoryStore(), calendar: createGoogleCalendar(config), email: services.email, root: resolve(import.meta.dirname, "../.."), serveStatic: false });
  t.after(function () { server.closeAllConnections(); server.close(); });
  await new Promise(function (done) { server.listen(0, "127.0.0.1", function () { done(null); }); });
  var address = server.address();
  var port = address && typeof address === "object" ? address.port : 0;
  var now = DateTime.now().setZone(ZONE);
  var res = await call(port, "GET", "/api/discovery-call/availability?timezone=" + ZONE + "&year=" + now.year + "&month=" + now.month);
  assert.equal(res.status, 503);
  assert.equal(res.json.code, "NOT_CONFIGURED");
  assert.ok(!/google|calendar|oauth/i.test(JSON.stringify(res.json)));
  server.close();
});

test("a calendar that cannot be reached is reported as unavailable", async function () {
  var config = loadConfig(Object.assign({}, ENV, { CALENDAR_CLIENT_ID: "id", CALENDAR_CLIENT_SECRET: "secret", CALENDAR_REFRESH_TOKEN: "token", CALENDAR_ID: "primary" }));
  var calendar = createGoogleCalendar(config, async function () { throw new TypeError("fetch failed"); });
  var from = DateTime.utc();
  await assert.rejects(calendar.getBusy(from, from.plus({ days: 1 })), { code: "SERVICE_UNAVAILABLE", status: 503 });
});

test("booking input is sanitized and choices must come from the form", async function (t) {
  var running = await open(t, ENV, { serveStatic: false });
  var slot = await firstSlot(running.port);
  var odd = await call(running.port, "POST", "/api/discovery-call/book", Object.assign({}, person, { selected_time: slot, services: ["Hacking"], budget: "a lot", project_stage: "<b>now</b>" }));
  assert.equal(odd.status, 400);
  var fields = odd.json.fields || {};
  assert.ok(fields.services && fields.budget && fields.projectStage);
  var objectName = await call(running.port, "POST", "/api/discovery-call/book", Object.assign({}, person, { selected_time: slot, name: { first: "A" } }));
  assert.ok(objectName.json.fields && objectName.json.fields.name);
  var tricky = await call(running.port, "POST", "/api/discovery-call/book", Object.assign({}, person, {
    selected_time: slot,
    name: "Amina\u0000 \u202eShah\u200b",
    project_description: "First line.\r\n\r\n\r\n\tSecond   line."
  }));
  assert.equal(tricky.status, 201);
  var saved = running.store.bookings[0];
  assert.equal(saved.name, "Amina Shah");
  assert.equal(saved.message, "First line.\n\nSecond line.");
  running.server.close();
});
