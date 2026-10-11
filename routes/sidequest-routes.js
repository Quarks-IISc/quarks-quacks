const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { requireAuth, requireRole } = require('../auth');

const router = express.Router();
const CONFIG = path.join(__dirname, '..', 'sidequests.json');

function loadQuests() {
  return JSON.parse(fs.readFileSync(CONFIG, 'utf8'))
    .sort((a, b) => a.original_order - b.original_order);
}

function saveQuests(quests) {
  const tmp = CONFIG + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(quests, null, 2) + '\n');
  fs.renameSync(tmp, CONFIG);
}

const norm = v => String(v || '').trim().toLowerCase().replace(/\s+/g, ' ');

function acceptedAnswers(q) {
  return (Array.isArray(q.answer) ? q.answer : [q.answer]).map(norm).filter(a => a && !a.startsWith('__'));
}

// A quest is playable only once it has a real answer (or a QR token).
function solvable(q) {
  if (q.answer_method === 'qr') return !!q.qr_token;
  return acceptedAnswers(q).length > 0;
}

function claimsByQuest() {
  const map = {};
  for (const c of db.all('sidequest_claims')) map[c.quest_id] = c;
  return map;
}

function currentQuest() {
  const claimed = claimsByQuest();
  return loadQuests().find(q => !claimed[q.id] && solvable(q)) || null;
}

function parseAnswers(raw) {
  return String(raw || '').split(/[\n,]/).map(a => a.trim()).filter(Boolean);
}

function publicView(q, teamId) {
  if (!q) return { completed: true, message: 'No side quests yet. Check back soon!' };
  const view = { completed: false, id: q.id, title: q.title, question: q.question, answer_method: q.answer_method, points: q.points };
  if (teamId) view.attempted = !!db.findOne('sidequest_attempts', a => a.quest_id === q.id && a.team_id === teamId);
  return view;
}

function award(teamId, quest) {
  const team = db.get('teams', teamId);
  if (!team) return null;
  db.insert('sidequest_claims', { quest_id: quest.id, team_id: teamId, points: quest.points, created_at: db.now() });
  db.insert('point_logs', {
    team_id: teamId, points: quest.points, reason: 'Side Quest: ' + quest.title,
    awarded_by: null, created_at: db.now()
  });
  db.update('teams', teamId, { points: team.points + quest.points });
  console.log('[SIDEQUEST] ' + quest.id + ' +' + quest.points + ' to "' + team.team_name + '"');
  return { ok: true, points: quest.points, total: team.points, title: quest.title, next: publicView(currentQuest()) };
}

function requireTeam(req, res, next) {
  if (!req.user || req.user.role !== 'team') return res.status(403).json({ error: 'Team login required' });
  next();
}

router.get('/current', requireAuth, (req, res) => {
  res.json(publicView(currentQuest(), req.user.role === 'team' ? req.user.team_id : null));
});

router.post('/answer', requireAuth, requireTeam, (req, res) => {
  const quest = currentQuest();
  if (!quest) return res.status(400).json({ error: 'No side quests yet. Check back soon!' });
  if (req.body.quest_id && req.body.quest_id !== quest.id) {
    return res.status(409).json({ error: 'Too late! Another team already solved this side quest. A new one is up.' });
  }
  if (quest.answer_method !== 'text') return res.status(400).json({ error: 'This Side Quest requires a QR scan.' });
  const answer = norm(req.body.answer);
  if (!answer) return res.status(400).json({ error: 'Type an answer first.' });
  // One try per team per side quest.
  const teamId = req.user.team_id;
  if (db.findOne('sidequest_attempts', a => a.quest_id === quest.id && a.team_id === teamId)) {
    return res.status(400).json({ error: 'Your team already used its one try on this side quest.' });
  }
  const correct = acceptedAnswers(quest).includes(answer);
  db.insert('sidequest_attempts', { quest_id: quest.id, team_id: teamId, answer, correct, created_at: db.now() });
  if (!correct) {
    return res.status(400).json({ error: 'Wrong answer. That was your one try for this side quest.' });
  }
  const result = award(req.user.team_id, quest);
  if (!result) return res.status(404).json({ error: 'Team not found' });
  res.json(result);
});

router.post('/claim', requireAuth, requireTeam, (req, res) => {
  const token = String(req.body.token || '');
  const quest = loadQuests().find(q => q.answer_method === 'qr' && q.qr_token && q.qr_token === token);
  if (!quest) return res.status(404).json({ error: 'Invalid Side Quest QR code' });
  const current = currentQuest();
  if (!current || current.id !== quest.id) {
    return res.status(400).json({ error: 'This Side Quest has already been completed or is not active yet.' });
  }
  const result = award(req.user.team_id, quest);
  if (!result) return res.status(404).json({ error: 'Team not found' });
  res.json(result);
});

router.get('/history', requireAuth, requireRole('superuser', 'admin'), (_req, res) => {
  const quests = loadQuests();
  res.json(db.all('sidequest_claims').map(c => {
    const team = db.get('teams', c.team_id);
    const q = quests.find(x => x.id === c.quest_id);
    return { ...c, team_name: team ? team.team_name : 'Unknown', title: q ? q.title : c.quest_id };
  }));
});

router.get('/winners', requireAuth, (_req, res) => {
  const quests = loadQuests();
  res.json(db.all('sidequest_claims').slice().sort((a, b) => b.id - a.id).map(c => {
    const team = db.get('teams', c.team_id);
    const q = quests.find(x => x.id === c.quest_id);
    return { quest_id: c.quest_id, title: q ? q.title : c.quest_id, question: q ? q.question : '', team_name: team ? team.team_name : 'Unknown', points: c.points, created_at: c.created_at };
  }));
});

// ---- Admin management (all admins + superuser) ----

const requireStaff = requireRole('superuser', 'admin');

router.get('/admin', requireAuth, requireStaff, (_req, res) => {
  const claimed = claimsByQuest();
  const current = currentQuest();
  res.json(loadQuests().map(q => {
    const c = claimed[q.id];
    const team = c ? db.get('teams', c.team_id) : null;
    let status = 'queued';
    if (c) status = 'solved';
    else if (current && current.id === q.id) status = 'active';
    else if (!solvable(q)) status = 'needs answer';
    return {
      id: q.id, title: q.title, question: q.question, answer: Array.isArray(q.answer) ? q.answer : [q.answer].filter(Boolean),
      points: q.points, answer_method: q.answer_method, status,
      solved_by: team ? team.team_name : null, solved_at: c ? c.created_at : null
    };
  }));
});

router.post('/admin', requireAuth, requireStaff, (req, res) => {
  const question = String(req.body.question || '').trim();
  const answers = parseAnswers(req.body.answer);
  const points = parseInt(req.body.points, 10) || 100;
  if (!question || !answers.length) return res.status(400).json({ error: 'Question and answer are required' });
  if (points <= 0 || points > 5000) return res.status(400).json({ error: 'Points must be between 1 and 5000' });
  const quests = loadQuests();
  const maxNum = quests.reduce((m, q) => Math.max(m, parseInt(String(q.id).replace(/\D/g, ''), 10) || 0), 0);
  const maxOrder = quests.reduce((m, q) => Math.max(m, q.original_order || 0), 0);
  const quest = {
    id: 'S' + (maxNum + 1), original_order: maxOrder + 1, answer_method: 'text',
    title: String(req.body.title || '').trim() || 'Side Quest',
    question, answer: answers, points, added_by: req.user.username
  };
  quests.push(quest);
  saveQuests(quests);
  console.log('[SIDEQUEST] Added ' + quest.id + ' by ' + req.user.username);
  res.status(201).json(quest);
});

router.put('/admin/:id', requireAuth, requireStaff, (req, res) => {
  if (claimsByQuest()[req.params.id]) return res.status(400).json({ error: 'Already solved; cannot edit' });
  const quests = loadQuests();
  const q = quests.find(x => x.id === req.params.id);
  if (!q) return res.status(404).json({ error: 'Side quest not found' });
  if (req.body.question !== undefined) q.question = String(req.body.question).trim() || q.question;
  if (req.body.title !== undefined) q.title = String(req.body.title).trim() || q.title;
  if (req.body.answer !== undefined) { const a = parseAnswers(req.body.answer); if (a.length) q.answer = a; }
  if (req.body.points !== undefined) { const p = parseInt(req.body.points, 10); if (p > 0 && p <= 5000) q.points = p; }
  saveQuests(quests);
  console.log('[SIDEQUEST] Edited ' + q.id + ' by ' + req.user.username);
  res.json(q);
});

router.delete('/admin/:id', requireAuth, requireStaff, (req, res) => {
  if (claimsByQuest()[req.params.id]) return res.status(400).json({ error: 'Already solved; cannot delete' });
  const quests = loadQuests();
  const next = quests.filter(x => x.id !== req.params.id);
  if (next.length === quests.length) return res.status(404).json({ error: 'Side quest not found' });
  saveQuests(next);
  console.log('[SIDEQUEST] Deleted ' + req.params.id + ' by ' + req.user.username);
  res.json({ ok: true });
});

module.exports = router;
