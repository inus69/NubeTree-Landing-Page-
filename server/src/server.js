import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { gzipSync } from "node:zlib";
import { availability, book, cancel, reschedule, submitContact } from "./bookingFlow.js";
import { asRecord, assertZone } from "./validate.js";
import { AppError, methodNotAllowed } from "./errors.js";
import { log } from "./log.js";

/**
 * @typedef {import("node:http").IncomingMessage} Request
 * @typedef {import("node:http").ServerResponse} Response
 * @typedef {import("./types.js").Config} Config
 * @typedef {import("./types.js").Deps} Deps
 * @typedef {Record<string, string | number>} HeaderMap
 */

/** @type {Record<string, string>} */
var TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".mp4": "video/mp4",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2"
};

/** @type {HeaderMap} */
var SECURITY = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "SAMEORIGIN",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy": csp("")
};

var TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

/** @param {string} extra */
function csp(extra) {
  var script = extra ? " " + extra : "";
  var frame = extra ? extra : "'none'";
  return "default-src 'self'; script-src 'self'" + script
    + "; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'"
    + "; frame-src " + frame + "; object-src 'none'; base-uri 'self'; form-action 'self'";
}

/** @param {Config} config */
function siteOrigin(config) {
  return String(config.siteUrl || "").replace(/\/$/, "");
}

/**
 * @param {Response} res
 * @param {number} status
 * @param {unknown} body
 * @param {HeaderMap} [extra]
 */
function send(res, status, body, extra) {
  var payload = JSON.stringify(body);
  res.writeHead(status, Object.assign({}, SECURITY, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store"
  }, extra || {}));
  res.end(payload);
}

/**
 * @param {Response} res
 * @param {unknown} data
 * @param {number} [status]
 */
function ok(res, data, status) {
  send(res, status || 200, { success: true, data: data });
}

/**
 * Only AppError text reaches the browser. Anything else, such as a database or network error,
 * is logged here with its name and a short message, and the visitor gets a generic 500.
 * @param {Response} res
 * @param {unknown} error
 * @param {string} requestId
 */
function fail(res, error, requestId) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  if (error instanceof AppError) {
    if (error.code === "VALIDATION_ERROR" || error.code === "INVALID_JSON") {
      log("validation_failure", { requestId: requestId, code: error.code });
    }
    send(res, error.status, {
      success: false,
      code: error.code,
      message: error.message,
      fields: error.code === "VALIDATION_ERROR" ? error.fields || {} : error.fields || undefined,
      requestId: error.status >= 500 ? requestId : undefined
    }, error.allow ? { Allow: error.allow } : error.status === 413 ? { Connection: "close" } : undefined);
    return;
  }
  log("server_error", {
    requestId: requestId,
    error: error instanceof Error ? error.name : typeof error
  });
  send(res, 500, { success: false, code: "INTERNAL_ERROR", message: "Something went wrong. Please try again.", requestId: requestId });
}

/**
 * @param {Request} req
 */
function requireJson(req) {
  var type = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") {
    throw new AppError("UNSUPPORTED_MEDIA_TYPE", 415, "Send the request as JSON.");
  }
}

var BODY_LIMIT = 20000;

/**
 * @param {Request} req
 * @returns {Promise<unknown>}
 */
function readBody(req) {
  var tooLarge = new AppError("PAYLOAD_TOO_LARGE", 413, "The request is too large.");
  return new Promise(function (resolveBody, reject) {
    if (Number(req.headers["content-length"]) > BODY_LIMIT) {
      req.resume();
      reject(tooLarge);
      return;
    }
    /** @type {Buffer[]} */
    var chunks = [];
    var size = 0;
    // An oversized stream is drained, not destroyed, so the client still receives the 413.
    // requestTimeout bounds how long a sender can keep streaming.
    req.on("data", function (/** @type {Buffer} */ chunk) {
      size += chunk.length;
      if (size > BODY_LIMIT) chunks = [];
      else chunks.push(chunk);
    });
    req.on("end", function () {
      if (size > BODY_LIMIT) return reject(tooLarge);
      if (!chunks.length) return resolveBody({});
      try { resolveBody(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { reject(new AppError("INVALID_JSON", 400, "The request could not be read.")); }
    });
    req.on("error", reject);
  });
}

/**
 * @param {Request} req
 * @param {Config} config
 */
function allowedOrigin(req, config) {
  var origin = req.headers.origin;
  if (!origin) return true;
  if (origin === siteOrigin(config)) return true;
  var local = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/;
  return local.test(siteOrigin(config)) && local.test(origin);
}

/**
 * @param {Config} config
 * @param {unknown} token
 * @param {string} ip
 */
async function turnstile(config, token, ip) {
  if (!config.turnstileSecret) return;
  if (!token) throw new AppError("SECURITY_CHECK_FAILED", 400, "Please complete the security check and try again.");
  var body = new URLSearchParams({ secret: config.turnstileSecret, response: String(token).slice(0, 2048), remoteip: ip || "" });
  var json;
  try {
    var res = await fetch(TURNSTILE_ORIGIN + "/turnstile/v0/siteverify", { method: "POST", body: body, signal: AbortSignal.timeout(8000) });
    json = asRecord(await res.json());
  } catch (error) {
    log("turnstile_failure", { error: error instanceof Error ? error.name : "unknown" });
    throw new AppError("SECURITY_CHECK_FAILED", 503, "The security check is unavailable right now. Please try again.");
  }
  if (json.success !== true) throw new AppError("SECURITY_CHECK_FAILED", 400, "Please complete the security check and try again.");
}

/**
 * @param {Request} req
 * @param {boolean} trustProxy
 */
function clientIp(req, trustProxy) {
  if (trustProxy) {
    var forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    if (forwarded) return forwarded;
  }
  return req.socket.remoteAddress || "unknown";
}

var ROOT_FILE = /^\/[a-z0-9][a-z0-9-]*\.(html|css|svg)$/;
var ASSET_FILE = /^\/assets\/[a-z0-9][a-z0-9/_.-]*\.(css|js|json|png|jpe?g|webp|svg|mp4|woff2|ico)$/;
var COMPRESSIBLE = /\.(html|css|js|json|svg|xml|txt)$/;
/** @type {Map<string, Buffer>} */
var gzipCache = new Map();

/** @param {string} pathname */
export function isPublicPath(pathname) {
  if (pathname.indexOf("..") !== -1 || pathname.indexOf("//") !== -1) return false;
  var lower = pathname.toLowerCase();
  if (lower !== pathname) return false;
  return ROOT_FILE.test(pathname) || ASSET_FILE.test(pathname);
}

/** @param {Config} config */
function publicOrigin(config) {
  var site = siteOrigin(config);
  if (!site.startsWith("https://")) return "";
  return site;
}

/**
 * @param {Config} config
 * @param {HeaderMap} [extra]
 * @returns {HeaderMap}
 */
function headers(config, extra) {
  var base = Object.assign({}, SECURITY);
  if (config.turnstileSiteKey) base["Content-Security-Policy"] = csp(TURNSTILE_ORIGIN);
  if (publicOrigin(config)) base["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
  return Object.assign(base, extra || {});
}

/** @param {string} value */
function attr(value) {
  return String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/** @param {string} value */
function decodeEntities(value) {
  return String(value).replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

/**
 * @param {string} html
 * @param {string} origin
 * @param {string} pathname
 * @param {string} [turnstileSiteKey]
 */
export function enrichHead(html, origin, pathname, turnstileSiteKey) {
  var tags = "";
  if (turnstileSiteKey) tags += '<meta name="nt-turnstile-site-key" content="' + attr(turnstileSiteKey) + '">';
  if (html.indexOf('property="og:title"') === -1) {
    var title = html.match(/<title>([^<]*)<\/title>/);
    var description = html.match(/<meta name="description" content="([^"]*)"/);
    if (title) {
      var titleText = attr(decodeEntities(title[1]));
      tags += '<meta property="og:type" content="website"><meta property="og:site_name" content="NubeTree">'
        + '<meta property="og:title" content="' + titleText + '"><meta name="twitter:card" content="summary">'
        + '<meta name="twitter:title" content="' + titleText + '">';
    }
    if (description) {
      tags += '<meta property="og:description" content="' + description[1] + '"><meta name="twitter:description" content="' + description[1] + '">';
    }
  }
  if (origin && html.indexOf('rel="canonical"') === -1 && html.indexOf('name="robots" content="noindex"') === -1) {
    var href = attr(origin + (pathname === "/index.html" ? "/" : pathname));
    tags += '<link rel="canonical" href="' + href + '"><meta property="og:url" content="' + href + '">';
  }
  return tags ? html.replace("</head>", tags + "</head>") : html;
}

/** @param {string} pathname */
function cacheControl(pathname) {
  if (/\.html$/.test(pathname)) return "no-cache";
  if (/\.(css|js|json)$/.test(pathname)) return "public, max-age=3600";
  return "public, max-age=604800";
}

/** @param {Request} req */
function acceptsGzip(req) {
  return /\bgzip\b/.test(String(req.headers["accept-encoding"] || ""));
}

/**
 * @param {string} key
 * @param {Buffer} body
 */
function gzipped(key, body) {
  var hit = gzipCache.get(key);
  if (hit) return hit;
  var packed = gzipSync(body);
  if (gzipCache.size > 200) gzipCache.clear();
  gzipCache.set(key, packed);
  return packed;
}

/**
 * @param {string} value
 * @param {number} size
 * @returns {{ start: number, end: number, invalid: boolean } | null}
 */
function parseRange(value, size) {
  var match = /^bytes=(\d*)-(\d*)$/.exec(String(value || "").trim());
  if (!match || (match[1] === "" && match[2] === "")) return null;
  var start;
  var end;
  if (match[1] === "") {
    start = Math.max(0, size - Number(match[2]));
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  }
  return { start: start, end: end, invalid: start > end || start >= size };
}

var PUBLIC_PAGES = [
  "/",
  "/contact.html",
  "/discovery-call.html",
  "/privacy.html",
  "/terms.html",
  "/case-lendingpoint.html",
  "/case-hsc.html",
  "/case-neighborworks.html",
  "/case-washington-center.html",
  "/case-university-hospital.html",
  "/case-insight-medical-genetics.html"
];

/**
 * @param {Response} res
 * @param {number} status
 * @param {string} type
 * @param {string} body
 * @param {Config} config
 */
function sendText(res, status, type, body, config) {
  res.writeHead(status, headers(config, {
    "Content-Type": type,
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store"
  }));
  res.end(body);
}

/**
 * @param {string} root
 * @param {Request} req
 * @param {Response} res
 * @param {Config} config
 */
function missingPage(root, req, res, config) {
  var file = join(root, "404.html");
  var body = existsSync(file) ? readFileSync(file) : Buffer.from("Not found");
  res.writeHead(404, headers(config, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "no-store"
  }));
  res.end(req.method === "HEAD" ? undefined : body);
}

/**
 * @param {string} root
 * @param {Request} req
 * @param {Response} res
 * @param {Config} config
 */
function serveStatic(root, req, res, config) {
  var url = new URL(req.url || "/", "http://127.0.0.1");
  var pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    missingPage(root, req, res, config);
    return;
  }
  if (pathname === "/") pathname = "/index.html";
  var file = normalize(join(root, pathname));
  if (!isPublicPath(pathname) || !file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
    missingPage(root, req, res, config);
    return;
  }
  var stat = statSync(file);
  var type = TYPES[extname(file).toLowerCase()] || "application/octet-stream";
  var tag = '"' + stat.size.toString(36) + "-" + Math.floor(stat.mtimeMs).toString(36) + '"';
  /** @type {HeaderMap} */
  var base = {
    "Content-Type": type,
    "Cache-Control": cacheControl(pathname),
    "Last-Modified": stat.mtime.toUTCString(),
    ETag: tag,
    Vary: "Accept-Encoding"
  };
  if (req.headers["if-none-match"] === tag) {
    res.writeHead(304, headers(config, base));
    res.end();
    return;
  }
  var head = req.method === "HEAD";
  if (COMPRESSIBLE.test(pathname)) {
    /** @type {Buffer} */
    var body = readFileSync(file);
    var siteKey = config.turnstileSiteKey;
    if (type.indexOf("text/html") === 0) body = Buffer.from(enrichHead(body.toString("utf8"), publicOrigin(config), pathname, siteKey));
    if (acceptsGzip(req) && body.length > 1024) {
      body = gzipped(pathname + tag + publicOrigin(config) + siteKey, body);
      base["Content-Encoding"] = "gzip";
    }
    base["Content-Length"] = body.length;
    res.writeHead(200, headers(config, base));
    res.end(head ? undefined : body);
    return;
  }
  base["Accept-Ranges"] = "bytes";
  var range = req.headers.range ? parseRange(req.headers.range, stat.size) : null;
  if (range && range.invalid) {
    res.writeHead(416, headers(config, { "Content-Range": "bytes */" + stat.size }));
    res.end();
    return;
  }
  if (range) {
    base["Content-Range"] = "bytes " + range.start + "-" + range.end + "/" + stat.size;
    base["Content-Length"] = range.end - range.start + 1;
    res.writeHead(206, headers(config, base));
    if (head) res.end();
    else createReadStream(file, { start: range.start, end: range.end }).pipe(res);
    return;
  }
  base["Content-Length"] = stat.size;
  res.writeHead(200, headers(config, base));
  if (head) res.end();
  else createReadStream(file).pipe(res);
}

/**
 * @param {unknown} given
 * @param {string} expected
 */
function sameSecret(given, expected) {
  var a = Buffer.from(String(given || ""));
  var b = Buffer.from(String(expected || ""));
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * @param {Deps} deps
 * @param {string} name
 * @param {string} ip
 * @param {number} [max]
 */
async function limit(deps, name, ip, max) {
  if (!(await deps.store.hitRate(name + ":" + ip, max || deps.config.rateLimit.max, deps.config.rateLimit.windowSeconds))) {
    log("rate_limit", { requestId: deps.requestId, route: name });
    throw new AppError("RATE_LIMITED", 429, "Too many requests. Please try again later.");
  }
}

/** @param {Deps} deps */
export function createServer(deps) {
  var root = resolve(deps.root || ".");
  return createHttpServer(function (req, res) {
    var requestId = randomUUID();
    res.setHeader("X-Request-Id", requestId);
    if (publicOrigin(deps.config)) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    var depsWithId = Object.assign({}, deps, { requestId: requestId });
    handle(req, res, depsWithId, root).catch(function (error) { fail(res, error, requestId); });
  });
}

var CANCEL_PREFIX = "/api/discovery-call/cancel/";

/**
 * @param {Request} req
 * @param {string} path
 */
function needsSameOrigin(req, path) {
  var cancelPath = path.indexOf(CANCEL_PREFIX) === 0;
  if (req.method === "DELETE") return cancelPath;
  if (req.method !== "POST") return false;
  return cancelPath || path === "/api/discovery-call/book" || path === "/api/discovery-call/reschedule" || path === "/api/contact";
}

/**
 * @param {Request} req
 * @param {Response} res
 * @param {Deps} deps
 * @param {string} root
 */
async function handle(req, res, deps, root) {
  var url = new URL(req.url || "/", "http://127.0.0.1");
  var path = url.pathname;
  var ip = clientIp(req, deps.config.trustProxy);
  if (req.method === "GET" && path === "/api/health") {
    var database;
    try {
      database = await deps.store.ping();
    } catch {
      database = "unavailable";
    }
    var ready = database === "ok";
    send(res, ready ? 200 : 503, { success: ready, data: { database: database } });
    return;
  }
  if (req.method === "GET" && path === "/robots.txt") {
    sendText(res, 200, "text/plain; charset=utf-8", "User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /cancel.html\n\nSitemap: " + siteOrigin(deps.config) + "/sitemap.xml\n", deps.config);
    return;
  }
  if (req.method === "GET" && path === "/sitemap.xml") {
    var site = siteOrigin(deps.config);
    var body = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
      + PUBLIC_PAGES.map(function (page) { return "  <url><loc>" + site + page + "</loc></url>"; }).join("\n")
      + "\n</urlset>\n";
    sendText(res, 200, "application/xml; charset=utf-8", body, deps.config);
    return;
  }
  if (req.method === "GET" && path === "/api/discovery-call/availability") {
    await limit(deps, "availability", ip, deps.config.rateLimit.availabilityMax);
    var timezone = assertZone(url.searchParams.get("timezone") || deps.config.bookingTimezone);
    var data = await availability(deps, {
      timezone: timezone,
      year: url.searchParams.get("year"),
      month: url.searchParams.get("month")
    });
    ok(res, data);
    return;
  }
  if (needsSameOrigin(req, path) && !allowedOrigin(req, deps.config)) {
    throw new AppError("FORBIDDEN", 403, "This request is not allowed.");
  }
  if (req.method === "POST" && path === "/api/discovery-call/book") {
    await limit(deps, "book", ip);
    requireJson(req);
    var bookingBody = await readBody(req);
    await turnstile(deps.config, asRecord(bookingBody).turnstileToken, ip);
    var booked = await book(deps, bookingBody, String(req.headers["idempotency-key"] || "").replace(/[^A-Za-z0-9-]/g, "").slice(0, 80));
    ok(res, booked.data, booked.created ? 201 : 200);
    return;
  }
  if (req.method === "POST" && path === "/api/discovery-call/reschedule") {
    await limit(deps, "reschedule", ip);
    requireJson(req);
    var moveBody = await readBody(req);
    ok(res, await reschedule(deps, moveBody));
    return;
  }
  if ((req.method === "DELETE" || req.method === "POST") && path.indexOf(CANCEL_PREFIX) === 0) {
    await limit(deps, "cancel", ip);
    ok(res, await cancel(deps, path.slice(CANCEL_PREFIX.length)));
    return;
  }
  if (req.method === "POST" && path === "/api/contact") {
    await limit(deps, "contact", ip);
    requireJson(req);
    var contactBody = await readBody(req);
    await turnstile(deps.config, asRecord(contactBody).turnstileToken, ip);
    var contacted = await submitContact(deps, contactBody, String(req.headers["idempotency-key"] || "").replace(/[^A-Za-z0-9-]/g, "").slice(0, 80));
    ok(res, contacted.data, contacted.created ? 201 : 200);
    return;
  }
  if (req.method === "POST" && path === "/api/webhooks/calendar") {
    var secret = deps.config.calendar.webhookSecret;
    if (!secret || !sameSecret(req.headers["x-webhook-secret"], secret)) {
      throw new AppError("UNAUTHORIZED", 401, "Not authorized.");
    }
    log("calendar_webhook", { requestId: deps.requestId });
    ok(res, { received: true });
    return;
  }
  if ((req.method === "GET" || req.method === "HEAD") && deps.serveStatic !== false && path.indexOf("/api/") !== 0) {
    serveStatic(root, req, res, deps.config);
    return;
  }
  var allow = API_METHODS[path] || (path.indexOf(CANCEL_PREFIX) === 0 && path.length > CANCEL_PREFIX.length ? "POST, DELETE" : "");
  if (allow) throw methodNotAllowed(allow);
  send(res, 404, { success: false, code: "NOT_FOUND", message: "Not found." });
}

/** @type {Record<string, string>} */
var API_METHODS = {
  "/api/health": "GET",
  "/api/discovery-call/availability": "GET",
  "/api/discovery-call/book": "POST",
  "/api/discovery-call/reschedule": "POST",
  "/api/contact": "POST",
  "/api/webhooks/calendar": "POST"
};
