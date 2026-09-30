import { DateTime } from "luxon";
import { randomBytes, randomUUID } from "node:crypto";
import { AppError, notFound, slotTaken, unavailable } from "./errors.js";
import { businessSlots, monthView, overlaps } from "./slots.js";
import { asRecord, bookingInput, clean, contactInput } from "./validate.js";
import { log } from "./log.js";

/**
 * @typedef {import("./types.js").Deps} Deps
 * @typedef {import("./types.js").Instant} Instant
 * @typedef {import("./types.js").Interval} Interval
 * @typedef {import("./types.js").Booking} Booking
 * @typedef {import("./types.js").BookingView} BookingView
 * @typedef {import("./types.js").NewBooking} NewBooking
 * @typedef {import("./types.js").NewContact} NewContact
 * @typedef {import("./types.js").EmailState} EmailState
 * @typedef {import("./types.js").EmailStatus} EmailStatus
 * @typedef {import("./types.js").ContactStatus} ContactStatus
 * @typedef {ReturnType<typeof bookingInput>} BookingInput
 * @typedef {ReturnType<typeof contactInput>} ContactInput
 */

/** A claim still PENDING with no calendar event after this long belongs to a crashed request. */
var STALE_CLAIM_MS = 15 * 60 * 1000;

function token() {
  return randomBytes(24).toString("hex");
}

/**
 * Decides what a repeated request with the same Idempotency-Key gets back.
 * @param {Booking} prior
 * @param {BookingInput} input
 */
function replay(prior, input) {
  if (prior.startTime.getTime() !== input.start.toMillis() || prior.name !== input.name || prior.email !== input.email ||
      prior.company !== input.company || prior.phone !== input.phone || prior.message !== input.message ||
      prior.services !== input.services || prior.projectStage !== input.projectStage || prior.budget !== input.budget ||
      prior.timezone !== input.timezone) {
    throw new AppError("IDEMPOTENCY_MISMATCH", 422, "This idempotency key was already used for a different booking request. Please start a new booking.");
  }
  if (prior.status === "CONFIRMED") return { data: present(prior), created: false };
  if (prior.status === "PENDING") {
    throw new AppError("BOOKING_IN_PROGRESS", 409, "Your booking is still being confirmed. Please wait a moment.");
  }
  throw new AppError("IDEMPOTENCY_MISMATCH", 422, "This booking request has already been closed. Please start a new booking.");
}

/** @param {Date} value */
function instant(value) {
  return DateTime.fromJSDate(value).toUTC();
}

/** @param {string} name */
function eventSummary(name) {
  return "NubeTree — Discovery Call — " + name;
}

/**
 * @param {Instant} start
 * @param {string} zone
 */
function whenLabel(start, zone) {
  var local = start.setZone(zone);
  return {
    date: local.toFormat("LLLL d, yyyy"),
    time: local.toFormat("h:mm a")
  };
}

/** @param {BookingView} booking */
export function present(booking) {
  var start = instant(booking.startTime);
  return {
    booking_id: booking.id,
    mode: "live",
    name: booking.name,
    email: booking.email,
    company: booking.company,
    phone: booking.phone,
    timezone: booking.timezone,
    selected_time: start.toISO(),
    services: booking.services ? booking.services.split(", ").filter(Boolean) : [],
    project_stage: booking.projectStage,
    budget: booking.budget,
    project_description: booking.message,
    meeting_link: booking.meetingLink || "",
    cancel_url: "/api/discovery-call/cancel/" + booking.cancelToken,
    reschedule_token: booking.rescheduleToken,
    confirmationEmailStatus: booking.confirmationEmailStatus,
    internalEmailStatus: booking.internalEmailStatus
  };
}

/** @param {Deps} deps */
async function openSlots(deps) {
  var config = deps.config;
  var today = DateTime.now().setZone(config.bookingTimezone).startOf("day");
  if (!today.isValid) throw new AppError("NOT_CONFIGURED", 503, "The booking timezone is not configured correctly.");
  var from = today.toUTC();
  var to = today.plus({ days: config.horizonDays }).toUTC();
  var released = await deps.store.releaseStale(new Date(Date.now() - STALE_CLAIM_MS));
  if (released) log("booking_stale_released", { requestId: deps.requestId, count: released });
  var calendarBusy = await deps.calendar.getBusy(from, to);
  var stored = await deps.store.activeStarts(from, to);
  /** @type {Interval[]} */
  var busy = calendarBusy.slice();
  stored.forEach(function (row) {
    var start = instant(row.start);
    var end = instant(row.end);
    if (start.isValid && end.isValid) busy.push({ start: start, end: end });
  });
  return businessSlots({
    timeZone: config.bookingTimezone,
    now: DateTime.now(),
    durationMinutes: config.durationMinutes,
    bufferMinutes: config.bufferMinutes,
    workStart: config.workStart,
    workEnd: config.workEnd,
    weekdays: config.weekdays,
    minLeadMinutes: config.minLeadMinutes,
    horizonDays: config.horizonDays,
    busy: busy
  });
}

/**
 * @param {Deps} deps
 * @param {{ timezone: string, year: string | null, month: string | null }} query
 */
export async function availability(deps, query) {
  log("availability_request", { requestId: deps.requestId });
  var zone = query.timezone;
  var year = Number(query.year);
  var month = Number(query.month);
  var thisYear = DateTime.utc().year;
  if (!Number.isInteger(year) || !Number.isInteger(month) || year < thisYear - 1 || year > thisYear + 1 || month < 1 || month > 12) {
    throw new AppError("VALIDATION_ERROR", 400, "Please check the highlighted fields.", { month: "Choose a valid month." });
  }
  var slots = await openSlots(deps);
  return {
    timezone: zone,
    businessTimezone: deps.config.bookingTimezone,
    durationMinutes: deps.config.durationMinutes,
    horizonDays: deps.config.horizonDays,
    days: monthView(slots, zone, year, month)
  };
}

/** @param {BookingInput} input */
function eventDescription(input) {
  return [
    "Discovery Call",
    "",
    "Name: " + input.name,
    "Company: " + input.company,
    "Email: " + input.email,
    "Phone: " + (input.phone || ""),
    "",
    "Message:",
    input.message || "",
    "",
    "Source:",
    "NubeTree Website"
  ].join("\n");
}

/**
 * @param {Deps} deps
 * @param {BookingView} booking
 * @param {Instant} start
 * @returns {Promise<EmailState>}
 */
async function mailBooking(deps, booking, start) {
  var when = whenLabel(start, booking.timezone);
  /** @type {EmailStatus} */
  var confirmation = "FAILED";
  /** @type {EmailStatus} */
  var internal = "FAILED";
  try {
    await deps.email.sendBookingConfirmation(booking, when);
    confirmation = "SENT";
    log("email_sent", { requestId: deps.requestId, kind: "booking_confirmation", bookingId: booking.id });
  } catch {
    log("email_failure", { requestId: deps.requestId, kind: "booking_confirmation", bookingId: booking.id });
  }
  try {
    await deps.email.sendInternalBookingNotification(booking, when);
    internal = "SENT";
    log("email_sent", { requestId: deps.requestId, kind: "booking_internal", bookingId: booking.id });
  } catch {
    log("email_failure", { requestId: deps.requestId, kind: "booking_internal", bookingId: booking.id });
  }
  return { confirmation: confirmation, internal: internal };
}

/**
 * @param {Deps} deps
 * @param {unknown} body
 * @param {string} idempotencyKey
 */
export async function book(deps, body, idempotencyKey) {
  log("booking_request", { requestId: deps.requestId });
  var input = bookingInput(body);
  if (deps.config.honeypot && input.honeypot) {
    throw new AppError("VALIDATION_ERROR", 400, "Please check the highlighted fields.");
  }
  if (idempotencyKey) {
    var prior = await deps.store.findByIdempotency(idempotencyKey);
    if (prior) return replay(prior, input);
  }
  var end = input.start.plus({ minutes: deps.config.durationMinutes });
  var slots = await openSlots(deps);
  var open = slots.some(function (slot) {
    return slot.start.toMillis() === input.start.toMillis();
  });
  if (!open) {
    log("booking_conflict", { requestId: deps.requestId });
    throw slotTaken();
  }
  /** @type {NewBooking} */
  var row = {
    id: randomUUID(),
    name: input.name,
    email: input.email,
    company: input.company,
    phone: input.phone,
    message: input.message,
    services: input.services,
    projectStage: input.projectStage,
    budget: input.budget,
    timezone: input.timezone,
    startTime: input.start.toJSDate(),
    endTime: end.toJSDate(),
    slotKey: input.start.toISO(),
    status: "PENDING",
    cancelToken: token(),
    rescheduleToken: token(),
    idempotencyKey: idempotencyKey || null
  };
  var claimed = await deps.store.claim(row);
  if (claimed.id !== row.id) {
    if (idempotencyKey && claimed.idempotencyKey === idempotencyKey) return replay(claimed, input);
    throw slotTaken();
  }
  /** @type {Interval[]} */
  var latestBusy;
  try {
    latestBusy = await deps.calendar.getBusy(input.start, end);
  } catch (error) {
    await deps.store.release(claimed.id).catch(function () {
      log("booking_record_failure", { requestId: deps.requestId, bookingId: claimed.id, step: "release" });
    });
    log("calendar_failure", { requestId: deps.requestId, bookingId: claimed.id, operation: "availability_recheck" });
    throw error instanceof AppError ? error : unavailable();
  }
  if (overlaps(input.start, end, latestBusy)) {
    await deps.store.release(claimed.id).catch(function () {
      log("booking_record_failure", { requestId: deps.requestId, bookingId: claimed.id, step: "release" });
    });
    log("booking_conflict", { requestId: deps.requestId, bookingId: claimed.id, source: "calendar_recheck" });
    throw slotTaken();
  }
  var event;
  try {
    event = await deps.calendar.createEvent({
      requestId: claimed.id,
      summary: eventSummary(input.name),
      description: eventDescription(input),
      start: input.start,
      end: end,
      attendees: [input.email, deps.config.email.internal]
    });
  } catch (error) {
    await deps.store.release(claimed.id).catch(function () {
      log("booking_record_failure", { requestId: deps.requestId, bookingId: claimed.id, step: "release" });
    });
    log("calendar_failure", { requestId: deps.requestId, bookingId: claimed.id });
    throw error instanceof AppError ? error : unavailable();
  }
  try {
    claimed = await deps.store.attachEvent(claimed.id, event);
  } catch (error) {
    await undoEvent(deps, event.id, claimed.id);
    throw error;
  }
  log("calendar_event_created", { requestId: deps.requestId, bookingId: claimed.id });
  var mailed = await mailBooking(deps, Object.assign({}, claimed, {
    meetingLink: event.meetingLink,
    calendarEventId: event.id,
    calendarEventUrl: event.url
  }), input.start);
  var saved;
  try {
    saved = await deps.store.confirm(claimed.id, event, mailed);
  } catch {
    // The calendar event exists, so it remains a real booking; the team fixes the row.
    log("booking_record_failure", { requestId: deps.requestId, bookingId: claimed.id, step: "confirm" });
    saved = Object.assign({}, claimed, { status: /** @type {const} */ ("CONFIRMED"), confirmationEmailStatus: mailed.confirmation, internalEmailStatus: mailed.internal });
  }
  return { data: present(Object.assign({}, saved, { meetingLink: event.meetingLink })), created: true };
}

/**
 * The database could not record the event, so remove it and free the claim rather than leave a
 * calendar entry nobody can cancel.
 * @param {Deps} deps
 * @param {string} eventId
 * @param {string} bookingId
 */
async function undoEvent(deps, eventId, bookingId) {
  log("booking_record_failure", { requestId: deps.requestId, bookingId: bookingId, step: "attach_event" });
  await deps.calendar.cancelEvent(eventId).catch(function () {
    log("calendar_failure", { requestId: deps.requestId, bookingId: bookingId, operation: "undo_event" });
  });
  await deps.store.release(bookingId).catch(function () {});
}

/**
 * @param {Deps} deps
 * @param {string} cancelToken
 */
export async function cancel(deps, cancelToken) {
  var booking = await deps.store.findByCancelToken(cancelToken);
  if (!booking || booking.status !== "CONFIRMED") {
    throw notFound();
  }
  if (booking.calendarEventId) await deps.calendar.cancelEvent(booking.calendarEventId);
  await deps.store.cancel(booking.id);
  try {
    await deps.email.sendCancellation(booking);
    log("email_sent", { requestId: deps.requestId, kind: "cancellation", bookingId: booking.id });
  } catch {
    log("email_failure", { requestId: deps.requestId, kind: "cancellation", bookingId: booking.id });
  }
  return { ok: true };
}

/**
 * @param {Deps} deps
 * @param {unknown} body
 */
export async function reschedule(deps, body) {
  var input = bookingInput(body);
  var fields = asRecord(body);
  var booking = await deps.store.findByRescheduleToken(cleanToken(fields.reschedule_token || fields.rescheduleToken));
  if (!booking || booking.status !== "CONFIRMED" || !booking.calendarEventId) {
    throw notFound();
  }
  var eventId = booking.calendarEventId;
  var end = input.start.plus({ minutes: deps.config.durationMinutes });
  var slots = await openSlots(deps);
  var free = slots.some(function (slot) { return slot.start.toMillis() === input.start.toMillis(); });
  var oldStart = instant(booking.startTime);
  var oldEnd = instant(booking.endTime);
  if (!oldStart.isValid || !oldEnd.isValid) throw notFound();
  if (!free && oldStart.toMillis() !== input.start.toMillis()) throw slotTaken();
  var attendees = [booking.email, deps.config.email.internal];
  await deps.calendar.updateEvent(eventId, {
    summary: eventSummary(booking.name),
    description: "Rescheduled discovery call.",
    start: input.start,
    end: end,
    attendees: attendees
  });
  try {
    var moved = await deps.store.move(booking.id, input.start, end);
    var view = Object.assign({}, moved, { calendarEventUrl: booking.calendarEventUrl });
    var mailed = await mailBooking(deps, view, input.start);
    return present(Object.assign(view, { confirmationEmailStatus: mailed.confirmation, internalEmailStatus: mailed.internal }));
  } catch (error) {
    await deps.calendar.updateEvent(eventId, {
      summary: eventSummary(booking.name),
      description: "Discovery call.",
      start: oldStart,
      end: oldEnd,
      attendees: attendees
    });
    throw error;
  }
}

/** @param {unknown} value */
function cleanToken(value) {
  return String(value || "").replace(/[^a-f0-9]/gi, "").slice(0, 64);
}

/**
 * @param {ContactInput} input
 * @param {ContactStatus} status
 * @param {string | null} key
 * @returns {NewContact}
 */
function contactRow(input, status, key) {
  return {
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email,
    company: input.company,
    phone: input.phone,
    city: input.city,
    state: input.state,
    message: input.message,
    status: status,
    idempotencyKey: key
  };
}

/** Humans take longer than this to fill in the form; faster submissions are treated as bots. */
var CONTACT_MIN_FILL_MS = 2000;
/** The same email and message inside this window counts as a duplicate. */
var CONTACT_DUPLICATE_MS = 10 * 60 * 1000;

/**
 * @param {Deps} deps
 * @param {import("./types.js").ContactSubmission} prior
 * @param {string} reason
 * @returns {{ data: { received: boolean }, created: boolean }}
 */
function contactReplay(deps, prior, reason) {
  if (prior.status === "RECEIVED") {
    throw new AppError("SUBMISSION_IN_PROGRESS", 409, "Your message is still being sent. Please wait a moment.");
  }
  log("contact_duplicate", { requestId: deps.requestId, contactId: prior.id, reason: reason });
  return { data: { received: true }, created: false };
}

/**
 * @param {Deps} deps
 * @param {unknown} body
 * @param {string} [idempotencyKey]
 * @returns {Promise<{ data: { received: boolean }, created: boolean }>}
 */
export async function submitContact(deps, body, idempotencyKey) {
  log("contact_received", { requestId: deps.requestId });
  var fields = asRecord(body);
  var honeypot = clean(fields.website || fields.honeypot, 200);
  if (deps.config.honeypot && honeypot) {
    try {
      var spamInput = contactInput(body);
      await deps.store.saveContact(contactRow(spamInput, "SPAM", null));
    } catch (error) {
      if (!(error instanceof AppError && error.code === "VALIDATION_ERROR")) throw error;
    }
    log("validation_failure", { requestId: deps.requestId, reason: "honeypot" });
    return { data: { received: true }, created: true };
  }
  var input = contactInput(body);
  var key = idempotencyKey || null;
  var tooFast = input.elapsedMs !== null && input.elapsedMs < CONTACT_MIN_FILL_MS;
  if (deps.config.honeypot && tooFast) {
    await deps.store.saveContact(contactRow(input, "SPAM", null));
    log("validation_failure", { requestId: deps.requestId, reason: "too_fast" });
    return { data: { received: true }, created: true };
  }
  if (key) {
    var known = await deps.store.findContactByKey(key);
    if (known) return contactReplay(deps, known, "idempotency_key");
  }
  var recent = await deps.store.findRecentContact(input.email, input.message, new Date(Date.now() - CONTACT_DUPLICATE_MS));
  if (recent) return contactReplay(deps, recent, "same_message");
  var saved = await deps.store.saveContact(contactRow(input, "RECEIVED", key));
  if (!saved) {
    var raced = key ? await deps.store.findContactByKey(key) : null;
    if (raced) return contactReplay(deps, raced, "idempotency_key");
    throw unavailable();
  }
  /** @type {EmailStatus} */
  var internal = "FAILED";
  /** @type {EmailStatus} */
  var ack = "SKIPPED";
  try {
    await deps.email.sendContactNotification(saved);
    internal = "SENT";
    log("email_sent", { requestId: deps.requestId, kind: "contact_internal", contactId: saved.id });
  } catch {
    log("email_failure", { requestId: deps.requestId, kind: "contact_internal", contactId: saved.id });
  }
  if (internal === "SENT" && deps.config.email.acknowledge) {
    try {
      await deps.email.sendContactAcknowledgement(saved);
      ack = "SENT";
      log("email_sent", { requestId: deps.requestId, kind: "contact_acknowledgement", contactId: saved.id });
    } catch {
      ack = "FAILED";
      log("email_failure", { requestId: deps.requestId, kind: "contact_ack", contactId: saved.id });
    }
  }
  if (internal !== "SENT") {
    await deps.store.markContact(saved.id, {
      status: "FAILED",
      internalEmailStatus: internal,
      acknowledgementEmailStatus: ack,
      idempotencyKey: null
    });
    throw new AppError("SERVICE_UNAVAILABLE", 503, "We could not send your message just now. Please try again in a few minutes, or call or email us using the details on this page.");
  }
  await deps.store.markContact(saved.id, {
    status: "PROCESSED",
    internalEmailStatus: internal,
    acknowledgementEmailStatus: ack
  });
  return { data: { received: true }, created: true };
}
