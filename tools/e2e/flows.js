// node tools/cdp.js tools/e2e/flows.js — behaviour checks in a real browser (assertions, exit code 1 on failure).
const fixture = require("./fixture.js");
const URL = process.env.QALTA_URL || "http://localhost:8820/index.html";
let fails = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };

// set the value of a React-controlled input the way a user typing would
const typeInto = (b, selector, value) => b.ev("(()=>{const i=document.querySelector(" + JSON.stringify(selector) + ");const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;s.call(i," + JSON.stringify(value) + ");i.dispatchEvent(new Event('input',{bubbles:true}));})()");

module.exports = async (b) => {
  const click = sel => b.ev("(()=>{const e=document.querySelector(" + JSON.stringify(sel) + ");if(!e)return false;e.click();return true})()");
  const clickText = (sel, txt) => b.ev("(()=>{const e=[...document.querySelectorAll(" + JSON.stringify(sel) + ")].find(x=>x.innerText.trim().includes(" + JSON.stringify(txt) + "));if(!e)return false;e.click();return true})()");
  const text = () => b.ev("document.body.innerText");
  const exists = sel => b.ev("!!document.querySelector(" + JSON.stringify(sel) + ")");
  const press = async keys => { for (const k of keys) await click('.q-key[aria-label="' + k + '"]'); };
  const esc = () => b.ev("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
  const fresh = async (storage) => {
    await b.goto(URL);
    await b.ev("localStorage.clear(); " + (storage ? "localStorage.setItem('qalta-proto-v1'," + JSON.stringify(JSON.stringify(storage)) + ");" : "") + " localStorage.setItem('qalta-ui-v1', JSON.stringify({theme:'light'})); true");
    await b.goto(URL); await b.wait(500);
  };
  await b.size(390, 844, true, 2);
  await b.reduceMotion(true);

  // 1. first run
  await fresh(null);
  let t = await text();
  ok(t.includes("Обзор") && t.includes("Операций пока нет"), "first run: empty overview, no demo data");
  ok(!t.includes("334 100") && !t.includes("250 000"), "first run: no invented balance or budget");
  ok(t.includes("Остатки на счетах"), "first run: balance setup tip is offered");
  ok((await b.ev("document.querySelectorAll('.q-wcard').length")) === 3, "first run: three quick cards");

  // 2. add through a quick card, undo
  await click(".q-wcard:last-of-type"); await b.wait(300);
  ok(await exists("#layer-entry"), "quick card opens the entry sheet");
  ok((await b.ev("document.activeElement && document.activeElement.id")) === "layer-entry", "focus moves into the dialog");
  ok(await b.ev("document.getElementById('q-main').inert === true"), "background is inert while the sheet is open");
  await press(["2", "4", "0", "0"]);
  ok((await text()).includes("2 400"), "amount is shown with a no-break group");
  await clickText(".q-primary", "Записать расход"); await b.wait(300);
  t = await text();
  ok(!(await exists("#layer-entry")), "sheet closes after saving");
  ok(t.includes("Записано") && t.includes("Отменить"), "toast offers undo");
  ok(t.includes("2 400") && t.includes("Продукты"), "operation appears in Recent");
  await clickText(".q-toast button", "Отменить"); await b.wait(200);
  ok((await text()).includes("Операций пока нет"), "undo removes the operation");
  ok(await b.ev("document.getElementById('q-main').inert === false"), "background is interactive again");

  // 3. Back / Escape / swipe-down close the sheet
  await click(".q-fab"); await b.wait(250);
  ok(await exists("#layer-entry"), "plus opens the entry sheet");
  await b.ev("history.back()"); await b.wait(300);
  ok(!(await exists("#layer-entry")), "browser Back closes the sheet");
  await click(".q-fab"); await b.wait(250);
  await esc(); await b.wait(250);
  ok(!(await exists("#layer-entry")), "Escape closes the sheet");
  await click(".q-fab"); await b.wait(250);
  await b.ev("(()=>{const h=document.querySelector('#layer-entry .q-sheet-drag');const r=h.getBoundingClientRect();const x=r.left+50,y=r.top+10;const ev=(t,yy)=>h.dispatchEvent(new PointerEvent(t,{clientX:x,clientY:yy,pointerId:1,pointerType:'touch',bubbles:true}));ev('pointerdown',y);ev('pointermove',y+60);ev('pointermove',y+200);ev('pointerup',y+200);})()");
  await b.wait(400);
  ok(!(await exists("#layer-entry")), "dragging the sheet down dismisses it");

  // 4. typed data protects against accidental close
  await click(".q-fab"); await b.wait(250);
  await press(["7"]);
  await esc(); await b.wait(250);
  ok(await exists("#layer-confirm"), "closing with typed data asks first");
  await clickText(".q-row", "Продолжить"); await b.wait(200);
  ok((await exists("#layer-entry")) && !(await exists("#layer-confirm")), "'Continue' keeps the sheet");
  await esc(); await b.wait(200);
  await clickText(".q-row", "Не сохранять"); await b.wait(300);
  ok(!(await exists("#layer-entry")), "'Discard' closes it");

  // 5. category + note + date, debt with a free-text name
  await click(".q-fab"); await b.wait(250);
  await clickText(".q-chip", "Ещё"); await b.wait(250);
  await clickText(".q-cell", "Аптека"); await b.wait(250);
  await press(["5", "000"]);
  await typeInto(b, '#layer-entry input[placeholder="Необязательно"]', "антибиотики"); await b.wait(150);
  await clickText("button.q-row", "Дата"); await b.wait(250);
  await clickText(".q-chip", "Вчера"); await b.wait(200);
  await clickText(".q-nbtn", "Готово"); await b.wait(250);
  await clickText(".q-primary", "Записать расход"); await b.wait(300);
  await clickText(".q-tab", "История"); await b.wait(300);
  t = await text();
  ok(t.includes("Вчера") && t.includes("Аптека") && t.includes("антибиотики"), "history groups by day and keeps the note");
  await clickText(".q-tab", "Долги"); await b.wait(300);
  await click('button[aria-label="Добавить долг"]'); await b.wait(250);
  await typeInto(b, '#layer-entry input[placeholder="Имя"]', "Нурлан Бекетов"); await b.wait(150);
  await press(["2", "5", "000"]);
  await clickText(".q-primary", "Сохранить долг"); await b.wait(300);
  t = await text();
  ok(t.includes("Нурлан Бекетов") && t.includes("25 000"), "a debt can be recorded for any name");

  // 6. persistence across reload
  await b.goto(URL); await b.wait(500);
  await clickText(".q-tab", "Долги"); await b.wait(300);
  ok((await text()).includes("Нурлан Бекетов"), "data survives a reload");

  // 7. appearance and language
  await clickText(".q-tab", "Настройки"); await b.wait(300);
  await clickText(".q-seg-i", "Тёмная"); await b.wait(200);
  ok((await b.ev("document.documentElement.getAttribute('data-theme')")) === "dark", "theme switch sets data-theme");
  ok((await b.ev("getComputedStyle(document.querySelector('.q-app')).backgroundColor")) === "rgb(0, 0, 0)", "dark theme paints a black background");
  await clickText(".q-seg-i", "Eng"); await b.wait(300);
  ok((await text()).includes("Settings") && (await b.ev("document.documentElement.lang")) === "en", "language switch (English) updates text and <html lang>");
  await clickText(".q-seg-i", "Қаз"); await b.wait(300);
  ok((await text()).includes("Баптаулар"), "Kazakh strings");
  await clickText(".q-seg-i", "Рус"); await b.wait(200);

  // 7b. cloud section: the Firebase SDK loaded exactly once and the sign-in entry is offered
  await clickText(".q-tab", "Настройки"); await b.wait(300);
  ok((await text()).includes("Войти через Google"), "settings offer Google sign-in (Firebase SDK initialised)");
  ok(!b.logs.some(l => /already defined in the global scope/.test(l)), "Firebase SDK is loaded only once");

  // 8. budget
  await clickText(".q-row", "Бюджет на месяц"); await b.wait(250);
  await press(["3", "0", "0", "000"]);
  await clickText(".q-primary", "Сохранить бюджет"); await b.wait(300);
  await clickText(".q-tab", "Обзор"); await b.wait(300);
  t = await text();
  ok(t.includes("Осталось") && t.includes("в день"), "budget produces the remaining amount and a per-day pace");

  // 9. large data: responsiveness
  const big = fixture(); const ops = []; const now = Date.now();
  for (let i = 0; i < 5000; i++) ops.push({ id: 1800000000000000 + i, date: "01.01", ts: now - i * 7200e3, cat: ["Продукты", "Кафе", "Транспорт", "Дом", "Аптека"][i % 5], note: "", sum: -((i % 90) + 10) * 10, pay: i % 3 ? "card" : "cash" });
  big.ops = ops;
  await fresh(big);
  const t0 = await b.ev("performance.now()");
  await clickText(".q-tab", "История"); await b.wait(100);
  const t1 = await b.ev("performance.now()");
  console.log("history with 5000 operations opened in ~" + Math.round(t1 - t0 - 100) + " ms");
  ok(t1 - t0 < 1500, "history with 5000 operations opens quickly");
  await click(".q-fab"); await b.wait(250);
  const k0 = await b.ev("performance.now()");
  await press(["1", "2", "3", "4", "5", "6"]);
  const k1 = await b.ev("performance.now()");
  console.log("six key presses with 5000 operations: " + Math.round(k1 - k0) + " ms");
  ok((k1 - k0) / 6 < 80, "key presses stay fast with 5000 operations");

  // 10. console health
  const bad = b.logs.filter(l => /dc-runtime|never resolved|TypeError|ReferenceError|Uncaught|EXC:/.test(l) && !/chrome-extension|page_helper/.test(l));
  ok(bad.length === 0, "no runtime warnings or exceptions in the console" + (bad.length ? ": " + bad.slice(0, 3).join(" | ") : ""));
  console.log(fails ? "\nFAILURES: " + fails : "\nALL FLOWS PASS");
  if (fails) process.exitCode = 1;
};
