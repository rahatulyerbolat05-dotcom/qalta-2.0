// node tools/cdp.js tools/e2e/shots.js  — walk through the app on a phone viewport, screenshot every screen/layer.
const fs = require("fs"), path = require("path");
const fixture = require("./fixture.js");
const OUT = path.join(__dirname, "out");
const URL = process.env.QALTA_URL || "http://localhost:8820/index.html";
const THEME = process.env.QALTA_THEME || "light";
module.exports = async (b) => {
  fs.mkdirSync(OUT, { recursive: true });
  const shot = n => b.shot(path.join(OUT, THEME + "-" + n + ".png"));
  const click = sel => b.ev("(()=>{const e=document.querySelector(" + JSON.stringify(sel) + ");if(!e)return false;e.click();return true})()");
  const clickText = (sel, txt) => b.ev("(()=>{const e=[...document.querySelectorAll(" + JSON.stringify(sel) + ")].find(x=>x.innerText.trim().includes(" + JSON.stringify(txt) + "));if(!e)return false;e.click();return true})()");
  const key = k => click('.q-key[aria-label="' + k + '"]');
  await b.size(390, 844, true, 2);
  await b.reduceMotion(true);
  await b.goto(URL);
  await b.ev("localStorage.setItem('qalta-proto-v1', " + JSON.stringify(JSON.stringify(fixture())) + "); localStorage.setItem('qalta-ui-v1', JSON.stringify({theme:" + JSON.stringify(THEME) + "})); true");
  await b.goto(URL); await b.wait(900);
  await shot("01-home");
  // quick card -> entry sheet
  console.log("wallet card:", await click(".q-wcard:last-of-type")); await b.wait(700);
  await shot("02-entry-empty");
  for (const k of ["2", "4", "0", "0"]) await key(k);
  await b.wait(300); await shot("03-entry-typed");
  console.log("more categories:", await clickText(".q-chip", "Ещё")); await b.wait(700);
  await shot("04-picker");
  console.log("pick:", await clickText(".q-cell", "Транспорт")); await b.wait(500);
  console.log("date row:", await clickText("button.q-row", "Дата")); await b.wait(600);
  await shot("05-when");
  await clickText(".q-nbtn", "Готово"); await b.wait(400);
  console.log("save:", await clickText(".q-primary", "Записать расход")); await b.wait(700);
  await shot("06-after-save-toast");
  // history
  await clickText(".q-tab", "История"); await b.wait(600);
  await shot("07-history");
  await b.ev("document.getElementById('q-scroll').scrollTop = 600"); await b.wait(300);
  await shot("08-history-scrolled");
  await b.ev("document.getElementById('q-scroll').scrollTop = 0");
  console.log("open row:", await click(".q-swipe .q-row")); await b.wait(700);
  await shot("09-edit-sheet");
  await click(".q-sheet .q-nbtn"); await b.wait(500);
  // debts
  await clickText(".q-tab", "Долги"); await b.wait(600);
  await shot("10-debts");
  console.log("open debt:", await click(".q-group .q-row")); await b.wait(700);
  await shot("11-debt-view");
  console.log("repay:", await clickText(".q-primary", "Вернули часть")); await b.wait(700);
  await shot("12-repay");
  await click(".q-sheet .q-nbtn"); await b.wait(400); await click(".q-sheet .q-nbtn"); await b.wait(400);
  console.log("add debt:", await click('button[aria-label="Добавить долг"]')); await b.wait(700);
  await shot("13-debt-new");
  await click(".q-sheet .q-nbtn"); await b.wait(500);
  // settings
  await clickText(".q-tab", "Настройки"); await b.wait(600);
  await shot("14-settings");
  await b.ev("document.getElementById('q-scroll').scrollTop = 9999"); await b.wait(300);
  await shot("15-settings-bottom");
  await b.ev("document.getElementById('q-scroll').scrollTop = 0");
  console.log("cat list:", await clickText(".q-row", "Категории расходов")); await b.wait(700);
  await shot("16-categories");
  console.log("cat edit:", await click(".q-rowmain")); await b.wait(700);
  await shot("17-category-edit");
  await click(".q-sheet .q-nbtn"); await b.wait(400);
  await clickText(".q-nbtn", "Настройки"); await b.wait(500);
  console.log("backup:", await clickText(".q-row", "Резервная копия")); await b.wait(600);
  await shot("18-backup");
};
