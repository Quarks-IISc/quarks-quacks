const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const path = require('path');
const os = require('os');

require('./db');

const authRoutes = require('./routes/auth-routes');
const adminRoutes = require('./routes/admin-routes');
const teamRoutes = require('./routes/team-routes');
const pointsRoutes = require('./routes/points-routes');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api', authRoutes);
app.use('/api/admins', adminRoutes);
app.use('/api/teams', teamRoutes);
app.use('/api/points', pointsRoutes);

app.get('/api/events', (_req, res) => {
  const db = require('./db');
  res.json(db.prepare('SELECT * FROM events ORDER BY name').all());
});

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
