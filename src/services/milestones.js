const { DB } = require('./store');
const { notifyMilestone } = require('./notify');

const MILESTONES = [20,50,80];

async function checkMilestonesAndNotify(link) {
  if (!link || !Number.isFinite(link.targetRevenue)) return;
  const base = Number(link.milestoneBaseRevenue || 0);
  const cur  = Number(link.currentRevenue || 0);
  const tgt  = Number(link.targetRevenue || 0);
  const numer = Math.max(0, cur - base);
  const denom = Math.max(1, tgt - base);
  const pctNow = (numer / denom) * 100;
  const already = new Set(link.milestonesNotified || []);
  const toNotify = MILESTONES.filter(m => pctNow >= m && !already.has(m));
  if (!toNotify.length) return;
  const updated = await DB.updateLink(link._id, { milestonesNotified: [...new Set([...(link.milestonesNotified||[]), ...toNotify])] });
  for (const m of toNotify) await notifyMilestone(updated, m);
}

module.exports = { checkMilestonesAndNotify, MILESTONES };
