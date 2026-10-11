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

app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
app.use(express.json());
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
