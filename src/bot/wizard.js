// src/bot/wizard.js
const { DB } = require('../services/store');
const { moment } = require('../utils/time');
const { fmtMoney } = require('../utils/money');
const { ICONS, md, linkRow } = require('./ui');
const { checkMilestonesAndNotify } = require('../services/milestones');
const { rotateIfNeeded, completeAndRotate } = require('../services/rotation');

const state = new Map(); // chatId -> { name, step, data }

const setState = (chatId, s) => state.set(chatId, s);
const getState = (chatId) => state.get(chatId);
const clearState = (chatId) => state.delete(chatId);

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function linkPickerKeyboard(links, prefix, page = 1, perPage = 8) {
  const total = links.length;
  const pages = Math.max(1, Math.ceil(total / perPage));
  page = Math.min(Math.max(1, page), pages);
  const start = (page - 1) * perPage;
  const slice = links.slice(start, start + perPage);

  const rows = slice.map(l => [{ text: `${l.active ? '▶️' : '⏸️'} ${(l.note || '').trim() || l._id}`, callback_data: `${prefix}:pick:${l._id}:${page}` }]);
  const nav = [];
  nav.push({ text: '⬅️ Prev', callback_data: `${prefix}:page:${Math.max(1, page - 1)}` });
  nav.push({ text: 'Next ➡️', callback_data: `${prefix}:page:${Math.min(pages, page + 1)}` });
  return { inline_keyboard: [...rows, nav] };
}

/* ------------------ CREATE ------------------ */
async function startCreate(bot, chatId) {
  setState(chatId, { name: 'create', step: 'ask_url', data: {} });
  bot.sendMessage(chatId, md(`${ICONS.add} Create link\nPlease send the checkout URL`).text, { parse_mode: 'MarkdownV2' });
}

async function handleCreate(bot, msg) {
  const s = getState(msg.chat.id);
  if (!s || s.name !== 'create') return;
  const text = (msg.text || '').trim();

  if (s.step === 'ask_url') {
    s.data.url = text;
    s.step = 'ask_ty';
    return bot.sendMessage(msg.chat.id, md('Send the Thank-You page URL').text, { parse_mode: 'MarkdownV2' });
  }
  if (s.step === 'ask_ty') {
    s.data.thankYouUrl = text;
    s.step = 'ask_note';
    return bot.sendMessage(msg.chat.id, md('Give this Stripe a short name (note), e.g. “Main US account”').text, { parse_mode: 'MarkdownV2' });
  }
  if (s.step === 'ask_note') {
    s.data.note = text;
    s.step = 'ask_target';
    return bot.sendMessage(msg.chat.id, md('Target revenue for this link (number)').text, { parse_mode: 'MarkdownV2' });
  }
  if (s.step === 'ask_target') {
    const n = Number(text);
    if (!Number.isFinite(n)) return bot.sendMessage(msg.chat.id, md('Please send a valid number').text, { parse_mode: 'MarkdownV2' });
    s.data.targetRevenue = n;
    s.step = 'ask_tz';
    return bot.sendMessage(msg.chat.id, md('Timezone (IANA), e.g. Europe/Rome').text, { parse_mode: 'MarkdownV2' });
  }
  if (s.step === 'ask_tz') {
    s.data.timezone = text || 'UTC';
    const doc = await DB.createLink({
      url: s.data.url,
      thankYouUrl: s.data.thankYouUrl || '',
      note: s.data.note || '',
      targetRevenue: s.data.targetRevenue,
      currentRevenue: 0,
      timezone: s.data.timezone || 'UTC',
      active: true,
      milestonesNotified: [],
      milestoneBaseRevenue: 0,
    });
    clearState(msg.chat.id);
    return bot.sendMessage(msg.chat.id, md(`✅ Created\n${(require('./ui').linkCardText)(doc)}`).text, { parse_mode: 'MarkdownV2' });
  }
}

/* ------------------ RESET ------------------ */
async function startReset(bot, chatId) {
  const links = await DB.listLinks();
  if (!links.length) return bot.sendMessage(chatId, md('No links yet').text, { parse_mode: 'MarkdownV2' });
  setState(chatId, { name: 'reset', step: 'pick', data: { page: 1 } });
  return bot.sendMessage(chatId, md('Pick a link to reset revenue to 0').text, {
    parse_mode: 'MarkdownV2',
    reply_markup: linkPickerKeyboard(links, 'reset', 1),
  });
}

async function doReset(linkId) {
  return DB.updateLink(linkId, { currentRevenue: 0, milestonesNotified: [], milestoneBaseRevenue: 0 });
}

/* ------------------ HISTORY ------------------ */
async function startHistory(bot, chatId) {
  const links = await DB.listLinks();
  if (!links.length) return bot.sendMessage(chatId, md('No links yet').text, { parse_mode: 'MarkdownV2' });
  setState(chatId, { name: 'history', step: 'pick', data: { page: 1 } });
  return bot.sendMessage(chatId, md('Pick a link for revenue history').text, {
    parse_mode: 'MarkdownV2',
    reply_markup: linkPickerKeyboard(links, 'history', 1),
  });
}

async function buildHistoryText(link, start, end, tz) {
  const all = await DB.listSales(10000);
  const byLink = all.filter(s => String(s.linkId) === String(link._id));
  const bucket = {};
  for (let cur = start.clone(); cur.isSameOrBefore(end); cur.add(1, 'day')) bucket[cur.format('YYYY-MM-DD')] = 0;
  for (const s of byLink) {
    const day = moment(s.at).tz(tz).format('YYYY-MM-DD');
    if (Object.prototype.hasOwnProperty.call(bucket, day)) bucket[day] += Number(s.amount || 0);
  }
  let total = 0;
  const lines = [];
  lines.push('📈 Revenue History');
  lines.push(`Stripe: ${(link.note || '').trim() || '-'}`);
  lines.push(`ID: ${link._id}`);
  lines.push(`Range: ${start.format('YYYY-MM-DD')} → ${end.format('YYYY-MM-DD')}   TZ: ${tz}`);
  lines.push('');
  for (const d of Object.keys(bucket).sort()) { const val = bucket[d]; total += val; lines.push(`• ${d}: ${fmtMoney(val)}`); }
  lines.push('');
  lines.push(`Total: ${fmtMoney(total)}`);
  return lines.join('\n');
}

/* ------------------ TOTAL REVENUE ------------------ */
async function startTotals(bot, chatId) {
  setState(chatId, { name: 'totals', step: 'period' });
  const kb = {
    inline_keyboard: chunk([
      { text: 'Today', callback_data: 'totals:p:today' },
      { text: 'This week', callback_data: 'totals:p:week' },
      { text: 'This month', callback_data: 'totals:p:month' },
      { text: 'Custom…', callback_data: 'totals:p:custom' },
    ], 2),
  };
  bot.sendMessage(chatId, md(`${ICONS.chart} Total revenue\nChoose a period`).text, { parse_mode: 'MarkdownV2', reply_markup: kb });
}

async function computeTotals({ start, end }) {
  const links = await DB.listLinks();
  const sales = await DB.listSales(10000);
  const slice = sales.filter(s => s.at >= start.toDate() && s.at <= end.toDate());

  // Grand total
  const total = slice.reduce((a, s) => a + Number(s.amount || 0), 0);

  // By source (host)
  const byHost = {};
  for (const s of slice) {
    const h = s.host || '-';
    byHost[h] = (byHost[h] || 0) + Number(s.amount || 0);
  }

  // By timezone (sum of links in that tz)
  const tzMap = {};
  const idToTz = new Map(links.map(l => [String(l._id), l.timezone || 'UTC']));
  for (const s of slice) {
    const tz = idToTz.get(String(s.linkId)) || 'UTC';
    tzMap[tz] = (tzMap[tz] || 0) + Number(s.amount || 0);
  }

  return { total, byHost, tzMap, linksCount: links.length, salesCount: slice.length };
}

/* ------------------ ACTIVATE / DEACTIVATE / DELETE ------------------ */
async function startActivate(bot, chatId) {
  const links = await DB.listLinks();
  if (!links.length) return bot.sendMessage(chatId, md('No links yet').text, { parse_mode: 'MarkdownV2' });
  setState(chatId, { name: 'activate', step: 'pick', data: { page: 1 } });
  bot.sendMessage(chatId, md('Pick a link to activate').text, { parse_mode: 'MarkdownV2', reply_markup: linkPickerKeyboard(links, 'activate', 1) });
}

async function startDeactivate(bot, chatId) {
  const links = await DB.listLinks();
  if (!links.length) return bot.sendMessage(chatId, md('No links yet').text, { parse_mode: 'MarkdownV2' });
  setState(chatId, { name: 'deactivate', step: 'pick', data: { page: 1 } });
  bot.sendMessage(chatId, md('Pick a link to deactivate').text, { parse_mode: 'MarkdownV2', reply_markup: linkPickerKeyboard(links, 'deactivate', 1) });
}

async function startDelete(bot, chatId) {
  const links = await DB.listLinks();
  if (!links.length) return bot.sendMessage(chatId, md('No links yet').text, { parse_mode: 'MarkdownV2' });
  setState(chatId, { name: 'delete', step: 'pick', data: { page: 1 } });
  bot.sendMessage(chatId, md('Pick a link to delete').text, { parse_mode: 'MarkdownV2', reply_markup: linkPickerKeyboard(links, 'delete', 1) });
}

/* ------------------ REVENUE (viewer) ------------------ */
async function startRevenueViewer(bot, chatId) {
  const links = await DB.listLinks();
  if (!links.length) return bot.sendMessage(chatId, md('No links yet').text, { parse_mode: 'MarkdownV2' });
  setState(chatId, { name: 'revenue_view', step: 'pick', data: { page: 1 } });
  bot.sendMessage(chatId, md('Pick a Stripe to view revenue and sales').text, {
    parse_mode: 'MarkdownV2',
    reply_markup: linkPickerKeyboard(links, 'revv', 1),
  });
}

/* ------------------ EDIT STRIPE SALES ------------------ */
async function startEditStripeSales(bot, chatId) {
  const links = await DB.listLinks();
  if (!links.length) return bot.sendMessage(chatId, md('No links yet').text, { parse_mode: 'MarkdownV2' });
  setState(chatId, { name: 'edit_sales', step: 'pick', data: { page: 1 } });
  bot.sendMessage(chatId, md('Pick a Stripe to adjust sales').text, {
    parse_mode: 'MarkdownV2',
    reply_markup: linkPickerKeyboard(links, 'esales', 1),
  });
}

/* ------------------ CALLBACK ROUTER ------------------ */
async function onCallback(bot, q) {
  const chatId = q.message.chat.id;
  const data = q.data || '';

  // Paging for any picker
  const m = data.match(/^(reset|history|activate|deactivate|delete|revv|esales):page:(\d+)$/);
  if (m) {
    const prefix = m[1];
    const page = Number(m[2]) || 1;
    const links = await DB.listLinks();
    return bot.editMessageReplyMarkup(linkPickerKeyboard(links, prefix, page), {
      chat_id: chatId,
      message_id: q.message.message_id,
    });
  }

  // Picked link flows
  // RESET
  if (data.startsWith('reset:pick:')) {
    const [, , id, pageStr] = data.split(':');
    await doReset(id);
    clearState(chatId);
    return bot.editMessageText(md(`✅ Revenue reset\nID: ${id}`).text, {
      chat_id: chatId, message_id: q.message.message_id, parse_mode: 'MarkdownV2'
    });
  }

  // HISTORY
  if (data.startsWith('history:pick:')) {
    const [, , id, pageStr] = data.split(':');
    const link = await DB.getLink(id);
    if (!link) return;
    const tz = link.timezone || 'UTC';
    setState(chatId, { name: 'history', step: 'range', data: { id, tz } });
    const kb = {
      inline_keyboard: [[
        { text: 'Last 7 days', callback_data: 'history:r:last7' },
        { text: 'This week', callback_data: 'history:r:thisweek' },
      ],[
        { text: 'This month', callback_data: 'history:r:thismonth' },
        { text: 'Custom…', callback_data: 'history:r:custom' },
      ]]
    };
    return bot.editMessageText(md(`📈 Revenue history for ${(link.note||'').trim() || id}\nChoose a range`).text, {
      chat_id: chatId, message_id: q.message.message_id, parse_mode: 'MarkdownV2', reply_markup: kb
    });
  }
  if (data.startsWith('history:r:')) {
    const sub = data.split(':')[2];
    const s = getState(chatId);
    if (!s || s.name !== 'history') return;
    const tz = s.data.tz;
    let start, end;
    if (sub === 'last7') { end = moment().tz(tz).endOf('day'); start = end.clone().subtract(6,'day').startOf('day'); }
    if (sub === 'thisweek') { start = moment().tz(tz).startOf('week'); end = moment().tz(tz).endOf('week'); }
    if (sub === 'thismonth') { start = moment().tz(tz).startOf('month'); end = moment().tz(tz).endOf('month'); }
    if (sub === 'custom') {
      s.step = 'custom_from';
      return bot.sendMessage(chatId, md('Send start date YYYY-MM-DD').text, { parse_mode: 'MarkdownV2' });
    }
    const link = await DB.getLink(s.data.id);
    const body = await buildHistoryText(link, start, end, tz);
    clearState(chatId);
    return bot.sendMessage(chatId, md(body).text, { parse_mode: 'MarkdownV2' });
  }
  // history custom continues in handleHistory()

  // TOTALS
  if (data.startsWith('totals:p:')) {
    const sub = data.split(':')[2];
    const tz = 'Europe/Rome'; // default “your” timezone for week/month boundaries
    const s = getState(chatId);
    if (!s || s.name !== 'totals') setState(chatId, { name: 'totals', step: 'period' });

    if (sub === 'custom') {
      setState(chatId, { name: 'totals', step: 'custom_from' });
      return bot.sendMessage(chatId, md('Send start date YYYY-MM-DD').text, { parse_mode: 'MarkdownV2' });
    }

    let start, end;
    if (sub === 'today') { start = moment().tz(tz).startOf('day'); end = moment().tz(tz).endOf('day'); }
    if (sub === 'week') { start = moment().tz(tz).startOf('week'); end = moment().tz(tz).endOf('week'); }
    if (sub === 'month') { start = moment().tz(tz).startOf('month'); end = moment().tz(tz).endOf('month'); }

    const { total, byHost, tzMap, linksCount, salesCount } = await computeTotals({ start, end });
    const lines = [];
    lines.push(`${ICONS.chart} Total revenue`);
    lines.push(`Period: ${start.format('YYYY-MM-DD')} → ${end.format('YYYY-MM-DD')}`);
    lines.push(`Sales: ${salesCount}   Total: ${fmtMoney(total)}`);
    lines.push('');
    lines.push('By source (host):');
    const hosts = Object.entries(byHost).sort((a,b)=>b[1]-a[1]).slice(0,12);
    for (const [h, sum] of hosts) lines.push(`• ${h}: ${fmtMoney(sum)}`);
    lines.push('');
    lines.push('By timezone:');
    for (const [tzKey, sum] of Object.entries(tzMap).sort()) lines.push(`• ${tzKey}: ${fmtMoney(sum)}`);
    clearState(chatId);
    return bot.editMessageText(md(lines.join('\n')).text, {
      chat_id: chatId, message_id: q.message.message_id, parse_mode: 'MarkdownV2'
    });
  }

  // ACTIVATE
  if (data.startsWith('activate:pick:')) {
    const [, , id] = data.split(':');
    const link = await DB.getLink(id);
    if (!link) return;
    setState(chatId, { name: 'activate', step: 'ask_goal', data: { id } });
    return bot.editMessageText(md(
      `▶️ Activate\nStripe: ${(link.note||'').trim()||id}\nCurrent revenue: ${fmtMoney(link.currentRevenue)}\nSend new revenue goal`
    ).text, { chat_id: chatId, message_id: q.message.message_id, parse_mode: 'MarkdownV2' });
  }

  // DEACTIVATE
  if (data.startsWith('deactivate:pick:')) {
    const [, , id] = data.split(':');
    await DB.updateLink(id, { active: false });
    clearState(chatId);
    return bot.editMessageText(md(`⏸️ Deactivated\nID: ${id}`).text, {
      chat_id: chatId, message_id: q.message.message_id, parse_mode: 'MarkdownV2'
    });
  }

  // DELETE
  if (data.startsWith('delete:pick:')) {
    const [, , id] = data.split(':');
    setState(chatId, { name: 'delete', step: 'confirm', data: { id } });
    const kb = { inline_keyboard: [[
      { text: 'Yes, delete', callback_data: 'delete:yes' },
      { text: 'Cancel', callback_data: 'delete:no' },
    ]]};
    return bot.editMessageText(md(`🗑️ Delete this link?\nID: ${id}`).text, {
      chat_id: chatId, message_id: q.message.message_id, parse_mode: 'MarkdownV2', reply_markup: kb
    });
  }
  if (data === 'delete:yes') {
    const s = getState(chatId);
    if (!s || s.name !== 'delete') return;
    await DB.deleteLink(s.data.id);
    clearState(chatId);
    return bot.editMessageText(md('🗑️ Deleted').text, {
      chat_id: chatId, message_id: q.message.message_id, parse_mode: 'MarkdownV2'
    });
  }
  if (data === 'delete:no') {
    clearState(chatId);
    return bot.editMessageText(md('Cancelled').text, {
      chat_id: chatId, message_id: q.message.message_id, parse_mode: 'MarkdownV2'
    });
  }

  // REVENUE VIEWER
  if (data.startsWith('revv:pick:')) {
    const [, , id] = data.split(':');
    const link = await DB.getLink(id);
    if (!link) return;
    const tz = link.timezone || 'UTC';
    const kb = {
      inline_keyboard: [[
        { text: 'Today', callback_data: `revv:d:today:${id}` },
        { text: 'Pick date…', callback_data: `revv:d:custom:${id}` },
      ]]
    };
    setState(chatId, { name: 'revenue_view', step: 'date', data: { id, tz } });
    return bot.editMessageText(md(`💸 Revenue for ${(link.note||'').trim()||id}\nChoose a date`).text, {
      chat_id: chatId, message_id: q.message.message_id, parse_mode: 'MarkdownV2', reply_markup: kb
    });
  }
  if (data.startsWith('revv:d:')) {
    const [, , kind, id] = data.split(':');
    const link = await DB.getLink(id);
    if (!link) return;
    const tz = link.timezone || 'UTC';
    if (kind === 'custom') {
      setState(chatId, { name: 'revenue_view', step: 'date_custom', data: { id, tz } });
      return bot.sendMessage(chatId, md('Send date YYYY-MM-DD').text, { parse_mode: 'MarkdownV2' });
    }
    const date = moment().tz(tz).format('YYYY-MM-DD');
    await sendRevenueDay(bot, chatId, link, date, tz);
    clearState(chatId);
    return;
  }

  // EDIT SALES
  if (data.startsWith('esales:pick:')) {
    const [, , id] = data.split(':');
    const link = await DB.getLink(id);
    if (!link) return;
    setState(chatId, { name: 'edit_sales', step: 'mode', data: { id } });
    const kb = { inline_keyboard: [[
      { text: '➕ Add sale', callback_data: 'esales:add' },
      { text: '➖ Remove sale', callback_data: 'esales:remove' },
    ]]};
    return bot.editMessageText(md(`🧰 Edit sales for ${(link.note||'').trim()||id}\nChoose an action`).text, {
      chat_id: chatId, message_id: q.message.message_id, parse_mode: 'MarkdownV2', reply_markup: kb
    });
  }
  if (data === 'esales:add') {
    const s = getState(chatId); if (!s) return;
    s.step = 'add_amount';
    return bot.sendMessage(chatId, md('Send amount to ADD').text, { parse_mode: 'MarkdownV2' });
  }
  if (data === 'esales:remove') {
    const s = getState(chatId); if (!s) return;
    s.step = 'remove_amount';
    return bot.sendMessage(chatId, md('Send amount to REMOVE').text, { parse_mode: 'MarkdownV2' });
  }

  return false;
}

/* helpers */
async function sendRevenueDay(bot, chatId, link, date, tz) {
  const start = moment.tz(date, 'YYYY-MM-DD', tz).startOf('day').toDate();
  const end = moment.tz(date, 'YYYY-MM-DD', tz).endOf('day').toDate();
  const salesAll = await DB.listSales(10000);
  const sales = salesAll.filter(s => String(s.linkId) === String(link._id) && s.at >= start && s.at <= end);
  const sum = sales.reduce((a, s) => a + Number(s.amount || 0), 0);
  const rows = sales.slice(0, 30).map(s =>
    `• ${fmtMoney(s.amount)} — ${moment(s.at).tz(tz).format('HH:mm')}${s.host ? ' — ' + s.host : ''}`
  );
  const out = [
    `💸 Revenue`,
    `Stripe: ${(link.note || '').trim() || link._id}`,
    `Date: ${date}   TZ: ${tz}`,
    `Sales: ${sales.length}   Total: ${fmtMoney(sum)}`,
    ...rows,
    sales.length > 30 ? `+${sales.length - 30} more` : ''
  ].filter(Boolean).join('\n');
  return bot.sendMessage(chatId, md(out).text, { parse_mode: 'MarkdownV2' });
}

/* message handlers for wizard steps */
async function handleHistory(bot, msg) {
  const s = getState(msg.chat.id);
  if (!s || s.name !== 'history') return;
  const text = (msg.text || '').trim();
  const tz = s.data.tz;

  if (s.step === 'custom_from') {
    s.data.from = text;
    s.step = 'custom_to';
    return bot.sendMessage(msg.chat.id, md('Send end date YYYY-MM-DD').text, { parse_mode: 'MarkdownV2' });
  }
  if (s.step === 'custom_to') {
    s.data.to = text;
    const link = await DB.getLink(s.data.id);
    const start = moment.tz(s.data.from, 'YYYY-MM-DD', tz).startOf('day');
    const end   = moment.tz(s.data.to,   'YYYY-MM-DD', tz).endOf('day');
    const body = await buildHistoryText(link, start, end, tz);
    clearState(msg.chat.id);
    return bot.sendMessage(msg.chat.id, md(body).text, { parse_mode: 'MarkdownV2' });
  }
}

async function handleReset(bot, msg) { /* no free-text steps here */ return; }

async function handleCreate(bot, msg) { return module.exports.handleCreate(bot, msg); } // already defined above, but export

async function handleTotals(bot, msg) {
  const s = getState(msg.chat.id);
  if (!s || s.name !== 'totals') return;
  const text = (msg.text || '').trim();

  if (s.step === 'custom_from') {
    s.data = { from: text };
    s.step = 'custom_to';
    return bot.sendMessage(msg.chat.id, md('Send end date YYYY-MM-DD').text, { parse_mode: 'MarkdownV2' });
  }
  if (s.step === 'custom_to') {
    s.data.to = text;
    const tz = 'Europe/Rome';
    const start = moment.tz(s.data.from, 'YYYY-MM-DD', tz).startOf('day');
    const end   = moment.tz(s.data.to,   'YYYY-MM-DD', tz).endOf('day');
    const { total, byHost, tzMap, salesCount } = await computeTotals({ start, end });
    const lines = [];
    lines.push(`${ICONS.chart} Total revenue`);
    lines.push(`Period: ${start.format('YYYY-MM-DD')} → ${end.format('YYYY-MM-DD')}`);
    lines.push(`Sales: ${salesCount}   Total: ${fmtMoney(total)}`);
    lines.push('');
    lines.push('By source (host):');
    const hosts = Object.entries(byHost).sort((a,b)=>b[1]-a[1]).slice(0,12);
    for (const [h, sum] of hosts) lines.push(`• ${h}: ${fmtMoney(sum)}`);
    lines.push('');
    lines.push('By timezone:');
    for (const [tzKey, sum] of Object.entries(tzMap).sort()) lines.push(`• ${tzKey}: ${fmtMoney(sum)}`);
    clearState(msg.chat.id);
    return bot.sendMessage(msg.chat.id, md(lines.join('\n')).text, { parse_mode: 'MarkdownV2' });
  }
}

async function handleRevenueView(bot, msg) {
  const s = getState(msg.chat.id);
  if (!s || s.name !== 'revenue_view') return;
  const text = (msg.text || '').trim();
  if (s.step === 'date_custom') {
    const link = await DB.getLink(s.data.id);
    await sendRevenueDay(bot, msg.chat.id, link, text, s.data.tz);
    clearState(msg.chat.id);
  }
}

async function handleEditSales(bot, msg) {
  const s = getState(msg.chat.id);
  if (!s || s.name !== 'edit_sales') return;
  const text = (msg.text || '').trim();
  const id = s.data.id;

  if (s.step === 'add_amount') {
    const amt = Number(text);
    if (!Number.isFinite(amt) || amt <= 0) return bot.sendMessage(msg.chat.id, md('Send a positive number').text, { parse_mode: 'MarkdownV2' });

    // Create sale, update revenue
    const link = await DB.getLink(id);
await DB.createSale({
  amount: amt,
  host: 'manual',
  linkId: id,
  at: new Date(),
  source: 'manual',
  note: `add ${amt}`,
});


    const prev = Number(link.currentRevenue || 0);
    const newRevenue = prev + amt;
    const updated = await DB.updateLink(id, { currentRevenue: newRevenue });
    await checkMilestonesAndNotify(updated);

    if (prev < Number(updated.targetRevenue) && newRevenue >= Number(updated.targetRevenue)) {
      await completeAndRotate(updated._id, 'manual-add-reach');
    }

    clearState(msg.chat.id);
    return bot.sendMessage(msg.chat.id, md(`➕ Added sale ${fmtMoney(amt)}\nNow: ${fmtMoney(updated.currentRevenue)} / ${fmtMoney(updated.targetRevenue)}`).text, { parse_mode: 'MarkdownV2' });
  }

  if (s.step === 'remove_amount') {
    const amt = Number(text);
    if (!Number.isFinite(amt) || amt <= 0) return bot.sendMessage(msg.chat.id, md('Send a positive number').text, { parse_mode: 'MarkdownV2' });

    // Negative adjustment
    const link = await DB.getLink(id);
await DB.createSale({
  amount: -amt,
  host: 'manual_adjustment',
  linkId: id,
  at: new Date(),
  source: 'adjustment',
  note: `remove ${amt}`,
});

    const prev = Number(link.currentRevenue || 0);
    const newRevenue = prev - amt;
    const updated = await DB.updateLink(id, { currentRevenue: newRevenue });

    // If revenue is now below target and link is inactive → reactivate
    if (!updated.active && Number(updated.currentRevenue) < Number(updated.targetRevenue)) {
      await DB.updateLink(id, { active: true });
      await bot.sendMessage(msg.chat.id, md(`▶️ Auto-reactivated (revenue below target)\nID: ${id}`).text, { parse_mode: 'MarkdownV2' });
    }

    clearState(msg.chat.id);
    return bot.sendMessage(msg.chat.id, md(`➖ Removed ${fmtMoney(amt)}\nNow: ${fmtMoney(updated.currentRevenue)} / ${fmtMoney(updated.targetRevenue)}`).text, { parse_mode: 'MarkdownV2' });
  }
}

module.exports = {
  startCreate, handleCreate,
  startReset, handleReset,
  startHistory, handleHistory,
  startTotals, handleTotals,
  startActivate, startDeactivate, startDelete,
  startRevenueViewer, handleRevenueView,
  startEditStripeSales, handleEditSales,
  onCallback,
  clearState, getState,
};
