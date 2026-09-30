# Production launch checklist for repo-side tasks

This checklist covers the work that can be completed in this repository without production credentials, live hosting access, or external service accounts.

## Status summary

- Code and config tasks: Ready to execute in this repo
- External production tasks: Blocked until credentials and hosting details are provided
- Verification: The project test suite currently passes in the repo

## 1) Security hardening

- [ ] Review public file exposure and ensure only intended files are served
- [ ] Confirm static/public file allowlist remains strict
- [ ] Keep rate limiting enabled for booking, cancel, reschedule, and contact requests
- [ ] Validate same-origin enforcement for browser POST requests
- [ ] Verify webhook secret comparison uses constant-time comparison
- [ ] Confirm stale rate rows are cleaned up on a schedule
- [ ] Ensure graceful shutdown drains in-flight requests and closes DB connections cleanly
- [ ] Check request and header timeouts are configured

## 2) Deployment prep

- [ ] Verify Dockerfile and .dockerignore are in place and correct
- [ ] Confirm startup command and process manager configuration are documented
- [ ] Keep environment variables in a dedicated .env pattern and ensure they are not baked into the public build
- [ ] Validate the app starts from the container or deployment runtime without secrets in source control
- [ ] Confirm `/api/health` is available and reports current system state

## 3) Performance optimization

- [ ] Keep gzip compression enabled for text files
- [ ] Keep cache headers configured for HTML, CSS, JS, images, and video
- [ ] Confirm image sizes include width and height attributes to prevent layout shift
- [ ] Add lazy loading to non-critical images where appropriate
- [ ] Confirm video supports range requests for Safari and mobile playback
- [ ] Check asset sizes and optimize large media where necessary
- [ ] Ensure CSS and JS are served efficiently and with proper caching

## 4) Frontend accessibility and SEO

- [ ] Confirm all page wrappers have valid landmarks and headings
- [ ] Restore focus styles for interactive elements
- [ ] Validate all links resolve to real pages or anchors
- [ ] Confirm Open Graph title, description, and image metadata are set on live pages
- [ ] Ensure canonical URLs and site metadata are correct for production
- [ ] Check footer and navigation links for working destinations

## 5) Booking and contact flow quality

- [ ] Validate server-side input sanitization and field rules remain strict
- [ ] Remove line breaks from email subjects before sending
- [ ] Keep Turnstile conditional logic behind proper key configuration
- [ ] Confirm cancel and reschedule links are included in the correct user flows
- [ ] Check duplicate requests are rejected consistently with idempotency rules
- [ ] Ensure error states remain user-friendly and do not leak internal details

## 6) QA and verification

- [ ] Run the existing project test suite
- [ ] Run linting and type checks for the server and front-end assets
- [ ] Run browser QA checks for landing page, booking flow, and contact form
- [ ] Verify no console errors or failing requests appear during QA
- [ ] Check all pages load cleanly in desktop, tablet, and mobile widths
- [ ] Validate health endpoint and booking lifecycle end-to-end using local/test credentials

## 7) Production-readiness gate

Complete all items above before moving to live deployment.

The following remain external and must be supplied by the production owner:

- Real PostgreSQL database connection
- Google Calendar credentials and calendar ID
- Resend API key and verified sender address
- HTTPS domain and hosting configuration
- Reverse proxy + TLS setup
- Slack/Discord/Teams alert webhook
- Production business-hours timezone confirmation
- Host-level uptime monitoring setup

## Verification evidence

The repo-side validation command currently succeeds:

- `cd server && npm test`
- Exit status: `0`

That confirms the codebase is in a valid repo-level state for the work above before external deployment credentials are added.
