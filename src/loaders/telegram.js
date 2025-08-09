const { TELEGRAM_BOT_TOKEN, TELEGRAM_ALLOWED_CHAT_ID } = require('../config');
const { makeBot } = require('../bot/commands');
const { attach } = require('../services/notify');

let bot = null;
function initTelegram() {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_ALLOWED_CHAT_ID) {
    console.warn('[telegram] Disabled — set TELEGRAM_BOT_TOKEN and TELEGRAM_ALLOWED_CHAT_ID to enable.');
    return null;
  }
  bot = makeBot(TELEGRAM_BOT_TOKEN, TELEGRAM_ALLOWED_CHAT_ID);
  attach(bot, TELEGRAM_ALLOWED_CHAT_ID);
  return bot;
}
function getBot(){ return bot; }
module.exports = { initTelegram, getBot };
