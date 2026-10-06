// node tools/cdp.js tools/e2e/offline.js — the installed shell must start with no network, and keep data.
const fixture = require("./fixture.js");
const URL = process.env.QALTA_URL || "http://localhost:8820/index.html";
let fails = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
module.exports = async (b) => {
  await b.size(390, 844, true, 2);
  await b.reduceMotion(true);
  await b.send("Network.enable");
  await b.goto(URL);
  await b.ev("localStorage.setItem('qalta-proto-v1', " + JSON.stringify(JSON.stringify(fixture())) + "); true");
  await b.goto(URL); await b.wait(800);
  const sw = await b.ev("navigator.serviceWorker.ready.then(r => !!r.active)");
  ok(sw === true, "service worker is active");
  await b.wait(1500);                       // let the shell finish caching
  await b.goto(URL); await b.wait(800);     // second load is served by / refreshes the cache
  await b.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await b.send("Page.navigate", { url: URL }); await b.wait(2500);
  const text = await b.ev("document.body.innerText");
  ok(text.includes("Обзор") && text.includes("Осталось"), "app starts offline and shows the saved data");
  ok(text.includes("243") || text.includes("Потрачено"), "numbers are present offline");
  await b.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  console.log(fails ? "\nFAILURES: " + fails : "\nOFFLINE OK");
  if (fails) process.exitCode = 1;
};
