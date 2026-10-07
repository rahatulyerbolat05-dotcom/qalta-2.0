// The few Telegram Bot API calls the bot needs. fetch only, no SDK.
"use strict";

class Telegram {
  constructor(token, fetchFn) {
    if (!token) throw new Error("Telegram bot token is missing");
    this.base = "https://api.telegram.org/bot" + token + "/";
    this.fetch = fetchFn;
  }
  async call(method, body) {
    const r = await this.fetch(this.base + method, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    // "message is not modified" after a double tap is not an error worth failing on
    if (!j.ok && !/not modified/.test(j.description || "")) throw new Error("Telegram " + method + ": " + (j.description || r.status));
    return j.result;
  }
  // buttons: rows of { text, data }
  static kb(buttons) { return buttons ? { inline_keyboard: buttons.map(row => row.map(b => ({ text: b.text, callback_data: b.data }))) } : undefined; }
  send(chatId, text, buttons) { return this.call("sendMessage", { chat_id: chatId, text, reply_markup: Telegram.kb(buttons), link_preview_options: { is_disabled: true } }); }
  edit(chatId, messageId, text, buttons) { return this.call("editMessageText", { chat_id: chatId, message_id: messageId, text, reply_markup: Telegram.kb(buttons) || { inline_keyboard: [] } }); }
  answer(callbackId, text) { return this.call("answerCallbackQuery", { callback_query_id: callbackId, text: text || undefined }); }
}

module.exports = { Telegram };
