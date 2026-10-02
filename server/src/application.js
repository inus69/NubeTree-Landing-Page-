import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { createGoogleCalendar } from "./calendar.js";
import { createResendEmail } from "./email.js";
import { createPrismaStore } from "./store.js";
import { createServer } from "./server.js";
import { log, setLogListener } from "./log.js";
import { createAlerter } from "./alert.js";
import { createSalesforce } from "./salesforce.js";

var here = dirname(fileURLToPath(import.meta.url));

/** @param {Record<string, string | undefined>} [env] @param {{ root?: string, serveStatic?: boolean }} [options] */
export function createApplication(env, options) {
  var source = env || process.env;
  var config = loadConfig(source);
  var alerter = createAlerter({ url: config.alertWebhookUrl, site: config.siteUrl, onFailure: log });
  setLogListener(alerter.notify);
  var salesforce = createSalesforce(config.salesforce);
  var store = createPrismaStore();
  var server = createServer({
    config: config,
    store: store,
    calendar: createGoogleCalendar(config),
    email: createResendEmail(config),
    salesforce: salesforce,
    root: options && options.root || resolve(here, "../.."),
    serveStatic: options ? options.serveStatic : true
  });
  return { server: server, store: store, alerter: alerter, salesforce: salesforce, config: config };
}