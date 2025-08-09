// src/bot/commands.js
const TelegramBot = require('node-telegram-bot-api');
const { DB } = require('../services/store');
const { rotateIfNeeded, completeAndRotate } = require('../services/rotation');
const { checkMilestonesAndNotify } = require('../services/milestones');
const { fmtMoney } = require('../utils/money');
const { moment } = require('../utils/time');
const { ICONS, md, linkCardText, linkRow } = require('./ui');
const Wizard = require('./wizard');

function makeBot(token, allowedChatId) {
  if (!token || !allowedChatId) return null;
  const bot = new TelegramBot(token, { polling: true });
  const isAllowed = (msg) => String(msg.chat?.id) === String(allowedChatId);

  // ------ Paged listing for /all_links ------
  async function sendPagedList(chatId, page = 1, pageSize = 5, editMsgId = null) {
    const links = await DB.listLinks();
    if (!links.length) {
      const { text, opts } = md(`${ICONS.list} No links found`);
      return bot.sendMessage(chatId, text, opts);
    }
    const total = links.length;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    page = Math.min(Math.max(1, page), pages);
    const start = (page - 1) * pageSize;
    const slice = links.slice(start, start + pageSize);

    const rows = slice.map((l, i) => linkRow(l, start + i + 1));
    const pageTitle = `${ICONS.list} Links  (${total} total) — Page ${page}/${pages}`;
    const { text } = md(`${pageTitle}\n\n${rows.join('\n\n')}`);

    const kb = {
      inline_keyboard: [[
        { text: '⬅️ Prev', callback_data: `plist:${Math.max(1, page - 1)}:${pageSize}` },
        { text: 'Next ➡️', callback_data: `plist:${Math.min(pages, page + 1)}:${pageSize}` },
      ]]
    };

    if (editMsgId) {
      return bot.editMessageText(
        text,
        { chat_id: chatId, message_id: editMsgId, parse_mode: 'MarkdownV2', reply_markup: kb }
      ).catch(() => {});
    }
    return bot.sendMessage(chatId, text, { parse_mode: 'MarkdownV2', reply_markup: kb });
  }

  // ---------- Callback router: wizard first, then pagination ----------
  bot.on('callback_query', async (q) => {
    try {
      if (!q.message || String(q.message.chat.id) !== String(allowedChatId)) return;
      const handled = await Wizard.onCallback(bot, q);
      if (handled !== false) return;
      const data = q.data || '';
      if (data.startsWith('plist:')) {
        const [, pageStr, sizeStr] = data.split(':');
        const page = Number(pageStr) || 1;
        const size = Number(sizeStr) || 5;
        await sendPagedList(q.message.chat.id, page, size, q.message.message_id);
        return bot.answerCallbackQuery(q.id);
      }
    } catch {}
  });

  // ---------- HELP ----------
  bot.onText(/^\/help$/, async (msg) => {
    if (!isAllowed(msg)) return;
    const help =
`${ICONS.info} Commands
${ICONS.status} /running_links — active links with remaining target
${ICONS.list} /all_links [n] — list links (paged or first n)
${ICONS.add} /create — guided setup (or: /create url|thankYouUrl|note|targetRevenue|timezone)
${ICONS.edit} /edit <id> field=value ...
${ICONS.target} /activate — pick link → set new goal → activate
${ICONS.off} /deactivate — pick link to deactivate
${ICONS.del} /delete — pick link to delete
${ICONS.cash} /revenue — pick link → pick date → see sales list
${ICONS.chart} /total_revenue — Today / This week / This month / Custom
🧰 /edit_stripe_sales — add or remove sales (negative adjustment)
🩺 /health
🚫 /cancel — abort current action`;
    const { text, opts } = md(help);
    bot.sendMessage(msg.chat.id, text, opts);
  });

  // ---------- RUNNING LINKS (instead of /status) ----------
  bot.onText(/^\/running_links$/, async (msg) => {
    if (!isAllowed(msg)) return;
    const links = await DB.listLinks();
    const running = links
      .filter(l => l.active && Number(l.currentRevenue) < Number(l.targetRevenue));
    if (!running.length) {
      return bot.sendMessage(msg.chat.id, md(`${ICONS.status} Running links\n${ICONS.warn} None at the moment`).text, { parse_mode: 'MarkdownV2' });
    }
    const lines = [`${ICONS.status} Running links (${running.length})`];
    running.forEach((l, i) => lines.push(linkRow(l, i + 1)));
    bot.sendMessage(msg.chat.id, md(lines.join('\n\n')).text, { parse_mode: 'MarkdownV2' });
  });

  // ---------- ALL LINKS (instead of /list) ----------
  bot.onText(/^\/all_links(?:\s+(\d+))?$/, async (msg, m) => {
    if (!isAllowed(msg)) return;
    const n = m[1] ? Math.max(1, Math.min(50, Number(m[1]))) : null;
    if (!n) return sendPagedList(msg.chat.id, 1, 5);
    const links = (await DB.listLinks()).slice(0, n);
    if (!links.length) {
      return bot.sendMessage(msg.chat.id, md(`${ICONS.list} No links found`).text, { parse_mode: 'MarkdownV2' });
    }
    const chunks = links.map((l, i) => linkCardText(l, i + 1, links.length)).join('\n\n');
    bot.sendMessage(msg.chat.id, md(chunks).text, { parse_mode: 'MarkdownV2' });
  });

  // ---------- CREATE ----------
  bot.onText(/^\/create(?:\s+(.+))?$/s, async (msg, m) => {
    if (!isAllowed(msg)) return;
    if (!m[1]) return Wizard.startCreate(bot, msg.chat.id);
    const parts = m[1].split('|').map(x => x.trim());
    if (parts.length < 4) {
      return bot.sendMessage(msg.chat.id, md(`${ICONS.warn} Usage: /create url|thankYouUrl|note|targetRevenue|timezone`).text, { parse_mode: 'MarkdownV2' });
    }
    const [url, thankYouUrl, note, targetRevenueRaw, timezone = 'UTC'] = parts;
    const targetRevenue = Number(targetRevenueRaw);
    if (!url || !Number.isFinite(targetRevenue)) {
      return bot.sendMessage(msg.chat.id, md(`${ICONS.x} Invalid url or targetRevenue`).text, { parse_mode: 'MarkdownV2' });
    }
    const doc = await DB.createLink({ url, thankYouUrl: thankYouUrl||'', note: note||'', targetRevenue, currentRevenue: 0, timezone: timezone||'UTC', active: true });
    bot.sendMessage(msg.chat.id, md(`${ICONS.ok} Created\n${linkCardText(doc)}`).text, { parse_mode: 'MarkdownV2' });
  });

  // ---------- EDIT (arg mode) ----------
  bot.onText(/^\/edit$/, async (msg) => {
    if (!isAllowed(msg)) return;
    const usage = `${ICONS.edit} Usage:\n/edit <id> field=value field2=value2\nExamples:\n/edit 64f... note=Main targetRevenue=500\n/edit 64f... active=true`;
    bot.sendMessage(msg.chat.id, md(usage).text, { parse_mode: 'MarkdownV2' });
  });
  bot.onText(/^\/edit\s+(\S+)\s+(.+)$/s, async (msg, m) => {
    if (!isAllowed(msg)) return;
    const id = m[1];
    const pairs = m[2].split(/\s+/).map(kv => kv.trim()).filter(Boolean);
    const patch = {};
    for (const p of pairs) {
      const [k, ...rest] = p.split('=');
      const v = rest.join('=');
      if (!k) continue;
      if (['targetRevenue','currentRevenue'].includes(k)) patch[k] = Number(v);
      else if (k === 'active') patch[k] = ['1','true','yes','on'].includes(String(v).toLowerCase());
      else patch[k] = v;
    }
    const updated = await DB.updateLink(id, patch);
    bot.sendMessage(msg.chat.id, md(updated ? `${ICONS.edit} Edited ${id}` : `${ICONS.x} Not found ${id}`).text, { parse_mode: 'MarkdownV2' });
  });

  // ---------- TOTAL REVENUE (wizard) ----------
  bot.onText(/^\/total_revenue$/, async (msg) => {
    if (!isAllowed(msg)) return;
    return Wizard.startTotals(bot, msg.chat.id);
  });

  // ---------- ACTIVATE / DEACTIVATE / DELETE (wizards) ----------
  bot.onText(/^\/activate$/, async (msg) => { if (isAllowed(msg)) return Wizard.startActivate(bot, msg.chat.id); });
  bot.onText(/^\/deactivate$/, async (msg) => { if (isAllowed(msg)) return Wizard.startDeactivate(bot, msg.chat.id); });
  bot.onText(/^\/delete$/, async (msg) => { if (isAllowed(msg)) return Wizard.startDelete(bot, msg.chat.id); });

  // Handle activate goal input
  bot.on('message', async (msg) => {
    if (!isAllowed(msg)) return;
    const s = Wizard.getState(msg.chat.id);
    if (!s) return;

    // Activate: ask_goal
    if (s.name === 'activate' && s.step === 'ask_goal') {
      const amt = Number((msg.text || '').trim());
      if (!Number.isFinite(amt) || amt <= 0) {
        return bot.sendMessage(msg.chat.id, md('Send a positive number for the goal').text, { parse_mode: 'MarkdownV2' });
      }
      const link = await DB.getLink(s.data.id);
      const updated = await DB.updateLink(s.data.id, {
        active: true,
        targetRevenue: amt,
        milestoneBaseRevenue: Number(link.currentRevenue || 0),
        milestonesNotified: [],
      });
      Wizard.clearState(msg.chat.id);
      return bot.sendMessage(msg.chat.id, md(`▶️ Activated\nGoal: ${fmtMoney(amt)}\nNote: revenue resets to 0 at midnight per link timezone in your daily ops logic`).text, { parse_mode: 'MarkdownV2' });
    }

    // Delegate other flows to wizard handler
    if (s.name === 'create')  return Wizard.handleCreate(bot, msg);
    if (s.name === 'history') return Wizard.handleHistory(bot, msg);
    if (s.name === 'totals')  return Wizard.handleTotals(bot, msg);
    if (s.name === 'revenue_view') return Wizard.handleRevenueView(bot, msg);
    if (s.name === 'edit_sales')   return Wizard.handleEditSales(bot, msg);
  });

  // ---------- REVENUE (viewer wizard) ----------
// /revenue <id> <amount>
bot.onText(/^\/revenue\s+(\S+)\s+(-?\d+(\.\d+)?)$/, async (msg, m) => {
  if (!isAllowed(msg)) return;
  const id = m[1];
  const newAmount = Number(m[2]);
  const before = await DB.getLink(id);

  if (!before || !Number.isFinite(newAmount)) {
    return bot.sendMessage(msg.chat.id, md('Please send a valid link id and number, e.g. /revenue <id> 450').text, { parse_mode: 'MarkdownV2' });
  }

  // delta = how much to move the ledger by
  const delta = newAmount - Number(before.currentRevenue || 0);

  // Create an adjustment sale so lists/charts reflect the change
  if (delta !== 0) {
    await DB.createSale({
      amount: delta,
      host: '',
      linkId: before._id,
      at: new Date(),
      source: 'adjustment',
      note: `manual set to ${newAmount}`,
    });
  }

  // Persist the new running total (used for rotation/milestones)
  const updated = await DB.updateLink(id, {
    currentRevenue: newAmount,
    milestoneBaseRevenue: newAmount,   // treat as new baseline for milestones
    milestonesNotified: [],            // start fresh
  });

  if (updated) await checkMilestonesAndNotify(updated);

  // If this crosses the target, finalize & rotate
  if (Number(before.currentRevenue) < Number(updated.targetRevenue) &&
      Number(newAmount) >= Number(updated.targetRevenue)) {
    await completeAndRotate(updated._id, 'manual-target-reached');
  }

  const txt = `✅ Revenue updated\nID: ${id}\nNow: ${fmtMoney(newAmount)} / ${fmtMoney(updated.targetRevenue)}`;
  bot.sendMessage(msg.chat.id, md(txt).text, { parse_mode: 'MarkdownV2' });
});

  // ---------- HEALTH ----------
  bot.onText(/^\/health$/, async (msg) => {
    if (!isAllowed(msg)) return;
    const mem = process.memoryUsage();
    const mongoose = require('mongoose');
    const states = ['disconnected','connected','connecting','disconnecting'];
    const mongoState = states[mongoose.connection.readyState] || 'unknown';
    const fmtMb = (n) => (n/1024/1024).toFixed(1) + ' MB';
    const up = (() => {
      const s = Math.floor(process.uptime());
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const sec = s % 60;
      return `${h}h ${m}m ${sec}s`;
    })();
    const mode = require('../services/store').useMemory() ? 'memory' : 'mongo';
    const text =
`${ICONS.status} Service health
• Mode: ${mode}
• Mongo: ${mongoState}
• Uptime: ${up}

Resources
• RSS: ${fmtMb(mem.rss)}
• Heap Used: ${fmtMb(mem.heapUsed)}`;
    bot.sendMessage(msg.chat.id, md(text).text, { parse_mode: 'MarkdownV2' });
  });

  // ---------- CANCEL ----------
  bot.onText(/^\/cancel$/, (msg) => {
    if (!isAllowed(msg)) return;
    Wizard.clearState(msg.chat.id);
    bot.sendMessage(msg.chat.id, md('🛑 Cancelled.').text, { parse_mode: 'MarkdownV2' });
  });

  return bot;
}

module.exports = { makeBot };
