# NubeTree production-readiness report

Audit date: 29 September 2026.

## Architecture found

The site is static HTML, CSS, and JavaScript exported from a Framer template and edited by hand. It does not use Next.js, React, TypeScript, Tailwind, or shadcn/ui. There is no `next.config`, `tsconfig.json`, `app/`, `pages/`, `components/`, or middleware.

| Area | What exists |
| --- | --- |
| Pages | `index.html`, `contact.html`, `discovery-call.html`, `privacy.html`, `terms.html`, `404.html`, six `case-*.html` pages |
| Front-end scripts | `assets/booking/*.js`, `assets/services/services.js`, `assets/cases/carousel.js`, eight inline scripts in `index.html`, one in `contact.html` |
| Server | Node HTTP server in `server/src` that serves the pages and the API. No framework |
| API | `GET /api/discovery-call/availability`, `POST /api/discovery-call/book`, `POST /api/discovery-call/reschedule`, `DELETE|POST /api/discovery-call/cancel/:token`, `POST /api/contact`, `POST /api/webhooks/calendar`, `GET /api/health`, `/robots.txt`, `/sitemap.xml` |
| Database | PostgreSQL through Prisma 6.16.2. Models `Booking`, `ContactSubmission`, `RateHit`. Two migrations; the second adds the booking overlap constraint |
| Calendar | Google Calendar through an OAuth refresh token (`server/src/calendar.js`) |
| Email | Resend HTTP API (`server/src/email.js`) |
| Authentication | None. There is no admin area. Booking changes use unguessable tokens |
| Analytics | None |
| Tests | Node test runner, 10 tests in `server/test` |
| Deployment | `docker-compose.yml` for local Postgres only. No application image or process configuration |

## Pattern search

Project source only. `server/node_modules` and the old Chrome profile folders are excluded.

| Pattern | Result |
| --- | --- |
| `localhost`, `127.0.0.1` | Server defaults and tests only. They are overridden by `HOST` and `NEXT_PUBLIC_SITE_URL`. `_frame.html` is a leftover preview file |
| `TODO`, `FIXME` | None |
| `mock`, `dummy`, `sample`, `fake`, test data | None in shipped code. The in-memory store in `server/test/booking.test.js` is test-only |
| `console.log` | Only the structured logger in `server/src/log.js` |
| `alert(` | None |
| `mailto:` | None. Email inquiries use the server-side contact form; the contact address is plain text. |
| Hardcoded credentials | `docker-compose.yml` uses the local password `nubetree` |
| Exposed tokens or API keys | None in source. `.env` contains no secrets yet and is git-ignored |

## Critical

1. **The whole project folder is public.** The server uses the repository root as its web root and blocks only `/server`, `.env`, `.git`, and `docker-compose.yml`. Anyone can download the 31 leftover Chrome profile folders (`_chrome_*`, `_cp_*`, `_cut_*`, `_dash_*`, `_cases_*`, `_why_profile`), scratch scripts (`_*.py`), `_proc.txt`, `_frame.html`, `README.md`, and `.env.example`. Chrome profiles can hold cookies and saved session data.
2. **Booking cannot confirm a call.** Google Calendar credentials are empty, so availability returns `503 NOT_CONFIGURED`.
3. **Contact and booking emails cannot send.** `EMAIL_API_KEY` and `EMAIL_FROM` are empty.
4. **No production database, domain, or HTTPS.** Only the local Docker database exists, and it is stopped.

## High

1. **Service videos do not support byte ranges.** MP4 files are streamed whole without `Accept-Ranges` or `206` responses. Safari on iPhone and Mac refuses to play video that way.
2. **Reschedule and cancel are not rate limited.** The other write endpoints are.
3. **The webhook secret uses a normal string comparison.** That leaks timing information.
4. **`RateHit` rows are never deleted.** The table grows with every request.
5. **No graceful shutdown.** A deploy or restart can cut off a booking between the calendar event and the database update.
6. **No HSTS header** once the site is on HTTPS.
7. **No application deployment configuration.** There is no image or start definition for a host.
8. **Business hours default to `America/New_York`, 09:00–17:00.** The published phone number is in India. The team needs to confirm this.

## Medium

1. **Process icons are 1024×1024 PNGs shown at 100px.** Five files total 2.5 MB.
2. **No lazy loading.** None of the 30 home-page images use `loading="lazy"`.
3. **No caching or compression for static files.** Every request re-downloads the full 369 KB stylesheet.
4. **Fonts load from `framerusercontent.com`.** 282 `@font-face` rules depend on Framer’s CDN staying up.
5. **Inner pages have no Open Graph title or description, and no page has an `og:image`.**
6. **`discovery-call.html` has no `<main>` landmark and no `<h1>`.** The home page has no main landmark either.
7. **The case-study carousel removes its focus outline** and has no `:focus-visible` replacement.
8. **Setting `TURNSTILE_SECRET` would block every form.** The pages do not render a Turnstile widget, so they never send a token.
9. **The confirmation email has no cancel link.** A visitor can cancel only from the same browser session.
10. **Email subjects include visitor names without removing line breaks.**
11. **Service videos total 27 MB.** `mobile-application-development.mp4` alone is 9 MB. `ffmpeg` is not installed here to re-encode them.
12. **Monitoring is logs only.** There is no alerting for crashes, failed emails, or failed calendar calls.

## Low

1. The Insight Medical Genetics logo is 120×49 and soft on the card.
2. API & Backend Development shows a still image in place of a video.
3. `index.html` still carries Framer data attributes and 115 inline styles.
4. The CSP needs `'unsafe-inline'` because of inline scripts and styles.
5. Twenty-four home-page images have no `width` or `height`, which can shift layout as they load.
6. The calendar webhook only logs requests. It does not sync changes made in Google Calendar.

## By category

- **Security:** Critical 1; High 2, 3, and 6; Medium 10; Low 4.
- **Performance:** High 1; Medium 1, 2, 3, 4, and 11; Low 3 and 5.
- **SEO:** Medium 5 and 6. `robots.txt` and the sitemap exist.
- **Accessibility:** Medium 6 and 7. The skip link, form labels, and `aria-live` status messages exist.
- **Functional:** High 1; Medium 9; Low 2.
- **Backend and API:** High 2, 3, 4, and 5; Medium 8.
- **Booking:** Critical 2; High 8; Medium 9; Low 6.
- **Contact form:** Critical 3; Medium 8 and 10.
- **Deployment:** Critical 1 and 4; High 7.
- **Monitoring:** Medium 12.

## Fix plan

| Item | Fix | Owner |
| --- | --- | --- |
| Critical 1 | Serve an allowlist of public files only, and delete the leftover folders and scratch files | Code |
| Critical 2 and 3 | Add Google Calendar and Resend credentials | NubeTree |
| Critical 4 | Provision the database, domain, and HTTPS | NubeTree |
| High 1 | Support byte-range requests | Code |
| High 2 to 6 | Rate limits, constant-time comparison, rate-row cleanup, graceful shutdown, HSTS | Code |
| High 7 | Add a `Dockerfile` and `.dockerignore` | Code |
| High 8 | Confirm business hours and timezone | NubeTree |
| Medium 1 to 3 | Resize icons, lazy-load images, cache and compress text files | Code |
| Medium 5 to 10 | Open Graph tags, landmarks, focus outline, Turnstile note, cancel link, subject cleanup | Code |
| Medium 4 and 11, Low 1 and 2 | Self-host fonts, re-encode videos, supply a better logo and an API video | NubeTree or a later pass |
| Medium 12 | Add an uptime check on `/api/health` and log crashes | Code, plus a monitor on the host |

## Status after the first fix pass

| Item | Status |
| --- | --- |
| Critical 1 | Fixed. The server publishes only root `.html`, `.css`, and `.svg` files and `assets/`. The leftover `_*` folders and scratch files have been deleted |
| Critical 2, 3, and 4 | Open. They need your Google Calendar, Resend, database, and domain details |
| High 1 | Fixed. Video answers `Range` requests with `206` |
| High 2 | Fixed. Reschedule and cancel are rate limited, and `DELETE` cancel checks the origin |
| High 3 | Fixed. Constant-time comparison |
| High 4 | Fixed. Rate rows older than a day are removed hourly |
| High 5 | Fixed. `SIGTERM` and `SIGINT` drain requests and close the database. Crashes are logged. Request and header timeouts are set |
| High 6 | Fixed. HSTS is sent once `NEXT_PUBLIC_SITE_URL` is `https` |
| High 7 | Fixed. `Dockerfile` and `.dockerignore` |
| High 8 | Open. Needs your confirmation |
| Medium 1 | Fixed. Icons are 256px, 205 KB in total |
| Medium 2 | Fixed. 29 images lazy-load. The NubeTree mark stays eager |
| Medium 3 | Fixed. Gzip, ETags, and cache headers |
| Medium 4 | Fixed. All fonts and the noise texture are served from this site. Unused font families were removed |
| Medium 5 | Fixed for title and description on every page. `og:image` is still open until a share image exists |
| Medium 6 | Fixed. `discovery-call.html` has `<main>` and an `<h1>`. The home page wrapper has `role="main"` |
| Medium 7 | Fixed. Focus outline restored |
| Medium 8 | Fixed. The booking and contact forms render Turnstile when `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET` are both set |
| Medium 9 | Fixed. `cancel.html` and a cancel link in the confirmation email |
| Medium 10 | Fixed. Line breaks are removed from subjects |
| Medium 11 | Fixed. Videos re-encoded from 25.9 MB to 12.4 MB, with no audio and a fast-start index |
| Medium 12 | Fixed. `ALERT_WEBHOOK_URL` posts crashes, `500` errors, and failed email and calendar calls to Slack, Discord, or Teams. An uptime monitor on `/api/health` still has to be set up on the host |
| Low 1, 2, 3, and 6 | Open |
| Low 4 | Fixed for scripts. All inline scripts moved to `assets/`, and `script-src` no longer allows `'unsafe-inline'`. Styles still need it for the exported markup |
| Low 5 | Fixed. All 24 home-page images have `width` and `height` |

## Booking hardening

The visitor picks a date, then a time, then enters details. The Book button is on the details step. The server decides everything that matters:

| Risk | Protection |
| --- | --- |
| Browser shows stale times | Availability comes only from the server (Google free/busy plus active bookings). At booking time the server rebuilds the open slots and the requested start must match one exactly. The browser may reuse a month's list for 30 seconds, and clears it after a clash or a booking |
| Past, off-grid, or far-future times | Refused, because they are not in the server's slot list (minimum lead time, business hours, horizon) |
| Impossible dates | `selected_time` must be a valid ISO instant. `selected_date`, when sent, must equal that instant's date in the visitor's timezone |
| Double booking and races | The row is claimed in Postgres before the calendar event is created. `slotKey` is unique, and the SQL exclusion constraint `Booking_no_overlap` refuses any two active bookings whose times overlap. Claims run under a transaction advisory lock, so racing requests queue instead of deadlocking. Tested with 8 simultaneous claims on real Postgres |
| Duplicate submissions | The `Idempotency-Key` header replays a confirmed booking, answers `409 BOOKING_IN_PROGRESS` while the first request is still running (the browser retries with the same key), and answers `422 IDEMPOTENCY_MISMATCH` when a key is reused for another time. The Book button disables while a request runs |
| Crashed requests holding a slot | A `PENDING` claim with no calendar event is released after 15 minutes |
| Calendar failure | The claim is released and the visitor sees an error. No booking is left half made |
| Timezones | Times are stored in UTC. The visitor sees their own timezone, and the internal email shows both the team time (`BOOKING_TIMEZONE`) and the visitor's time |
| Invalid input | Client and server apply the same rules: name and company 2–120/160 characters, valid email, phone optional with 7–15 digits, project details up to 4,000 characters. Over-long values are refused, never cut short. Server field errors appear next to the matching field |
