import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { enrichHead } from "../server/src/server.js";
import { loadConfig } from "../server/src/config.js";

var root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
var output = join(root, "public");
var config = loadConfig(process.env);
var origin = config.siteUrl;
if (!origin.startsWith("https://")) throw new Error("Set NEXT_PUBLIC_SITE_URL to the public HTTPS URL in Vercel.");

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });

var rootFile = /^[a-z0-9][a-z0-9-]*\.(html|css|svg)$/;
var assetFile = /^assets\/[a-z0-9][a-z0-9/_.-]*\.(css|js|json|png|jpe?g|webp|svg|mp4|woff2|ico)$/;
var turnstileSiteKey = config.turnstileSiteKey;

for (var entry of readdirSync(root, { withFileTypes: true })) {
  if (!entry.isFile() || !rootFile.test(entry.name)) continue;
  var source = join(root, entry.name);
  var destination = join(output, entry.name);
  if (entry.name.endsWith(".html")) {
    var pathname = entry.name === "index.html" ? "/" : "/" + entry.name;
    var html = readFileSync(source, "utf8");
    writeFileSync(destination, enrichHead(html, origin, pathname, turnstileSiteKey));
  } else {
    cpSync(source, destination);
  }
}

function copyPublicAssets(directory) {
  for (var entry of readdirSync(directory, { withFileTypes: true })) {
    var source = join(directory, entry.name);
    if (entry.isDirectory()) {
      copyPublicAssets(source);
      continue;
    }
    var path = relative(root, source).replace(/\\/g, "/");
    if (!assetFile.test(path)) continue;
    var destination = join(output, path);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(source, destination);
  }
}

copyPublicAssets(join(root, "assets"));

var pages = [
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
writeFileSync(join(output, "robots.txt"), "User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /cancel.html\n\nSitemap: " + origin + "/sitemap.xml\n");
writeFileSync(join(output, "sitemap.xml"), '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
  + pages.map(function (page) { return "  <url><loc>" + origin + page + "</loc></url>"; }).join("\n")
  + "\n</urlset>\n");