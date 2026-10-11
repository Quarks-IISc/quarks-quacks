const bcrypt = require('bcryptjs');
const jdb = require('./json-db');

const EVENT_NAMES = [
  'Repartition (Debate)', 'Duck Duck Loot', 'What The Flock',
  "Main Character's Canva", 'Script to Screen', 'Kala.js',
  'Rangkarmi', 'The Inner Draft', 'Pixels & Programs',
  'The Pop Song TM', 'How Challengers Took on Market Leaders?',
  'The Glam Lab', 'Rhythm Games', 'See. Frame. Shoot.',
  'Extempore', 'The Quackery of the Verse', 'Pallete Royale',
  'Heart Out Loud', 'Scicomm Workshop', 'Artist-in-Dialogue',
  'Digital Canvas', 'Filmon Ki Mehfil', 'Victory Point',
  'Art Exhibition', 'QQ Photography Exhibition', 'PhotoBooth', 'Stalls',
  'In Plain Light', 'Open Stage'
];

for (const name of EVENT_NAMES) {
  if (!jdb.findOne('events', e => e.name === name)) {
    jdb.insert('events', { name });
  }
}

if (!jdb.findOne('users', u => u.username === 'mohini')) {
  const hash = bcrypt.hashSync('qwerty', 10);
  jdb.insert('users', { username: 'mohini', password_hash: hash, role: 'superuser', event_scope: null });
}

// Mihir is a superuser (created as an admin from the sheet; no event scope).
const mihir = jdb.findOne('users', u => u.username === 'Mihir');
if (mihir && mihir.role !== 'superuser') {
  jdb.update('users', mihir.id, { role: 'superuser', event_scope: null });
}

// Email OTP is disabled; treat every team as verified.
jdb.updateWhere('teams', t => t.verified !== 1, { verified: 1 });

module.exports = jdb;

