#!/usr/bin/env node
// Builds index.html (the self-extracting bundle) from src/.
//   node tools/build.js              rewrite index.html in place (and stamp sw.js)
//   node tools/build.js --out f.html write somewhere else (index.html is still the base wrapper)
// The wrapper (loader, React, the dc-runtime, bundled fonts) stays as it is in index.html;
// this tool replaces the template and drops bundle assets nothing references any more.
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "src");
// Line endings are normalised so the bundle (and its hash) is the same on every machine.
const lf = text => text.replace(/\r\n/g, "\n");
const read = rel => lf(fs.readFileSync(path.join(SRC, rel), "utf8"));
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

// src/*.js are CommonJS modules; inside the bundle each becomes a const holding its exports.
function wrapModule(name, code) {
  return "const " + name + " = (function () {\nvar module = { exports: {} }, exports = module.exports;\n" + code + "\nreturn module.exports;\n})();\n";
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]).sort();
}

// Identifies the sources a bundle was built from. Deterministic: building unchanged sources gives the
// same bundle, so a rebuild after a commit is not a change.
function sourceHash() {
  const h = crypto.createHash("sha1");
  walk(SRC).forEach(f => { h.update(path.relative(SRC, f).split(path.sep).join("/") + "\n" + lf(fs.readFileSync(f, "utf8")) + "\n"); });
  return h.digest("hex").slice(0, 7);
}

function version() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  return { version: pkg.version, hash: sourceHash() };
}

// The offline shell's cache name follows the files it serves, so a release never reuses an old cache.
const SHELL_FILES = ["index.html", "sync-engine.js", "firebase-config.js", "manifest.json", "cat-model.json"];
function shellHash() {
  const h = crypto.createHash("sha1");
  SHELL_FILES.forEach(f => { h.update(f + "\n" + lf(fs.readFileSync(path.join(ROOT, f), "utf8")) + "\n"); });
  return h.digest("hex").slice(0, 8);
}
function stampServiceWorker() {
  const file = path.join(ROOT, "sw.js"), src = fs.readFileSync(file, "utf8");
  const next = src.replace(/const VERSION = "[^"]*";/, () => 'const VERSION = "qalta-shell-' + shellHash() + '";');
  if (next !== src) fs.writeFileSync(file, next);
  return next.match(/const VERSION = "([^"]*)"/)[1];
}

function buildScript() {
  return wrapModule("QL", read("logic.js")) + wrapModule("I18N", read("i18n.js")) + wrapModule("ICONS", read("icons.js")) +
    wrapModule("QP", read("parse.js")) + wrapModule("CAT", read("cat.js")) +
    "const BUILD = " + JSON.stringify(version()) + ";\n" + read("component.js");
}

function buildCss() {
  const tokens = require("../src/tokens.js");
  const vars = o => Object.keys(o).filter(k => k.indexOf("--") === 0).map(k => "  " + k + ": " + o[k] + ";").join("\n");
  // category colours and the accent's text variant come in a light and a dark flavour (set per element)
  const darkRules = prefix => prefix + " .cc { --c: var(--cd); --f: var(--fd); }\n" + prefix + " .q-app { --tint-text: var(--tint-text-d); }\n";
  const sysDark = ":root:not([data-theme=\"light\"])";
  const forcedDark = ":root[data-theme=\"dark\"]";
  const theme =
    ":root {\n  color-scheme: light dark;\n" + vars(tokens.light) + "\n}\n" +
    "@media (prefers-color-scheme: dark) {\n" + sysDark + " {\n  color-scheme: dark;\n" + vars(tokens.dark) + "\n}\n" + darkRules(sysDark) + "}\n" +
    ":root[data-theme=\"light\"] { color-scheme: light; }\n" +
    forcedDark + " {\n  color-scheme: dark;\n" + vars(tokens.dark) + "\n}\n" + darkRules(forcedDark);
  return read("styles.css").replace("/*@@THEME@@*/", () => theme);
}

function buildTemplate() {
  const icons = require("../src/icons.js");
  let t = read("template.html");
  t = t.replace("%%fonts%%", () => read("fonts.css")).replace("%%css%%", () => buildCss());
  t = t.replace(/%%include:([\w-]+)%%/g, (m, name) => read("ui/" + name + ".html"));
  t = t.replace(/%%icon:([a-z0-9-]+):([rfb])%%/g, (m, name, w) => {
    if (!icons[name] || !icons[name][w]) throw new Error("template uses a missing icon: " + name + ":" + w);
    return icons[name][w];
  });
  if (/%%[a-z]+/.test(t.replace("%%script%%", ""))) throw new Error("unresolved %% placeholder in template");
  return t.replace("%%script%%", () => buildScript());
}

function pack(template, basePath, outPath) {
  const html = fs.readFileSync(basePath, "utf8");
  const block = type => {
    const m = new RegExp('(<script type="__bundler/' + type + '">)([\\s\\S]*?)(</script>)').exec(html);
    if (!m) throw new Error("bundle wrapper has no " + type + " block");
    return m;
  };
  const mm = block("manifest"), em = block("ext_resources"), tm = block("template");
  const manifest = JSON.parse(mm[2]);
  const used = new Set(template.match(UUID_RE) || []);
  JSON.parse(em[2]).forEach(e => used.add(e.uuid));
  const pruned = {};
  Object.keys(manifest).forEach(k => { if (used.has(k)) pruned[k] = manifest[k]; });
  const tjson = JSON.stringify(template).replace(/<\/script/gi, m => "<\\/" + m.slice(2));
  let out = html.replace(mm[0], () => mm[1] + "\n" + JSON.stringify(pruned) + "\n" + mm[3]);
  out = out.replace(tm[0], () => tm[1] + tjson + tm[3]);
  JSON.parse(/<script type="__bundler\/template">([\s\S]*?)<\/script>/.exec(out)[1]); // must stay valid JSON
  fs.writeFileSync(outPath, out);
  return { size: out.length, assets: Object.keys(pruned).length, dropped: Object.keys(manifest).length - Object.keys(pruned).length };
}

module.exports = { buildScript, buildTemplate, buildCss, pack, version, sourceHash, shellHash, SHELL_FILES };

if (require.main === module) {
  const i = process.argv.indexOf("--out");
  const base = path.join(ROOT, "index.html");
  const out = i > 0 ? path.resolve(process.argv[i + 1]) : base;
  const r = pack(buildTemplate(), base, out);
  console.log("built " + path.relative(ROOT, out) + ": " + (r.size / 1024).toFixed(0) + " KB, " + r.assets + " bundled assets (" + r.dropped + " unused dropped)");
  if (out === base) console.log("offline shell cache: " + stampServiceWorker());
}
