import test from "node:test";
import assert from "node:assert/strict";
import { DateTime } from "luxon";
import { businessSlots, overlaps } from "../src/slots.js";

/**
 * @param {DateTime<true> | DateTime<false>} value
 * @returns {DateTime<true>}
 */
function valid(value) {
  if (!value.isValid) throw new Error("invalid test date");
  return value;
}

var rules = {
  timeZone: "America/New_York",
  durationMinutes: 30,
  bufferMinutes: 0,
  workStart: "09:00",
  workEnd: "17:00",
  weekdays: [1, 2, 3, 4, 5],
  minLeadMinutes: 60,
  horizonDays: 5
};

test("weekday morning slots exist and weekends do not", function () {
  var now = valid(DateTime.fromISO("2026-10-05T12:00:00", { zone: "America/New_York" }));
  var slots = businessSlots(Object.assign({}, rules, { now: now, busy: [] }));
  var keys = slots.map(function (slot) { return slot.start.setZone("America/New_York").toFormat("ccc HH:mm"); });
  assert.equal(keys.indexOf("Mon 09:00") === -1, true);
  assert.ok(keys.indexOf("Tue 09:00") !== -1);
  assert.equal(keys.some(function (key) { return key.indexOf("Sat") === 0 || key.indexOf("Sun") === 0; }), false);
  assert.equal(keys.some(function (key) { return key.indexOf("08:") !== -1 || key.indexOf("17:") !== -1; }), false);
});

test("busy intervals are removed", function () {
  var now = valid(DateTime.fromISO("2026-10-05T08:00:00", { zone: "America/New_York" }));
  var busyStart = valid(DateTime.fromISO("2026-10-06T13:00:00", { zone: "America/New_York" }).toUTC());
  var slots = businessSlots(Object.assign({}, rules, {
    now: now,
    busy: [{ start: busyStart, end: busyStart.plus({ minutes: 30 }) }]
  }));
  assert.equal(slots.some(function (slot) { return slot.start.toMillis() === busyStart.toMillis(); }), false);
});

test("daylight saving keeps 09:00 as a real local time", function () {
  var spring = valid(DateTime.fromObject({ year: 2026, month: 3, day: 9, hour: 9 }, { zone: "America/New_York" }));
  var fall = DateTime.fromObject({ year: 2026, month: 11, day: 2, hour: 9 }, { zone: "America/New_York" });
  assert.equal(spring.toFormat("ZZ"), "-04:00");
  assert.equal(fall.toFormat("ZZ"), "-05:00");
  assert.equal(overlaps(spring, spring.plus({ minutes: 30 }), [{ start: spring.plus({ minutes: 15 }), end: spring.plus({ minutes: 45 }) }]), true);
});

test("nonexistent spring-forward wall times and appointments crossing the gap are omitted", function () {
  var slots = businessSlots(Object.assign({}, rules, {
    now: valid(DateTime.fromISO("2026-03-07T00:00:00", { zone: "America/New_York" })),
    weekdays: [7],
    workStart: "01:00",
    workEnd: "04:00",
    horizonDays: 2,
    minLeadMinutes: 0
  }));
  var times = slots.map(function (slot) { return slot.start.setZone("America/New_York").toFormat("HH:mm"); });
  assert.deepEqual(times, ["01:00", "03:00", "03:30"]);
});

test("ambiguous fall-back wall times are omitted instead of duplicated", function () {
  var slots = businessSlots(Object.assign({}, rules, {
    now: valid(DateTime.fromISO("2026-10-31T00:00:00", { zone: "America/New_York" })),
    weekdays: [7],
    workStart: "01:00",
    workEnd: "03:00",
    horizonDays: 2,
    minLeadMinutes: 0
  }));
  var times = slots.map(function (slot) { return slot.start.setZone("America/New_York").toFormat("HH:mm"); });
  assert.deepEqual(times, ["02:00", "02:30"]);
  assert.equal(new Set(times).size, times.length);
});
