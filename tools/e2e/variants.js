// node tools/cdp.js tools/e2e/variants.js — dark theme, small phone, 200% text, desktop frame.
const fs = require("fs"), path = require("path");
const fixture = require("./fixture.js");
const OUT = path.join(__dirname, "out");
const URL = process.env.QALTA_URL || "http://localhost:8820/index.html";
module.exports = async (b) => {
  fs.mkdirSync(OUT, { recursive: true });
  const shot = n => b.shot(path.join(OUT, "v-" + n + ".png"));
  const click = sel => b.ev("(()=>{const e=document.querySelector(" + JSON.stringify(sel) + ");if(!e)return false;e.click();return true})()");
  const clickText = (sel, txt) => b.ev("(()=>{const e=[...document.querySelectorAll(" + JSON.stringify(sel) + ")].find(x=>x.innerText.trim().includes(" + JSON.stringify(txt) + "));if(!e)return false;e.click();return true})()");
  const load = async (theme, w, h, dpr, mobile) => {
    await b.size(w, h, mobile !== false, dpr || 2);
    await b.reduceMotion(true);
    await b.goto(URL);
    await b.ev("localStorage.setItem('qalta-proto-v1', " + JSON.stringify(JSON.stringify(fixture())) + "); localStorage.setItem('qalta-ui-v1', JSON.stringify({theme:" + JSON.stringify(theme) + "})); true");
    await b.goto(URL); await b.wait(700);
  };
  // dark: entry + history + debts
  await load("dark", 390, 844);
  await click(".q-wcard:last-of-type"); await b.wait(500);
  for (const k of ["1", "5", "0", "0"]) await click('.q-key[aria-label="' + k + '"]');
  await b.wait(300); await shot("dark-entry");
  await click(".q-sheet .q-nbtn"); await b.wait(300);
  const cf = await b.ev("!!document.querySelector('#layer-confirm')"); console.log("discard confirm opened:", cf);
  await shot("dark-confirm");
  await clickText(".q-row", "Не сохранять"); await b.wait(400);
  await clickText(".q-tab", "История"); await b.wait(500); await shot("dark-history");
  await clickText(".q-tab", "Долги"); await b.wait(500); await shot("dark-debts");
  await clickText(".q-tab", "Настройки"); await b.wait(500); await shot("dark-settings");
  // small phone 360x640
  await load("light", 360, 640);
  await shot("small-home");
  await click(".q-wcard:last-of-type"); await b.wait(500);
  for (const k of ["9", "9", "0", "0"]) await click('.q-key[aria-label="' + k + '"]');
  await b.wait(300); await shot("small-entry");
  // 200% text
  await load("light", 390, 844);
  await b.ev("document.documentElement.style.fontSize='34px'; true"); await b.wait(400);
  await shot("text200-home");
  await click(".q-wcard:last-of-type"); await b.wait(500); await shot("text200-entry");
  // desktop frame
  await load("light", 1280, 900, 1, false);
  await shot("desktop-home");
};
