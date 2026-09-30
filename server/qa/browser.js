import { launch, sleep } from "./cdp.js";

const BASE = (process.env.QA_BASE_URL || "http://127.0.0.1:5500").replace(/\/$/, "") + "/";
const results = [];
const SHOTS = process.env.QA_SHOTS || "";
function report(area, name, ok, detail) {
  results.push({ area, name, ok, detail: detail || "" });
  console.log((ok ? "PASS " : "FAIL ") + area + " | " + name + (detail ? " | " + detail : ""));
}

const HELPERS = `window.__qa = {
  vis(el) { if (!el) return false; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) > 0.05; },
  all(sel, text) { return [...document.querySelectorAll(sel)].filter((e) => this.vis(e) && (!text || e.textContent.replace(/\\s+/g, " ").includes(text))); },
  first(sel, text) { return this.all(sel, text)[0] || null; },
  aim(el) {
    el.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const hit = document.elementFromPoint(x, y);
    return { x, y, covered: !(hit && (hit === el || el.contains(hit))), hit: hit ? (hit.tagName + "." + String(hit.className).slice(0, 40)) : "none" };
  }
};`;

async function helpers(page) { await page.eval(HELPERS); }

async function aimAt(page, sel, text, index) {
  return page.eval(`(() => { const list = __qa.all(${JSON.stringify(sel)}, ${JSON.stringify(text || "")}); const el = list[${index || 0}]; if (!el) return null; window.__qa.target = el; return __qa.aim(el); })()`);
}

async function click(page, sel, text, index) {
  const a = await aimAt(page, sel, text, index);
  if (!a) return { ok: false, why: "not found or not visible" };
  await sleep(250);
  const again = await page.eval(`__qa.aim(__qa.target)`);
  if (again.covered) return { ok: false, why: "covered by " + again.hit };
  await page.clickAt(again.x, again.y);
  return { ok: true };
}

const bookingOpen = (page) => page.eval(`document.documentElement.classList.contains("nt-booking-open") && __qa.vis(document.querySelector("#nt-booking [role=dialog], #nt-booking dialog, #nt-booking .nt-book-dialog, #nt-booking"))`);
const menuOpen = (page) => page.eval(`!document.getElementById("nt-menu").hidden`);

async function closeBooking(page) {
  await page.key("Escape", "Escape", 27);
  await sleep(500);
  return !(await page.eval(`document.documentElement.classList.contains("nt-booking-open")`));
}

async function home(browser, label, width, height, mobile) {
  const A = label;
  const page = await browser.newPage(width, height, mobile);
  await page.goto(BASE);
  await helpers(page);
  await sleep(1500);

  const overflow = await page.eval(`document.documentElement.scrollWidth - window.innerWidth`);
  report(A, "no horizontal overflow", overflow <= 1, "extra " + overflow + "px");

  const hero = await page.eval(`(() => { const h = document.querySelector("h1"); return h ? { text: h.textContent.trim().slice(0, 40), vis: __qa.vis(h) } : null; })()`);
  report(A, "hero heading visible after animation", !!(hero && hero.vis), hero ? hero.text : "no h1");

  // Logo
  const logo = await page.eval(`(() => { const l = __qa.first('a[href="./"], a[href="/"], a[href="index.html"]'); return l ? { href: l.getAttribute("href"), text: (l.textContent || l.getAttribute("aria-label") || "").trim() } : null; })()`);
  report(A, "logo link visible", !!logo, logo ? logo.href + " " + logo.text : "");

  // Hamburger
  const burger = `[data-framer-name="Menu"]`;
  const bVis = await page.eval(`__qa.all('${burger}').length`);
  report(A, "hamburger visible", bVis > 0, bVis + " visible");
  let r = await click(page, burger);
  await sleep(500);
  report(A, "hamburger opens menu", r.ok && await menuOpen(page), r.why);
  report(A, "menu moves focus to Close", await page.eval(`document.activeElement && document.activeElement.classList.contains("nt-menu-close")`));
  report(A, "hamburger aria-expanded=true when open", await page.eval(`__qa.first('${burger}').getAttribute("aria-expanded") === "true"`));
  r = await click(page, ".nt-menu-close");
  await sleep(400);
  report(A, "Close button closes menu", r.ok && !(await menuOpen(page)), r.why);
  await click(page, burger); await sleep(400);
  await page.key("Escape", "Escape", 27); await sleep(400);
  report(A, "Escape closes menu", !(await menuOpen(page)));
  await click(page, burger); await sleep(400);
  const bd = await page.eval(`(() => { for (let x = 5; x < innerWidth; x += 20) for (let y = 80; y < innerHeight; y += 40) { const h = document.elementFromPoint(x, y); if (h && h.classList.contains("nt-menu-backdrop")) return { x, y }; } return null; })()`);
  if (bd) { await page.clickAt(bd.x, bd.y); await sleep(400); }
  if (bd) report(A, "backdrop click closes menu", !(await menuOpen(page)));
  else {
    const panel = await page.eval(`(() => { const p = [...document.querySelectorAll("#nt-menu > *")].filter((e) => !e.classList.contains("nt-menu-backdrop") && __qa.vis(e))[0]; const r = p.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), vw: innerWidth, vh: innerHeight }; })()`);
    report(A, "menu fills the screen, so Close and Escape dismiss it", panel.w >= panel.vw - 1 && panel.h >= panel.vh - 1, JSON.stringify(panel));
    await page.key("Escape", "Escape", 27); await sleep(400);
  }

  await page.eval(`__qa.first('${burger}').focus()`);
  await page.key("Enter", "Enter", 13); await sleep(400);
  report(A, "hamburger opens with the keyboard (Enter)", await menuOpen(page));
  await page.key("Escape", "Escape", 27); await sleep(400);
  const size = await page.eval(`(() => { const r = __qa.first('${burger}').getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })()`);
  report(A, "hamburger tap target at least 40x40", size.w >= 40 && size.h >= 40, size.w + "x" + size.h);

  // Every menu link
  const links = await page.eval(`[...document.querySelectorAll("#nt-menu .nt-menu-list a")].map((a) => ({ href: a.getAttribute("href"), text: a.textContent.replace(/\\s+/g, " ").trim() }))`);
  for (const link of links) {
    if (!link.href.startsWith("#")) { report(A, "menu link " + link.text, link.href.endsWith(".html"), "goes to " + link.href); continue; }
    await page.eval(`window.scrollTo(0, 0)`); await sleep(300);
    await click(page, burger); await sleep(450);
    const c = await click(page, `#nt-menu .nt-menu-list a[href="${link.href}"]`);
    await sleep(1800);
    const pos = await page.eval(`(() => { const t = document.getElementById(${JSON.stringify(link.href.slice(1))}); const r = t.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), menu: !document.getElementById("nt-menu").hidden, hash: location.hash }; })()`);
    report(A, "menu link " + link.text + " scrolls to section", c.ok && !pos.menu && pos.top >= 60 && pos.top <= 130 && pos.bottom > 0, c.ok ? "top=" + pos.top + " menuOpen=" + pos.menu : c.why);
  }

  // Sticky header
  await page.eval(`window.scrollTo(0, 2600)`); await sleep(700);
  const stick = await page.eval(`(() => { const b = __qa.first('${burger}'); if (!b) return null; const r = b.getBoundingClientRect(); let n = b, pos = ""; while (n && n !== document.body) { const p = getComputedStyle(n).position; if (p === "fixed" || p === "sticky") { pos = p; break; } n = n.parentElement; } return { top: Math.round(r.top), pos }; })()`);
  report(A, "navbar stays pinned after scrolling", !!stick && stick.top >= 0 && stick.top < 120, stick ? "top=" + stick.top + " " + stick.pos : "hamburger hidden after scroll");
  const logoAfter = await page.eval(`!!__qa.first('a[href="./"]')`);
  report(A, "logo still visible after scrolling", logoAfter);
  await page.eval(`window.scrollTo(0, 0)`); await sleep(500);

  // CTAs that open booking
  const ctas = await page.eval(`[...document.querySelectorAll("[data-nt-book]")].filter((e) => !e.closest("#nt-booking")).map((e, i) => ({ i, text: e.textContent.replace(/\\s+/g, " ").trim(), key: e.getAttribute("data-nt-book"), href: e.getAttribute("href") }))`);
  for (const cta of ctas) {
    const c = await click(page, `[data-nt-book="${cta.key}"]`);
    await sleep(700);
    const open = c.ok && await bookingOpen(page);
    const url = await page.eval(`location.pathname`);
    const closed = open ? await closeBooking(page) : false;
    report(A, "CTA \"" + cta.text + "\" opens booking", open && url === "/", c.ok ? "fallback href " + cta.href + (open ? "" : ", no dialog") : c.why);
    if (open) report(A, "booking dialog closes with Escape (" + cta.key + ")", closed);
  }

  for (const sel of [".nt-btn-secondary", ".nt-cta-secondary"]) {
    const cc = await click(page, sel);
    await sleep(1500);
    const path = await page.eval(`location.pathname`);
    report(A, "\"Tell Us About Your Project\" (" + sel + ") opens the contact form", cc.ok && path === "/contact.html", cc.ok ? path : cc.why);
    if (cc.ok) { await page.goto(BASE); await helpers(page); await sleep(800); }
  }

  // Services
  const dots = await page.eval(`__qa.all(".nt-services-dot").length`);
  report(A, "services pager buttons present", dots > 0, dots + " buttons");
  if (dots > 1) {
    const c = await click(page, ".nt-services-dot", "", 2);
    await sleep(900);
    const state = await page.eval(`(() => { const list = [...document.querySelectorAll(".nt-services-dot")]; return { active: list.findIndex((b) => b.getAttribute("aria-current") === "true"), name: (document.querySelector(".nt-services-name") || {}).textContent }; })()`);
    report(A, "services button 3 switches the service", c.ok && state.active === 2, c.ok ? "active=" + state.active + " " + state.name : c.why);
    const cta = await page.eval(`(() => { const e = __qa.first(".nt-services-cta"); return e ? { tag: e.tagName, href: e.getAttribute("href"), text: e.textContent.trim() } : null; })()`);
    if (cta) {
      const cc = await click(page, ".nt-services-cta");
      await sleep(700);
      const open = cc.ok && await bookingOpen(page);
      report(A, "services CTA \"" + cta.text + "\" opens booking", open, cc.ok ? cta.tag + " href=" + cta.href : cc.why);
      if (open) await closeBooking(page);
    } else report(A, "services CTA visible", false);
    const toggle = await page.eval(`(() => { const t = __qa.first(".nt-services-toggle"); return t ? t.getAttribute("aria-label") : null; })()`);
    if (toggle) {
      await click(page, ".nt-services-toggle"); await sleep(400);
      const after = await page.eval(`__qa.first(".nt-services-toggle").getAttribute("aria-label")`);
      report(A, "services play/pause toggle responds", after !== toggle, toggle + " -> " + after);
      await click(page, ".nt-services-toggle"); await sleep(300);
    }
  }

  // Case studies
  const active = () => page.eval(`[...document.querySelectorAll(".nt-built-slide")].findIndex((s) => s.classList.contains("is-active"))`);
  const a0 = await active();
  let c = await click(page, ".nt-built-arrow.is-next"); await sleep(600);
  const a1 = await active();
  report(A, "case studies Next moves forward", c.ok && a1 !== a0, c.ok ? a0 + " -> " + a1 : c.why);
  c = await click(page, ".nt-built-arrow.is-prev"); await sleep(600);
  const a2 = await active();
  report(A, "case studies Previous moves back", c.ok && a2 === a0, c.ok ? a1 + " -> " + a2 : c.why);
  const dotCount = await page.eval(`__qa.all(".nt-built-dots button").length`);
  if (dotCount) {
    c = await click(page, ".nt-built-dots button", "", 3); await sleep(600);
    report(A, "case studies dot 4 jumps to slide 4", c.ok && (await active()) === 3, c.ok ? "" : c.why);
  } else report(A, "case studies dots visible", false, "none visible");
  const more = await page.eval(`(() => { const s = document.querySelector(".nt-built-slide.is-active .nt-built-more"); if (!s) return null; s.scrollIntoView({ block: "center", behavior: "instant" }); const before = getComputedStyle(s); return { href: s.getAttribute("href"), color: before.color, gap: before.gap, transform: before.transform, opacity: before.opacity, deco: before.textDecorationLine }; })()`);
  if (more) {
    const at = await page.eval(`(() => { const s = document.querySelector(".nt-built-slide.is-active .nt-built-more"); const r = s.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await page.hover(at.x, at.y); await sleep(450);
    const hov = await page.eval(`(() => { const s = document.querySelector(".nt-built-slide.is-active .nt-built-more"); const a = getComputedStyle(s); return { color: a.color, gap: a.gap, transform: a.transform, opacity: a.opacity, deco: a.textDecorationLine, arrow: s.querySelector("span") ? getComputedStyle(s.querySelector("span")).transform : "" }; })()`);
    const changed = hov.color !== more.color || hov.gap !== more.gap || hov.transform !== more.transform || hov.opacity !== more.opacity || hov.deco !== more.deco || (hov.arrow && hov.arrow !== "none");
    report(A, "case study Read more has a hover state", mobile ? true : changed, mobile ? "touch device" : JSON.stringify(hov));
    await page.hover(5, 5);
  }
  c = await click(page, ".nt-built-all-btn"); await sleep(500);
  const allOpen = await page.eval(`(() => { const p = document.querySelector(".nt-built-all"); return p && !p.hasAttribute("hidden") && __qa.vis(p) ? p.querySelectorAll("a").length : -1; })()`);
  report(A, "Explore all Case Studies reveals the list", c.ok && allOpen > 0, c.ok ? allOpen + " links" : c.why);
  if (allOpen > 0) {
    c = await click(page, ".nt-built-all-btn"); await sleep(400);
    report(A, "Explore all Case Studies collapses again", c.ok && await page.eval(`document.querySelector(".nt-built-all").hasAttribute("hidden")`));
  }
  c = await click(page, ".nt-built-slide.is-active .nt-built-more");
  await sleep(1500);
  const casePath = await page.eval(`location.pathname`);
  report(A, "Read more opens the case study page", c.ok && /case-.*\.html$/.test(casePath), c.ok ? casePath : c.why);
  if (c.ok) { await page.goto(BASE); await helpers(page); await sleep(800); }

  // Process steps
  const pbtn = await page.eval(`__qa.all("#nt-process button").length`);
  if (pbtn) {
    await page.eval(`document.getElementById("nt-process").scrollIntoView({ behavior: "instant" })`); await sleep(500);
    const y0 = await page.eval(`scrollY`);
    c = await click(page, "#nt-process button", "", 2); await sleep(1500);
    const y1 = await page.eval(`scrollY`);
    report(A, "process step 03 button moves to that step", c.ok && Math.abs(y1 - y0) > 50, c.ok ? "scrollY " + Math.round(y0) + " -> " + Math.round(y1) : c.why);
  } else {
    const hidden = await page.eval(`[...document.querySelectorAll("#nt-process button")].every((b) => getComputedStyle(b).display === "none")`);
    report(A, "process step buttons are fully removed on narrow screens (scroll drives the steps)", hidden);
  }

  // Audiences
  const picks = await page.eval(`__qa.all(".nt-audiences-pick").length`);
  if (picks) {
    c = await click(page, ".nt-audiences-pick", "", 0); await sleep(1400);
    const st = await page.eval(`(() => { const b = [...document.querySelectorAll(".nt-audiences-pick")]; return { idx: b.findIndex((x) => x.classList.contains("is-active")), sel: b.findIndex((x) => x.getAttribute("aria-selected") === "true") }; })()`);
    report(A, "audience tab 1 becomes active", c.ok && (st.idx === 0 || st.sel === 0), c.ok ? JSON.stringify(st) : c.why);
  }

  // FAQ
  c = await click(page, "#faq .nt-faq-item button", "", 1); await sleep(500);
  const f1 = await page.eval(`(() => { const it = document.querySelectorAll("#faq .nt-faq-item")[1]; const b = it.querySelector("button"); const ans = [...it.children].find((x) => x !== b && !x.contains(b)); return { exp: b.getAttribute("aria-expanded"), h: ans ? Math.round(ans.getBoundingClientRect().height) : -1 }; })()`);
  report(A, "FAQ question opens its answer", c.ok && f1.exp === "true" && f1.h > 10, c.ok ? JSON.stringify(f1) : c.why);
  c = await click(page, "#faq .nt-faq-item button", "", 1); await sleep(500);
  const f2 = await page.eval(`document.querySelectorAll("#faq .nt-faq-item")[1].querySelector("button").getAttribute("aria-expanded")`);
  report(A, "FAQ question closes again", c.ok && f2 === "false");

  // Footer
  const foot = await page.eval(`(() => { const f = document.querySelector("footer"); return f ? [...f.querySelectorAll("a")].map((a) => ({ href: a.getAttribute("href"), text: a.textContent.replace(/\\s+/g, " ").trim(), vis: __qa.vis(a), target: a.getAttribute("target") })) : []; })()`);
  report(A, "footer links", foot.length > 0 && foot.every((l) => l.vis), foot.map((l) => l.text + "->" + l.href + (l.vis ? "" : " HIDDEN")).join(", "));
  for (const l of foot) {
    if (/^mailto:/i.test(l.href)) report(A, "footer " + l.text + " avoids browser email", false, l.href);
    else if (/^tel:/i.test(l.href)) report(A, "footer " + l.text + " link format", l.href === "tel:+918294236403", l.href);
  }
  const legal = foot.find((l) => l.href === "privacy.html");
  if (legal) {
    c = await click(page, 'footer a[href="privacy.html"]'); await sleep(1500);
    report(A, "footer Privacy Policy opens", c.ok && (await page.eval(`location.pathname`)) === "/privacy.html", c.ok ? "" : c.why);
  }
  if (SHOTS) await page.screenshot(SHOTS + "-" + label + ".png");
  return page;
}

async function subpages(browser) {
  const A = "subpages";
  const page = await browser.newPage(1280, 900, false);
  const pages = ["contact.html", "discovery-call.html", "privacy.html", "terms.html", "cancel.html", "case-hsc.html", "case-lendingpoint.html", "case-neighborworks.html", "case-washington-center.html", "case-university-hospital.html", "case-insight-medical-genetics.html", "404-check-missing"];
  for (const p of pages) {
    const before = page.events.failed.length;
    await page.goto(BASE + p);
    await helpers(page);
    const links = await page.eval(`[...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href"))`);
    const bad = links.filter((h) => h === "#" || h === "" || /^javascript:/i.test(h));
    const fails = page.events.failed.slice(before).filter((f) => !f.includes("404-check-missing") && !unconfigured(f));
    report(A, p + " loads cleanly", bad.length === 0 && fails.length === 0, (bad.length ? "placeholder hrefs " + bad.join(",") + " " : "") + fails.join("; "));
    for (const h of links) {
      if (/^(mailto|tel|https?):/.test(h) || h.startsWith("#")) continue;
      const url = new URL(h, BASE + p).href;
      const res = await fetch(url);
      if (res.status !== 200) report(A, p + " link " + h, false, "status " + res.status);
    }
  }
  // Contact form: empty submit must show errors, not send
  await page.goto(BASE + "contact.html"); await helpers(page);
  let c = await click(page, ".nt-touch-submit"); await sleep(800);
  const st = await page.eval(`(() => ({ invalid: document.querySelectorAll("[aria-invalid=true], .is-invalid, :invalid").length, status: (document.getElementById("form-status") || {}).textContent || "" }))()`);
  report(A, "contact empty submit shows validation", c.ok && st.invalid > 0, JSON.stringify(st));
  // Discovery page opens on the calendar step, with details locked until a time is picked
  await page.goto(BASE + "discovery-call.html"); await helpers(page); await sleep(800);
  const first = await page.eval(`(() => { const next = document.querySelector("#nt-booking [data-next]"); const panel = document.querySelector("#nt-booking .nt-book-error-panel"); return { title: (document.getElementById("nt-book-title") || {}).textContent || "", locked: !next || next.disabled, panel: panel ? panel.innerText.replace(/\\s+/g, " ") : "" }; })()`);
  report(A, "discovery page starts on Choose Time with details locked", /choose a time/i.test(first.title) && first.locked, JSON.stringify(first));
  if (calendarOff) report(A, "without calendar credentials the page says so and offers Contact Us", /not available/i.test(first.panel) && /contact us/i.test(first.panel), first.panel);
  // Cancel page without a token
  await page.goto(BASE + "cancel.html"); await helpers(page);
  const cancelState = await page.eval(`(() => { const b = document.getElementById("cancel-button"); return b ? { vis: __qa.vis(b), disabled: b.disabled, text: document.body.innerText.slice(0, 300).replace(/\\s+/g, " ") } : null; })()`);
  report(A, "cancel page without a link explains itself", !!cancelState && (!cancelState.vis || cancelState.disabled), JSON.stringify(cancelState));
  return page;
}

const bookingText = (page) => page.eval(`(() => { const t = document.getElementById("nt-book-title"); const b = document.querySelector("#nt-booking .nt-book-banner"); return { title: t ? t.textContent.trim() : "", banner: b ? b.textContent.trim() : "", step: (document.querySelector("#nt-booking .nt-book-progress .is-current") || {}).textContent || "" }; })()`);

async function pickFirstTime(page) {
  for (let hop = 0; hop < 2; hop++) {
    await sleep(700);
    const day = await click(page, ".nt-book-day:not([disabled])");
    if (day.ok) {
      await sleep(400);
      const slot = await page.eval(`(() => { const s = __qa.first(".nt-book-slot"); return s ? s.getAttribute("data-slot") : null; })()`);
      const picked = await click(page, ".nt-book-slot");
      await sleep(300);
      return picked.ok ? slot : null;
    }
    await click(page, "[data-month='1']");
  }
  return null;
}

async function fillDetails(page, phone) {
  await page.eval(`(() => {
    const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); };
    set("nt-name", "Amina Shah"); set("nt-email", "amina@example.com"); set("nt-company", "Northwind");
    set("nt-phone", ${JSON.stringify(phone)}); set("nt-description", "Connect billing to the CRM.");
    const tick = (sel) => { const el = document.querySelector(sel); if (el && !el.checked) el.click(); };
    tick('input[name="service"]'); tick('input[name="stage"]'); tick('input[name="budget"]');
  })()`);
}

// Full booking path against a private server with an in-memory store and recording calendar/email.
async function bookingFlow(browser) {
  const A = "booking";
  const { listen } = await import("../test/helpers.js");
  const running = await listen({ BOOKING_TIMEZONE: "America/New_York", BOOKING_MIN_LEAD_MINUTES: "0", BOOKING_HORIZON_DAYS: "21", RATE_LIMIT_MAX_REQUESTS: "200" });
  const page = await browser.newPage(1280, 900, false);
  try {
    await page.goto(running.origin + "/discovery-call.html"); await helpers(page);
    let s = await bookingText(page);
    report(A, "step 1 is Choose Time", /choose time/i.test(s.step), s.step);
    const slot = await pickFirstTime(page);
    report(A, "a date and an available time can be picked", !!slot, slot || "no open slot");
    if (SHOTS) await page.screenshot(SHOTS + "-booking-calendar.png");
    let c = await click(page, "[data-next]"); await sleep(400);
    if (SHOTS) await page.screenshot(SHOTS + "-booking-details.png");
    s = await bookingText(page);
    report(A, "continue leads to Your Details", c.ok && /your details/i.test(s.step), s.step);
    const picked = await page.eval(`(() => { const p = __qa.first(".nt-book-picked"); return p ? p.innerText.replace(/\\s+/g, " ") : ""; })()`);
    report(A, "details step shows the chosen time and timezone", /[A-Za-z]+\/[A-Za-z_]+|UTC/.test(picked) && /\d:\d\d (AM|PM)/.test(picked), picked);

    c = await click(page, ".nt-book-form [type=submit]"); await sleep(500);
    let errs = await page.eval(`document.querySelectorAll("#nt-booking .is-invalid").length`);
    report(A, "empty details are blocked in the browser", c.ok && errs > 0 && running.store.bookings.length === 0, "invalid fields " + errs);

    await fillDetails(page, "call me maybe");
    c = await click(page, ".nt-book-form [type=submit]"); await sleep(500);
    const phoneBad = await page.eval(`!!document.querySelector('[data-field="phone"].is-invalid')`);
    report(A, "an invalid phone is flagged, blank phone is allowed", phoneBad && running.store.bookings.length === 0);

    await fillDetails(page, "");
    c = await click(page, ".nt-book-form [type=submit]"); await sleep(1500);
    s = await bookingText(page);
    const saved = running.store.bookings[0];
    report(A, "booking completes with a confirmation screen", /all set/i.test(s.title), s.title + " " + s.banner);
    report(A, "server stored one confirmed booking in UTC and one calendar event", running.store.bookings.length === 1 && saved && saved.status === "CONFIRMED" && saved.startTime.toISOString() === new Date(slot).toISOString() && running.events.length === 1);

    await page.goto(running.origin + "/discovery-call.html"); await helpers(page); await sleep(900);
    await click(page, ".nt-book-day:not([disabled])"); await sleep(400);
    const stillListed = await page.eval(`!!document.querySelector('[data-slot="${slot}"]')`);
    report(A, "a booked time disappears from the calendar", !stillListed);

    const second = await pickFirstTime(page);
    await click(page, "[data-next]"); await sleep(400);
    await fillDetails(page, "+1 555 010 0199");
    const start = new Date(second);
    await running.store.claim({ id: "qa-rival", name: "Rival", email: "rival@example.com", company: "Rival Co", phone: "", message: "", services: "API", projectStage: "Build", budget: "Other", timezone: "UTC", startTime: start, endTime: new Date(start.getTime() + 1800000), slotKey: start.toISOString(), status: "PENDING", cancelToken: "qa-c", rescheduleToken: "qa-r", idempotencyKey: null });
    c = await click(page, ".nt-book-form [type=submit]"); await sleep(1500);
    s = await bookingText(page);
    const rivalShown = await page.eval(`!!document.querySelector('[data-slot="${second}"]')`);
    report(A, "a time taken meanwhile returns to the calendar with a clear message", /choose time/i.test(s.step) && /no longer available/i.test(s.banner) && !rivalShown, s.step + " | " + s.banner);
    report(A, "no extra calendar event was created", running.events.length === 1, "events " + running.events.length);
    const expected = (line) => line.includes("409") && line.includes("/api/discovery-call/book");
    page.events.failed = page.events.failed.filter((line) => !expected(line));
    page.events.console = page.events.console.filter((line) => !expected(line));
  } finally {
    running.server.close();
  }
  return page;
}

const contactState = (page) => page.eval(`(() => {
  const form = document.getElementById("contact-form");
  const button = form.querySelector("button[type=submit]");
  const ok = document.getElementById("contact-success");
  const alertBox = document.getElementById("form-alert");
  return {
    state: form.getAttribute("data-state"),
    formVisible: __qa.vis(form),
    disabled: button.disabled,
    button: button.textContent.trim(),
    success: __qa.vis(ok) ? ok.innerText.replace(/\\s+/g, " ") : "",
    successFocused: document.activeElement === ok,
    alert: __qa.vis(alertBox) ? alertBox.innerText.replace(/\\s+/g, " ") : "",
    message: document.getElementById("message").value
  };
})()`);

async function fillContact(page, values) {
  await page.eval(`(() => {
    const values = ${JSON.stringify(values)};
    Object.keys(values).forEach((id) => { const el = document.getElementById(id); el.value = values[id]; el.dispatchEvent(new Event("input", { bubbles: true })); });
  })()`);
}

// Contact form states against a private server with an in-memory store and recording email.
async function contactFlow(browser) {
  const A = "contact";
  const { listen } = await import("../test/helpers.js");
  const running = await listen({ RATE_LIMIT_MAX_REQUESTS: "200" });
  const save = running.store.saveContact.bind(running.store);
  running.store.saveContact = async (row) => { await sleep(1200); return save(row); };
  const person = { "first-name": "Amina", "last-name": "Shah", email: "amina@example.com", phone: "+1 555 010 0199", city: "Austin", state: "TX", company: "Northwind", message: "We would like to talk about a Salesforce build." };
  const page = await browser.newPage(1280, 900, false);
  try {
    await page.goto(running.origin + "/contact.html"); await helpers(page);
    let s = await contactState(page);
    report(A, "form starts idle with the Submit button enabled", s.state === "idle" && !s.disabled && s.button === "Submit", JSON.stringify(s));

    await fillContact(page, Object.assign({}, person, { email: "amina@", phone: "call me" }));
    await click(page, ".nt-touch-submit"); await sleep(400);
    const flagged = await page.eval(`["email", "phone"].every((id) => document.getElementById(id).getAttribute("aria-invalid") === "true" && document.getElementById(id + "-error"))`);
    report(A, "an invalid email and phone are flagged with messages before sending", flagged && running.store.contacts.length === 0);

    await fillContact(page, person);
    await sleep(2200);
    await click(page, ".nt-touch-submit"); await sleep(300);
    s = await contactState(page);
    report(A, "while sending the form is SUBMITTING and the button is disabled", s.state === "submitting" && s.disabled && /sending/i.test(s.button), JSON.stringify(s));
    await page.eval(`document.getElementById("contact-form").requestSubmit()`);
    await sleep(2000);
    s = await contactState(page);
    if (SHOTS) await page.screenshot(SHOTS + "-contact-success.png");
    report(A, "after sending the form shows a SUCCESS confirmation with the reply address", s.state === "success" && !s.formVisible && /message has been sent/i.test(s.success) && s.success.includes("amina@example.com") && s.successFocused, s.success);
    const saved = running.store.contacts[0];
    report(A, "server stored one processed message and emailed the team once, despite a second submit", running.store.contacts.length === 1 && saved && saved.status === "PROCESSED" && running.emails.filter((kind) => kind === "contact").length === 1, "contacts " + running.store.contacts.length + ", emails " + running.emails.join(","));

    await click(page, "#contact-again"); await sleep(300);
    s = await contactState(page);
    report(A, "Send another message returns to an empty IDLE form", s.state === "idle" && s.formVisible && s.message === "", JSON.stringify(s));

    running.services.failEmail = true;
    const second = Object.assign({}, person, { message: "A second question about API integrations." });
    await fillContact(page, second);
    await sleep(2200);
    await click(page, ".nt-touch-submit"); await sleep(2000);
    s = await contactState(page);
    if (SHOTS) await page.screenshot(SHOTS + "-contact-error.png");
    report(A, "a failed send shows the ERROR state and keeps the typed message", s.state === "error" && /try again/i.test(s.alert) && s.message === second.message && !s.disabled, s.alert);

    running.services.failEmail = false;
    await click(page, ".nt-touch-submit"); await sleep(2000);
    s = await contactState(page);
    report(A, "retrying after the error succeeds", s.state === "success" && running.store.contacts.filter((row) => row.status === "PROCESSED").length === 2, JSON.stringify(s));
    const expected = (line) => line.includes("503") && line.includes("/api/contact");
    page.events.failed = page.events.failed.filter((line) => !expected(line));
    page.events.console = page.events.console.filter((line) => !expected(line));
  } finally {
    running.server.close();
  }
  return page;
}

const today = new Date();
const probe = await fetch(BASE + "api/discovery-call/availability?timezone=UTC&year=" + today.getUTCFullYear() + "&month=" + (today.getUTCMonth() + 1));
const probeBody = await probe.json().catch(() => ({}));
// A server without Google credentials answers availability with 503 NOT_CONFIGURED by design.
const calendarOff = probe.status === 503 && probeBody.code === "NOT_CONFIGURED";
if (calendarOff) console.log("NOTE calendar is not configured on " + BASE + "; availability 503s are expected there");
const unconfigured = (line) => calendarOff && line.includes("503") && line.includes("/api/discovery-call/availability");

const browser = await launch();
const pages = [];
try {
  pages.push(await home(browser, "desktop", 1440, 900, false));
  pages.push(await home(browser, "tablet", 900, 1100, false));
  pages.push(await home(browser, "mobile", 390, 844, true));
  pages.push(await subpages(browser));
  pages.push(await bookingFlow(browser));
  pages.push(await contactFlow(browser));
} catch (error) {
  report("runner", "crashed", false, String(error && error.stack || error));
} finally {
  for (const p of pages) {
    if (p.events.errors.length) report("console", "uncaught errors", false, p.events.errors.join(" || "));
    const logged = p.events.console.filter((m) => !m.includes("404-check-missing") && !unconfigured(m));
    if (logged.length) report("console", "console errors/warnings", false, logged.join(" || ").slice(0, 800));
    const failed = p.events.failed.filter((f) => !f.includes("404-check-missing") && !unconfigured(f));
    if (failed.length) report("network", "failed requests", false, failed.join(" || ").slice(0, 800));
  }
  await browser.close();
  const fails = results.filter((r) => !r.ok);
  console.log("\nTOTAL " + results.length + " checks, " + fails.length + " failed");
  process.exitCode = fails.length ? 1 : 0;
}
