import { createHash } from "node:crypto";

/**
 * @typedef {object} SalesforceSettings
 * @property {string} loginUrl
 * @property {string} clientId
 * @property {string} clientSecret
 * @property {string} externalIdField
 * @property {string} apiVersion
 * @property {boolean} required
 */

/** @param {unknown} value @returns {Promise<Record<string, unknown>>} */
async function json(value) {
  try {
    var body = await /** @type {Response} */ (value).json();
    return body && typeof body === "object" ? /** @type {Record<string, unknown>} */ (body) : {};
  } catch {
    return {};
  }
}

/** @param {SalesforceSettings} settings @param {typeof fetch} [fetchImpl] */
export function createSalesforce(settings, fetchImpl) {
  var http = fetchImpl || fetch;
  var tokenValue = "";
  var instanceUrl = "";
  var tokenExpiresAt = 0;
  /** @type {Promise<void> | null} */
  var tokenRequest = null;

  function configured() {
    return Boolean(settings.clientId && settings.clientSecret && settings.externalIdField);
  }

  function required() {
    return settings.required;
  }

  /** @param {string} email */
  function leadId(email) {
    return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
  }

  async function accessToken() {
    if (tokenValue && Date.now() < tokenExpiresAt) return;
    if (tokenRequest) return tokenRequest;
    tokenRequest = (async function () {
      var response = await http(settings.loginUrl.replace(/\/$/, "") + "/services/oauth2/token", {
        method: "POST",
        signal: AbortSignal.timeout(10000),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: settings.clientId,
          client_secret: settings.clientSecret
        })
      });
      var body = await json(response);
      if (!response.ok || typeof body.access_token !== "string" || typeof body.instance_url !== "string") {
        throw new Error("Salesforce authentication failed");
      }
      tokenValue = body.access_token;
      instanceUrl = body.instance_url.replace(/\/$/, "");
      var expiresIn = Number(body.expires_in);
      tokenExpiresAt = Date.now() + (Number.isFinite(expiresIn) ? Math.max(0, expiresIn - 60) : 300) * 1000;
    })();
    try {
      await tokenRequest;
    } finally {
      tokenRequest = null;
    }
  }

  /** @param {string} externalId @param {Record<string, string>} fields */
  async function upsertLead(externalId, fields) {
    if (!configured()) {
      if (required()) throw new Error("Salesforce is not configured");
      return;
    }
    var sourceDetails = fields.Description || "";
    var marker = "[NubeTree submission " + createHash("sha256").update(sourceDetails).digest("hex") + "]";
    var attempt = 0;
    while (attempt < 2) {
      attempt += 1;
      await accessToken();
      var url = instanceUrl + "/services/data/v" + settings.apiVersion + "/sobjects/Lead/" +
        encodeURIComponent(settings.externalIdField) + "/" + encodeURIComponent(externalId);
      var existing;
      try {
        existing = await http(url + "?fields=Description", {
          method: "GET",
          signal: AbortSignal.timeout(10000),
          headers: { Authorization: "Bearer " + tokenValue }
        });
      } catch (error) {
        if (attempt === 2) throw error;
        continue;
      }
      if (existing.status === 401 && attempt === 1) {
        tokenValue = "";
        tokenExpiresAt = 0;
        continue;
      }
      if ((existing.status === 429 || existing.status >= 500) && attempt === 1) {
        await new Promise(function (done) { setTimeout(done, 250); });
        continue;
      }
      var previous = "";
      if (existing.status !== 404) {
        if (!existing.ok) throw new Error("Salesforce Lead lookup failed");
        var current = await json(existing);
        previous = typeof current.Description === "string" ? current.Description : "";
      }
      var description = previous.includes(marker) ? previous : [previous, marker, sourceDetails].filter(Boolean).join("\n\n");
      if (description.length > 32000) throw new Error("Salesforce Lead description limit exceeded");
      var payload = Object.assign({}, fields, {
        Description: description,
        [settings.externalIdField]: externalId
      });
      var response;
      try {
        response = await http(url, {
          method: "PATCH",
          signal: AbortSignal.timeout(10000),
          headers: {
            Authorization: "Bearer " + tokenValue,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(payload)
        });
      } catch (error) {
        if (attempt === 2) throw error;
        continue;
      }
      if (response.status === 401 && attempt === 1) {
        tokenValue = "";
        tokenExpiresAt = 0;
        continue;
      }
      if ((response.status === 429 || response.status >= 500) && attempt === 1) {
        await new Promise(function (done) { setTimeout(done, 250); });
        continue;
      }
      if (!response.ok) throw new Error("Salesforce Lead upsert failed");
      return;
    }
  }

  /** @param {import("./types.js").ContactSubmission} contact */
  async function upsertContact(contact) {
    await upsertLead(leadId(contact.email), {
      FirstName: contact.firstName,
      LastName: contact.lastName,
      Company: contact.company || "Website inquiry",
      Email: contact.email,
      Phone: contact.phone,
      City: contact.city,
      State: contact.state,
      LeadSource: "Website",
      Description: [
        "Source: NubeTree contact form",
        "Company: " + (contact.company || ""),
        "Phone: " + (contact.phone || ""),
        "City: " + (contact.city || ""),
        "State: " + (contact.state || ""),
        "Message:",
        contact.message
      ].join("\n")
    });
  }

  /** @param {import("./types.js").Booking} booking */
  async function upsertBooking(booking) {
    var parts = booking.name.trim().split(/\s+/);
    var lastName = parts.length > 1 ? parts.pop() || "Website inquiry" : parts[0] || "Website inquiry";
    var firstName = parts.length ? parts.join(" ") : "";
    await upsertLead(leadId(booking.email), {
      FirstName: firstName,
      LastName: lastName,
      Company: booking.company || "Website inquiry",
      Email: booking.email,
      Phone: booking.phone,
      LeadSource: "Website",
      Description: [
        "Source: NubeTree discovery call booking",
        "Services: " + (booking.services || ""),
        "Project stage: " + (booking.projectStage || ""),
        "Budget: " + (booking.budget || ""),
        "Project description:",
        booking.message || "",
        "Appointment (UTC): " + booking.startTime.toISOString(),
        "Visitor timezone: " + booking.timezone,
        "Booking status: " + booking.status
      ].join("\n")
    });
  }

  return { configured: configured, required: required, upsertContact: upsertContact, upsertBooking: upsertBooking };
}