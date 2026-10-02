import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createSalesforce } from "../src/salesforce.js";
import { loadConfig } from "../src/config.js";

var ENV = {
  SALESFORCE_CLIENT_ID: "client-id",
  SALESFORCE_CLIENT_SECRET: "client-secret"
};

function settings() {
  return loadConfig(ENV).salesforce;
}

/** @param {string} id @returns {import("@prisma/client").ContactSubmission} */
function contact(id) {
  return {
    id: id,
    firstName: "Amina",
    lastName: "Shah",
    email: "amina@example.com",
    company: "Northwind",
    phone: "+1 555 123 4567",
    city: "Austin",
    state: "TX",
    message: "Please contact me about an integration project.",
    status: "PROCESSED",
    internalEmailStatus: "SENT",
    acknowledgementEmailStatus: "SKIPPED",
    idempotencyKey: null,
    createdAt: new Date("2026-10-01T12:00:00.000Z"),
    updatedAt: new Date("2026-10-01T12:00:00.000Z")
  };
}

/** @returns {import("@prisma/client").Booking} */
function booking() {
  return {
    id: "booking-1",
    name: "Amina Shah",
    email: "AMINA@example.com",
    company: "Northwind",
    phone: "+1 555 123 4567",
    message: "Connect billing to the CRM.",
    services: "API / System Integration",
    projectStage: "MVP",
    budget: "$25K-$50K",
    timezone: "America/New_York",
    startTime: new Date("2026-10-06T15:00:00.000Z"),
    endTime: new Date("2026-10-06T15:30:00.000Z"),
    slotKey: "2026-10-06T15:00:00.000Z",
    calendarEventId: "event-1",
    calendarEventUrl: "https://calendar.example/event-1",
    status: "CONFIRMED",
    confirmationEmailStatus: "SENT",
    internalEmailStatus: "SENT",
    cancelToken: "cancel-token",
    rescheduleToken: "reschedule-token",
    idempotencyKey: null,
    createdAt: new Date("2026-10-01T12:00:00.000Z"),
    updatedAt: new Date("2026-10-01T12:00:00.000Z")
  };
}

test("contact submissions upsert Salesforce Leads with the configured external ID", async function () {
  /** @type {Array<{ url: string, init: RequestInit }>} */
  var requests = [];
  /** @type {typeof fetch} */
  var fetchImpl = async function (url, init) {
    requests.push({ url: String(url), init: init || {} });
    if (String(url).endsWith("/services/oauth2/token")) {
      return new Response(JSON.stringify({ access_token: "access-token", instance_url: "https://tenant.example", expires_in: 3600 }), { status: 200 });
    }
    return new Response(null, { status: 204 });
  };
  var salesforce = createSalesforce(settings(), fetchImpl);
  var externalId = createHash("sha256").update("amina@example.com").digest("hex");
  await salesforce.upsertContact(contact("contact-1"));

  assert.equal(salesforce.configured(), true);
  assert.equal(requests.length, 3);
  assert.equal(requests[0].url, "https://login.salesforce.com/services/oauth2/token");
  assert.equal(new URLSearchParams(String(requests[0].init.body)).get("client_secret"), "client-secret");
  assert.equal(requests[1].url, "https://tenant.example/services/data/v61.0/sobjects/Lead/Website_External_Id__c/" + externalId + "?fields=Description");
  assert.equal(requests[1].init.method, "GET");
  assert.equal(requests[2].url, "https://tenant.example/services/data/v61.0/sobjects/Lead/Website_External_Id__c/" + externalId);
  assert.equal(requests[2].init.method, "PATCH");
  assert.equal(new Headers(requests[2].init.headers).get("authorization"), "Bearer access-token");
  var payload = JSON.parse(String(requests[2].init.body));
  assert.deepEqual(payload, {
    FirstName: "Amina",
    LastName: "Shah",
    Company: "Northwind",
    Email: "amina@example.com",
    Phone: "+1 555 123 4567",
    City: "Austin",
    State: "TX",
    LeadSource: "Website",
    Description: "[NubeTree submission " + createHash("sha256").update("Source: NubeTree contact form\nCompany: Northwind\nPhone: +1 555 123 4567\nCity: Austin\nState: TX\nMessage:\nPlease contact me about an integration project.").digest("hex") + "]\n\nSource: NubeTree contact form\nCompany: Northwind\nPhone: +1 555 123 4567\nCity: Austin\nState: TX\nMessage:\nPlease contact me about an integration project.",
    Website_External_Id__c: externalId
  });
});

test("Salesforce reuses the token and retries a transient Lead upsert", async function () {
  var leadAttempts = 0;
  var tokenAttempts = 0;
  /** @type {typeof fetch} */
  var fetchImpl = async function (url) {
    if (String(url).endsWith("/services/oauth2/token")) {
      tokenAttempts += 1;
      return new Response(JSON.stringify({ access_token: "access-token", instance_url: "https://tenant.example", expires_in: 3600 }), { status: 200 });
    }
    leadAttempts += 1;
    return leadAttempts === 1 ? new Response("temporary", { status: 503 }) : new Response(null, { status: 204 });
  };
  var salesforce = createSalesforce(settings(), fetchImpl);
  var visitor = contact("contact-2");
  await salesforce.upsertContact(visitor);
  await salesforce.upsertContact(visitor);
  assert.equal(leadAttempts, 5);
  assert.equal(tokenAttempts, 1);
});

test("Salesforce errors do not include OAuth response details", async function () {
  /** @type {typeof fetch} */
  var fetchImpl = async function () { return new Response("private OAuth diagnostic", { status: 401 }); };
  var salesforce = createSalesforce(settings(), fetchImpl);
  await assert.rejects(salesforce.upsertContact(contact("contact-3")), function (/** @type {unknown} */ error) {
    var message = error instanceof Error ? error.message : "";
    assert.equal(message, "Salesforce authentication failed");
    assert.equal(message.includes("private OAuth diagnostic"), false);
    return true;
  });
});

test("contact and booking history is appended to the same Lead without duplicate entries", async function () {
  var description = "Existing CRM notes.";
  /** @type {Array<string>} */
  var externalIds = [];
  /** @type {typeof fetch} */
  var fetchImpl = async function (url, init) {
    var address = String(url);
    if (address.endsWith("/services/oauth2/token")) {
      return new Response(JSON.stringify({ access_token: "access-token", instance_url: "https://tenant.example", expires_in: 3600 }), { status: 200 });
    }
    if (init && init.method === "GET") {
      return description === "" ? new Response("not found", { status: 404 }) : new Response(JSON.stringify({ Description: description }), { status: 200 });
    }
    var payload = JSON.parse(String(init && init.body));
    externalIds.push(payload.Website_External_Id__c);
    description = payload.Description;
    return new Response(null, { status: 204 });
  };
  var salesforce = createSalesforce(settings(), fetchImpl);
  await salesforce.upsertContact(contact("contact-4"));
  await salesforce.upsertBooking(booking());
  await salesforce.upsertContact(contact("contact-4"));

  assert.equal(externalIds.length, 3);
  assert.equal(externalIds[0], externalIds[1]);
  assert.equal(externalIds[1], externalIds[2]);
  assert.match(description, /Existing CRM notes\./);
  assert.match(description, /NubeTree contact form/);
  assert.match(description, /NubeTree discovery call booking/);
  assert.match(description, /Appointment \(UTC\): 2026-10-06T15:00:00.000Z/);
  var contactMarker = "[NubeTree submission " + createHash("sha256").update("Source: NubeTree contact form\nCompany: Northwind\nPhone: +1 555 123 4567\nCity: Austin\nState: TX\nMessage:\nPlease contact me about an integration project.").digest("hex") + "]";
  assert.equal(description.split(contactMarker).length - 1, 1);
});