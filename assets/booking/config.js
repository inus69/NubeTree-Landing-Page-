/* Live booking. Calendar and email credentials stay on the server. */
window.NT_BOOKING_CONFIG = {
  mode: "live",
  provider: "google",
  source: "website_discovery_call",
  horizonDays: 21,
  endpoints: {
    availability: "/api/discovery-call/availability",
    booking: "/api/discovery-call/book",
    reschedule: "/api/discovery-call/reschedule"
  }
};
