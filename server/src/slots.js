import { DateTime } from "luxon";

/**
 * @typedef {import("./types.js").Instant} Instant
 * @typedef {import("./types.js").Interval} Interval
 */

/**
 * @typedef {object} SlotOptions
 * @property {string} timeZone
 * @property {Instant} now
 * @property {number} durationMinutes
 * @property {number} [bufferMinutes]
 * @property {string} workStart
 * @property {string} workEnd
 * @property {number[]} weekdays
 * @property {number} [minLeadMinutes]
 * @property {number} horizonDays
 * @property {Interval[]} [busy]
 */

/** @param {string} value */
function clock(value) {
  var bits = String(value || "09:00").split(":");
  return { hour: Number(bits[0]) || 0, minute: Number(bits[1]) || 0 };
}

/**
 * Return a candidate only when the requested business-local wall time maps to one instant.
 * @param {DateTime} day
 * @param {number} minutes
 * @returns {Instant | null}
 */
function uniqueWallTime(day, minutes) {
  var hour = Math.floor(minutes / 60);
  var minute = minutes % 60;
  var wallMillis = Date.UTC(day.year, day.month - 1, day.day, hour, minute);
  var offsets = [day.offset, day.minus({ days: 1 }).offset, day.plus({ days: 1 }).offset];
  /** @type {Instant[]} */
  var matches = [];
  offsets.forEach(function (offset) {
    var candidate = DateTime.fromMillis(wallMillis - offset * 60000, { zone: day.zone });
    if (candidate.isValid && candidate.year === day.year && candidate.month === day.month && candidate.day === day.day &&
        candidate.hour === hour && candidate.minute === minute &&
        !matches.some(function (item) { return item.toMillis() === candidate.toMillis(); })) {
      matches.push(/** @type {Instant} */ (candidate));
    }
  });
  return matches.length === 1 ? matches[0] : null;
}

/**
 * @param {DateTime} start
 * @param {number} duration
 */
function staysOnWallSchedule(start, duration) {
  var expected = DateTime.fromObject({
    year: start.year,
    month: start.month,
    day: start.day,
    hour: start.hour,
    minute: start.minute
  }, { zone: "UTC" }).plus({ minutes: duration });
  var end = start.plus({ minutes: duration });
  return end.year === expected.year && end.month === expected.month && end.day === expected.day &&
    end.hour === expected.hour && end.minute === expected.minute;
}

/**
 * @param {Instant} start
 * @param {Instant} end
 * @param {Interval[]} busy
 */
export function overlaps(start, end, busy) {
  var a = start.toMillis();
  var b = end.toMillis();
  return busy.some(function (item) {
    var left = item.start.toMillis();
    var right = item.end.toMillis();
    return a < right && left < b;
  });
}

/**
 * @param {SlotOptions} options
 * @returns {Interval[]}
 */
export function businessSlots(options) {
  var zone = options.timeZone;
  var now = options.now.setZone(zone);
  var duration = options.durationMinutes;
  var buffer = options.bufferMinutes || 0;
  var startClock = clock(options.workStart);
  var endClock = clock(options.workEnd);
  var weekdays = options.weekdays;
  var lead = options.minLeadMinutes || 0;
  var earliest = now.plus({ minutes: lead });
  var horizon = now.startOf("day").plus({ days: options.horizonDays });
  var busy = options.busy || [];
  var startMinutes = startClock.hour * 60 + startClock.minute;
  var endMinutes = endClock.hour * 60 + endClock.minute;
  /** @type {Interval[]} */
  var slots = [];
  var day = now.startOf("day");

  while (day < horizon) {
    if (weekdays.indexOf(day.weekday) !== -1) {
      if (startMinutes >= 0 && endMinutes <= 24 * 60 && startMinutes < endMinutes) {
        for (var cursor = startMinutes; cursor + duration <= endMinutes; cursor += duration + buffer) {
          var start = uniqueWallTime(day, cursor);
          if (start && start >= earliest && staysOnWallSchedule(start, duration)) {
            var end = start.plus({ minutes: duration });
            if (!overlaps(start, end, busy)) slots.push({ start: start.toUTC(), end: end.toUTC() });
          }
        }
      }
    }
    day = day.plus({ days: 1 });
  }
  return slots;
}

/**
 * @param {Interval[]} slots
 * @param {string} visitorZone
 * @param {number} year
 * @param {number} month
 */
export function monthView(slots, visitorZone, year, month) {
  var cursor = DateTime.fromObject({ year: year, month: month, day: 1 }, { zone: visitorZone });
  if (!cursor.isValid) return [];
  var days = [];
  var count = cursor.daysInMonth;
  for (var day = 1; day <= count; day++) {
    var date = cursor.set({ day: day });
    var key = date.toFormat("yyyy-MM-dd");
    var mine = slots.filter(function (slot) {
      return slot.start.setZone(visitorZone).toFormat("yyyy-MM-dd") === key;
    });
    days.push({
      date: key,
      weekday: date.toFormat("ccc"),
      available: mine.length > 0,
      slots: mine.map(function (slot) {
        return {
          startUtc: slot.start.toISO(),
          endUtc: slot.end.toISO(),
          start: slot.start.setZone(visitorZone).toISO(),
          end: slot.end.setZone(visitorZone).toISO(),
          label: slot.start.setZone(visitorZone).toFormat("h:mm a")
        };
      })
    });
  }
  return days;
}
