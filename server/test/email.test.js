import test from "node:test";
import assert from "node:assert/strict";
import { createResendEmail } from "../src/email.js";
import { loadConfig } from "../src/config.js";

test("Resend sends all transactional email types through the server API", async function () {
  var config = loadConfig({
    NEXT_PUBLIC_SITE_URL: "https://nubetree.example",
    EMAIL_API_KEY: "server-email-key",
    EMAIL_FROM: "NubeTree <no-reply@nubetree.example>",
    INTERNAL_NOTIFICATION_EMAIL: "hr@nubetree.com"
  });
  /** @type {Array<{ url: string, init: RequestInit }>} */
  var requests = [];
  /** @type {typeof fetch} */
  var fetchImpl = async function (url, init) {
    requests.push({ url: String(url), init: init || {} });
    return new Response(JSON.stringify({ id: "email-sent" }), { status: 200 });
  };
  var email = createResendEmail(config, fetchImpl);
  /** @type {import("../src/types.js").BookingView} */
  var booking = {
    id: "booking-1",
    name: "Amina <Shah>",
    email: "amina@example.com",
    company: "Northwind",
    phone: "+1 555 123 4567",
    message: "Connect billing to the CRM.",
    services: "API / System Integration",
    projectStage: "MVP",
    budget: "$25K-$50K",
    timezone: "America/New_York",
    startTime: new Date("2026-10-06T15:00:00.000Z"),
    endTime: new Date("2026-10-06T15:30:00.000Z"),
    slotKey: "slot-1",
    calendarEventId: "event-1",
    calendarEventUrl: "https://calendar.example/event-1",
    status: "CONFIRMED",
    confirmationEmailStatus: "PENDING",
    internalEmailStatus: "PENDING",
    cancelToken: "cancel-token",
    rescheduleToken: "reschedule-token",
    idempotencyKey: "request-1",
    createdAt: new Date("2026-09-30T12:00:00.000Z"),
    updatedAt: new Date("2026-09-30T12:00:00.000Z"),
    meetingLink: "https://meet.example/room"
  };
  /** @type {import("@prisma/client").ContactSubmission} */
  var contact = {
    id: "contact-1",
    firstName: "Amina",
    lastName: "Shah",
    email: "amina@example.com",
    company: "Northwind",
    phone: "+1 555 123 4567",
    city: "Austin",
    state: "TX",
    message: "Please contact me about an integration project.",
    status: "PROCESSED",
    internalEmailStatus: "SENT",
    acknowledgementEmailStatus: "PENDING",
    idempotencyKey: "contact-1",
    createdAt: new Date("2026-09-30T12:00:00.000Z"),
    updatedAt: new Date("2026-09-30T12:00:00.000Z")
  };

  await email.sendBookingConfirmation(booking, { date: "October 6, 2026", time: "11:00 AM" });
  await email.sendInternalBookingNotification(booking, { date: "October 6, 2026", time: "11:00 AM" });
  await email.sendContactNotification(contact);
  await email.sendContactAcknowledgement(contact);

  assert.equal(requests.length, 4);
  requests.forEach(function (request) {
    assert.equal(request.url, "https://api.resend.com/emails");
    assert.equal(request.init.method, "POST");
    assert.equal(new Headers(request.init.headers).get("authorization"), "Bearer server-email-key");
    assert.ok(new Headers(request.init.headers).get("idempotency-key"));
  });
  var messages = requests.map(function (request) { return JSON.parse(String(request.init.body)); });
  assert.equal(messages[0].to[0], "amina@example.com");
  assert.match(messages[0].html, /Amina &lt;Shah&gt;/);
  assert.match(messages[0].html, /Northwind/);
  assert.match(messages[0].html, /October 6, 2026/);
  assert.match(messages[0].html, /11:00 AM/);
  assert.match(messages[0].html, /America\/New_York/);
  assert.match(messages[0].html, /https:\/\/meet\.example\/room/);
  assert.match(messages[0].html, /https:\/\/calendar\.example\/event-1/);
  assert.match(messages[0].html, /reply to this email/i);
  assert.match(messages[0].html, /cancel\.html\?token=cancel-token/);
  assert.match(messages[0].text, /Company: Northwind/);
  assert.match(messages[0].text, /Calendar event: https:\/\/calendar\.example\/event-1/);
  assert.equal(messages[1].to[0], "hr@nubetree.com");
  assert.match(messages[1].text, /Amina <Shah>/);
  assert.match(messages[1].html, /Name/);
  assert.match(messages[1].html, /amina@example\.com/);
  assert.match(messages[1].html, /\+1 555 123 4567/);
  assert.match(messages[1].html, /Northwind/);
  assert.match(messages[1].html, /October 6, 2026/);
  assert.match(messages[1].html, /11:00 AM/);
  assert.match(messages[1].html, /America\/New_York/);
  assert.match(messages[1].html, /Connect billing to the CRM/);
  assert.match(messages[1].html, /event-1/);
  assert.match(messages[1].html, /calendar\.example\/event-1/);
  assert.match(messages[1].html, /2026-09-30T12:00:00\.000Z/);
  assert.match(messages[1].text, /Booking timestamp \(UTC\): 2026-09-30T12:00:00\.000Z/);
  assert.equal(messages[2].to[0], "hr@nubetree.com");
  assert.equal(messages[3].to[0], "amina@example.com");
  assert.equal(messages[3].reply_to, "hr@nubetree.com");
});

test("Resend retries a transient network failure once", async function () {
  var config = loadConfig({
    EMAIL_API_KEY: "server-email-key",
    EMAIL_FROM: "NubeTree <no-reply@nubetree.example>"
  });
  var attempts = 0;
  /** @type {Array<{ url: string, init: RequestInit }>} */
  var requests = [];
  /** @type {typeof fetch} */
  var fetchImpl = async function (url, init) {
    attempts += 1;
    requests.push({ url: String(url), init: init || {} });
    if (attempts === 1) throw new TypeError("temporary network failure");
    return new Response(JSON.stringify({ id: "email-sent" }), { status: 200 });
  };
  var email = createResendEmail(config, fetchImpl);
  await email.sendContactAcknowledgement({
    id: "contact-1",
    firstName: "Amina",
    lastName: "Shah",
    email: "amina@example.com",
    company: "Northwind",
    phone: "",
    city: "Austin",
    state: "TX",
    message: "Please contact me about an integration project.",
    status: "PROCESSED",
    internalEmailStatus: "SENT",
    acknowledgementEmailStatus: "PENDING",
    idempotencyKey: null,
    createdAt: new Date(),
    updatedAt: new Date()
  });
  assert.equal(attempts, 2);
  assert.equal(new Headers(requests[0].init.headers).get("idempotency-key"), new Headers(requests[1].init.headers).get("idempotency-key"));
});