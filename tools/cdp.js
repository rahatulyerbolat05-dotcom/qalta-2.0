// Tiny CDP driver: node cdp.js <script.js>   (script gets {page, shot, ev, click, wait})
const { spawn } = require("child_process");
const fs = require("fs"), path = require("path"), os = require("os");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9333 + Math.floor(Math.random() * 300);

async function launch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qedge-"));
  const p = spawn(EDGE, ["--headless=new", "--disable-gpu", "--no-first-run", "--hide-scrollbars", "--remote-debugging-port=" + PORT, "--user-data-dir=" + dir, "about:blank"], { stdio: "ignore" });
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch("http://127.0.0.1:" + PORT + "/json/version"); if (r.ok) break; } catch (e) {}
    await new Promise(r => setTimeout(r, 250));
  }
  const tabs = await (await fetch("http://127.0.0.1:" + PORT + "/json")).json();
  const t = tabs.find(x => x.type === "page");
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener("open", r));
  let id = 0; const pending = new Map(); const logs = [];
  ws.addEventListener("message", m => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { const { res, rej } = pending.get(d.id); pending.delete(d.id); d.error ? rej(new Error(JSON.stringify(d.error))) : res(d.result); }
    else if (d.method === "Runtime.consoleAPICalled") logs.push(d.params.type + ": " + d.params.args.map(a => a.value !== undefined ? a.value : a.description).join(" "));
    else if (d.method === "Runtime.exceptionThrown") logs.push("EXC: " + (d.params.exceptionDetails.exception && d.params.exceptionDetails.exception.description || d.params.exceptionDetails.text));
  });
  const send = (method, params) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Page.enable"); await send("Runtime.enable");
  const api = {
    logs,
    send,
    async size(w, h, mobile = true, dpr = 2) {
      await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: dpr, mobile });
    },
    // headless frames run slowly: reduced motion makes sheets and fades land immediately, and exercises that path too
    async reduceMotion(on = true) { await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: on ? "reduce" : "no-preference" }] }); },
    async colorScheme(v) { await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: v }] }); },
    async goto(url) { await send("Page.navigate", { url }); await new Promise(r => setTimeout(r, 2500)); },
    async ev(expr) {
      const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error("eval failed: " + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
      return r.result.value;
    },
    async wait(ms) { await new Promise(r => setTimeout(r, ms)); },
    async shot(file, opts = {}) {
      const r = await send("Page.captureScreenshot", Object.assign({ format: "png" }, opts));
      fs.writeFileSync(file, Buffer.from(r.data, "base64"));
    },
    // click the first element whose visible text matches (exact, trimmed) – walks real DOM
    async clickText(txt, root = "document") {
      return this.ev(`(()=>{const w=[...${root}.querySelectorAll('[role=button],button,input,div,span')].filter(e=>e.children.length<=3&&(e.innerText||'').trim()===${JSON.stringify(txt)});const e=w[0];if(!e)return false;e.scrollIntoView({block:'center'});e.click();return true})()`);
    },
    close() { try { ws.close(); } catch (e) {} p.kill(); }
  };
  return api;
}
module.exports = { launch };
if (require.main === module) {
  const script = require(path.resolve(process.argv[2]));
  launch().then(async api => { try { await script(api); } catch (e) { console.error("SCRIPT ERROR", e); process.exitCode = 1; } finally { console.log("--- console ---\n" + api.logs.join("\n")); api.close(); } });
}
