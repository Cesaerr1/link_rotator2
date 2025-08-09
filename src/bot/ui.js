// src/bot/ui.js
const { escapeMdV2 } = require('../utils/mdv2');
const { fmtMoney } = require('../utils/money');
const { moment } = require('../utils/time');

const ICONS = {
  ok: '✅', warn: '⚠️', x: '❌', info: 'ℹ️', link: '🔗', note: '📝', cash: '💸',
  target: '🎯', tz: '🕒', card: '🧾', list: '📋', status: '📊', add: '➕',
  edit: '✏️', del: '🗑️', off: '⏸️', on: '▶️', rotate: '🔁', bell: '🔔',
  chart: '📈', calendar: '🗓️', globe: '🌐', toolbox: '🧰',
};

// MarkdownV2-safe but we keep copy light (no heavy * `)
const md = (t) => ({ text: escapeMdV2(t), opts: { parse_mode: 'MarkdownV2' } });

const pct = (c, t) => {
  const C = Number(c) || 0;
  const T = Math.max(1, Number(t) || 0);
  return Math.min(100, (C / T) * 100).toFixed(0);
};

const hostOf = (u) => { try { return new URL(u).host; } catch { return ''; } };

// Main “card”
function linkCardText(l, idx = null, total = null) {
  const I = ICONS;
  const z = l.timezone || 'UTC';
  const local = moment().tz(z).format('YYYY-MM-DD HH:mm z');
  const header = idx != null ? `${I.card} Link ${idx}/${total}` : `${I.card} Link`;
  const name = (l.note || '').trim() || '—';
  const progress = pct(l.currentRevenue, l.targetRevenue);
  const urlHost = hostOf(l.url) || l.url;

  return (
`${header}
${I.note} Stripe: ${name}
${I.link} URL: ${urlHost}
${I.cash} Revenue: ${fmtMoney(l.currentRevenue)} / ${fmtMoney(l.targetRevenue)}  (${progress}%)
${I.tz} TZ: ${z}   Local: ${local}
ID: ${l._id}
State: ${l.active ? I.on+' Active' : I.off+' Inactive'}`
  );
}

// Compact row (paged /all_links)
function linkRow(l, n) {
  const I = ICONS;
  const name = (l.note || '').trim() || '—';
  const progress = pct(l.currentRevenue, l.targetRevenue);
  const urlHost = hostOf(l.url) || l.url;
  const idShort = String(l._id).slice(-6);
  return (
`${n}. ${l.active ? I.on : I.off} ${name}
   ${I.cash} ${fmtMoney(l.currentRevenue)} / ${fmtMoney(l.targetRevenue)}  (${progress}%)
   ${I.link} ${urlHost}   ·   id:${idShort}`
  );
}

/* ---- Notification formatters (used elsewhere if needed) ---- */

function fmtRotation(from, to, reason) {
  const I = ICONS;
  return `${I.rotate} Rotation
From: ${from?._id || '-'}  ${I.cash} ${fmtMoney(from?.currentRevenue)}/${fmtMoney(from?.targetRevenue)}
To:   ${to?._id || '-'}
Reason: ${reason}`;
}

function fmtTargetReached(link) {
  const I = ICONS;
  return `${I.target} Target reached
Link: ${link._id}
Revenue: ${fmtMoney(link.currentRevenue)} / ${fmtMoney(link.targetRevenue)}`;
}

function fmtMilestone(link, m) {
  const I = ICONS;
  return `${I.bell} Milestone ${m}%
Link: ${link._id}
Revenue: ${fmtMoney(link.currentRevenue)} / ${fmtMoney(link.targetRevenue)}`;
}

function fmtSaleOnDifferentLink(link, activeId) {
  const I = ICONS;
  return `${I.warn} Sale credited to non-active link
Link: ${link._id} (active is ${activeId || '-'})
Now: ${fmtMoney(link.currentRevenue)} / ${fmtMoney(link.targetRevenue)}`;
}

function fmtMidnightRecap(link, dateStr, total, count, aov) {
  const I = ICONS;
  const name = (link.note || '').trim() || '-';
  const tz = link.timezone || 'UTC';
  return `${I.calendar} End-of-Day Recap
Stripe: ${name}
Date: ${dateStr}   TZ: ${tz}
Sales: ${count}   Total: ${fmtMoney(total)}   AOV: ${fmtMoney(aov)}`;
}

function fmtHealthDisconnected() {
  return `⚠️ Health
Bot or DB connection issue detected.`;
}
function fmtHealthReconnected() {
  return `✅ Health
Connections restored.`;
}

module.exports = {
  ICONS, md, pct, linkCardText, linkRow,
  fmtRotation, fmtTargetReached, fmtMilestone,
  fmtSaleOnDifferentLink, fmtMidnightRecap,
  fmtHealthDisconnected, fmtHealthReconnected,
};
