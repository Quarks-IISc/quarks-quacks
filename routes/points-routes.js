const express = require('express');
const crypto = require('crypto');
const QRCode = require('qrcode');
const db = require('../db');
const { requireAuth, requireRole } = require('../auth');

const router = express.Router();

router.post('/', requireAuth, requireRole('superuser', 'admin'), (req, res) => {
  const { team_id, amount, reason } = req.body;
  if (!team_id || amount === undefined) {
    return res.status(400).json({ error: 'team_id and amount required' });
  }

  const pts = parseInt(amount, 10);
  if (isNaN(pts) || pts === 0) return res.status(400).json({ error: 'amount must be a nonzero integer' });

  const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(team_id);
  if (!team) return res.status(404).json({ error: 'Team not found' });
  if (!team.verified) return res.status(400).json({ error: 'Team not verified yet' });

  if (req.user.role === 'admin' && req.user.event_scope) {
    const event = db.prepare('SELECT name FROM events WHERE id = ?').get(req.user.event_scope);
    if (reason && event && !reason.toLowerCase().includes(event.name.toLowerCase())) {
      // Admin can still award, but reason should ideally reference their event
    }
  }

  const txn = db.transaction(() => {
    db.prepare(
      'INSERT INTO point_logs (team_id, points, reason, awarded_by) VALUES (?, ?, ?, ?)'
    ).run(team_id, pts, reason || null, req.user.id);
    db.prepare('UPDATE teams SET points = points + ? WHERE id = ?').run(pts, team_id);
  });

  txn();

  const updated = db.prepare('SELECT points FROM teams WHERE id = ?').get(team_id);
  res.json({ team_id, awarded: pts, total: updated.points });
});

router.get('/leaderboard', (_req, res) => {
  const teams = db.prepare(
    'SELECT id, team_name, points FROM teams WHERE verified = 1 ORDER BY points DESC'
  ).all();
  res.json(teams);
});

router.get('/:teamId', (req, res) => {
  const logs = db.prepare(`
    SELECT pl.*, u.username AS awarded_by_name
    FROM point_logs pl LEFT JOIN users u ON pl.awarded_by = u.id
    WHERE pl.team_id = ? ORDER BY pl.created_at DESC
  `).all(req.params.teamId);
  res.json(logs);
});

// Generate a points QR for a specific team (admin only)
router.post('/qr', requireAuth, requireRole('superuser', 'admin'), async (req, res) => {
  const { team_id, amount, reason } = req.body;
  if (!team_id || !amount) return res.status(400).json({ error: 'team_id and amount required' });

  const pts = parseInt(amount, 10);
  if (isNaN(pts) || pts <= 0) return res.status(400).json({ error: 'amount must be a positive integer' });

  const team = db.prepare('SELECT id, team_name, verified FROM teams WHERE id = ?').get(team_id);
  if (!team) return res.status(404).json({ error: 'Team not found' });
  if (!team.verified) return res.status(400).json({ error: 'Team not verified' });

  const token = crypto.randomBytes(16).toString('hex');
  db.prepare(
    'INSERT INTO point_tokens (token, team_id, amount, reason, created_by) VALUES (?, ?, ?, ?, ?)'
  ).run(token, team_id, pts, reason || null, req.user.id);

  const data = JSON.stringify({ type: 'points', token, team_id: team.id });
  const qr = await QRCode.toDataURL(data, { width: 300, margin: 2 });

  res.json({ token, team_id, team_name: team.team_name, amount: pts, qr });
});

// Claim points via QR token (team scans)
router.post('/claim', (req, res) => {
  const { token, team_id } = req.body;
  if (!token || !team_id) return res.status(400).json({ error: 'token and team_id required' });

  const record = db.prepare('SELECT * FROM point_tokens WHERE token = ?').get(token);
  if (!record) return res.status(404).json({ error: 'Invalid QR code' });
  if (record.claimed) return res.status(400).json({ error: 'This QR has already been used' });
  if (record.team_id !== team_id) return res.status(403).json({ error: 'This QR is not for your team' });

  const txn = db.transaction(() => {
    db.prepare('UPDATE point_tokens SET claimed = 1 WHERE id = ?').run(record.id);
    db.prepare(
      'INSERT INTO point_logs (team_id, points, reason, awarded_by) VALUES (?, ?, ?, ?)'
    ).run(record.team_id, record.amount, record.reason || 'QR Points', record.created_by);
    db.prepare('UPDATE teams SET points = points + ? WHERE id = ?').run(record.amount, record.team_id);
  });

  txn();
  const updated = db.prepare('SELECT points FROM teams WHERE id = ?').get(record.team_id);
  res.json({ ok: true, awarded: record.amount, total: updated.points, reason: record.reason });
});

module.exports = router;
