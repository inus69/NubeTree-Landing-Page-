import test from "node:test";
import assert from "node:assert/strict";
import { call, listen } from "./helpers.js";
import { contactInput } from "../src/validate.js";

var ENV = { RATE_LIMIT_MAX_REQUESTS: "100", RATE_LIMIT_WINDOW_SECONDS: "600" };

var visitor = {
  firstName: "Amina",
  lastName: "Shah",
  email: "amina@example.com",
  phone: "+1 (555) 123-4567",
  city: "Austin",
  state: "TX",
  company: "Northwind",
  message: "We would like to talk about a Salesforce build.",
  elapsedMs: 15000
};

/**
 * @param {import("node:test").TestContext} t
 * @param {Record<string, string>} [env]
 */
async function open(t, env) {
  var running = await listen(Object.assign({}, ENV, env || {}), { serveStatic: false });
  t.after(function () {
    running.server.closeAllConnections();
    running.server.close();
  });
  return running;
}

/** @param {unknown} error */
function fieldsOf(error) {
  var record = /** @type {{ fields?: Record<string, string> }} */ (error);
  return Object.keys(record.fields || {}).sort();
}

test("a valid message is stored, emailed to the team, acknowledged, and returns 201", async function (t) {
  var running = await open(t);
  var res = await call(running.port, "POST", "/api/contact", visitor, { "Idempotency-Key": "contact-one" });
  assert.equal(res.status, 201);
  assert.deepEqual(res.json, { success: true, data: { received: true } });
  assert.equal(running.store.contacts.length, 1);
  assert.equal(running.store.contacts[0].status, "PROCESSED");
  assert.equal(running.store.contacts[0].internalEmailStatus, "SENT");
  assert.deepEqual(running.emails, ["contact", "ack"]);
});

test("the same idempotency key is stored and emailed once", async function (t) {
  var running = await open(t);
  var first = await call(running.port, "POST", "/api/contact", visitor, { "Idempotency-Key": "double-click" });
  var second = await call(running.port, "POST", "/api/contact", visitor, { "Idempotency-Key": "double-click" });
  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.equal(second.json.success, true);
  assert.equal(running.store.contacts.length, 1);
  assert.deepEqual(running.emails, ["contact", "ack"]);
});

test("an incomplete honeypot submission is silently treated as spam", async function (t) {
  var running = await open(t);
  var res = await call(running.port, "POST", "/api/contact", { website: "bot-filled" });
  assert.equal(res.status, 201);
  assert.deepEqual(res.json, { success: true, data: { received: true } });
  assert.equal(running.store.contacts.length, 0);
  assert.deepEqual(running.emails, []);
});

test("simultaneous submissions with one key create one record", async function (t) {
  var running = await open(t);
  var results = await Promise.all([1, 2, 3].map(function () {
    return call(running.port, "POST", "/api/contact", visitor, { "Idempotency-Key": "burst" });
  }));
  var statuses = results.map(function (item) { return item.status; }).sort();
  assert.equal(running.store.contacts.length, 1);
  assert.equal(statuses.filter(function (status) { return status === 201; }).length, 1);
  results.forEach(function (item) {
    assert.ok(item.status === 201 || item.status === 200 || (item.status === 409 && item.json.code === "SUBMISSION_IN_PROGRESS"));
  });
});

test("the same message from the same email within minutes is a duplicate", async function (t) {
  var running = await open(t);
  var first = await call(running.port, "POST", "/api/contact", visitor, { "Idempotency-Key": "tab-one" });
  var second = await call(running.port, "POST", "/api/contact", visitor, { "Idempotency-Key": "tab-two" });
  var noKey = await call(running.port, "POST", "/api/contact", visitor);
  var different = await call(running.port, "POST", "/api/contact", Object.assign({}, visitor, { message: "A different question about integrations." }));
  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.equal(noKey.status, 200);
  assert.equal(different.status, 201);
  assert.equal(running.store.contacts.length, 2);
});

test("a failed team email returns 503, keeps the record, and allows a retry with the same key", async function (t) {
  var running = await open(t);
  running.services.failEmail = true;
  var failed = await call(running.port, "POST", "/api/contact", visitor, { "Idempotency-Key": "retry-me" });
  assert.equal(failed.status, 503);
  assert.equal(failed.json.code, "SERVICE_UNAVAILABLE");
  assert.match(failed.json.message || "", /try again/i);
  assert.equal(running.store.contacts[0].status, "FAILED");
  assert.equal(running.store.contacts[0].idempotencyKey, null);
  assert.equal(running.emails.indexOf("ack"), -1);
  running.services.failEmail = false;
  var retried = await call(running.port, "POST", "/api/contact", visitor, { "Idempotency-Key": "retry-me" });
  assert.equal(retried.status, 201);
  assert.equal(running.store.contacts.length, 2);
  assert.equal(running.store.contacts[1].status, "PROCESSED");
});

test("a form filled in under two seconds is stored as spam without email", async function (t) {
  var running = await open(t);
  var res = await call(running.port, "POST", "/api/contact", Object.assign({}, visitor, { elapsedMs: 400 }));
  assert.equal(res.status, 201);
  assert.equal(running.store.contacts[0].status, "SPAM");
  assert.equal(running.emails.length, 0);
});

test("the contact endpoint is rate limited", async function (t) {
  var running = await open(t, { RATE_LIMIT_MAX_REQUESTS: "2" });
  var one = await call(running.port, "POST", "/api/contact", visitor);
  var two = await call(running.port, "POST", "/api/contact", Object.assign({}, visitor, { message: "Second message, also long enough." }));
  var three = await call(running.port, "POST", "/api/contact", Object.assign({}, visitor, { message: "Third message, also long enough." }));
  assert.equal(one.status, 201);
  assert.equal(two.status, 201);
  assert.equal(three.status, 429);
  assert.equal(three.json.code, "RATE_LIMITED");
});

test("invalid fields return 400 with a message for each field and nothing is stored", async function (t) {
  var running = await open(t);
  var res = await call(running.port, "POST", "/api/contact", { firstName: " ", email: "amina@", phone: "12", message: "short" });
  assert.equal(res.status, 400);
  assert.equal(res.json.success, false);
  assert.equal(res.json.code, "VALIDATION_ERROR");
  assert.equal(res.json.message, "Please check the highlighted fields.");
  assert.ok(res.json.fields && typeof res.json.fields === "object");
  assert.deepEqual(Object.keys(res.json.fields || {}).sort(), ["city", "email", "firstName", "lastName", "message", "phone", "state"]);
  assert.equal(running.store.contacts.length, 0);
  var form = await fetch(running.origin + "/api/contact", { method: "POST", headers: { Origin: running.origin, "Content-Type": "application/x-www-form-urlencoded" }, body: "firstName=A" });
  assert.equal(form.status, 415);
});

test("over-long values are rejected instead of cut short", function () {
  assert.throws(function () {
    contactInput(Object.assign({}, visitor, {
      firstName: "A".repeat(81),
      lastName: "B".repeat(81),
      email: "a".repeat(150) + "@example.com",
      phone: "1".repeat(16),
      city: "C".repeat(81),
      state: "S".repeat(81),
      company: "N".repeat(161),
      message: "M".repeat(4001)
    }));
  }, function (/** @type {unknown} */ error) {
    assert.deepEqual(fieldsOf(error), ["city", "company", "email", "firstName", "lastName", "message", "phone", "state"]);
    return true;
  });
});

test("input is sanitised and message paragraphs are kept", function () {
  var parsed = contactInput(Object.assign({}, visitor, {
    firstName: "  Am\u200bina\u0007 ",
    email: " Amina@Example.COM ",
    company: "North\u202ewind",
    message: "Hello team,\r\n\r\n\r\n\r\nWe   need help.\u0000\nThanks"
  }));
  assert.equal(parsed.firstName, "Amina");
  assert.equal(parsed.email, "amina@example.com");
  assert.equal(parsed.company, "Northwind");
  assert.equal(parsed.message, "Hello team,\n\nWe need help.\nThanks");
  assert.equal(parsed.elapsedMs, 15000);
  assert.throws(function () {
    contactInput(Object.assign({}, visitor, { phone: "555-CALL-NOW" }));
  }, function (/** @type {unknown} */ error) {
    assert.deepEqual(fieldsOf(error), ["phone"]);
    return true;
  });
});
