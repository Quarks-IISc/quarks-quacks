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

  const event = db.prepare('SELECT id FROM events WHERE id = ?').get(event_scope);
  if (!event) return res.status(400).json({ error: 'Invalid event' });

  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (exists) return res.status(409).json({ error: 'Username already taken' });

  const hash = bcrypt.hashSync(password, 10);
  const result = db.prepare(
    'INSERT INTO users (username, password_hash, role, event_scope) VALUES (?, ?, ?, ?)'
  ).run(username, hash, 'admin', event_scope);

  res.status(201).json({ id: result.lastInsertRowid, username, role: 'admin', event_scope });
});

router.get('/', (_req, res) => {
  const admins = db.prepare(`
    SELECT u.id, u.username, u.event_scope, e.name AS event_name
    FROM users u LEFT JOIN events e ON u.event_scope = e.id
    WHERE u.role = 'admin'
  `).all();
  res.json(admins);
});

router.delete('/:id', (req, res) => {
  const user = db.prepare("SELECT id FROM users WHERE id = ? AND role = 'admin'").get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Admin not found' });
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
