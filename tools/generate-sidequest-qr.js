// Usage: SQ_BASE_URL=http://<server-ip>:3001 node tools/generate-sidequest-qr.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const QRCode = require('qrcode');

const BASE = (process.env.SQ_BASE_URL || 'http://10.134.10.33:3001').replace(/\/+$/, '');
const CONFIG = path.join(__dirname, '..', 'sidequests.json');
const OUT_DIR = path.join(__dirname, '..', 'sq-qr');

function isPlaceholder(t) {
  return typeof t !== 'string' || !t || t.startsWith('CHANGE_THIS_TOKEN');
}

(async () => {
  const quests = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
  fs.mkdirSync(OUT_DIR, { recursive: true });
  let changed = false;
  for (const q of quests) {
    if (q.answer_method !== 'qr') continue;
    if (isPlaceholder(q.qr_token)) {
      q.qr_token = crypto.randomBytes(24).toString('base64url');
      changed = true;
    }
    const url = BASE + '/sq/' + q.qr_token;
    await QRCode.toFile(path.join(OUT_DIR, q.id + '.png'), url, { width: 600, margin: 2 });
    console.log(q.id + ' -> ' + url);
  }
  if (changed) fs.writeFileSync(CONFIG, JSON.stringify(quests, null, 4) + '\n');
})();
