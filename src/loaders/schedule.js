const { getBot } = require('./telegram');
const { DB, useMemory } = require('../services/store');
const mongoose = require('mongoose');
const { moment } = require('../utils/time');
const { escapeMdV2 } = require('../utils/mdv2');
const { fmtMoney } = require('../utils/money');

let lastMongoOk = mongoose.connection.readyState === 1;

async function healthLoop() {
  try {
    const bot = getBot();
    if (bot) await bot.getMe();
    const ok = mongoose.connection.readyState === 1;
    if (bot) {
      if (ok && !lastMongoOk) bot.sendMessage(process.env.TELEGRAM_ALLOWED_CHAT_ID, escapeMdV2('✅ *Mongo reconnected*'), { parse_mode:'MarkdownV2' });
      if (!ok && lastMongoOk) bot.sendMessage(process.env.TELEGRAM_ALLOWED_CHAT_ID, escapeMdV2('⚠️ *Mongo disconnected*'), { parse_mode:'MarkdownV2' });
    }
    lastMongoOk = ok;
  } catch {
    try { const bot = getBot(); bot && bot.sendMessage(process.env.TELEGRAM_ALLOWED_CHAT_ID, escapeMdV2('⚠️ *Health check issue* — bot or network problem'), { parse_mode:'MarkdownV2' }); } catch {}
  } finally {
    setTimeout(healthLoop, 60 * 1000);
  }
}

async function dailyPromptsLoop() {
  try {
    const bot = getBot();
    const links = await DB.listLinks();
    const nowUtc = moment.utc();
    for (const l of links.filter(x => x.active)) {
      const tz = l.timezone || 'UTC';
      const nowLocal = nowUtc.clone().tz(tz);
      const isTime = nowLocal.hour() === 23 && nowLocal.minute() === 30;
      const todayStr = nowLocal.format('YYYY-MM-DD');
      if (isTime && l.lastDailyPrompt !== todayStr) {
        const text =
`🗓️ *Daily Check* — \`${tz}\`
Link: \`${l._id}\`
${l.note ? '📝 `'+l.note+'`\n' : ''}Rev Today: *${fmtMoney(l.currentRevenue)}* / *${fmtMoney(l.targetRevenue)}*
Keep active for tomorrow? Use:
• \`/deactivate ${l._id}\` to pause
• \`/goal ${l._id} <amount>\` to set new target`;
        bot && bot.sendMessage(process.env.TELEGRAM_ALLOWED_CHAT_ID, escapeMdV2(text), { parse_mode:'MarkdownV2' });
        await DB.updateLink(l._id, { lastDailyPrompt: todayStr, milestonesNotified: [], milestoneBaseRevenue: Number(l.currentRevenue||0) });
      }
    }
  } catch {}
  finally { setTimeout(dailyPromptsLoop, 60 * 1000); }
}

function startSchedulers() {
  healthLoop();
  dailyPromptsLoop();
}

module.exports = { startSchedulers };
