import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { slotTaken } from "../src/errors.js";
import { createServer } from "../src/server.js";
import { loadConfig } from "../src/config.js";

/**
 * @typedef {import("../src/types.js").Store} Store
 * @typedef {import("../src/types.js").Booking} Booking
 * @typedef {import("../src/types.js").ContactSubmission} ContactSubmission
 * @typedef {import("../src/types.js").CalendarProvider} CalendarProvider
 * @typedef {import("../src/types.js").EmailService} EmailService
 * @typedef {import("../src/types.js").SalesforceService} SalesforceService
 * @typedef {import("../src/types.js").Interval} Interval
 * @typedef {import("../src/types.js").NewCalendarEvent} NewCalendarEvent
 * @typedef {Store & { bookings: Booking[], contacts: ContactSubmission[] }} MemoryStore
 */

/**
 * @typedef {object} ApiResponse
 * @property {boolean} success
 * @property {string} [code]
 * @property {string} [message]
 * @property {Record<string, string>} [fields]
 * @property {{ mode?: string, booking_id?: string, database?: string, confirmationEmailStatus?: string, internalEmailStatus?: string, horizonDays?: number, days?: Array<{ date: string, slots: Array<{ startUtc: string }> }> }} [data]
 */

/**
 * @typedef {object} ServiceOptions
 * @property {Interval[]} [busy]
 * @property {boolean} [failCalendar]
 * @property {boolean} [failEmail]
 */

/** @returns {MemoryStore} */
export function memoryStore() {
  /** @type {Booking[]} */
  var bookings = [];
  /** @type {ContactSubmission[]} */
  var contacts = [];
  /** @type {Array<{ key: string, at: number }>} */
  var hits = [];

  /** @param {string} id */
  function booking(id) {
    var row = bookings.find(function (item) { return item.id === id; });
    if (!row) throw new Error("booking not found");
    return row;
  }

  /** @param {Booking} row */
  function active(row) {
    return row.status === "PENDING" || row.status === "CONFIRMED";
  }

  /**
   * Mirrors the Booking_no_overlap exclusion constraint.
   * @param {string | null} skipId
   * @param {Date} start
   * @param {Date} end
   */
  function overlapsActive(skipId, start, end) {
    return bookings.some(function (item) {
      return item.id !== skipId && active(item) && item.startTime < end && start < item.endTime;
    });
  }

  return {
    bookings: bookings,
    contacts: contacts,
    async findByIdempotency(key) {
      return bookings.find(function (row) { return row.idempotencyKey === key; }) || null;
    },
    async activeStarts(from, to) {
      return bookings.filter(function (row) {
        return active(row) && row.startTime >= from.toJSDate() && row.startTime < to.toJSDate();
      }).map(function (row) { return { start: row.startTime, end: row.endTime }; });
    },
    async claim(row) {
      var prior = row.idempotencyKey ? bookings.find(function (item) { return item.idempotencyKey === row.idempotencyKey; }) : undefined;
      if (prior) return prior;
      if (bookings.some(function (item) { return item.slotKey === row.slotKey && active(item); })) throw slotTaken();
      if (overlapsActive(null, row.startTime, row.endTime)) throw slotTaken();
      /** @type {Booking} */
      var saved = Object.assign({
        calendarEventId: null,
        calendarEventUrl: null,
        confirmationEmailStatus: /** @type {const} */ ("PENDING"),
        internalEmailStatus: /** @type {const} */ ("PENDING"),
        createdAt: new Date(),
        updatedAt: new Date()
      }, row);
      bookings.push(saved);
      return saved;
    },
    async attachEvent(id, event) {
      var row = booking(id);
      row.calendarEventId = event.id;
      row.calendarEventUrl = event.url || "";
      return row;
    },
    async confirm(id, event, emailState) {
      var row = booking(id);
      row.status = "CONFIRMED";
      row.calendarEventId = event.id;
      row.calendarEventUrl = event.url || "";
      row.confirmationEmailStatus = emailState.confirmation;
      row.internalEmailStatus = emailState.internal;
      return row;
    },
    async release(id) {
      var row = booking(id);
      row.status = "FAILED";
      row.slotKey = null;
      row.idempotencyKey = null;
      return row;
    },
    async releaseStale(before) {
      var stale = bookings.filter(function (item) {
        return item.status === "PENDING" && !item.calendarEventId && item.createdAt < before;
      });
      stale.forEach(function (item) {
        item.status = "FAILED";
        item.slotKey = null;
        item.idempotencyKey = null;
      });
      return stale.length;
    },
    async findByCancelToken(token) {
      return bookings.find(function (item) { return item.cancelToken === token; }) || null;
    },
    async findByRescheduleToken(token) {
      return bookings.find(function (item) { return item.rescheduleToken === token; }) || null;
    },
    async cancel(id) {
      var row = booking(id);
      row.status = "CANCELLED";
      row.slotKey = null;
      return row;
    },
    async move(id, start, end) {
      var row = booking(id);
      var key = start.toISO();
      if (bookings.some(function (item) { return item.id !== id && item.slotKey === key; })) throw slotTaken();
      if (overlapsActive(id, start.toJSDate(), end.toJSDate())) throw slotTaken();
      row.startTime = start.toJSDate();
      row.endTime = end.toJSDate();
      row.slotKey = key;
      return row;
    },
    async saveContact(row) {
      if (row.idempotencyKey && contacts.some(function (item) { return item.idempotencyKey === row.idempotencyKey; })) return null;
      /** @type {ContactSubmission} */
      var saved = Object.assign({
        id: randomUUID(),
        internalEmailStatus: /** @type {const} */ ("PENDING"),
        acknowledgementEmailStatus: /** @type {const} */ ("PENDING"),
        createdAt: new Date(),
        updatedAt: new Date()
      }, row);
      contacts.push(saved);
      return saved;
    },
    async markContact(id, data) {
      var row = contacts.find(function (item) { return item.id === id; });
      if (!row) throw new Error("contact not found");
      return Object.assign(row, data);
    },
    async findContactByKey(key) {
      return contacts.find(function (item) { return item.idempotencyKey === key; }) || null;
    },
    async findRecentContact(email, message, since) {
      var matches = contacts.filter(function (item) {
        return item.email === email && item.message === message && item.createdAt >= since &&
          (item.status === "RECEIVED" || item.status === "PROCESSED");
      });
      return matches.length ? matches[matches.length - 1] : null;
    },
    async ping() {
      return "ok";
    },
    async disconnect() {},
    async hitRate(key, max, windowSeconds) {
      var since = Date.now() - windowSeconds * 1000;
      var recent = hits.filter(function (hit) { return hit.key === key && hit.at >= since; });
      if (recent.length >= max) return false;
      hits.push({ key: key, at: Date.now() });
      return true;
    }
  };
}

/** @param {ServiceOptions} [options] */
export function recordingServices(options) {
  /** @type {ServiceOptions} */
  var settings = options || {};
  /** @type {Array<NewCalendarEvent | { cancelled: string }>} */
  var events = [];
  /** @type {string[]} */
  var emails = [];
  /** @param {string} kind */
  async function mail(kind) {
    if (settings.failEmail) throw new Error("email down");
    emails.push(kind);
  }
  /** @type {CalendarProvider} */
  var calendar = {
    async getBusy() {
      return settings.busy || [];
    },
    async createEvent(event) {
      if (settings.failCalendar) throw new Error("calendar down");
      events.push(event);
      return { id: "evt-" + events.length, url: "https://calendar.google.com/calendar/event?eid=test", meetingLink: "https://meet.example/nubetree" };
    },
    async updateEvent() { return { id: "evt", url: "", meetingLink: "" }; },
    async cancelEvent(id) { events.push({ cancelled: id }); }
  };
  /** @type {EmailService} */
  var email = {
    sendBookingConfirmation: function () { return mail("confirm"); },
    sendInternalBookingNotification: function () { return mail("internal"); },
    sendContactNotification: function () { return mail("contact"); },
    sendContactAcknowledgement: function () { return mail("ack"); },
    sendCancellation: function () { return mail("cancel"); }
  };
  return { calendar: calendar, email: email, events: events, emails: emails, settings: settings };
}

/**
 * @param {Record<string, string>} env
 * @param {{ store?: MemoryStore, serveStatic?: boolean, services?: ServiceOptions, salesforce?: SalesforceService }} [options]
 */
export function listen(env, options) {
  var settings = options || {};
  var store = settings.store || memoryStore();
  var services = recordingServices(settings.services);
  var server = createServer({
    config: loadConfig(Object.assign({ PORT: "0", NEXT_PUBLIC_SITE_URL: "http://127.0.0.1" }, env)),
    store: store,
    calendar: services.calendar,
    email: services.email,
    salesforce: settings.salesforce,
    root: resolve(import.meta.dirname, "../.."),
    serveStatic: settings.serveStatic !== false
  });
  return new Promise(function (done) {
    server.listen(0, "127.0.0.1", function () {
      var address = server.address();
      var port = address && typeof address === "object" ? address.port : 0;
      done({
        server: server,
        store: store,
        port: port,
        origin: "http://127.0.0.1:" + port,
        events: services.events,
        emails: services.emails,
        services: services.settings
      });
    });
  });
}

/**
 * @param {number} port
 * @param {string} method
 * @param {string} path
 * @param {unknown} [body]
 * @param {Record<string, string>} [headers]
 */
export async function call(port, method, path, body, headers) {
  var res = await fetch("http://127.0.0.1:" + port + path, {
    method: method,
    headers: Object.assign({ Origin: "http://127.0.0.1:" + port, "Content-Type": "application/json" }, headers || {}),
    body: body ? JSON.stringify(body) : undefined
  });
  // The server's JSON is untyped at this boundary; each test asserts the fields it reads.
  var json = /** @type {ApiResponse} */ (await res.json());
  return { status: res.status, json: json };
}
