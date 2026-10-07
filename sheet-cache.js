const SHEET_ID = '1jy7Jz381dNNlzTdndmrp4yC_uZbKBH53qeqPHsxaRU8';
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=Sheet1`;

let cachedEvents = null;

async function fetchSheet() {
  try {
    const resp = await fetch(SHEET_URL);
    const text = await resp.text();
    const json = JSON.parse(text.replace(/^[^(]*\(/, '').replace(/\);?\s*$/, ''));
    const rows = json.table.rows;
    if (!rows.length) { cachedEvents = []; return; }

    // Row 0 has headers as data (column labels are empty)
    const headerRow = rows[0].c;
    const headers = headerRow.map(c => c && c.v ? String(c.v).toLowerCase().trim() : '');

    function colIdx(search) {
      for (let i = 0; i < headers.length; i++) {
        if (headers[i].includes(search)) return i;
      }
      return -1;
    }
    function field(row, searches) {
      for (const s of searches) {
        const idx = colIdx(s);
        if (idx >= 0 && row.c[idx] && row.c[idx].v) return String(row.c[idx].v);
      }
      return '';
    }

    cachedEvents = rows.slice(1).map(row => ({
      name: field(row, ['name of event', 'name', 'event', 'title']),
      summary: field(row, ['summary', 'blurb', 'tldr', 'one-liner']),
      description: field(row, ['event description', 'description', 'details', 'about']),
      venue: field(row, ['venue', 'location', 'room']),
      time: field(row, ['timing', 'time', 'slot', 'when']),
      club: field(row, ['speaker', 'club', 'organizer', 'org']),
      regLink: field(row, ['registration link', 'registration', 'register', 'signup']),
      poster: field(row, ['poster', 'image']),
      deadline: field(row, ['last date', 'deadline'])
    })).filter(e => e.name);

    console.log(`Cached ${cachedEvents.length} events from Google Sheet`);
  } catch (err) {
    console.error('Failed to fetch Google Sheet:', err.message);
    cachedEvents = [];
  }
}

function getEvents() {
  return cachedEvents || [];
}

module.exports = { fetchSheet, getEvents };
