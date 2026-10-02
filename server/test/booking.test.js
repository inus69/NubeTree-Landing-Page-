import test from "node:test";
import assert from "node:assert/strict";
import { DateTime } from "luxon";
import { call, listen } from "./helpers.js";
/** @typedef {import("../src/types.js").SalesforceService} SalesforceService */

/** @param {{ max?: number, salesforce?: SalesforceService }} [extras] */
function bookingServer(extras) {
  return listen({
    BOOKING_TIMEZONE: "America/New_York",
    BOOKING_DURATION_MINUTES: "30",
    BOOKING_HORIZON_DAYS: "14",
    BOOKING_MIN_LEAD_MINUTES: "0",
    RATE_LIMIT_MAX_REQUESTS: extras && extras.max ? String(extras.max) : "20",
    RATE_LIMIT_AVAILABILITY_MAX: extras && extras.max ? String(extras.max) : "60",
    RATE_LIMIT_WINDOW_SECONDS: "600"
  }, { serveStatic: false, salesforce: extras && extras.salesforce });
}

var person = {
  name: "Amina Shah",
  email: "amina@example.com",
  company: "Northwind",
  phone: "+1 555 123 4567",
  services: ["API / System Integration"],
  project_stage: "MVP",
  budget: "$25K – $50K",
  timezone: "America/New_York",
  project_description: "Connect the billing system to the CRM."
};

test("books a real slot once and rejects the second claim", async function () {
  var running = await bookingServer();
  var month = DateTime.now().setZone("America/New_York").plus({ days: 2 });
  var listed = await call(running.port, "GET", "/api/discovery-call/availability?timezone=America/New_York&year=" + month.year + "&month=" + month.month);
  assert.equal(listed.json.success, true);
  var days = (listed.json.data && listed.json.data.days) || [];
  var slot = days.flatMap(function (day) { return day.slots; })[0];
  assert.ok(slot);
  var payload = Object.assign({}, person, { selected_time: slot.startUtc });
  var first = await call(running.port, "POST", "/api/discovery-call/book", payload, { "Idempotency-Key": "same-key" });
  var replay = await call(running.port, "POST", "/api/discovery-call/book", payload, { "Idempotency-Key": "same-key" });
  var second = await call(running.port, "POST", "/api/discovery-call/book", payload, { "Idempotency-Key": "other-key" });
  assert.equal(first.status, 201);
  assert.equal(replay.status, 200);
  assert.equal(first.json.data && first.json.data.mode, "live");
  assert.equal(replay.json.data && replay.json.data.booking_id, first.json.data && first.json.data.booking_id);
  assert.equal(second.status, 409);
  assert.equal(second.json.code, "SLOT_UNAVAILABLE");
  assert.equal(second.json.message, "This time slot is no longer available.");
  assert.equal(running.events.length, 1);
  assert.equal(running.events[0].summary, "NubeTree — Discovery Call — Amina Shah");
  assert.equal(running.events[0].description, [
    "Discovery Call",
    "",
    "Name: Amina Shah",
    "Company: Northwind",
    "Email: amina@example.com",
    "Phone: +1 555 123 4567",
    "",
    "Message:",
    "Connect the billing system to the CRM.",
    "",
    "Source:",
    "NubeTree Website"
  ].join("\n"));
  assert.deepEqual(running.events[0].attendees, ["amina@example.com", "hr@nubetree.com"]);
  assert.ok(running.emails.indexOf("confirm") !== -1);
  running.server.close();
});

test("email failure does not fail a created booking or create a second calendar event on replay", async function () {
  var running = await bookingServer();
  running.services.failEmail = true;
  var month = DateTime.now().setZone("America/New_York").plus({ days: 2 });
  var listed = await call(running.port, "GET", "/api/discovery-call/availability?timezone=America/New_York&year=" + month.year + "&month=" + month.month);
  var slot = ((listed.json.data && listed.json.data.days) || []).flatMap(function (day) { return day.slots; })[0];
  assert.ok(slot);
  var payload = Object.assign({}, person, { selected_time: slot.startUtc });
  var booked = await call(running.port, "POST", "/api/discovery-call/book", payload, { "Idempotency-Key": "mail-failure" });
  var replay = await call(running.port, "POST", "/api/discovery-call/book", payload, { "Idempotency-Key": "mail-failure" });
  assert.equal(booked.status, 201);
  assert.equal(booked.json.success, true);
  assert.equal(booked.json.data && booked.json.data.confirmationEmailStatus, "FAILED");
  assert.equal(booked.json.data && booked.json.data.internalEmailStatus, "FAILED");
  assert.equal(running.store.bookings[0].status, "CONFIRMED");
  assert.equal(replay.status, 200);
  assert.equal(running.events.length, 1);
  assert.equal(running.store.bookings.length, 1);
  running.server.close();
});

test("a confirmed booking retries its Salesforce sync without creating another calendar event", async function () {
  var attempts = 0;
  /** @type {SalesforceService} */
  var salesforce = {
    configured: function () { return true; },
    required: function () { return false; },
    async upsertContact() {},
    async upsertBooking(booking) {
      attempts += 1;
      assert.equal(booking.email, person.email);
      if (attempts === 1) throw new Error("Salesforce unavailable");
    }
  };
  var running = await bookingServer({ salesforce: salesforce });
  var month = DateTime.now().setZone("America/New_York").plus({ days: 2 });
  var listed = await call(running.port, "GET", "/api/discovery-call/availability?timezone=America/New_York&year=" + month.year + "&month=" + month.month);
  var slot = ((listed.json.data && listed.json.data.days) || []).flatMap(function (day) { return day.slots; })[0];
  var payload = Object.assign({}, person, { selected_time: slot.startUtc });
  var first = await call(running.port, "POST", "/api/discovery-call/book", payload, { "Idempotency-Key": "crm-booking" });
  assert.equal(first.status, 503);
  assert.equal(running.store.bookings[0].status, "CONFIRMED");
  var retry = await call(running.port, "POST", "/api/discovery-call/book", payload, { "Idempotency-Key": "crm-booking" });
  assert.equal(retry.status, 200);
  assert.equal(attempts, 2);
  assert.equal(running.events.length, 1);
  running.server.close();
});

test("contact honeypot is stored as spam and does not send mail", async function (t) {
  var running = await bookingServer();
  t.after(function () { running.server.close(); });
  var res = await call(running.port, "POST", "/api/contact", {
    firstName: "Amina",
    lastName: "Shah",
    email: "amina@example.com",
    phone: "5551234567",
    city: "Austin",
    state: "TX",
    message: "Hello from the website form.",
    website: "https://spam.example"
  });
  assert.equal(res.status, 201);
  assert.equal(running.store.contacts[0].status, "SPAM");
  assert.equal(running.emails.length, 0);
});

test("rate limit and invalid email are enforced", async function () {
  var running = await bookingServer({ max: 1 });
  var month = DateTime.now().setZone("America/New_York");
  var first = await call(running.port, "GET", "/api/discovery-call/availability?timezone=America/New_York&year=" + month.year + "&month=" + month.month);
  var second = await call(running.port, "GET", "/api/discovery-call/availability?timezone=America/New_York&year=" + month.year + "&month=" + month.month);
  assert.equal(first.status, 200);
  assert.equal(second.status, 429);
  assert.equal(second.json.code, "RATE_LIMITED");
  assert.equal(second.json.success, false);
  assert.equal(second.json.message, "Too many requests. Please try again later.");
  var bad = await call(running.port, "POST", "/api/contact", {
    firstName: "Amina",
    lastName: "Shah",
    email: "not-an-email",
    phone: "5551234567",
    city: "Austin",
    state: "TX",
    message: "This message is long enough."
  });
  assert.equal(bad.json.code, "VALIDATION_ERROR");
  running.server.close();
});

test("health and robots are available", async function () {
  var running = await bookingServer();
  var health = await call(running.port, "GET", "/api/health");
  var robots = await fetch(running.origin + "/robots.txt");
  var text = await robots.text();
  assert.equal(health.status, 200);
  assert.equal(health.json.data && health.json.data.database, "ok");
  assert.equal(robots.status, 200);
  assert.equal(text.indexOf("Disallow: /api/") !== -1, true);
  running.server.close();
});

test("rescheduling reports the email result for the new time", async function () {
  var running = await bookingServer();
  var month = DateTime.now().setZone("America/New_York").plus({ days: 2 });
  var listed = await call(running.port, "GET", "/api/discovery-call/availability?timezone=America/New_York&year=" + month.year + "&month=" + month.month);
  var slots = ((listed.json.data && listed.json.data.days) || []).flatMap(function (day) { return day.slots; });
  assert.ok(slots.length > 1);
  var first = await call(running.port, "POST", "/api/discovery-call/book", Object.assign({}, person, { selected_time: slots[0].startUtc }));
  assert.equal(first.status, 201);
  assert.equal(first.json.data && first.json.data.confirmationEmailStatus, "SENT");
  running.services.failEmail = true;
  var token = running.store.bookings[0].rescheduleToken;
  var moved = await call(running.port, "POST", "/api/discovery-call/reschedule", Object.assign({}, person, { selected_time: slots[1].startUtc, reschedule_token: token }));
  assert.equal(moved.status, 200);
  assert.equal(running.store.bookings[0].startTime.toISOString(), new Date(slots[1].startUtc).toISOString());
  assert.equal(moved.json.data && moved.json.data.confirmationEmailStatus, "FAILED");
  running.server.close();
});
