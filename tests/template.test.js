// node --test tests/template.test.js
// Static contract between the markup and the view-model, plus the dc-runtime pitfalls we hit
// before (see docs/UX-SPEC.md, "Ограничения среды").
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { load, makeStorage } = require("./helpers/harness.js");
const { buildTemplate } = require("../tools/build.js");

const template = buildTemplate();
const markupStart = template.indexOf("<x-dc>");
const helmetEnd = template.indexOf("</helmet>");
const markup = template.slice(helmetEnd + "</helmet>".length, template.indexOf("</x-dc>", markupStart));

// ───────── sample states that make every screen and layer render with data ─────────

function sampleVals() {
  const h = load({ storage: makeStorage() });
  const { c, QL } = h;
  const now = Date.now(), day0 = QL.startOfDay(now);
  const op = (id, d, cat, sum, pay, extra) => Object.assign({ id, date: QL.ddmm(day0 - d * 86400e3), ts: day0 - d * 86400e3 + 60e3, cat, note: id % 2 ? "заметка" : "", sum, pay }, extra || {});
  const base = {
    ops: [op(1, 0, "Продукты", -2400, "card"), op(2, 0, "Кафе", -6800, "cash"), op(3, 1, "Зарплата", 240000, "card"), op(4, 2, "Транспорт", -1200, "cash"), op(5, 3, "Дом", -41000, "card"),
      op(6, 9, "Подарки", -5000, "card"), op(7, 0, "Мои расходы", -300, "card", { ts: undefined })],
    debts: [
      { id: 11, who: "Айдос", note: "за билеты", sum: 40000, mine: true, paid: 15000, log: [{ sum: 15000, date: "01.10", ts: now, id: "a" }], due: QL.ymd(QL.addDays(now, 5)) },
      { id: 12, who: "Мадина", note: "", sum: 14000, mine: true, paid: 0, log: [], due: QL.ymd(QL.addDays(now, -3)) },
      { id: 13, who: "Ержан", note: "", sum: 18500, mine: false, paid: 0, log: [] }
    ],
    closed: [{ id: 14, who: "Камила", note: "", sum: 5000, mine: true, paid: 5000, log: [], closedAt: "01.10", reason: "full" }],
    catColors: { "Мои расходы": "#FF2D55" }, catIcons: {}, eCats: undefined, iCats: undefined, budget: 250000, openCash: 5000, openCard: 100000, flashId: 1,
    toast: { text: "x", undo: true }, storageError: true
  };
  // balance tip needs an unknown balance, so sample twice and union
  const samples = [];
  const take = (patch, setup) => {
    const hh = load({ storage: makeStorage() });
    hh.c.setState(Object.assign({}, base, patch || {}));
    if (setup) setup(hh.c);
    samples.push(hh.c.renderVals());
  };
  ["home", "history", "debts", "settings"].forEach(tab => take({ tab }));
  take({ tab: "home", openCash: undefined, openCard: undefined, budget: undefined });
  take({ tab: "home" }, c => { const d = new Date(); /* month tip window not guaranteed */ c.setState({ tips: {} }); });
  take({ tab: "history", hq: "zzz" });
  take({ tab: "debts", debtSide: "owe", showClosed: true });
  take({ tab: "debts", debtSide: "owed", showClosed: true });
  take({ tab: "settings", fbUser: { uid: "u", name: "Имя", email: "e@x" }, fbStatus: "synced" });
  const entry = (opts, setup) => take({ tab: "home" }, c => { c.openEntry(opts); if (setup) setup(c); });
  entry({ mode: "op", cat: "Кафе" }, c => { c.setForm({ note: "x" }); });
  entry({ mode: "op" }, c => { c.saveEntry(); });
  entry({ mode: "op", edit: base.ops[0] });
  entry({ mode: "debt", side: "owe" }, c => { c.setForm({ who: "Нурлан", due: QL.ymd(QL.addDays(now, 3)) }); });
  entry({ mode: "debt", edit: base.debts[0] });
  entry({ mode: "repay", debt: base.debts[0] });
  entry({ mode: "budget" });
  entry({ mode: "opening", account: "card" });
  entry({ mode: "op", cat: "Кафе" }, c => { c.openLayer("cats"); c.setState({ pkQ: "ка" }); });
  entry({ mode: "op", cat: "Кафе" }, c => { c.openLayer("when", { whenFor: "op" }); c.setForm({ ts: now - 86400e3 }); c.setState({ whMsg: "m" }); });
  entry({ mode: "debt", side: "owed" }, c => { c.openLayer("when", { whenFor: "due" }); c.setForm({ due: QL.ymd(now) }); });
  entry({ mode: "op" }, c => { c.setForm({ amount: "7" }); c.dismissTop(); });             // confirm layer
  take({ tab: "debts" }, c => { c.openLayer("debtView", { viewDebtId: 11 }); });
  take({ tab: "debts", showClosed: true }, c => { c.openLayer("debtView", { viewDebtId: 14 }); });
  take({ tab: "settings", clReorder: true }, c => { c.openCatList("expense"); c.setState({ clReorder: true }); });
  take({ tab: "settings" }, c => { c.openCatList("income"); c.openCatEdit({ kind: "income", name: "Зарплата" }); c.setState({ ce: Object.assign({}, c.state.ce, { err: "e" }) }); });
  take({ tab: "settings" }, c => { c.openCatEdit({ kind: "expense", name: null }); });
  take({ tab: "settings" }, c => { c.openLayer("backup", { bkMsg: "ok", bkCls: "tx-pos" }); });
  return { samples, I18N: h.I18N };
}

// shape map: path -> Set(keys); arrays are "path[]"
function collectShapes(samples) {
  const shapes = {};
  const add = (p, keys) => { (shapes[p] = shapes[p] || new Set()); keys.forEach(k => shapes[p].add(k)); };
  const walk = (p, v) => {
    if (Array.isArray(v)) {
      shapes[p + "[]"] = shapes[p + "[]"] || new Set();
      v.forEach(item => { if (item && typeof item === "object") { add(p + "[]", Object.keys(item)); Object.keys(item).forEach(k => walk(p + "[]." + k, item[k])); } });
      shapes["#seen:" + p] = (shapes["#seen:" + p] || new Set()); if (v.length) shapes["#seen:" + p].add("nonempty");
    } else if (v && typeof v === "object") {
      add(p, Object.keys(v)); Object.keys(v).forEach(k => walk(p ? p + "." + k : k, v[k]));
    }
  };
  samples.forEach(s => { add("", Object.keys(s)); Object.keys(s).forEach(k => walk(k, s[k])); });
  return shapes;
}

test("every binding in the markup is provided by the view-model (and every t.* string exists)", () => {
  const { samples, I18N } = sampleVals();
  const shapes = collectShapes(samples);
  const problems = [];
  const stack = [];   // { v, key }
  const re = /<sc-for\b[^>]*>|<\/sc-for>|\{\{\s*([^}]+?)\s*\}\}/g;
  let m;
  const resolveKey = path => {                       // path like "g.rows" or "en.chips" or "tabs" -> shape key of its items
    const parts = path.split(".");
    const sc = stack.slice().reverse().find(s => s.v === parts[0]);
    if (sc) return sc.key + "." + parts.slice(1).join(".") + "[]";
    return path + "[]";
  };
  const check = expr => {
    expr = expr.replace(/^!/, "").trim();
    if (!/^[A-Za-z_][\w.]*$/.test(expr)) return;     // literals etc.
    const parts = expr.split(".");
    const sc = stack.slice().reverse().find(s => s.v === parts[0]);
    if (sc) {
      if (parts.length > 1 && !(shapes[sc.key] && shapes[sc.key].has(parts[1]))) problems.push("loop var " + parts[0] + " (" + sc.key + ") has no '" + parts[1] + "' in " + expr);
      return;
    }
    if (parts[0] === "t") { if (parts.length > 1 && !(parts[1] in I18N.ru)) problems.push("missing string t." + parts[1]); return; }
    if (!(shapes[""] && shapes[""].has(parts[0]))) { problems.push("view-model has no '" + parts[0] + "' (" + expr + ")"); return; }
    if (parts.length > 1) {
      const nested = shapes[parts[0]];
      if (!nested || !nested.has(parts[1])) problems.push("'" + parts[0] + "' has no '" + parts[1] + "' (" + expr + ")");
    }
  };
  while ((m = re.exec(markup))) {
    const tag = m[0];
    if (tag.indexOf("<sc-for") === 0) {
      const list = /list="\{\{\s*([^}]+?)\s*\}\}"/.exec(tag), as = /\sas="([^"]+)"/.exec(tag);
      assert.ok(list && as, "sc-for needs list and as: " + tag);
      check(list[1]);
      const key = resolveKey(list[1]);
      if (!shapes[key]) problems.push("list " + list[1] + " never had items in the samples (cannot verify " + key + ")");
      stack.push({ v: as[1], key });
    } else if (tag === "</sc-for>") stack.pop();
    else check(m[1]);
  }
  assert.equal(stack.length, 0, "unbalanced sc-for");
  assert.deepEqual(problems, []);
});

test("markup follows the dc-runtime rules", () => {
  const problems = [];
  // 1. a camelCase identifier directly before '=' inside {{ }} is mangled by the runtime
  (markup.match(/\{\{[^}]*\}\}/g) || []).forEach(b => { if (/[a-z][A-Z]\w*\s*[=!]?=/.test(b) && /==/.test(b)) problems.push("equality with camelCase identifier: " + b); });
  // 2. attribute values that start and end with a binding and hold several are treated as ONE expression
  const attrRe = /\s([\w:-]+)="([^"]*)"/g;
  let m;
  while ((m = attrRe.exec(markup))) {
    const v = m[2].trim();
    if (!v.startsWith("{{") || !v.endsWith("}}")) continue;
    if ((v.match(/\{\{/g) || []).length > 1) problems.push("attribute " + m[1] + " starts and ends with bindings and has several: " + v);
  }
  // 3. camelCase attribute names must be written sc-camel-*
  const tagRe = /<[a-zA-Z][^>]*>/g;
  while ((m = tagRe.exec(markup))) {
    const bad = (m[0].match(/\s([a-z]+[A-Z]\w*)=/g) || []).filter(x => !/sc-camel/.test(x));
    if (bad.length) problems.push("camelCase attribute in " + m[0].slice(0, 80) + ": " + bad.join(","));
  }
  assert.deepEqual(problems, []);
});

test("all clickable controls are real buttons or have role=button and tabindex", () => {
  const problems = [];
  const re = /<(div|span|label)\b[^>]*sc-camel-on-click=[^>]*>/g;
  let m;
  while ((m = re.exec(markup))) {
    if (/class="q-dim"/.test(m[0]) && /aria-hidden="true"/.test(m[0])) continue;   // click-away backdrop: Escape and the close button are the keyboard routes
    if (!/role="button"/.test(m[0]) || !/tabindex="0"/.test(m[0])) problems.push(m[0].slice(0, 100));
  }
  assert.deepEqual(problems, []);
});

test("every control that has only an icon has an accessible name", () => {
  const problems = [];
  const re = /<button\b[^>]*>(?:(?!<\/button>)[\s\S])*<\/button>/g;
  let m;
  while ((m = re.exec(markup))) {
    const html = m[0];
    const inner = html.replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<[^>]+>/g, "").replace(/\{\{[^}]*\}\}/g, "X").trim();
    const hasText = inner.length > 0;
    if (!hasText && !/aria-label=/.test(html)) problems.push(html.slice(0, 120));
  }
  assert.deepEqual(problems, []);
});

test("dialogs are modal, labelled and focusable", () => {
  const re = /<div id="layer-[^"]+"[^>]*>/g;
  let m, n = 0;
  while ((m = re.exec(markup))) {
    n++;
    assert.match(m[0], /role="(dialog|alertdialog)"/, m[0]);
    assert.match(m[0], /aria-modal="true"/, m[0]);
    assert.match(m[0], /aria-label=/, m[0]);
    assert.match(m[0], /tabindex="-1"/, m[0]);
  }
  assert.ok(n >= 8, "all layers present");
});

test("the packed template keeps no unresolved build placeholders and no old design-system leftovers", () => {
  assert.ok(!/%%/.test(template));
  assert.ok(!/Playfair|Archivo|Modernist/.test(template));
  assert.ok(!/font-family:\s*'Manrope'/.test(template));
});

test("component only reads strings that exist (t.* in component.js)", () => {
  const { I18N } = load({ storage: makeStorage() });
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "component.js"), "utf8");
  const missing = new Set();
  (src.match(/\bt\.([a-zA-Z][a-zA-Z0-9_]*)/g) || []).forEach(x => { const k = x.slice(2); if (!(k in I18N.ru)) missing.add(k); });
  assert.deepEqual([...missing], []);
});
