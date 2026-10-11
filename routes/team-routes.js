const express = require('express');
const bcrypt = require('bcryptjs');
const QRCode = require('qrcode');
const db = require('../db');
const { requireAuth, requireRole, signTeamToken } = require('../auth');
const { sendOtp } = require('../mailer');

const router = express.Router();

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

router.post('/', (req, res) => {
  const { team_name, password, members } = req.body;
  if (!team_name || !password || !Array.isArray(members) || members.length < 1 || members.length > 3) {
    return res.status(400).json({ error: 'team_name, password, and 1-3 members required' });
  }
  if (password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });

  const hasEmail = members.some(m => m.email);
  if (!hasEmail) return res.status(400).json({ error: 'At least one member must have an email' });

  const captain = members.find(m => m.is_captain) || members.find(m => m.email) || members[0];
  if (!captain.email) return res.status(400).json({ error: 'Point of Contact must have an email' });

  const exists = db.findOne('teams', t => t.team_name.toLowerCase() === String(team_name).trim().toLowerCase());
  if (exists) return res.status(409).json({ error: 'Team name already taken' });

  const passwordHash = bcrypt.hashSync(password, 10);

  const { id: teamId } = db.insert('teams', {
    team_name, password_hash: passwordHash, points: 100, created_at: db.now(), verified: 1
  });

  db.insert('point_logs', {
    team_id: teamId, points: 100, reason: 'Welcome to Quarks Quacks!', awarded_by: null, created_at: db.now()
  });

  for (const m of members) {
    db.insert('team_members', {
      team_id: teamId, name: m.name, email: m.email || null, dept: m.dept || null, is_captain: m === captain ? 1 : 0
    });
  }

  // No email OTP: teams are verified on registration.
  console.log('[TEAM] Registered: "' + team_name + '" (id: ' + teamId + ')');

  res.status(201).json({
    id: teamId,
    team_name,
    message: 'Team registered! You can log in now.'
  });
});

router.post('/verify', (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) return res.status(400).json({ error: 'email and otp required' });

  const records = db.find('otps', r => r.email === email && r.used === 0);
  const record = records.length ? records[records.length - 1] : null;

  if (!record) return res.status(400).json({ error: 'No pending OTP for this email' });
  if (new Date(record.expires_at) < new Date()) {
    return res.status(400).json({ error: 'OTP expired' });
  }
  if (!bcrypt.compareSync(otp, record.otp_hash)) {
    return res.status(400).json({ error: 'Invalid OTP' });
  }

  const member = db.findOne('team_members', m => m.email === email && m.is_captain === 1);
  if (!member) return res.status(400).json({ error: 'No team found for this email' });

  db.update('otps', record.id, { used: 1 });
  db.update('teams', member.team_id, { verified: 1 });

  const team = db.get('teams', member.team_id);
  console.log('[TEAM] Verified: "' + (team ? team.team_name : member.team_id) + '"');

  res.json({ ok: true, team_id: member.team_id });
});

router.post('/login', (req, res) => {
  const team_name = String(req.body.team_name || '').trim();
  const password = String(req.body.password || '');
  if (!team_name || !password) return res.status(400).json({ error: 'Team name and password required' });

  const team = db.findOne('teams', t => t.team_name.toLowerCase() === team_name.toLowerCase());
  if (!team) return res.status(404).json({ error: 'Team not found' });
  if (!team.password_hash || !(bcrypt.compareSync(password, team.password_hash) || bcrypt.compareSync(password.trim(), team.password_hash))) {
    return res.status(401).json({ error: 'Incorrect password' });
  }

  const token = signTeamToken(team);
  res.cookie('token', token, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000, sameSite: 'lax' });
  console.log('[TEAM] Login: "' + team.team_name + '"');
  res.json({ id: team.id, team_name: team.team_name, points: team.points, verified: team.verified });
});

router.post('/forgot-password', (req, res) => {
  const { team_name } = req.body;
  if (!team_name) return res.status(400).json({ error: 'team_name required' });

  const team = db.findOne('teams', t => t.team_name === team_name);
  if (!team) return res.status(404).json({ error: 'Team not found' });

  const captain = db.findOne('team_members', m => m.team_id === team.id && m.is_captain === 1);
  if (!captain || !captain.email) return res.status(400).json({ error: 'No captain email on file' });

  const otp = generateOtp();
  const otpHash = bcrypt.hashSync(otp, 10);
  const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  db.insert('otps', { email: captain.email, otp_hash: otpHash, expires_at: expires, used: 0 });

  sendOtp(captain.email, otp, team.team_name).catch(err => {
    console.error('Failed to send reset OTP:', err.message);
  });
  console.log('[OTP] Sent to', captain.email, 'for team "' + team.team_name + '"');

  res.json({ ok: true, email: captain.email });
});

router.post('/reset-password', (req, res) => {
  const { email, otp, new_password } = req.body;
  if (!email || !otp || !new_password) return res.status(400).json({ error: 'email, otp, and new_password required' });
  if (new_password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });

  const records = db.find('otps', r => r.email === email && r.used === 0);
  const record = records.length ? records[records.length - 1] : null;
  if (!record) return res.status(400).json({ error: 'No pending OTP' });
  if (new Date(record.expires_at) < new Date()) return res.status(400).json({ error: 'OTP expired' });
  if (!bcrypt.compareSync(otp, record.otp_hash)) return res.status(400).json({ error: 'Invalid OTP' });

  const member = db.findOne('team_members', m => m.email === email && m.is_captain === 1);
  if (!member) return res.status(400).json({ error: 'No team found for this email' });

  const hash = bcrypt.hashSync(new_password, 10);
  db.update('otps', record.id, { used: 1 });
  db.update('teams', member.team_id, { password_hash: hash });

  const team = db.get('teams', member.team_id);
  console.log('[PASSWORD] Reset for team "' + (team ? team.team_name : member.team_id) + '"');

  res.json({ ok: true });
});

router.get('/search', requireAuth, requireRole('superuser', 'admin'), (req, res) => {
  const q = (req.query.q || '').toLowerCase();
  if (q.length < 1) return res.json([]);
  const teams = db.find('teams', t => t.team_name.toLowerCase().includes(q))
    .slice(0, 10)
    .map(t => ({ id: t.id, team_name: t.team_name, verified: t.verified }));
  res.json(teams);
});

router.get('/', requireAuth, requireRole('superuser', 'admin'), (req, res) => {
  const teams = db.all('teams').sort((a, b) => b.points - a.points);
  const allMembers = db.all('team_members');
  const byTeam = {};
  for (const m of allMembers) {
    if (!byTeam[m.team_id]) byTeam[m.team_id] = [];
    byTeam[m.team_id].push(m);
  }
  const enriched = teams.map(t => ({ ...t, members: byTeam[t.id] || [] }));

  const scopes = Array.isArray(req.user.event_scope) ? req.user.event_scope : req.user.event_scope ? [req.user.event_scope] : [];
  if (req.user.role === 'superuser' || !scopes.length) {
    return res.json(enriched);
  }

  const regs = db.all('event_registrations');
  const grouped = {};
  for (const eid of scopes) {
    const ev = db.get('events', eid);
    const teamIds = new Set(regs.filter(r => r.event_id === eid).map(r => r.team_id));
    grouped[eid] = {
      event_name: ev ? ev.name : 'Event ' + eid,
      teams: enriched.filter(t => teamIds.has(t.id))
    };
  }
  res.json({ grouped });
});

router.get('/schedule', (_req, res) => {
  res.json(SCHEDULE);
});

router.get('/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id);
  if (req.user.role === 'team' && req.user.team_id !== id) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const team = db.get('teams', id);
  if (!team) return res.status(404).json({ error: 'Team not found' });

  const members = db.find('team_members', m => m.team_id === team.id);
  const logs = db.find('point_logs', l => l.team_id === team.id)
    .sort((a, b) => b.id - a.id)
    .map(l => {
      const awarder = l.awarded_by ? db.get('users', l.awarded_by) : null;
      return { ...l, awarded_by_name: awarder ? awarder.username : null };
    });

  res.json({
    id: team.id, team_name: team.team_name, points: team.points,
    verified: team.verified, created_at: team.created_at,
    members, point_logs: logs
  });
});

router.post('/:id/password', requireAuth, requireRole('superuser', 'admin'), (req, res) => {
  const team = db.get('teams', parseInt(req.params.id));
  if (!team) return res.status(404).json({ error: 'Team not found' });
  const pw = String(req.body.password || '');
  if (pw.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });
  db.update('teams', team.id, { password_hash: bcrypt.hashSync(pw, 10) });
  console.log('[PASSWORD] Reset for team "' + team.team_name + '" by ' + req.user.username);
  res.json({ ok: true });
});

router.patch('/:id', requireAuth, requireRole('superuser'), (req, res) => {
  const id = parseInt(req.params.id);
  const team = db.get('teams', id);
  if (!team) return res.status(404).json({ error: 'Team not found' });

  const allowed = ['team_name', 'points', 'verified'];
  const changes = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) changes[key] = req.body[key];
  }
  if (changes.points !== undefined) changes.points = parseInt(changes.points, 10);
  if (changes.verified !== undefined) changes.verified = changes.verified ? 1 : 0;

  db.update('teams', id, changes);
  console.log('[TEAM] Updated by superuser: "' + (changes.team_name || team.team_name) + '" changes:', JSON.stringify(changes));
  res.json({ ok: true, ...db.get('teams', id) });
});

router.patch('/:id/members/:memberId', requireAuth, requireRole('superuser'), (req, res) => {
  const memberId = parseInt(req.params.memberId);
  const member = db.get('team_members', memberId);
  if (!member) return res.status(404).json({ error: 'Member not found' });

  const allowed = ['name', 'email', 'dept', 'is_captain'];
  const changes = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) changes[key] = req.body[key];
  }
  if (changes.is_captain !== undefined) changes.is_captain = changes.is_captain ? 1 : 0;

  db.update('team_members', memberId, changes);
  console.log('[TEAM] Member updated by superuser: member ' + memberId + ' changes:', JSON.stringify(changes));
  res.json({ ok: true });
});

router.delete('/:id/logs/:logId', requireAuth, requireRole('superuser'), (req, res) => {
  const logId = parseInt(req.params.logId);
  const log = db.get('point_logs', logId);
  if (!log) return res.status(404).json({ error: 'Log not found' });

  db.remove('point_logs', logId);
  const team = db.get('teams', log.team_id);
  if (team) {
    db.update('teams', team.id, { points: team.points - log.points });
  }
  console.log('[POINTS] Log deleted by superuser: ' + log.points + ' pts from "' + (team ? team.team_name : log.team_id) + '"');
  res.json({ ok: true });
});

router.delete('/:id', requireAuth, requireRole('superuser'), (req, res) => {
  const id = parseInt(req.params.id);
  const team = db.get('teams', id);
  if (!team) return res.status(404).json({ error: 'Team not found' });

  db.removeWhere('team_members', m => m.team_id === id);
  db.removeWhere('point_logs', l => l.team_id === id);
  db.removeWhere('event_registrations', r => r.team_id === id);
  db.remove('teams', id);
  console.log('[TEAM] Deleted by superuser: "' + team.team_name + '" (id: ' + id + ')');
  res.json({ ok: true });
});

router.get('/:id/events', (req, res) => {
  const teamId = parseInt(req.params.id);
  const regs = db.find('event_registrations', r => r.team_id === teamId).map(r => {
    const event = db.get('events', r.event_id);
    return { event_id: r.event_id, event_name: event ? event.name : null, created_at: r.created_at };
  }).sort((a, b) => (a.event_name || '').localeCompare(b.event_name || ''));
  res.json(regs);
});

router.post('/:id/events', (req, res) => {
  const { event_id } = req.body;
  if (!event_id) return res.status(400).json({ error: 'event_id required' });

  const teamId = parseInt(req.params.id);
  const team = db.get('teams', teamId);
  if (!team) return res.status(404).json({ error: 'Team not found' });

  const event = db.get('events', event_id);
  if (!event) return res.status(404).json({ error: 'Event not found' });

  const existing = db.findOne('event_registrations', r => r.team_id === teamId && r.event_id === event_id);
  if (existing) return res.status(409).json({ error: 'Already registered for this event' });

  db.insert('event_registrations', { team_id: teamId, event_id, created_at: db.now() });
  console.log('[EVENT] Registration: "' + team.team_name + '" → "' + event.name + '"');
  res.status(201).json({ ok: true, event_name: event.name });
});

router.delete('/:id/events/:eventId', (req, res) => {
  const teamId = parseInt(req.params.id);
  const eventId = parseInt(req.params.eventId);
  const removed = db.removeWhere('event_registrations', r => r.team_id === teamId && r.event_id === eventId);
  if (removed === 0) return res.status(404).json({ error: 'Registration not found' });
  const team = db.get('teams', teamId);
  const event = db.get('events', eventId);
  console.log('[EVENT] Unregistered: "' + (team ? team.team_name : teamId) + '" ← "' + (event ? event.name : eventId) + '"');
  res.json({ ok: true });
});

router.get('/:id/qr', async (req, res) => {
  const id = parseInt(req.params.id);
  const team = db.get('teams', id);
  if (!team) return res.status(404).json({ error: 'Team not found' });

  const data = JSON.stringify({ team_id: team.id, team_name: team.team_name });
  const qr = await QRCode.toDataURL(data, { width: 300, margin: 2 });
  res.json({ team_id: team.id, team_name: team.team_name, qr });
});

// ---- Schedule data (from handbook) ----

const SCHEDULE = [
  { slot: '10:30 AM – 1 PM', events: [
    { id: 4, name: "Main Character's Canva", type: 'workshop', venue: 'G-01' },
    { id: 1, name: 'Repartition (Debate)', type: 'competition', venue: 'G-20' },
    { id: 3, name: 'What The Flock', type: 'competition', venue: 'G-21' },
    { id: 6, name: 'Kala.js', type: 'workshop', venue: 'G-02' },
    { id: 17, name: 'Pallete Royale', type: 'workshop', venue: 'F-8A' },
    { id: 2, name: 'Duck Duck Loot', type: 'treasure_hunt', venue: 'Campus' },
  ]},
  { slot: '2 – 3:30 PM', events: [
    { id: 11, name: 'Branding Workshop', type: 'workshop', venue: 'G-01' },
    { id: 9, name: 'Pixels & Programs', type: 'competition', venue: 'G-20' },
    { id: 7, name: 'Rangkarmi', type: 'workshop', venue: 'G-21' },
    { id: 8, name: 'The Inner Draft', type: 'workshop', venue: 'G-02' },
    { id: 10, name: 'The Pop Song TM', type: 'workshop', venue: 'F-8A' },
  ]},
  { slot: '3:30 – 5 PM', events: [
    { id: 12, name: 'The Glam Lab', type: 'workshop', venue: 'G-01' },
    { id: 15, name: 'Extempore', type: 'competition', venue: 'G-20' },
    { id: 14, name: 'See. Frame. Shoot.', type: 'workshop', venue: 'G-21' },
    { id: 16, name: 'The Quackery of the Verse', type: 'competition', venue: 'G-02' },
    { id: 13, name: 'Rhythm Games', type: 'competition', venue: 'F-8A' },
  ]},
  { slot: '6 – 8 PM', events: [
    { id: 21, name: 'Digital Canvas', type: 'competition', venue: 'G-01' },
    { id: 5, name: 'Script to Screen', type: 'competition', venue: 'G-20' },
    { id: 20, name: 'Artist-in-Dialogue', type: 'workshop', venue: 'G-21' },
    { id: 19, name: 'Scicomm Workshop', type: 'workshop', venue: 'G-02' },
    { id: 18, name: 'Heart Out Loud', type: 'competition', venue: 'F-8A' },
  ]},
  { slot: '8:30 – 11:30 PM', events: [
    { id: 22, name: 'Filmon Ki Mehfil', type: 'free', venue: 'Open Air' },
  ]},
  { slot: 'All day', events: [
    { id: 23, name: 'Victory Point', type: 'victory_point', venue: 'Game Room' },
    { id: 26, name: 'PhotoBooth', type: 'free', venue: 'Booth' },
    { id: 24, name: 'Art Exhibition', type: 'free', venue: 'Gallery' },
    { id: 25, name: 'QQ Photography Exhibition', type: 'free', venue: 'Gallery' },
    { id: 27, name: 'Stalls', type: 'free', venue: 'Campus' },
  ]},
];

// ---- Team Planner ----

router.get('/:id/planner', requireAuth, (req, res) => {
  const teamId = parseInt(req.params.id);
  if (req.user.role === 'team' && req.user.team_id !== teamId) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const entries = db.find('team_planner', e => e.team_id === teamId);
  const logs = db.find('point_logs', l => l.team_id === teamId && l.event_id);
  res.json({ planner: entries, results: logs });
});

router.post('/:id/planner', requireAuth, (req, res) => {
  const teamId = parseInt(req.params.id);
  if (req.user.role === 'team' && req.user.team_id !== teamId) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const { entries } = req.body;
  if (!Array.isArray(entries)) return res.status(400).json({ error: 'entries array required' });

  db.removeWhere('team_planner', e => e.team_id === teamId);
  for (const e of entries) {
    if (e.slot && e.member && e.event_id) {
      db.insert('team_planner', {
        team_id: teamId, slot: e.slot, member: e.member,
        event_id: parseInt(e.event_id), created_at: db.now()
      });
    }
  }
  res.json({ ok: true });
});

module.exports = router;
