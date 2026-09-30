-- Existing timestamp values represent UTC instants written by the application.
-- Interpret those values as UTC while moving to timezone-aware PostgreSQL columns.
ALTER TABLE "Booking"
  DROP CONSTRAINT "Booking_no_overlap";

ALTER TABLE "Booking"
  ALTER COLUMN "startTime" TYPE TIMESTAMPTZ(3) USING "startTime" AT TIME ZONE 'UTC',
  ALTER COLUMN "endTime" TYPE TIMESTAMPTZ(3) USING "endTime" AT TIME ZONE 'UTC',
  ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'UTC';

ALTER TABLE "ContactSubmission"
  ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'UTC';

ALTER TABLE "RateHit"
  ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';

ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_no_overlap"
  EXCLUDE USING gist (tstzrange("startTime", "endTime", '[)') WITH &&)
  WHERE ("status" IN ('PENDING', 'CONFIRMED'));