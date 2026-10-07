#!/usr/bin/env node
// Points the Telegram bot at the deployed Worker. Run once after the first deploy, in your own terminal:
//   PowerShell:  $env:TG_TOKEN="…"; $env:TG_SECRET="…"; node set-webhook.js https://qalta-bot.<you>.workers.dev
// The token and the secret stay on your machine; nothing here prints them.
"use strict";

async function main() {
  const base = process.argv[2], token = process.env.TG_TOKEN, secret = process.env.TG_SECRET;
  if (!base || !/^https:\/\/[^\s/]+/.test(base)) throw new Error("usage: node set-webhook.js https://<worker address>");
  if (!token || !secret) throw new Error("set TG_TOKEN and TG_SECRET in this terminal first (the same TG_SECRET as the Worker's secret)");
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(secret)) throw new Error("TG_SECRET may contain only A-Z a-z 0-9 _ - (Telegram's rule)");
  const url = base.replace(/\/+$/, "") + "/telegram";
  const call = async (method, body) => {
    const r = await fetch("https://api.telegram.org/bot" + token + "/" + method, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!j.ok) throw new Error(method + ": " + j.description);
    return j.result;
  };
  await call("setWebhook", { url, secret_token: secret, allowed_updates: ["message", "callback_query"], drop_pending_updates: true });
  await call("setMyCommands", { commands: [
    { command: "month", description: "Месяц: траты, доход, бюджет" },
    { command: "today", description: "Записи за сегодня" },
    { command: "undo", description: "Отменить последнюю запись" },
    { command: "help", description: "Как писать" },
    { command: "stop", description: "Отключить бота" }
  ] });
  const info = await call("getWebhookInfo", {});
  console.log("webhook set: " + info.url + (info.last_error_message ? " (last error: " + info.last_error_message + ")" : ""));
}

main().catch(e => { console.error(e.message); process.exitCode = 1; });
