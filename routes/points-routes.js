const express = require('express');
const crypto = require('crypto');
const QRCode = require('qrcode');
const db = require('../db');
const { requireAuth, requireRole } = require('../auth');

const router = express.Router();

router.post('/', requireAuth, requireRole('superuser', 'admin'), (req, res) => {
  const { team_id, amount, reason, event_id, placement } = req.body;
  if (!team_id || amount === undefined) {
    return res.status(400).json({ error: 'team_id and amount required' });
  }

  const pts = parseInt(amount, 10);
  if (isNaN(pts) || pts === 0 || pts < -5000 || pts > 5000) return res.status(400).json({ error: 'amount must be between -5000 and 5000' });

  const team = db.get('teams', team_id);
  if (!team) return res.status(404).json({ error: 'Team not found' });
  if (!team.verified) return res.status(400).json({ error: 'Team not verified yet' });

  const logEntry = {
    team_id, points: pts, reason: reason || null, awarded_by: req.user.id, created_at: db.now()
  };
  if (event_id) logEntry.event_id = parseInt(event_id);
  if (placement) logEntry.placement = placement;

  db.insert('point_logs', logEntry);
  db.update('teams', team_id, { points: team.points + pts });

  const label = pts > 0 ? 'Awarded: +' + pts : 'Deducted: ' + pts;
  const event = event_id ? db.get('events', parseInt(event_id)) : null;
  console.log('[POINTS] ' + label + ' to "' + team.team_name + '"' +
    (event ? ' for "' + event.name + '"' : '') +
    (placement ? ' (' + placement + ')' : '') +
    ' reason: "' + (reason || '') + '" by ' + req.user.username);

  const updated = db.get('teams', team_id);
  res.json({ team_id, awarded: pts, total: updated.points });
});

router.get('/leaderboard', (_req, res) => {
  const teams = db.find('teams', t => t.verified === 1)
    .sort((a, b) => b.points - a.points)
    .map(t => ({ id: t.id, team_name: t.team_name, points: t.points }));
  res.json(teams);
});

router.get('/recent', (_req, res) => {
  const logs = db.all('point_logs')
    .sort((a, b) => b.id - a.id)
    .slice(0, 50)
    .map(l => {
      const team = db.get('teams', l.team_id);
      return { points: l.points, reason: l.reason, created_at: l.created_at, team_name: team ? team.team_name : 'Unknown' };
    });
  res.json(logs);
});

router.get('/:teamId', (req, res) => {
  const teamId = parseInt(req.params.teamId);
  const logs = db.find('point_logs', l => l.team_id === teamId)
    .sort((a, b) => b.id - a.id)
    .map(l => {
      const awarder = l.awarded_by ? db.get('users', l.awarded_by) : null;
      return { ...l, awarded_by_name: awarder ? awarder.username : null };
    });
  res.json(logs);
});

router.post('/qr', requireAuth, requireRole('superuser', 'admin'), async (req, res) => {
  const { team_id, amount, reason } = req.body;
  if (!team_id || !amount) return res.status(400).json({ error: 'team_id and amount required' });

  const pts = parseInt(amount, 10);
  if (isNaN(pts) || pts <= 0) return res.status(400).json({ error: 'amount must be a positive integer' });

  const team = db.get('teams', team_id);
  if (!team) return res.status(404).json({ error: 'Team not found' });
  if (!team.verified) return res.status(400).json({ error: 'Team not verified' });

  const token = crypto.randomBytes(16).toString('hex');
  db.insert('point_tokens', {
    token, team_id, amount: pts, reason: reason || null, created_by: req.user.id, claimed: 0, created_at: db.now()
  });

  const data = JSON.stringify({ type: 'points', token, team_id: team.id });
  const qr = await QRCode.toDataURL(data, { width: 300, margin: 2 });

  res.json({ token, team_id, team_name: team.team_name, amount: pts, qr });
});

router.post('/claim', (req, res) => {
  const { token, team_id } = req.body;
  if (!token || !team_id) return res.status(400).json({ error: 'token and team_id required' });

  const record = db.findOne('point_tokens', r => r.token === token);
  if (!record) return res.status(404).json({ error: 'Invalid QR code' });
  if (record.claimed) return res.status(400).json({ error: 'This QR has already been used' });
  if (record.team_id !== team_id) return res.status(403).json({ error: 'This QR is not for your team' });

  db.update('point_tokens', record.id, { claimed: 1 });
  db.insert('point_logs', {
    team_id: record.team_id, points: record.amount, reason: record.reason || 'QR Points',
    awarded_by: record.created_by, created_at: db.now()
  });
  const team = db.get('teams', record.team_id);
  db.update('teams', record.team_id, { points: team.points + record.amount });

  const updated = db.get('teams', record.team_id);
  res.json({ ok: true, awarded: record.amount, total: updated.points, reason: record.reason });
});

const INTERNAL_KEY = process.env.INTERNAL_API_KEY || 'quarks-internal-2026';

router.post('/internal/award', (req, res) => {
  const authHeader = req.headers['x-api-key'];
  if (authHeader !== INTERNAL_KEY) return res.status(403).json({ error: 'Forbidden' });

  const { team_name, amount, reason, event_id } = req.body;
  if (!team_name || !amount) return res.status(400).json({ error: 'team_name and amount required' });

  const pts = parseInt(amount, 10);
  if (isNaN(pts) || pts === 0) return res.status(400).json({ error: 'Invalid amount' });

  const team = db.findOne('teams', t => t.team_name.toLowerCase() === team_name.toLowerCase());
  if (!team) return res.status(404).json({ error: 'Team not found' });

  const logEntry = {
    team_id: team.id, points: pts, reason: reason || 'Treasure Hunt',
    awarded_by: null, created_at: db.now()
  };
  if (event_id) logEntry.event_id = parseInt(event_id);
  db.insert('point_logs', logEntry);
  db.update('teams', team.id, { points: team.points + pts });

  console.log('[POINTS-INTERNAL] +' + pts + ' to "' + team.team_name + '" reason: "' + (reason || '') + '"');
  res.json({ ok: true, team_id: team.id, awarded: pts, total: team.points + pts });
});

module.exports = router;
