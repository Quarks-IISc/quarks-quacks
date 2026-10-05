const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

const db = new Database(path.join(__dirname, 'quarks-points.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('superuser', 'admin', 'participant')),
    event_scope INTEGER REFERENCES events(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team_name TEXT NOT NULL UNIQUE,
    points INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    verified INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS team_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    email TEXT,
    dept TEXT,
    is_captain INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS otps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    otp_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS event_registrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(team_id, event_id)
  );

  CREATE TABLE IF NOT EXISTS point_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT NOT NULL UNIQUE,
    team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    amount INTEGER NOT NULL,
    reason TEXT,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    claimed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS point_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    points INTEGER NOT NULL,
    reason TEXT,
    awarded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

const EVENT_NAMES = [
  'Repartition (Debate)', 'Duck Duck Loot', 'What The Flock',
  "Main Character's Canva", 'Script to Screen', 'Kala.js',
  'Rangkarmi', 'The Inner Draft', 'Pixels & Programs',
  'The Pop Song TM', 'How Challengers Took on Market Leaders?',
  'The Glam Lab', 'Rhythm Games', 'See. Frame. Shoot.',
  'Extempore', 'The Quackery of the Verse', 'Pallete Royale',
  'Heart Out Loud', 'Scicomm Workshop', 'Artist-in-Dialogue',
  'Digital Canvas', 'Filmon Ki Mehfil', 'Victory Point',
  'Art Exhibition', 'QQ Photography Exhibition', 'PhotoBooth', 'Stalls'
];

const insertEvent = db.prepare('INSERT OR IGNORE INTO events (name) VALUES (?)');
for (const name of EVENT_NAMES) {
  insertEvent.run(name);
}

const existing = db.prepare("SELECT id FROM users WHERE username = 'mohini'").get();
if (!existing) {
  const hash = bcrypt.hashSync('qwerty', 10);
  db.prepare(
    'INSERT INTO users (username, password_hash, role, event_scope) VALUES (?, ?, ?, ?)'
  ).run('mohini', hash, 'superuser', null);
}

module.exports = db;
