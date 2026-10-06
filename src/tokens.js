// Design tokens: single source of truth for both appearances. tools/build.js turns them into
// CSS custom properties (light, system dark via prefers-color-scheme, and an explicit
// data-theme override), and tests/design.test.js checks their contrast against WCAG 2.2 AA.
// Values follow iOS semantic colours (grouped backgrounds, label hierarchy, system fills);
// the secondary label is deliberately a little darker than Apple's so it passes AA.
"use strict";

module.exports = {
  light: {
    "--bg": "#F2F2F7",            // systemGroupedBackground
    "--card": "#FFFFFF",          // secondarySystemGroupedBackground
    "--card-2": "#F2F2F7",        // tertiary grouped, used inside cards
    "--label": "#000000",
    "--label-2": "rgba(60,60,67,.74)",
    "--label-3": "rgba(60,60,67,.5)",
    "--sep": "rgba(60,60,67,.2)",
    "--fill": "rgba(120,120,128,.12)",
    "--fill-2": "rgba(120,120,128,.2)",
    "--seg-on": "#FFFFFF",
    "--glass": "rgba(250,250,252,.74)",
    "--glass-solid": "#F9F9FB",
    "--glass-edge": "rgba(255,255,255,.7)",
    "--shell": "#E4E4EA",
    "--pos": "#1E7E34",
    "--neg": "#D70015",
    "--neg-fill": "#FF3B30",
    "--warn-fill": "#FF9500",
    "--dim": "rgba(0,0,0,.36)",
    "--shadow-card": "0 0 0 .5px rgba(0,0,0,.05), 0 1px 3px rgba(0,0,0,.04)",
    "--shadow-float": "0 10px 34px -6px rgba(0,0,0,.22), 0 0 0 .5px rgba(0,0,0,.06)",
    "--shadow-sheet": "0 -10px 40px rgba(0,0,0,.18)"
  },
  dark: {
    "--bg": "#000000",
    "--card": "#1C1C1E",
    "--card-2": "#2C2C2E",
    "--label": "#FFFFFF",
    "--label-2": "rgba(235,235,245,.62)",
    "--label-3": "rgba(235,235,245,.34)",
    "--sep": "rgba(84,84,88,.6)",
    "--fill": "rgba(118,118,128,.24)",
    "--fill-2": "rgba(118,118,128,.36)",
    "--seg-on": "#636366",
    "--glass": "rgba(36,36,38,.7)",
    "--glass-solid": "#242426",
    "--glass-edge": "rgba(255,255,255,.1)",
    "--shell": "#0B0B0C",
    "--pos": "#30D158",
    "--neg": "#FF453A",
    "--neg-fill": "#FF453A",
    "--warn-fill": "#FF9F0A",
    "--dim": "rgba(0,0,0,.58)",
    "--shadow-card": "0 0 0 .5px rgba(255,255,255,.04)",
    "--shadow-float": "0 10px 34px -6px rgba(0,0,0,.6), 0 0 0 .5px rgba(255,255,255,.08)",
    "--shadow-sheet": "0 -10px 40px rgba(0,0,0,.6)"
  },
  // Surfaces the contrast test checks text against: [text token, surface token, minimum ratio]
  contrastPairs: [
    ["--label", "--bg", 4.5], ["--label", "--card", 4.5], ["--label-2", "--bg", 4.5], ["--label-2", "--card", 4.5],
    ["--pos", "--card", 4.5], ["--pos", "--bg", 4.5], ["--neg", "--card", 4.5], ["--neg", "--bg", 4.5]
  ]
};
