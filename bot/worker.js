// Cloudflare Worker entry for the Telegram bot (free plan: 100 000 requests a day, no Firebase Blaze needed).
// Secrets (npx wrangler secret put …): TG_TOKEN (from @BotFather), TG_SECRET (random, also given to setWebhook),
// FIREBASE_SA (the service account key JSON). Var in wrangler.toml: FIREBASE_PROJECT.
import core from "./core.js";
import firestore from "./firestore.js";
import telegram from "./telegram.js";
import CAT from "../src/cat.js";
import modelJson from "../cat-model.json";

let bot = null;                        // one per isolate: the service-account token and the model are reused
function getBot(env) {
  if (bot) return bot;
  const db = new firestore.Firestore({ projectId: env.FIREBASE_PROJECT, serviceAccount: JSON.parse(env.FIREBASE_SA), fetch: (u, i) => fetch(u, i) });
  const tg = new telegram.Telegram(env.TG_TOKEN, (u, i) => fetch(u, i));
  // loaded on the first phrase, not on linking or reports
  bot = core.createBot({ tg, db, model: () => CAT.load(modelJson), log: m => console.error(m) });
  return bot;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname !== "/telegram") return new Response("Qalta bot", { status: 200 });
    if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
    // only Telegram knows the secret given to setWebhook
    if (!core.sameSecret(request.headers.get("X-Telegram-Bot-Api-Secret-Token"), env.TG_SECRET)) return new Response("forbidden", { status: 403 });
    let update;
    try { update = await request.json(); } catch (e) { return new Response("bad request", { status: 400 }); }
    // Work first, answer after: if the Worker is stopped half-way (CPU limit, crash), Telegram gets no "ok" and
    // delivers the update again, and the operation id derived from the message makes the repeat land on the
    // same document. Ordinary errors are told to the person inside handleUpdate and answered "ok".
    await getBot(env).handleUpdate(update);
    return new Response("ok");
  }
};
