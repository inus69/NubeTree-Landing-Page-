import { DateTime } from "luxon";
import { AppError, notConfigured } from "./errors.js";

/**
 * @typedef {import("./types.js").Config} Config
 * @typedef {import("./types.js").EmailService} EmailService
 * @typedef {import("./types.js").Booking} Booking
 */

/**
 * @typedef {object} Message
 * @property {string} to
 * @property {string} subject
 * @property {string} html
 * @property {string} text
 */

/** @type {Record<string, string>} */
var HTML_ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" };

/** @param {unknown} value */
export function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
    return HTML_ENTITIES[char];
  });
}

/** @param {unknown} value */
function subjectText(value) {
  return String(value == null ? "" : value).replace(/[\r\n\t]+/g, " ").trim().slice(0, 120);
}

/**
 * @param {string} label
 * @param {string | null | undefined} value
 */
function line(label, value) {
  return "<p><strong>" + escapeHtml(label) + "</strong><br>" + escapeHtml(value || "—") + "</p>";
}

/**
 * @param {Config} config
 * @param {typeof fetch} [fetchImpl]
 * @returns {EmailService}
 */
export function createResendEmail(config, fetchImpl) {
  var http = fetchImpl || fetch;
  var site = String(config.siteUrl || "").replace(/\/$/, "");

  /** @param {Booking} booking */
  function cancelUrl(booking) {
    return booking.cancelToken ? site + "/cancel.html?token=" + encodeURIComponent(booking.cancelToken) : "";
  }

  function ready() {
    return Boolean(config.email.apiKey && config.email.from);
  }

  /**
   * @param {Message} message
   * @param {string} idempotencyKey
   */
  async function send(message, idempotencyKey) {
    if (!ready()) throw notConfigured();
    var attempt = 0;
    var ok = false;
    var shouldRetry = true;
    while (attempt < 2) {
      attempt += 1;
      try {
        var res = await http("https://api.resend.com/emails", {
          method: "POST",
          signal: AbortSignal.timeout(10000),
          headers: {
            Authorization: "Bearer " + config.email.apiKey,
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey
          },
          body: JSON.stringify({
            from: config.email.from,
            to: [message.to],
            reply_to: config.email.replyTo,
            subject: subjectText(message.subject),
            html: message.html,
            text: message.text
          })
        });
        ok = res.ok;
        shouldRetry = !res.ok && (res.status >= 500 || res.status === 429);
        if (res.ok || !shouldRetry) break;
      } catch {
        if (attempt === 2) throw new AppError("EMAIL_FAILED", 502, "email");
      }
      if (!ok && shouldRetry && attempt < 2) await new Promise(function (done) { setTimeout(done, 250 * attempt); });
    }
    if (!ok) throw new AppError("EMAIL_FAILED", 502, "email");
  }

  return {
    sendBookingConfirmation: function (booking, when) {
      return send({
        to: booking.email,
        subject: "Your NubeTree Discovery Call is Confirmed",
        html: "<p>Hello " + escapeHtml(booking.name) + ",</p><p>Your discovery call with NubeTree is booked.</p>" +
          line("Company", booking.company) + line("Date", when.date) + line("Time", when.time) + line("Timezone", booking.timezone) +
          (booking.meetingLink ? line("Meeting", booking.meetingLink) : "") +
          (booking.calendarEventUrl ? '<p>Calendar event: <a href="' + escapeHtml(booking.calendarEventUrl) + '">View event</a></p>' : "") +
          "<p>Need to reschedule? Reply to this email and our team will help.</p>" +
          (cancelUrl(booking) ? '<p>Need to cancel? <a href="' + escapeHtml(cancelUrl(booking)) + '">Cancel this call</a>.</p>' : "") +
          "<p>NubeTree<br>hr@nubetree.com</p>",
        text: "Hello " + booking.name + "\n\nYour discovery call is booked.\nCompany: " + booking.company + "\n" + when.date + " " + when.time + " (" + booking.timezone + ")\n" +
          (booking.meetingLink ? "Meeting: " + booking.meetingLink + "\n" : "") +
          (booking.calendarEventUrl ? "Calendar event: " + booking.calendarEventUrl + "\n" : "") +
          "Need to reschedule? Reply to this email and our team will help.\n" +
          (cancelUrl(booking) ? "Cancel: " + cancelUrl(booking) + "\n" : "")
      }, "booking-confirmation-" + booking.id + "-" + booking.startTime.getTime());
    },
    sendInternalBookingNotification: function (booking, when) {
      var team = DateTime.fromJSDate(booking.startTime).setZone(config.bookingTimezone);
      var teamTime = team.isValid ? team.toFormat("LLLL d, yyyy h:mm a") + " (" + config.bookingTimezone + ")" : "";
      var created = DateTime.fromJSDate(booking.createdAt).toUTC();
      var bookingTimestamp = created.isValid ? created.toISO() || "" : "";
      return send({
        to: config.email.internal,
        subject: "New NubeTree Discovery Call — " + booking.name,
        html: line("Name", booking.name) + line("Email", booking.email) + line("Phone", booking.phone) +
          line("Company", booking.company) + line("Team time", teamTime) +
          line("Visitor date", when.date) + line("Visitor time", when.time) +
          line("Visitor timezone", booking.timezone) + line("Message", booking.message) +
          line("Booking timestamp (UTC)", bookingTimestamp) +
          line("Calendar event ID", booking.calendarEventId || "") +
          line("Calendar event link", booking.calendarEventUrl || ""),
        text: [
          "New NubeTree Discovery Call",
          "Name: " + booking.name,
          "Email: " + booking.email,
          "Phone: " + (booking.phone || ""),
          "Company: " + booking.company,
          "Date: " + when.date,
          "Time: " + when.time,
          "Timezone: " + booking.timezone,
          "Message: " + (booking.message || ""),
          "Calendar event ID: " + (booking.calendarEventId || ""),
          "Calendar event link: " + (booking.calendarEventUrl || ""),
          "Booking timestamp (UTC): " + bookingTimestamp
        ].join("\n")
      }, "booking-internal-" + booking.id + "-" + booking.startTime.getTime());
    },
    sendContactNotification: function (contact) {
      return send({
        to: config.email.internal,
        subject: "New NubeTree inquiry — " + contact.firstName + " " + contact.lastName,
        html: line("Name", contact.firstName + " " + contact.lastName) + line("Email", contact.email) +
          line("Phone", contact.phone) + line("City", contact.city) + line("State", contact.state) +
          line("Company", contact.company) + line("Message", contact.message),
        text: contact.firstName + " " + contact.lastName + "\n" + contact.email + "\n" + contact.message
      }, "contact-internal-" + contact.id);
    },
    sendContactAcknowledgement: function (contact) {
      return send({
        to: contact.email,
        subject: "We received your message — NubeTree",
        html: "<p>Hello " + escapeHtml(contact.firstName) + ",</p><p>We received your message and will get back to you shortly.</p><p>NubeTree</p>",
        text: "Hello " + contact.firstName + "\n\nWe received your message and will get back to you shortly.\n"
      }, "contact-acknowledgement-" + contact.id);
    },
    sendCancellation: function (booking) {
      return send({
        to: booking.email,
        subject: "Your NubeTree Discovery Call was cancelled",
        html: "<p>Hello " + escapeHtml(booking.name) + ",</p><p>Your discovery call has been cancelled. You can book another time on the website.</p>",
        text: "Your NubeTree discovery call has been cancelled."
      }, "booking-cancellation-" + booking.id);
    }
  };
}
