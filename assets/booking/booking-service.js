(function (global) {
  var config = global.NT_BOOKING_CONFIG;

  function pad(n) { return (n < 10 ? "0" : "") + n; }

  function zoneParts(date, timeZone) {
    var dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short"
    });
    var map = {};
    dtf.formatToParts(date).forEach(function (part) {
      if (part.type !== "literal") map[part.type] = part.value;
    });
    if (map.hour === "24") map.hour = "00";
    return map;
  }

  function dateKeyFromParts(parts) {
    return parts.year + "-" + parts.month + "-" + parts.day;
  }

  function fail(res, body, fallback) {
    var error = new Error((body && body.message) || fallback);
    error.code = body && body.code ? body.code : fallback;
    error.fields = body && body.fields ? body.fields : null;
    if (res && res.status === 409 && error.code !== "BOOKING_IN_PROGRESS") error.code = "taken";
    if (res && res.status === 429) error.code = "RATE_LIMITED";
    throw error;
  }

  function getAvailability(query) {
    var url = config.endpoints.availability
      + "?timezone=" + encodeURIComponent(query.timezone)
      + "&year=" + encodeURIComponent(query.year)
      + "&month=" + encodeURIComponent(query.month);
    return fetch(url, { headers: { Accept: "application/json" } }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok || body.success === false) fail(res, body, "availability");
        return body.data || body;
      });
    }).catch(function (error) {
      if (!error.code) error.code = "network";
      throw error;
    });
  }

  function createBooking(payload) {
    var lead = {
      name: payload.name,
      email: payload.email,
      company: payload.company,
      phone: payload.phone || "",
      services: payload.services,
      project_stage: payload.projectStage,
      budget: payload.budget,
      project_description: payload.description || "",
      timezone: payload.timezone,
      selected_date: payload.selectedDate,
      selected_time: payload.selectedTime,
      source: config.source,
      website: payload.website || "",
      turnstileToken: payload.turnstileToken || ""
    };
    var endpoint = payload.rescheduleToken ? config.endpoints.reschedule : config.endpoints.booking;
    if (payload.rescheduleToken) lead.reschedule_token = payload.rescheduleToken;
    var headers = { "Content-Type": "application/json", Accept: "application/json" };
    if (payload.idempotencyKey) headers["Idempotency-Key"] = payload.idempotencyKey;
    return fetch(endpoint, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(lead)
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok || body.success === false) fail(res, body, "booking");
        var data = body.data || body;
        data.mode = "live";
        return data;
      });
    }).catch(function (error) {
      if (!error.code) error.code = "network";
      throw error;
    });
  }

  function cancelBooking(booking) {
    var url = booking.cancel_url;
    if (!url) {
      var missing = new Error("cancel");
      missing.code = "booking";
      return Promise.reject(missing);
    }
    return fetch(url, { method: "DELETE", headers: { Accept: "application/json" } }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok || body.success === false) fail(res, body, "booking");
        return { ok: true };
      });
    }).catch(function (error) {
      if (!error.code) error.code = "network";
      throw error;
    });
  }

  global.ntBookingService = {
    getAvailability: getAvailability,
    createBooking: createBooking,
    cancelBooking: cancelBooking,
    zoneParts: zoneParts,
    dateKeyFromParts: dateKeyFromParts,
    pad: pad
  };
})(window);
