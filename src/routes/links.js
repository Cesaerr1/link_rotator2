const router = require('express').Router();
const { DB } = require('../services/store');
const { rotateIfNeeded } = require('../services/rotation');

router.post('/', async (req, res) => {
  try {
    const { url, thankYouUrl = '', note = '', targetRevenue, timezone = 'UTC', active = true } = req.body || {};
    if (!url || !Number.isFinite(Number(targetRevenue))) {
      return res.status(400).json({ ok: false, error: 'invalid_payload' });
    }
    const doc = await DB.createLink({
      url, thankYouUrl, note,
      targetRevenue: Number(targetRevenue),
      currentRevenue: 0,
      timezone,
      active: Boolean(active),
    });
    res.json({ ok: true, link: doc });
  } catch {
    res.status(500).json({ ok: false, error: 'server_error' });
  }
});

router.get('/', async (_req, res) => res.json({ ok: true, links: await DB.listLinks() }));

router.patch('/:id', async (req, res) => {
  const id = req.params.id;
  const patch = { ...req.body };
  if (patch.targetRevenue != null) patch.targetRevenue = Number(patch.targetRevenue);
  if (patch.currentRevenue != null) patch.currentRevenue = Number(patch.currentRevenue);
  if (patch.active != null) patch.active = Boolean(patch.active);
  const updated = await DB.updateLink(id, patch);
  if (!updated) return res.status(404).json({ ok: false, error: 'not_found' });
  res.json({ ok: true, link: updated });
});

router.delete('/:id', async (req, res) => {
  const count = await DB.deleteLink(req.params.id);
  if (!count) return res.status(404).json({ ok: false, error: 'not_found' });
  res.json({ ok: true, deleted: req.params.id });
});

router.post('/rotate', async (_req, res) => res.json({ ok: await rotateIfNeeded(true) }));

module.exports = router;
