/** @typedef {Record<string, string | undefined>} EnvSource */

/**
 * @param {EnvSource} source
 * @param {string} name
 * @param {number} fallback
 */
function numberFrom(source, name, fallback) {
  var value = source[name];
  if (value == null || value === "") return fallback;
  var parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** @param {EnvSource} [env] */
export function loadConfig(env) {
  var source = env || process.env;
  var weekdays = source.BOOKING_WEEKDAYS
    ? source.BOOKING_WEEKDAYS.split(",").map(function (part) { return Number(part.trim()); }).filter(function (n) { return n >= 1 && n <= 7; })
    : [1, 2, 3, 4, 5];
  return {
    port: numberFrom(source, "PORT", 5500),
    host: source.HOST || "127.0.0.1",
    trustProxy: source.VERCEL === "1" || source.TRUST_PROXY === "true",
    siteUrl: source.NEXT_PUBLIC_SITE_URL || (source.VERCEL_URL ? "https://" + source.VERCEL_URL : "http://127.0.0.1:5500"),
    bookingTimezone: source.BOOKING_TIMEZONE || "America/New_York",
    durationMinutes: numberFrom(source, "BOOKING_DURATION_MINUTES", 30),
    bufferMinutes: numberFrom(source, "BOOKING_BUFFER_MINUTES", 0),
    horizonDays: numberFrom(source, "BOOKING_HORIZON_DAYS", 21),
    minLeadMinutes: numberFrom(source, "BOOKING_MIN_LEAD_MINUTES", 60),
    workStart: source.BOOKING_WORK_START || "09:00",
    workEnd: source.BOOKING_WORK_END || "17:00",
    weekdays: weekdays.length ? weekdays : [1, 2, 3, 4, 5],
    calendar: {
      provider: source.CALENDAR_PROVIDER || "google",
      clientId: source.CALENDAR_CLIENT_ID || "",
      clientSecret: source.CALENDAR_CLIENT_SECRET || "",
      refreshToken: source.CALENDAR_REFRESH_TOKEN || "",
      calendarId: source.CALENDAR_ID || "",
      webhookSecret: source.CALENDAR_WEBHOOK_SECRET || ""
    },
    email: {
      provider: source.EMAIL_PROVIDER || "resend",
      apiKey: source.EMAIL_API_KEY || "",
      from: source.EMAIL_FROM || "",
      replyTo: source.EMAIL_REPLY_TO || source.INTERNAL_NOTIFICATION_EMAIL || "hr@nubetree.com",
      internal: source.INTERNAL_NOTIFICATION_EMAIL || "hr@nubetree.com",
      acknowledge: source.EMAIL_ACKNOWLEDGE !== "false"
    },
    salesforce: {
      loginUrl: source.SALESFORCE_LOGIN_URL || "https://login.salesforce.com",
      clientId: source.SALESFORCE_CLIENT_ID || "",
      clientSecret: source.SALESFORCE_CLIENT_SECRET || "",
      externalIdField: source.SALESFORCE_EXTERNAL_ID_FIELD || "Website_External_Id__c",
      apiVersion: source.SALESFORCE_API_VERSION || "61.0",
      required: source.NODE_ENV === "production" || source.SALESFORCE_REQUIRED === "true"
    },
    rateLimit: {
      max: numberFrom(source, "RATE_LIMIT_MAX_REQUESTS", 8),
      availabilityMax: numberFrom(source, "RATE_LIMIT_AVAILABILITY_MAX", 60),
      windowSeconds: numberFrom(source, "RATE_LIMIT_WINDOW_SECONDS", 600)
    },
    honeypot: source.HONEYPOT_ENABLED !== "false",
    alertWebhookUrl: source.ALERT_WEBHOOK_URL || "",
    turnstileSecret: source.TURNSTILE_SITE_KEY ? source.TURNSTILE_SECRET || "" : "",
    turnstileSiteKey: source.TURNSTILE_SECRET ? source.TURNSTILE_SITE_KEY || "" : ""
  };
}
