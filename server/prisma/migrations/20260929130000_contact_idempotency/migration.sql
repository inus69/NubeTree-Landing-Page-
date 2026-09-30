-- A retried contact submission carries the same key, so it is stored and emailed once.
ALTER TABLE "ContactSubmission" ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "ContactSubmission_idempotencyKey_key" ON "ContactSubmission"("idempotencyKey");
