# Production deployment runbook

This runbook covers the remaining live deployment tasks for the NubeTree landing page and booking system. These are the tasks that require real production credentials and host configuration.

## 1) Production prerequisites

Before deployment, collect these values:

- PostgreSQL connection string for `DATABASE_URL`
- Google Calendar OAuth values:
  - `CALENDAR_CLIENT_ID`
  - `CALENDAR_CLIENT_SECRET`
  - `CALENDAR_REFRESH_TOKEN`
  - `CALENDAR_ID`
- Resend values:
  - `EMAIL_API_KEY`
  - `EMAIL_FROM`
  - optional `EMAIL_REPLY_TO`
- public HTTPS origin:
  - `NEXT_PUBLIC_SITE_URL=https://your-domain.com`
- host/runtime values:
  - `HOST=0.0.0.0`
  - `TRUST_PROXY=true` only if a reverse proxy sets `X-Forwarded-For`
- optional monitoring values:
  - `ALERT_WEBHOOK_URL`
  - `CALENDAR_WEBHOOK_SECRET`

## 2) Required environment variables

Use the existing examples in [.env.example](.env.example) as the source of truth.

### Public values

```env
NEXT_PUBLIC_SITE_URL=https://www.yourdomain.com
TURNSTILE_SITE_KEY=your_turnstile_site_key
```

### Private values

```env
DATABASE_URL=postgresql://user:password@host:5432/dbname

CALENDAR_PROVIDER=google
CALENDAR_CLIENT_ID=...
CALENDAR_CLIENT_SECRET=...
CALENDAR_REFRESH_TOKEN=...
CALENDAR_ID=primary
CALENDAR_WEBHOOK_SECRET=replace-with-strong-secret

EMAIL_PROVIDER=resend
EMAIL_API_KEY=...
EMAIL_FROM=hello@yourdomain.com
EMAIL_REPLY_TO=hr@nubetree.com
INTERNAL_NOTIFICATION_EMAIL=hr@nubetree.com
EMAIL_ACKNOWLEDGE=true

TURNSTILE_SECRET=your_turnstile_secret

PORT=5500
HOST=0.0.0.0
TRUST_PROXY=true

BOOKING_TIMEZONE=America/New_York
BOOKING_WORK_START=09:00
BOOKING_WORK_END=17:00
BOOKING_WEEKDAYS=1,2,3,4,5
BOOKING_DURATION_MINUTES=30
BOOKING_BUFFER_MINUTES=0
BOOKING_HORIZON_DAYS=21
BOOKING_MIN_LEAD_MINUTES=60

RATE_LIMIT_MAX_REQUESTS=8
RATE_LIMIT_AVAILABILITY_MAX=60
RATE_LIMIT_WINDOW_SECONDS=600
HONEYPOT_ENABLED=true
ALERT_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

## 3) Production deployment sequence

### Step 1: prepare the production database

- Provision PostgreSQL in your host or managed service.
- Create a production database and user.
- Set `DATABASE_URL` in the production environment.
- Run database migrations:

```bash
cd server
npx prisma migrate deploy
```

### Step 2: validate production secrets

Confirm that these values are non-empty in the runtime environment:

- `DATABASE_URL`
- `CALENDAR_CLIENT_ID`
- `CALENDAR_CLIENT_SECRET`
- `CALENDAR_REFRESH_TOKEN`
- `CALENDAR_ID`
- `EMAIL_API_KEY`
- `EMAIL_FROM`
- `NEXT_PUBLIC_SITE_URL`

### Step 3: deploy the app

Use the existing container or process setup in the repository. The app serves the site and API from the project root and the `server` folder.

Preferred pattern:

```bash
cd /path/to/project
npm install
cd server
npm install
npm start
```

Or run the container:

```bash
docker build -t nubetree .
docker run --env-file .env -p 5500:5500 nubetree
```

### Step 4: verify health

After startup, confirm:

```bash
curl https://your-domain.com/api/health
```

The service should respond with a healthy database status.

## 4) Google Calendar setup

1. Create a Google Cloud OAuth client for the Calendar API.
2. Grant the account calendar access.
3. Authorize the team account with the Calendar scope.
4. Save the refresh token in `CALENDAR_REFRESH_TOKEN`.
5. Set `CALENDAR_ID` to the target calendar, usually `primary` or a dedicated team calendar.

If these values are missing, the app returns `503 NOT_CONFIGURED` during booking and availability checks.

## 5) Email setup

1. Create a Resend project.
2. Create an API key.
3. Verify the sender domain and email used in `EMAIL_FROM`.
4. Confirm the internal notification address in `INTERNAL_NOTIFICATION_EMAIL`.
5. Validate both booking confirmation and internal booking notifications.

## 6) Security checklist

- Do not commit `.env` files
- Keep secrets only in the runtime environment or secret manager
- Ensure `NEXT_PUBLIC_SITE_URL` is HTTPS in production
- Use `HOST=0.0.0.0` only for container/proxy deployments
- Set `TRUST_PROXY=true` only when your proxy sets `X-Forwarded-For`
- Keep `CALENDAR_WEBHOOK_SECRET` strong and unique
- Use a real alert webhook for failure notifications

## 7) Monitoring checklist

Set up an external uptime monitor against:

- `https://your-domain.com/api/health`

Recommended alerting:

- `calendar_failure`
- `email_failure`
- `server_error`
- `unhandled_rejection`
- `uncaught_exception`

## 8) QA before launch

Run these checks before public rollout:

```bash
cd server
npm test
npm run typecheck
npm run lint
npm run check
```

Then verify:

- booking flow works end-to-end
- same slot cannot be double-booked
- contact form does not use `mailto:`
- confirmation email is actually sent
- invitation calendar event is actually created
- `/api/health` returns success

## 9) Known deployment blockers

The app is already built for the real production architecture, but these items still require external configuration before the site is fully live:

- production database credentials
- Google Calendar OAuth credentials
- email provider configuration
- production domain + HTTPS
- alert/webhook configuration
- production monitoring

## 10) Go-live checklist

- [ ] `DATABASE_URL` is live and reachable
- [ ] Prisma migrations run successfully
- [ ] `NEXT_PUBLIC_SITE_URL` is correct HTTPS origin
- [ ] Google Calendar integration is configured and tested
- [ ] Resend email is configured and verified
- [ ] `HOST` and `TRUST_PROXY` are set correctly
- [ ] app is started behind the production process manager
- [ ] `/api/health` reports database `ok`
- [ ] booking flow successfully creates a real calendar event
- [ ] visitor and internal emails are being delivered
- [ ] uptime monitoring is active
- [ ] alert webhooks are configured and tested

## 11) Troubleshooting

### `503 NOT_CONFIGURED`

This usually means one or more of these are missing:

- `DATABASE_URL`
- `CALENDAR_CLIENT_ID`
- `CALENDAR_CLIENT_SECRET`
- `CALENDAR_REFRESH_TOKEN`
- `CALENDAR_ID`

### Email not sending

Check:

- `EMAIL_API_KEY`
- `EMAIL_FROM`
- `EMAIL_PROVIDER`
- the sender identity on the Resend domain

### Not reachable externally

Check:

- `HOST`
- `PORT`
- reverse proxy configuration
- firewall or runtime network rules

### Health check fails

Check database connectivity and Prisma readiness.

---

This runbook is intentionally focused on the live deployment blockers and the exact steps required to move from a working repository to a production deployment.
