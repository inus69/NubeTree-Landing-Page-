-- Two active bookings can never overlap in time, even when requests race.
-- Prisma's schema language cannot express exclusion constraints, so this lives only in SQL.
ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_no_overlap"
  EXCLUDE USING gist (tsrange("startTime", "endTime", '[)') WITH &&)
  WHERE ("status" IN ('PENDING', 'CONFIRMED'));

ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_time_order" CHECK ("endTime" > "startTime");
