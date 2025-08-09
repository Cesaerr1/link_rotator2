// src/routes/track.js
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');

const { DB } = require('../services/store');
const { JWT_SECRET } = require('../config');
const { checkMilestonesAndNotify } = require('../services/milestones');
const { completeAndRotate } = require('../services/rotation');

router.post('/track', async (req, res) => {
  try {
    let { amount, host = '', token = '', lid = '' } = req.body || {};
    amount = Number(amount);

    // Optional JWT verification (lets you sign the amount)
    if (JWT_SECRET && token) {
      try {
        const payload = jwt.verify(token, JWT_SECRET);
        if (payload && payload.amt != null) amount = Number(payload.amt);
      } catch {
        return res.status(401).json({ ok: false, error: 'invalid_token' });
      }
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ ok: false, error: 'invalid_amount' });
    }

    // Resolve which link to credit: lid -> thankYouUrl host match -> first eligible
    let linkToUse = null;
    if (lid) linkToUse = await DB.getLink(lid);

    if (!linkToUse && host) {
      const links = await DB.listLinks();
      const normalizeHost = (u) => { try { return new URL(u).host; } catch { return ''; } };
      const hit = links.find(l => l.thankYouUrl && normalizeHost(l.thankYouUrl) === String(host));
      if (hit) linkToUse = hit;
    }

    if (!linkToUse) linkToUse = await DB.firstEligibleLink();
    if (!linkToUse) return res.status(409).json({ ok: false, error: 'no_active_link' });

    // 1) Ledger write: mark as 'pixel' so reports and manual adjustments add up cleanly
    await DB.createSale({
      amount,
      host: String(host || ''),
      linkId: linkToUse._id,
      at: new Date(),
      source: 'pixel',
      note: 'pixel',
    });

    // 2) Keep the running currentRevenue for rotation/milestones
    const prevRevenue = Number(linkToUse.currentRevenue) || 0;
    const newRevenue = prevRevenue + amount;
    const updated = await DB.updateLink(linkToUse._id, { currentRevenue: newRevenue });

    // 3) Milestones and rotation on crossing target
    await checkMilestonesAndNotify(updated);

    if (prevRevenue < Number(updated.targetRevenue) && newRevenue >= Number(updated.targetRevenue)) {
      await completeAndRotate(updated._id, 'target-reached');
    }

    return res.json({ ok: true, linkId: updated._id, newRevenue });
  } catch (err) {
    console.error('/track error:', err);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

module.exports = router;
