import test from "node:test";
import assert from "node:assert/strict";
import { DateTime } from "luxon";
import { call, listen, memoryStore } from "./helpers.js";

/**
 * @typedef {import("./helpers.js").MemoryStore} MemoryStore
 * @typedef {{ date: string, startUtc: string }} ListedSlot
 */

var ZONE = "America/New_York";

/**
 * @param {DateTime<true> | DateTime<false>} value
 * @returns {DateTime<true>}
 */
function valid(value) {
  if (!value.isValid) throw new Error("invalid test date");
  return value;
}

/** @param {MemoryStore} [store] */
function bookingServer(store) {
  return listen({
    BOOKING_TIMEZONE: ZONE,
    BOOKING_DURATION_MINUTES: "30",
    BOOKING_HORIZON_DAYS: "14",
    BOOKING_MIN_LEAD_MINUTES: "0",
    RATE_LIMIT_MAX_REQUESTS: "100",
    RATE_LIMIT_WINDOW_SECONDS: "600"
  }, { serveStatic: false, store: store });
}

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
 * Open slots across this month and next, so the tests never depend on today's date.
 * @param {number} port
 * @returns {Promise<ListedSlot[]>}
 */
async function openSlots(port) {
  var now = DateTime.now().setZone(ZONE);
  /** @type {ListedSlot[]} */
  var found = [];
  for (var month of [now, now.plus({ months: 1 })]) {
    var res = await call(port, "GET", "/api/discovery-call/availability?timezone=" + ZONE + "&year=" + month.year + "&month=" + month.month);
    assert.equal(res.status, 200);
    var days = (res.json.data && res.json.data.days) || [];
    days.forEach(function (day) {
      day.slots.forEach(function (slot) { found.push({ date: day.date, startUtc: slot.startUtc }); });
    });
  }
  assert.ok(found.length > 2, "the test calendar needs open slots");
  return found;
}

/**
 * @param {number} port
 * @param {Record<string, unknown>} extra
 * @param {string} [key]
 */
function bookWith(port, extra, key) {
  return call(port, "POST", "/api/discovery-call/book", Object.assign({}, person, extra), key ? { "Idempotency-Key": key } : undefined);
}

/**
 * @param {MemoryStore} store
 * @param {string} startUtc
 * @param {{ key?: string, minutesAgo: number, matchRequest?: boolean }} options
 */
async function seedPending(store, startUtc, options) {
  var start = new Date(startUtc);
  var matchRequest = options.matchRequest === true;
  var row = await store.claim({
    id: "seed-" + startUtc,
    name: matchRequest ? person.name : "Seed",
    email: matchRequest ? person.email : "seed@example.com",
    company: matchRequest ? person.company : "Seed Co",
    phone: "",
    message: matchRequest ? person.project_description : "",
    services: matchRequest && Array.isArray(person.services) ? person.services.join(", ") : "API",
    projectStage: matchRequest ? person.project_stage : "Build",
    budget: person.budget,
    timezone: ZONE,
    startTime: start,
    endTime: new Date(start.getTime() + 30 * 60000),
    slotKey: DateTime.fromJSDate(start).toUTC().toISO() || startUtc,
    status: "PENDING",
    cancelToken: "c-" + startUtc,
    rescheduleToken: "r-" + startUtc,
    idempotencyKey: options.key || null
  });
  row.createdAt = new Date(Date.now() - options.minutesAgo * 60000);
  return row;
}

test("a time in the past is refused by the server", async function () {
  var running = await bookingServer();
  var past = DateTime.now().setZone(ZONE).minus({ days: 1 }).set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
  var res = await bookWith(running.port, { selected_time: past.toUTC().toISO() });
  assert.equal(res.status, 409);
  assert.equal(res.json.code, "SLOT_UNAVAILABLE");
  assert.equal(running.store.bookings.length, 0);
  running.server.close();
});

test("booking accepts the documented core payload without UI-only metadata", async function (t) {
  var running = await bookingServer();
  t.after(function () { running.server.close(); });
  var slots = await openSlots(running.port);
  var res = await call(running.port, "POST", "/api/discovery-call/book", {
    name: "  Amina   Shah ",
    email: "AMINA@EXAMPLE.COM",
    company: "Northwind",
    phone: "+1 555 123 4567",
    message: "Connect billing to the CRM.",
    startTime: slots[0].startUtc,
    timezone: ZONE
  });
  assert.equal(res.status, 201);
  assert.equal(running.store.bookings[0].name, "Amina Shah");
  assert.equal(running.store.bookings[0].email, "amina@example.com");
  assert.equal(running.store.bookings[0].services, "");
  assert.equal(running.store.bookings[0].projectStage, "");
  assert.equal(running.store.bookings[0].budget, "");
});

test("booking rechecks the external calendar after claiming the database slot", async function (t) {
  var running = await bookingServer();
  t.after(function () { running.server.close(); });
  var slots = await openSlots(running.port);
  var start = valid(DateTime.fromISO(slots[0].startUtc));
  var claim = running.store.claim;
  /** @param {import("../src/types.js").NewBooking} row */
  running.store.claim = async function (row) {
    var saved = await claim(row);
    running.services.busy = [{ start: start, end: start.plus({ minutes: 30 }) }];
    return saved;
  };

  var res = await bookWith(running.port, { selected_time: slots[0].startUtc });
  assert.equal(res.status, 409);
  assert.equal(res.json.code, "SLOT_UNAVAILABLE");
  assert.equal(running.store.bookings.length, 1);
  assert.equal(running.store.bookings[0].status, "FAILED");
  assert.equal(running.events.length, 0);
  assert.equal(running.emails.length, 0);
});

test("a time off the slot grid or beyond the booking window is refused", async function () {
  var running = await bookingServer();
  var slots = await openSlots(running.port);
  var offGrid = DateTime.fromISO(slots[0].startUtc).plus({ minutes: 7 }).toUTC().toISO();
  var far = DateTime.now().setZone(ZONE).plus({ days: 60 }).set({ hour: 10, minute: 0, second: 0, millisecond: 0 }).toUTC().toISO();
  var shifted = await bookWith(running.port, { selected_time: offGrid });
  var tooLate = await bookWith(running.port, { selected_time: far });
  assert.equal(shifted.status, 409);
  assert.equal(tooLate.status, 409);
  assert.equal(running.store.bookings.length, 0);
  running.server.close();
});

test("impossible or malformed dates are validation errors", async function () {
  var running = await bookingServer();
  for (var value of ["not-a-date", "2031-02-30T10:00:00Z", ""]) {
    var res = await bookWith(running.port, { selected_time: value });
    assert.equal(res.status, 400, value);
    assert.equal(res.json.code, "VALIDATION_ERROR");
  }
  running.server.close();
});

test("the selected date must match the selected time in the visitor's timezone", async function () {
  var running = await bookingServer();
  var slots = await openSlots(running.port);
  var wrong = await bookWith(running.port, { selected_time: slots[0].startUtc, selected_date: "2000-01-01" });
  assert.equal(wrong.status, 400);
  var fields = wrong.json.fields || {};
  assert.ok(fields.startTime);
  var right = await bookWith(running.port, { selected_time: slots[0].startUtc, selected_date: slots[0].date });
  assert.equal(right.status, 201);
  running.server.close();
});

test("booking fields are validated on the server, with phone optional", async function () {
  var running = await bookingServer();
  var slots = await openSlots(running.port);
  var badPhone = await bookWith(running.port, { selected_time: slots[0].startUtc, phone: "call me maybe" });
  var longName = await bookWith(running.port, { selected_time: slots[0].startUtc, name: "A".repeat(121) });
  var shortCompany = await bookWith(running.port, { selected_time: slots[0].startUtc, company: "N" });
  var badFields = badPhone.json.fields || {};
  var nameFields = longName.json.fields || {};
  var companyFields = shortCompany.json.fields || {};
  assert.equal(badPhone.status, 400);
  assert.ok(badFields.phone);
  assert.ok(nameFields.name);
  assert.ok(companyFields.company);
  var noPhone = await bookWith(running.port, { selected_time: slots[0].startUtc, phone: "" });
  var withPhone = await bookWith(running.port, { selected_time: slots[1].startUtc, phone: "+91 82942 36403" });
  assert.equal(noPhone.status, 201);
  assert.equal(withPhone.status, 201);
  running.server.close();
});

test("racing requests for one slot produce exactly one booking", async function () {
  var store = memoryStore();
  var running = await bookingServer(store);
  var slots = await openSlots(running.port);
  var results = await Promise.all([1, 2, 3, 4, 5, 6].map(function (n) {
    return bookWith(running.port, { selected_time: slots[0].startUtc }, "race-" + n);
  }));
  var statuses = results.map(function (res) { return res.status; }).sort();
  assert.deepEqual(statuses, [201, 409, 409, 409, 409, 409]);
  results.filter(function (res) { return res.status === 409; }).forEach(function (res) {
    assert.equal(res.json.success, false);
    assert.equal(res.json.code, "SLOT_UNAVAILABLE");
    assert.equal(res.json.message, "This time slot is no longer available.");
  });
  assert.equal(running.events.length, 1);
  assert.equal(store.bookings.filter(function (row) { return row.status === "CONFIRMED"; }).length, 1);
  running.server.close();
});

test("a double-clicked submit creates one booking and one calendar event", async function () {
  var running = await bookingServer();
  var slots = await openSlots(running.port);
  var results = await Promise.all([
    bookWith(running.port, { selected_time: slots[0].startUtc }, "double-click"),
    bookWith(running.port, { selected_time: slots[0].startUtc }, "double-click")
  ]);
  results.forEach(function (res) {
    assert.ok(res.status === 201 || res.status === 200 || res.json.code === "BOOKING_IN_PROGRESS", "unexpected " + res.status + " " + res.json.code);
  });
  var later = await bookWith(running.port, { selected_time: slots[0].startUtc }, "double-click");
  assert.equal(later.status, 200);
  assert.equal(running.events.length, 1);
  assert.equal(running.store.bookings.length, 1);
  running.server.close();
});

test("an idempotency key reused for another time, or still in flight, is refused", async function () {
  var store = memoryStore();
  var running = await bookingServer(store);
  var slots = await openSlots(running.port);
  var first = await bookWith(running.port, { selected_time: slots[0].startUtc }, "reused-key");
  assert.equal(first.status, 201);
  var changedDetails = await bookWith(running.port, { selected_time: slots[0].startUtc, email: "different@example.com" }, "reused-key");
  assert.equal(changedDetails.status, 422);
  assert.equal(changedDetails.json.code, "IDEMPOTENCY_MISMATCH");
  var other = await bookWith(running.port, { selected_time: slots[1].startUtc }, "reused-key");
  assert.equal(other.status, 422);
  assert.equal(other.json.code, "IDEMPOTENCY_MISMATCH");
  await seedPending(store, slots[2].startUtc, { key: "in-flight", minutesAgo: 1, matchRequest: true });
  var waiting = await bookWith(running.port, { selected_time: slots[2].startUtc }, "in-flight");
  assert.equal(waiting.status, 409);
  assert.equal(waiting.json.code, "BOOKING_IN_PROGRESS");
  assert.equal(running.events.length, 1);
  running.server.close();
});

test("a claim abandoned by a crashed request is released after 15 minutes", async function () {
  var store = memoryStore();
  var running = await bookingServer(store);
  var slots = await openSlots(running.port);
  await seedPending(store, slots[0].startUtc, { minutesAgo: 1 });
  await seedPending(store, slots[1].startUtc, { minutesAgo: 20 });
  var listed = await openSlots(running.port);
  var starts = listed.map(function (slot) { return slot.startUtc; });
  assert.equal(starts.indexOf(slots[0].startUtc), -1, "a fresh claim still holds its slot");
  assert.notEqual(starts.indexOf(slots[1].startUtc), -1, "a stale claim frees its slot");
  var rebooked = await bookWith(running.port, { selected_time: slots[1].startUtc });
  assert.equal(rebooked.status, 201);
  running.server.close();
});

test("availability refuses nonsense months and reports the booking window", async function () {
  var running = await bookingServer();
  var bad = await call(running.port, "GET", "/api/discovery-call/availability?timezone=" + ZONE + "&year=1999&month=5");
  var fraction = await call(running.port, "GET", "/api/discovery-call/availability?timezone=" + ZONE + "&year=2026.5&month=5");
  assert.equal(bad.status, 400);
  assert.equal(fraction.status, 400);
  var now = DateTime.now().setZone(ZONE);
  var good = await call(running.port, "GET", "/api/discovery-call/availability?timezone=" + ZONE + "&year=" + now.year + "&month=" + now.month);
  var data = good.json.data || {};
  assert.equal(data.horizonDays, 14);
  running.server.close();
});
