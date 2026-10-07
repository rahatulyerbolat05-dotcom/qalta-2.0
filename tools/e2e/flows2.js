// node tools/cdp.js tools/e2e/flows2.js — what flows.js cannot see: REAL pointer and keyboard input (trusted events,
// not element.click()), focus handling, notices on every screen, and a short landscape screen.
const fixture = require("./fixture.js");
const URL = process.env.QALTA_URL || "http://localhost:8820/index.html";
let fails = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };

module.exports = async (b) => {
  const rectOf = sel => b.ev("(()=>{const e=document.querySelector(" + JSON.stringify(sel) + ");if(!e)return null;const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,w:r.width,h:r.height,b:r.bottom,t:r.top}})()");
  const mouseTap = async sel => {
    const r = await rectOf(sel); if (!r) return false;
    await b.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: r.x, y: r.y });
    await b.send("Input.dispatchMouseEvent", { type: "mousePressed", x: r.x, y: r.y, button: "left", buttons: 1, clickCount: 1 });
    await b.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: r.x, y: r.y, button: "left", buttons: 0, clickCount: 1 });
    return true;
  };
  // a real finger (raw touch events through the browser). Headless Edge sometimes never acknowledges a touch
  // command, so each one gets a few seconds and one retry (after a cancel) instead of hanging the whole run.
  const raced = (p, ms) => { p.catch(() => {}); return Promise.race([p, new Promise(r => setTimeout(() => r("stalled"), ms))]); };
  const touchTap = async sel => {
    const r = await rectOf(sel); if (!r) return false;
    for (let attempt = 0; attempt < 3; attempt++) {
      const down = await raced(b.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: r.x, y: r.y }] }), 4000);
      if (down !== "stalled") {
        const up = await raced(b.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }), 4000);
        if (up !== "stalled") return true;
      }
      await raced(b.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] }), 2000);
    }
    return false;
  };
  const key = async (k, code, mods) => {
    const base = { key: k, code: code || k, modifiers: mods || 0, windowsVirtualKeyCode: ({ Escape: 27, Tab: 9, ArrowRight: 39, ArrowLeft: 37, Enter: 13, z: 90 })[k] || 0 };
    await b.send("Input.dispatchKeyEvent", Object.assign({ type: "rawKeyDown" }, base));
    await b.send("Input.dispatchKeyEvent", Object.assign({ type: "keyUp" }, base));
  };
  const text = () => b.ev("document.body.innerText");
  const exists = sel => b.ev("!!document.querySelector(" + JSON.stringify(sel) + ")");
  const active = () => b.ev("(()=>{const a=document.activeElement;return a?(a.className||'')+'|'+a.tagName+'|'+(a.id||''):''})()");
  const fresh = async (storage, ui) => {
    await b.goto(URL);
    await b.ev("localStorage.clear(); " + (storage ? "localStorage.setItem('qalta-proto-v1'," + JSON.stringify(typeof storage === "string" ? storage : JSON.stringify(storage)) + ");" : "") + " localStorage.setItem('qalta-ui-v1', JSON.stringify(" + JSON.stringify(ui || { theme: "light" }) + ")); true");
    await b.goto(URL); await b.wait(500);
  };
  await b.size(390, 844, true, 2);
  await b.reduceMotion(true);

  // 1. the controls in the sheet header work with a real mouse and a real finger
  await fresh(fixture());
  await mouseTap(".q-fab"); await b.wait(350);
  ok(await exists("#layer-entry"), "a real mouse click on the + button opens the sheet");
  await mouseTap("#layer-entry .q-entry-head [role=radio][aria-checked=false]"); await b.wait(300);
  ok((await b.ev("document.querySelector('#layer-entry .q-entry-head [role=radio][aria-checked=true]').innerText")) === "Доход", "a real mouse click on the Expense/Income switch changes it");
  await touchTap("#layer-entry .q-entry-head [role=radio][aria-checked=false]"); await b.wait(300);
  ok((await b.ev("document.querySelector('#layer-entry .q-entry-head [role=radio][aria-checked=true]').innerText")) === "Расход", "a real tap on the switch changes it back");
  await mouseTap("#layer-entry .q-entry-head .q-nbtn"); await b.wait(350);
  ok(!(await exists("#layer-entry")), "a real mouse click on the close button closes the sheet");
  await mouseTap(".q-fab"); await b.wait(350);
  await touchTap("#layer-entry .q-entry-head .q-nbtn"); await b.wait(350);
  ok(!(await exists("#layer-entry")), "a real tap on the close button closes the sheet");

  // 2. a whole entry with a real mouse: keypad, Save, undo toast
  await mouseTap(".q-wcard:last-of-type"); await b.wait(350);
  for (const k of ["1", "5", "0", "0"]) await mouseTap('.q-key[aria-label="' + k + '"]');
  ok((await text()).includes("1 500"), "keypad taps with a real mouse type the amount");
  await mouseTap(".q-primary"); await b.wait(350);
  ok(!(await exists("#layer-entry")) && (await text()).includes("Записано"), "Save with a real mouse click stores the operation");
  // Ctrl+Z takes it back while the toast is up
  await key("z", "KeyZ", 2); await b.wait(300);
  ok(!(await text()).includes("Записано"), "Ctrl+Z undoes the last action");

  // 2b. the one-line phrase with a real keyboard: it fills amount and category, Enter saves (the network file is
  //     fetched when the sheet opens)
  await mouseTap(".q-fab"); await b.wait(600);
  await mouseTap("#layer-entry .q-phrase-in"); await b.wait(150);
  await b.send("Input.insertText", { text: "кофе 2800" }); await b.wait(300);
  const phHint = await b.ev("document.querySelector('#layer-entry .q-hint').innerText");
  const phAmt = await b.ev("document.querySelector('#layer-entry .q-amount').innerText");
  ok(/Кафе/.test(phHint) && /2\s800/.test(phAmt), "a phrase typed on a real keyboard fills amount and category (" + phHint + ", " + phAmt.trim() + ")");
  await key("Enter", "Enter"); await b.wait(400);
  ok(!(await exists("#layer-entry")) && /Записано: Кафе/.test(await text()), "Enter in the phrase saves the operation");
  await key("z", "KeyZ", 2); await b.wait(300);
  ok(await b.ev("fetch('cat-model.json').then(r => r.ok)"), "the category network file is served next to the page");

  // 3. focus goes back to the control that opened the sheet
  await b.ev("document.querySelector('.q-fab').focus()");
  await b.ev("document.querySelector('.q-fab').click()"); await b.wait(350);
  await key("Escape", "Escape"); await b.wait(400);
  ok((await active()).includes("q-fab"), "after Escape focus is back on the + button (was: the page body)");

  // 4. segmented controls: one tab stop, arrow keys move the selection
  await mouseTap(".q-tab:nth-child(2)"); await b.wait(400);
  ok((await active()).includes("t-large") || (await active()).startsWith("|H1"), "switching tabs moves focus to the new screen's heading");
  const tabStops = await b.ev("[...document.querySelectorAll('[role=radiogroup]')].map(g=>[...g.querySelectorAll('[role=radio]')].filter(x=>x.tabIndex===0).length).join()");
  ok(/^1(,1)*$/.test(tabStops), "each segmented control is a single tab stop (" + tabStops + ")");
  await b.ev("document.querySelector('[role=radiogroup] [role=radio][aria-checked=true]').focus()");
  await key("ArrowRight", "ArrowRight"); await b.wait(250);
  ok((await b.ev("document.querySelector('[role=radiogroup] [role=radio][aria-checked=true]').innerText")) !== "Месяц", "the right arrow selects the next segment");

  // 4b. common phone heights, a category chosen (the header grows by a line): the keypad is never pushed under the Save
  //     plate and the category row is never squashed; the details in the middle scroll on their own
  for (const [w, h] of [[390, 844], [360, 780], [375, 667]]) {
    await b.size(w, h, true, 2);
    await fresh(fixture());
    await b.ev("document.querySelector('.q-fab').click(); true"); await b.wait(400);
    await b.ev("[...document.querySelectorAll('#layer-entry .q-chip')].find(x => x.innerText.includes('Продукты')).click(); true"); await b.wait(300);
    const lay = await b.ev(`(()=>{const R=s=>document.querySelector(s).getBoundingClientRect(), sheet=document.querySelector('#layer-entry');
      return { lastKey: Math.max(...[...document.querySelectorAll('#layer-entry .q-key')].map(k=>k.getBoundingClientRect().bottom)), plate: R('#layer-entry .q-entry-save').top,
        chipsTop: R('#layer-entry .q-chips').top, chipsBot: R('#layer-entry .q-chips').bottom, headBot: R('#layer-entry .q-entry-head').bottom, keypadTop: R('#layer-entry .q-keypad').top,
        squashed: document.querySelector('#layer-entry .q-chips').scrollHeight - document.querySelector('#layer-entry .q-chips').clientHeight,
        sheetScroll: sheet.scrollHeight - sheet.clientHeight }})()`);
    ok(lay.sheetScroll <= 0 && lay.lastKey <= lay.plate + 0.5, w + "x" + h + ": the whole keypad is above Save and the sheet needs no scrolling (keys end at " + Math.round(lay.lastKey) + ", Save starts at " + Math.round(lay.plate) + ")");
    ok(lay.squashed <= 1 && lay.chipsTop >= lay.headBot - 0.5 && lay.chipsBot <= lay.keypadTop + 0.5, w + "x" + h + ": the category row is fully visible, not squashed (" + lay.squashed + " px of the chips are cut off)");
  }
  await b.size(390, 844, true, 2);

  // 5. a short landscape screen: the sheet scrolls and Save stays reachable
  await b.size(844, 390, true, 2);
  await b.goto(URL); await b.wait(500);
  await b.ev("document.querySelector('.q-fab').click()"); await b.wait(400);
  const save = await rectOf("#layer-entry .q-primary");
  const head = await rectOf("#layer-entry .q-amount");
  ok(save && save.b <= 390 + 1 && save.t >= 0, "landscape: the Save button is on screen without scrolling (sticky)");
  ok(head && head.t >= 0 && head.b <= 390, "landscape: the amount stays in view");
  await b.ev("localStorage.clear(); true");

  // 6. data notices belong to every screen
  await b.size(390, 844, true, 2);
  await fresh("{broken json");
  ok((await text()).includes("не удалось прочитать"), "unreadable data: the notice is shown on the overview");
  await mouseTap(".q-tab:nth-child(2)"); await b.wait(300);
  ok((await text()).includes("не удалось прочитать"), "... and on the history screen");
  await mouseTap(".q-tab:nth-child(3)"); await b.wait(300);
  ok((await text()).includes("не удалось прочитать"), "... and on the debts screen");
  await b.ev("[...document.querySelectorAll('.q-banner button')].find(x=>x.innerText.includes('Скрыть')).click()"); await b.wait(200);
  ok(!(await text()).includes("не удалось прочитать"), "the notice can be dismissed");

  // 7. storage that refuses writes: the person is told on every screen
  await fresh(null);
  await b.ev("window.__set = Storage.prototype.setItem; Storage.prototype.setItem = function () { throw new Error('QuotaExceededError'); }; true");
  await mouseTap(".q-wcard:last-of-type"); await b.wait(300);
  for (const k of ["9", "0", "0"]) await mouseTap('.q-key[aria-label="' + k + '"]');
  await mouseTap(".q-primary"); await b.wait(700);
  await mouseTap(".q-tab:nth-child(2)"); await b.wait(300);
  ok((await text()).includes("не сохраняются"), "a refused write is reported on the history screen too");
  await mouseTap(".q-tab:nth-child(3)"); await b.wait(300);
  ok((await text()).includes("не сохраняются"), "... and on the debts screen");
  await b.ev("Storage.prototype.setItem = window.__set; true");
  await b.wait(2600);                                                  // the retry
  ok(!(await text()).includes("не сохраняются"), "once storage works again the warning goes away by itself");
  ok(await b.ev("JSON.parse(localStorage.getItem('qalta-proto-v1')).ops.length === 1"), "and the operation made meanwhile was written by the retry");

  // 8. the page started offline from the service worker's point of view keeps its shell name in sync with the build
  const swv = await b.ev("fetch('sw.js').then(r=>r.text()).then(t=>/qalta-shell-[0-9a-f]{8}/.exec(t)&&/qalta-shell-[0-9a-f]{8}/.exec(t)[0])");
  ok(/^qalta-shell-[0-9a-f]{8}$/.test(swv || ""), "sw.js carries a stamped cache name (" + swv + ")");

  const bad = b.logs.filter(l => /dc-runtime|never resolved|TypeError|ReferenceError|Uncaught|EXC:/.test(l) && !/chrome-extension|page_helper|QuotaExceededError|A listener indicated an asynchronous response/.test(l));
  ok(bad.length === 0, "no runtime warnings or exceptions in the console" + (bad.length ? ": " + bad.slice(0, 3).join(" | ") : ""));
  console.log(fails ? "\nFAILURES: " + fails : "\nALL REAL-INPUT FLOWS PASS");
  if (fails) process.exitCode = 1;
};
