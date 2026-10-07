const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const cache = {};

function filePath(table) {
  return path.join(DATA_DIR, table + '.json');
}

function load(table) {
  if (cache[table]) return cache[table];
  const fp = filePath(table);
  if (fs.existsSync(fp)) {
    cache[table] = JSON.parse(fs.readFileSync(fp, 'utf8'));
  } else {
    cache[table] = { _nextId: 1, rows: [] };
  }
  return cache[table];
}

function save(table) {
  fs.writeFileSync(filePath(table), JSON.stringify(cache[table], null, 2) + '\n');
}

function now() {
  return new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
}

function all(table) {
  return load(table).rows;
}

function find(table, fn) {
  return load(table).rows.filter(fn);
}

function findOne(table, fn) {
  return load(table).rows.find(fn) || null;
}

function get(table, id) {
  return findOne(table, r => r.id === id);
}

function insert(table, row) {
  const store = load(table);
  const id = store._nextId++;
  const record = { id, ...row };
  store.rows.push(record);
  save(table);
  return { id, record };
}

function update(table, id, changes) {
  const store = load(table);
  const idx = store.rows.findIndex(r => r.id === id);
  if (idx === -1) return 0;
  Object.assign(store.rows[idx], changes);
  save(table);
  return 1;
}

function updateWhere(table, fn, changes) {
  const store = load(table);
  let count = 0;
  for (const row of store.rows) {
    if (fn(row)) {
      Object.assign(row, changes);
      count++;
    }
  }
  if (count > 0) save(table);
  return count;
}

function remove(table, id) {
  const store = load(table);
  const before = store.rows.length;
  store.rows = store.rows.filter(r => r.id !== id);
  if (store.rows.length < before) {
    save(table);
    return 1;
  }
  return 0;
}

function removeWhere(table, fn) {
  const store = load(table);
  const before = store.rows.length;
  store.rows = store.rows.filter(r => !fn(r));
  const removed = before - store.rows.length;
  if (removed > 0) save(table);
  return removed;
}

module.exports = { all, find, findOne, get, insert, update, updateWhere, remove, removeWhere, now, load, save };
