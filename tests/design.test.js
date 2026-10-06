// node --test tests/design.test.js — contrast of the design tokens (WCAG 2.2 AA) and i18n integrity.
const test = require("node:test");
const assert = require("node:assert/strict");
const tokens = require("../src/tokens.js");
const L = require("../src/logic.js");
const I18N = require("../src/i18n.js");

function parseColor(v, tokenSet, depth) {
  v = String(v).trim();
  if (v.startsWith("#")) return { rgb: L.hexToRgb(v), a: 1 };
  const m = /^rgba?\(([^)]+)\)$/.exec(v);
  if (m) { const p = m[1].split(",").map(x => parseFloat(x)); return { rgb: p.slice(0, 3), a: p.length > 3 ? p[3] : 1 }; }
  throw new Error("cannot parse " + v);
}
function over(fg, bg) {            // composite fg over an opaque bg
  return fg.rgb.map((c, i) => c * fg.a + bg.rgb[i] * (1 - fg.a));
}
function ratio(a, b) {
  const la = L.relLuminance(a), lb = L.relLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

["light", "dark"].forEach(mode => {
  test("tokens (" + mode + "): text colours pass AA on the surfaces they sit on", () => {
    const set = tokens[mode];
    tokens.contrastPairs.forEach(([fgTok, bgTok, min]) => {
      const bg = parseColor(set[bgTok]);
      const fg = parseColor(set[fgTok]);
      const r = ratio(over(fg, bg), bg.rgb);
      assert.ok(r >= min, mode + ": " + fgTok + " on " + bgTok + " = " + r.toFixed(2) + " < " + min);
    });
  });
});

test("tokens: the secondary label is darker than Apple's (that is what makes it pass AA)", () => {
  const bg = { rgb: [255, 255, 255], a: 1 };
  const apple = ratio(over({ rgb: [60, 60, 67], a: 0.6 }, bg), [255, 255, 255]);
  const ours = ratio(over(parseColor(tokens.light["--label-2"]), bg), [255, 255, 255]);
  assert.ok(apple < 4.5 && ours >= 4.5, "apple " + apple.toFixed(2) + ", ours " + ours.toFixed(2));
});

test("tokens: light and dark define the same set of variables", () => {
  assert.deepEqual(Object.keys(tokens.light).filter(k => k.startsWith("--")).sort(), Object.keys(tokens.dark).filter(k => k.startsWith("--")).sort());
});

test("i18n: identical keys in ru / kz / en, no empty strings, same placeholders", () => {
  const ph = s => (String(s).match(/\{\w+\}/g) || []).sort().join(",");
  const ruKeys = Object.keys(I18N.ru).sort();
  ["kz", "en"].forEach(lang => {
    assert.deepEqual(Object.keys(I18N[lang]).sort(), ruKeys, lang + " keys differ from ru");
    ruKeys.forEach(k => {
      assert.ok(String(I18N[lang][k]).trim().length > 0, lang + "." + k + " is empty");
      assert.equal(ph(I18N[lang][k]), ph(I18N.ru[k]), lang + "." + k + " placeholders differ");
    });
  });
});

test("i18n: every default category has a translation and word forms exist", () => {
  L.DEFAULT_CATS.expense.concat(L.DEFAULT_CATS.income).forEach(n => {
    assert.ok(I18N.CAT_TR[n] && I18N.CAT_TR[n].kz && I18N.CAT_TR[n].en, "translation for " + n);
  });
  ["day", "time"].forEach(f => ["ru", "kz", "en"].forEach(l => assert.ok(I18N.forms[f][l].length >= 1)));
});
