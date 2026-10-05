(function () {
  var user = null;
  var teamData = null;
  var lbTimer = null;
  var qrScanner = null;
  var sheetEvents = null;

  // Restore team session from localStorage
  try {
    var saved = localStorage.getItem('quarks_team');
    if (saved) teamData = JSON.parse(saved);
  } catch (e) {}

  function saveTeam(data) {
    teamData = data;
    try { localStorage.setItem('quarks_team', JSON.stringify(data)); } catch (e) {}
  }
  function clearTeam() {
    teamData = null;
    try { localStorage.removeItem('quarks_team'); } catch (e) {}
  }

  var SHEET_ID = '1jy7Jz381dNNlzTdndmrp4yC_uZbKBH53qeqPHsxaRU8';

  // ---- API helper ----

  async function api(method, path, body) {
    var opts = {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin'
    };
    if (body) opts.body = JSON.stringify(body);
    var res = await fetch(path, opts);
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  // ---- Toast ----

  var toastEl = document.getElementById('toast');
  var toastTimer;
  function toast(msg, ok) {
    clearTimeout(toastTimer);
    toastEl.textContent = msg;
    toastEl.className = 'toast is-show ' + (ok ? 'is-ok' : 'is-err');
    toastTimer = setTimeout(function () { toastEl.className = 'toast'; }, 3000);
  }

  // ---- Nav ----

  var navLinks = document.getElementById('nav-links');
  var navToggle = document.getElementById('nav-toggle');
  navToggle.addEventListener('click', function () {
    navLinks.classList.toggle('is-open');
  });
  navLinks.addEventListener('click', function () {
    navLinks.classList.remove('is-open');
  });

  document.querySelectorAll('[data-scroll]').forEach(function (el) {
    el.addEventListener('click', function (e) {
      var target = document.getElementById(el.dataset.scroll);
      if (target) {
        e.preventDefault();
        if (location.hash !== '#home') {
          location.hash = 'home';
          setTimeout(function () { target.scrollIntoView({ behavior: 'smooth' }); }, 100);
        } else {
          target.scrollIntoView({ behavior: 'smooth' });
        }
      }
    });
  });

  function updateNav() {
    var loggedIn = user || teamData;
    navLinks.querySelectorAll('[data-auth]').forEach(function (el) {
      el.style.display = loggedIn ? '' : 'none';
    });
    navLinks.querySelectorAll('[data-guest]').forEach(function (el) {
      el.style.display = loggedIn ? 'none' : '';
    });
    navLinks.querySelectorAll('[data-nav]').forEach(function (el) {
      el.classList.toggle('is-active', '#' + el.dataset.nav === location.hash);
    });
  }

  document.getElementById('logout-btn').addEventListener('click', async function (e) {
    e.preventDefault();
    await api('POST', '/api/logout').catch(function () {});
    user = null;
    clearTeam();
    updateNav();
    go('home');
    toast('Logged out', true);
  });

  // ---- Router ----

  function go(view) { location.hash = view; }

  function route() {
    var hash = (location.hash || '#home').slice(1);
    if (hash === 'dashboard') {
      if (user) hash = 'admin';
      else if (teamData) hash = 'participant';
      else { go('login'); return; }
    }
    if (hash === 'superuser') hash = 'admin';
    if (hash === 'participant' && !teamData) { go('login'); return; }
    if (hash === 'admin' && !user) { go('login'); return; }

    var main = document.querySelector('.main');
    main.classList.toggle('main-home', hash === 'home');

    document.querySelectorAll('.view').forEach(function (v) { v.classList.remove('is-active'); });
    var el = document.getElementById('view-' + hash);
    if (!el) { el = document.getElementById('view-home'); hash = 'home'; }
    el.classList.add('is-active');

    updateNav();
    stopQrScanner();
    if (lbTimer) { clearInterval(lbTimer); lbTimer = null; }

    if (hash === 'home') showHome();
    else if (hash === 'leaderboard') showLeaderboard();
    else if (hash === 'participant') showParticipant();
    else if (hash === 'admin') showAdmin();
  }

  window.addEventListener('hashchange', route);

  // ---- Auth ----

  async function checkAuth() {
    try {
      user = await api('GET', '/api/me');
    } catch (e) {
      user = null;
    }
  }

  // ---- Theme Detection ----

  var THEME_RULES = [
    { tag: 'workshop', label: 'Workshops', color: '#e07cff', icon: 'fa-paint-brush', words: ['workshop', 'clinic', 'class', 'hands-on', 'tutorial', 'origami', 'doodle', 'branding'] },
    { tag: 'competition', label: 'Competitions', color: '#ffc93c', icon: 'fa-star', words: ['competition', 'contest', 'compete', 'quiz', 'debate', 'mega quiz', 'treasure', 'loot', 'royale', 'battle', 'challenge'] },
    { tag: 'performance', label: 'Performances', color: '#ff6b6b', icon: 'fa-microphone-alt', words: ['concert', 'open mic', 'karaoke', 'improv', 'jam session', 'stage play', 'play', 'performance', 'dance'] },
    { tag: 'games', label: 'Games', color: '#4ecb71', icon: 'fa-dice', words: ['game', 'treasure hunt', 'board game', 'game room', 'gaming'] },
    { tag: 'creative', label: 'Creative', color: '#5cc3ec', icon: 'fa-camera', words: ['photo', 'photobooth', 'film', 'frames', 'portrait', 'crossword', 'art', 'palette', 'pallete', 'paint', 'sketch', 'design', 'mural'] },
    { tag: 'talks', label: 'Talks & Panels', color: '#ff9f43', icon: 'fa-comments', words: ['talk', 'fireside', 'chat', 'lecture', 'panel', 'discussion', 'lightning'] },
    { tag: 'social', label: 'Social', color: '#a29bfe', icon: 'fa-leaf', words: ['stall', 'food', 'ceremony', 'closing', 'opening', 'walk'] }
  ];

  function detectTheme(name) {
    var haystack = name.toLowerCase();
    for (var i = 0; i < THEME_RULES.length; i++) {
      var rule = THEME_RULES[i];
      for (var j = 0; j < rule.words.length; j++) {
        if (haystack.indexOf(rule.words[j]) !== -1) return rule;
      }
    }
    return THEME_RULES[4];
  }

  // ---- Google Sheet fetcher ----

  async function fetchSheetEvents() {
    if (sheetEvents) return sheetEvents;
    try {
      var url = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID +
        '/gviz/tq?tqx=out:json&sheet=Sheet1';
      var resp = await fetch(url);
      var text = await resp.text();
      var json = JSON.parse(text.replace(/^[^(]*\(/, '').replace(/\);?\s*$/, ''));
      var cols = json.table.cols;
      var rows = json.table.rows;

      function colIdx(label) {
        for (var i = 0; i < cols.length; i++) {
          if (cols[i].label && cols[i].label.toLowerCase().indexOf(label) !== -1) return i;
        }
        return -1;
      }
      function field(row, labels) {
        for (var i = 0; i < labels.length; i++) {
          var idx = colIdx(labels[i]);
          if (idx >= 0 && row.c[idx] && row.c[idx].v) return String(row.c[idx].v);
        }
        return '';
      }

      sheetEvents = rows.map(function (row) {
        return {
          name: field(row, ['name', 'event', 'title']),
          summary: field(row, ['summary', 'blurb', 'tldr', 'one-liner']),
          description: field(row, ['description', 'details', 'about']),
          venue: field(row, ['venue', 'location', 'room']),
          time: field(row, ['time', 'slot', 'when']),
          club: field(row, ['club', 'organizer', 'org'])
        };
      }).filter(function (e) { return e.name; });
    } catch (e) {
      sheetEvents = [];
    }
    return sheetEvents;
  }

  // ---- Event Detail Popup ----

  var eventOverlay = document.getElementById('event-overlay');
  var eventCloseBtn = document.getElementById('event-close');

  function closeEventPopup() {
    eventOverlay.classList.remove('is-open');
    document.body.style.overflow = '';
  }

  if (eventCloseBtn) {
    eventCloseBtn.addEventListener('click', closeEventPopup);
  }
  if (eventOverlay) {
    eventOverlay.addEventListener('click', function (e) {
      if (e.target === eventOverlay) closeEventPopup();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && eventOverlay.classList.contains('is-open')) closeEventPopup();
    });
  }

  async function showEventPopup(eventName) {
    var title = document.getElementById('event-popup-title');
    var tag = document.getElementById('event-popup-tag');
    var body = document.getElementById('event-popup-body');
    var theme = detectTheme(eventName);

    title.textContent = eventName;
    tag.textContent = theme.label;
    tag.style.color = theme.color;
    tag.style.background = theme.color + '18';
    body.innerHTML = '<p class="text-dim">Loading…</p>';

    eventOverlay.classList.add('is-open');
    document.body.style.overflow = 'hidden';

    var events = await fetchSheetEvents();
    var match = events.find(function (e) {
      return e.name.toLowerCase().trim() === eventName.toLowerCase().trim();
    });

    if (match) {
      var html = '';
      if (match.summary) html += '<p><strong>' + esc(match.summary) + '</strong></p>';
      if (match.description) html += '<p>' + esc(match.description) + '</p>';
      if (match.venue) html += '<p><i class="fas fa-map-marker-alt" style="color:var(--coral)"></i> ' + esc(match.venue) + '</p>';
      if (match.time) html += '<p><i class="fas fa-clock" style="color:var(--secondary)"></i> ' + esc(match.time) + '</p>';
      if (match.club) html += '<p><i class="fas fa-users" style="color:var(--info)"></i> ' + esc(match.club) + '</p>';
      body.innerHTML = html || '<p class="text-dim">No additional details available.</p>';
    } else {
      body.innerHTML = '<p class="text-dim">No details found for this event in the schedule sheet.</p>';
    }
  }

  // ---- Home ----

  async function showHome() {
    var ctaGuest = document.getElementById('cta-guest');
    var ctaAuth = document.getElementById('cta-auth');
    var loggedIn = user || teamData;
    ctaGuest.style.display = loggedIn ? 'none' : '';
    ctaAuth.style.display = loggedIn ? '' : 'none';
    loadSchedule();
    loadHomeLB();
    if (lbTimer) clearInterval(lbTimer);
    lbTimer = setInterval(loadHomeLB, 30000);
  }

  var scheduleLoaded = false;
  async function loadSchedule() {
    if (scheduleLoaded) return;
    try {
      var events = await api('GET', '/api/events');
      var list = document.getElementById('schedule-list');
      var legend = document.getElementById('schedule-legend');
      var usedThemes = {};
      var html = '';
      events.forEach(function (ev) {
        var theme = detectTheme(ev.name);
        usedThemes[theme.tag] = theme;
        html += '<li class="schedule-item" data-event-name="' + esc(ev.name) + '" style="cursor:pointer">' +
          '<span class="schedule-dot" style="background:' + theme.color + '"></span>' +
          '<span class="schedule-item-name">' + esc(ev.name) + '</span>' +
          '<span class="schedule-item-tag" style="color:' + theme.color + ';background:' + theme.color + '18">' + theme.label + '</span>' +
          '</li>';
      });
      list.innerHTML = html;
      legend.innerHTML = Object.keys(usedThemes).map(function (tag) {
        var t = usedThemes[tag];
        return '<span class="schedule-legend-item"><span class="schedule-dot" style="background:' + t.color + '"></span>' + t.label + '</span>';
      }).join('');
      scheduleLoaded = true;
    } catch (e) {
      document.getElementById('schedule-list').innerHTML = '<li class="schedule-item" style="color:var(--text-dim)">Could not load events.</li>';
    }
  }

  // Click on schedule item → event popup
  document.getElementById('schedule-list').addEventListener('click', function (e) {
    var item = e.target.closest('[data-event-name]');
    if (item) showEventPopup(item.dataset.eventName);
  });

  var schedOverlay = document.getElementById('schedule-overlay');
  var schedBtn = document.getElementById('home-schedule-btn');
  var schedClose = document.getElementById('schedule-close');
  if (schedBtn && schedOverlay) {
    schedBtn.addEventListener('click', function () {
      loadSchedule();
      schedOverlay.classList.add('is-open');
      document.body.style.overflow = 'hidden';
    });
    schedClose.addEventListener('click', function () {
      schedOverlay.classList.remove('is-open');
      document.body.style.overflow = '';
    });
    schedOverlay.addEventListener('click', function (e) {
      if (e.target === schedOverlay) {
        schedOverlay.classList.remove('is-open');
        document.body.style.overflow = '';
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && schedOverlay.classList.contains('is-open')) {
        schedOverlay.classList.remove('is-open');
        document.body.style.overflow = '';
      }
    });
  }

  async function loadHomeLB() {
    try {
      var teams = await api('GET', '/api/points/leaderboard');
      var body = document.getElementById('home-lb-body');
      body.innerHTML = teams.map(function (t, i) {
        var rank = i + 1;
        var cls = rank === 1 ? 'lb-gold' : rank === 2 ? 'lb-silver' : rank === 3 ? 'lb-bronze' : '';
        var icon = rank === 1 ? '<i class="fas fa-trophy"></i> ' : rank === 2 ? '<i class="fas fa-medal"></i> ' : rank === 3 ? '<i class="fas fa-award"></i> ' : '';
        return '<tr><td><span class="lb-rank ' + cls + '">' + icon + rank + '</span></td>' +
          '<td>' + esc(t.team_name) + '</td>' +
          '<td><span class="lb-points">' + t.points + '</span></td></tr>';
      }).join('') || '<tr><td colspan="3" class="text-dim">No teams yet — be the first to register!</td></tr>';
    } catch (e) {}
  }

  // ---- Team Login ----

  document.getElementById('team-login-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var fd = new FormData(this);
    try {
      var team = await api('POST', '/api/teams/lookup', {
        team_name: fd.get('team_name')
      });
      saveTeam(team);
      toast('Welcome, ' + team.team_name + '!', true);
      this.reset();
      go('participant');
    } catch (err) {
      toast(err.message);
    }
  });

  // ---- Admin Login ----

  document.getElementById('login-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var fd = new FormData(this);
    try {
      await api('POST', '/api/login', {
        username: fd.get('username'),
        password: fd.get('password')
      });
      user = await api('GET', '/api/me');
      toast('Welcome, ' + user.username + '!', true);
      this.reset();
      go('dashboard');
    } catch (err) {
      toast(err.message);
    }
  });

  // ---- Register ----

  function addMemberRow(fieldset, prefix) {
    var idx = fieldset.querySelectorAll('.member-row-stack').length;
    if (idx >= 3) return;
    var div = document.createElement('div');
    div.className = 'member-row-stack';
    div.dataset.idx = idx;
    div.innerHTML =
      '<div class="member-row-header">' +
        '<span class="member-num">Member ' + (idx + 1) + '</span>' +
        '<label class="captain-label"><input type="radio" name="captain" value="' + idx + '" /> Captain</label>' +
      '</div>' +
      '<div class="member-row-pair">' +
        '<input type="text" name="' + prefix + idx + '_name" placeholder="Name *" required />' +
        '<input type="text" name="' + prefix + idx + '_dept" placeholder="Dept. / Where from?" />' +
      '</div>' +
      '<input type="email" name="' + prefix + idx + '_email" placeholder="Email" />';
    fieldset.appendChild(div);
  }

  document.getElementById('add-member-btn').addEventListener('click', function () {
    addMemberRow(document.getElementById('members-fieldset'), 'm');
  });

  document.querySelectorAll('.su-add-member-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      addMemberRow(document.getElementById('su-members-fieldset'), 'm');
    });
  });

  function collectMembers(form) {
    var fd = new FormData(form);
    var captainIdx = parseInt(fd.get('captain') || '0');
    var members = [];
    form.querySelectorAll('.member-row-stack').forEach(function (row, i) {
      var inputs = row.querySelectorAll('input');
      var name = '', email = '', dept = '';
      inputs.forEach(function (inp) {
        if (inp.name.endsWith('_name')) name = inp.value.trim();
        else if (inp.name.endsWith('_email')) email = inp.value.trim();
        else if (inp.name.endsWith('_dept')) dept = inp.value.trim();
      });
      if (name) {
        members.push({
          name: name,
          email: email,
          dept: dept,
          is_captain: i === captainIdx
        });
      }
    });
    return { team_name: fd.get('team_name'), members: members };
  }

  async function handleRegister(form) {
    var payload = collectMembers(form);
    if (!payload.members.length) { toast('Add at least one member'); return; }
    var captain = payload.members.find(function (m) { return m.is_captain; });
    if (!captain || !captain.email) { toast('Captain must have an email'); return; }
    try {
      var data = await api('POST', '/api/teams', payload);
      toast('Team registered! Check ' + captain.email + ' for OTP.', true);
      document.getElementById('verify-email').value = captain.email;
      document.getElementById('verify-msg').textContent =
        'A 6-digit code has been sent to ' + captain.email;
      saveTeam({ id: data.id, team_name: data.team_name });
      form.reset();
      go('verify');
    } catch (err) {
      toast(err.message);
    }
  }

  document.getElementById('register-form').addEventListener('submit', function (e) {
    e.preventDefault();
    handleRegister(this);
  });

  document.getElementById('su-register-form').addEventListener('submit', function (e) {
    e.preventDefault();
    handleRegister(this);
  });

  // ---- OTP Verify ----

  document.getElementById('verify-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var fd = new FormData(this);
    try {
      await api('POST', '/api/teams/verify', {
        email: fd.get('email'),
        otp: fd.get('otp')
      });
      toast('Verified! Your team is ready.', true);
      this.reset();
      go('home');
    } catch (err) {
      toast(err.message);
    }
  });

  // ---- Participant ----

  async function showParticipant() {
    if (!teamData || !teamData.id) return;
    try {
      var data = await api('GET', '/api/teams/' + teamData.id);
      document.getElementById('p-team-name').textContent = data.team_name;
      document.getElementById('p-points').textContent = data.points;
      document.getElementById('p-members').innerHTML = data.members.map(function (m) {
        return '<li><span>' + esc(m.name) + '</span>' +
          (m.is_captain ? '<span class="member-badge">Captain</span>' : '') + '</li>';
      }).join('');

      var qrEl = document.getElementById('p-qr');
      try {
        var qr = await api('GET', '/api/teams/' + teamData.id + '/qr');
        qrEl.innerHTML = '<img src="' + qr.qr + '" alt="Team QR" />';
      } catch (e) {
        qrEl.innerHTML = '<p>QR unavailable</p>';
      }

      var hist = await api('GET', '/api/points/' + teamData.id);
      document.getElementById('p-history').innerHTML = hist.map(function (h) {
        return '<tr><td>+' + h.points + '</td><td>' + esc(h.reason) + '</td><td>' + timeAgo(h.created_at) + '</td></tr>';
      }).join('') || '<tr><td colspan="3">No points yet</td></tr>';

      loadParticipantEvents();
    } catch (err) {
      toast(err.message);
    }
  }

  async function loadParticipantEvents() {
    if (!teamData || !teamData.id) return;
    try {
      var regs = await api('GET', '/api/teams/' + teamData.id + '/events');
      var allEvents = await api('GET', '/api/events');
      var regIds = {};
      regs.forEach(function (r) { regIds[r.event_id] = true; });

      // Registered events as colored tags
      var regHtml = regs.map(function (r) {
        var theme = detectTheme(r.event_name);
        return '<button class="event-tag" style="color:' + theme.color + ';background:' + theme.color + '18" ' +
          'data-event-name="' + esc(r.event_name) + '" title="Click for details">' +
          esc(r.event_name) +
          '<span class="event-tag-remove" data-unreg-event="' + r.event_id + '" title="Unregister">&times;</span>' +
          '</button>';
      }).join('');
      document.getElementById('p-registered-events').innerHTML =
        regHtml || '<span class="text-dim" style="font-size:0.85rem">No events registered yet — pick some below!</span>';

      // Available events to register for
      var available = allEvents.filter(function (ev) { return !regIds[ev.id]; });
      document.getElementById('p-event-picker').innerHTML = available.map(function (ev) {
        var theme = detectTheme(ev.name);
        return '<button class="event-pick-btn" data-reg-event="' + ev.id + '" data-event-name="' + esc(ev.name) + '" ' +
          'style="border-color:' + theme.color + '30">' +
          '<span class="schedule-dot" style="background:' + theme.color + ';display:inline-block;vertical-align:middle;margin-right:4px"></span>' +
          esc(ev.name) + '</button>';
      }).join('') || '<span class="text-dim" style="font-size:0.85rem">Registered for everything!</span>';
    } catch (e) {}
  }

  // Click on registered event tag → event popup
  document.getElementById('p-registered-events').addEventListener('click', function (e) {
    var unreg = e.target.closest('[data-unreg-event]');
    if (unreg) {
      e.stopPropagation();
      unregisterEvent(parseInt(unreg.dataset.unregEvent));
      return;
    }
    var tag = e.target.closest('[data-event-name]');
    if (tag) showEventPopup(tag.dataset.eventName);
  });

  // Click on available event → register
  document.getElementById('p-event-picker').addEventListener('click', async function (e) {
    var btn = e.target.closest('[data-reg-event]');
    if (!btn) return;
    try {
      var result = await api('POST', '/api/teams/' + teamData.id + '/events', {
        event_id: parseInt(btn.dataset.regEvent)
      });
      toast('Registered for ' + result.event_name + '!', true);
      loadParticipantEvents();
    } catch (err) {
      toast(err.message);
    }
  });

  async function unregisterEvent(eventId) {
    try {
      await api('DELETE', '/api/teams/' + teamData.id + '/events/' + eventId);
      toast('Unregistered', true);
      loadParticipantEvents();
    } catch (err) {
      toast(err.message);
    }
  }

  // ---- Admin (unified with superuser) ----

  async function showAdmin() {
    if (!user) return;

    var isSuperuser = user.role === 'superuser';
    document.getElementById('a-scope').textContent = isSuperuser
      ? 'Superuser — ' + user.username
      : user.event_name ? 'Managing: ' + user.event_name : 'All events';

    document.querySelectorAll('.su-only').forEach(function (el) {
      el.style.display = isSuperuser ? '' : 'none';
    });

    loadAdminHistory();
    loadAllTeams();
    if (isSuperuser) {
      loadEvents();
      loadAdmins();
    }
  }

  document.querySelectorAll('.su-tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      document.querySelectorAll('.su-tab').forEach(function (t) { t.classList.remove('is-active'); });
      document.querySelectorAll('.su-panel').forEach(function (p) { p.style.display = 'none'; });
      tab.classList.add('is-active');
      document.getElementById(tab.dataset.tab).style.display = '';
    });
  });

  async function loadAdminHistory() {
    try {
      var lb = await api('GET', '/api/points/leaderboard');
      document.getElementById('a-history').innerHTML = lb.slice(0, 20).map(function (t) {
        return '<tr><td>' + esc(t.team_name) + '</td><td>' + t.points + '</td><td>—</td><td>—</td></tr>';
      }).join('') || '<tr><td colspan="4">No awards yet</td></tr>';
    } catch (e) {}
  }

  // ---- Team Autocomplete (Admin) ----

  var teamSearchInput = document.getElementById('a-team-search');
  var teamIdInput = document.getElementById('a-team-id');
  var teamSuggestions = document.getElementById('a-team-suggestions');
  var searchTimer;

  teamSearchInput.addEventListener('input', function () {
    clearTimeout(searchTimer);
    teamIdInput.value = '';
    var q = this.value.trim();
    if (q.length < 1) { teamSuggestions.innerHTML = ''; teamSuggestions.style.display = 'none'; return; }
    searchTimer = setTimeout(async function () {
      try {
        var teams = await api('GET', '/api/teams/search?q=' + encodeURIComponent(q));
        if (!teams.length) {
          teamSuggestions.innerHTML = '<div class="ac-item ac-empty">No teams found</div>';
        } else {
          teamSuggestions.innerHTML = teams.map(function (t) {
            return '<div class="ac-item" data-id="' + t.id + '" data-name="' + esc(t.team_name) + '">' +
              esc(t.team_name) +
              (t.verified ? '' : ' <span class="text-dim">(unverified)</span>') +
              '</div>';
          }).join('');
        }
        teamSuggestions.style.display = '';
      } catch (e) {}
    }, 200);
  });

  teamSuggestions.addEventListener('click', function (e) {
    var item = e.target.closest('[data-id]');
    if (!item) return;
    teamSearchInput.value = item.dataset.name;
    teamIdInput.value = item.dataset.id;
    teamSuggestions.style.display = 'none';
  });

  document.addEventListener('click', function (e) {
    if (!e.target.closest('.autocomplete-wrap')) {
      teamSuggestions.style.display = 'none';
    }
  });

  // ---- Award Form ----

  function getAwardData() {
    var form = document.getElementById('award-form');
    var fd = new FormData(form);
    var tid = parseInt(fd.get('team_id'));
    var pts = parseInt(fd.get('points'));
    var reason = fd.get('reason');
    if (!tid) { toast('Select a team first'); return null; }
    if (!pts || pts <= 0) { toast('Enter valid points'); return null; }
    return { team_id: tid, amount: pts, reason: reason, form: form };
  }

  document.getElementById('award-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var d = getAwardData();
    if (!d) return;
    try {
      await api('POST', '/api/points', { team_id: d.team_id, amount: d.amount, reason: d.reason });
      toast('Points awarded!', true);
      d.form.reset();
      document.getElementById('points-qr-result').style.display = 'none';
      loadAdminHistory();
    } catch (err) {
      toast(err.message);
    }
  });

  document.getElementById('gen-qr-btn').addEventListener('click', async function () {
    var d = getAwardData();
    if (!d) return;
    try {
      var result = await api('POST', '/api/points/qr', { team_id: d.team_id, amount: d.amount, reason: d.reason });
      document.getElementById('points-qr-img').src = result.qr;
      document.getElementById('points-qr-label').textContent =
        '+' + result.amount + ' pts for ' + result.team_name + (d.reason ? ' — ' + d.reason : '');
      document.getElementById('points-qr-result').style.display = '';
      toast('QR generated — show it to the team', true);
    } catch (err) {
      toast(err.message);
    }
  });

  // ---- QR Scanner ----

  function parseQrData(decoded) {
    try { return JSON.parse(decoded); } catch (e) {}
    var num = parseInt(decoded);
    return num ? { team_id: num } : null;
  }

  function startQrScanner(readerId, onScan) {
    var reader = document.getElementById(readerId);
    reader.classList.add('is-active');
    if (qrScanner) qrScanner.stop().catch(function () {});
    qrScanner = new Html5Qrcode(readerId);
    qrScanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 250, height: 250 } },
      function (decoded) {
        var data = parseQrData(decoded);
        if (data) { stopQrScanner(); onScan(data); }
      }
    ).catch(function (err) {
      toast('Camera error: ' + err);
      reader.classList.remove('is-active');
    });
  }

  function stopQrScanner() {
    if (qrScanner) { qrScanner.stop().catch(function () {}); qrScanner = null; }
    document.querySelectorAll('.qr-reader').forEach(function (el) { el.classList.remove('is-active'); });
  }

  // Team claims points by scanning admin's QR
  document.getElementById('claim-qr-btn').addEventListener('click', function () {
    startQrScanner('claim-qr-reader', async function (data) {
      if (data.type === 'points' && data.token) {
        try {
          var result = await api('POST', '/api/points/claim', { token: data.token, team_id: teamData.id });
          toast('+' + result.awarded + ' points! ' + (result.reason || ''), true);
          showParticipant();
        } catch (err) {
          toast(err.message);
        }
      } else {
        toast('Not a valid points QR');
      }
    });
  });

  // ---- Superuser helpers ----

  async function loadEvents() {
    try {
      var events = await api('GET', '/api/events');
      document.getElementById('su-event-select').innerHTML = events.map(function (ev) {
        return '<option value="' + ev.id + '">' + esc(ev.name) + '</option>';
      }).join('');
    } catch (e) {}
  }

  async function loadAdmins() {
    try {
      var admins = await api('GET', '/api/admins');
      document.getElementById('su-admin-list').innerHTML = admins.map(function (a) {
        return '<tr><td>' + esc(a.username) + '</td><td>' + esc(a.event_name || '—') + '</td>' +
          '<td><button class="btn-danger" data-del-admin="' + a.id + '">Delete</button></td></tr>';
      }).join('') || '<tr><td colspan="3">No admins</td></tr>';
    } catch (e) {}
  }

  document.getElementById('su-admin-list').addEventListener('click', async function (e) {
    var btn = e.target.closest('[data-del-admin]');
    if (!btn) return;
    try {
      await api('DELETE', '/api/admins/' + btn.dataset.delAdmin);
      toast('Admin removed', true);
      loadAdmins();
    } catch (err) { toast(err.message); }
  });

  document.getElementById('create-admin-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var fd = new FormData(this);
    try {
      await api('POST', '/api/admins', {
        username: fd.get('username'),
        password: fd.get('password'),
        event_scope: parseInt(fd.get('event_id'))
      });
      toast('Admin created!', true);
      this.reset();
      loadAdmins();
    } catch (err) { toast(err.message); }
  });

  async function loadAllTeams() {
    try {
      var teams = await api('GET', '/api/teams');
      document.getElementById('su-team-list').innerHTML = teams.map(function (t) {
        var members = (t.members || []).map(function (m) { return esc(m.name); }).join(', ');
        return '<tr><td>' + t.id + '</td><td>' + esc(t.team_name) + '</td>' +
          '<td>' + t.points + '</td>' +
          '<td>' + (t.verified ? '<i class="fas fa-check" style="color:var(--success)"></i>' : '<i class="fas fa-times" style="color:var(--danger)"></i>') + '</td>' +
          '<td>' + members + '</td></tr>';
      }).join('') || '<tr><td colspan="5">No teams</td></tr>';
    } catch (e) {}
  }

  // ---- Standalone Leaderboard ----

  async function showLeaderboard() {
    try {
      var teams = await api('GET', '/api/points/leaderboard');
      document.getElementById('lb-body').innerHTML = teams.map(function (t, i) {
        var rank = i + 1;
        var cls = rank === 1 ? 'lb-gold' : rank === 2 ? 'lb-silver' : rank === 3 ? 'lb-bronze' : '';
        var icon = rank === 1 ? '<i class="fas fa-trophy"></i> ' : rank === 2 ? '<i class="fas fa-medal"></i> ' : rank === 3 ? '<i class="fas fa-award"></i> ' : '';
        return '<tr><td><span class="lb-rank ' + cls + '">' + icon + rank + '</span></td>' +
          '<td>' + esc(t.team_name) + '</td>' +
          '<td><span class="lb-points">' + t.points + '</span></td></tr>';
      }).join('') || '<tr><td colspan="3">No teams yet</td></tr>';
    } catch (e) {}
    if (lbTimer) clearInterval(lbTimer);
    lbTimer = setInterval(showLeaderboard, 30000);
  }

  // ---- Helpers ----

  function esc(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function timeAgo(ts) {
    if (!ts) return '—';
    var d = new Date(ts);
    var diff = Math.floor((Date.now() - d.getTime()) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return d.toLocaleDateString();
  }

  // ---- Init ----

  async function init() {
    await checkAuth();
    updateNav();
    route();
  }

  init();
})();
