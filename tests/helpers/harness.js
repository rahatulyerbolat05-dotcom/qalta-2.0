// Loads the real bundle script (logic + i18n + icons + component) in Node with a fake DCLogic
// and just enough DOM, so interaction logic can be tested without a browser.
"use strict";
const { buildScript } = require("../../tools/build.js");

function makeStorage(initial) {
  const m = new Map(Object.entries(initial || {}));
  return {
    getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => { m.delete(k); },
    _map: m
  };
}

function load(opts) {
  opts = opts || {};
  const storage = opts.storage || makeStorage();
  const calls = { pushState: 0, back: 0 };
  const listeners = {};
  const els = {};
  const document = {
    documentElement: { lang: "ru", attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; } },
    activeElement: null, visibilityState: "visible",
    getElementById: id => els[id] || null, querySelectorAll: () => [], contains: () => true,
    addEventListener(t, f) { (listeners["d:" + t] = listeners["d:" + t] || []).push(f); }, removeEventListener() {},
    createElement: () => ({ click() {}, style: {} }), body: { appendChild() {}, removeChild() {} }
  };
  const window = {
    addEventListener(t, f) { (listeners["w:" + t] = listeners["w:" + t] || []).push(f); }, removeEventListener() {},
    requestAnimationFrame: f => setTimeout(f, 0), QALTA_FIREBASE_CONFIG: undefined
  };
  const history = { pushState() { calls.pushState++; }, back() { calls.back++; } };
  const location = { protocol: "http:", hostname: "localhost" };
  const navigator = { onLine: true };

  class DCLogic {
    constructor(props) { this.props = props || {}; this.state = {}; this.renders = 0; }
    setState(update, cb) {
      const patch = typeof update === "function" ? update(this.state) : update;
      this.state = Object.assign({}, this.state, patch);
      if (cb) cb();
    }
    forceUpdate() {}
  }
  const src = buildScript();
  // timers must never keep the test process alive (the component schedules a midnight refresh etc.)
  const unref = t => { if (t && t.unref) t.unref(); return t; };
  const setTimeoutU = (f, ms) => unref(setTimeout(f, ms));
  const setIntervalU = (f, ms) => unref(setInterval(f, ms));
  const factory = new Function("DCLogic", "StreamableLogic", "React", "window", "document", "localStorage", "navigator", "location", "history", "firebase", "QaltaSync", "setTimeout", "setInterval",
    src + "\n;return { Component: Component, QL: QL, I18N: I18N, ICONS: ICONS };");
  const mod = factory(DCLogic, DCLogic, {}, window, document, storage, navigator, location, history, undefined, undefined, setTimeoutU, setIntervalU);
  const c = new mod.Component({});
  if (opts.mount !== false) { c.componentDidMount(); }
  return { c, QL: mod.QL, I18N: mod.I18N, ICONS: mod.ICONS, storage, calls, listeners, document, window, history, DCLogic, Component: mod.Component, src };
}

// pressing the amount keypad: "1","2","000","del"
function type(c, text) {
  text.split(" ").filter(Boolean).forEach(k => c.pressKey(k));
}

module.exports = { load, makeStorage, type };
