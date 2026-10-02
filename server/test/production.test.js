import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { enrichHead, isPublicPath } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { call, listen as listenWith } from "./helpers.js";

/**
 * @param {string | null} [siteUrl]
 * @param {Record<string, string>} [extraEnv]
 */
function listen(siteUrl, extraEnv) {
  return listenWith(Object.assign({ NEXT_PUBLIC_SITE_URL: siteUrl || "http://127.0.0.1" }, extraEnv || {}));
}

test("only public site files are served", function () {
  assert.equal(isPublicPath("/index.html"), true);
  assert.equal(isPublicPath("/assets/booking/booking.js"), true);
  assert.equal(isPublicPath("/assets/videos/services/cloud.mp4"), true);
  assert.equal(isPublicPath("/README.md"), false);
  assert.equal(isPublicPath("/_frame.html"), false);
  assert.equal(isPublicPath("/_chrome_profile/Local State"), false);
  assert.equal(isPublicPath("/.env"), false);
  assert.equal(isPublicPath("/server/src/config.js"), false);
  assert.equal(isPublicPath("/assets/videos/services/PROMPTS.txt"), false);
  assert.equal(isPublicPath("/assets/../.env"), false);
});

test("private files stay private and the home page has no template origin", async function () {
  var homeFile = readFileSync(resolve(import.meta.dirname, "../../index.html"), "utf8");
  assert.equal(homeFile.indexOf("hanzo.framer.website"), -1);
  assert.equal(homeFile.indexOf("events.framer.com"), -1);
  var running = await listen();
  var env = await fetch(running.origin + "/.env");
  var envText = await env.text();
  var readme = await fetch(running.origin + "/README.md");
  var missing = await fetch(running.origin + "/this-page-is-not-real");
  var missingText = await missing.text();
  var home = await fetch(running.origin + "/");
  assert.equal(env.status, 404);
  assert.equal(envText.indexOf("DATABASE_URL"), -1);
  assert.equal(readme.status, 404);
  assert.equal(missing.status, 404);
  assert.equal(missingText.indexOf("This page is not available.") !== -1, true);
  assert.equal(home.status, 200);
  assert.equal(String(home.headers.get("content-security-policy") || "").indexOf("default-src 'self'") !== -1, true);
  assert.equal(home.headers.get("cache-control"), "no-cache");
  running.server.close();
});

test("every link on every page goes somewhere real", function () {
  var siteRoot = resolve(import.meta.dirname, "../..");
  var names = readdirSync(siteRoot).filter(function (name) { return name.endsWith(".html"); });
  /** @type {Record<string, string>} */
  var sources = {};
  names.forEach(function (name) { sources[name] = readFileSync(resolve(siteRoot, name), "utf8"); });
  /** @type {string[]} */
  var problems = [];
  names.forEach(function (name) {
    var anchors = sources[name].match(/<a\b[^>]*>/gi) || [];
    anchors.forEach(function (tag) {
      var found = tag.match(/\shref="([^"]*)"/i);
      var href = found ? found[1] : null;
      if (href === null || href === "" || href === "#" || /^javascript:/i.test(href)) {
        problems.push(name + ": placeholder link " + tag);
        return;
      }
      if (/target="_blank"/i.test(tag) && !/rel="[^"]*noopener/i.test(tag)) problems.push(name + ": new tab without noopener " + href);
      if (/^mailto:/i.test(href)) {
        problems.push(name + ": browser email client link is not allowed " + href);
        return;
      }
      if (/^tel:/i.test(href)) {
        if (href !== "tel:+918294236403") problems.push(name + ": unexpected phone " + href);
        return;
      }
      if (/^https?:/i.test(href)) return;
      var parts = href.split("#");
      var file = parts[0].split("?")[0].replace(/^\//, "");
      if (file === "" || file === "./") file = parts[0] === "" ? name : "index.html";
      if (!sources[file]) {
        problems.push(name + ": missing page " + href);
        return;
      }
      if (parts[1] && sources[file].indexOf('id="' + parts[1] + '"') === -1) problems.push(name + ": missing anchor " + href);
    });
  });
  assert.deepEqual(problems, []);
});

test("pages run no inline script, so the policy can forbid it", async function () {
  var siteRoot = resolve(import.meta.dirname, "../..");
  readdirSync(siteRoot).filter(function (name) { return name.endsWith(".html"); }).forEach(function (name) {
    var html = readFileSync(resolve(siteRoot, name), "utf8");
    var inline = (html.match(/<script\b[^>]*>/gi) || []).filter(function (tag) { return !/\ssrc=/i.test(tag) && !/type="application\/ld\+json"/i.test(tag); });
    assert.deepEqual(inline, [], name + " has an inline script");
    assert.equal(/\son[a-z]+\s*=\s*["']/i.test(html), false, name + " has an inline event handler");
    assert.equal(/javascript:/i.test(html), false, name + " has a javascript: URL");
  });
  var running = await listen();
  var home = await fetch(running.origin + "/");
  await home.text();
  running.server.close();
  var policy = String(home.headers.get("content-security-policy"));
  var scriptRule = policy.split(";").map(function (part) { return part.trim(); }).filter(function (part) { return part.indexOf("script-src") === 0; })[0];
  assert.equal(scriptRule, "script-src 'self'");
});

test("server secrets never reach the browser", async function () {
  var secrets = {
    DATABASE_URL: "postgresql://leak-user:leak-db-password@db.internal:5432/leak",
    CALENDAR_CLIENT_ID: "leak-calendar-client-id",
    CALENDAR_CLIENT_SECRET: "leak-calendar-client-secret",
    CALENDAR_REFRESH_TOKEN: "leak-calendar-refresh-token",
    CALENDAR_WEBHOOK_SECRET: "leak-calendar-webhook-secret",
    EMAIL_API_KEY: "leak-email-api-key",
    SALESFORCE_CLIENT_ID: "leak-salesforce-client-id",
    SALESFORCE_CLIENT_SECRET: "leak-salesforce-client-secret",
    TURNSTILE_SECRET: "leak-turnstile-secret",
    TURNSTILE_SITE_KEY: "public-turnstile-site-key"
  };
  var running = await listen(null, secrets);
  var paths = ["/", "/contact.html", "/discovery-call.html", "/cancel.html", "/assets/booking/config.js", "/assets/booking/booking.js", "/assets/turnstile.js", "/api/health", "/not-a-page"];
  var bodies = await Promise.all(paths.map(async function (path) {
    var res = await fetch(running.origin + path);
    return JSON.stringify(Array.from(res.headers.entries())) + await res.text();
  }));
  running.server.close();
  var all = bodies.join("\n");
  assert.equal(all.indexOf("public-turnstile-site-key") !== -1, true);
  assert.equal(all.indexOf("leak-"), -1);
});

test("videos answer byte-range requests", async function () {
  var running = await listen();
  var res = await fetch(running.origin + "/assets/videos/services/cloud.mp4", { headers: { Range: "bytes=0-99" } });
  var body = Buffer.from(await res.arrayBuffer());
  assert.equal(res.status, 206);
  assert.equal(res.headers.get("accept-ranges"), "bytes");
  assert.equal(body.length, 100);
  var bad = await fetch(running.origin + "/assets/videos/services/cloud.mp4", { headers: { Range: "bytes=999999999-" } });
  await bad.arrayBuffer();
  assert.equal(bad.status, 416);
  running.server.close();
});

test("text files are compressed and cached", async function () {
  var running = await listen();
  var res = await fetch(running.origin + "/styles.css", { headers: { "Accept-Encoding": "gzip" } });
  await res.text();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-encoding"), "gzip");
  assert.equal(res.headers.get("cache-control"), "public, max-age=3600");
  var again = await fetch(running.origin + "/styles.css", { headers: { "If-None-Match": String(res.headers.get("etag")) } });
  assert.equal(again.status, 304);
  running.server.close();
});

test("pages load no fonts or images from other sites", async function () {
  var running = await listen();
  var res = await fetch(running.origin + "/");
  var html = await res.text();
  var css = await (await fetch(running.origin + "/styles.css")).text();
  var font = await fetch(running.origin + "/assets/fonts/fonts.css");
  await font.text();
  assert.equal(/framerusercontent\.com|fonts\.googleapis\.com|fonts\.gstatic\.com/.test(html + css), false);
  assert.equal(font.status, 200);
  assert.equal(String(res.headers.get("content-security-policy")).indexOf("challenges.cloudflare.com"), -1);
  running.server.close();
});

test("Turnstile stays off unless both keys are set", function () {
  assert.equal(loadConfig({ TURNSTILE_SECRET: "secret" }).turnstileSecret, "");
  assert.equal(loadConfig({ TURNSTILE_SITE_KEY: "site" }).turnstileSiteKey, "");
  var both = loadConfig({ TURNSTILE_SECRET: "secret", TURNSTILE_SITE_KEY: "site" });
  assert.equal(both.turnstileSecret, "secret");
  assert.equal(both.turnstileSiteKey, "site");
});

test("Salesforce sync is mandatory in production and opt-in during local development", function () {
  assert.equal(loadConfig({ NODE_ENV: "production" }).salesforce.required, true);
  assert.equal(loadConfig({}).salesforce.required, false);
  assert.equal(loadConfig({ SALESFORCE_REQUIRED: "true" }).salesforce.required, true);
});

test("Vercel trusts its forwarded client IP for rate limiting", function () {
  assert.equal(loadConfig({}).trustProxy, false);
  assert.equal(loadConfig({ VERCEL: "1" }).trustProxy, true);
  assert.equal(loadConfig({ TRUST_PROXY: "true" }).trustProxy, true);
});

test("Turnstile is rendered and enforced when configured", async function () {
  var running = await listen(null, { TURNSTILE_SECRET: "secret", TURNSTILE_SITE_KEY: "site-key-123" });
  var page = await fetch(running.origin + "/contact.html");
  var html = await page.text();
  assert.equal(html.indexOf('<meta name="nt-turnstile-site-key" content="site-key-123">') !== -1, true);
  assert.equal(String(page.headers.get("content-security-policy")).indexOf("frame-src https://challenges.cloudflare.com") !== -1, true);
  var missing = await fetch(running.origin + "/api/contact", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ firstName: "A" })
  });
  assert.equal(missing.status, 400);
  var realFetch = globalThis.fetch;
  globalThis.fetch = async function (url, options) {
    if (String(url).indexOf("challenges.cloudflare.com") !== -1) return new Response(JSON.stringify({ success: false }));
    return realFetch(url, options);
  };
  try {
    var rejected = await call(running.port, "POST", "/api/contact", { firstName: "A", turnstileToken: "bad" });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.json.code, "SECURITY_CHECK_FAILED");
  } finally {
    globalThis.fetch = realFetch;
  }
  running.server.close();
});

test("https sites get canonical links, Open Graph tags, and HSTS", async function () {
  var page = '<html><head><title>Contact Us — NubeTree</title><meta name="description" content="Reach the team."></head><body></body></html>';
  var enriched = enrichHead(page, "https://www.example.com", "/contact.html");
  assert.equal(enriched.indexOf('<link rel="canonical" href="https://www.example.com/contact.html">') !== -1, true);
  assert.equal(enriched.indexOf('property="og:title" content="Contact Us — NubeTree"') !== -1, true);
  assert.equal(enriched.indexOf('property="og:description" content="Reach the team."') !== -1, true);
  var hidden = enrichHead('<html><head><title>x</title><meta name="robots" content="noindex"></head></html>', "https://www.example.com", "/cancel.html");
  assert.equal(hidden.indexOf("canonical"), -1);
  var running = await listen("https://www.example.com");
  var res = await fetch(running.origin + "/contact.html");
  await res.text();
  assert.equal(String(res.headers.get("strict-transport-security") || "").indexOf("max-age=31536000") !== -1, true);
  running.server.close();
});
