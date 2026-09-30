export class AppError extends Error {
  /**
   * @param {string} code
   * @param {number} status
   * @param {string} message
   * @param {Record<string, string> | null} [fields]
   */
  constructor(code, status, message, fields) {
    super(message);
    this.code = code;
    this.status = status;
    this.fields = fields || null;
    /** Methods for the Allow header of a 405. */
    this.allow = "";
  }
}

/** @param {string} allow */
export function methodNotAllowed(allow) {
  var error = new AppError("METHOD_NOT_ALLOWED", 405, "This method is not allowed here.");
  error.allow = allow;
  return error;
}

/** Missing credentials. The browser learns only that booking is off; the startup log names what is missing. */
export function notConfigured() {
  return new AppError(
    "NOT_CONFIGURED",
    503,
    "Online booking is not available right now. Please contact us and we will find a time."
  );
}

/** A dependency such as the calendar failed or timed out. */
export function unavailable() {
  return new AppError(
    "SERVICE_UNAVAILABLE",
    503,
    "We couldn't reach the scheduling service. Please try again in a few minutes."
  );
}

export function slotTaken() {
  return new AppError("SLOT_UNAVAILABLE", 409, "This time slot is no longer available.");
}

export function notFound() {
  return new AppError("NOT_FOUND", 404, "This booking could not be found.");
}
