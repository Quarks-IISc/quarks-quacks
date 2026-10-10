const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAuth, requireRole } = require('../auth');

const router = express.Router();

router.use(requireAuth, requireRole('superuser'));

router.post('/', (req, res) => {
  const { username, password, event_scope } = req.body;
  if (!username || !password || !event_scope) {
    return res.status(400).json({ error: 'username, password, and event_scope required' });
  }

  const scopes = Array.isArray(event_scope) ? event_scope : [event_scope];
  for (const id of scopes) {
    if (!db.get('events', id)) return res.status(400).json({ error: 'Invalid event id: ' + id });
  }

  const exists = db.findOne('users', u => u.username === username);
  if (exists) return res.status(409).json({ error: 'Username already taken' });

  const hash = bcrypt.hashSync(password, 10);
  const { id } = db.insert('users', { username, password_hash: hash, role: 'admin', event_scope: scopes });

  const names = scopes.map(s => db.get('events', s).name).join(', ');
  console.log('[ADMIN] Created:', username, '(role: admin, events:', names + ')');
  res.status(201).json({ id, username, role: 'admin', event_scope: scopes });
});

router.get('/', (_req, res) => {
  const admins = db.find('users', u => u.role === 'admin').map(u => {
    const scopes = Array.isArray(u.event_scope) ? u.event_scope : u.event_scope ? [u.event_scope] : [];
    const event_names = scopes.map(id => { const e = db.get('events', id); return e ? e.name : null; }).filter(Boolean);
    return { id: u.id, username: u.username, event_scope: scopes, event_names };
  });
  res.json(admins);
});

router.delete('/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const user = db.findOne('users', u => u.id === id && u.role === 'admin');
  if (!user) return res.status(404).json({ error: 'Admin not found' });
  db.remove('users', id);
  console.log('[ADMIN] Deleted:', user.username);
  res.json({ ok: true });
});

module.exports = router;
