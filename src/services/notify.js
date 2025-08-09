const { escapeMdV2 } = require('../utils/mdv2');
const { fmtMoney } = require('../utils/money');

let bot = null;
let chatId = null;
const ICONS = {
  target: '🎯', cash: '💸', rotate: '🔁', bell: '🔔'
};

function attach(botInstance, allowedChatId) { bot = botInstance; chatId = allowedChatId; }
function md(t){ return { text: escapeMdV2(t), opts: { parse_mode:'MarkdownV2' } }; }

async function notifyRotation({ from, to, reason }) {
  if (!bot || !chatId) return;
  const lines =
`${ICONS.rotate} *Rotation Triggered*
Reason: \`${reason}\`
From: \`${from?._id || '-'}\`  ${ICONS.cash} ${fmtMoney(from?.currentRevenue)}/${fmtMoney(from?.targetRevenue)}
To:   \`${to?._id || '-'}\`${to ? `  ${ICONS.target} ${fmtMoney(to.targetRevenue)}` : ''}`;
  const { text, opts } = md(lines);
  bot.sendMessage(chatId, text, opts);
}

async function notifyTargetReached(link) {
  if (!bot || !chatId) return;
  const text =
`${ICONS.target} *Target Reached*
Link: \`${link._id}\`
Revenue: *${fmtMoney(link.currentRevenue)}* / *${fmtMoney(link.targetRevenue)}*`;
  const { text: t, opts } = md(text);
  bot.sendMessage(chatId, t, opts);
}

async function notifyMilestone(link, m) {
  if (!bot || !chatId) return;
  const text =
`${ICONS.bell} *Milestone*
Link: \`${link._id}\`
Progress since goal set: *${m}%*
Rev: *${fmtMoney(link.currentRevenue)}* / *${fmtMoney(link.targetRevenue)}*`;
  const { text: t, opts } = md(text);
  bot.sendMessage(chatId, t, opts);
}

module.exports = { attach, notifyRotation, notifyTargetReached, notifyMilestone };
