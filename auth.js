const jwt = require('jsonwebtoken');
const db = require('./db');

const SECRET = process.env.JWT_SECRET || 'quarks-quacks-2026-secret';

function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role, event_scope: user.event_scope },
    SECRET,
    { expiresIn: '24h' }
  );
}

function signTeamToken(team) {
  return jwt.sign(
    { team_id: team.id, team_name: team.team_name, role: 'team' },
    SECRET,
    { expiresIn: '7d' }
  );
}

function requireAuth(req, res, next) {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const payload = jwt.verify(token, SECRET);
    if (payload.team_id) {
      const team = db.get('teams', payload.team_id);
      if (!team) return res.status(401).json({ error: 'Team not found' });
      req.user = { id: team.id, username: team.team_name, role: 'team', team_id: team.id };
    } else {
      const user = db.get('users', payload.id);
      if (!user) return res.status(401).json({ error: 'User not found' });
      req.user = { id: user.id, username: user.username, role: user.role, event_scope: user.event_scope };
    }
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}

module.exports = { signToken, signTeamToken, requireAuth, requireRole, SECRET };
