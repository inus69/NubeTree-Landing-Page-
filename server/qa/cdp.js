import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = [
  process.env.ProgramFiles + "\\Google\\Chrome\\Application\\chrome.exe",
  process.env["ProgramFiles(x86)"] + "\\Google\\Chrome\\Application\\chrome.exe"
].find((p) => p && existsSync(p));

export async function launch() {
  const profile = mkdtempSync(join(tmpdir(), "nt-qa-"));
  const proc = spawn(CHROME, ["--headless=new", "--remote-debugging-pipe", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--user-data-dir=" + profile, "about:blank"], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
  const out = proc.stdio[3], inp = proc.stdio[4];
  let id = 0, buf = "";
  const pending = new Map();
  const listeners = [];
  inp.on("data", (chunk) => {
    buf += chunk.toString("utf8");
    let i;
    while ((i = buf.indexOf("\0")) >= 0) {
      const msg = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      } else if (msg.method) listeners.forEach((fn) => fn(msg));
    }
  });
  function send(method, params = {}, sessionId) {
    const msg = { id: ++id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    out.write(JSON.stringify(msg) + "\0");
    return new Promise((resolve, reject) => pending.set(msg.id, { resolve, reject }));
  }
  async function newPage(width, height, mobile) {
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    const s = (m, p) => send(m, p, sessionId);
    const events = { console: [], errors: [], failed: [] };
    listeners.push((msg) => {
      if (msg.sessionId !== sessionId) return;
      if (msg.method === "Runtime.consoleAPICalled" && (msg.params.type === "error" || msg.params.type === "warning")) events.console.push(msg.params.type + ": " + msg.params.args.map((a) => a.value || a.description).join(" "));
      if (msg.method === "Runtime.exceptionThrown") events.errors.push(msg.params.exceptionDetails.exception ? msg.params.exceptionDetails.exception.description : msg.params.exceptionDetails.text);
      if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") events.console.push("log: " + msg.params.entry.text + " " + (msg.params.entry.url || ""));
      if (msg.method === "Network.responseReceived" && msg.params.response.status >= 400) events.failed.push(msg.params.response.status + " " + msg.params.response.url);
      if (msg.method === "Network.loadingFailed" && !msg.params.canceled) events.failed.push("FAILED " + msg.params.errorText + " " + (msg.params.type || ""));
    });
    await s("Runtime.enable"); await s("Log.enable"); await s("Network.enable"); await s("Page.enable");
    await s("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: !!mobile });
    if (mobile) await s("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    const page = {
      events,
      send: s,
      async goto(url) {
        const loaded = new Promise((res) => { const fn = (m) => { if (m.sessionId === sessionId && m.method === "Page.loadEventFired") { res(); } }; listeners.push(fn); });
        await s("Page.navigate", { url });
        await Promise.race([loaded, sleep(15000)]);
        await sleep(1200);
      },
      async eval(expr) {
        const r = await s("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
        if (r.exceptionDetails) throw new Error("eval: " + (r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text));
        return r.result.value;
      },
      async clickAt(x, y) {
        await s("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
        await s("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
        await s("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
      },
      async hover(x, y) { await s("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }); },
      async key(key, code, keyCode) {
        await s("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: keyCode });
        await s("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: keyCode });
      },
      async screenshot(path) {
        const { data } = await s("Page.captureScreenshot", { format: "png" });
        (await import("node:fs")).writeFileSync(path, Buffer.from(data, "base64"));
      }
    };
    return page;
  }
  async function close() {
    try { await send("Browser.close"); } catch { /* already closing */ }
    await sleep(800);
    try { proc.kill(); } catch { /* exited */ }
    await sleep(400);
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* locked briefly */ }
  }
  return { newPage, close };
}

export function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
