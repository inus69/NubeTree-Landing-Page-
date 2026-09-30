import test from "node:test";
import assert from "node:assert/strict";
import { DateTime } from "luxon";
import { createAlerter } from "../src/alert.js";
import { log, setLogListener } from "../src/log.js";
import { createGoogleCalendar } from "../src/calendar.js";
import { loadConfig } from "../src/config.js";

/**
 * @typedef {{ url: string, body: { text: string, content: string } }} Sent
 * @param {number} [status]
 */
function recorder(status) {
  /** @type {Sent[]} */
  var sent = [];
  /** @type {typeof fetch} */
  var fetchImpl = async function (url, init) {
    sent.push({ url: String(url), body: JSON.parse(String(init && init.body)) });
    return new Response("ok", { status: status || 200 });
  };
  return { sent: sent, fetchImpl: fetchImpl };
}

test("alerts go out for failures and stay quiet for routine events", async function () {
  var http = recorder();
  var alerter = createAlerter({ url: "https://hooks.example/alert", site: "https://www.example.com", fetchImpl: http.fetchImpl });
  alerter.notify({ event: "booking_request", at: "t0" });
  alerter.notify({ event: "email_failure", at: "t1", kind: "booking_confirmation", bookingId: "b1" });
  await alerter.flush(1000);
  assert.equal(http.sent.length, 1);
  assert.equal(http.sent[0].url, "https://hooks.example/alert");
  assert.match(http.sent[0].body.text, /email_failure on https:\/\/www\.example\.com/);
  assert.match(http.sent[0].body.text, /kind=booking_confirmation bookingId=b1/);
  assert.equal(http.sent[0].body.content, http.sent[0].body.text);
});

test("repeated alerts are held back, then counted in the next one", async function () {
  var http = recorder();
  var clock = 0;
  var alerter = createAlerter({ url: "https://hooks.example/alert", fetchImpl: http.fetchImpl, cooldownMs: 1000, now: function () { return clock; } });
  alerter.notify({ event: "calendar_failure", at: "a" });
  alerter.notify({ event: "calendar_failure", at: "b" });
  alerter.notify({ event: "calendar_failure", at: "c" });
  alerter.notify({ event: "server_error", at: "d" });
  clock = 1500;
  alerter.notify({ event: "calendar_failure", at: "e" });
  await alerter.flush(1000);
  assert.equal(http.sent.length, 3);
  assert.match(http.sent[2].body.text, /2 more of this alert were held back/);
});

test("no webhook means no alerts, and a failing webhook is logged without throwing", async function () {
  var quiet = recorder();
  createAlerter({ url: "", fetchImpl: quiet.fetchImpl }).notify({ event: "uncaught_exception", at: "x" });
  assert.equal(quiet.sent.length, 0);

  /** @type {string[]} */
  var failures = [];
  var broken = recorder(500);
  var alerter = createAlerter({ url: "https://hooks.example/alert", fetchImpl: broken.fetchImpl, onFailure: function (event) { failures.push(event); } });
  alerter.notify({ event: "uncaught_exception", at: "x" });
  await alerter.flush(1000);
  assert.deepEqual(failures, ["alert_failure"]);
});

test("logged failures reach the alert without personal data", async function () {
  var http = recorder();
  var alerter = createAlerter({ url: "https://hooks.example/alert", fetchImpl: http.fetchImpl });
  setLogListener(alerter.notify);
  var calendar = createGoogleCalendar(loadConfig({
    CALENDAR_CLIENT_ID: "id",
    CALENDAR_CLIENT_SECRET: "secret",
    CALENDAR_REFRESH_TOKEN: "refresh",
    CALENDAR_ID: "team"
  }), async function () { return new Response("denied", { status: 403 }); });
  try {
    var from = DateTime.utc();
    if (!from.isValid) throw new Error("clock");
    await assert.rejects(calendar.getBusy(from, from.plus({ days: 1 })));
    log("email_failure", { kind: "contact_internal", email: "person@example.com", message: "private" });
    await alerter.flush(1000);
  } finally {
    setLogListener(null);
  }
  assert.equal(http.sent.length, 2);
  assert.match(http.sent[0].body.text, /calendar_failure/);
  assert.match(http.sent[0].body.text, /operation=token status=403/);
  assert.equal(http.sent[1].body.text.indexOf("person@example.com"), -1);
  assert.equal(http.sent[1].body.text.indexOf("private"), -1);
});

test("structured logs redact nested personal data and credential key variants", function () {
  /** @type {Record<string, unknown>[]} */
  var notified = [];
  setLogListener(function (row) { notified.push(row); });
  try {
    log("security_test", {
      requestId: "request-1",
      nested: {
        email: "visitor@example.com",
        Phone: "+1 555 123 4567",
        refresh_token: "oauth-refresh-secret",
        API_KEY: "resend-secret",
        safeCount: 3
      }
    });
  } finally {
    setLogListener(null);
  }
  var logged = JSON.stringify(notified);
  for (var secret of ["visitor@example.com", "+1 555 123 4567", "oauth-refresh-secret", "resend-secret"]) {
    assert.equal(logged.includes(secret), false);
  }
  assert.ok(logged.includes("request-1"));
  assert.ok(logged.includes("safeCount"));
});
