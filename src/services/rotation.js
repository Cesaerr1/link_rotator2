const { DB } = require('./store');
const { notifyRotation, notifyTargetReached } = require('./notify');

async function completeAndRotate(linkId, reason='target-reached') {
  const link = await DB.getLink(linkId);
  if (!link) return false;
  if (Number(link.currentRevenue) >= Number(link.targetRevenue)) {
    await DB.updateLink(link._id, { active: false });
    await notifyTargetReached(link);
    const next = await DB.firstEligibleLink();
    await notifyRotation({ from: link, to: next || null, reason });
    return true;
  }
  return false;
}

async function rotateIfNeeded(force=false) {
  const current = await DB.firstEligibleLink();
  if (force) {
    if (current) await DB.updateLink(current._id, { active: false });
    const next = await DB.firstEligibleLink();
    await notifyRotation({ from: current || {}, to: next || null, reason: next ? 'manual' : 'manual-no-next' });
    return Boolean(next);
  }
  if (!current) return false;
  if (Number(current.currentRevenue) >= Number(current.targetRevenue)) {
    await DB.updateLink(current._id, { active: false });
    const next = await DB.firstEligibleLink();
    await notifyRotation({ from: current, to: next || null, reason: 'target-reached' });
    return Boolean(next);
  }
  return false;
}

module.exports = { completeAndRotate, rotateIfNeeded };
