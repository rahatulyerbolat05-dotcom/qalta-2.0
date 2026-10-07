#!/usr/bin/env node
// Trains the category network and writes cat-model.json (and docs/ML-REPORT.md).
//   node tools/ml/train.js            train, evaluate, write the model and the report
//   node tools/ml/train.js --eval     only print the evaluation (writes nothing)
//
// Data: tools/ml/lexicon.js turned into phrases the way people type them ("купил хлеб", "за такси",
// "кофе с собой"), passed through the same phrase parser as the app (src/parse.js) so the network sees
// exactly what it will see in use, plus spelling noise (a dropped, swapped or doubled letter) and Latin
// transliteration. Deterministic: a seeded generator, so the same sources give the same model.
//
// Honest evaluation: a first network is trained without 20 % of the words of every category and tested on
// them (words it never saw); a second set tests seen words in new phrasings and with typos. The shipped
// network is then trained on everything.
"use strict";
const fs = require("fs");
const path = require("path");
const CAT = require("../../src/cat.js");
const PARSE = require("../../src/parse.js");
const LEX = require("./lexicon.js");

const ROOT = path.join(__dirname, "..", "..");
// environment overrides exist for experiments only; the shipped model uses the defaults
const B = +process.env.QALTA_B || 4096, D = +process.env.QALTA_D || 16, H = +process.env.QALTA_H || 32;
// LR 0.02 made the hidden layer collapse (train accuracy ~20 %); 0.002–0.005 fits the data
const EPOCHS = +process.env.QALTA_EPOCHS || 8, LR = +process.env.QALTA_LR || 0.003, SEED = 20261007;

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const pick = (r, list) => list[Math.floor(r() * list.length)];

const LABELS = [], DIR = {};
Object.keys(LEX.expense).forEach(k => { LABELS.push(k); DIR[k] = "expense"; });
Object.keys(LEX.income).forEach(k => { LABELS.push(k); DIR[k] = "income"; });
const TERMS = LABELS.map(l => (LEX.expense[l] || LEX.income[l]).slice());

// words that say nothing about the category: the network must learn to look past them
const FILLER_BEFORE = ["купил", "купила", "оплатил", "оплата", "взял", "заказал", "покупка", "потратил на", "за", "на", "сатып алдым", "төледім", "bought", "paid for", ""];
const FILLER_AFTER = ["", "", "", "сегодня", "с женой", "с друзьями", "домой", "на работу", "опять", "немного", "ко", "мне", "себе", "бүгін", "today"];
const AMOUNTS = ["500", "1 200", "2800", "15000", "4 600", "2,5к", "120 000", "990₸", "3500 тг"];
const PAYS = ["", "", "", "картой", "наличными", "каспи", "нал"];
const DAYS = ["", "", "", "", "вчера", "в пятницу", "12.09", "кеше"];
const TRANSLIT = { а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ы: "y", э: "e", ю: "yu", я: "ya", ь: "", ъ: "" };

function typo(r, w) {
  if (w.length < 4) return w;
  const i = 1 + Math.floor(r() * (w.length - 2)), k = r();
  if (k < 0.35) return w.slice(0, i) + w.slice(i + 1);                    // a letter dropped
  if (k < 0.7) return w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2);   // two letters swapped
  return w.slice(0, i) + w[i] + w.slice(i);                               // a letter doubled
}
function noisy(r, term) {
  let t = term;
  if (r() < 0.12 && /[а-я]/.test(t)) t = t.split("").map(c => (TRANSLIT[c] !== undefined ? TRANSLIT[c] : c)).join("");
  if (r() < 0.2) t = t.split(" ").map(w => (r() < 0.6 ? typo(r, w) : w)).join(" ");
  if (r() < 0.15) t = t[0].toUpperCase() + t.slice(1);
  return t;
}
// one phrase as a person would type it, reduced to what the parser leaves for the network
function phrase(r, terms) {
  const parts = [pick(r, FILLER_BEFORE), noisy(r, pick(r, terms))];
  if (r() < 0.15) parts.push(noisy(r, pick(r, terms)));
  parts.push(pick(r, FILLER_AFTER), pick(r, AMOUNTS), pick(r, PAYS), pick(r, DAYS));
  const shuffled = r() < 0.3 ? [parts[4], parts[0], parts[1], parts[2], parts[3]] : parts;
  return PARSE.parsePhrase(shuffled.filter(Boolean).join(" "), Date.UTC(2026, 9, 7, 6)).rest;
}
function dataset(r, termsByLabel, perTerm) {
  const out = [];
  termsByLabel.forEach((terms, y) => {
    if (!terms.length) return;
    const n = Math.max(60, terms.length * perTerm);
    for (let i = 0; i < n; i++) { const x = phrase(r, terms); if (x) out.push({ f: CAT.features(x, B), y, x }); }
  });
  return out.filter(s => s.f.length);
}

// ── the network: mean of embeddings -> ReLU hidden layer -> softmax; Adam on the touched rows only ──
function initNet(r) {
  const g = s => (r() * 2 - 1) * s;
  const net = { E: new Float32Array(B * D), W1: new Float32Array(D * H), b1: new Float32Array(H), W2: new Float32Array(H * LABELS.length), b2: new Float32Array(LABELS.length) };
  for (let i = 0; i < net.E.length; i++) net.E[i] = g(0.1);
  for (let i = 0; i < net.W1.length; i++) net.W1[i] = g(Math.sqrt(6 / (D + H)));
  for (let i = 0; i < net.W2.length; i++) net.W2[i] = g(Math.sqrt(6 / (H + LABELS.length)));
  net.m = {}; net.v = {}; ["E", "W1", "b1", "W2", "b2"].forEach(k => { net.m[k] = new Float32Array(net[k].length); net.v[k] = new Float32Array(net[k].length); });
  net.t = 0;
  return net;
}
function forward(net, f) {
  const K = LABELS.length, e = new Float32Array(D);
  for (const b of f) for (let j = 0; j < D; j++) e[j] += net.E[b * D + j];
  for (let j = 0; j < D; j++) e[j] /= f.length;
  const h = new Float32Array(H);
  for (let k = 0; k < H; k++) { let a = net.b1[k]; for (let j = 0; j < D; j++) a += net.W1[j * H + k] * e[j]; h[k] = a > 0 ? a : 0; }
  const z = new Float32Array(K); let max = -Infinity;
  for (let k = 0; k < K; k++) { let a = net.b2[k]; for (let j = 0; j < H; j++) a += net.W2[j * K + k] * h[j]; z[k] = a; if (a > max) max = a; }
  let s = 0; for (let k = 0; k < K; k++) { z[k] = Math.exp(z[k] - max); s += z[k]; }
  for (let k = 0; k < K; k++) z[k] /= s;
  return { e, h, p: z };
}
function adam(net, key, i, g) {
  const b1 = 0.9, b2 = 0.999, m = net.m[key], v = net.v[key];
  m[i] = b1 * m[i] + (1 - b1) * g; v[i] = b2 * v[i] + (1 - b2) * g * g;
  net[key][i] -= LR * (m[i] / net.c1) / (Math.sqrt(v[i] / net.c2) + 1e-8);
}
function step(net, s) {
  const K = LABELS.length, { e, h, p } = forward(net, s.f);
  net.t++; net.c1 = 1 - Math.pow(0.9, net.t); net.c2 = 1 - Math.pow(0.999, net.t);
  const dz = p.slice(); dz[s.y] -= 1;
  const dh = new Float32Array(H);
  for (let j = 0; j < H; j++) { let a = 0; for (let k = 0; k < K; k++) { a += net.W2[j * K + k] * dz[k]; adam(net, "W2", j * K + k, h[j] * dz[k]); } dh[j] = h[j] > 0 ? a : 0; }
  for (let k = 0; k < K; k++) adam(net, "b2", k, dz[k]);
  const de = new Float32Array(D);
  for (let j = 0; j < D; j++) { let a = 0; for (let k = 0; k < H; k++) { a += net.W1[j * H + k] * dh[k]; adam(net, "W1", j * H + k, e[j] * dh[k]); } de[j] = a; }
  for (let k = 0; k < H; k++) adam(net, "b1", k, dh[k]);
  for (const b of s.f) for (let j = 0; j < D; j++) adam(net, "E", b * D + j, de[j] / s.f.length + 1e-5 * net.E[b * D + j]);
  return -Math.log(Math.max(p[s.y], 1e-9));
}
function train(data, r, log) {
  const net = initNet(r);
  for (let ep = 0; ep < EPOCHS; ep++) {
    for (let i = data.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = data[i]; data[i] = data[j]; data[j] = t; }
    let loss = 0; data.forEach(s => { loss += step(net, s); });
    if (log) log("epoch " + (ep + 1) + ": loss " + (loss / data.length).toFixed(3));
  }
  return net;
}

// The words the network was taught (and the 5-letter starts of longer ones), as sorted hashes: the app lets
// the network pick a category by itself only when the description has one of them (CAT.knows). On words it
// never saw it is right about 4 times in 10 yet sure of itself, so there it only orders the choices.
// Each hash remembers the category it was taught for most: a word counts for a category only when it appears
// there at least twice as often as anywhere else (a word standing alone as a term counts double), so "кофе"
// is Кафе despite "кофе в зернах" under Продукты, while "яндекс" (taxi, food, subscription) is no evidence.
// Two-letter words count only as whole terms ("зп"), never as parts of longer ones ("яндекс го" aside).
function knownWords(termLists) {
  const counts = new Map();
  const put = (h, y, wgt) => { const c = counts.get(h) || {}; c[y] = (c[y] || 0) + wgt; counts.set(h, c); };
  termLists.forEach((terms, y) => terms.forEach(term => {
    const ws = CAT.words(term), alone = ws.length === 1;
    ws.forEach(w => {
      if (CAT.STOP[w] || /^\d+$/.test(w) || w.length < 2 || (w.length === 2 && !alone && ws.length > 2)) return;
      put(CAT.fnv("w " + w), y, alone ? 2 : 1);
      if (w.length > 5) put(CAT.fnv("s " + w.slice(0, 5)), y, alone ? 2 : 1);
    });
  }));
  const keep = new Map();
  counts.forEach((c, h) => {
    const by = Object.keys(c).map(Number).sort((a, b) => c[b] - c[a]);
    if (by.length === 1 || c[by[0]] >= 2 * c[by[1]]) keep.set(h, by[0]);
  });
  const keys = [...keep.keys()].sort((a, b) => a - b);
  return { hashes: Uint32Array.from(keys), labels: Uint8Array.from(keys.map(h => keep.get(h))) };
}

// int8 embeddings with one scale, float32 for the small layers: the shipped file
function b64(typed) { return Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength).toString("base64"); }
function exportNet(net) {
  let maxAbs = 0; for (const x of net.E) maxAbs = Math.max(maxAbs, Math.abs(x));
  const scale = maxAbs / 127, q = new Int8Array(net.E.length);
  for (let i = 0; i < q.length; i++) q[i] = Math.max(-127, Math.min(127, Math.round(net.E[i] / scale)));
  const dir = {}; LABELS.forEach(l => { dir[l] = DIR[l]; });
  const known = knownWords(net.terms || TERMS);
  return { v: 1, B, D, H, labels: LABELS, dir, embScale: scale, emb: b64(q), W1: b64(net.W1), b1: b64(net.b1), W2: b64(net.W2), b2: b64(net.b2),
    known: b64(known.hashes), knownLabel: b64(known.labels),
    trained: { seed: SEED, epochs: EPOCHS, terms: TERMS.reduce((a, t) => a + t.length, 0) } };
}

function accuracy(model, data) {
  let ok = 0, top3 = 0;
  const per = LABELS.map(() => ({ n: 0, ok: 0 }));
  data.forEach(s => {
    const p = CAT.predict(model, s.x);
    per[s.y].n++;
    if (p[0] && p[0].label === LABELS[s.y]) { ok++; per[s.y].ok++; }
    if (p.slice(0, 3).some(q => q.label === LABELS[s.y])) top3++;
  });
  return { n: data.length, top1: ok / data.length, top3: top3 / data.length, per };
}
// The whole decision as the app makes it (CAT.suggest with the built-in categories, no history yet).
function pipeline(model, data) {
  const QL = require("../../src/logic.js");
  const cats = { expense: QL.DEFAULT_CATS.expense, income: QL.DEFAULT_CATS.income };
  let picked = 0, right = 0, inChips = 0;
  data.forEach(s => {
    const want = LABELS[s.y], dir = DIR[want];
    const g = CAT.suggest({ text: s.x, dir, cats, model });
    if (g.cat) { picked++; if (g.cat === want) right++; }
    if (g.cat === want || g.ranked.slice(0, 3).indexOf(want) >= 0) inChips++;
  });
  return { picked: picked / data.length, precision: picked ? right / picked : 0, inChips: inChips / data.length };
}
// how often the network's own confidence was right when it was confident (used to set the threshold)
function calibration(model, data, th) {
  let conf = 0, right = 0;
  data.forEach(s => { const p = CAT.predict(model, s.x); if (p[0] && p[0].p >= th) { conf++; if (p[0].label === LABELS[s.y]) right++; } });
  return { covered: conf / data.length, precision: conf ? right / conf : 0 };
}

// One honest check: 20 % of every category's words are hidden from a network, which is then tested on them
// (and, separately, on the words it saw, in new phrasings with typos).
function evalSplit(seed) {
  const r = rng(seed), trainTerms = [], heldTerms = [];
  TERMS.forEach(terms => {
    const t = terms.slice(); for (let i = t.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const x = t[i]; t[i] = t[j]; t[j] = x; }
    const cut = Math.max(1, Math.round(t.length * 0.2));
    heldTerms.push(t.slice(0, cut)); trainTerms.push(t.slice(cut));
  });
  const net = train(dataset(r, trainTerms, 30), r);
  net.terms = trainTerms;                      // its "known words" exclude the hidden ones
  const m = CAT.load(exportNet(net));
  const unseenData = dataset(r, heldTerms, 6), seenData = dataset(r, trainTerms, 4);
  return { unseen: accuracy(m, unseenData), seen: accuracy(m, seenData), pu: pipeline(m, unseenData), ps: pipeline(m, seenData), cal: calibration(m, unseenData, 0.8) };
}

function main() {
  const evalOnly = process.argv.includes("--eval");
  const t0 = Date.now();
  // the hidden 20 % differ from split to split, and so do the numbers: three splits, mean and range
  const splits = [1, 2, 3].map(k => evalSplit(SEED + k));
  const r = rng(SEED);
  const finalData = dataset(r, TERMS, 30);
  const net = train(finalData, r, evalOnly ? null : s => console.log("  " + s));
  const json = exportNet(net);
  const shipped = accuracy(CAT.load(json), dataset(r, TERMS, 4));
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  const pc = x => (100 * x).toFixed(1).replace(".", ",");
  const agg = f => { const v = splits.map(f), mean = v.reduce((a, b) => a + b, 0) / v.length; return pc(mean) + " % (" + pc(Math.min(...v)) + "–" + pc(Math.max(...v)) + ")"; };
  const lines = [
    "Незнакомые слова, сеть сама по себе: верная категория первой — " + agg(s => s.unseen.top1) + ", среди первых трёх — " + agg(s => s.unseen.top3) + ".",
    "Незнакомые слова, сеть сама по себе: уверена (p ≥ 0,8) в " + agg(s => s.cal.covered) + " фраз, но права из них лишь в " + agg(s => s.cal.precision) + ". Поэтому сама она не выбирает.",
    "Незнакомые слова, как решает приложение: выбирает само в " + agg(s => s.pu.picked) + " фраз и право в " + agg(s => s.pu.precision) + " из них; верная категория среди первых трёх кнопок в " + agg(s => s.pu.inChips) + ".",
    "Знакомые слова в новых фразах и с опечатками: сеть — первой " + agg(s => s.seen.top1) + "; приложение выбирает само в " + agg(s => s.ps.picked) + " и право в " + agg(s => s.ps.precision) + ".",
    "Поставляемая сеть на своих словах: верная категория первой — " + pc(shipped.top1) + " %."
  ];
  lines.forEach(l => console.log(l));
  console.log("trained in " + secs + " s; " + finalData.length + " training phrases; " + json.trained.terms + " seed words");
  if (evalOnly) return;
  const file = JSON.stringify(json);
  fs.writeFileSync(path.join(ROOT, "cat-model.json"), file);
  console.log("wrote cat-model.json: " + (file.length / 1024).toFixed(0) + " KB");
  const perCat = i => { const v = splits.map(s => s.unseen.per[i]).filter(p => p.n); return v.length ? pc(v.reduce((a, p) => a + p.ok / p.n, 0) / v.length) + " %" : "—"; };
  const perSeen = i => { const v = splits.map(s => s.seen.per[i]).filter(p => p.n); return v.length ? pc(v.reduce((a, p) => a + p.ok / p.n, 0) / v.length) + " %" : "—"; };
  const per = LABELS.map((l, i) => "| " + l + " | " + TERMS[i].length + " | " + perCat(i) + " | " + perSeen(i) + " |").join("\n");
  const report = "# Сеть категорий: отчёт обучения\n\n" +
    "Сгенерировано `node tools/ml/train.js`, руками не править. Данные — только словарь `tools/ml/lexicon.js` (" + json.trained.terms + " слов и названий) " +
    "и фразы из него с шумом. Реальных записей в обучении нет, поэтому цифры ниже — проверка на сгенерированных фразах, " +
    "а не точность на ваших данных.\n\n" +
    "- Сеть: хэшированные слова, начала слов и символьные 3- и 4-граммы → " + B + " ячеек × " + D + " → скрытый слой " + H + " (ReLU) → " + LABELS.length + " категорий; вложения в int8.\n" +
    "- Файл модели: " + (file.length / 1024).toFixed(0) + " КБ (`cat-model.json`), обучение и проверка " + secs + " с, зерно " + SEED + ".\n" +
    "- «Как решает приложение» — вся цепочка `CAT.suggest` со встроенными категориями и без истории: сама она выбирает категорию, только если во фразе есть слово, которому сеть училась именно для этой категории, или название категории.\n\n" +
    "## Результаты\n\nСреднее по трём разбиениям, в скобках — разброс.\n\n" + lines.map(l => "- " + l).join("\n") + "\n\n" +
    "## По категориям\n\n| Категория | слов в словаре | незнакомые слова, первой | знакомые слова в новых фразах, первой |\n|---|---|---|---|\n" + per + "\n";
  fs.writeFileSync(path.join(ROOT, "docs", "ML-REPORT.md"), report);
  console.log("wrote docs/ML-REPORT.md");
}

if (require.main === module) main();
module.exports = { LABELS, TERMS, B, D, H, rng, dataset, train, forward, exportNet, accuracy };
