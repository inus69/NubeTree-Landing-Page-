import { DateTime } from "luxon";
import { AppError } from "./errors.js";

// The HTML standard's email pattern, plus a required dot and a 2+ letter top-level domain.
var EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/;
/**
 * Control characters (except tab and line breaks), zero-width characters, and bidirectional
 * overrides that can disguise text.
 * @param {number} code
 */
function invisible(code) {
  if (code === 9 || code === 10 || code === 13) return false;
  return code < 32 || (code >= 0x7f && code <= 0x9f) || (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069) || code === 0xfeff;
}

/** @param {unknown} value */
function raw(value) {
  if (typeof value === "string") {
    return Array.from(value).filter(function (char) { return !invisible(char.codePointAt(0) || 0); }).join("");
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

/** Choices offered by the booking form in assets/booking/booking.js. */
export var BOOKING_CHOICES = {
  services: ["Custom Software Development", "Salesforce Development", "Salesforce Integration", "AI & Automation", "Web Application Development", "UI/UX & Product Design", "API / System Integration", "Other"],
  stages: ["Idea / Planning", "MVP", "Existing Product", "Scaling", "Modernization", "Enterprise System", "Other"],
  budgets: ["Under $10K", "$10K – $25K", "$25K – $50K", "$50K – $100K", "$100K+", "Not Sure Yet"]
};

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
export function asRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return /** @type {Record<string, unknown>} */ (value);
}

/**
 * @param {unknown} value
 * @param {number} max
 */
export function clean(value, max) {
  return raw(value).replace(/\s+/g, " ").trim().slice(0, max);
}

/** @param {unknown} value */
export function assertZone(value) {
  var zone = clean(value, 80);
  if (!zone || !DateTime.now().setZone(zone).isValid) {
    throw new AppError("VALIDATION_ERROR", 400, "Please check the highlighted fields.", { timezone: "Choose a valid timezone." });
  }
  return zone;
}

/** @param {unknown} value */
export function assertInstant(value) {
  var parsed = DateTime.fromISO(String(value || ""), { setZone: true });
  if (!parsed.isValid) {
    throw new AppError("VALIDATION_ERROR", 400, "Please check the highlighted fields.", { startTime: "Choose a valid time." });
  }
  return parsed.toUTC();
}

/** @param {unknown} value */
function assertBody(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError("VALIDATION_ERROR", 400, "Please check the highlighted fields.");
  }
  return asRecord(value);
}

/** The booking form mirrors these limits in assets/booking/booking.js. */
export var BOOKING_LIMITS = { name: 120, email: 160, company: 160, phone: 40, message: 4000 };

var PHONE_CHARS = /^\+?[0-9 ()./-]+$/;
var DATE = /^\d{4}-\d{2}-\d{2}$/;

/** @param {unknown} value */
function text(value) {
  return raw(value).replace(/\s+/g, " ").trim();
}

/**
 * Keeps paragraph breaks (at most one blank line) and collapses other whitespace.
 * @param {unknown} value
 */
function paragraphs(value) {
  return raw(value).replace(/\r\n?/g, "\n").replace(/[^\S\n]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Empty is allowed; a provided number needs 7–15 digits (the E.164 maximum).
 * @param {string} phone
 */
export function phoneProblem(phone) {
  if (!phone) return "";
  var digits = phone.replace(/\D/g, "").length;
  if (!PHONE_CHARS.test(phone) || digits < 7 || digits > 15) return "Please enter a valid phone number, or leave it blank.";
  return "";
}

/** @param {unknown} input */
export function bookingInput(input) {
  var body = assertBody(input);
  var name = text(body.name);
  var email = text(body.email).toLowerCase();
  var company = text(body.company);
  var phone = text(body.phone);
  var message = paragraphs(body.project_description || body.message || body.description);
  var hasServices = body.services !== undefined && body.services !== null;
  var picked = Array.isArray(body.services) ? body.services.map(function (item) { return clean(item, 80); }).filter(Boolean) : [];
  var services = BOOKING_CHOICES.services.filter(function (option) { return picked.indexOf(option) !== -1; });
  var unknownService = picked.some(function (item) { return BOOKING_CHOICES.services.indexOf(item) === -1; });
  var stageValue = body.project_stage || body.projectStage;
  var stage = clean(stageValue, 80);
  var budget = clean(body.budget, 80);
  var selectedDate = clean(body.selected_date || body.selectedDate, 20);
  /** @type {Record<string, string>} */
  var fields = {};
  if (name.length < 2) fields.name = "Please enter your name.";
  else if (name.length > BOOKING_LIMITS.name) fields.name = "Please keep your name under " + BOOKING_LIMITS.name + " characters.";
  if (email.length > BOOKING_LIMITS.email || !EMAIL.test(email)) fields.email = "Please enter a valid work email.";
  if (company.length < 2) fields.company = "Please enter your company.";
  else if (company.length > BOOKING_LIMITS.company) fields.company = "Please keep the company name under " + BOOKING_LIMITS.company + " characters.";
  if (phone.length > BOOKING_LIMITS.phone || phoneProblem(phone)) fields.phone = "Please enter a valid phone number, or leave it blank.";
  if (message.length > BOOKING_LIMITS.message) fields.message = "Please keep project details under " + BOOKING_LIMITS.message + " characters.";
  if (hasServices && (!Array.isArray(body.services) || !services.length || unknownService)) fields.services = "Select at least one service from the list.";
  if (stageValue != null && stageValue !== "" && BOOKING_CHOICES.stages.indexOf(stage) === -1) fields.projectStage = "Select a project stage.";
  if (body.budget != null && body.budget !== "" && BOOKING_CHOICES.budgets.indexOf(budget) === -1) fields.budget = "Select an estimated budget.";
  if (Object.keys(fields).length) {
    throw new AppError("VALIDATION_ERROR", 400, "Please check the highlighted fields.", fields);
  }
  var timezone = assertZone(body.timezone);
  var start = assertInstant(body.selected_time || body.selectedTime || body.startTime);
  if (selectedDate && (!DATE.test(selectedDate) || start.setZone(timezone).toFormat("yyyy-MM-dd") !== selectedDate)) {
    throw new AppError("VALIDATION_ERROR", 400, "Please check the highlighted fields.", { startTime: "The selected date and time do not match. Please choose the time again." });
  }
  return {
    name: name,
    email: email,
    company: company,
    phone: phone,
    message: message,
    services: services.join(", "),
    projectStage: stage,
    budget: budget,
    timezone: timezone,
    start: start,
    honeypot: clean(body.website || body.honeypot, 200)
  };
}

/** The contact form mirrors these limits in contact.html and assets/contact/contact-form.js. */
export var CONTACT_LIMITS = { firstName: 80, lastName: 80, email: 160, phone: 40, city: 80, state: 80, company: 160, message: 4000, messageMin: 10 };
var CONTACT_FIELDS = ["firstName", "lastName", "email", "phone", "city", "state", "company", "message", "website", "honeypot", "elapsedMs", "turnstileToken"];

/** @param {unknown} input */
export function contactInput(input) {
  var body = assertBody(input);
  if (Object.keys(body).some(function (key) { return CONTACT_FIELDS.indexOf(key) === -1; })) {
    throw new AppError("VALIDATION_ERROR", 400, "Please check the highlighted fields.");
  }
  var firstName = text(body.firstName);
  var lastName = text(body.lastName);
  var email = text(body.email).toLowerCase();
  var phone = text(body.phone);
  var city = text(body.city);
  var state = text(body.state);
  var company = text(body.company);
  var message = paragraphs(body.message);
  var digits = phone.replace(/\D/g, "").length;
  var elapsed = Number(body.elapsedMs);
  var L = CONTACT_LIMITS;
  /** @type {Record<string, string>} */
  var fields = {};
  if (!firstName) fields.firstName = "Enter a first name";
  else if (firstName.length > L.firstName) fields.firstName = "Keep the first name under " + L.firstName + " characters";
  if (!lastName) fields.lastName = "Enter a last name";
  else if (lastName.length > L.lastName) fields.lastName = "Keep the last name under " + L.lastName + " characters";
  if (!email) fields.email = "Enter an email address";
  else if (email.length > L.email || !EMAIL.test(email)) fields.email = "Enter a valid email address, like name@company.com";
  if (!phone) fields.phone = "Enter a phone number";
  else if (phone.length > L.phone || !PHONE_CHARS.test(phone) || digits < 7 || digits > 15) fields.phone = "Enter a valid phone number with 7 to 15 digits";
  if (!city) fields.city = "Enter a city";
  else if (city.length > L.city) fields.city = "Keep the city under " + L.city + " characters";
  if (!state) fields.state = "Enter a state or province";
  else if (state.length > L.state) fields.state = "Keep the state or province under " + L.state + " characters";
  if (company.length > L.company) fields.company = "Keep the company name under " + L.company + " characters";
  if (message.length < L.messageMin) fields.message = "Enter a message of at least " + L.messageMin + " characters";
  else if (message.length > L.message) fields.message = "Keep the message under " + L.message + " characters";
  if (Object.keys(fields).length) {
    throw new AppError("VALIDATION_ERROR", 400, "Please check the highlighted fields.", fields);
  }
  return {
    firstName: firstName,
    lastName: lastName,
    email: email,
    phone: phone,
    city: city,
    state: state,
    company: company,
    message: message,
    honeypot: clean(body.website || body.honeypot, 200),
    elapsedMs: Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : null
  };
}
