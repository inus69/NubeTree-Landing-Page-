# NubeTree site and booking server

The public pages are static HTML. A Node server in `server/` serves those pages and the booking and contact APIs. The browser never receives calendar or email credentials.

For the repo-side production launch checklist, see [PRODUCTION_LAUNCH_CHECKLIST.md](PRODUCTION_LAUNCH_CHECKLIST.md).
For the live production deployment runbook, see [PRODUCTION_RUNBOOK.md](PRODUCTION_RUNBOOK.md).

## Architecture

The booking and contact forms post to this server. The server validates the request, checks a honeypot and a database rate limit, then:

- Discovery calls read busy time from Google Calendar, remove slots already claimed in PostgreSQL, create the calendar event, store the booking, and send email through Resend.
- Contact submissions are stored, then emailed to `hr@nubetree.com`.

A slot is claimed in the database before the calendar event is created. A second request for the same start time gets `409 SLOT_UNAVAILABLE`. Repeating the same `Idempotency-Key` returns the original booking instead of creating another event.

Calendar free/busy, update, and delete calls retry one transient failure; event creation is never blindly retried. Resend retries transient failures once with a stable provider idempotency key for each logical message. Logs record validation failures and email outcomes without visitor data.

If the confirmation email fails after the calendar event exists, the booking stays. The page says the time is booked and the email did not go out.

## Environment variables

Copy `.env.example` to `.env` in the project root and fill in the values. `.env.example` holds names only. `.env` and every `.env.*` file except the example are git-ignored and excluded from the Docker image. In production, set these through the host's secret or environment settings and leave `.env` off the server.

The site has no frontend build, so no variable reaches the browser by its name alone. The server writes exactly two values into pages: `NEXT_PUBLIC_SITE_URL` and `TURNSTILE_SITE_KEY`. Everything else stays inside the server process. The test "server secrets never reach the browser" starts the server with dummy secrets and checks that none of them appear in pages, scripts, headers, or API responses.

### Public

| Name | Production | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SITE_URL` | Required | Public `https` origin. Used for the same-origin check, share tags, and HSTS |
| `TURNSTILE_SITE_KEY` | Optional | Cloudflare Turnstile site key. Written into pages as a `<meta>` tag when Turnstile is on |

### Private (server only)

| Name | Production | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Required | PostgreSQL connection string, including its password |
| `CALENDAR_CLIENT_ID`, `CALENDAR_CLIENT_SECRET`, `CALENDAR_REFRESH_TOKEN` | Required | Google OAuth credentials for the team calendar |
| `CALENDAR_ID` | Required | Calendar that receives discovery calls |
| `CALENDAR_PROVIDER` | Optional | Default `google` |
| `CALENDAR_WEBHOOK_SECRET` | Optional | Shared secret required on `/api/webhooks/calendar` |
| `EMAIL_API_KEY` | Required | Resend API key |
| `EMAIL_FROM` | Required | Verified from-address on your Resend domain |
| `EMAIL_PROVIDER` | Optional | Default `resend` |
| `EMAIL_REPLY_TO` | Optional | Default is `INTERNAL_NOTIFICATION_EMAIL` |
| `INTERNAL_NOTIFICATION_EMAIL` | Optional | Inbox for new bookings and contact messages. Default `hr@nubetree.com` |
| `EMAIL_ACKNOWLEDGE` | Optional | `false` stops the acknowledgement email to people who use the contact form. Default `true` |
| `SALESFORCE_CLIENT_ID`, `SALESFORCE_CLIENT_SECRET` | Required | Salesforce Connected App client-credentials OAuth. Used only by the server |
| `SALESFORCE_LOGIN_URL` | Optional | Default `https://login.salesforce.com`; use `https://test.salesforce.com` for a sandbox |
| `SALESFORCE_EXTERNAL_ID_FIELD` | Required in Salesforce | Default `Website_External_Id__c`, a unique Text field marked External ID on Lead |
| `SALESFORCE_API_VERSION` | Optional | Default `61.0` |
| `SALESFORCE_REQUIRED` | Local development | Set `true` to require Salesforce locally. Production always requires it |
| `TURNSTILE_SECRET` | Optional | Turnstile secret. Turnstile turns on only when this and `TURNSTILE_SITE_KEY` are both set |
| `PORT` | Optional | Default `5500` |
| `HOST` | Required | Use `0.0.0.0` in a container. Default `127.0.0.1` |
| `TRUST_PROXY` | Required behind a proxy | `true` reads the client IP from `X-Forwarded-For` for rate limits. Default `false` |
| `BOOKING_TIMEZONE` | Confirm | Business hours timezone. Default `America/New_York` |
| `BOOKING_WORK_START`, `BOOKING_WORK_END` | Confirm | Business hours. Default `09:00` and `17:00` |
| `BOOKING_WEEKDAYS` | Optional | `1` is Monday. Default `1,2,3,4,5` |
| `BOOKING_DURATION_MINUTES`, `BOOKING_BUFFER_MINUTES` | Optional | Default `30` and `0` |
| `BOOKING_HORIZON_DAYS`, `BOOKING_MIN_LEAD_MINUTES` | Optional | Default `21` and `60` |
| `RATE_LIMIT_MAX_REQUESTS`, `RATE_LIMIT_WINDOW_SECONDS` | Optional | Booking, reschedule, cancel, and contact requests per IP. Default `8` per `600` seconds |
| `RATE_LIMIT_AVAILABILITY_MAX` | Optional | Calendar availability lookups per IP in the same window. The calendar is the first booking step, so this is higher. Default `60` |
| `HONEYPOT_ENABLED` | Optional | Default `true` |
| `ALERT_WEBHOOK_URL` | Recommended | Slack, Discord, or Teams incoming webhook for failure alerts. See Monitoring. Treat it as a secret: anyone with the URL can post to the channel |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | Local only | Credentials for the local Docker database in `docker-compose.yml` |

Use a separate Google calendar, Resend audience, and database for development. Do not point a local `.env` at the production calendar.

### Salesforce Lead sync

Valid contact submissions and discovery-call bookings upsert the standard Salesforce `Lead` object. Both forms use a SHA-256 key derived from the normalized email address, so a booking enriches the same Lead as an earlier contact inquiry. Each distinct submission is appended to the Lead description without replacing earlier form messages or appointment details. Honeypot and too-fast submissions are not sent. OAuth credentials stay on the server; production form submissions return a retryable error instead of claiming success when Salesforce is unavailable.

In Salesforce, enable the Connected App client-credentials flow and assign a dedicated integration user with API access and read/create/edit access to Leads. Grant read/write access to the Lead description and external-ID field. Add a `Website_External_Id__c` Lead field of type Text (64 characters), mark it **External ID** and **Unique**. Use the field's API name in `SALESFORCE_EXTERNAL_ID_FIELD` if it differs. Set the Connected App client ID and secret in the production host's secret settings.

## Database

```bash
docker compose up -d
cd server
npx prisma migrate deploy
```

The Prisma CLI reads `DATABASE_URL` from the environment and does not load the root `.env`, so export it first (PowerShell: `$env:DATABASE_URL = "..."`).

### Isolated integration-test database

The four PostgreSQL integration checks write and delete test records. Never point them at a production or shared database. Add a separate local URL to the project-root `.env` (the template is in `.env.example`):

```dotenv
TEST_DATABASE_URL=postgresql://postgres:change-me@127.0.0.1:5434/nubetree_test
```

Replace the example credentials with the values used by the local Compose database. URL-encode any reserved characters in the password. On first setup, start the local database and create the empty test database separately from the app database:

```bash
docker compose up -d
docker compose exec db sh -c 'createdb -U "$POSTGRES_USER" nubetree_test'
cd server
npm run db:migrate:test
npm run test:integration
```

The test commands load `TEST_DATABASE_URL` from the project-root `.env`, require a localhost URL and a database name marked as a test database, and use it instead of `DATABASE_URL`. `db:migrate:test` applies the checked-in migrations; it does not reset or drop data. The repository has no database seed script.

Migration `20260929120000_booking_no_overlap` adds two constraints that exist only in SQL: `Booking_no_overlap` makes Postgres refuse any two active (`PENDING` or `CONFIRMED`) bookings whose times overlap, and `Booking_time_order` requires the end to come after the start.

## Calendar

1. Create a Google Cloud OAuth client (web) for the Calendar API.
2. Authorize the team Google account with the scope `https://www.googleapis.com/auth/calendar`.
3. Store the refresh token in `CALENDAR_REFRESH_TOKEN`.
4. Set `CALENDAR_ID` to the calendar that should hold discovery calls, often `primary`.

Until those values are set, availability and booking return `503 NOT_CONFIGURED`. The page does not invent time slots.

## Email

Create a Resend API key and verify `EMAIL_FROM`. Internal notices go to `INTERNAL_NOTIFICATION_EMAIL`.

## Local development

Stop any other process on port 5500, then:

```bash
cd server
npm install
npm start
```

Open `http://127.0.0.1:5500/`. The same process serves the site and `/api/discovery-call/*` and `/api/contact`.

## Booking API

Calendar, email, and database credentials are used only inside the server. The browser talks to these endpoints on the site's own origin:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/discovery-call/availability?timezone=&year=&month=` | Open slots for one month in the visitor's timezone, built from Google free/busy and active bookings |
| `POST /api/discovery-call/book` | Books a slot. JSON body; optional `Idempotency-Key` header |
| `POST /api/discovery-call/reschedule` | Moves a booking, using its reschedule token |
| `POST` or `DELETE /api/discovery-call/cancel/:token` | Cancels a booking |

A booking request runs in this order: rate limit, JSON and size check (20 KB), same-origin check, Turnstile (when configured), input validation and sanitizing, idempotency replay, server-side slot check, database claim (unique slot and overlap constraint, under an advisory lock), calendar event, confirmation and internal emails, then the confirmed record. If the calendar fails, the claim is released. If the database cannot record the event, the event is deleted again.

Every response is JSON: `{ "success": true, "data": ... }` or `{ "success": false, "code", "message", "fields"? }`. Server failures (`5xx`) also carry `requestId`, which matches the `X-Request-Id` header and the log line. Only messages written for visitors are returned; database, network, and provider errors become a generic `500` or `503`, and no stack trace, query, credential, calendar link, or event ID is sent. The booking response holds only what the visitor needs: their own details, the time, the meeting link, and their cancel and reschedule links.

| Status | Code | When |
| --- | --- | --- |
| `200` | | Availability, a replayed booking, a reschedule or cancellation |
| `201` | | A new booking was created |
| `400` | `VALIDATION_ERROR`, `INVALID_JSON`, `SECURITY_CHECK_FAILED` | Bad or missing fields (see `fields`), unreadable JSON, failed Turnstile |
| `403` | `FORBIDDEN` | The request came from another site. Localhost origins are accepted only when `NEXT_PUBLIC_SITE_URL` is itself localhost |
| `404` | `NOT_FOUND` | Unknown booking token or path |
| `405` | `METHOD_NOT_ALLOWED` | Wrong method on a known endpoint. The `Allow` header lists the right one |
| `409` | `SLOT_UNAVAILABLE`, `BOOKING_IN_PROGRESS` | The time is taken, or the same request is still being processed |
| `413` | `PAYLOAD_TOO_LARGE` | Body over 20 KB |
| `415` | `UNSUPPORTED_MEDIA_TYPE` | Body is not `application/json` |
| `422` | `IDEMPOTENCY_MISMATCH` | An `Idempotency-Key` reused for a different time |
| `429` | `RATE_LIMITED` | Too many requests from one IP |
| `500` | `INTERNAL_ERROR` | Anything unexpected. Details go to the log only |
| `503` | `NOT_CONFIGURED`, `SERVICE_UNAVAILABLE` | Credentials are missing, or the calendar failed or took longer than 10 seconds |

Services, project stage, and budget must be one of the options the booking form offers (`BOOKING_CHOICES` in `server/src/validate.js`, mirrored in `assets/booking/booking.js`). Text fields lose control characters, zero-width characters, and direction overrides; project details keep paragraph breaks.

## Testing

```bash
cd server
npm test
```

Tests cover slot rules, validation, a successful booking, a repeated request, a double book, the contact honeypot, rate limiting, which files are public, video byte ranges, compression, caching, and page metadata. They use stand-ins for the database, calendar, and email so they do not call Google or Resend.

The four real-Postgres checks are skipped by `npm test` and run only with `npm run test:integration` after the isolated test database has been migrated.

### Code quality

```bash
cd server
npm run typecheck   # TypeScript in strict mode over the JSDoc-typed server code and tests
npm run lint        # ESLint over the server, browser scripts in assets/, and inline scripts in every page
npm run check       # typecheck, lint, and tests together
npm run qa:browser  # click-through QA of the running site in headless Chrome
```

`qa:browser` needs the server running (`npm start`) and Google Chrome installed. It drives Chrome through a private pipe, with no debugging port, at desktop, tablet, and phone widths. It covers:

- **Navbar:** the logo, the hamburger (mouse, Enter, Close, Escape, and backdrop), every menu link, where each anchor lands, and whether the navbar stays pinned
- **Home page:** every booking CTA, the services pager, CTA, and play button, the case-study arrows, dots, list, and Read more links, the process steps, the audience tabs, and the FAQ
- **Footer:** every link
- **Other pages:** each one loads, the contact form rejects an empty submit, the discovery page opens on the calendar step, and the cancel page explains a missing link
- **Booking flow:** on a private server with an in-memory store and a recording calendar and email, it picks a date and time, checks the details step blocks empty and invalid input, books, confirms the stored UTC time and a single calendar event, and checks that a time taken by someone else mid-flow sends the visitor back to the calendar with a clear message

It fails on any console error or failed request. When the target server has no Google Calendar credentials, availability answers `503 NOT_CONFIGURED`; the runner notes that, checks the page says so and offers Contact Us, and does not count those responses as failures.

With `DATABASE_URL` set, `npm test` also runs `test/booking-postgres.test.js` against that database: racing claims, the overlap constraint, and stale-claim release. It writes only rows dated 2035 and deletes them afterwards. Without `DATABASE_URL` those two tests are skipped. Set `QA_BASE_URL` to test another address. The test "every link on every page goes somewhere real" in `npm test` separately rejects placeholder links, missing pages or anchors, and email or phone links other than the published ones.

Types live in `server/src/types.js` as JSDoc typedefs, so the server stays plain JavaScript with no build step. `eslint.config.js` sits at the project root and loads its plugins from `server/node_modules`, so run `npm install` in `server/` first.

## Production

### Vercel

The repository includes a Vercel static build and a Node function for the existing `/api/*` routes. In Vercel, import the GitHub repository with the project root as the Root Directory; keep the configured install, build, and output settings from `vercel.json`.

Add these private environment variables in Vercel Project Settings before the first build:

- `DATABASE_URL`
- `CALENDAR_CLIENT_ID`, `CALENDAR_CLIENT_SECRET`, `CALENDAR_REFRESH_TOKEN`, `CALENDAR_ID`
- `EMAIL_API_KEY`, `EMAIL_FROM`
- `SALESFORCE_CLIENT_ID`, `SALESFORCE_CLIENT_SECRET`
- `SALESFORCE_EXTERNAL_ID_FIELD` if the Lead external ID field is not `Website_External_Id__c`
- `NEXT_PUBLIC_SITE_URL` set to the public HTTPS domain. This is used at build time for canonical links and the sitemap.

Set `INTERNAL_NOTIFICATION_EMAIL` and any other booking settings as needed. Set both `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET` to enable Turnstile. Vercel automatically supplies `VERCEL_URL` for preview builds; the app trusts Vercel's forwarded client IP for rate limiting.

Before deploying to a new database, run `npx prisma migrate deploy` once from `server/` with that database's `DATABASE_URL`. The build generates Prisma Client but does not run migrations. The database migrated earlier in this project already has the checked-in migrations applied; run migrations again only after adding a new migration or changing databases.

Keep all credentials in Vercel's Environment Variables settings, not in GitHub or `vercel.json`. Deploy a preview first, verify `/api/health` and booking/contact flows with the configured services, then promote or deploy to production. Email and Salesforce must be configured for those flows to succeed.

1. Provision PostgreSQL and set `DATABASE_URL`.
2. Run `npx prisma migrate deploy` from `server/`.
3. Set the calendar and email variables for the production accounts.
4. Set `NEXT_PUBLIC_SITE_URL` to the public `https` origin. Canonical links and the sitemap use that value. An `https` origin is required before canonical tags are added to the pages.
5. Set `HOST=0.0.0.0` when a reverse proxy on the same machine should reach the process. Leave it as `127.0.0.1` for local development. Set `TRUST_PROXY=true` only when that proxy sets `X-Forwarded-For`.
6. Run `npm start` behind the process manager, or deploy the `server` app with the site files as its parent directory.
7. Point the domain at that process. Do not serve the HTML from a separate static host, or the browser will not reach the API on the same origin. Confirm `GET /api/health` reports `"database": "ok"`.

### Docker

```bash
docker build -t nubetree .
docker run --env-file .env -p 5500:5500 nubetree
```

The container applies migrations on start, then serves the site. It stops cleanly on `SIGTERM`.

### Fonts and video

All fonts are served from `assets/fonts/`, so pages make no requests to Google Fonts or Framer. `styles.css` holds the home page fonts and `assets/fonts/fonts.css` holds the fonts for the other pages. Service videos are H.264 without audio, with the index at the start of the file so playback begins before the download finishes.

### What the server publishes

Only root `.html`, `.css`, and `.svg` files and the `assets/` folder are served. Everything else in the folder returns the 404 page, including `README.md`, `server/`, `.env`, and files that start with `_`. HTML is sent with `Cache-Control: no-cache`. CSS and JavaScript are cached for an hour and images and video for a week. Text files are gzip-compressed, and video supports byte ranges for Safari.

### Monitoring

Logs are one JSON object per line on standard output. They leave out email addresses, phone numbers, messages, and tokens. A `server_error` line also records the error's name and the first 300 characters of its message for diagnosis; that text stays in the log and is never sent to the browser or the alert webhook. At startup, `integrations_missing` lists any of `database`, `calendar`, or `email` that have no credentials. Point an uptime monitor at `GET /api/health`. It returns `200` when the database answers and `503` when it does not.

Set `ALERT_WEBHOOK_URL` to a Slack, Discord, or Microsoft Teams incoming webhook and the server posts a message for these log events:

| Event | When |
| --- | --- |
| `uncaught_exception`, `unhandled_rejection` | The process crashed or hit an unhandled error. The alert is sent before the process exits |
| `server_error` | A request failed with `500` |
| `email_failure` | Resend did not accept a confirmation, notification, acknowledgement, or cancellation email |
| `calendar_failure` | Google Calendar refused a token, availability, create, update, or cancel call, or did not answer within 10 seconds. The alert names the operation and the status code (`0` for no answer) |
| `booking_record_failure` | The database failed partway through a booking. `step` says where: `attach_event` (the calendar event was removed again), `confirm` (the call is booked and emailed, but the row is still `PENDING` and needs fixing by hand), or `release` |

Each event type alerts at most once every five minutes. The next alert says how many were held back. Alerts carry the event, time, site, and IDs such as `requestId` and `bookingId`, and never the visitor's email, phone, or message. If the webhook itself fails, the server logs `alert_failure` and carries on.

### Content Security Policy

Every page loads its JavaScript from files under `assets/`, so `script-src` allows `'self'` only, plus `https://challenges.cloudflare.com` when Turnstile is on. Keep new scripts in files: an inline `<script>` or `onclick` attribute will be blocked, and the test "pages run no inline script" fails if one is added. `style-src` still allows `'unsafe-inline'` because the exported page markup uses inline `style` attributes.

### Cancelling

The confirmation email links to `/cancel.html?token=…`. That page cancels the event, releases the slot, and emails the visitor.

Optional calendar webhook: `POST /api/webhooks/calendar` with header `x-webhook-secret` equal to `CALENDAR_WEBHOOK_SECRET`. Requests without that secret are rejected.

## Troubleshooting

- `NOT_CONFIGURED` on the calendar step means `DATABASE_URL` or the Google calendar variables are missing.
- A contact submit that returns an error after a valid form usually means Resend rejected the message or `EMAIL_FROM` is not verified.
- `409` means that start time was taken between the page load and the submit. The visitor picks another time.
- `429` means the rate limit for that IP was reached.
- `SECURITY_CHECK_FAILED` means the Turnstile check did not pass. Confirm the site key and secret belong to the same Turnstile widget and that the widget allows your domain.
