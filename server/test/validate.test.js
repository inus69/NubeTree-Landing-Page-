import test from "node:test";
import assert from "node:assert/strict";
import { AppError } from "../src/errors.js";
import { bookingInput, contactInput } from "../src/validate.js";

/**
 * @param {unknown} error
 * @param {string[]} names
 */
function rejects(error, names) {
  if (!(error instanceof AppError) || error.code !== "VALIDATION_ERROR" || !error.fields) return false;
  var fields = error.fields;
  return names.every(function (name) { return Boolean(fields[name]); });
}

var booking = {
  name: "Amina Shah",
  email: "Amina@Example.com",
  company: "Northwind",
  phone: "5551234567",
  services: ["API / System Integration"],
  project_stage: "MVP",
  budget: "$25K – $50K",
  timezone: "America/New_York",
  selected_time: "2026-10-06T13:00:00.000Z",
  project_description: "We need the systems to talk to each other."
};

test("booking input normalizes email and rejects a bad timezone", function () {
  var parsed = bookingInput(booking);
  assert.equal(parsed.email, "amina@example.com");
  assert.throws(function () { bookingInput(Object.assign({}, booking, { timezone: "Not/AZone" }));   }, function (/** @type {unknown} */ error) {
    return rejects(error, ["timezone"]);
  });
});

test("contact input rejects a short message and an invalid email", function () {
  assert.throws(function () {
    contactInput({ firstName: "A", lastName: "B", email: "nope", phone: "123", city: "Austin", state: "TX", message: "hi" });
  }, function (/** @type {unknown} */ error) {
    return rejects(error, ["email", "message", "phone"]);
  });
  var parsed = contactInput({
    firstName: " Amina ",
    lastName: "Shah",
    email: "amina@example.com",
    phone: "+1 (555) 123-4567",
    city: "Austin",
    state: "TX",
    company: "",
    message: "We would like to talk about a Salesforce build."
  });
  assert.equal(parsed.firstName, "Amina");
});

test("contact input accepts anti-spam metadata and rejects unexpected properties", function () {
  assert.doesNotThrow(function () {
    contactInput({
      firstName: "Amina",
      lastName: "Shah",
      email: "amina@example.com",
      phone: "+1 555 123 4567",
      city: "Austin",
      state: "TX",
      company: "",
      message: "Please contact me about an integration project.",
      website: "",
      elapsedMs: 15000,
      turnstileToken: "challenge-token"
    });
  });
  assert.throws(function () {
    contactInput({
      firstName: "Amina",
      lastName: "Shah",
      email: "amina@example.com",
      phone: "+1 555 123 4567",
      city: "Austin",
      state: "TX",
      company: "",
      message: "Please contact me about an integration project.",
      isAdmin: true
    });
  }, function (/** @type {unknown} */ error) {
    return error instanceof AppError && error.code === "VALIDATION_ERROR";
  });
});
