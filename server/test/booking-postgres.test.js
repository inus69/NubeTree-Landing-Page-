import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import { PrismaClient } from "@prisma/client";
import { createPrismaStore } from "../src/store.js";

/** @typedef {import("../src/types.js").NewBooking} NewBooking */

var skip = process.env.RUN_POSTGRES_INTEGRATION === "1" ? false : "run npm run test:integration with TEST_DATABASE_URL configured";
var PREFIX = "pgtest-";

/**
 * @param {string} iso
 * @returns {import("../src/types.js").Instant}
 */
function utc(iso) {
  var value = DateTime.fromISO(iso, { zone: "utc" });
  if (!value.isValid) throw new Error("invalid test time " + iso);
  return value;
}

/**
 * Rows far in the future so they never collide with real bookings.
 * @param {string} iso
 * @param {number} minutes
 * @returns {NewBooking}
 */
function row(iso, minutes) {
  var start = DateTime.fromISO(iso, { zone: "utc" });
  var id = PREFIX + randomUUID();
  return {
    id: id,
    name: "Postgres Check",
    email: "pg@example.com",
    company: "Check Co",
    phone: "",
    message: "",
    services: "API",
    projectStage: "Build",
    budget: "25-50k",
    timezone: "UTC",
    startTime: start.toJSDate(),
    endTime: start.plus({ minutes: minutes }).toJSDate(),
    slotKey: id,
    status: "PENDING",
    cancelToken: id + "-c",
    rescheduleToken: id + "-r",
    idempotencyKey: null
  };
}

test("Postgres refuses overlapping active bookings, even when they race", { skip: skip }, async function () {
  var store = createPrismaStore();
  var db = new PrismaClient();
  try {
    for (var day = 10; day < 16; day++) {
      var at = "2035-02-" + day + "T15:00:00Z";
      var contenders = await Promise.allSettled([1, 2, 3, 4, 5, 6, 7, 8].map(function () { return store.claim(row(at, 30)); }));
      assert.equal(contenders.filter(function (result) { return result.status === "fulfilled"; }).length, 1, at);
      contenders.forEach(function (result) {
        if (result.status === "rejected") assert.equal(result.reason.code, "SLOT_UNAVAILABLE", String(result.reason.message).slice(-200));
      });
    }

    var settled = await Promise.allSettled([1, 2, 3, 4, 5, 6].map(function () { return store.claim(row("2035-03-05T15:00:00Z", 30)); }));
    var won = settled.filter(function (result) { return result.status === "fulfilled"; });
    assert.equal(won.length, 1);

    await assert.rejects(store.claim(row("2035-03-05T15:15:00Z", 30)), { code: "SLOT_UNAVAILABLE" });
    var backToBack = await store.claim(row("2035-03-05T15:30:00Z", 30));
    assert.ok(backToBack.id);

    await assert.rejects(store.move(backToBack.id, utc("2035-03-05T15:10:00Z"), utc("2035-03-05T15:40:00Z")), { code: "SLOT_UNAVAILABLE" });

    var winner = won[0].status === "fulfilled" ? won[0].value : null;
    assert.ok(winner);
    await store.cancel(winner.id);
    var reused = await store.claim(row("2035-03-05T15:00:00Z", 30));
    assert.ok(reused.id, "a cancelled booking frees its time");

    await assert.rejects(db.booking.create({ data: row("2035-03-06T15:00:00Z", 0) }), /Booking_time_order/);
  } finally {
    await db.booking.deleteMany({ where: { id: { startsWith: PREFIX } } });
    await db.$disconnect();
    await store.disconnect();
  }
});

test("Postgres releases only stale claims that never reached the calendar", { skip: skip }, async function () {
  var store = createPrismaStore();
  var db = new PrismaClient();
  try {
    var stale = await store.claim(row("2035-04-02T15:00:00Z", 30));
    var fresh = await store.claim(row("2035-04-02T16:00:00Z", 30));
    var attached = await store.claim(row("2035-04-02T17:00:00Z", 30));
    await store.attachEvent(attached.id, { id: "evt-pg", url: "", meetingLink: "" });
    var old = new Date(Date.now() - 20 * 60000);
    await db.booking.updateMany({ where: { id: { in: [stale.id, attached.id] } }, data: { createdAt: old } });

    await store.releaseStale(new Date(Date.now() - 15 * 60000));

    var rows = await db.booking.findMany({ where: { id: { in: [stale.id, fresh.id, attached.id] } } });
    /** @param {string} id */
    function statusOf(id) {
      var match = rows.find(function (item) { return item.id === id; });
      return match ? match.status : "missing";
    }
    assert.equal(statusOf(stale.id), "FAILED");
    assert.equal(statusOf(fresh.id), "PENDING");
    assert.equal(statusOf(attached.id), "PENDING");
  } finally {
    await db.booking.deleteMany({ where: { id: { startsWith: PREFIX } } });
    await db.$disconnect();
    await store.disconnect();
  }
});

test("Postgres stores a contact idempotency key once and finds recent duplicates", { skip: skip }, async function () {
  var store = createPrismaStore();
  var db = new PrismaClient();
  var key = PREFIX + randomUUID();
  var email = PREFIX + randomUUID() + "@example.com";
  /** @type {import("../src/types.js").NewContact} */
  var contact = {
    firstName: "Postgres",
    lastName: "Check",
    email: email,
    company: "",
    phone: "5551234567",
    city: "Austin",
    state: "TX",
    message: "Checking contact duplicates.",
    status: "RECEIVED",
    idempotencyKey: key
  };
  try {
    var saved = await Promise.all([1, 2, 3, 4].map(function () { return store.saveContact(contact); }));
    assert.equal(saved.filter(Boolean).length, 1);
    var found = await store.findContactByKey(key);
    assert.ok(found);
    var recent = await store.findRecentContact(email, contact.message, new Date(Date.now() - 60000));
    assert.equal(recent && recent.id, found.id);
    await store.markContact(found.id, { status: "FAILED", internalEmailStatus: "FAILED", acknowledgementEmailStatus: "SKIPPED", idempotencyKey: null });
    assert.equal(await store.findContactByKey(key), null);
    assert.equal(await store.findRecentContact(email, contact.message, new Date(Date.now() - 60000)), null);
  } finally {
    await db.contactSubmission.deleteMany({ where: { email: email } });
    await db.$disconnect();
    await store.disconnect();
  }
});

test("Postgres rate limiting caps concurrent hits across store instances", { skip: skip }, async function () {
  var stores = [createPrismaStore(), createPrismaStore()];
  var db = new PrismaClient();
  var key = PREFIX + "rate-" + randomUUID();
  try {
    var results = await Promise.all(Array.from({ length: 20 }, function (_, index) {
      return stores[index % stores.length].hitRate(key, 5, 60);
    }));
    assert.equal(results.filter(Boolean).length, 5);
  } finally {
    await db.rateHit.deleteMany({ where: { key: key } });
    await db.$disconnect();
    await stores[0].disconnect();
  }
});
