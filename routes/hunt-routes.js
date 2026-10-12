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
    const stream = Readable.fromWeb(r.body);
    // A dropped connection (e.g. hunt server reload) must not crash the whole server.
    stream.on('error', (err) => {
      console.error('[HUNT] photo stream error:', err.message);
      if (!res.headersSent) res.status(502);
      res.end();
    });
    stream.pipe(res);
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

router.post('/pass', requireAuth, requireHuntAdmin, async (req, res) => {
  const team_name = String(req.body.team_name || '').trim();
  if (!team_name) return res.status(400).json({ error: 'team_name required' });
  try {
    const r = await fetch(HUNT_URL + '/internal/pass', {
      method: 'POST',
      headers: { 'X-Api-Key': INTERNAL_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ team_name, by: req.user.username, image_base64: req.body.image_base64 })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(r.status).json({ error: data.detail || 'Pass failed' });
    console.log('[HUNT] ' + req.user.username + ' passed clue ' + data.quest_id + ' for "' + team_name + '"');
    res.json(data);
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
