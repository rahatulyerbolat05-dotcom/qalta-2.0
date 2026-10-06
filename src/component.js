// Қalta — component: state, layers, handlers and the view-model the template renders.
// Pure logic lives in QL (src/logic.js), strings in I18N, icon paths in ICONS; BUILD is
// injected by tools/build.js. Handlers always read this.state at call time (setState in
// the dc-runtime applies synchronously), never a value captured at render time.

const STORE_KEY = "qalta-proto-v1";
const UI_KEY = "qalta-ui-v1";
const DATA_KEYS = ["ops", "debts", "closed", "eCats", "iCats", "catColors", "catIcons", "hex", "lang", "budget", "openCash", "openCard", "openCashAt", "openCardAt", "skin", "set", "catSizes", "gen"];
const UI_KEYS = ["theme", "lastPay", "tips"];
const LAYER_KINDS = ["entry", "cats", "when", "debtView", "catList", "catEdit", "backup", "confirm"];
const NB = " ";
const CIRC = 2 * Math.PI * 52;
const PAGE = 150;
const TOAST_MS = 10000;
const TAB_DEFS = [["home", "house", "tabOverview"], ["history", "clock-counter-clockwise", "tabHistory"], ["debts", "handshake", "tabDebts"], ["settings", "gear-six", "tabSettings"]];
const ACCENTS = ["blue", "green", "orange", "pink", "purple", "red", "teal", "indigo"];
const PICK_ICONS = ["shopping-cart", "shopping-bag", "basket", "storefront", "bus", "taxi", "car", "train", "bicycle", "airplane-tilt", "gas-pump", "coffee", "fork-knife", "bowl-food", "hamburger", "pizza", "ice-cream", "beer-stein", "wine", "house-line", "lightbulb", "wifi-high", "device-mobile", "desktop", "pill", "stethoscope", "heartbeat", "tooth", "first-aid-kit", "t-shirt", "sneaker", "baby", "backpack", "graduation-cap", "book-open", "barbell", "scissors", "paint-brush", "flower", "plant", "tree", "gift", "film-slate", "game-controller", "music-notes", "headphones", "camera", "tent", "umbrella", "paw-print", "dog", "cat", "wrench", "repeat", "receipt", "hand-heart", "star", "heart", "sparkle", "briefcase", "laptop", "key", "percent", "arrow-u-up-left", "money-wavy", "squares-four", "tag"];

// What a device holds when it has no data of its own (also what a new account starts from): everything that
// could carry another account's private information is emptied. The device's look stays (LOOK_DEFAULTS).
const blankData = () => ({
  ops: [], debts: [], closed: [], eCats: undefined, iCats: undefined, catColors: {}, catIcons: {}, catSizes: {},
  budget: undefined, openCash: undefined, openCard: undefined, openCashAt: undefined, openCardAt: undefined
});
const LOOK_DEFAULTS = { hex: "#007AFF", lang: "ru", skin: 1, set: 1 };

class Component extends DCLogic {
  state = {
    // data (synced across devices)
    ops: [], debts: [], closed: [], eCats: undefined, iCats: undefined,
    catColors: {}, catIcons: {}, hex: "#007AFF", lang: "ru",
    budget: undefined, openCash: undefined, openCard: undefined, openCashAt: undefined, openCardAt: undefined,
    skin: 1, set: 1, catSizes: {}, lastSync: null, gen: undefined,
    // device-local preferences
    theme: "auto", lastPay: "card", tips: {},
    // interface
    tab: "home", layers: [], form: null, whenFor: "op", whMsg: "",
    pkQ: "", clKind: "expense", clReorder: false, ce: null, cf: null, viewDebtId: null,
    hq: "", period: "month", pOffset: 0, kind: "all", limit: PAGE, swipeId: null, flashId: null,
    debtSide: "owed", showClosed: false, bkMsg: "", bkCls: "", toast: null, storageError: false,
    readFail: "", updateReady: false, fbUser: null, fbStatus: "", tick: 0
  };

  // ───────────────────────────── lifecycle ─────────────────────────────

  componentDidMount() {
    this._persisted = {}; this._persistedUi = {};
    this._hist = 0; this._ignorePop = false; this._topKind = null; this._saving = false;
    this.loadStored();
    this._lang = this.state.lang; this._theme = this.state.theme;
    this.applyLang(); this.applyTheme();
    this.whenLibsReady(() => this.fbInit());
    try {
      if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
        const had = !!navigator.serviceWorker.controller;
        navigator.serviceWorker.register("sw.js").catch(e => console.warn("[qalta] offline shell unavailable", e));
        // a new release takes over at once, but this page keeps running the old code until it is reloaded
        navigator.serviceWorker.addEventListener("controllerchange", () => { if (had) this.setState({ updateReady: true }); });
      }
    } catch (e) {}
    // ask the browser not to evict the stored data when space runs low (best effort)
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch (e) {}
    this._onStorage = e => this.onStorage(e);
    this._onKey = e => this.onKey(e);
    this._onPop = () => this.onPop();
    this._onHide = () => { if (document.visibilityState === "hidden") this.flush(); else this.onVisible(); };
    this._onPageHide = () => this.flush();
    document.addEventListener("keydown", this._onKey);
    window.addEventListener("popstate", this._onPop);
    document.addEventListener("visibilitychange", this._onHide);
    window.addEventListener("pagehide", this._onPageHide);
    window.addEventListener("storage", this._onStorage);
    this._today = QL.ymd(Date.now());
    this.scheduleMidnight();
  }

  componentWillUnmount() {
    document.removeEventListener("keydown", this._onKey);
    window.removeEventListener("popstate", this._onPop);
    document.removeEventListener("visibilitychange", this._onHide);
    window.removeEventListener("pagehide", this._onPageHide);
    window.removeEventListener("storage", this._onStorage);
    if (this._onNet) { window.removeEventListener("online", this._onNet); window.removeEventListener("offline", this._onNet); }
    const d = this.dirty();
    if (d.data || d.ui) this.persistNow();     // an unmount inside the 200 ms window must not drop the last change
    clearInterval(this._libTimer); clearTimeout(this._pt); clearTimeout(this._retryT); clearTimeout(this._toastT); clearTimeout(this._midT);
    this.fbStopSync();
  }

  componentDidUpdate() {
    const s = this.state, d = this.dirty();
    if (d.data || d.ui) this.persistSoon();
    if (d.data && this._sync) this._sync.pushSoon();
    if (s.lang !== this._lang) { this._lang = s.lang; this.applyLang(); }
    if (s.theme !== this._theme) { this._theme = s.theme; this.applyTheme(); }
    // a debt sheet cannot outlive its debt (deleted on another device, say)
    if (s.viewDebtId != null && QL.hasLayer(s.layers, "debtView") && !this.findDebt(s.viewDebtId)) this.closeKinds(["debtView"]);
    this.layerEffects();
  }

  // ───────────────────────────── storage ─────────────────────────────

  pickData() { const o = {}; DATA_KEYS.forEach(k => { o[k] = this.state[k]; }); return o; }
  pickUi() { const o = {}; UI_KEYS.forEach(k => { o[k] = this.state[k]; }); return o; }
  markPersisted() {
    DATA_KEYS.forEach(k => { this._persisted[k] = this.state[k]; });
    UI_KEYS.forEach(k => { this._persistedUi[k] = this.state[k]; });
  }
  // What differs from what was last read or written. A failed write leaves it different, so it is retried.
  dirty() {
    const s = this.state;
    return { data: DATA_KEYS.some(k => s[k] !== this._persisted[k]), ui: UI_KEYS.some(k => s[k] !== this._persistedUi[k]) };
  }

  loadStored() {
    let raw = null;
    try { raw = localStorage.getItem(STORE_KEY); } catch (e) {}
    if (raw) {
      let parsed = null, clean = null;
      try { parsed = JSON.parse(raw); clean = QL.sanitizeState(parsed, Date.now()); } catch (e) { clean = null; }
      if (clean) {
        // Earlier versions seeded demo data; an untouched demo is not the person's data (their settings are).
        let seed = null;
        try { seed = localStorage.getItem("qalta-seed-hash"); } catch (e) {}
        const untouched = !!seed && JSON.stringify([parsed.ops, parsed.debts, parsed.closed || []]) === seed;
        if (untouched) { this._migrated = true; this.setState(Object.assign({}, clean, { ops: [], debts: [], closed: [] })); }
        else {
          this.setState(clean);
          try { if (seed) localStorage.removeItem("qalta-seed-hash"); } catch (e) {}
        }
      } else this.readFailed(raw);
    }
    try {
      const ui = JSON.parse(localStorage.getItem(UI_KEY) || "null");
      if (ui && typeof ui === "object") this.setState(this.cleanUi(ui));
    } catch (e) {}
    this.markPersisted();
    // Every local copy of the data has an identity; the sync bookkeeping is tied to it (see sync-engine.js).
    // It and a migrated copy are set after markPersisted, so they count as unsaved and are retried until stored.
    const fresh = !this.state.gen;
    if (fresh) this.setState({ gen: QL.newGen(Date.now()) });
    if (this._migrated) this._persisted.ops = undefined;
    if (fresh || this._migrated) this.persistNow();
  }

  // The stored data is unreadable: keep the raw text, say so, start empty (the first change replaces it).
  readFailed(raw) {
    let kept = false;
    try { localStorage.setItem(STORE_KEY + ".corrupt", raw); kept = localStorage.getItem(STORE_KEY + ".corrupt") === raw; } catch (e) {}
    console.error("[qalta] stored data unreadable" + (kept ? "; copy kept as " + STORE_KEY + ".corrupt" : "; the copy could not be kept"));
    this.setState({ readFail: kept ? "kept" : "lost" });
  }

  cleanUi(ui) {
    const tips = {};
    if (ui.tips && typeof ui.tips === "object") {
      if (ui.tips.balance === true) tips.balance = true;
      if (ui.tips.budget === true) tips.budget = true;
      if (typeof ui.tips.month === "string" && /^\d{4}-\d{2}$/.test(ui.tips.month)) tips.month = ui.tips.month;
    }
    return { theme: ["auto", "light", "dark"].indexOf(ui.theme) >= 0 ? ui.theme : "auto", lastPay: ui.lastPay === "cash" ? "cash" : "card", tips };
  }

  persistSoon() { clearTimeout(this._pt); this._pt = setTimeout(() => this.persistNow(), 200); }
  flush() {
    const d = this.dirty();
    if (this._pt || d.data || d.ui) this.persistNow();
    if (this._sync) this._sync.flush();
  }
  persistNow() {
    clearTimeout(this._pt); this._pt = null;
    clearTimeout(this._retryT); this._retryT = null;
    const s = this.state, d = this.dirty();
    let ok = true;
    // Each key is written only when its own part changed: a tab that merely changed the theme must not
    // replace the data another tab saved meanwhile.
    if (d.data) {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(this.pickData()));
        DATA_KEYS.forEach(k => { this._persisted[k] = s[k]; });
        if (this._migrated) { this._migrated = false; try { localStorage.removeItem("qalta-seed-hash"); } catch (e) {} }
      } catch (e) { ok = false; console.error("[qalta] storage write failed; changes may not persist", e); }
    }
    if (d.ui) {
      try {
        localStorage.setItem(UI_KEY, JSON.stringify(this.pickUi()));
        UI_KEYS.forEach(k => { this._persistedUi[k] = s[k]; });
      } catch (e) { ok = false; console.error("[qalta] storage write failed; preferences may not persist", e); }
    }
    // Keep trying: a failed write left alone would wait for an unrelated change, and be lost if the page closes first.
    if (ok) this._retryN = 0;
    else { this._retryN = (this._retryN || 0) + 1; this._retryT = setTimeout(() => this.persistNow(), Math.min(30000, 2000 * this._retryN)); }
    if (ok === this.state.storageError) this.setState({ storageError: !ok });
  }

  // Another tab or window of the app wrote the stored data: adopt it, so this tab never overwrites it later
  // with an older copy.
  onStorage(e) {
    if (!e || (e.storageArea && e.storageArea !== localStorage) || !e.newValue) return;
    if (e.key === STORE_KEY) {
      if (this.dirty().data) return;               // this tab has a change of its own that is about to be written
      let clean = null;
      try { clean = QL.sanitizeState(JSON.parse(e.newValue), Date.now()); } catch (err) { clean = null; }
      if (!clean) return;
      const next = Object.assign(blankData(), LOOK_DEFAULTS, clean);
      DATA_KEYS.forEach(k => { this._persisted[k] = k in next ? next[k] : this.state[k]; });
      this.setState(next);
    } else if (e.key === UI_KEY) {
      if (this.dirty().ui) return;
      let ui = null;
      try { ui = JSON.parse(e.newValue); } catch (err) { ui = null; }
      if (!ui || typeof ui !== "object") return;
      const next = this.cleanUi(ui);
      UI_KEYS.forEach(k => { this._persistedUi[k] = next[k]; });
      this.setState(next);
    }
  }

  applyLang() {
    try { document.documentElement.lang = { ru: "ru", kz: "kk", en: "en" }[this.state.lang] || "ru"; } catch (e) {}
  }
  applyTheme() {
    try {
      const th = this.state.theme, root = document.documentElement;
      if (th === "auto") root.removeAttribute("data-theme"); else root.setAttribute("data-theme", th);
      const metas = Array.prototype.slice.call(document.querySelectorAll('meta[name="theme-color"]'));
      metas.forEach(m => { if (!m.dataset.c) { m.dataset.c = m.getAttribute("content"); m.dataset.m = m.getAttribute("media") || ""; } });
      metas.forEach(m => {
        if (th === "auto") { m.setAttribute("content", m.dataset.c); if (m.dataset.m) m.setAttribute("media", m.dataset.m); }
        else { m.setAttribute("content", th === "dark" ? "#000000" : "#F2F2F7"); m.removeAttribute("media"); }
      });
    } catch (e) {}
  }

  scheduleMidnight() {
    clearTimeout(this._midT);
    const n = new Date();
    const next = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1, 0, 0, 2).getTime();
    this._midT = setTimeout(() => { this._today = QL.ymd(Date.now()); this.setState({ tick: Date.now() }); this.scheduleMidnight(); }, Math.max(1000, next - n.getTime()));
  }
  onVisible() {
    const today = QL.ymd(Date.now());
    if (today !== this._today) { this._today = today; this.setState({ tick: Date.now() }); this.scheduleMidnight(); }
  }

  // ───────────────────────────── layers ─────────────────────────────

  topKind() { const l = QL.topLayer(this.state.layers); return l ? l.kind : null; }
  openLayer(kind, extra) {
    this.setState(st => Object.assign({ layers: QL.pushLayer(st.layers, { kind }) }, extra || {}));
  }
  layerCleanup(kind, patch) {
    if (kind === "entry") patch.form = null;
    else if (kind === "cats") patch.pkQ = "";
    else if (kind === "when") patch.whMsg = "";
    else if (kind === "catEdit") patch.ce = null;
    else if (kind === "confirm") { patch.cf = null; this._cfOk = null; }
    else if (kind === "debtView") patch.viewDebtId = null;
    else if (kind === "backup") { patch.bkMsg = ""; patch.bkCls = ""; }
    else if (kind === "catList") patch.clReorder = false;
  }
  closeKinds(kinds) {
    const patch = { layers: this.state.layers.filter(l => kinds.indexOf(l.kind) < 0) };
    kinds.forEach(k => { if (QL.hasLayer(this.state.layers, k)) this.layerCleanup(k, patch); });
    this.setState(patch);
  }
  popNow() {
    const top = QL.topLayer(this.state.layers);
    if (!top) return;
    const patch = { layers: QL.popLayer(this.state.layers) };
    this.layerCleanup(top.kind, patch);
    this.setState(patch);
  }
  dismissTop = () => {
    const top = QL.topLayer(this.state.layers);
    if (!top) return;
    if (top.kind === "entry" && this.formDirty()) { this.askDiscard(); return; }
    if (top.kind === "confirm") { this.popNow(); return; }
    this.popNow();
  };
  askDiscard() {
    const t = this.t();
    this._cfOk = () => this.closeKinds(["confirm", "entry", "cats", "when"]);
    this.openLayer("confirm", { cf: { title: t.discardTitle, okLabel: t.discardOk, cancelLabel: t.discardKeep } });
  }

  // Browser/Android back closes the top layer: one history marker exists while any layer is open.
  layerEffects() {
    const layers = this.state.layers, n = layers.length;
    try {
      if (n > 0 && !this._hist) { history.pushState({ qlayer: 1 }, ""); this._hist = 1; }
      else if (n === 0 && this._hist) { this._hist = 0; this._ignorePop = true; history.back(); }
    } catch (e) { this._ignorePop = false; }
    // Inert first: an element inside an inert subtree cannot take focus, so focus goes back to the opener
    // only once the page behind the sheet is live again.
    try {
      const main = document.getElementById("q-main");
      if (main) main.inert = n > 0;
      const els = Array.prototype.slice.call(document.querySelectorAll(".q-layer"));
      let max = -1;
      els.forEach(el => { max = Math.max(max, parseInt(el.style.zIndex || "0", 10)); });
      els.forEach(el => { el.inert = parseInt(el.style.zIndex || "0", 10) !== max; });
    } catch (e) {}
    const kind = this.topKind();
    if (kind !== this._topKind) {
      if (!this._topKind && kind) this._lastFocus = document.activeElement;
      this._topKind = kind;
      const raf = window.requestAnimationFrame || (f => setTimeout(f, 16));
      if (kind) {
        raf(() => { const el = document.getElementById("layer-" + kind); if (el && el.focus) el.focus({ preventScroll: true }); });
      } else {
        const back = this._lastFocus; this._lastFocus = null;
        raf(() => {
          try {
            // the control that opened the sheet; when it is gone (the row was deleted, the screen changed) the screen's heading
            const target = back && back !== document.body && document.contains(back) ? back : document.querySelector("#q-scroll h1");
            if (target && target.focus) target.focus({ preventScroll: true });
          } catch (e) {}
        });
      }
    }
  }
  onPop() {
    if (this._ignorePop) { this._ignorePop = false; return; }
    this._hist = 0;
    if (this.state.layers.length) this.dismissTop();
  }

  // swipe-down to dismiss a sheet (drag the grabber/header). The controls inside the header keep their own
  // taps: the pointer is captured only once it has really moved (capturing on press made a mouse click on
  // the close button or the Expense/Income switch land on the header instead).
  sheetDown = e => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (e.target && e.target.closest && e.target.closest("button, [role=button], [role=radio], a, input, select, textarea")) return;
    const sheet = e.currentTarget && e.currentTarget.closest ? e.currentTarget.closest(".q-sheet") : null;
    if (!sheet) return;
    this._drag = { y0: e.clientY, sheet, dy: 0, t0: Date.now(), el: e.currentTarget, id: e.pointerId, cap: false };
  };
  sheetMove = e => {
    const d = this._drag;
    if (!d) return;
    const dy = Math.max(0, e.clientY - d.y0);
    d.dy = dy;
    if (dy > 4) {
      if (!d.cap) { d.cap = true; try { d.el.setPointerCapture(d.id); } catch (err) {} }
      d.sheet.classList.add("drag"); d.sheet.style.transform = "translateY(" + dy + "px)";
    }
  };
  sheetUp = () => {
    const d = this._drag;
    if (!d) return;
    this._drag = null;
    const vel = d.dy / Math.max(1, Date.now() - d.t0);
    d.sheet.classList.remove("drag");
    if (d.dy > 120 || (d.dy > 40 && vel > 0.6)) { this.dismissTop(); return; }
    if (d.dy > 0) {
      d.sheet.classList.add("snap"); d.sheet.style.transform = "";
      setTimeout(() => { try { d.sheet.classList.remove("snap"); } catch (e) {} }, 320);
    }
  };

  onKey(e) {
    const layers = this.state.layers;
    if (e.key === "Escape") { if (layers.length) { e.preventDefault(); this.dismissTop(); } return; }
    const el = e.target;
    const tag = el && el.tagName;
    const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
    // Ctrl/Cmd+Z takes the last action back while its toast is still up (never while typing in a field)
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && String(e.key).toLowerCase() === "z" && !typing && this._undoFn) { e.preventDefault(); this.runUndo(); return; }
    if ((e.key === "Enter" || e.key === " ") && el && el.getAttribute && el.getAttribute("role") === "button" && el.tabIndex >= 0) {
      e.preventDefault(); el.click(); return;
    }
    if (this.topKind() === "entry" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
      if (/^[0-9]$/.test(e.key)) { e.preventDefault(); this.pressKey(e.key); }
      else if (e.key === "Backspace") { e.preventDefault(); this.pressKey("del"); }
      else if (e.key === "Enter" && tag !== "BUTTON") { e.preventDefault(); this.saveEntry(); }
    }
  }

  // ───────────────────────────── toast and undo ─────────────────────────────

  showToast(text, undo) {
    clearTimeout(this._toastT);
    this._undoFn = undo || null;
    this.setState({ toast: { text, undo: !!undo } });
    this.armToast();
  }
  armToast() { clearTimeout(this._toastT); this._toastT = setTimeout(() => { this._undoFn = null; this.setState({ toast: null }); }, TOAST_MS); }
  // The undo is not on a clock while the person is reaching for it (pointer over the toast, focus on its button).
  toastPause = () => { clearTimeout(this._toastT); };
  toastResume = () => { if (this.state.toast) this.armToast(); };
  hideToast() { clearTimeout(this._toastT); this._undoFn = null; if (this.state.toast) this.setState({ toast: null }); }
  runUndo = () => { const fn = this._undoFn; this.hideToast(); if (fn) fn(); };
  flashRow(id) {
    clearTimeout(this._flashT);
    this.setState({ flashId: id });
    this._flashT = setTimeout(() => this.setState({ flashId: null }), 1800);
  }

  // ───────────────────────────── helpers ─────────────────────────────

  t() { return I18N[this.state.lang] || I18N.ru; }
  cats(kind) { const s = this.state; return kind === "income" ? (s.iCats || QL.DEFAULT_CATS.income) : (s.eCats || QL.DEFAULT_CATS.expense); }
  goTab(id) {
    if (this.state.tab === id) { try { const sc = document.getElementById("q-scroll"); if (sc) sc.scrollTop = 0; } catch (e) {} return; }
    this.setState({ tab: id, swipeId: null });
    try { const sc = document.getElementById("q-scroll"); if (sc) sc.scrollTop = 0; } catch (e) {}
    this.focusScreen();
  }
  // After a tab switch focus moves to the new screen's heading, so a screen reader announces where it is
  // and keyboard users continue from the top of the new screen.
  focusScreen() {
    const raf = window.requestAnimationFrame || (f => setTimeout(f, 16));
    raf(() => { try { const h = document.querySelector("#q-scroll h1"); if (h && h.focus) h.focus({ preventScroll: true }); } catch (e) {} });
  }
  setTip(key, val) { this.setState(st => ({ tips: Object.assign({}, st.tips, { [key]: val === undefined ? true : val }) })); }

  // ───────────────────────────── entry sheet ─────────────────────────────

  openEntry(o) {
    const s = this.state, now = Date.now();
    const f = {
      mode: o.mode || "op", amount: "", zero: false, dir: "expense", cat: null, pay: s.lastPay || "card", ts: null, note: "", editId: null,
      side: "owed", who: "", due: "", debtId: null, account: "cash", showErr: false, msg: ""
    };
    if (f.mode === "op") {
      if (o.edit) {
        const op = o.edit;
        f.editId = op.id; f.dir = op.sum > 0 ? "income" : "expense"; f.amount = String(Math.abs(op.sum));
        f.cat = op.cat; f.pay = op.pay; f.ts = QL.tsOfOp(op, now); f.note = op.note || "";
      } else { f.dir = o.dir || "expense"; f.cat = o.cat || null; }
    } else if (f.mode === "debt") {
      if (o.edit) {
        const d = o.edit;
        f.editId = d.id; f.debtId = d.id; f.side = d.mine ? "owed" : "owe"; f.who = d.who; f.amount = String(d.sum); f.note = d.note || ""; f.due = d.due || "";
      } else f.side = o.side || "owed";
    } else if (f.mode === "repay") {
      f.debtId = o.debt.id;
    } else if (f.mode === "budget") {
      f.amount = s.budget ? String(s.budget) : "";
    } else if (f.mode === "opening") {
      f.account = o.account;
      const b = QL.balances(s, s.ops, now);
      const known = o.account === "cash" ? b.hasCash : b.hasCard, cur = o.account === "cash" ? b.cash : b.card;
      f.amount = known && cur > 0 ? String(cur) : ""; f.zero = known && cur === 0;
    }
    f.orig = this.formSig(f);
    this.setState(st => ({ form: f, layers: QL.pushLayer(st.layers, { kind: "entry" }) }));
  }
  formSig(f) { return JSON.stringify([f.amount, f.dir, f.cat, f.pay, f.ts, f.note, f.side, f.who, f.due, f.zero]); }
  // Unsaved *typing* is what we protect. A new operation with only a category/payment chosen is not
  // worth a question; edits of existing data and budget/balance sheets compare against the opening state.
  formDirty() {
    const f = this.state.form;
    if (!f) return false;
    if (f.editId || f.mode === "budget" || f.mode === "opening") return f.orig !== undefined && this.formSig(f) !== f.orig;
    return !!(f.amount || f.zero || (f.note || "").trim() || (f.who || "").trim() || f.due);
  }
  setForm(patch) { this.setState(st => ({ form: Object.assign({}, st.form, patch, { showErr: false, msg: "" }) })); }

  pressKey(key) {
    const f = this.state.form;
    if (!f) return;
    const allowZero = f.mode === "budget" || f.mode === "opening";
    let amount = f.amount, zero = f.zero;
    if (key === "del") { if (amount === "" && zero) zero = false; amount = amount.slice(0, -1); }
    else if (key === "clear") { amount = ""; zero = false; }
    else {
      const next = QL.keypadPress(amount, key);
      if (next === "" && allowZero && amount === "" && (key === "0" || key === "000")) zero = true;
      else { amount = next; if (next !== "") zero = false; }
    }
    if (f.mode === "repay") {
      const d = this.state.debts.find(x => x.id === f.debtId);
      if (d && QL.amountFromDigits(amount) > QL.debtLeft(d)) amount = String(QL.debtLeft(d));
    }
    this.setState({ form: Object.assign({}, f, { amount, zero, showErr: false, msg: "" }) });
  }

  entryValid(f) {
    const amt = QL.amountFromDigits(f.amount);
    if (f.mode === "op") return amt > 0 && !!f.cat;
    if (f.mode === "debt") return amt > 0 && !!f.who.trim() && amt >= this.paidOf(f);
    if (f.mode === "repay") return amt > 0;
    if (f.mode === "budget") return true;
    return f.amount !== "" || f.zero;
  }
  entryError(f) {
    const t = this.t(), amt = QL.amountFromDigits(f.amount);
    if (amt <= 0 && f.mode !== "budget" && f.mode !== "opening") return t.errAmount;
    if (f.mode === "op" && !f.cat) return t.errCat;
    if (f.mode === "debt" && !f.who.trim()) return t.errWho;
    if (f.mode === "debt" && amt < this.paidOf(f)) return QL.fill(t.errBelowPaid, { n: this.ctxLite().fmt(this.paidOf(f)) });
    return "";
  }
  // What has already been repaid on the debt being edited (the sum cannot go below it).
  paidOf(f) {
    const d = f.editId ? this.state.debts.find(x => x.id === f.editId) : null;
    return d ? d.paid || 0 : 0;
  }

  saveEntry = () => {
    // A second tap finds the form already gone (setState is synchronous), so it cannot save twice;
    // _saving only guards against re-entrancy while one save is running.
    if (this._saving) return;
    const s = this.state, f = s.form;
    if (!f) return;
    if (!this.entryValid(f)) { this.setState({ form: Object.assign({}, f, { showErr: true }) }); return; }
    this._saving = true;
    try {
      const t = this.t(), now = Date.now(), amt = QL.amountFromDigits(f.amount);
      if (f.mode === "op") this.saveOp(f, amt, now, t);
      else if (f.mode === "debt") this.saveDebt(f, amt, now, t);
      else if (f.mode === "repay") this.saveRepay(f, amt, now, t);
      else if (f.mode === "budget") {
        const prev = s.budget;
        this.setState({ budget: amt > 0 ? amt : undefined });
        this.closeKinds(["entry"]);
        this.showToast(t.tBudgetSaved, () => this.setState({ budget: prev }));
      } else if (f.mode === "opening") {
        // "I have X now": X and the moment it was typed in; only operations from then on move it
        const key = f.account === "cash" ? "openCash" : "openCard", atKey = key + "At";
        const prev = { [key]: s[key], [atKey]: s[atKey] };
        this.setState({ [key]: amt, [atKey]: now });
        this.closeKinds(["entry"]);
        this.showToast(t.tBalanceSaved, () => this.setState(prev));
      }
    } finally { this._saving = false; }
  };

  saveOp(f, amt, now, t) {
    const s = this.state;
    const ts = f.ts == null ? now : QL.clampToNow(f.ts, now);
    const sign = f.dir === "income" ? 1 : -1;
    const note = (f.note || "").trim().slice(0, 200);
    if (f.editId) {
      // The record may have been deleted elsewhere while the sheet was open: saving then writes it again,
      // so nothing the person typed is lost.
      const prev = s.ops.find(o => o.id === f.editId);
      const op = Object.assign({ id: f.editId }, prev, { ts, date: QL.ddmm(ts), cat: f.cat, pay: f.pay, note, sum: sign * amt });
      this.setState({ ops: prev ? s.ops.map(o => (o.id === op.id ? op : o)) : [op].concat(s.ops), lastPay: f.pay });
      this.closeKinds(["entry", "cats", "when"]);
      this.flashRow(op.id);
      this.showToast(t.tSaved, () => this.setState(st => ({ ops: prev ? st.ops.map(o => (o.id === prev.id ? prev : o)) : st.ops.filter(o => o.id !== op.id) })));
      return;
    }
    const op = { id: QL.newId(now), date: QL.ddmm(ts), ts, cat: f.cat, note, sum: sign * amt, pay: f.pay };
    this.setState({ ops: [op].concat(s.ops), lastPay: f.pay });
    this.closeKinds(["entry", "cats", "when"]);
    this.flashRow(op.id);
    const c = this.ctxLite();
    this.showToast(QL.fill(t.tAdded, { cat: c.trCat(op.cat), amount: c.smoney(op.sum, false) }), () => this.setState(st => ({ ops: st.ops.filter(o => o.id !== op.id) })));
  }

  saveDebt(f, amt, now, t) {
    const s = this.state, who = f.who.trim().slice(0, 60), note = (f.note || "").trim().slice(0, 200);
    if (f.editId) {
      // Only open debts are edited (a closed one is restored first). If it vanished meanwhile, saving writes it
      // again. The sum can never be below what was repaid: entryValid refuses that.
      const prev = s.debts.find(x => x.id === f.editId), before = { debts: s.debts, closed: s.closed };
      const d = Object.assign({ id: f.editId, paid: 0, log: [], ts: now }, prev, { who, note, sum: amt, mine: f.side === "owed" });
      if (f.due) d.due = f.due; else delete d.due;
      if (QL.debtLeft(d) === 0) {
        // nothing left to repay: the debt is settled, like after a final repayment
        d.closedAt = QL.ddmm(now); d.reason = "full";
        this.setState({ debts: s.debts.filter(x => x.id !== d.id), closed: [d].concat(s.closed.filter(x => x.id !== d.id)) });
        this.closeKinds(["entry", "when", "debtView"]);
      } else {
        this.setState({ debts: prev ? s.debts.map(x => (x.id === d.id ? d : x)) : [d].concat(s.debts) });
        this.closeKinds(["entry", "when"]);
      }
      this.showToast(t.tSaved, () => this.undoDebts([d.id], before));
      return;
    }
    const d = { id: QL.newId(now), who, note, sum: amt, mine: f.side === "owed", paid: 0, log: [], ts: now };
    if (f.due) d.due = f.due;
    this.setState({ debts: [d].concat(s.debts), debtSide: f.side });
    this.closeKinds(["entry", "when"]);
    this.showToast(t.tDebtAdded, () => this.setState(st => ({ debts: st.debts.filter(x => x.id !== d.id) })));
  }

  saveRepay(f, amt, now, t) {
    const s = this.state, debt = s.debts.find(d => d.id === f.debtId);
    if (!debt) { this.closeKinds(["entry"]); this.showToast(t.debtGone); return; }
    const r = QL.applyRepayment(debt, amt, now, now.toString(36) + Math.random().toString(36).slice(2, 6));
    if (!r.applied) { this.closeKinds(["entry"]); return; }
    const before = { debts: s.debts, closed: s.closed };
    if (r.closed) {
      this.setState({ debts: s.debts.filter(d => d.id !== debt.id), closed: [Object.assign({}, r.debt, { closedAt: QL.ddmm(now), reason: "full" })].concat(s.closed) });
      this.closeKinds(["entry", "debtView"]);
    } else {
      this.setState({ debts: s.debts.map(d => (d.id === debt.id ? r.debt : d)) });
      this.closeKinds(["entry"]);
    }
    this.showToast(t.tRepaid, () => this.undoDebts([debt.id], before));
  }
  // Undo for debts: put back only the debts an action touched (list and content); debts that arrived or
  // changed meanwhile on another device stay as they are.
  undoDebts(ids, before) {
    this.setState(st => ({ debts: QL.restoreById(st.debts, before.debts, ids), closed: QL.restoreById(st.closed, before.closed, ids) }));
  }

  // ───────────────────────────── operations ─────────────────────────────

  removeOp(op) {
    const t = this.t();
    this.setState(st => ({ ops: st.ops.filter(o => o.id !== op.id), swipeId: null }));
    if (QL.hasLayer(this.state.layers, "entry")) this.closeKinds(["entry", "cats", "when"]);
    this.showToast(t.tDeleted, () => this.setState(st => ({ ops: [op].concat(st.ops) })));
  }

  // ───────────────────────────── debts ─────────────────────────────

  findDebt(id) {
    const s = this.state;
    return s.debts.find(d => d.id === id) || s.closed.find(d => d.id === id) || null;
  }
  closeDebt(id) {
    const s = this.state, d = s.debts.find(x => x.id === id), t = this.t();
    if (!d) return;
    const before = { debts: s.debts, closed: s.closed };
    this.setState({ debts: s.debts.filter(x => x.id !== id), closed: [Object.assign({}, d, { closedAt: QL.ddmm(Date.now()), reason: "manual" })].concat(s.closed) });
    this.closeKinds(["debtView"]);
    this.showToast(t.tDebtClosed, () => this.undoDebts([id], before));
  }
  restoreDebt(id) {
    const s = this.state, d = s.closed.find(x => x.id === id), t = this.t();
    if (!d) return;
    const before = { debts: s.debts, closed: s.closed };
    const back = Object.assign({}, d); delete back.closedAt; delete back.reason;
    if (QL.debtLeft(back) === 0) { back.paid = 0; back.log = []; }
    this.setState({ closed: s.closed.filter(x => x.id !== id), debts: [back].concat(s.debts) });
    this.showToast(t.tRestored, () => this.undoDebts([id], before));
  }
  deleteDebt(id) {
    const s = this.state, t = this.t();
    const before = { debts: s.debts, closed: s.closed };
    this.setState({ debts: s.debts.filter(x => x.id !== id), closed: s.closed.filter(x => x.id !== id) });
    this.closeKinds(["debtView"]);
    this.showToast(t.tDebtDeleted, () => this.undoDebts([id], before));
  }
  removeRepayment(debtId, logIdx) {
    const s = this.state, d = s.debts.find(x => x.id === debtId), t = this.t();
    if (!d || !d.log || !d.log[logIdx]) return;
    const entry = d.log[logIdx], before = { debts: s.debts, closed: s.closed };
    const nd = Object.assign({}, d, { paid: Math.max(0, (d.paid || 0) - entry.sum), log: d.log.filter((_, i) => i !== logIdx) });
    this.setState({ debts: s.debts.map(x => (x.id === debtId ? nd : x)) });
    this.showToast(t.tRepayRemoved, () => this.undoDebts([debtId], before));
  }

  // ───────────────────────────── categories ─────────────────────────────

  openCatEdit(o) {
    const s = this.state;
    const lk = o.name ? QL.catLook(o.name, s.catColors, s.catIcons) : null;
    this.openLayer("catEdit", { ce: { kind: o.kind, orig: o.name || null, name: o.name || "", color: lk ? lk.l : "#007AFF", icon: lk ? lk.icon : "tag", then: o.then || null, err: "" } });
  }
  saveCategory() {
    const s = this.state, ce = s.ce, t = this.t();
    if (!ce) return;
    const name = (ce.name || "").trim().slice(0, 60);
    if (!name) { this.setState({ ce: Object.assign({}, ce, { err: t.errNameEmpty }) }); return; }
    const all = this.cats("expense").concat(this.cats("income"));
    if (all.some(c => c.toLowerCase() === name.toLowerCase() && c !== ce.orig)) { this.setState({ ce: Object.assign({}, ce, { err: t.errNameExists }) }); return; }
    const key = ce.kind === "income" ? "iCats" : "eCats";
    const list = this.cats(ce.kind).slice();
    const colors = Object.assign({}, s.catColors), icons = Object.assign({}, s.catIcons);
    let ops = s.ops;
    if (ce.orig) {
      const i = list.indexOf(ce.orig);
      if (i >= 0) list[i] = name;
      if (name !== ce.orig) {
        ops = ops.map(o => (o.cat === ce.orig ? Object.assign({}, o, { cat: name }) : o));
        delete colors[ce.orig]; delete icons[ce.orig];
      }
    } else list.push(name);
    const def = QL.catLook(name, {}, {});
    if (ce.color.toUpperCase() !== def.l.toUpperCase()) colors[name] = ce.color.toUpperCase(); else delete colors[name];
    if (ce.icon !== def.icon) icons[name] = ce.icon; else delete icons[name];
    const before = { ops: s.ops, colors: s.catColors, icons: s.catIcons };
    const touched = ce.orig && name !== ce.orig ? s.ops.filter(o => o.cat === ce.orig).map(o => o.id) : [];
    this.setState({ [key]: list, catColors: colors, catIcons: icons, ops });
    if (ce.then === "select" && s.form) { this.setForm({ cat: name }); this.closeKinds(["catEdit", "cats"]); }
    else this.closeKinds(["catEdit"]);
    this.showToast(t.tCatSaved, () => this.undoCategory({ kind: ce.kind, key, name, orig: ce.orig, before, touched }));
  }
  // Undo for a category edit: reverse just that edit (its name, its look, the operations it renamed), so
  // a later reordering or operations that arrived meanwhile are kept.
  undoCategory(u) {
    this.setState(st => {
      const list = (st[u.key] || QL.DEFAULT_CATS[u.kind === "income" ? "income" : "expense"]).slice();
      let next;
      if (u.orig) { const i = list.indexOf(u.name); if (i >= 0) list[i] = u.orig; next = list; }
      else next = list.filter(c => c !== u.name);
      const colors = Object.assign({}, st.catColors), icons = Object.assign({}, st.catIcons);
      [u.name, u.orig].forEach(n => {
        if (n == null) return;
        delete colors[n]; delete icons[n];
        if (QL.own(u.before.colors, n) !== undefined) colors[n] = u.before.colors[n];
        if (QL.own(u.before.icons, n) !== undefined) icons[n] = u.before.icons[n];
      });
      return { [u.key]: next, catColors: colors, catIcons: icons, ops: QL.restoreById(st.ops, u.before.ops, u.touched) };
    });
    // a category that was just made from the picker may still be selected in the open form
    if (!u.orig && this.state.form && this.state.form.cat === u.name) this.setForm({ cat: null });
  }
  deleteTargetOf(kind, name) {
    const list = this.cats(kind);
    const pref = kind === "income" ? "Прочий доход" : "Прочее";
    if (name !== pref && list.indexOf(pref) >= 0) return pref;
    return list.find(c => c !== name) || null;
  }
  removeCategory() {
    const s = this.state, ce = s.ce, t = this.t();
    if (!ce || !ce.orig) return;
    const key = ce.kind === "income" ? "iCats" : "eCats", list = this.cats(ce.kind);
    const to = this.deleteTargetOf(ce.kind, ce.orig);
    if (list.length <= 1 || !to) return;
    const before = { ops: s.ops, colors: s.catColors, icons: s.catIcons };
    const idx = list.indexOf(ce.orig), touched = s.ops.filter(o => o.cat === ce.orig).map(o => o.id);
    const colors = Object.assign({}, s.catColors), icons = Object.assign({}, s.catIcons);
    delete colors[ce.orig]; delete icons[ce.orig];
    this.setState({ [key]: list.filter(c => c !== ce.orig), ops: s.ops.map(o => (o.cat === ce.orig ? Object.assign({}, o, { cat: to }) : o)), catColors: colors, catIcons: icons });
    this.closeKinds(["catEdit"]);
    this.showToast(t.tCatDeleted, () => this.undoCategoryDelete({ kind: ce.kind, key, name: ce.orig, idx, before, touched }));
  }
  undoCategoryDelete(u) {
    this.setState(st => {
      const list = (st[u.key] || QL.DEFAULT_CATS[u.kind === "income" ? "income" : "expense"]).slice();
      if (list.indexOf(u.name) < 0) list.splice(Math.min(u.idx, list.length), 0, u.name);
      const colors = Object.assign({}, st.catColors), icons = Object.assign({}, st.catIcons);
      if (QL.own(u.before.colors, u.name) !== undefined) colors[u.name] = u.before.colors[u.name];
      if (QL.own(u.before.icons, u.name) !== undefined) icons[u.name] = u.before.icons[u.name];
      return { [u.key]: list, catColors: colors, catIcons: icons, ops: QL.restoreById(st.ops, u.before.ops, u.touched) };
    });
  }
  moveCat(kind, name, delta) {
    const key = kind === "income" ? "iCats" : "eCats", list = this.cats(kind).slice();
    const i = list.indexOf(name), j = i + delta;
    if (i < 0 || j < 0 || j >= list.length) return;
    const tmp = list[i]; list[i] = list[j]; list[j] = tmp;
    this.setState({ [key]: list });
  }

  // ───────────────────────────── backup ─────────────────────────────

  exportBackup() {
    const t = this.t();
    try {
      const blob = new Blob([JSON.stringify(QL.buildBackup(this.state), null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob), a = document.createElement("a");
      a.href = url; a.download = "qalta-backup-" + QL.ymd(Date.now()) + ".json";
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      this.setState({ bkMsg: t.backupDone, bkCls: "tx-pos" });
    } catch (e) { this.setState({ bkMsg: t.backupFail, bkCls: "tx-neg" }); }
  }
  pickImportFile() { const el = document.getElementById("qalta-import-input"); if (el) el.click(); }
  onImportFile(e) {
    const t = this.t(), f = e.target.files && e.target.files[0];
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { this.setState({ bkMsg: t.backupBad, bkCls: "tx-neg" }); e.target.value = ""; return; }
    const reader = new FileReader();
    reader.onload = () => {
      let parsed = null, clean = null;
      try { parsed = JSON.parse(reader.result); clean = QL.sanitizeState(parsed, Date.now()); } catch (err) { clean = null; }
      if (!clean) { this.setState({ bkMsg: t.backupBad, bkCls: "tx-neg" }); return; }
      const rawDebts = parsed.debts.length + (Array.isArray(parsed.closed) ? parsed.closed.length : 0);
      const keptDebts = clean.debts.length + clean.closed.length;
      const skipped = parsed.ops.length - clean.ops.length + rawDebts - keptDebts;
      // a file in which every row was rejected is the wrong file, not an empty backup
      if (parsed.ops.length + rawDebts > 0 && clean.ops.length + keptDebts === 0) { this.setState({ bkMsg: t.backupBad, bkCls: "tx-neg" }); return; }
      const before = this.pickData();
      // replacing everything is only done with a copy of what is being replaced
      if (!this.isSeed()) {
        try { localStorage.setItem("qalta-backup-before-import", JSON.stringify(before)); }
        catch (err) { this.setState({ bkMsg: t.backupNoCopy, bkCls: "tx-neg" }); return; }
      }
      delete clean.gen;                              // this device keeps its own identity
      this.setState(Object.assign(blankData(), clean));
      this.closeKinds(["backup"]);
      const ids = {
        ops: before.ops.map(o => o.id).concat(clean.ops.map(o => o.id)),
        debts: before.debts.concat(before.closed, clean.debts, clean.closed).map(d => d.id)
      };
      const vars = { ops: clean.ops.length, debts: keptDebts, n: skipped };
      this.showToast(QL.fill(skipped > 0 ? t.tImportedSkip : t.tImportedN, vars), () => this.undoImport(before, ids));
    };
    reader.onerror = () => this.setState({ bkMsg: t.backupBad, bkCls: "tx-neg" });
    reader.readAsText(f);
    e.target.value = "";
  }
  // Undo for an import: bring back what the import replaced, leaving records that arrived since alone.
  undoImport(before, ids) {
    this.setState(st => ({
      ops: QL.restoreById(st.ops, before.ops, ids.ops),
      debts: QL.restoreById(st.debts, before.debts, ids.debts),
      closed: QL.restoreById(st.closed, before.closed, ids.debts),
      eCats: before.eCats, iCats: before.iCats, catColors: before.catColors, catIcons: before.catIcons, catSizes: before.catSizes,
      budget: before.budget, openCash: before.openCash, openCard: before.openCard, openCashAt: before.openCashAt, openCardAt: before.openCardAt,
      hex: before.hex, lang: before.lang
    }));
  }

  // ───────────────────────────── Firebase (optional cloud sync) ─────────────────────────────
  // Local-first: localStorage is always the working copy, so the app is fully usable offline and
  // with no Firebase config at all. When signed in, sync-engine.js mirrors changes record by record.

  deviceId() {
    try {
      let id = localStorage.getItem("qalta-device-id");
      if (!id) {
        id = window.crypto && crypto.randomUUID ? crypto.randomUUID() : "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
        localStorage.setItem("qalta-device-id", id);
      }
      return id;
    } catch (e) { return this._volatileId || (this._volatileId = "v" + Math.random().toString(36).slice(2, 12)); }
  }
  // Nothing of the person's own in the app yet (so an account's data may replace it freely).
  isSeed() {
    const s = this.state;
    return !s.ops.length && !s.debts.length && !s.closed.length && s.budget === undefined && s.openCash === undefined && s.openCard === undefined && !s.eCats && !s.iCats && !Object.keys(s.catColors || {}).length;
  }
  // The Firebase SDK and sync-engine.js are loaded by the page after this component mounted.
  whenLibsReady(cb) {
    const ok = () => typeof firebase !== "undefined" && typeof firebase.auth === "function" && typeof firebase.firestore === "function" && window.QaltaSync && window.QALTA_FIREBASE_CONFIG !== undefined;
    if (ok()) { cb(); return; }
    let n = 0;
    this._libTimer = setInterval(() => {
      if (ok()) { clearInterval(this._libTimer); cb(); }
      else if (++n > 200) clearInterval(this._libTimer); // ~20 s: stay local-only (offline / blocked CDN)
    }, 100);
  }
  // Switching to another account starts this device clean. What the previous account had is first kept in
  // a local backup; if that copy cannot be written nothing is wiped (returns false). A device with nothing of
  // its own skips the copy so an older, valuable one is not overwritten by an empty one.
  resetLocalData() {
    if (!this.isSeed()) {
      try { localStorage.setItem("qalta-backup-before-switch", JSON.stringify(this.pickData())); }
      catch (e) { console.error("[qalta] could not back up the previous account's data", e); return false; }
    }
    this.setState(Object.assign(blankData(), { gen: QL.newGen(Date.now()) }));
    return true;
  }
  // Returns false when the device could not be prepared for this account (and nothing was wiped).
  prepareForAccount(uid) {
    let last = null;
    try { last = localStorage.getItem("qalta-last-uid"); } catch (e) { return true; }   // storage unusable: nothing to protect or wipe
    if (last === uid) return true;
    if (last) {
      // the marker first: if it cannot be written the wipe would repeat at every start
      try { localStorage.setItem("qalta-last-uid", uid); } catch (e) { return false; }
      if (!this.resetLocalData()) { try { localStorage.setItem("qalta-last-uid", last); } catch (e) {} return false; }
      try { localStorage.removeItem("qalta-sync-v2:" + last); } catch (e) {}
      return true;
    }
    try { localStorage.setItem("qalta-last-uid", uid); } catch (e) {}
    return true;
  }
  fbInit() {
    let cfg = window.QALTA_FIREBASE_CONFIG;
    if (!cfg || typeof firebase === "undefined" || !window.QaltaSync) return;
    if (this._fbAuth) return;
    // On Firebase Hosting the auth handler lives on the page's own origin; Safari blocks the
    // cross-site storage that a different authDomain needs for redirect sign-in.
    cfg = Object.assign({}, cfg);
    if (/\.(web\.app|firebaseapp\.com)$/.test(location.hostname)) cfg.authDomain = location.hostname;
    try {
      if (!firebase.apps || !firebase.apps.length) firebase.initializeApp(cfg);
      this._fbAuth = firebase.auth();
      this._fbDb = firebase.firestore();
      // never wait for the offline cache for ever: after a few seconds sync starts without it
      this._fbReady = Promise.race([
        this._fbDb.enablePersistence({ synchronizeTabs: true }).catch(err => {
          console.warn("[qalta] offline cache unavailable (" + (err && err.code) + "); sync needs a connection", err);
        }),
        new Promise(res => setTimeout(res, 8000))
      ]);
      this._onNet = () => { if (this._sync) this._sync.status(); };
      window.addEventListener("online", this._onNet);
      window.addEventListener("offline", this._onNet);
      this._fbAuth.onAuthStateChanged(user => {
        if (user) {
          this.setState({ fbUser: { uid: user.uid, name: user.displayName || user.email || "", email: user.email || "" }, fbStatus: "loading" });
          this._fbReady.then(() => this.fbStartSync(user.uid)).catch(err => {
            console.error("[qalta] sync could not start", err);
            this.setState({ fbStatus: "error" });
          });
        } else {
          this.fbStopSync();
          this.setState({ fbUser: null, fbStatus: "" });
        }
      });
      this.setState({ tick: Date.now() });
    } catch (e) { console.error("[qalta] firebase init failed", e); }
  }
  fbStartSync(uid) {
    this.fbStopSync();
    if (!this.prepareForAccount(uid)) { this.showToast(this.t().switchFailed); this.fbSignOut(); return; }
    const FV = firebase.firestore.FieldValue;
    this._sync = new QaltaSync.Engine({
      db: this._fbDb, uid, deviceId: this.deviceId(), storage: localStorage,
      fieldValue: { increment: n => FV.increment(n), arrayUnion: (...v) => FV.arrayUnion(...v), delete: () => FV.delete() },
      getState: () => this.state,
      isSeed: () => this.isSeed(),
      onApply: (changes, o) => this.setState(QaltaSync.reduce(this.state, changes, o)),
      onStatus: st => this.setState({ fbStatus: st })
    });
    this._sync.start();
  }
  fbStopSync() { if (this._sync) { this._sync.stop(); this._sync = null; } }
  fbSignIn = () => {
    if (!this._fbAuth || typeof firebase === "undefined") return;
    if (this.state.fbStatus === "error") this.setState({ fbStatus: "" });
    const provider = new firebase.auth.GoogleAuthProvider();
    this._fbAuth.signInWithPopup(provider).catch(err => {
      const code = err && err.code;
      if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return;
      if (code === "auth/popup-blocked" || code === "auth/operation-not-supported-in-this-environment") {
        this._fbAuth.signInWithRedirect(provider).catch(e2 => { console.error("[qalta] redirect sign-in failed", e2); this.setState({ fbStatus: "error" }); });
        return;
      }
      console.error("[qalta] sign-in failed", err);
      this.setState({ fbStatus: "error" });
    });
  };
  fbSignOut = () => {
    this.fbStopSync();
    if (this._fbAuth) this._fbAuth.signOut().catch(err => console.error("[qalta] sign-out failed", err));
  };

  // ───────────────────────────── view-model ─────────────────────────────

  // Everything the view needs from the data, shared by all screens.
  ctxLite() {
    const s = this.state, lang = s.lang;
    const fmt = n => QL.fmtInt(n, lang);
    return {
      lang, fmt,
      money: n => fmt(n) + NB + "₸",
      smoney: (n, plus) => QL.fmtSigned(n, lang, plus) + NB + "₸",
      trCat: name => { const r = I18N.CAT_TR[name]; return (r && r[lang]) || name; }
    };
  }
  iconD(name, w) { const i = ICONS[name] || ICONS.tag; return i[w] || i.f || i.r || i.b || ""; }
  vis(name) {
    const s = this.state, lk = QL.catLook(name, s.catColors, s.catIcons);
    return { cl: lk.l, cd: lk.d, fl: QL.pickText(lk.l, "#FFFFFF", "#1C1C1E", 3), fd: QL.pickText(lk.d, "#FFFFFF", "#1C1C1E", 3), d: this.iconD(lk.icon, "f"), icon: lk.icon, id: lk.id };
  }
  palVis(id) {
    const p = QL.paletteById(id);
    return { cl: p.l, cd: p.d, fl: QL.pickText(p.l, "#FFFFFF", "#1C1C1E", 3), fd: QL.pickText(p.d, "#FFFFFF", "#1C1C1E", 3) };
  }

  renderVals() {
    const s = this.state, now = Date.now(), t = this.t(), lang = s.lang;
    const c = Object.assign(this.ctxLite(), { s, now, t });
    const layers = s.layers;
    const L = {}, Z = {};
    LAYER_KINDS.forEach(k => { L[k] = QL.hasLayer(layers, k); Z[k] = QL.layerZ(layers, k); });

    // accent: a fill that carries white (or dark) text at AA, and readable text variants per appearance
    const hex = QL.isHex(s.hex) ? QL.rgbToHex(QL.hexToRgb(s.hex)) : "#007AFF";
    const lightText = QL.pickText(hex, "#FFFFFF", "#1C1C1E", 3) === "#FFFFFF";
    const tint = lightText ? QL.ensureContrast(hex, "#FFFFFF", 4.5) : hex;
    const onTint = lightText ? "#FFFFFF" : "#1C1C1E";
    c.tint = tint; c.onTint = onTint;

    const home = s.tab === "home" ? this.homeVals(c) : {};
    const out = Object.assign({
      t, L, Z, tint, onTint,
      tintTextL: QL.ensureContrast(hex, "#F2F2F7", 4.5), tintTextD: QL.ensureContrast(hex, "#1C1C1E", 4.5),
      isHome: s.tab === "home", isHistory: s.tab === "history", isDebts: s.tab === "debts", isSettings: s.tab === "settings",
      stackN: home.showWallet ? home.wallet.length : 0,
      tabs: TAB_DEFS.map(d => ({ label: t[d[2]], d: this.iconD(d[1], s.tab === d[0] ? "f" : "r"), cls: s.tab === d[0] ? "on" : "", cur: s.tab === d[0] ? "page" : undefined, go: () => this.goTab(d[0]) })),
      openAdd: () => this.openEntry({ mode: "op" }),
      goHistory: () => this.goTab("history"),
      dismissTop: this.dismissTop, sheetDown: this.sheetDown, sheetMove: this.sheetMove, sheetUp: this.sheetUp,
      banner: s.storageError ? t.storageError : "", hasBanner: s.storageError,
      readBanner: s.readFail === "kept" ? t.readFailKept : s.readFail === "lost" ? t.readFailLost : "", hasReadBanner: !!s.readFail,
      dismissRead: () => this.setState({ readFail: "" }), dismissLabel: t.dismiss,
      hasUpdate: s.updateReady, updateText: t.updateReady, updateLabel: t.updateAction, reloadNow: () => { try { location.reload(); } catch (e) {} },
      toastPause: this.toastPause, toastResume: this.toastResume,
      fbSignInError: !s.fbUser && s.fbStatus === "error" ? t.signInFailed : "",
      hasToast: !!s.toast, toastText: s.toast ? s.toast.text : "", hasToastAction: !!(s.toast && s.toast.undo), toastActionLabel: t.undo, toastAction: this.runUndo,
      importFile: e => this.onImportFile(e),
      fbEnabled: !!(typeof firebase !== "undefined" && window.QALTA_FIREBASE_CONFIG && this._fbAuth),
      fbSignedIn: !!s.fbUser, fbSignedOut: !s.fbUser,
      fbUserName: s.fbUser ? QL.fill(t.signedInAs, { name: s.fbUser.name || s.fbUser.email }) : "",
      fbStatusLabel: s.fbStatus === "saving" ? t.statusSaving : s.fbStatus === "synced" ? t.statusSynced : s.fbStatus === "loading" ? t.statusLoading : s.fbStatus === "offline" ? t.statusOffline : s.fbStatus === "error" ? t.statusError : "",
      fbSignIn: this.fbSignIn, fbSignOut: this.fbSignOut
    }, home);
    if (s.tab === "history") Object.assign(out, this.historyVals(c));
    if (s.tab === "debts") Object.assign(out, this.debtsVals(c));
    if (s.tab === "settings") Object.assign(out, this.settingsVals(c));
    if (L.entry && s.form) out.en = this.entryVals(c);
    if (L.cats) out.pk = this.pickerVals(c);
    if (L.when && s.form) out.wh = this.whenVals(c);
    if (L.debtView) out.dv = this.debtViewVals(c);
    if (L.catList) out.cl = this.catListVals(c);
    if (L.catEdit && s.ce) out.ce = this.catEditVals(c);
    if (L.backup) out.bk = { hasMsg: !!s.bkMsg, msg: s.bkMsg, msgCls: s.bkCls, exportFile: () => this.exportBackup(), importFile: () => this.pickImportFile() };
    if (L.confirm && s.cf) out.cf = { title: s.cf.title, okLabel: s.cf.okLabel, cancelLabel: s.cf.cancelLabel, ok: () => { const fn = this._cfOk; if (fn) fn(); }, cancel: () => this.popNow() };
    return out;
  }

  // One operation as a list row (used by Home and History).
  opRow(o, c, withDate) {
    const s = this.state, t = c.t, now = c.now, v = this.vis(o.cat);
    const ts = QL.tsOfOp(o, now);
    const hasTs = typeof o.ts === "number";
    const parts = [];
    if (withDate) parts.push(QL.capitalize(QL.fmtDate(ts, c.lang, { day: "numeric", month: "short" })));
    if (hasTs) { parts.push(QL.hhmm(ts)); parts.push(o.pay === "cash" ? t.cash : t.card); if (o.note) parts.push(o.note); }
    else if (o.note) parts.push(o.note);
    const amount = c.smoney(o.sum, true);
    return Object.assign({
      id: o.id, name: c.trCat(o.cat), sub: parts.join(" · "), amount, amtCls: o.sum > 0 ? "tx-pos" : "",
      aria: QL.fill(t.rowAria, { cat: c.trCat(o.cat), amount: c.smoney(o.sum, true), date: QL.dayLabel(ts, now, c.lang, { today: t.today, yesterday: t.yesterday }) }) + (hasTs ? ", " + QL.hhmm(ts) + ", " + (o.pay === "cash" ? t.cash : t.card) : "") + (o.note ? ", " + o.note : ""),
      flash: s.flashId === o.id ? "flash" : "",
      tap: () => this.openEntry({ mode: "op", edit: this.state.ops.find(x => x.id === o.id) || o })
    }, v);
  }

  homeVals(c) {
    const s = this.state, t = c.t, now = c.now, lang = c.lang;
    const range = QL.periodRange("month", now, 0);
    const monthOps = s.ops.filter(o => QL.inRange(QL.tsOfOp(o, now), range));
    const tot = QL.totals(monthOps), bud = QL.budgetStatus(s.budget, tot.spent, now);
    const byCat = QL.byCategory(monthOps);
    const bal = QL.balances(s, s.ops, c.now);

    // setup tips (shown until done or dismissed), at most two
    const tips = [];
    if (!s.tips.balance && !bal.known) {
      tips.push({ title: t.tipBalanceTitle, text: t.tipBalanceText, cta: t.tipBalanceCta, d: this.iconD("wallet", "r"), c: "#34C759",
        go: () => this.openEntry({ mode: "opening", account: "cash" }), skip: () => this.setTip("balance") });
    }
    if (!s.tips.budget && s.budget === undefined && s.ops.length >= 3) {
      tips.push({ title: t.tipBudgetTitle, text: t.tipBudgetText, cta: t.tipBudgetCta, d: this.iconD("target", "r"), c: c.tint,
        go: () => this.openEntry({ mode: "budget" }), skip: () => this.setTip("budget") });
    }
    const ym = QL.ymd(now).slice(0, 7);
    if (new Date(now).getDate() <= 5 && s.tips.month !== ym) {
      const prevRange = QL.periodRange("month", now, -1);
      const prevTot = QL.totals(s.ops.filter(o => QL.inRange(QL.tsOfOp(o, now), prevRange)));
      if (prevTot.spent > 0) {
        const month = QL.periodLabel(prevRange, lang, now).toLowerCase();
        tips.push({
          title: t.tipMonthTitle, d: this.iconD("calendar-blank", "r"), c: "#FF9500",
          text: QL.fill(s.budget ? t.tipMonthTextBudget : t.tipMonthText, { month, a: c.fmt(prevTot.spent), b: c.fmt(s.budget || 0) }),
          cta: t.tipMonthCta, go: () => { this.setTip("month", ym); this.openEntry({ mode: "budget" }); }, skip: () => this.setTip("month", ym)
        });
      }
    }

    // month card
    const out = {
      dateLine: QL.capitalize(QL.fmtDate(now, lang, { weekday: "long", day: "numeric", month: "long" })),
      monthName: QL.periodLabel(range, lang, now),
      tips: tips.slice(0, 2),
      hasBudget: bud.has, noBudget: !bud.has, spentText: c.fmt(tot.spent),
      openBudget: () => this.openEntry({ mode: "budget" })
    };
    if (bud.has) {
      const dash = Math.max(0, bud.ratio) * CIRC;
      out.ringDash = dash.toFixed(1) + " " + CIRC.toFixed(1);
      out.ringColor = tot.spent <= 0 ? "transparent" : bud.over ? "var(--neg-fill)" : "var(--tint)";
      out.ringLabel = bud.over ? t.budgetOver : t.budgetLeft;
      out.ringValue = c.fmt(Math.abs(bud.left));
      out.ringPct = Math.min(999, bud.pct) + "%";
      const daysWord = QL.fill(QL.plural(lang, bud.daysLeft, [t.daysLeftOne, t.daysLeftFew, t.daysLeftMany]), { n: bud.daysLeft });
      out.paceText = bud.over ? QL.fill(t.overBy, { n: c.fmt(-bud.left) }) : QL.fill(t.paceLine, { n: c.fmt(bud.perDay), d: daysWord });
      out.spentOfText = QL.fill(t.spentOf, { a: c.fmt(bud.spent), b: c.fmt(bud.budget) });
      out.ringAria = QL.fill(t.ringAria, { a: c.fmt(bud.spent), b: c.fmt(bud.budget), p: bud.pct });
    }

    // where the money goes: one bar (length is read more accurately than angle) + a sorted list
    out.hasBreak = byCat.length > 0;
    if (byCat.length) {
      const top = byCat.slice(0, 5), restSum = byCat.slice(5).reduce((a, x) => a + x.sum, 0);
      out.bar = top.map(x => { const v = this.vis(x.cat); return { w: x.sum, cl: v.cl, cd: v.cd }; });
      if (restSum > 0) { const g = this.palVis("gray"); out.bar.push({ w: restSum, cl: g.cl, cd: g.cd }); }
      out.legend = top.map(x => Object.assign({ name: c.trCat(x.cat), sum: c.money(x.sum), pct: Math.max(1, Math.round(x.sum / tot.spent * 100)) + "%" }, this.vis(x.cat)));
      out.barAria = QL.fill(t.barAria, { list: top.map(x => c.trCat(x.cat) + " " + c.money(x.sum)).join(", ") });
    }

    // accounts
    const accRow = (key, label, has, value, icon, pal) => {
      const p = this.palVis(pal);
      return {
        label, value: has ? c.smoney(value, false) : t.unset, valCls: has ? "" : "tx-tint", d: this.iconD(icon, "r"), cl: p.cl, cd: p.cd,
        aria: QL.fill(t.accountAria, { name: label, value: has ? c.smoney(value, false) : t.unset }),
        tap: () => this.openEntry({ mode: "opening", account: key })
      };
    };
    out.accounts = [accRow("cash", t.cash, bal.hasCash, bal.cash, "money", "green"), accRow("card", t.card, bal.hasCard, bal.card, "credit-card", "blue")];
    out.hasAccTotal = bal.hasCash && bal.hasCard; out.accTotal = c.money(bal.total);

    // recent
    const recent = QL.sortOps(s.ops, now).slice(0, 5);
    out.recent = recent.map(o => this.opRow(o, c, true));
    out.noRecent = recent.length === 0;

    // Wallet stack: the three most used expense categories, back card first
    const ranked = QL.rankCategories(this.cats("expense"), s.ops.filter(o => o.sum < 0), now).slice(0, 3);
    const spentBy = Object.create(null); byCat.forEach(x => { spentBy[x.cat] = x.sum; });
    out.wallet = ranked.slice().reverse().map((name, i) => Object.assign({
      i, name: c.trCat(name), sub: spentBy[name] ? c.money(spentBy[name]) : "", aria: t.addOp + ": " + c.trCat(name),
      pick: () => this.openEntry({ mode: "op", dir: "expense", cat: name })
    }, this.vis(name)));
    out.showWallet = out.wallet.length > 0;
    return out;
  }

  historyVals(c) {
    const s = this.state, t = c.t, now = c.now, lang = c.lang;
    const range = QL.periodRange(s.period, now, s.pOffset);
    const label = x => c.trCat(x);
    const base = QL.filterOps(s.ops, { range, query: s.hq, kind: "all", label }, now);
    const sums = QL.totals(base);
    const rows = QL.sortOps(s.kind === "all" ? base : base.filter(o => (s.kind === "expense" ? o.sum < 0 : o.sum > 0)), now);
    const shown = rows.slice(0, s.limit);
    const groups = QL.groupByDay(shown, now, lang, { today: t.today, yesterday: t.yesterday });
    const swipe = o => ({
      shift: s.swipeId === o.id ? "-9rem" : "0px",
      start: e => {
        this._x0 = e.clientX; this._sw = o.id; this._moved = false; this._held = false;
        if (this.state.swipeId && this.state.swipeId !== o.id) this.setState({ swipeId: null });
      },
      move: e => {
        if (this._sw !== o.id || this._x0 == null) return;
        const dx = e.clientX - this._x0;
        if (Math.abs(dx) > 10) this._moved = true;
        if (dx < -40 && this.state.swipeId !== o.id) this.setState({ swipeId: o.id });
        if (dx > 40 && this.state.swipeId === o.id) this.setState({ swipeId: null });
      },
      end: () => { this._x0 = null; this._sw = null; },
      remove: () => this.removeOp(o),
      edit: () => this.openEntry({ mode: "op", edit: o })
    });
    const mk = o => {
      const row = this.opRow(o, c, false), sw = swipe(o), baseTap = row.tap;
      row.tap = () => {
        if (this._moved) { this._moved = false; return; }
        if (this.state.swipeId === o.id) { this.setState({ swipeId: null }); return; }
        baseTap();
      };
      return Object.assign(row, sw);
    };
    const periodIds = [["week", t.periodWeek], ["month", t.periodMonth], ["year", t.periodYear], ["all", t.periodAll]];
    const kinds = [["all", t.kindAll], ["expense", t.kindExpense], ["income", t.kindIncome]];
    return {
      hq: s.hq, setHq: e => this.setState({ hq: e.target.value, limit: PAGE }),
      periods: periodIds.map(p => ({ name: p[1], on: s.period === p[0], cls: s.period === p[0] ? "on" : "", pick: () => this.setState({ period: p[0], pOffset: 0, limit: PAGE, swipeId: null }) })),
      hasStepper: s.period !== "all", periodTitle: QL.periodLabel(range, lang, now),
      prevPeriod: () => this.setState({ pOffset: s.pOffset - 1, limit: PAGE, swipeId: null }),
      nextPeriod: () => { if (this.state.pOffset < 0) this.setState({ pOffset: this.state.pOffset + 1, limit: PAGE, swipeId: null }); },
      noNext: s.pOffset >= 0, nextOpacity: s.pOffset >= 0 ? 0.3 : 1,
      kinds: kinds.map(k => ({ name: k[1], on: s.kind === k[0], cls: s.kind === k[0] ? "on" : "", pick: () => this.setState({ kind: k[0], limit: PAGE }) })),
      sumSpent: c.money(sums.spent), sumIncome: c.money(sums.income), sumNet: c.smoney(sums.net, true),
      groups: groups.map(g => ({ label: g.label, sum: c.smoney(g.sum, true), rows: g.ops.map(mk) })),
      canMore: rows.length > shown.length, moreText: QL.fill(t.showMore, { n: Math.min(PAGE, rows.length - shown.length) }),
      showMore: () => this.setState(st => ({ limit: st.limit + PAGE })),
      noRows: rows.length === 0, noRowsText: s.hq ? t.noRowsSearch : t.noRowsEmpty,
      canResetSearch: !!s.hq, resetSearch: () => this.setState({ hq: "", limit: PAGE })
    };
  }

  dueText(d, c) {
    const t = c.t, due = QL.debtDue(d, c.now);
    const dayW = n => QL.plural(c.lang, n, I18N.forms.day[c.lang] || I18N.forms.day.ru);
    if (due.kind === "future") return QL.fill(t.dueIn, { n: due.days, d: dayW(due.days) });
    if (due.kind === "today") return t.dueToday;
    if (due.kind === "overdue") return QL.fill(t.dueOver, { n: due.days, d: dayW(due.days) });
    return "";
  }

  debtsVals(c) {
    const s = this.state, t = c.t, now = c.now, mine = s.debtSide === "owed";
    const side = mine ? "owed" : "owe";
    const list = s.debts.filter(d => d.mine === mine).slice().sort((a, b) => {
      const da = QL.debtDue(a, now), db = QL.debtDue(b, now);
      const ka = da.kind === "none" ? 1e9 : (da.kind === "overdue" ? -1e6 + -da.days : da.days);
      const kb = db.kind === "none" ? 1e9 : (db.kind === "overdue" ? -1e6 + -db.days : db.days);
      return ka - kb || (b.ts || b.id) - (a.ts || a.id);
    });
    const totals = QL.debtSideTotals(s.debts);
    const closed = s.closed.filter(d => d.mine === mine);
    return {
      sides: [["owed", t.owedToMe], ["owe", t.iOwe]].map(p => ({ name: p[1], on: s.debtSide === p[0], cls: s.debtSide === p[0] ? "on" : "", pick: () => this.setState({ debtSide: p[0] }) })),
      debtSummaryLabel: mine ? t.owedTotal : t.oweTotal, debtSummary: c.money(mine ? totals.owedToMe : totals.iOwe),
      debtRows: list.map(d => {
        const left = QL.debtLeft(d), dueT = this.dueText(d, c), kind = QL.debtDue(d, now).kind;
        const sub = [dueT, d.note].filter(Boolean).join(" · ") || t.dueNone;
        const v = this.palFor(d.who);
        return Object.assign({
          name: d.who, initial: (d.who || "?").trim().charAt(0).toUpperCase() || "?", sub, subCls: kind === "overdue" ? "tx-neg" : "muted",
          left: c.money(left), hasProg: (d.paid || 0) > 0, progW: Math.round((d.paid || 0) / Math.max(1, d.sum) * 100) + "%",
          aria: QL.fill(t.debtAria, { who: d.who, side: mine ? t.owedToMe : t.iOwe, left: c.money(left) }) + (dueT ? ", " + dueT : "") + (d.note ? ", " + d.note : ""),
          tap: () => this.openLayer("debtView", { viewDebtId: d.id })
        }, v);
      }),
      noDebts: list.length === 0, noDebtsText: mine ? t.noDebtsOwed : t.noDebtsOwe,
      addDebt: () => this.openEntry({ mode: "debt", side }),
      hasClosed: closed.length > 0, showClosed: s.showClosed, closedTitle: QL.fill(t.closedDebts, { n: closed.length }),
      toggleClosed: () => this.setState(st => ({ showClosed: !st.showClosed })),
      closedRows: closed.map(d => ({ name: d.who, sub: QL.fill(t.closedBy, { date: d.closedAt || "" }), sum: c.money(d.sum), restore: () => this.restoreDebt(d.id) }))
    };
  }
  // Avatar colour from the person's name (stable).
  palFor(name) {
    const p = QL.PALETTE[QL.nameHash(name) % (QL.PALETTE.length - 1)];
    return { cl: p.l, cd: p.d, fl: QL.pickText(p.l, "#FFFFFF", "#1C1C1E", 3), fd: QL.pickText(p.d, "#FFFFFF", "#1C1C1E", 3) };
  }

  settingsVals(c) {
    const s = this.state, t = c.t, lang = c.lang;
    const bal = QL.balances(s, s.ops, c.now);
    const row = (label, value, icon, pal, tap, aria) => { const p = this.palVis(pal); return { label, value, d: this.iconD(icon, "r"), cl: p.cl, cd: p.cd, tap, aria: aria || label + ": " + value }; };
    const themes = [["auto", t.themeAuto], ["light", t.themeLight], ["dark", t.themeDark]];
    return {
      setBudgetRows: [
        row(t.monthlyBudget, s.budget ? c.money(s.budget) : t.notSet, "target", "blue", () => this.openEntry({ mode: "budget" })),
        row(t.cashBalance, bal.hasCash ? c.smoney(bal.cash, false) : t.notSet, "money", "green", () => this.openEntry({ mode: "opening", account: "cash" })),
        row(t.cardBalance, bal.hasCard ? c.smoney(bal.card, false) : t.notSet, "credit-card", "indigo", () => this.openEntry({ mode: "opening", account: "card" }))
      ],
      setCatRows: [
        row(t.expenseCats, String(this.cats("expense").length), "tag", "orange", () => this.openCatList("expense")),
        row(t.incomeCats, String(this.cats("income").length), "coins", "mint", () => this.openCatList("income"))
      ],
      themes: themes.map(x => ({ name: x[1], on: s.theme === x[0], cls: s.theme === x[0] ? "on" : "", pick: () => this.setState({ theme: x[0] }) })),
      langs: [["ru", "Рус"], ["kz", "Қаз"], ["en", "Eng"]].map(x => ({ name: x[1], on: s.lang === x[0], cls: s.lang === x[0] ? "on" : "", pick: () => this.setState({ lang: x[0] }) })),
      swatches: ACCENTS.map(id => {
        const p = QL.paletteById(id), on = (s.hex || "").toUpperCase() === p.l.toUpperCase();
        return { c: p.l, f: QL.pickText(p.l, "#FFFFFF", "#1C1C1E", 3), on, cls: on ? "on" : "", aria: QL.fill(t.colorAria, { name: (I18N.accents[lang] || I18N.accents.ru)[id] || id }), pick: () => this.setState({ hex: p.l }) };
      }),
      openBackup: () => this.openLayer("backup"),
      versionLine: QL.fill(t.version, { v: BUILD.version + " (" + BUILD.hash + ")" })
    };
  }

  openCatList(kind) { this.openLayer("catList", { clKind: kind, clReorder: false }); }
  catUsage() { const m = Object.create(null); this.state.ops.forEach(o => { m[o.cat] = (m[o.cat] || 0) + 1; }); return m; }

  catListVals(c) {
    const s = this.state, t = c.t, kind = s.clKind;
    const list = this.cats(kind), use = this.catUsage();
    const usedText = n => n > 0 ? QL.fill(t.usedTimes, { n, w: QL.plural(c.lang, n, I18N.forms.time[c.lang] || I18N.forms.time.ru) }) : t.notUsed;
    return {
      title: t.categories,
      reorder: s.clReorder, notReorder: !s.clReorder, reorderLabel: s.clReorder ? t.reorderDone : t.reorder,
      toggleReorder: () => this.setState(st => ({ clReorder: !st.clReorder })),
      kinds: [["expense", t.kindExpense], ["income", t.kindIncome]].map(k => ({ name: k[1], on: kind === k[0], cls: kind === k[0] ? "on" : "", pick: () => this.setState({ clKind: k[0] }) })),
      rows: list.map((name, i) => Object.assign({
        name: c.trCat(name), used: usedText(use[name] || 0), aria: c.trCat(name),
        tap: () => { if (!this.state.clReorder) this.openCatEdit({ kind, name }); },
        upAria: QL.fill(t.moveUp, { name: c.trCat(name) }), downAria: QL.fill(t.moveDown, { name: c.trCat(name) }),
        noUp: i === 0, noDown: i === list.length - 1, upOp: i === 0 ? 0.3 : 1, downOp: i === list.length - 1 ? 0.3 : 1,
        up: () => this.moveCat(kind, name, -1), down: () => this.moveCat(kind, name, 1)
      }, this.vis(name))),
      create: () => this.openCatEdit({ kind, name: null })
    };
  }

  catEditVals(c) {
    const s = this.state, t = c.t, ce = s.ce;
    const col = ce.color, fl = QL.pickText(col, "#FFFFFF", "#1C1C1E", 3);
    const list = this.cats(ce.kind);
    const to = ce.orig ? this.deleteTargetOf(ce.kind, ce.orig) : null;
    const nameOk = !!(ce.name || "").trim();
    return {
      title: ce.orig ? t.editCategory : t.newCategory, name: ce.name,
      setName: e => this.setState(st => ({ ce: Object.assign({}, st.ce, { name: e.target.value, err: "" }) })),
      cl: col, cd: col, fl, fd: fl, d: this.iconD(ce.icon, "f"),
      hasErr: !!ce.err, err: ce.err, saveOff: !nameOk, saveOp: nameOk ? 1 : 0.4, save: () => this.saveCategory(),
      colors: QL.PALETTE.map(p => ({
        c: p.l, f: QL.pickText(p.l, "#FFFFFF", "#1C1C1E", 3), on: ce.color.toUpperCase() === p.l.toUpperCase(), cls: ce.color.toUpperCase() === p.l.toUpperCase() ? "on" : "",
        aria: QL.fill(t.colorAria, { name: (I18N.accents[s.lang] || I18N.accents.ru)[p.id] || p.id }), pick: () => this.setState(st => ({ ce: Object.assign({}, st.ce, { color: p.l }) }))
      })),
      icons: PICK_ICONS.filter(n => ICONS[n]).map(n => ({ name: n, d: this.iconD(n, "f"), on: ce.icon === n, cls: ce.icon === n ? "on" : "", pick: () => this.setState(st => ({ ce: Object.assign({}, st.ce, { icon: n }) })) })),
      showDelete: !!ce.orig && list.length > 1 && !!to, remove: () => this.removeCategory(),
      deleteNote: to ? QL.fill(t.deleteNote, { to: c.trCat(to) }) : ""
    };
  }

  pickerVals(c) {
    const s = this.state, f = s.form, t = c.t, now = c.now;
    const dir = f ? f.dir : "expense";
    const q = (s.pkQ || "").trim().toLowerCase();
    const all = this.cats(dir);
    const ranked = QL.rankCategories(all, s.ops.filter(o => (dir === "income" ? o.sum > 0 : o.sum < 0)), now);
    const list = ranked.filter(n => !q || c.trCat(n).toLowerCase().indexOf(q) >= 0 || n.toLowerCase().indexOf(q) >= 0);
    return {
      q: s.pkQ, setQ: e => this.setState({ pkQ: e.target.value }),
      list: list.map(n => Object.assign({ name: c.trCat(n), on: !!f && f.cat === n, cls: f && f.cat === n ? "on" : "", pick: () => { this.setForm({ cat: n }); this.closeKinds(["cats"]); } }, this.vis(n))),
      empty: list.length === 0 && !!q,
      create: () => this.openCatEdit({ kind: dir, name: null, then: "select" })
    };
  }

  whenVals(c) {
    const s = this.state, f = s.form, t = c.t, now = c.now, forDue = s.whenFor === "due";
    if (forDue) {
      return {
        title: t.dueTitle, hasQuick: false, quick: [], hasTime: false, max: undefined, date: f.due || QL.ymd(QL.addDays(now, 7)), time: "",
        setDate: e => { const v = e.target.value; if (QL.parseYmd(v)) this.setForm({ due: v }); },
        hasClear: !!f.due, clear: () => { this.setForm({ due: "" }); this.popNow(); }, hasMsg: false, msg: ""
      };
    }
    const ts = f.ts == null ? now : f.ts;
    const dayOf = k => QL.ymd(QL.addDays(now, -k));
    const quick = [[0, t.today], [1, t.yesterday], [2, t.dayBefore]].map(q => {
      const on = QL.ymd(ts) === dayOf(q[0]);
      return { name: q[1], on, cls: on ? "on" : "", pick: () => {
        const cur = this.state.form.ts == null ? Date.now() : this.state.form.ts;
        this.setForm({ ts: q[0] === 0 ? null : QL.combineDateTime(dayOf(q[0]), QL.hhmm(cur), cur) });
        this.setState({ whMsg: "" });
      } };
    });
    const apply = (dateStr, timeStr) => {
      const n = Date.now(), cur = this.state.form.ts == null ? n : this.state.form.ts;
      const nt = QL.combineDateTime(dateStr, timeStr, cur);
      if (nt > n) { this.setForm({ ts: null }); this.setState({ whMsg: this.t().hintFuture }); return; }
      this.setForm({ ts: nt }); this.setState({ whMsg: "" });
    };
    return {
      title: t.whenTitle, hasQuick: true, quick, hasTime: true, max: QL.ymd(now), date: QL.ymd(ts), time: QL.hhmm(ts),
      setDate: e => { if (QL.parseYmd(e.target.value)) apply(e.target.value, QL.hhmm(this.state.form.ts == null ? Date.now() : this.state.form.ts)); },
      setTime: e => { if (QL.parseHhmm(e.target.value) !== null) apply(QL.ymd(this.state.form.ts == null ? Date.now() : this.state.form.ts), e.target.value); },
      hasClear: false, clear: () => {}, hasMsg: !!s.whMsg, msg: s.whMsg
    };
  }

  debtViewVals(c) {
    const s = this.state, t = c.t, now = c.now, d = this.findDebt(s.viewDebtId);
    if (!d) return { name: "", cl: "#8E8E93", cd: "#8E8E93", fl: "#FFFFFF", fd: "#FFFFFF", sideLabel: "", leftText: "0", paidText: "", dueText: "", dueCls: "", hasNote: false, note: "", hasProg: false, progW: "0%", hasLog: false, canEdit: false, canTakeBack: false, log: [], canRepay: false, repayLabel: "", closeLabel: "", edit() {}, repay() {}, close() {}, remove() {} };
    const isClosed = !s.debts.some(x => x.id === d.id), left = QL.debtLeft(d);   // a closed debt is history: read-only until restored
    const pal = this.palVis(d.mine ? "green" : "orange");
    const due = QL.debtDue(d, now);
    return Object.assign({
      name: d.who, sideLabel: d.mine ? t.owedToMe : t.iOwe, leftText: c.fmt(left),
      paidText: c.money(d.paid || 0),
      dueText: due.kind === "none" ? t.noDue : this.dueText(d, c), dueCls: due.kind === "overdue" ? "tx-neg" : "",
      hasNote: !!d.note, note: d.note || "", hasProg: (d.paid || 0) > 0, progW: Math.round((d.paid || 0) / Math.max(1, d.sum) * 100) + "%",
      hasLog: (d.log || []).length > 0, canEdit: !isClosed, canTakeBack: !isClosed,
      log: (d.log || []).map((lg, i) => ({ date: lg.date, sum: c.money(lg.sum), aria: t.removeRepay + ": " + lg.date, remove: () => this.removeRepayment(d.id, i) })),
      canRepay: !isClosed && left > 0, repayLabel: d.mine ? t.repayMine : t.repayOwe, closeLabel: isClosed ? t.restore : t.closeDebt,
      edit: () => this.openEntry({ mode: "debt", edit: d }),
      repay: () => this.openEntry({ mode: "repay", debt: d }),
      close: () => { if (isClosed) this.restoreDebt(d.id); else this.closeDebt(d.id); },
      remove: () => this.deleteDebt(d.id)
    }, pal);
  }

  entryVals(c) {
    const s = this.state, f = s.form, t = c.t, now = c.now, lang = c.lang;
    const amt = QL.amountFromDigits(f.amount);
    const valid = this.entryValid(f);
    const out = { hasSides: false, noSides: true, sides: [], showFill: false, fillText: "", fill() {}, showCats: false, showPay: false, showWhen: false, showNote: false, showWho: false, showDue: false, showCatBadge: false, showDelete: false, deleteLabel: "", chips: [], pays: [], keys: [], hintCls: "" };
    let look, title, saveLabel;
    const tintLook = { cl: c.tint, cd: c.tint, fl: c.onTint, fd: c.onTint };
    if (f.mode === "op") {
      const list = this.cats(f.dir);
      const sideName = f.dir === "income" ? t.income : t.expense;
      title = f.editId ? t.editOp : t.newOp;
      look = f.cat ? this.vis(f.cat) : tintLook;
      Object.assign(out, {
        hasSides: true, noSides: false, sidesAria: t.sideAria,
        sides: [["expense", t.expense], ["income", t.income]].map(p => ({ name: p[1], on: f.dir === p[0], cls: f.dir === p[0] ? "on" : "", pick: () => { if (this.state.form.dir !== p[0]) this.setForm({ dir: p[0], cat: null }); } })),
        showCatBadge: !!f.cat, catName: f.cat ? c.trCat(f.cat) : "", catD: f.cat ? this.vis(f.cat).d : "",
        showCats: true, showPay: true, showWhen: true, showNote: true
      });
      const ranked = QL.rankCategories(list, s.ops.filter(o => (f.dir === "income" ? o.sum > 0 : o.sum < 0)), now);
      let top = ranked.slice(0, 5);
      if (f.cat && top.indexOf(f.cat) < 0) top = [f.cat].concat(top.slice(0, 4));
      out.chips = top.map(n => Object.assign({ name: c.trCat(n), on: f.cat === n, cls: f.cat === n ? "on" : "", pick: () => this.setForm({ cat: n }) }, this.vis(n)));
      out.moreLabel = list.length > top.length ? QL.fill(t.moreN, { n: list.length - top.length }) : t.newCategory;
      out.moreCats = () => this.openLayer("cats");
      out.pays = [["card", t.card], ["cash", t.cash]].map(p => ({ name: p[1], on: f.pay === p[0], cls: f.pay === p[0] ? "on" : "", pick: () => this.setForm({ pay: p[0] }) }));
      const ts = f.ts == null ? now : f.ts;
      out.whenText = f.ts == null ? t.today : QL.fill(t.atTime, { date: QL.dayLabel(ts, now, lang, { today: t.today, yesterday: t.yesterday }), time: QL.hhmm(ts) });
      out.openWhen = () => this.openLayer("when", { whenFor: "op", whMsg: "" });
      out.note = f.note; out.setNote = e => this.setForm({ note: e.target.value });
      out.hint = f.msg ? f.msg : !amt ? t.hintAmount : !f.cat ? QL.fill(t.hintOpNoCat, { side: sideName }) : QL.fill(t.hintOp, { side: sideName, cat: c.trCat(f.cat) });
      saveLabel = f.editId ? t.saveEdit : f.dir === "income" ? t.saveIncome : t.saveExpense;
      if (f.editId) {
        out.showDelete = true; out.deleteLabel = t.delete;
        out.remove = () => { const op = this.state.ops.find(o => o.id === f.editId); if (op) this.removeOp(op); };
      }
    } else if (f.mode === "debt") {
      const sideName = f.side === "owed" ? t.owedToMe : t.iOwe;
      title = f.editId ? t.editDebt : t.newDebt;
      look = this.palVis(f.side === "owed" ? "green" : "orange");
      Object.assign(out, {
        hasSides: true, noSides: false, sidesAria: t.debtSide,
        sides: [["owed", t.owedToMe], ["owe", t.iOwe]].map(p => ({ name: p[1], on: f.side === p[0], cls: f.side === p[0] ? "on" : "", pick: () => this.setForm({ side: p[0] }) })),
        showWho: true, showDue: true, showNote: true
      });
      out.who = f.who; out.setWho = e => this.setForm({ who: e.target.value });
      out.dueText = f.due ? QL.capitalize(QL.fmtDate(QL.parseYmd(f.due), lang, { day: "numeric", month: "long", year: "numeric" })) : t.noDue;
      out.openDue = () => {
        // the sheet shows a date (a week ahead) when none is set: what is shown is what is saved
        if (this.state.form && !this.state.form.due) this.setForm({ due: QL.ymd(QL.addDays(Date.now(), 7)) });
        this.openLayer("when", { whenFor: "due", whMsg: "" });
      };
      out.note = f.note; out.setNote = e => this.setForm({ note: e.target.value });
      const paid = this.paidOf(f);
      out.hint = !f.who.trim() ? t.hintDebtNoWho : !amt ? t.hintAmount : amt < paid ? QL.fill(t.errBelowPaid, { n: c.fmt(paid) }) : QL.fill(t.hintDebt, { side: sideName });
      saveLabel = t.saveDebt;
    } else if (f.mode === "repay") {
      const d = this.findDebt(f.debtId);
      title = QL.fill(t.repayTitle, { who: d ? d.who : "" });
      look = this.palVis(d && d.mine ? "green" : "orange");
      out.hint = d ? QL.fill(t.hintRepay, { n: c.fmt(QL.debtLeft(d)) }) : "";
      if (d) { out.showFill = true; out.fillText = QL.fill(t.fillAll, { n: c.fmt(QL.debtLeft(d)) }); out.fill = () => this.setForm({ amount: String(QL.debtLeft(d)) }); }
      saveLabel = t.saveRepay;
    } else if (f.mode === "budget") {
      title = t.budgetTitle; look = tintLook; out.hint = t.hintBudget; saveLabel = amt > 0 ? t.saveBudget : t.noBudget;
    } else {
      const acct = f.account === "cash" ? t.cash : t.card;
      title = QL.fill(t.openingTitle, { account: acct.toLowerCase() }); look = tintLook;
      out.hint = QL.fill(t.hintOpening, { account: acct.toLowerCase() }); saveLabel = t.saveOpening;
    }
    if (f.showErr && !valid) { out.hint = this.entryError(f); out.hintCls = "err"; }
    Object.assign(out, { title, cl: look.cl, cd: look.cd, fl: look.fl, fd: look.fd, saveLabel });
    const digits = f.amount.length;
    out.amountText = f.amount ? c.fmt(f.amount) : "0";
    out.amountCls = digits > 7 ? "long" : "";
    out.saveOff = !valid; out.saveCls = valid ? "" : "is-off"; out.save = this.saveEntry;
    out.keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "000", "0", "del"].map(k => {
      const isDel = k === "del";
      return {
        label: k, aria: isDel ? t.eraseDigit : k, cls: k === "000" ? "dim" : "", isIcon: isDel, isText: !isDel, d: isDel ? this.iconD("backspace", "r") : "",
        press: () => { if (isDel && this._cleared) { this._cleared = false; return; } this.pressKey(k); },
        down: () => { if (isDel) { clearTimeout(this._holdT); this._cleared = false; this._holdT = setTimeout(() => { this._cleared = true; this.pressKey("clear"); }, 520); } },
        up: () => { clearTimeout(this._holdT); }
      };
    });
    return out;
  }
}
Component.blankData = blankData; Component.LOOK_DEFAULTS = LOOK_DEFAULTS; Component.DATA_KEYS = DATA_KEYS;
