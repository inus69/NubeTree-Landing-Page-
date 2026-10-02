import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createApplication } from "./application.js";
import { log } from "./log.js";

var here = dirname(fileURLToPath(import.meta.url));
loadEnvFile(resolve(here, "../../.env"));
var app = createApplication(process.env);
var config = app.config;
var server = app.server;
var store = app.store;
var alerter = app.alerter;
var salesforce = app.salesforce;

/** @param {string} path */
function loadEnvFile(path) {
  if (!existsSync(path)) return;
  readFileSync(path, "utf8").split(/\r?\n/).forEach(function (line) {
    var trimmed = line.trim();
    if (!trimmed || trimmed.charAt(0) === "#") return;
    var eq = trimmed.indexOf("=");
    if (eq < 1) return;
    var key = trimmed.slice(0, eq).trim();
    if (process.env[key]) return;
    var value = trimmed.slice(eq + 1).trim();
    if ((value.charAt(0) === '"' && value.charAt(value.length - 1) === '"') || (value.charAt(0) === "'" && value.charAt(value.length - 1) === "'")) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  });
}
server.requestTimeout = 30000;
server.headersTimeout = 15000;

server.listen(config.port, config.host, function () {
  log("server_listen", { port: config.port });
  var missing = [];
  if (!process.env.DATABASE_URL) missing.push("database");
  if (!(config.calendar.clientId && config.calendar.clientSecret && config.calendar.refreshToken && config.calendar.calendarId)) missing.push("calendar");
  if (!(config.email.apiKey && config.email.from)) missing.push("email");
  if (!salesforce.configured()) missing.push("salesforce");
  if (missing.length) log("integrations_missing", { missing: missing.join(",") });
});

var stopping = false;

/** @param {string} signal */
function stop(signal) {
  if (stopping) return;
  stopping = true;
  log("server_stopping", { signal: signal });
  var force = setTimeout(function () { process.exit(1); }, 10000);
  force.unref();
  server.close(function () {
    Promise.all([store.disconnect().catch(function () {}), alerter.flush(3000)]).then(function () { process.exit(0); });
  });
}

process.on("SIGTERM", function () { stop("SIGTERM"); });
process.on("SIGINT", function () { stop("SIGINT"); });
process.on("unhandledRejection", function (reason) {
  log("unhandled_rejection", { error: reason instanceof Error ? reason.name : "unknown" });
});
process.on("uncaughtException", function (error) {
  log("uncaught_exception", { error: error.name || "unknown" });
  stop("uncaughtException");
});
