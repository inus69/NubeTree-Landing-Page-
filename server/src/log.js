/** @type {((row: Record<string, unknown>) => void) | null} */
var listener = null;
var SENSITIVE_KEY = /(?:authorization|api.?key|secret|refresh.?token|access.?token|password|credential|token|email|phone|message|name|company|city|state|address|postal|zip|ip|recipient|payment|card|ssn)/i;

/**
 * @param {unknown} value
 * @returns {unknown}
 */
function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  var source = /** @type {Record<string, unknown>} */ (value);
  /** @type {Record<string, unknown>} */
  var clean = {};
  Object.keys(source).forEach(function (key) {
    if (!SENSITIVE_KEY.test(key)) clean[key] = redact(source[key]);
  });
  return clean;
}

/** @param {((row: Record<string, unknown>) => void) | null} next */
export function setLogListener(next) {
  listener = next;
}

/**
 * @param {string} event
 * @param {Record<string, unknown>} [fields]
 */
export function log(event, fields) {
  var row = /** @type {Record<string, unknown>} */ (redact(Object.assign({ event: event, at: new Date().toISOString() }, fields || {})));
  console.log(JSON.stringify(row));
  if (listener) {
    try {
      listener(row);
    } catch {
      /* A failing listener must never break the request that logged. */
    }
  }
}
