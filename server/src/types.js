/**
 * @typedef {import("luxon").DateTime<true>} Instant
 * @typedef {ReturnType<typeof import("./config.js").loadConfig>} Config
 * @typedef {import("@prisma/client").Booking} Booking
 * @typedef {import("@prisma/client").ContactSubmission} ContactSubmission
 * @typedef {import("@prisma/client").$Enums.EmailStatus} EmailStatus
 * @typedef {import("@prisma/client").$Enums.ContactStatus} ContactStatus
 */

/**
 * @typedef {object} Interval
 * @property {Instant} start
 * @property {Instant} end
 */

/**
 * @typedef {object} StoredInterval
 * @property {Date} start
 * @property {Date} end
 */

/**
 * @typedef {object} NewBooking
 * @property {string} id
 * @property {string} name
 * @property {string} email
 * @property {string} company
 * @property {string} phone
 * @property {string} message
 * @property {string} services
 * @property {string} projectStage
 * @property {string} budget
 * @property {string} timezone
 * @property {Date} startTime
 * @property {Date} endTime
 * @property {string} slotKey
 * @property {"PENDING"} status
 * @property {string} cancelToken
 * @property {string} rescheduleToken
 * @property {string | null} idempotencyKey
 */

/**
 * @typedef {object} NewContact
 * @property {string} firstName
 * @property {string} lastName
 * @property {string} email
 * @property {string} company
 * @property {string} phone
 * @property {string} city
 * @property {string} state
 * @property {string} message
 * @property {ContactStatus} status
 * @property {string | null} idempotencyKey
 */

/**
 * @typedef {object} ContactUpdate
 * @property {ContactStatus} status
 * @property {EmailStatus} internalEmailStatus
 * @property {EmailStatus} acknowledgementEmailStatus
 * @property {null} [idempotencyKey] Cleared after a failure so the visitor can retry with the same key.
 */

/**
 * @typedef {object} EmailState
 * @property {EmailStatus} confirmation
 * @property {EmailStatus} internal
 */

/**
 * @typedef {object} CalendarEventInput
 * @property {string} summary
 * @property {string} description
 * @property {Instant} start
 * @property {Instant} end
 * @property {string[]} attendees
 */

/**
 * @typedef {CalendarEventInput & { requestId: string }} NewCalendarEvent
 */

/**
 * @typedef {object} CalendarEvent
 * @property {string} id
 * @property {string} url
 * @property {string} meetingLink
 */

/**
 * @typedef {object} Store
 * @property {(key: string) => Promise<Booking | null>} findByIdempotency
 * @property {(from: Instant, to: Instant) => Promise<StoredInterval[]>} activeStarts
 * @property {(row: NewBooking) => Promise<Booking>} claim
 * @property {(id: string, event: CalendarEvent, emailState: EmailState) => Promise<Booking>} confirm
 * @property {(id: string, event: CalendarEvent) => Promise<Booking>} attachEvent
 * @property {(id: string) => Promise<Booking>} release
 * @property {(before: Date) => Promise<number>} releaseStale
 * @property {(token: string) => Promise<Booking | null>} findByCancelToken
 * @property {(token: string) => Promise<Booking | null>} findByRescheduleToken
 * @property {(id: string) => Promise<Booking>} cancel
 * @property {(id: string, start: Instant, end: Instant) => Promise<Booking>} move
 * @property {(row: NewContact) => Promise<ContactSubmission | null>} saveContact Null when the idempotency key is already stored.
 * @property {(key: string) => Promise<ContactSubmission | null>} findContactByKey
 * @property {(email: string, message: string, since: Date) => Promise<ContactSubmission | null>} findRecentContact
 * @property {(id: string, data: ContactUpdate) => Promise<ContactSubmission>} markContact
 * @property {() => Promise<string>} ping
 * @property {() => Promise<void>} disconnect
 * @property {(key: string, max: number, windowSeconds: number) => Promise<boolean>} hitRate
 */

/**
 * @typedef {object} CalendarProvider
 * @property {(from: Instant, to: Instant) => Promise<Interval[]>} getBusy
 * @property {(event: NewCalendarEvent) => Promise<CalendarEvent>} createEvent
 * @property {(eventId: string, event: CalendarEventInput) => Promise<CalendarEvent>} updateEvent
 * @property {(eventId: string) => Promise<void>} cancelEvent
 */

/**
 * @typedef {object} WhenLabel
 * @property {string} date
 * @property {string} time
 */

/**
 * @typedef {Booking & { meetingLink?: string }} BookingView
 */

/**
 * @typedef {object} EmailService
 * @property {(booking: BookingView, when: WhenLabel) => Promise<void>} sendBookingConfirmation
 * @property {(booking: BookingView, when: WhenLabel) => Promise<void>} sendInternalBookingNotification
 * @property {(contact: ContactSubmission) => Promise<void>} sendContactNotification
 * @property {(contact: ContactSubmission) => Promise<void>} sendContactAcknowledgement
 * @property {(booking: Booking) => Promise<void>} sendCancellation
 */

/**
 * @typedef {object} SalesforceService
 * @property {() => boolean} configured
 * @property {() => boolean} required
 * @property {(contact: ContactSubmission) => Promise<void>} upsertContact
 * @property {(booking: Booking) => Promise<void>} upsertBooking
 */

/**
 * @typedef {object} Deps
 * @property {Config} config
 * @property {Store} store
 * @property {CalendarProvider} calendar
 * @property {EmailService} email
 * @property {SalesforceService} [salesforce]
 * @property {string} [requestId]
 * @property {string} [root]
 * @property {boolean} [serveStatic]
 */

export {};
