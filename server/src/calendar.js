import { DateTime } from "luxon";
import { notConfigured, unavailable } from "./errors.js";
import { asRecord } from "./validate.js";
import { log } from "./log.js";

/**
 * @typedef {import("./types.js").Config} Config
 * @typedef {import("./types.js").CalendarProvider} CalendarProvider
 * @typedef {import("./types.js").CalendarEvent} CalendarEvent
 * @typedef {import("./types.js").CalendarEventInput} CalendarEventInput
 * @typedef {import("./types.js").Interval} Interval
 */

/**
 * @param {Config} config
 * @param {typeof fetch} [fetchImpl]
 * @returns {CalendarProvider}
 */
export function createGoogleCalendar(config, fetchImpl) {
  var http = fetchImpl || fetch;
  var cache = { token: "", expires: 0 };

  function ready() {
    var calendar = config.calendar;
    return Boolean(calendar.clientId && calendar.clientSecret && calendar.refreshToken && calendar.calendarId);
  }

  /**
   * Every Google call gets a deadline, so a hung request cannot hold a booking open.
   * @param {string} operation
   * @param {string} url
   * @param {RequestInit} init
    * @param {boolean} [retryTransient]
   */
    async function call(operation, url, init, retryTransient) {
    var attempts = retryTransient ? 2 : 1;
    for (var attempt = 0; attempt < attempts; attempt += 1) {
      try {
        var response = await http(url, Object.assign({}, init, { signal: AbortSignal.timeout(10000) }));
        if (attempt + 1 < attempts && (response.status === 429 || response.status >= 500)) {
          await new Promise(function (done) { setTimeout(done, 250 * (attempt + 1)); });
          continue;
        }
        return response;
      } catch {
        if (attempt + 1 < attempts) {
          await new Promise(function (done) { setTimeout(done, 250 * (attempt + 1)); });
          continue;
        }
        throw failed(operation, 0);
      }
    }
    throw failed(operation, 0);
  }

  async function token() {
    if (!ready()) throw notConfigured();
    if (cache.token && cache.expires > Date.now() + 15000) return cache.token;
    var body = new URLSearchParams({
      client_id: config.calendar.clientId,
      client_secret: config.calendar.clientSecret,
      refresh_token: config.calendar.refreshToken,
      grant_type: "refresh_token"
    });
    var res = await call("token", "https://oauth2.googleapis.com/token", { method: "POST", body: body }, true);
    if (!res.ok) throw failed("token", res.status);
    var json = asRecord(await res.json());
    if (typeof json.access_token !== "string") throw failed("token", res.status);
    cache.token = json.access_token;
    cache.expires = Date.now() + (Number(json.expires_in) || 3000) * 1000;
    return cache.token;
  }

  /**
   * @param {string} url
   * @param {{ method: string, body?: string }} options
   * @param {boolean} [retry]
   * @returns {Promise<Response>}
   */
  async function authed(url, options, retry) {
    var access = await token();
    var headers = { Authorization: "Bearer " + access, "Content-Type": "application/json" };
    var method = options.method.toUpperCase();
    var safeToRetry = method === "GET" || method === "PATCH" || method === "DELETE" || url.endsWith("/freeBusy");
    var res = await call("request", url, Object.assign({}, options, { headers: headers }), safeToRetry);
    if (res.status === 401 && !retry) {
      cache.token = "";
      return authed(url, options, true);
    }
    return res;
  }

  return {
    async getBusy(from, to) {
      var id = config.calendar.calendarId;
      var res = await authed("https://www.googleapis.com/calendar/v3/freeBusy", {
        method: "POST",
        body: JSON.stringify({ timeMin: from.toISO(), timeMax: to.toISO(), items: [{ id: id }] })
      });
      if (!res.ok) throw failed("freebusy", res.status);
      var calendars = asRecord(asRecord(await res.json()).calendars);
      var busy = asRecord(calendars[id]).busy;
      /** @type {Interval[]} */
      var intervals = [];
      (Array.isArray(busy) ? busy : []).forEach(function (item) {
        var start = DateTime.fromISO(String(asRecord(item).start)).toUTC();
        var end = DateTime.fromISO(String(asRecord(item).end)).toUTC();
        if (start.isValid && end.isValid) intervals.push({ start: start, end: end });
      });
      return intervals;
    },
    async createEvent(event) {
      var id = encodeURIComponent(config.calendar.calendarId);
      var payload = eventBody(event);
      var res = await authed("https://www.googleapis.com/calendar/v3/calendars/" + id + "/events?sendUpdates=none&conferenceDataVersion=1", {
        method: "POST",
        body: JSON.stringify(Object.assign({}, payload, {
          conferenceData: { createRequest: { requestId: event.requestId, conferenceSolutionKey: { type: "hangoutsMeet" } } }
        }))
      });
      if (res.status === 400) {
        res = await authed("https://www.googleapis.com/calendar/v3/calendars/" + id + "/events?sendUpdates=none", {
          method: "POST",
          body: JSON.stringify(payload)
        });
      }
      if (!res.ok) throw failed("create_event", res.status);
      return eventResult(await res.json());
    },
    async updateEvent(eventId, event) {
      var id = encodeURIComponent(config.calendar.calendarId);
      var res = await authed("https://www.googleapis.com/calendar/v3/calendars/" + id + "/events/" + encodeURIComponent(eventId) + "?sendUpdates=none", {
        method: "PATCH",
        body: JSON.stringify(eventBody(event))
      });
      if (!res.ok) throw failed("update_event", res.status);
      return eventResult(await res.json());
    },
    async cancelEvent(eventId) {
      var id = encodeURIComponent(config.calendar.calendarId);
      var res = await authed("https://www.googleapis.com/calendar/v3/calendars/" + id + "/events/" + encodeURIComponent(eventId) + "?sendUpdates=none", {
        method: "DELETE"
      });
      if (!res.ok && res.status !== 404 && res.status !== 410) throw failed("cancel_event", res.status);
    }
  };
}

/**
 * @param {string} operation
 * @param {number} status
 */
function failed(operation, status) {
  log("calendar_failure", { operation: operation, status: status });
  return unavailable();
}

/** @param {CalendarEventInput} event */
function eventBody(event) {
  return {
    summary: event.summary,
    description: event.description,
    start: { dateTime: event.start.toISO(), timeZone: "UTC" },
    end: { dateTime: event.end.toISO(), timeZone: "UTC" },
    attendees: event.attendees.filter(Boolean).map(function (email) { return { email: email }; })
  };
}

/**
 * @param {unknown} raw
 * @returns {CalendarEvent}
 */
function eventResult(raw) {
  var json = asRecord(raw);
  var link = typeof json.hangoutLink === "string" ? json.hangoutLink : "";
  var points = asRecord(json.conferenceData).entryPoints;
  if (!link && Array.isArray(points)) {
    var video = points.map(asRecord).filter(function (point) { return point.entryPointType === "video"; })[0];
    link = video && typeof video.uri === "string" ? video.uri : "";
  }
  if (typeof json.id !== "string") throw failed("event_result", 200);
  return { id: json.id, url: typeof json.htmlLink === "string" ? json.htmlLink : "", meetingLink: link };
}
