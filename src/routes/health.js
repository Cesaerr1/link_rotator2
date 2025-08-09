const router = require('express').Router();
const mongoose = require('mongoose');
const { nowISO } = require('../utils/time');
const { DB, useMemory } = require('../services/store');

router.get('/', async (_req, res) => {
  const current = await DB.firstEligibleLink();
  res.json({
    ok: true,
    mode: useMemory() ? 'memory' : 'mongo',
    mongoState: mongoose.connection.readyState,
    time: nowISO(),
    current: current ? {
      id: current._id, url: current.url, note: current.note,
      targetRevenue: current.targetRevenue, currentRevenue: current.currentRevenue,
      timezone: current.timezone, active: current.active,
    } : null,
  });
});

module.exports = router;
