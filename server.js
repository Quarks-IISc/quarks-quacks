const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const path = require('path');
const os = require('os');
const { createProxyMiddleware } = require('http-proxy-middleware');

require('./db');

const authRoutes = require('./routes/auth-routes');
const adminRoutes = require('./routes/admin-routes');
const teamRoutes = require('./routes/team-routes');
const pointsRoutes = require('./routes/points-routes');
const sidequestRoutes = require('./routes/sidequest-routes');
const huntRoutes = require('./routes/hunt-routes');
const { fetchSheet, getEvents } = require('./sheet-cache');

const app = express();

// Last line of defence during the event: log stray async errors instead of exiting.
process.on('uncaughtException', (err) => console.error('[FATAL-CAUGHT] uncaughtException:', err));
process.on('unhandledRejection', (err) => console.error('[FATAL-CAUGHT] unhandledRejection:', err));

function getPort() {
  var args = process.argv.slice(2);
  for (var i = 0; i < args.length; i++) {
    if ((args[i] === '-p' || args[i] === '--port') && args[i + 1]) {
      return parseInt(args[i + 1], 10);
    }
  }
  return parseInt(process.env.PORT, 10) || 3001;
}
const PORT = getPort();

// ---- Event over: freeze all changes (points, side quests, hunt, registrations) ----
const EVENT_FILE = path.join(__dirname, 'event_over.json');
function eventStatus() {
  try { return JSON.parse(require('fs').readFileSync(EVENT_FILE, 'utf8')); } catch { return { over: false }; }
}
const ALWAYS_ALLOWED = ['/api/login', '/api/logout', '/api/teams/login'];
app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  if (ALWAYS_ALLOWED.includes(req.path)) return next();
  if (!eventStatus().over) return next();
  return res.status(403).json({ error: 'Quarks Quacks 2026 is over! Points and games are closed. Thanks for playing 🦆' });
});

app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: '20mb' }));
// Always revalidate so phones pick up UI changes during the event.
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res) => res.set('Cache-Control', 'no-cache')
}));

app.use('/api', authRoutes);
app.use('/api/admins', adminRoutes);
app.use('/api/teams', teamRoutes);
app.use('/api/points', pointsRoutes);
app.use('/api/sidequest', sidequestRoutes);
app.use('/api/hunt', huntRoutes);

app.get('/sq/:token', (req, res) => {
  res.redirect('/#sq-' + encodeURIComponent(req.params.token));
});

// ---- Notifications (bell): everyone sees; any admin/superuser posts ----
const ANN_FILE = path.join(__dirname, 'announcements.json');
const { requireAuth: annAuth, requireRole: annRole } = require('./auth');
function readAnns() {
  try { return JSON.parse(require('fs').readFileSync(ANN_FILE, 'utf8')); } catch { return []; }
}
function writeAnns(list) {
  const tmp = ANN_FILE + '.tmp';
  require('fs').writeFileSync(tmp, JSON.stringify(list, null, 2) + '\n');
  require('fs').renameSync(tmp, ANN_FILE);
}
app.get('/api/announcements', (_req, res) => res.json(readAnns().slice().reverse()));
app.post('/api/announcements', annAuth, annRole('superuser', 'admin'), (req, res) => {
  const text = String(req.body.text || '').trim().slice(0, 600);
  if (!text) return res.status(400).json({ error: 'Write something first' });
  const now = new Date(Date.now() + 330 * 60000);
  const item = { id: String(Date.now()), text, by: req.user.username, at: now.toISOString().slice(11, 16) };
  const list = readAnns(); list.push(item); writeAnns(list);
  console.log('[NOTIFY] ' + req.user.username + ': ' + text.replace(/\n/g, ' | '));
  res.status(201).json(item);
});
app.put('/api/announcements/:id', annAuth, annRole('superuser', 'admin'), (req, res) => {
  const text = String(req.body.text || '').trim().slice(0, 600);
  if (!text) return res.status(400).json({ error: 'Notification cannot be empty' });
  const list = readAnns();
  const item = list.find(a => a.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  item.text = text;
  item.edited_by = req.user.username;
  writeAnns(list);
  console.log('[NOTIFY] edited ' + item.id + ' by ' + req.user.username);
  res.json(item);
});
app.delete('/api/announcements/:id', annAuth, annRole('superuser', 'admin'), (req, res) => {
  const list = readAnns();
  const next = list.filter(a => a.id !== req.params.id);
  if (next.length === list.length) return res.status(404).json({ error: 'Not found' });
  writeAnns(next);
  console.log('[NOTIFY] deleted ' + req.params.id + ' by ' + req.user.username);
  res.json({ ok: true });
});

// Front-end version = newest mtime of the UI files; open pages reload when it changes.
app.get('/api/version', (_req, res) => {
  const fs = require('fs');
  const files = ['app.js', 'index.html', 'style.css'].map(f => path.join(__dirname, 'public', f));
  const v = Math.max(...files.map(f => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } }));
  res.set('Cache-Control', 'no-store').json({ v: String(Math.floor(v)) });
});

app.get('/api/event-status', (_req, res) => {
  const st = eventStatus();
  if (!st.over || !st.winner) return res.json({ over: !!st.over });
  const db = require('./db');
  const team = db.findOne('teams', t => String(t.team_name).trim().toLowerCase() === String(st.winner).trim().toLowerCase());
  const members = team ? db.find('team_members', m => m.team_id === team.id).map(m => m.name) : [];
  res.json({ over: true, winner: team ? team.team_name : st.winner, points: team ? team.points : null, members });
});

app.get('/api/events', (_req, res) => {
  const db = require('./db');
  const events = db.all('events').sort((a, b) => a.name.localeCompare(b.name));
  res.json(events);
});

app.get('/api/events/details', (_req, res) => {
  res.json(getEvents());
});

const HUNT_PORT = process.env.HUNT_PORT || 8000;
const jwt = require('jsonwebtoken');
const { SECRET } = require('./auth');

app.use('/treasure-hunt', (req, _res, next) => {
  const token = req.cookies.token;
  if (token) {
    try {
      const payload = jwt.verify(token, SECRET);
      if (payload.team_id && payload.team_name) {
        req.headers['x-team-id'] = String(payload.team_id);
        req.headers['x-team-name'] = payload.team_name;
      }
    } catch {}
  }
  next();
}, createProxyMiddleware({
  target: `http://127.0.0.1:${HUNT_PORT}`,
  changeOrigin: true,
  pathRewrite: { '^/treasure-hunt': '' },
}));

fetchSheet();

app.listen(PORT, '0.0.0.0', () => {
  const nets = os.networkInterfaces();
  let localIp = 'localhost';
  for (const iface of Object.values(nets)) {
    for (const cfg of iface) {
      if (cfg.family === 'IPv4' && !cfg.internal) {
        localIp = cfg.address;
        break;
      }
    }
  }
  console.log(`Quarks Points running on:`);
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  Network: http://${localIp}:${PORT}`);
});
