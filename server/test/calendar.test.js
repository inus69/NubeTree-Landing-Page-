import test from "node:test";
import assert from "node:assert/strict";
import { DateTime } from "luxon";
import { createGoogleCalendar } from "../src/calendar.js";
import { loadConfig } from "../src/config.js";

/**
 * @param {DateTime<true> | DateTime<false>} value
 * @returns {DateTime<true>}
 */
function valid(value) {
  if (!value.isValid) throw new Error("invalid test date");
  return value;
}

test("Google Calendar uses OAuth for free/busy and the complete event lifecycle", async function () {
  var config = loadConfig({
    CALENDAR_CLIENT_ID: "server-client-id",
    CALENDAR_CLIENT_SECRET: "server-client-secret",
    CALENDAR_REFRESH_TOKEN: "server-refresh-token",
    CALENDAR_ID: "team@example.com"
  });
  var responses = [
    new Response(JSON.stringify({ access_token: "server-access-token", expires_in: 3600 }), { status: 200 }),
    new Response(JSON.stringify({ calendars: { "team@example.com": { busy: [
      { start: "2026-10-05T14:00:00Z", end: "2026-10-05T14:30:00Z" }
    ] } } }), { status: 200 }),
    new Response(JSON.stringify({ id: "event-1", htmlLink: "https://calendar.google.com/event", hangoutLink: "https://meet.google.com/abc-defg-hij" }), { status: 200 }),
    new Response(JSON.stringify({ id: "event-1", htmlLink: "https://calendar.google.com/event" }), { status: 200 }),
    new Response(null, { status: 204 })
  ];
  /** @type {Array<{ url: string, init: RequestInit }>} */
  var requests = [];
  /** @type {typeof fetch} */
  var fetchImpl = async function (url, init) {
    requests.push({ url: String(url), init: init || {} });
    var next = responses.shift();
    if (!next) throw new Error("unexpected Google API request");
    return next;
  };
  var calendar = createGoogleCalendar(config, fetchImpl);
  var from = valid(DateTime.fromISO("2026-10-05T00:00:00Z", { setZone: true }));
  var busy = await calendar.getBusy(from, from.plus({ days: 1 }));
  assert.equal(busy.length, 1);
  assert.equal(busy[0].start.toISO(), "2026-10-05T14:00:00.000Z");

  var start = valid(DateTime.fromISO("2026-10-06T15:00:00Z", { setZone: true }));
  var event = {
    requestId: "booking-1",
    summary: "Discovery call",
    description: "Project discussion",
    start: start,
    end: start.plus({ minutes: 30 }),
    attendees: ["visitor@example.com", "team@example.com"]
  };
  var created = await calendar.createEvent(event);
  assert.equal(created.id, "event-1");
  assert.equal(created.meetingLink, "https://meet.google.com/abc-defg-hij");
  await calendar.updateEvent("event-1", event);
  await calendar.cancelEvent("event-1");

  assert.equal(requests.length, 5);
  assert.match(requests[0].url, /^https:\/\/oauth2\.googleapis\.com\/token$/);
  assert.match(String(requests[0].init.body), /client_secret=server-client-secret/);
  requests.slice(1).forEach(function (request) {
    assert.equal(new Headers(request.init.headers).get("authorization"), "Bearer server-access-token");
    var body = String(request.init.body || "");
    assert.equal(body.includes("server-client-secret"), false);
    assert.equal(body.includes("server-refresh-token"), false);
  });
  assert.match(requests[1].url, /\/freeBusy$/);
  assert.match(requests[2].url, /\/calendars\/team%40example\.com\/events\?/);
  var createdBody = JSON.parse(String(requests[2].init.body));
  assert.equal(createdBody.start.timeZone, "UTC");
  assert.equal(createdBody.start.dateTime, "2026-10-06T15:00:00.000Z");
  assert.equal(requests[3].init.method, "PATCH");
  assert.equal(requests[4].init.method, "DELETE");
});

test("Google Calendar retries transient free/busy failures but does not retry event creation", async function () {
  var config = loadConfig({
    CALENDAR_CLIENT_ID: "client-id",
    CALENDAR_CLIENT_SECRET: "client-secret",
    CALENDAR_REFRESH_TOKEN: "refresh-token",
    CALENDAR_ID: "team@example.com"
  });
  var responses = [
    new Response("temporary outage", { status: 503 }),
    new Response(JSON.stringify({ access_token: "access-token", expires_in: 3600 }), { status: 200 }),
    new Response("temporary outage", { status: 503 }),
    new Response(JSON.stringify({ calendars: { "team@example.com": { busy: [] } } }), { status: 200 }),
    new Response("temporary outage", { status: 503 })
  ];
  /** @type {Array<{ url: string, init: RequestInit }>} */
  var requests = [];
  /** @type {typeof fetch} */
  var fetchImpl = async function (url, init) {
    requests.push({ url: String(url), init: init || {} });
    var next = responses.shift();
    if (!next) throw new Error("unexpected Google API request");
    return next;
  };
  var calendar = createGoogleCalendar(config, fetchImpl);
  var from = valid(DateTime.fromISO("2026-10-05T00:00:00Z", { setZone: true }));
  await calendar.getBusy(from, from.plus({ days: 1 }));
  await assert.rejects(calendar.createEvent({
    requestId: "booking-1",
    summary: "Discovery call",
    description: "Project discussion",
    start: from,
    end: from.plus({ minutes: 30 }),
    attendees: ["visitor@example.com"]
  }));
  assert.equal(requests.filter(function (request) { return request.url === "https://oauth2.googleapis.com/token"; }).length, 2);
  assert.equal(requests.filter(function (request) { return request.url.endsWith("/freeBusy"); }).length, 2);
  assert.equal(requests.filter(function (request) { return request.url.indexOf("/events?") !== -1; }).length, 1);
});