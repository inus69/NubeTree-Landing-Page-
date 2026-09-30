import { PrismaClient } from "@prisma/client";
import { notConfigured, slotTaken } from "./errors.js";
import { asRecord } from "./validate.js";

/** @typedef {import("./types.js").Store} Store */

/** @type {PrismaClient | undefined} */
var prisma;
var lastSweep = 0;

function db() {
  if (!process.env.DATABASE_URL) throw notConfigured();
  if (!prisma) prisma = new PrismaClient();
  return prisma;
}

/**
 * P2002 is a unique-key clash on slotKey or idempotencyKey. The overlap exclusion constraint
 * has no Prisma error code, so it surfaces as an unknown request error naming the constraint.
 * @param {unknown} error
 */
function conflict(error) {
  var record = asRecord(error);
  if (record.code === "P2002") return true;
  return typeof record.message === "string" && record.message.includes("Booking_no_overlap");
}

/**
 * Concurrent inserts checked by the exclusion constraint deadlock against each other, so booking
 * writes take one transaction-scoped advisory lock and run in turn. The constraint stays the guard.
 * @template T
 * @param {(tx: import("@prisma/client").Prisma.TransactionClient) => Promise<T>} write
 * @returns {Promise<T>}
 */
function serialized(write) {
  return db().$transaction(async function (tx) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(725001)`;
    return write(tx);
  }, { maxWait: 10000, timeout: 10000 });
}

/** @returns {Store} */
export function createPrismaStore() {
  return {
    async findByIdempotency(key) {
      if (!key) return null;
      return db().booking.findUnique({ where: { idempotencyKey: key } });
    },
    async activeStarts(from, to) {
      var rows = await db().booking.findMany({
        where: { status: { in: ["PENDING", "CONFIRMED"] }, startTime: { gte: from.toJSDate(), lt: to.toJSDate() } },
        select: { startTime: true, endTime: true }
      });
      return rows.map(function (row) {
        return { start: row.startTime, end: row.endTime };
      });
    },
    async claim(row) {
      try {
        return await serialized(function (tx) { return tx.booking.create({ data: row }); });
      } catch (error) {
        if (!conflict(error)) throw error;
        if (row.idempotencyKey) {
          var prior = await db().booking.findUnique({ where: { idempotencyKey: row.idempotencyKey } });
          if (prior) return prior;
        }
        throw slotTaken();
      }
    },
    async confirm(id, event, emailState) {
      return db().booking.update({
        where: { id: id },
        data: {
          status: "CONFIRMED",
          calendarEventId: event.id,
          calendarEventUrl: event.url || "",
          confirmationEmailStatus: emailState.confirmation,
          internalEmailStatus: emailState.internal
        }
      });
    },
    async attachEvent(id, event) {
      return db().booking.update({
        where: { id: id },
        data: { calendarEventId: event.id, calendarEventUrl: event.url || "" }
      });
    },
    async release(id) {
      return db().booking.update({
        where: { id: id },
        data: { status: "FAILED", slotKey: null, idempotencyKey: null }
      });
    },
    async releaseStale(before) {
      var result = await db().booking.updateMany({
        where: { status: "PENDING", calendarEventId: null, createdAt: { lt: before } },
        data: { status: "FAILED", slotKey: null, idempotencyKey: null }
      });
      return result.count;
    },
    async findByCancelToken(token) {
      return db().booking.findUnique({ where: { cancelToken: token } });
    },
    async findByRescheduleToken(token) {
      return db().booking.findUnique({ where: { rescheduleToken: token } });
    },
    async cancel(id) {
      return db().booking.update({ where: { id: id }, data: { status: "CANCELLED", slotKey: null } });
    },
    async move(id, start, end) {
      try {
        return await serialized(function (tx) {
          return tx.booking.update({
            where: { id: id },
            data: { startTime: start.toJSDate(), endTime: end.toJSDate(), slotKey: start.toISO() }
          });
        });
      } catch (error) {
        if (conflict(error)) throw slotTaken();
        throw error;
      }
    },
    async saveContact(row) {
      try {
        return await db().contactSubmission.create({ data: row });
      } catch (error) {
        if (row.idempotencyKey && conflict(error)) return null;
        throw error;
      }
    },
    async findContactByKey(key) {
      return db().contactSubmission.findUnique({ where: { idempotencyKey: key } });
    },
    async findRecentContact(email, message, since) {
      return db().contactSubmission.findFirst({
        where: { email: email, message: message, status: { in: ["RECEIVED", "PROCESSED"] }, createdAt: { gte: since } },
        orderBy: { createdAt: "desc" }
      });
    },
    async markContact(id, data) {
      return db().contactSubmission.update({ where: { id: id }, data: data });
    },
    async ping() {
      if (!process.env.DATABASE_URL) return "unconfigured";
      await db().$queryRaw`SELECT 1`;
      return "ok";
    },
    async disconnect() {
      if (prisma) await prisma.$disconnect();
    },
    async hitRate(key, max, windowSeconds) {
      var since = new Date(Date.now() - windowSeconds * 1000);
      if (Date.now() - lastSweep > 3600000) {
        lastSweep = Date.now();
        await db().rateHit.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 86400000) } } });
      }
      return db().$transaction(async function (tx) {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 183542))`;
        var count = await tx.rateHit.count({ where: { key: key, createdAt: { gte: since } } });
        if (count >= max) return false;
        await tx.rateHit.create({ data: { key: key } });
        return true;
      }, { maxWait: 10000, timeout: 10000 });
    }
  };
}
