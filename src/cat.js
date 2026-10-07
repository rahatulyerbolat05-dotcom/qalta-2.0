// Қalta — category for a description ("кофе", "Магнум", "такси домой", "зп").
// Pure functions, no DOM: the same file runs in the app, in a chat bot and in tests (tests/cat.test.js).
//
// Three sources, strongest first:
//   1. the person's own history: the same description was filed under a category before;
//   2. the name of one of the person's categories is in the description ("продуктов" -> "Продукты");
//   3. a small neural network trained on Kazakhstani shops and everyday words (cat-model.json, built by
//      tools/ml/train.js): hashed word and character n-grams -> embedding bag -> hidden layer -> softmax
//      over the built-in categories. It knows nothing about a person's own categories; sources 1 and 2 do.
// The answer is a ranking plus a pick only when the evidence is clear; otherwise the person chooses.
"use strict";

// ───────────────────────────── features ─────────────────────────────

function norm(s) {
  return String(s == null ? "" : s).toLowerCase().replace(/ё/g, "е").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
function words(s) { var n = norm(s); return n ? n.split(" ").slice(0, 16) : []; }

function fnv(str) {
  var h = 0x811c9dc5;
  for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

// Word, word-start ("stem") and character 3- and 4-gram features, hashed into B buckets. Russian and Kazakh
// change word endings a lot ("аптека", "в аптеке", "аптекадан"): starts and n-grams survive that.
function features(text, B) {
  var w = words(text), out = [], seen = Object.create(null);
  function add(f) { if (!seen[f]) { seen[f] = 1; out.push(fnv(f) % B); } }
  for (var i = 0; i < w.length; i++) {
    var t = w[i];
    add("w " + t);
    if (t.length > 4) add("s " + t.slice(0, 4));
    if (t.length > 5) add("s " + t.slice(0, 5));
    var p = "<" + t + ">";
    for (var n = 3; n <= 4; n++) for (var k = 0; k + n <= p.length; k++) add("c" + n + " " + p.slice(k, k + n));
    if (i > 0) add("b " + w[i - 1] + " " + t);
  }
  return out;
}

// ───────────────────────────── network ─────────────────────────────

function bytesOf(b64) {
  var bin = typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
  var u = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
function floatsOf(b64) {
  var u = bytesOf(b64), v = new DataView(u.buffer), out = new Float32Array(u.length / 4);
  for (var i = 0; i < out.length; i++) out[i] = v.getFloat32(i * 4, true);
  return out;
}
function uintsOf(b64) {
  var u = bytesOf(b64), v = new DataView(u.buffer), out = new Uint32Array(u.length / 4);
  for (var i = 0; i < out.length; i++) out[i] = v.getUint32(i * 4, true);
  return out;
}

// Words that carry no meaning of their own; they never count as "a word the network knows".
var STOP = Object.create(null);
["для", "на", "за", "по", "из", "от", "до", "при", "про", "под", "над", "без", "или", "это", "мне", "себе", "the", "and", "for", "мен", "үшін"].forEach(function (w) { STOP[w] = 1; });

// Does the description contain a word the network was taught for this label (or a longer word with a taught
// start)? Words taught for several labels are not in the list.
function knows(m, text, label) {
  if (!m.known || !m.known.length) return false;
  var want = m.labels.indexOf(label), w = words(text);
  if (want < 0) return false;
  for (var i = 0; i < w.length; i++) {
    var t = w[i];
    if (t.length < 2 || STOP[t]) continue;
    if (labelOf(m, fnv("w " + t)) === want || (t.length > 5 && labelOf(m, fnv("s " + t.slice(0, 5))) === want)) return true;
  }
  return false;
}
// a word the network was taught for some category
function taught(m, w) {
  if (!m.known || w.length < 2 || STOP[w]) return false;
  return labelOf(m, fnv("w " + w)) >= 0 || (w.length > 5 && labelOf(m, fnv("s " + w.slice(0, 5))) >= 0);
}
function labelOf(m, h) {
  var a = m.known, lo = 0, hi = a.length - 1;
  while (lo <= hi) { var mid = (lo + hi) >> 1, v = a[mid]; if (v === h) return m.knownLabel[mid]; if (v < h) lo = mid + 1; else hi = mid - 1; }
  return -1;
}

// cat-model.json -> a model ready for predict(); throws on a file that does not fit together.
function load(json) {
  var j = typeof json === "string" ? JSON.parse(json) : json;
  if (!j || j.v !== 1 || !Array.isArray(j.labels)) throw new Error("not a Qalta category model");
  var m = { B: j.B, D: j.D, H: j.H, K: j.labels.length, labels: j.labels, scale: j.embScale, dir: j.dir || {},
    emb: new Int8Array(bytesOf(j.emb).buffer), W1: floatsOf(j.W1), b1: floatsOf(j.b1), W2: floatsOf(j.W2), b2: floatsOf(j.b2),
    known: j.known ? uintsOf(j.known) : null, knownLabel: j.knownLabel ? bytesOf(j.knownLabel) : null };
  if (m.known && (!m.knownLabel || m.knownLabel.length !== m.known.length)) throw new Error("category model has the wrong shape");
  if (m.emb.length !== m.B * m.D || m.W1.length !== m.D * m.H || m.W2.length !== m.H * m.K || m.b1.length !== m.H || m.b2.length !== m.K) throw new Error("category model has the wrong shape");
  return m;
}

// Probabilities over the model's labels, best first. Empty text (or no features) -> [].
function predict(m, text) {
  var f = features(text, m.B);
  if (!f.length) return [];
  var D = m.D, H = m.H, K = m.K, e = new Float32Array(D), i, j, k;
  for (i = 0; i < f.length; i++) { var row = f[i] * D; for (j = 0; j < D; j++) e[j] += m.emb[row + j]; }
  var s = m.scale / f.length;
  for (j = 0; j < D; j++) e[j] *= s;
  var h = new Float32Array(H);
  for (k = 0; k < H; k++) { var a = m.b1[k]; for (j = 0; j < D; j++) a += m.W1[j * H + k] * e[j]; h[k] = a > 0 ? a : 0; }
  var z = new Float32Array(K), max = -Infinity;
  for (k = 0; k < K; k++) { var b = m.b2[k]; for (j = 0; j < H; j++) b += m.W2[j * K + k] * h[j]; z[k] = b; if (b > max) max = b; }
  var sum = 0;
  for (k = 0; k < K; k++) { z[k] = Math.exp(z[k] - max); sum += z[k]; }
  var out = [];
  for (k = 0; k < K; k++) out.push({ label: m.labels[k], p: z[k] / sum });
  return out.sort(function (a, b) { return b.p - a.p; });
}

// ───────────────────────────── the person's own history ─────────────────────────────

// Index of past operations: whole descriptions and single words -> how often each category was used.
// Build it once per list of operations (it does not change while a sheet is open).
function memory(ops) {
  var notes = Object.create(null), toks = Object.create(null);
  function bump(map, key, cat) { var m = map[key] || (map[key] = Object.create(null)); m[cat] = (m[cat] || 0) + 1; }
  (ops || []).slice(0, 20000).forEach(function (o) {
    if (!o || typeof o.cat !== "string" || !o.note) return;
    var n = norm(o.note);
    if (!n || n.length > 80) return;
    var side = o.sum > 0 ? "income" : "expense";
    bump(notes, side + "|" + n, o.cat);
    words(n).forEach(function (t) { if (t.length >= 3 && !/^\d+$/.test(t)) bump(toks, side + "|" + t, o.cat); });
  });
  return { notes: notes, toks: toks };
}

// a word of the description names the category: the same word, or (for names of 4+ letters) the same start
// of at least 4 letters ("аптеке" ~ "Аптека", "продуктов" ~ "Продукты"); short names must match exactly
function namesCategory(descWords, cat) {
  var cw = words(cat);
  for (var i = 0; i < descWords.length; i++) for (var j = 0; j < cw.length; j++) {
    var a = descWords[i], b = cw[j];
    if (a === b) return true;
    if (b.length >= 4 && a.length >= 4) {
      var n = 0; while (n < a.length && n < b.length && a[n] === b[n]) n++;
      if (n >= Math.min(b.length, Math.max(4, b.length - 2))) return true;
    }
  }
  return false;
}

function share(counts) {
  var total = 0, best = null, k;
  for (k in counts) { total += counts[k]; if (!best || counts[k] > counts[best]) best = k; }
  return { total: total, best: best, p: best ? counts[best] / total : 0 };
}

// suggest({ text, dir, cats: { expense: [...], income: [...] }, model, mem })
//   -> { cat, dir, why, ranked }
//   cat     a category of the person's own list, or null when unsure
//   dir     the side the category belongs to ("income" for "зарплата" typed into an expense sheet)
//   why     "history" | "name" | "model" | ""
//   ranked  up to 5 categories of the given side, best first (for the chips under the amount)
function suggest(o) {
  var dir = o.dir === "income" ? "income" : "expense", other = dir === "income" ? "expense" : "income";
  var cats = o.cats || {}, lists = { expense: cats.expense || [], income: cats.income || [] };
  var dw = words(o.text), n = dw.join(" ");
  var res = { cat: null, dir: dir, why: "", ranked: [] };
  if (!n) return res;
  var has = function (side, c) { return lists[side].indexOf(c) >= 0; };
  var score = { expense: Object.create(null), income: Object.create(null) };
  var add = function (side, c, v) { if (has(side, c)) score[side][c] = (score[side][c] || 0) + v; };

  // 1. the same description before
  var mem = o.mem;
  if (mem) {
    for (var s = 0; s < 2; s++) {
      var side = s ? other : dir, hit = mem.notes[side + "|" + n];
      if (hit) {
        var sh = share(hit);
        if (has(side, sh.best) && sh.p >= 0.6 && (side === dir || sh.total >= 2)) return finish(res, side, sh.best, "history", score, lists, o, dw);
        for (var c0 in hit) add(side, c0, 2 * hit[c0] / sh.total);
      }
    }
  }
  // 2. a category's name in the description (the person's own categories too)
  for (var t = 0; t < 2; t++) {
    var sd = t ? other : dir;
    // o.alias(c): the category's name in the other languages ("Дәріхана" for "Аптека")
    var named = lists[sd].filter(function (c) { return namesCategory(dw, c) || (o.alias ? (o.alias(c) || []).some(function (a) { return namesCategory(dw, a); }) : false); });
    if (named.length === 1) return finish(res, sd, named[0], "name", score, lists, o, dw);
    named.forEach(function (c) { add(sd, c, 0.5); });
  }
  // 3. single words seen before, and the network
  // A word only this person uses ("Алихана", a shop nobody else knows) says more about their filing than an
  // everyday word the network knows ("кофе" once filed under Развлечения does not make every coffee fun).
  if (mem) dw.forEach(function (w) {
    var weight = o.model && taught(o.model, w) ? 0.4 : 1.2;
    [dir, other].forEach(function (sd) {
      var hit = mem.toks[sd + "|" + w];
      if (hit) { var sh = share(hit); for (var c in hit) add(sd, c, weight * hit[c] / sh.total); }
    });
  });
  var probs = o.model ? predict(o.model, n) : [];
  probs.forEach(function (q) {
    var side = (o.model.dir && o.model.dir[q.label]) || "expense";
    add(side, q.label, q.p);
    // one network label covers a category that exists on both sides under different names
    if (side === "expense" && q.label === "Подарки") add("income", "Подарок", q.p);
  });
  var best = rank(score, dir).concat(rank(score, other)).sort(function (a, b) { return b.v - a.v; });
  // A pick needs a word behind it: one the network was taught for that very category, or one this person
  // filed under it before. Otherwise the network only orders the chips.
  var grounded = function (x) {
    if (mem && dw.some(function (w) { var h = mem.toks[x.side + "|" + w]; return h && h[x.c]; })) return true;
    var label = x.side === "income" && x.c === "Подарок" ? "Подарки" : x.c;
    return !!o.model && knows(o.model, n, label);
  };
  if (best.length && grounded(best[0])) {
    var top = best[0], second = best[1] ? best[1].v : 0;
    var clear = top.v >= 0.55 && top.v - second >= 0.25;
    // the other side wins only when it is clearly meant ("зарплата" in an expense sheet)
    if (clear && (top.side === dir || top.v >= 0.8)) return finish(res, top.side, top.c, "model", score, lists, o, dw);
  }
  res.ranked = rank(score, dir).slice(0, 5).map(function (x) { return x.c; });
  return res;
}
function rank(score, side) {
  return Object.keys(score[side]).map(function (c) { return { c: c, v: score[side][c], side: side }; }).sort(function (a, b) { return b.v - a.v; });
}
function finish(res, side, cat, why, score, lists, o, dw) {
  res.cat = cat; res.dir = side; res.why = why;
  var r = rank(score, side).map(function (x) { return x.c; }).filter(function (c) { return c !== cat; });
  res.ranked = [cat].concat(r).slice(0, 5);
  return res;
}

module.exports = { norm: norm, words: words, features: features, load: load, predict: predict, knows: knows, STOP: STOP, memory: memory, namesCategory: namesCategory, suggest: suggest, fnv: fnv };
