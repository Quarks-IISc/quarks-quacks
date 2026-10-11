const express = require('express');
const { Readable } = require('stream');
const db = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();
const HUNT_URL = 'http://127.0.0.1:' + (process.env.HUNT_PORT || 8000);
const INTERNAL_KEY = process.env.INTERNAL_API_KEY || 'quarks-internal-2026';
const HUNT_EVENT_NAME = 'Duck Duck Loot';

function requireHuntAdmin(req, res, next) {
  if (req.user.role === 'superuser') return next();
  if (req.user.role === 'admin') {
    const ev = db.findOne('events', e => e.name === HUNT_EVENT_NAME);
    const scope = Array.isArray(req.user.event_scope) ? req.user.event_scope : [];
    if (ev && scope.includes(ev.id)) return next();
  }
  return res.status(403).json({ error: 'Forbidden' });
}

function huntFetch(p) {
  return fetch(HUNT_URL + p, { headers: { 'X-Api-Key': INTERNAL_KEY } });
}

router.get('/photos', requireAuth, requireHuntAdmin, async (_req, res) => {
  try {
    const r = await huntFetch('/internal/photos');
    res.status(r.status).json(await r.json());
  } catch (e) {
    res.status(502).json({ error: 'Treasure hunt server unavailable' });
  }
});

router.get('/photos/:filename', requireAuth, requireHuntAdmin, async (req, res) => {
  const name = req.params.filename;
  if (!/^[\w.-]+$/.test(name)) return res.status(400).json({ error: 'Bad filename' });
  try {
    const r = await huntFetch('/internal/photos/' + encodeURIComponent(name));
    res.status(r.status);
    const ct = r.headers.get('content-type');
    if (ct) res.set('Content-Type', ct);
    if (!r.body) return res.end();
    Readable.fromWeb(r.body).pipe(res);
  } catch (e) {
    res.status(502).json({ error: 'Treasure hunt server unavailable' });
  }
});

router.get('/progress', requireAuth, requireHuntAdmin, async (_req, res) => {
  try {
    const r = await huntFetch('/internal/progress');
    res.status(r.status).json(await r.json());
  } catch (e) {
    res.status(502).json({ error: 'Treasure hunt server unavailable' });
  }
});

router.get('/leaderboard', async (_req, res) => {
  try {
    const r = await huntFetch('/internal/leaderboard');
    res.status(r.status).json(await r.json());
  } catch (e) {
    res.status(502).json({ error: 'Treasure hunt server unavailable' });
  }
});

module.exports = router;
