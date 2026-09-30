CREATE TYPE "BookingStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED', 'FAILED');
CREATE TYPE "EmailStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');
CREATE TYPE "ContactStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'FAILED', 'SPAM');

CREATE TABLE "Booking" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "company" TEXT NOT NULL,
  "phone" TEXT NOT NULL DEFAULT '',
  "message" TEXT NOT NULL DEFAULT '',
  "services" TEXT NOT NULL DEFAULT '',
  "projectStage" TEXT NOT NULL DEFAULT '',
  "budget" TEXT NOT NULL DEFAULT '',
  "timezone" TEXT NOT NULL,
  "startTime" TIMESTAMP(3) NOT NULL,
  "endTime" TIMESTAMP(3) NOT NULL,
  "slotKey" TEXT,
  "calendarEventId" TEXT,
  "calendarEventUrl" TEXT,
  "status" "BookingStatus" NOT NULL,
  "confirmationEmailStatus" "EmailStatus" NOT NULL DEFAULT 'PENDING',
  "internalEmailStatus" "EmailStatus" NOT NULL DEFAULT 'PENDING',
  "cancelToken" TEXT NOT NULL,
  "rescheduleToken" TEXT NOT NULL,
  "idempotencyKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Booking_slotKey_key" ON "Booking"("slotKey");
CREATE UNIQUE INDEX "Booking_cancelToken_key" ON "Booking"("cancelToken");
CREATE UNIQUE INDEX "Booking_rescheduleToken_key" ON "Booking"("rescheduleToken");
CREATE UNIQUE INDEX "Booking_idempotencyKey_key" ON "Booking"("idempotencyKey");
CREATE INDEX "Booking_email_idx" ON "Booking"("email");
CREATE INDEX "Booking_startTime_idx" ON "Booking"("startTime");
CREATE INDEX "Booking_status_idx" ON "Booking"("status");
CREATE INDEX "Booking_calendarEventId_idx" ON "Booking"("calendarEventId");
CREATE INDEX "Booking_createdAt_idx" ON "Booking"("createdAt");

CREATE TABLE "ContactSubmission" (
  "id" TEXT NOT NULL,
  "firstName" TEXT NOT NULL,
  "lastName" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "company" TEXT NOT NULL DEFAULT '',
  "phone" TEXT NOT NULL,
  "city" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "status" "ContactStatus" NOT NULL,
  "internalEmailStatus" "EmailStatus" NOT NULL DEFAULT 'PENDING',
  "acknowledgementEmailStatus" "EmailStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContactSubmission_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ContactSubmission_email_idx" ON "ContactSubmission"("email");
CREATE INDEX "ContactSubmission_status_idx" ON "ContactSubmission"("status");
CREATE INDEX "ContactSubmission_createdAt_idx" ON "ContactSubmission"("createdAt");

CREATE TABLE "RateHit" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RateHit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RateHit_key_createdAt_idx" ON "RateHit"("key", "createdAt");
