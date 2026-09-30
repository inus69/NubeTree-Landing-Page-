/**
 * @typedef {Record<string, unknown>} LogRow
 * @typedef {object} AlertOptions
 * @property {string} url
 * @property {string} [site]
 * @property {number} [cooldownMs]
 * @property {typeof fetch} [fetchImpl]
 * @property {() => number} [now]
 * @property {(event: string, fields: Record<string, unknown>) => void} [onFailure]
 * @typedef {object} Alerter
 * @property {(row: LogRow) => void} notify
 * @property {(timeoutMs: number) => Promise<void>} flush
 */

export var ALERT_EVENTS = new Set([
  "uncaught_exception",
  "unhandled_rejection",
  "server_error",
  "email_failure",
  "calendar_failure",
  "booking_record_failure"
]);

var DETAIL_FIELDS = ["kind", "operation", "step", "status", "error", "requestId", "bookingId", "contactId", "signal"];

/**
 * @param {LogRow} row
 * @param {string} site
 * @param {number} suppressed
 */
function messageFor(row, site, suppressed) {
  var details = DETAIL_FIELDS
    .filter(function (name) { return row[name] != null && row[name] !== ""; })
    .map(function (name) { return name + "=" + String(row[name]); });
  var text = "[NubeTree] " + String(row.event) + (site ? " on " + site : "") + " at " + String(row.at);
  if (details.length) text += "\n" + details.join(" ");
  if (suppressed) text += "\n" + suppressed + " more of this alert were held back in the last few minutes.";
  return text;
}

/**
 * Posts chosen log events to a Slack, Discord, or Teams style incoming webhook.
 * @param {AlertOptions} options
 * @returns {Alerter}
 */
export function createAlerter(options) {
  var http = options.fetchImpl || fetch;
  var now = options.now || Date.now;
  var cooldown = options.cooldownMs == null ? 300000 : options.cooldownMs;
  var site = options.site || "";
  /** @type {Map<string, { sentAt: number, suppressed: number }>} */
  var recent = new Map();
  /** @type {Set<Promise<void>>} */
  var pending = new Set();

  /** @param {string} text */
  function post(text) {
    var request = http(options.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text, content: text }),
      signal: AbortSignal.timeout(5000)
    }).then(function (res) {
      if (!res.ok && options.onFailure) options.onFailure("alert_failure", { status: res.status });
    }, function (error) {
      if (options.onFailure) options.onFailure("alert_failure", { error: error instanceof Error ? error.name : "unknown" });
    });
    pending.add(request);
    request.finally(function () { pending.delete(request); });
  }

  return {
    notify: function (row) {
      var event = String(row.event);
      if (!options.url || !ALERT_EVENTS.has(event)) return;
      var seen = recent.get(event);
      var at = now();
      if (seen && at - seen.sentAt < cooldown) {
        seen.suppressed += 1;
        return;
      }
      recent.set(event, { sentAt: at, suppressed: 0 });
      post(messageFor(row, site, seen ? seen.suppressed : 0));
    },
    flush: function (timeoutMs) {
      if (!pending.size) return Promise.resolve();
      var waitAll = Promise.all(Array.from(pending)).then(function () {});
      var timer = new Promise(function (done) { setTimeout(done, timeoutMs).unref(); });
      return Promise.race([waitAll, timer]).then(function () {});
    }
  };
}
