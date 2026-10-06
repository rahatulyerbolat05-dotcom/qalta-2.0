/*
 * Қalta sync engine — local-first, multi-device, offline-capable.
 *
 * Model
 *   users/{uid}/ops/{id}      one document per operation
 *   users/{uid}/debts/{id}    one document per debt (open and closed; `closed` flag)
 *   users/{uid}/meta/settings language, accent, skin, categories, colours
 *
 * Every document carries `_u` (monotonic update stamp) and `_d` (device id).
 * Deleting writes a tombstone ({_del:true,_u,_d}) so an offline device cannot
 * resurrect a deleted record. Conflicts are resolved per document: the later
 * stamp wins, except
 *   - a local edit that is not pushed yet is never overwritten by a remote
 *     write (the local edit is pushed with a newer stamp);
 *   - debts are merged 3-way (base / local / remote): repayments from several
 *     devices are summed and their logs are unioned, so none is lost.
 *
 * The engine is DOM-free. The host injects the Firestore handle (compat API),
 * a storage object, and callbacks, which keeps it testable in plain Node.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.QaltaSync = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var SETTINGS_KEYS = ["hex", "skin", "set", "lang", "eCats", "iCats", "catColors", "catSizes", "catIcons", "budget", "openCash", "openCard", "openCashAt", "openCardAt"];
  var MAX_AMOUNT = 999999999;
  var DAY = 86400000;
  var KINDS = ["ops", "debts", "meta"];
  var BATCH = 400;

  function fin(v) { return typeof v === "number" && isFinite(v); }
  function str(v, n) { return typeof v === "string" ? v.slice(0, n) : ""; }
  function noop() {}

  // Canonical JSON (sorted keys) so hashes survive Firestore reordering map keys.
  function canon(v) {
    if (v === null || typeof v !== "object") return JSON.stringify(v === undefined ? null : v);
    if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
    return "{" + Object.keys(v).sort().filter(function (k) { return v[k] !== undefined; })
      .map(function (k) { return JSON.stringify(k) + ":" + canon(v[k]); }).join(",") + "}";
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function safeKey(k) { return k !== "__proto__" && k !== "constructor" && k !== "prototype"; }

  // ---------- validation of anything that comes from the cloud ----------
  function cleanOp(d) {
    if (!d || typeof d !== "object" || !fin(d.id) || !fin(d.sum) || Math.abs(d.sum) > MAX_AMOUNT) return null;
    if (!/^\d{1,2}\.\d{1,2}$/.test(String(d.date || ""))) return null;
    var o = { id: d.id, date: String(d.date), cat: str(d.cat, 60) || "Прочее", note: str(d.note, 200), sum: Math.round(d.sum), pay: d.pay === "cash" ? "cash" : "card" };
    if (fin(d.ts) && d.ts > 0 && d.ts < 8.64e15) o.ts = Math.round(d.ts);   // v2: the moment of the operation
    return o;
  }
  function cleanLog(list) {
    return (Array.isArray(list) ? list : []).slice(0, 500).filter(function (p) { return p && fin(p.sum) && Math.abs(p.sum) <= MAX_AMOUNT; }).map(function (p) {
      var e = { sum: Math.round(p.sum), date: str(p.date, 10) };
      if (typeof p.id === "string" && p.id) e.id = p.id.slice(0, 40);
      if (fin(p.ts) && p.ts > 0) e.ts = Math.round(p.ts);
      return e;
    });
  }
  function cleanDebt(d) {
    if (!d || typeof d !== "object" || !fin(d.id) || !fin(d.sum) || d.sum < 0 || d.sum > MAX_AMOUNT) return null;
    var sum = Math.round(d.sum);
    var o = {
      id: d.id, who: str(d.who, 60) || "—", note: str(d.note, 200), sum: sum, mine: !!d.mine,
      paid: fin(d.paid) ? Math.min(sum, Math.max(0, Math.round(d.paid))) : 0,
      log: cleanLog(d.log), closed: !!d.closed
    };
    if (typeof d.closedAt === "string") o.closedAt = str(d.closedAt, 10);
    if (typeof d.reason === "string") o.reason = str(d.reason, 120);
    if (typeof d.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d.due)) o.due = d.due;   // v2: optional due date
    if (fin(d.ts) && d.ts > 0) o.ts = Math.round(d.ts);
    return o;
  }
  function cleanSettings(d) {
    if (!d || typeof d !== "object") return null;
    var o = {};
    if (typeof d.hex === "string" && /^#[0-9a-f]{6}$/i.test(d.hex)) o.hex = d.hex;
    if (Number.isInteger(d.skin) && d.skin >= 0 && d.skin <= 2) o.skin = d.skin;
    if (Number.isInteger(d.set) && d.set >= 0 && d.set <= 4) o.set = d.set;
    if (d.lang === "ru" || d.lang === "kz" || d.lang === "en") o.lang = d.lang;
    ["eCats", "iCats"].forEach(function (k) {
      if (Array.isArray(d[k])) o[k] = d[k].filter(function (x) { return typeof x === "string" && x.trim() && x.length <= 60; }).slice(0, 200);
    });
    if (d.catColors && typeof d.catColors === "object" && !Array.isArray(d.catColors)) {
      o.catColors = {};
      Object.keys(d.catColors).slice(0, 300).forEach(function (k) {
        var v = d.catColors[k];
        if (safeKey(k) && typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v)) o.catColors[k] = v;
      });
    }
    if (d.catIcons && typeof d.catIcons === "object" && !Array.isArray(d.catIcons)) {
      o.catIcons = {};
      Object.keys(d.catIcons).slice(0, 300).forEach(function (k) {
        var v = d.catIcons[k];
        if (safeKey(k) && typeof v === "string" && /^[a-z0-9-]{1,40}$/.test(v)) o.catIcons[k] = v;
      });
    }
    if (fin(d.budget) && d.budget > 0) o.budget = Math.min(MAX_AMOUNT, Math.round(d.budget));
    ["openCash", "openCard"].forEach(function (k) {
      if (fin(d[k])) o[k] = Math.max(-MAX_AMOUNT * 100, Math.min(MAX_AMOUNT * 100, Math.round(d[k])));
    });
    // the moment a balance was typed in: only operations from then on move it
    ["openCashAt", "openCardAt"].forEach(function (k) {
      if (fin(d[k]) && d[k] > 0 && d[k] < 8.64e15) o[k] = Math.round(d[k]);
    });
    if (d.catSizes && typeof d.catSizes === "object" && !Array.isArray(d.catSizes)) {
      o.catSizes = {};
      Object.keys(d.catSizes).slice(0, 300).forEach(function (k) {
        var v = d.catSizes[k];
        if (safeKey(k) && (v === "full" || v === "large" || v === "normal")) o.catSizes[k] = v;
      });
    }
    return o;
  }
  function clean(kind, d) {
    return kind === "ops" ? cleanOp(d) : kind === "debts" ? cleanDebt(d) : kind === "meta" ? cleanSettings(d) : null;
  }

  // ---------- state <-> entities ----------
  function debtData(d, closed) {
    var o = cleanDebt(Object.assign({}, d, { closed: closed }));
    return o;
  }
  function toEntities(st) {
    var m = {};
    (st.ops || []).forEach(function (o) { var c = cleanOp(o); if (c) m["ops/" + c.id] = c; });
    (st.debts || []).forEach(function (d) { var c = debtData(d, false); if (c) m["debts/" + c.id] = c; });
    (st.closed || []).forEach(function (d) { var c = debtData(d, true); if (c) m["debts/" + c.id] = c; });
    var s = {};
    SETTINGS_KEYS.forEach(function (k) { if (st[k] !== undefined) s[k] = st[k]; });
    m["meta/settings"] = cleanSettings(s) || {};
    return m;
  }

  // ---------- debt 3-way merge ----------
  function logKeys(list) {
    var seen = {};
    return (list || []).map(function (e) {
      var base = e.id ? "id:" + e.id : "dt:" + e.date + "|" + e.sum;
      seen[base] = (seen[base] || 0) + 1;
      return { key: e.id ? base : base + "#" + seen[base], e: e };
    });
  }
  function mergeDebt(base, local, remote) {
    var out = {};
    ["who", "note", "mine"].forEach(function (k) { out[k] = local[k] !== base[k] ? local[k] : remote[k]; });
    var due = local.due !== base.due ? local.due : remote.due;
    if (due !== undefined) out.due = due;
    var dts = local.ts !== base.ts ? local.ts : remote.ts;
    if (dts !== undefined) out.ts = dts;
    out.id = local.id;
    out.sum = local.sum !== base.sum ? local.sum : remote.sum;
    var paid = (base.paid || 0) + ((local.paid || 0) - (base.paid || 0)) + ((remote.paid || 0) - (base.paid || 0));
    out.paid = Math.max(0, Math.min(out.sum, paid));
    var seen = {}, log = [];
    logKeys(remote.log).concat(logKeys(local.log)).forEach(function (x) {
      if (!seen[x.key]) { seen[x.key] = 1; log.push(x.e); }
    });
    out.log = log;
    out.closed = !!(local.closed || remote.closed);
    var src = local.closed ? local : remote.closed ? remote : null;
    if (src && src.closedAt !== undefined) out.closedAt = src.closedAt;
    if (src && src.reason !== undefined) out.reason = src.reason;
    return out;
  }

  // Field-level patch for a debt: counters and the repayment log are written as
  // server-side transforms so concurrent repayments from several devices add up.
  function debtPatch(base, cur, fv) {
    var p = {}, changed = false;
    ["who", "note", "sum", "mine", "closed"].forEach(function (k) {
      if (cur[k] !== base[k]) { p[k] = cur[k]; changed = true; }
    });
    ["closedAt", "reason", "due", "ts"].forEach(function (k) {
      if (cur[k] !== base[k]) { p[k] = cur[k] === undefined ? fv.delete() : cur[k]; changed = true; }
    });
    var have = {}, now = {};
    logKeys(base.log).forEach(function (x) { have[x.key] = 1; });
    logKeys(cur.log).forEach(function (x) { now[x.key] = 1; });
    var removed = logKeys(base.log).some(function (x) { return !now[x.key]; });
    if (removed) {
      // increment / arrayUnion cannot take a repayment back (undo, deleting a log row, reopening a debt):
      // replace both fields so every device ends up with the same log.
      p.paid = cur.paid || 0; p.log = cur.log || []; changed = true;
    } else {
      var dp = (cur.paid || 0) - (base.paid || 0);
      if (dp) { p.paid = fv.increment(dp); changed = true; }
      var add = logKeys(cur.log).filter(function (x) { return !have[x.key]; }).map(function (x) { return x.e; });
      if (add.length) { p.log = fv.arrayUnion.apply(null, add); changed = true; }
    }
    return changed ? p : null;
  }

  // ---------- applying remote changes to app state (pure) ----------
  function reduce(state, changes, opts) {
    var reset = !!(opts && opts.reset);
    var ops = reset ? [] : (state.ops || []).slice();
    var debts = reset ? [] : (state.debts || []).slice();
    var closed = reset ? [] : (state.closed || []).slice();
    var newOps = [], newDebts = [], newClosed = [], settings = null;
    var idx = function (arr, id) { for (var i = 0; i < arr.length; i++) if (String(arr[i].id) === id) return i; return -1; };

    changes.forEach(function (ch) {
      var p = ch.key.split("/"), kind = p[0], id = p[1];
      if (kind === "ops") {
        var i = idx(ops, id);
        if (ch.del) { if (i >= 0) ops.splice(i, 1); }
        else if (i >= 0) ops[i] = ch.data; else newOps.push(ch.data);
      } else if (kind === "debts") {
        var di = idx(debts, id), ci = idx(closed, id);
        var was = di >= 0 ? "d" : ci >= 0 ? "c" : null;
        if (di >= 0) debts.splice(di, 1);
        if (ci >= 0) closed.splice(ci, 1);
        if (!ch.del) {
          var d = Object.assign({}, ch.data); var isClosed = d.closed; delete d.closed;
          if (isClosed) { if (was === "c") closed.splice(Math.min(ci, closed.length), 0, d); else newClosed.push(d); }
          else { if (was === "d") debts.splice(Math.min(di, debts.length), 0, d); else newDebts.push(d); }
        }
      } else if (kind === "meta" && id === "settings" && !ch.del) {
        settings = ch.data;
      }
    });
    var byIdDesc = function (a, b) { return b.id - a.id; };
    var out = {
      ops: newOps.sort(byIdDesc).concat(ops),
      debts: newDebts.sort(byIdDesc).concat(debts),
      closed: newClosed.sort(byIdDesc).concat(closed)
    };
    if (settings) SETTINGS_KEYS.forEach(function (k) { out[k] = settings[k]; });
    return out;
  }

  // ---------- engine ----------
  function memoryStorage() {
    var m = {};
    return { getItem: function (k) { return k in m ? m[k] : null; }, setItem: function (k, v) { m[k] = String(v); }, removeItem: function (k) { delete m[k]; } };
  }

  function Engine(o) {
    this.db = o.db; this.uid = o.uid; this.dev = String(o.deviceId);
    this.storage = o.storage || memoryStorage();
    this.now = o.now || Date.now;
    this.getState = o.getState;
    this.onApply = o.onApply || noop;
    this.onStatus = o.onStatus || noop;
    this.fv = o.fieldValue || null;   // { increment, arrayUnion, delete } from firebase.firestore.FieldValue
    this.isSeed = o.isSeed || function () { return false; };
    this.isOnline = o.isOnline || function () { return typeof navigator === "undefined" ? true : navigator.onLine !== false; };
    // Wrapped: in browsers a bare setTimeout throws "Illegal invocation" when called as a method of another object.
    this.setTimer = o.setTimer || function (fn, ms) { return setTimeout(fn, ms); };
    this.clearTimer = o.clearTimer || function (t) { clearTimeout(t); };
    this.root = "users/" + this.uid;
    this.skey = "qalta-sync-v2:" + this.uid;
    this.pending = 0; this.pushErr = false; this.pushFails = 0; this.errs = {};
    this.unsubs = []; this.relisten = []; this.init = {}; this.timer = null; this.stopped = false;
    this.gen = this.genOf();
    this.load();
  }
  var P = Engine.prototype;

  // Identity of the local copy of the data (kept inside the app's own storage blob). The shadow below
  // describes one particular copy; if that copy is lost or replaced, the shadow must not be trusted.
  P.genOf = function () {
    var st = this.getState ? this.getState() : null;
    return st && typeof st.gen === "string" ? st.gen : undefined;
  };
  P.load = function () {
    var raw = null;
    try { raw = this.storage.getItem(this.skey); } catch (e) {}
    var s = null;
    try { s = raw ? JSON.parse(raw) : null; } catch (e) { s = null; }
    if (s && s.v === 1 && s.e && typeof s.e === "object" && s.g === this.gen) {
      this.e = s.e; this.lastU = fin(s.lastU) ? Math.min(s.lastU, this.now() + DAY) : 0; this.synced = !!s.synced;
    } else { this.e = {}; this.lastU = 0; this.synced = false; }
  };
  P.save = function () {
    try { this.storage.setItem(this.skey, JSON.stringify({ v: 1, g: this.gen, lastU: this.lastU, synced: this.synced, e: this.e })); }
    catch (e) { if (typeof console !== "undefined") console.error("[qalta-sync] cannot persist sync state", e); }
  };
  P.nextU = function () { this.lastU = Math.max(this.now(), this.lastU + 1); return this.lastU; };
  // A stamp from the cloud is trusted only up to a day ahead of this clock: one absurd value must not
  // pin every later stamp (and every conflict) to itself.
  P.stamp = function (u) { return fin(u) && u > 0 ? Math.min(u, this.now() + DAY) : null; };

  // If the local copy was replaced (storage lost or unreadable and recreated, data adopted from another
  // tab), every shadow entry missing locally would read as "deleted" and the first push would erase the
  // cloud. Start over as a new device instead: the cloud is merged back in, nothing is deleted.
  P.checkGen = function () {
    var g = this.genOf();
    if (g === this.gen) return false;
    this.gen = g;
    this.detach();
    this.e = {}; this.synced = false; this.init = {}; this.pushFails = 0;
    this.save();
    this.start();
    return true;
  };

  P.start = function () {
    this.stopped = false;
    KINDS.forEach(function (kind) { this.listen(kind, 0); }, this);
    this.status();
    // Edits made while the engine was not running (offline start, tab closed inside the push delay).
    if (this.synced) this.pushSoon(1500);
  };
  P.listen = function (kind, attempt) {
    var self = this;
    // includeMetadataChanges: an empty collection must still tell us when the
    // snapshot stops being cache-only (otherwise a fresh device would wait forever).
    var unsub = this.db.collection(this.root + "/" + kind).onSnapshot({ includeMetadataChanges: true }, function (snap) {
      if (self.stopped) return;
      attempt = 0;
      self.onSnap(kind, snap);
    }, function (err) {
      if (self.stopped) return;
      self.fail(err, kind);
      // a failed listener is dead for good: subscribe again later
      var wait = Math.min(60000, 3000 * Math.pow(2, attempt));
      self.relisten.push(self.setTimer(function () { if (!self.stopped) self.listen(kind, attempt + 1); }, wait));
    });
    this.unsubs.push(unsub);
  };
  P.detach = function () {
    var self = this;
    this.unsubs.forEach(function (u) { try { u(); } catch (e) {} });
    this.unsubs = [];
    this.relisten.forEach(function (t) { self.clearTimer(t); });
    this.relisten = [];
    this.clearTimer(this.timer); this.timer = null;
  };
  P.stop = function () { this.stopped = true; this.detach(); };
  // Best effort when the page is going away: send what is waiting instead of waiting for the delay.
  P.flush = function () {
    if (this.stopped || !this.synced) return;
    this.clearTimer(this.timer); this.timer = null;
    this.push();
  };
  P.fail = function (err, kind) {
    if (typeof console !== "undefined") console.error("[qalta-sync]", err);
    if (kind) this.errs[kind] = true; else this.pushErr = true;
    this.status();
  };

  P.status = function () {
    var failing = this.pushErr || Object.keys(this.errs).length > 0;
    var st = failing ? "error" : !this.isOnline() ? "offline" : !this.synced ? "loading" : this.pending > 0 ? "saving" : "synced";
    if (st !== this._lastStatus) { this._lastStatus = st; this.onStatus(st); }
  };

  P.docsOf = function (snap) {
    var out = [];
    snap.docChanges().forEach(function (ch) {
      if (ch.type === "removed") return;
      out.push({ id: ch.doc.id, data: ch.doc.data(), pending: !!(ch.doc.metadata && ch.doc.metadata.hasPendingWrites) });
    });
    return out;
  };

  P.onSnap = function (kind, snap) {
    if (this.checkGen()) return;
    delete this.errs[kind];                 // this listener works; others may not
    var docs = this.docsOf(snap);
    if (!this.synced) {
      // A device that never synced this account needs the full server state
      // before it may decide what to keep, so cached/partial snapshots are ignored.
      if (snap.metadata && snap.metadata.fromCache) { this.status(); return; }
      this.init[kind] = (snap.docs || []).map(function (d) { return { id: d.id, data: d.data() }; });
      if (KINDS.every(function (k) { return this.init[k]; }, this)) this.reconcileFresh();
      return;
    }
    this.applyDocs(kind, docs);
    this.status();
  };

  P.localEntity = function (key, ents) { return ents[key]; };
  P.dirty = function (local, s) {
    if (!s) return !!local;
    if (s.del) return !!local;
    return !local || canon(local) !== s.h;
  };

  P.applyDocs = function (kind, docs) {
    var self = this, ents = toEntities(this.getState()), changes = [], repush = false;
    docs.forEach(function (d) {
      if (d.pending || !d.data) return;
      var ru = self.stamp(d.data._u);
      if (ru === null) return;
      var key = kind + "/" + d.id, r = d.data, s = self.e[key];
      self.lastU = Math.max(self.lastU, ru);
      var c = r._del ? null : clean(kind, r);
      if (!r._del && !c) return;
      var rh = r._del ? "" : canon(c);
      var local = ents[key];

      if (kind === "debts") {
        // Debts are patched field-by-field on the server (increment / arrayUnion),
        // so the document's stamp is not an ordering signal: compare content.
        if (s && !s.del && s.h === rh) return;
        if (!self.dirty(local, s)) {
          changes.push({ key: key, del: !!r._del, data: c });
          self.e[key] = { h: rh, u: ru, d: String(r._d), del: !!r._del, b: c || undefined };
        } else if (local && !r._del && s && !s.del && s.b) {
          changes.push({ key: key, del: false, data: mergeDebt(s.b, local, c) });
          self.e[key] = { h: rh, u: ru, d: String(r._d), b: c };
        }
        return;
      }

      if (s && (ru < s.u || (ru === s.u && !(String(r._d) > String(s.d))))) {
        // The server holds an older write than the one we already made (arrival
        // order beat stamp order): re-assert ours so every device converges.
        if (String(r._d) !== self.dev) {
          var differs = r._del ? !s.del : (s.del || canon(c) !== s.h);
          if (differs) { self.e[key] = Object.assign({}, s, { h: "#stale", del: false }); repush = true; }
        }
        return;
      }
      if (!self.dirty(local, s)) {
        changes.push({ key: key, del: !!r._del, data: c });
        self.e[key] = { h: rh, u: ru, d: String(r._d), del: !!r._del };
      }
      // otherwise an unpushed local edit wins and is pushed with a newer stamp
    });
    if (changes.length || repush) this.save();
    if (changes.length) this.onApply(changes, {});
    if (repush) this.pushSoon();
  };

  P.reconcileFresh = function () {
    var self = this, remote = {}, count = 0;
    KINDS.forEach(function (kind) {
      self.init[kind].forEach(function (d) {
        if (!d.data) return;
        var u = self.stamp(d.data._u);
        if (u === null) return;
        remote[kind + "/" + d.id] = d.data; count++;
        self.lastU = Math.max(self.lastU, u);
      });
    });
    var seed = this.isSeed(), changes = [], reset = false;
    if (count === 0) {
      if (seed) reset = true;               // brand-new account on an untouched device: start empty
    } else {
      reset = seed;                          // existing account: demo data is dropped, cloud wins
    }
    Object.keys(remote).forEach(function (key) {
      var kind = key.split("/")[0], r = remote[key];
      var c = r._del ? null : clean(kind, r);
      if (!r._del && !c) return;
      self.e[key] = { h: r._del ? "" : canon(c), u: self.stamp(r._u), d: String(r._d), del: !!r._del, b: kind === "debts" ? c : undefined };
      changes.push({ key: key, del: !!r._del, data: c });
    });
    this.synced = true;
    this.init = {};
    this.save();
    if (reset || changes.length) this.onApply(changes, { reset: reset });
    this.status();
    this.pushSoon(0);
  };

  P.pushSoon = function (ms) {
    var self = this;
    this.clearTimer(this.timer);
    this.timer = this.setTimer(function () { self.push(); }, ms === undefined ? 700 : ms);
  };

  P.push = function () {
    if (this.stopped || this.checkGen() || !this.synced) return;
    var cur = toEntities(this.getState()), writes = [], key;
    for (key in cur) {
      var h = canon(cur[key]), s = this.e[key], isDebt = key.indexOf("debts/") === 0;
      if (!s || s.del || s.h !== h) {
        var u = this.nextU(), w = { key: key, prev: s, mode: "set", data: Object.assign({}, cur[key], { _u: u, _d: this.dev }) };
        if (isDebt && s && !s.del && s.b && this.fv) {
          var patch = debtPatch(s.b, cur[key], this.fv);
          if (patch) { patch._u = u; patch._d = this.dev; w.mode = "merge"; w.data = patch; }
        }
        writes.push(w);
        this.e[key] = { h: h, u: u, d: this.dev, b: isDebt ? cur[key] : undefined };
      }
    }
    for (key in this.e) {
      if (!(key in cur) && !this.e[key].del) {
        var tu = this.nextU();
        writes.push({ key: key, prev: this.e[key], data: { _del: true, _u: tu, _d: this.dev } });
        this.e[key] = { h: "", u: tu, d: this.dev, del: true };
      }
    }
    if (!writes.length) return;
    this.save();
    for (var i = 0; i < writes.length; i += BATCH) this.commit(writes.slice(i, i + BATCH));
    this.status();
  };

  P.commit = function (chunk) {
    var self = this, batch = this.db.batch();
    chunk.forEach(function (w) {
      var p = w.key.split("/");
      var ref = self.db.collection(self.root + "/" + p[0]).doc(p[1]);
      if (w.mode === "merge") batch.set(ref, w.data, { merge: true }); else batch.set(ref, w.data);
    });
    this.pending++;
    batch.commit().then(function () {
      self.pending--; self.pushErr = false; self.pushFails = 0; self.status();
    }, function (err) {
      self.pending--;
      // rejected for good (e.g. permission): forget the optimistic shadow so the next push retries
      chunk.forEach(function (w) { if (w.prev) self.e[w.key] = w.prev; else delete self.e[w.key]; });
      self.save(); self.fail(err);
      // ... and make sure there is a next push: without it the edit would wait for an unrelated change
      self.pushFails++;
      if (!self.stopped) self.pushSoon(Math.min(60000, 3000 * Math.pow(2, self.pushFails - 1)));
    });
  };

  return { Engine: Engine, reduce: reduce, toEntities: toEntities, mergeDebt: mergeDebt, debtPatch: debtPatch, canon: canon, clean: clean, SETTINGS_KEYS: SETTINGS_KEYS };
});
