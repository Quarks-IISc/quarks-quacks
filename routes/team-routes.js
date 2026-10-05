const express = require('express');
const bcrypt = require('bcryptjs');
const QRCode = require('qrcode');
const db = require('../db');
const { requireAuth, requireRole } = require('../auth');
const { sendOtp } = require('../mailer');

const router = express.Router();

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

router.post('/', (req, res) => {
  const { team_name, members } = req.body;
  if (!team_name || !Array.isArray(members) || members.length < 1 || members.length > 3) {
    return res.status(400).json({ error: 'team_name and 1-3 members required' });
  }

  const hasEmail = members.some(m => m.email);
  if (!hasEmail) return res.status(400).json({ error: 'At least one member must have an email' });

  const captain = members.find(m => m.is_captain) || members.find(m => m.email) || members[0];
  if (!captain.email) return res.status(400).json({ error: 'Captain must have an email' });

  const exists = db.prepare('SELECT id FROM teams WHERE team_name = ?').get(team_name);
  if (exists) return res.status(409).json({ error: 'Team name already taken' });

  const otp = generateOtp();
  const otpHash = bcrypt.hashSync(otp, 10);
  const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  const insertTeam = db.prepare('INSERT INTO teams (team_name) VALUES (?)');
  const insertMember = db.prepare(
    'INSERT INTO team_members (team_id, name, email, dept, is_captain) VALUES (?, ?, ?, ?, ?)'
  );
  const insertOtp = db.prepare(
    'INSERT INTO otps (email, otp_hash, expires_at) VALUES (?, ?, ?)'
  );

  const txn = db.transaction(() => {
    const { lastInsertRowid: teamId } = insertTeam.run(team_name);
    for (const m of members) {
      insertMember.run(teamId, m.name, m.email || null, m.dept || null, m === captain ? 1 : 0);
    }
    insertOtp.run(captain.email, otpHash, expires);
    return teamId;
  });

  const teamId = txn();

  sendOtp(captain.email, otp, team_name).catch(err => {
    console.error('Failed to send OTP email:', err.message);
  });

  res.status(201).json({
    id: teamId,
    team_name,
    otp_email: captain.email,
    message: 'A verification code has been sent to ' + captain.email
  });
});

router.post('/verify', (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) return res.status(400).json({ error: 'email and otp required' });

  const record = db.prepare(
    'SELECT * FROM otps WHERE email = ? AND used = 0 ORDER BY id DESC LIMIT 1'
  ).get(email);

  if (!record) return res.status(400).json({ error: 'No pending OTP for this email' });
  if (new Date(record.expires_at) < new Date()) {
    return res.status(400).json({ error: 'OTP expired' });
  }
  if (!bcrypt.compareSync(otp, record.otp_hash)) {
    return res.status(400).json({ error: 'Invalid OTP' });
  }

  const member = db.prepare(
    'SELECT team_id FROM team_members WHERE email = ? AND is_captain = 1'
  ).get(email);
  if (!member) return res.status(400).json({ error: 'No team found for this email' });

  db.prepare('UPDATE otps SET used = 1 WHERE id = ?').run(record.id);
  db.prepare('UPDATE teams SET verified = 1 WHERE id = ?').run(member.team_id);

  res.json({ ok: true, team_id: member.team_id });
});

// Team lookup (public — for "team login")
router.post('/lookup', (req, res) => {
  const { team_name } = req.body;
  if (!team_name) return res.status(400).json({ error: 'team_name required' });

  const team = db.prepare('SELECT id, team_name, points, verified FROM teams WHERE team_name = ?').get(team_name);
  if (!team) return res.status(404).json({ error: 'Team not found' });
  if (!team.verified) return res.status(400).json({ error: 'Team not verified yet — visit the Quarks Post Office first' });

  res.json(team);
});

// Team name search for autocomplete (admin only)
router.get('/search', requireAuth, requireRole('superuser', 'admin'), (req, res) => {
  const q = req.query.q || '';
  if (q.length < 1) return res.json([]);
  const teams = db.prepare(
    'SELECT id, team_name, verified FROM teams WHERE team_name LIKE ? ORDER BY team_name LIMIT 10'
  ).all('%' + q + '%');
  res.json(teams);
});

router.get('/', requireAuth, requireRole('superuser', 'admin'), (_req, res) => {
  const teams = db.prepare('SELECT * FROM teams ORDER BY points DESC').all();
  const allMembers = db.prepare('SELECT * FROM team_members').all();
  const byTeam = {};
  for (const m of allMembers) {
    if (!byTeam[m.team_id]) byTeam[m.team_id] = [];
    byTeam[m.team_id].push(m);
  }
  res.json(teams.map(t => ({ ...t, members: byTeam[t.id] || [] })));
});

router.get('/:id', requireAuth, (req, res) => {
  const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(req.params.id);
  if (!team) return res.status(404).json({ error: 'Team not found' });

  const members = db.prepare('SELECT * FROM team_members WHERE team_id = ?').all(team.id);
  const logs = db.prepare(`
    SELECT pl.*, u.username AS awarded_by_name
    FROM point_logs pl LEFT JOIN users u ON pl.awarded_by = u.id
    WHERE pl.team_id = ? ORDER BY pl.created_at DESC
  `).all(team.id);

  res.json({ ...team, members, point_logs: logs });
});

// Event registrations for a team
router.get('/:id/events', (req, res) => {
  const regs = db.prepare(`
    SELECT er.event_id, e.name AS event_name, er.created_at
    FROM event_registrations er JOIN events e ON er.event_id = e.id
    WHERE er.team_id = ? ORDER BY e.name
  `).all(req.params.id);
  res.json(regs);
});

router.post('/:id/events', (req, res) => {
  const { event_id } = req.body;
  if (!event_id) return res.status(400).json({ error: 'event_id required' });

  const team = db.prepare('SELECT id, verified FROM teams WHERE id = ?').get(req.params.id);
  if (!team) return res.status(404).json({ error: 'Team not found' });
  if (!team.verified) return res.status(400).json({ error: 'Team not verified yet' });

  const event = db.prepare('SELECT id, name FROM events WHERE id = ?').get(event_id);
  if (!event) return res.status(404).json({ error: 'Event not found' });

  const existing = db.prepare('SELECT id FROM event_registrations WHERE team_id = ? AND event_id = ?').get(team.id, event_id);
  if (existing) return res.status(409).json({ error: 'Already registered for this event' });

  db.prepare('INSERT INTO event_registrations (team_id, event_id) VALUES (?, ?)').run(team.id, event_id);
  res.status(201).json({ ok: true, event_name: event.name });
});

router.delete('/:id/events/:eventId', (req, res) => {
  const result = db.prepare('DELETE FROM event_registrations WHERE team_id = ? AND event_id = ?')
    .run(req.params.id, req.params.eventId);
  if (result.changes === 0) return res.status(404).json({ error: 'Registration not found' });
  res.json({ ok: true });
});

router.get('/:id/qr', async (req, res) => {
  const team = db.prepare('SELECT id, team_name FROM teams WHERE id = ?').get(req.params.id);
  if (!team) return res.status(404).json({ error: 'Team not found' });

  const data = JSON.stringify({ team_id: team.id, team_name: team.team_name });
  const qr = await QRCode.toDataURL(data, { width: 300, margin: 2 });
  res.json({ team_id: team.id, team_name: team.team_name, qr });
});

module.exports = router;
