import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { createGoogleCalendar } from "./calendar.js";
import { createResendEmail } from "./email.js";
import { createPrismaStore } from "./store.js";
import { createServer } from "./server.js";
import { log, setLogListener } from "./log.js";
import { createAlerter } from "./alert.js";

var here = dirname(fileURLToPath(import.meta.url));
loadEnvFile(resolve(here, "../../.env"));
var config = loadConfig(process.env);
var alerter = createAlerter({ url: config.alertWebhookUrl, site: config.siteUrl, onFailure: log });
setLogListener(alerter.notify);

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
var store = createPrismaStore();
var server = createServer({
  config: config,
  store: store,
  calendar: createGoogleCalendar(config),
  email: createResendEmail(config),
  root: resolve(here, "../.."),
  serveStatic: true
});

server.requestTimeout = 30000;
server.headersTimeout = 15000;

server.listen(config.port, config.host, function () {
  log("server_listen", { port: config.port });
  var missing = [];
  if (!process.env.DATABASE_URL) missing.push("database");
  if (!(config.calendar.clientId && config.calendar.clientSecret && config.calendar.refreshToken && config.calendar.calendarId)) missing.push("calendar");
  if (!(config.email.apiKey && config.email.from)) missing.push("email");
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
