(function () {
  var user = null;
  var teamData = null;
  var lbTimer = null;

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
    if (!isLive) {
      navLinks.querySelectorAll('.pre-event-hide').forEach(function (el) {
        el.style.display = 'none';
      });
    }
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
    if (hash.indexOf('sq-') === 0) {
      var sqToken = decodeURIComponent(hash.slice(3));
      if (teamData) { claimSidequest(sqToken); go('sidequest'); }
      else {
        try { sessionStorage.setItem('pending_sq', sqToken); } catch (e) {}
        toast('Log in with your team to claim this Side Quest');
        go('login');
      }
      return;
    }
    if (hash === 'register') { go('login'); return; }
    if (hash === 'dashboard') {
      if (user) hash = 'admin';
      else if (teamData) hash = 'participant';
      else { go('login'); return; }
    }
    if (hash === 'superuser') hash = 'admin';
    if (hash === 'participant' && !teamData) { go('login'); return; }
    if (hash === 'sidequest' && !teamData && !user) { go('login'); return; }
    if (hash === 'admin' && !user) { go('login'); return; }
    if (hash === 'forgot' || hash === 'reset') { /* allow without auth */ }

    var main = document.querySelector('.main');
    main.classList.toggle('main-home', hash === 'home');

    var duck = document.getElementById('egg-duck');
    if (duck) duck.style.display = hash === 'home' ? '' : 'none';

    document.querySelectorAll('.view').forEach(function (v) { v.classList.remove('is-active'); });
    var el = document.getElementById('view-' + hash);
    if (!el) { el = document.getElementById('view-home'); hash = 'home'; }
    el.classList.add('is-active');

    updateNav();
    // stopQrScanner();
    if (lbTimer) { clearInterval(lbTimer); lbTimer = null; }

    if (hash === 'home') showHome();
    else if (hash === 'leaderboard') showLeaderboard();
    else if (hash === 'participant') showParticipant();
    else if (hash === 'admin') showAdmin();
    else if (hash === 'sidequest') showSidequestPage();
  }

  window.addEventListener('hashchange', route);

  // ---- Auth ----

  async function checkAuth() {
    try {
      var me = await api('GET', '/api/me');
      if (me.role === 'team') {
        saveTeam({ id: me.team_id, team_name: me.username });
        user = null;
      } else {
        user = me;
      }
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

  // ---- Events fetcher (from server cache) ----

  async function fetchSheetEvents() {
    if (sheetEvents) return sheetEvents;
    try {
      sheetEvents = await api('GET', '/api/events/details');
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
    loadHuntLB();
    if (lbTimer) clearInterval(lbTimer);
    lbTimer = setInterval(function () { loadHomeLB(); loadHuntLB(); }, 30000);
  }

  var scheduleLoaded = false;
  async function loadSchedule() {
    if (scheduleLoaded) return;
    try {
      var events = await fetchSheetEvents();
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
          '<div class="schedule-item-right">' +
            (ev.time ? '<span class="schedule-item-time"><i class="fas fa-clock"></i> ' + esc(ev.time) + '</span>' : '') +
            (ev.venue ? '<span class="schedule-item-venue"><i class="fas fa-map-marker-alt"></i> ' + esc(ev.venue) + '</span>' : '') +
          '</div>' +
          '</li>';
      });
      list.innerHTML = html || '<li class="schedule-item" style="color:var(--text-dim)">No events found.</li>';
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

  function fmtDuration(secs) {
    secs = Math.max(0, Math.round(secs));
    var h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), sec = secs % 60;
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m + ':' + (sec < 10 ? '0' : '') + sec;
  }

  async function loadHuntLB() {
    var body = document.getElementById('th-lb-body');
    if (!body) return;
    try {
      var rows = await api('GET', '/api/hunt/leaderboard');
      body.innerHTML = rows.map(function (r) {
        var rank = r.rank;
        var cls = rank === 1 ? 'lb-gold' : rank === 2 ? 'lb-silver' : rank === 3 ? 'lb-bronze' : '';
        return '<tr><td><span class="lb-rank ' + cls + '">' + (rank || '—') + '</span></td>' +
          '<td>' + esc(r.team_name) + (r.test ? ' <span class="text-dim">(test)</span>' : '') + '</td>' +
          '<td>' + (r.finished ? '<strong style="color:#4ecb71">Finished</strong>' : 'Clue ' + Math.min(r.progress + 1, r.total) + ' of ' + r.total) + '</td>' +
          '<td>' + (r.finished ? fmtDuration(r.elapsed_seconds) : '<span class="text-dim">in progress</span>') + '</td>' +
          '<td>+' + (r.hint_minutes || 0) + 'm <span class="text-dim">(' + (r.hints || 0) + ')</span></td>' +
          '<td>+' + (r.skip_minutes || 0) + 'm <span class="text-dim">(' + (r.skips || 0) + ')</span></td>' +
          '<td><span class="lb-points">' + (r.finished ? fmtDuration(r.final_seconds) : '—') + '</span></td></tr>';
      }).join('') || '<tr><td colspan="7" class="text-dim">No team has started yet</td></tr>';
    } catch (e) {
      body.innerHTML = '<tr><td colspan="7" class="text-dim">Leaderboard unavailable</td></tr>';
    }
  }

  // ---- Auth Tabs (Login / Sign Up) ----

  document.querySelectorAll('.auth-tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      document.querySelectorAll('.auth-tab').forEach(function (t) { t.classList.remove('is-active'); });
      document.querySelectorAll('.auth-panel').forEach(function (p) { p.style.display = 'none'; });
      tab.classList.add('is-active');
      document.getElementById(tab.dataset.authTab).style.display = '';
    });
  });

  document.querySelectorAll('[data-open-tab]').forEach(function (link) {
    link.addEventListener('click', function () {
      setTimeout(function () {
        var tabId = link.dataset.openTab;
        document.querySelectorAll('.auth-tab').forEach(function (t) {
          t.classList.toggle('is-active', t.dataset.authTab === tabId);
        });
        document.querySelectorAll('.auth-panel').forEach(function (p) { p.style.display = 'none'; });
        document.getElementById(tabId).style.display = '';
      }, 50);
    });
  });

  // ---- Password Toggle ----

  document.querySelectorAll('.pw-toggle').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var input = this.parentElement.querySelector('input');
      var icon = this.querySelector('i');
      if (input.type === 'password') {
        input.type = 'text';
        icon.className = 'fas fa-eye-slash';
      } else {
        input.type = 'password';
        icon.className = 'fas fa-eye';
      }
    });
  });

  // ---- Unified Login (team first, then admin) ----

  document.getElementById('team-login-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var fd = new FormData(this);
    var name = fd.get('team_name');
    var pw = fd.get('password');
    var errBox = document.getElementById('login-error');
    errBox.style.display = 'none';
    var submitBtn = this.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      var team = await api('POST', '/api/teams/login', {
        team_name: name,
        password: pw
      });
      saveTeam(team);
      toast('Welcome, ' + team.team_name + '!', true);
      this.reset();
      var pendingSq = null;
      try { pendingSq = sessionStorage.getItem('pending_sq'); sessionStorage.removeItem('pending_sq'); } catch (e) {}
      if (pendingSq) claimSidequest(pendingSq);
      go('participant');
    } catch (teamErr) {
      try {
        await api('POST', '/api/login', { username: name, password: pw });
        user = await api('GET', '/api/me');
        toast('Welcome, ' + user.username + '!', true);
        this.reset();
        go('dashboard');
      } catch (adminErr) {
        // Explain what went wrong, in a message that stays on screen.
        var msg;
        if (/incorrect password/i.test(teamErr.message)) {
          msg = 'Wrong password for team "' + String(name).trim() + '". Passwords are case-sensitive. Forgot it? Ask an admin to reset it.';
        } else if (/team not found/i.test(teamErr.message) && /invalid credentials/i.test(adminErr.message)) {
          msg = 'No team or admin called "' + String(name).trim() + '". Check the spelling of your team name exactly as you registered it.';
        } else {
          msg = adminErr.message || teamErr.message || 'Login failed. Please try again.';
        }
        errBox.innerHTML = '<i class="fas fa-exclamation-circle"></i> ' + esc(msg);
        errBox.style.display = '';
        toast('Login failed');
      }
    } finally {
      submitBtn.disabled = false;
    }
  });

  document.getElementById('team-login-form').addEventListener('input', function () {
    document.getElementById('login-error').style.display = 'none';
  });

  // ---- Forgot Password ----

  document.getElementById('forgot-pw-link').addEventListener('click', function (e) {
    e.preventDefault();
    toast('Forgot your password? Ask any Quacks admin/volunteer to reset it for you.', true);
  });

  document.getElementById('forgot-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var fd = new FormData(this);
    try {
      var result = await api('POST', '/api/teams/forgot-password', {
        team_name: fd.get('team_name')
      });
      toast('OTP sent to ' + result.email, true);
      document.getElementById('reset-email').value = result.email;
      document.getElementById('reset-msg').textContent =
        'A code has been sent to ' + result.email + '. Enter it below with your new password.';
      this.reset();
      go('reset');
    } catch (err) {
      toast(err.message);
    }
  });

  document.getElementById('reset-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var fd = new FormData(this);
    try {
      await api('POST', '/api/teams/reset-password', {
        email: fd.get('email'),
        otp: fd.get('otp'),
        new_password: fd.get('new_password')
      });
      toast('Password reset! You can now login.', true);
      this.reset();
      go('login');
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
        '<label class="captain-label"><input type="radio" name="captain" value="' + idx + '" /> Point of Contact</label>' +
      '</div>' +
      '<div class="member-row-pair">' +
        '<input type="text" name="' + prefix + idx + '_name" placeholder="Name *" required />' +
        '<input type="text" name="' + prefix + idx + '_dept" placeholder="Dept. / Where from?" />' +
      '</div>' +
      '<input type="email" name="' + prefix + idx + '_email" placeholder="Email (optional)" />';
    fieldset.appendChild(div);
    syncPocEmail(fieldset);
  }

  // Only the Point of Contact's email is required; the rest are optional.
  function syncPocEmail(fieldset) {
    var form = fieldset.closest('form');
    var checked = form.querySelector('input[name="captain"]:checked');
    var pocIdx = checked ? checked.value : '0';
    fieldset.querySelectorAll('.member-row-stack').forEach(function (row) {
      var email = row.querySelector('input[type="email"]');
      if (!email) return;
      var isPoc = String(row.dataset.idx) === String(pocIdx);
      email.required = isPoc;
      email.placeholder = isPoc ? 'Email * (Point of Contact, required)' : 'Email (optional)';
    });
  }

  ['members-fieldset', 'su-members-fieldset'].forEach(function (id) {
    var fs = document.getElementById(id);
    if (!fs) return;
    fs.addEventListener('change', function (e) {
      if (e.target.name === 'captain') syncPocEmail(fs);
    });
    fs.closest('form').addEventListener('reset', function () { setTimeout(function () { syncPocEmail(fs); }, 0); });
    syncPocEmail(fs);
  });

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
    return { team_name: fd.get('team_name'), password: fd.get('password'), members: members };
  }

  async function handleRegister(form) {
    var payload = collectMembers(form);
    if (!payload.password || payload.password.length < 4) { toast('Password must be at least 4 characters'); return; }
    if (!payload.members.length) { toast('Add at least one member'); return; }
    var captain = payload.members.find(function (m) { return m.is_captain; });
    if (!captain || !captain.email) { toast('Point of Contact must have an email'); return; }
    try {
      var data = await api('POST', '/api/teams', payload);
      toast('Team registered! You can log in now.', true);
      // OTP verification is optional; prefill the verify view in case it's used.
      document.getElementById('verify-email').value = captain.email;
      document.getElementById('verify-msg').textContent =
        'If you received a 6-digit code at ' + captain.email + ', enter it here.';
      form.reset();
      go('login');
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
      var membersHtml = data.members.map(function (m) {
        var info = esc(m.name);
        if (m.dept) info += ' <span class="text-dim" style="font-size:0.8rem">· ' + esc(m.dept) + '</span>';
        return '<li><span>' + info + '</span>' +
          (m.is_captain ? '<span class="member-badge">PoC</span>' : '') + '</li>';
      }).join('');
      document.getElementById('p-members').innerHTML =
        membersHtml || '<li class="text-dim">No members found</li>';

      var qrEl = document.getElementById('p-qr-code');
      qrEl.innerHTML = '';
      if (typeof QRCode !== 'undefined') {
        new QRCode(qrEl, {
          text: JSON.stringify({ team_id: teamData.id, team_name: data.team_name }),
          width: 200, height: 200,
          colorDark: '#000000', colorLight: '#ffffff',
          correctLevel: QRCode.CorrectLevel.H
        });
      }

      var hist = await api('GET', '/api/points/' + teamData.id);
      document.getElementById('p-history').innerHTML = hist.map(function (h) {
        return '<tr><td>' + (h.points > 0 ? '+' : '') + h.points + '</td><td>' + esc(h.reason) + '</td><td>' + timeAgo(h.created_at) + '</td></tr>';
      }).join('') || '<tr><td colspan="3">No points yet</td></tr>';

      loadSidequest();
      loadPlanner();
    } catch (err) {
      if (err.message === 'Not authenticated') {
        clearTeam();
        go('login');
        return;
      }
      toast(err.message);
    }
  }


  // ---- Team Planner ----

  var plannerSchedule = null;

  async function loadPlanner() {
    if (!teamData || !teamData.id) return;
    try {
      if (!plannerSchedule) plannerSchedule = await api('GET', '/api/teams/schedule');
      var data = await api('GET', '/api/teams/' + teamData.id + '/planner');
      var teamInfo = await api('GET', '/api/teams/' + teamData.id);
      var members = (teamInfo.members || []).map(function (m) { return m.name; });
      if (!members.length) members = ['Member 1'];

      var saved = {};
      (data.planner || []).forEach(function (e) {
        saved[e.slot + '|' + e.member] = e.event_id;
      });

      var resultsByMember = {};
      (data.results || []).forEach(function (r) {
        if (r.event_id) {
          var key = r.event_id;
          if (!resultsByMember[key]) resultsByMember[key] = { points: 0, placement: null };
          resultsByMember[key].points += r.points;
          if (r.placement) resultsByMember[key].placement = r.placement;
        }
      });

      var allDayEvents = [];
      var timedSlots = [];
      plannerSchedule.forEach(function (slot) {
        if (slot.slot === 'All day') { allDayEvents = slot.events; }
        else { timedSlots.push(slot); }
      });

      var colCount = Math.min(Math.max(members.length, 1), 3);
      var displayMembers = members.slice(0, colCount);

      var html = '<table class="planner-table"><thead><tr><th>Time Slot</th>';
      displayMembers.forEach(function (m) { html += '<th>' + esc(m) + '</th>'; });
      html += '</tr></thead><tbody>';

      timedSlots.forEach(function (slot) {
        var slotEvents = slot.events.concat(allDayEvents);
        html += '<tr><td class="planner-slot">' + esc(slot.slot) + '</td>';
        displayMembers.forEach(function (m) {
          var key = slot.slot + '|' + m;
          var selVal = saved[key] || '';
          html += '<td><select class="planner-select" data-slot="' + esc(slot.slot) + '" data-member="' + esc(m) + '">';
          html += '<option value="">—</option>';
          slotEvents.forEach(function (ev) {
            var sel = selVal == ev.id ? ' selected' : '';
            var badge = ev.type === 'workshop' ? ' [W]' : ev.type === 'competition' ? ' [C]' : ev.type === 'treasure_hunt' ? ' [TH]' : ev.type === 'victory_point' ? ' [VP]' : '';
            html += '<option value="' + ev.id + '"' + sel + '>' + esc(ev.name) + badge + '</option>';
          });
          html += '</select>';
          var selId = selVal;
          if (selId && resultsByMember[selId]) {
            var r = resultsByMember[selId];
            var label = r.placement ? ' (' + r.placement + ')' : '';
            html += '<div class="planner-cell-pts">' + (r.points > 0 ? '+' : '') + r.points + label + '</div>';
          }
          html += '</td>';
        });
        html += '</tr>';
      });

      html += '</tbody></table>';
      document.getElementById('planner-grid').innerHTML = html;
    } catch (e) {}
  }

  document.getElementById('save-planner').addEventListener('click', async function () {
    var selects = document.querySelectorAll('.planner-select');
    var entries = [];
    selects.forEach(function (sel) {
      if (sel.value) {
        entries.push({ slot: sel.dataset.slot, member: sel.dataset.member, event_id: parseInt(sel.value) });
      }
    });
    try {
      await api('POST', '/api/teams/' + teamData.id + '/planner', { entries: entries });
      toast('Plan saved!', true);
    } catch (e) { toast(e.message); }
  });

  // ---- Browse Events Popup ----

  var browseOverlay = document.getElementById('events-browse-overlay');
  var browseCloseBtn = document.getElementById('events-browse-close');
  var browseList = document.getElementById('events-browse-list');

  function closeBrowsePopup() {
    browseOverlay.classList.remove('is-open');
    document.body.style.overflow = '';
  }

  browseCloseBtn.addEventListener('click', closeBrowsePopup);
  browseOverlay.addEventListener('click', function (e) {
    if (e.target === browseOverlay) closeBrowsePopup();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && browseOverlay.classList.contains('is-open')) closeBrowsePopup();
  });

  document.getElementById('browse-events-btn').addEventListener('click', async function () {
    browseOverlay.classList.add('is-open');
    document.body.style.overflow = 'hidden';
    browseList.innerHTML = '<p class="text-dim" style="text-align:center">Loading events…</p>';

    var events = await fetchSheetEvents();
    if (!events.length) {
      browseList.innerHTML = '<p class="text-dim" style="text-align:center">No events found.</p>';
      return;
    }

    browseList.innerHTML = events.map(function (ev) {
      var theme = detectTheme(ev.name);
      var meta = [ev.time, ev.venue, ev.club].filter(Boolean).join(' · ');
      var regBtn = '';
      return '<div class="events-browse-item" data-event-name="' + esc(ev.name) + '">' +
        '<span class="events-browse-dot" style="background:' + theme.color + '"></span>' +
        '<div class="events-browse-info">' +
          '<div class="events-browse-name">' + esc(ev.name) + '</div>' +
          (meta ? '<div class="events-browse-meta">' + esc(meta) + '</div>' : '') +
        '</div>' +
        '<span class="events-browse-tag" style="color:' + theme.color + ';background:' + theme.color + '18">' + theme.label + '</span>' +
        regBtn +
      '</div>';
    }).join('');
  });

  // Click on event item in browse popup → show detail
  browseList.addEventListener('click', function (e) {
    if (e.target.closest('.events-browse-reg')) return;
    var item = e.target.closest('[data-event-name]');
    if (item) {
      closeBrowsePopup();
      showEventPopup(item.dataset.eventName);
    }
  });

  // ---- Side Quests ----

  // Dashboard preview: title + teaser, full page lives at #sidequest.
  async function loadSidequest() {
    var el = document.getElementById('p-sidequest');
    if (!el) return;
    try {
      var q = await api('GET', '/api/sidequest/current');
      if (q.completed) {
        el.innerHTML = '<p class="text-dim">' + esc(q.message || 'No side quests yet. Check back soon!') + '</p>';
        return;
      }
      var teaser = q.question.length > 90 ? q.question.slice(0, 90) + '…' : q.question;
      el.innerHTML = '<p><span class="member-badge">' + q.points + ' pts</span> <strong>' + esc(q.title) + '</strong></p>' +
        '<p class="card-sub" style="margin-top:0.4rem;white-space:pre-line">' + esc(teaser) + '</p>';
    } catch (e) {
      el.innerHTML = '<p class="text-dim">Side Quest unavailable</p>';
    }
  }

  function showSidequestPage() {
    var el = document.getElementById('sq-page');
    if (el) el.dataset.qid = '';
    loadSidequestPage();
    loadSidequestWinners();
  }

  async function loadSidequestPage() {
    var el = document.getElementById('sq-page');
    if (!el) return;
    try {
      var q = await api('GET', '/api/sidequest/current');
      if (q.completed) {
        el.dataset.qid = '';
        el.innerHTML = '<div class="sq-empty"><i class="fas fa-hourglass-half"></i>' +
          '<h2>' + esc(q.message || 'No side quests yet. Check back soon!') + '</h2>' +
          '<p class="card-sub">A new side quest can drop at any time. This page checks every few seconds.</p></div>';
        return;
      }
      if (el.dataset.qid === q.id) return; // don't wipe a half-typed answer
      el.dataset.qid = q.id;
      var html = '<div class="sq-head"><span class="sq-label">' + esc(q.title) + '</span>' +
        '<span class="sq-points">+' + q.points + ' pts</span></div>' +
        '<p class="sq-question">' + esc(q.question) + '</p>';
      if (!teamData) {
        html += '<p class="card-sub">Admins can view the live side quest here. Teams answer from their login.</p>';
      } else if (q.attempted) {
        html += '<div class="sq-locked"><i class="fas fa-lock"></i> Your team has used its one try on this side quest. Wait for the next one!</div>';
      } else if (q.answer_method === 'text') {
        html += '<form id="sq-page-form" class="sq-form" autocomplete="off">' +
          '<input type="text" name="answer" required placeholder="Type your answer… (one try only!)" />' +
          '<button type="submit" class="btn"><i class="fas fa-paper-plane"></i> Submit Answer</button></form>';
      } else {
        html += '<a href="https://quarks.ug.iisc.ac.in/qr-scanner" target="_blank" rel="noopener" class="btn"><i class="fas fa-camera"></i> Open QR Scanner</a>';
      }
      html += '<p class="card-sub" style="margin-top:0.8rem"><i class="fas fa-bolt"></i> First team to solve it wins. Be quick!</p>';
      el.innerHTML = html;
      var form = document.getElementById('sq-page-form');
      if (form) form.addEventListener('submit', async function (e) {
        e.preventDefault();
        var btn = form.querySelector('button');
        if (!confirm('You get ONE try per side quest. Submit this answer?')) return;
        btn.disabled = true;
        try {
          var r = await api('POST', '/api/sidequest/answer', { answer: new FormData(form).get('answer'), quest_id: q.id });
          toast('Correct! +' + r.points + ' points to your team!', true);
          showSidequestPage();
        } catch (err) {
          toast(err.message);
          showSidequestPage();
        }
      });
    } catch (e) {
      el.innerHTML = '<p class="text-dim">Side Quest unavailable</p>';
    }
  }

  async function loadSidequestWinners() {
    var tbody = document.getElementById('sq-winners');
    if (!tbody) return;
    try {
      var list = await api('GET', '/api/sidequest/winners');
      tbody.innerHTML = list.map(function (w) {
        return '<tr><td>' + esc(w.title) + ' <span class="text-dim">(' + esc(w.quest_id) + ')</span></td><td>' + esc(w.team_name) +
          '<br><span class="text-dim">' + timeAgo(w.created_at) + '</span></td><td>+' + w.points + '</td></tr>';
      }).join('') || '<tr><td colspan="3" class="text-dim">None yet. Be the first!</td></tr>';
    } catch (e) {
      tbody.innerHTML = '<tr><td colspan="3" class="text-dim">—</td></tr>';
    }
  }

  async function claimSidequest(token) {
    try {
      var r = await api('POST', '/api/sidequest/claim', { token: token });
      toast('Side Quest "' + r.title + '" solved! +' + r.points + ' points', true);
      if (location.hash === '#participant') showParticipant();
    } catch (err) {
      toast(err.message);
    }
  }

  // ---- Side quest drop bell (teams) ----

  var bellEl = document.getElementById('nav-bell');
  var bellDot = document.getElementById('nav-bell-dot');
  var SQ_SEEN_KEY = 'quarks_sq_seen';

  function setBell(on) {
    bellDot.classList.toggle('is-on', on);
    bellEl.classList.toggle('is-ringing', on);
  }

  async function checkSidequestDrop() {
    if (!teamData || user) { bellEl.style.display = 'none'; return; }
    bellEl.style.display = '';
    try {
      var q = await api('GET', '/api/sidequest/current');
      if (q.completed) { setBell(false); return; }
      var seen = null;
      try { seen = localStorage.getItem(SQ_SEEN_KEY); } catch (e) {}
      if (location.hash === '#sidequest') {
        try { localStorage.setItem(SQ_SEEN_KEY, q.id); } catch (e) {}
        setBell(false);
        return;
      }
      if (seen !== q.id && !q.attempted) {
        if (!bellDot.classList.contains('is-on')) {
          toast('🔔 New side quest dropped! Tap the bell to play.', true);
          if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
        }
        setBell(true);
      } else {
        setBell(false);
      }
    } catch (e) {}
  }

  bellEl.addEventListener('click', function () { setBell(false); });
  window.addEventListener('hashchange', checkSidequestDrop);
  setInterval(checkSidequestDrop, 10000);
  setTimeout(checkSidequestDrop, 1500);

  // Keep the participant's side quest fresh so teams see when it's been taken.
  setInterval(function () {
    if (location.hash === '#participant' || (location.hash === '#dashboard' && teamData && !user)) loadSidequest();
    if (location.hash === '#sidequest') { loadSidequestPage(); loadSidequestWinners(); }
  }, 5000);

  // ---- Side Quest admin ----

  async function loadSidequestAdmin() {
    var tbody = document.getElementById('sq-admin-list');
    if (!tbody) return;
    try {
      var list = await api('GET', '/api/sidequest/admin');
      tbody.innerHTML = list.map(function (q) {
        var color = q.status === 'active' ? '#4ecb71' : q.status === 'solved' ? '#8a8780' : q.status === 'needs answer' ? '#e06c6c' : '';
        var actions = q.status === 'solved' ? '' :
          '<button type="button" class="btn btn-compact btn-outline" data-sq-edit="' + esc(q.id) + '">Edit answer</button> ' +
          '<button type="button" class="btn btn-compact btn-danger" data-sq-del="' + esc(q.id) + '"><i class="fas fa-trash"></i></button>';
        return '<tr><td>' + esc(q.id) + '</td>' +
          '<td style="color:' + color + ';font-weight:600">' + esc(q.status) + '</td>' +
          '<td style="white-space:pre-line;max-width:320px">' + esc(q.title) + ': ' + esc(q.question) + '</td>' +
          '<td>' + esc((q.answer || []).join(', ')) + '</td>' +
          '<td>' + q.points + '</td>' +
          '<td>' + (q.solved_by ? esc(q.solved_by) + '<br><span class="text-dim">' + esc(q.solved_at || '') + '</span>' : '—') + '</td>' +
          '<td>' + actions + '</td></tr>';
      }).join('') || '<tr><td colspan="7" class="text-dim">No side quests yet</td></tr>';
    } catch (err) {
      tbody.innerHTML = '<tr><td colspan="7">' + esc(err.message) + '</td></tr>';
    }
  }

  document.getElementById('refresh-sq-admin').addEventListener('click', loadSidequestAdmin);

  document.getElementById('sq-admin-list').addEventListener('click', async function (e) {
    var edit = e.target.closest('[data-sq-edit]');
    var del = e.target.closest('[data-sq-del]');
    try {
      if (edit) {
        var ans = prompt('New answer(s) for ' + edit.dataset.sqEdit + ' (comma separated):');
        if (!ans) return;
        await api('PUT', '/api/sidequest/admin/' + encodeURIComponent(edit.dataset.sqEdit), { answer: ans });
        toast('Answer updated', true);
      } else if (del) {
        if (!confirm('Delete side quest ' + del.dataset.sqDel + '?')) return;
        await api('DELETE', '/api/sidequest/admin/' + encodeURIComponent(del.dataset.sqDel));
        toast('Deleted', true);
      } else return;
      loadSidequestAdmin();
    } catch (err) {
      toast(err.message);
    }
  });

  document.getElementById('sq-add-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var fd = new FormData(this);
    try {
      var q = await api('POST', '/api/sidequest/admin', {
        title: fd.get('title'), question: fd.get('question'), answer: fd.get('answer'), points: fd.get('points')
      });
      toast('Added ' + q.id + ' to the queue', true);
      this.reset();
      loadSidequestAdmin();
    } catch (err) {
      toast(err.message);
    }
  });

  // ---- Team Photos (treasure hunt) ----

  function isHuntAdmin() {
    if (!user) return false;
    if (user.role === 'superuser') return true;
    return (user.event_names || []).indexOf('Duck Duck Loot') !== -1;
  }

  async function loadHuntPhotos() {
    var el = document.getElementById('admin-photos-container');
    if (!el) return;
    el.innerHTML = '<p class="text-dim">Loading…</p>';
    try {
      var photos = await api('GET', '/api/hunt/photos');
      var byTeam = {};
      photos.forEach(function (p) { (byTeam[p.team_name] = byTeam[p.team_name] || []).push(p); });
      var names = Object.keys(byTeam).sort(function (a, b) { return a.localeCompare(b); });
      el.innerHTML = names.map(function (name) {
        return '<div class="photo-team"><h3>' + esc(name) + ' <small class="text-dim">(' + byTeam[name].length + ')</small></h3><div class="photo-grid">' +
          byTeam[name].map(function (p) {
            var src = '/api/hunt/photos/' + encodeURIComponent(p.filename);
            return '<a class="photo-item" href="' + src + '" target="_blank" rel="noopener">' +
              '<img src="' + src + '" alt="" loading="lazy" />' +
              '<span>' + esc(p.quest_title || p.quest_id || '') + '</span>' +
              '<span class="text-dim">' + esc(p.uploaded_at || '') + '</span></a>';
          }).join('') + '</div></div>';
      }).join('') || '<p class="text-dim">No photos uploaded yet</p>';
    } catch (err) {
      el.innerHTML = '<p class="text-dim">' + esc(err.message) + '</p>';
    }
  }

  document.getElementById('refresh-photos').addEventListener('click', loadHuntPhotos);

  function fmtDuration(secs) {
    if (secs === null || secs === undefined) return '—';
    var h = Math.floor(secs / 3600), m = Math.floor(secs / 60) % 60, sec = secs % 60;
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m + ':' + (sec < 10 ? '0' : '') + sec;
  }

  function fmtClock(iso) {
    if (!iso) return '—';
    var m = String(iso).match(/T(\d\d:\d\d)/);
    return m ? m[1] : esc(iso);
  }

  async function loadHuntProgress() {
    var tbody = document.getElementById('hunt-progress-body');
    if (!tbody) return;
    try {
      var rows = await api('GET', '/api/hunt/progress');
      tbody.innerHTML = rows.map(function (r) {
        var pct = r.total ? Math.round(r.progress / r.total * 100) : 0;
        return '<tr' + (r.finished ? ' style="background:rgba(78,203,113,0.08)"' : '') + '>' +
          '<td>' + (r.rank || '') + '</td>' +
          '<td>' + esc(r.team_name) + (r.test ? ' <span class="text-dim">(test)</span>' : '') + '</td>' +
          '<td><div class="hp-bar"><span style="width:' + pct + '%"></span></div>' + r.progress + '/' + r.total + '</td>' +
          '<td>' + (r.finished ? '<strong style="color:#4ecb71">Finished ' + fmtClock(r.finished_at) + '</strong>' :
            r.current_location ? 'Clue ' + r.current_clue + ': ' + esc(r.current_location) : '—') + '</td>' +
          '<td>' + r.hints + '</td><td>' + r.skips + '</td>' +
          '<td>+' + r.penalty_minutes + 'm</td>' +
          '<td>' + fmtClock(r.last_activity) + '</td>' +
          '<td><strong>' + fmtDuration(r.final_seconds) + '</strong></td></tr>';
      }).join('') || '<tr><td colspan="9" class="text-dim">No teams have opened the hunt yet</td></tr>';
    } catch (err) {
      tbody.innerHTML = '<tr><td colspan="9">' + esc(err.message) + '</td></tr>';
    }
  }

  document.getElementById('refresh-hunt-progress').addEventListener('click', loadHuntProgress);
  setInterval(function () {
    var panel = document.getElementById('admin-hunt-progress');
    if (location.hash === '#admin' && panel && panel.style.display !== 'none') loadHuntProgress();
  }, 15000);

  // ---- Admin (unified with superuser) ----

  async function showAdmin() {
    if (!user) return;

    var isSuperuser = user.role === 'superuser';
    document.getElementById('a-scope').textContent = isSuperuser
      ? 'Superuser — ' + user.username
      : user.event_names && user.event_names.length ? 'Managing: ' + user.event_names.join(', ') : 'All events';

    document.querySelectorAll('.su-only').forEach(function (el) {
      el.style.display = isSuperuser ? '' : 'none';
    });
    document.querySelectorAll('.su-tab.th-only').forEach(function (el) {
      el.style.display = isHuntAdmin() ? '' : 'none';
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
      if (tab.dataset.tab === 'admin-photos') loadHuntPhotos();
      if (tab.dataset.tab === 'admin-hunt-progress') loadHuntProgress();
      if (tab.dataset.tab === 'admin-sidequests') loadSidequestAdmin();
    });
  });

  async function loadAdminHistory() {
    try {
      var logs = await api('GET', '/api/points/recent');
      document.getElementById('a-history').innerHTML = logs.map(function (l) {
        return '<tr><td>' + esc(l.team_name) + '</td><td>' + (l.points > 0 ? '+' : '') + l.points + '</td><td>' + esc(l.reason || '—') + '</td><td>' + timeAgo(l.created_at) + '</td></tr>';
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
    loadTeamHistoryPreview(item.dataset.id, item.dataset.name);
  });

  async function loadTeamHistoryPreview(teamId, teamName) {
    var wrap = document.getElementById('team-history-preview');
    document.getElementById('thp-team-name').textContent = '— ' + teamName;
    try {
      var logs = await api('GET', '/api/points/' + teamId);
      if (!logs.length) {
        document.getElementById('thp-list').innerHTML = '<p class="text-dim">No points awarded yet</p>';
      } else {
        var total = logs.reduce(function (sum, l) { return sum + (parseInt(l.points, 10) || 0); }, 0);
        document.getElementById('thp-list').innerHTML =
          '<div class="thp-total">TOTAL: <strong' + (total < 0 ? ' style="color:#e06c6c"' : '') + '>' + total + '</strong> points</div>' +
          '<table><thead><tr><th>Points</th><th>Reason</th><th>When</th></tr></thead><tbody>' +
          logs.slice(0, 10).map(function (l) {
            return '<tr><td>' + (l.points > 0 ? '+' : '') + l.points + '</td><td>' + esc(l.reason || '—') + '</td><td>' + timeAgo(l.created_at) + '</td></tr>';
          }).join('') + '</tbody>' +
          '<tfoot><tr><th>' + total + '</th><th colspan="2">TOTAL' + (logs.length > 10 ? ' (all ' + logs.length + ' entries)' : '') + '</th></tr></tfoot></table>';
      }
      wrap.style.display = '';
    } catch (e) { wrap.style.display = 'none'; }
  }

  document.addEventListener('click', function (e) {
    if (!e.target.closest('.autocomplete-wrap')) {
      teamSuggestions.style.display = 'none';
    }
  });

  // ---- Award Form (with event & placement) ----

  var POINTS_MAP = {
    'attended': 300,
    'participation': 50,
    '1st': null, '2nd': null, '3rd': null,
    'side_quest': 100,
    'ticket_minus_100': -100,
    'ticket_minus_300': -300,
    'custom': null
  };
  var COMPETITION_POINTS = { '1st': 1200, '2nd': 900, '3rd': 600 };
  var HUNT_POINTS = { '1st': 1500, '2nd': 1200, '3rd': 800 };

  var aEventSelect = document.getElementById('a-event-select');
  var aPlacement = document.getElementById('a-placement-select');
  var aPointsInput = document.getElementById('a-points-input');
  var aReasonInput = document.getElementById('a-reason-input');

  var REASON_MAP = {
    'attended': 'Attended workshop',
    'participation': 'Participation',
    '1st': '1st Place',
    '2nd': '2nd Place',
    '3rd': '3rd Place',
    'side_quest': 'Side Quest completion',
    'ticket_minus_100': '-100 Point Ticket',
    'ticket_minus_300': '-300 Point Ticket'
  };

  (async function loadAwardEvents() {
    try {
      var schedule = await api('GET', '/api/teams/schedule');
      var seen = {};
      schedule.forEach(function (s) {
        s.events.forEach(function (ev) {
          if (!seen[ev.id]) {
            seen[ev.id] = true;
            var opt = document.createElement('option');
            opt.value = ev.id;
            opt.textContent = ev.name;
            opt.dataset.type = ev.type;
            aEventSelect.appendChild(opt);
          }
        });
      });
    } catch (e) {}
  })();

  aPlacement.addEventListener('change', function () {
    var pl = this.value;
    var evName = aEventSelect.selectedOptions[0] ? aEventSelect.selectedOptions[0].textContent : '';
    if (!pl || pl === 'custom') {
      aPointsInput.value = ''; aPointsInput.readOnly = false;
      aReasonInput.value = ''; aReasonInput.readOnly = false;
      return;
    }
    var fixed = POINTS_MAP[pl];
    if (fixed !== null && fixed !== undefined) {
      aPointsInput.value = fixed; aPointsInput.readOnly = true;
    } else {
      var selOpt = aEventSelect.selectedOptions[0];
      var evType = selOpt ? selOpt.dataset.type : '';
      if (evType === 'treasure_hunt') {
        aPointsInput.value = HUNT_POINTS[pl] || ''; aPointsInput.readOnly = true;
      } else {
        aPointsInput.value = COMPETITION_POINTS[pl] || ''; aPointsInput.readOnly = true;
      }
    }
    var reason = REASON_MAP[pl] || '';
    // Only tag a real event onto the reason; never the placeholder option text.
    if (reason && aEventSelect.value && evName) reason = reason + ' — ' + evName;
    aReasonInput.value = reason;
    aReasonInput.readOnly = !!reason;
  });

  aEventSelect.addEventListener('change', function () {
    var selOpt = aEventSelect.selectedOptions[0];
    var evType = selOpt ? selOpt.dataset.type : '';
    var huntOpts = aPlacement.querySelectorAll('.hunt-only');
    huntOpts.forEach(function (o) { o.style.display = evType === 'treasure_hunt' ? '' : 'none'; });
    aPlacement.dispatchEvent(new Event('change'));
  });

  function getAwardData() {
    var form = document.getElementById('award-form');
    var fd = new FormData(form);
    var tid = parseInt(fd.get('team_id'));
    var pts = parseInt(fd.get('points'));
    var reason = fd.get('reason');
    if (!tid) { toast('Select a team first'); return null; }
    if (!pts || pts === 0 || pts < -5000 || pts > 5000) { toast('Enter points between -5000 and 5000'); return null; }
    return {
      team_id: tid, amount: pts, reason: reason, form: form,
      event_id: fd.get('event_id') || undefined,
      placement: fd.get('placement') || undefined
    };
  }

  document.getElementById('award-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var d = getAwardData();
    if (!d) return;
    try {
      var res = await api('POST', '/api/points', {
        team_id: d.team_id, amount: d.amount, reason: d.reason,
        event_id: d.event_id, placement: d.placement
      });
      toast('Points awarded! New TOTAL: ' + res.total, true);
      d.form.reset();
      document.getElementById('team-history-preview').style.display = 'none';
      loadAdminHistory();
    } catch (err) {
      toast(err.message);
    }
  });


  // ---- QR Scanner (opens popup on HTTPS static site) ----

  var QR_SCANNER_URL = 'https://quarks.ug.iisc.ac.in/qr-scanner';

  document.getElementById('open-qr-scan').addEventListener('click', function () {
    window.open(QR_SCANNER_URL, 'qr-scanner', 'width=420,height=520,menubar=no,toolbar=no');
  });

  window.addEventListener('message', function (ev) {
    if (!ev.data || ev.data.type !== 'qr-scan') return;
    var decoded = ev.data.data;
    if (!decoded) return;

    var teamId = null;
    try {
      var obj = JSON.parse(decoded);
      teamId = obj.team_id || obj.id;
    } catch (e) {
      teamId = parseInt(decoded);
    }
    if (!teamId || isNaN(teamId)) {
      toast('QR not recognized: ' + decoded);
      return;
    }

    teamIdInput.value = teamId;
    api('GET', '/api/teams/' + teamId).then(function (t) {
      teamSearchInput.value = t.team_name;
      toast('Team: ' + t.team_name, true);
      loadTeamHistoryPreview(teamId, t.team_name);
    }).catch(function () {
      toast('Team #' + teamId + ' not found');
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
        return '<tr><td>' + esc(a.username) + '</td><td>' + (a.event_names && a.event_names.length ? a.event_names.map(esc).join(', ') : '—') + '</td>' +
          '<td><button class="btn-danger" data-del-admin="' + a.id + '">Delete</button></td></tr>';
      }).join('') || '<tr><td colspan="3">No admins</td></tr>';
    } catch (e) {}
  }

  document.getElementById('su-admin-list').addEventListener('click', async function (e) {
    var btn = e.target.closest('[data-del-admin]');
    if (!btn) return;
    var row = btn.closest('tr');
    var who = row && row.cells[0] ? row.cells[0].textContent.trim() : 'this admin';
    if (!confirm('Delete admin "' + who + '"? They will no longer be able to log in.')) return;
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
        event_scope: fd.getAll('event_id').map(function (v) { return parseInt(v); })
      });
      toast('Admin created!', true);
      this.reset();
      loadAdmins();
    } catch (err) { toast(err.message); }
  });

  function renderTeamRows(teams, isSu) {
    return teams.map(function (t) {
      var members = (t.members || []).map(function (m) { return esc(m.name); }).join(', ');
      return '<tr' + (isSu ? ' class="clickable-row" data-team-id="' + t.id + '"' : '') + '><td>' + t.id + '</td><td>' + esc(t.team_name) + '</td>' +
        '<td>' + t.points + '</td>' +
        '<td>' + (t.verified ? '<i class="fas fa-check" style="color:var(--success)"></i>' : '<i class="fas fa-times" style="color:var(--danger)"></i>') + '</td>' +
        '<td>' + members + '</td>' +
        (isSu ? '<td><button class="btn btn-compact btn-sm" data-team-id="' + t.id + '"><i class="fas fa-eye"></i> Details</button></td>' : '') + '</tr>';
    }).join('') || '<tr><td colspan="5">No teams</td></tr>';
  }

  function buildTeamTable(title, teams, isSu) {
    return '<h3 style="margin:1.2rem 0 0.5rem;font-family:var(--font-pixel);color:var(--accent)">' + esc(title) + '</h3>' +
      '<div class="table-wrap"><table>' +
      '<thead><tr><th>#</th><th>Team</th><th>Points</th><th>Verified</th><th>Members</th>' + (isSu ? '<th></th>' : '') + '</tr></thead>' +
      '<tbody>' + renderTeamRows(teams, isSu) + '</tbody></table></div>';
  }

  async function loadAllTeams() {
    try {
      var data = await api('GET', '/api/teams');
      var isSu = user && user.role === 'superuser';
      var container = document.getElementById('admin-teams-container');

      if (data.grouped) {
        var html = '';
        var keys = Object.keys(data.grouped);
        for (var i = 0; i < keys.length; i++) {
          var g = data.grouped[keys[i]];
          html += buildTeamTable(g.event_name, g.teams, isSu);
        }
        container.innerHTML = html || '<p>No participating teams yet.</p>';
      } else {
        container.innerHTML = buildTeamTable('All Teams', data, isSu);
      }
    } catch (e) {}
  }

  // ---- Team Detail Overlay (superuser) ----

  document.getElementById('admin-teams-container').addEventListener('click', function (e) {
    var row = e.target.closest('[data-team-id]');
    if (!row) return;
    openTeamDetail(parseInt(row.dataset.teamId));
  });

  document.getElementById('team-detail-close').addEventListener('click', function () {
    document.getElementById('team-detail-overlay').style.display = 'none';
  });

  var currentDetailTeamId = null;

  async function openTeamDetail(teamId) {
    currentDetailTeamId = teamId;
    var overlay = document.getElementById('team-detail-overlay');
    overlay.style.display = 'flex';

    try {
      var t = await api('GET', '/api/teams/' + teamId);
      document.getElementById('td-title').textContent = t.team_name;

      // Info fields (editable)
      document.getElementById('td-info').innerHTML =
        '<div class="td-field">' +
          '<label>Team Name</label>' +
          '<input type="text" id="td-name" value="' + esc(t.team_name) + '" />' +
        '</div>' +
        '<div class="td-field">' +
          '<label>Points</label>' +
          '<input type="number" id="td-points" value="' + t.points + '" min="-99999" max="99999" />' +
        '</div>' +
        '<div class="td-field">' +
          '<label>Verified</label>' +
          '<select id="td-verified"><option value="1"' + (t.verified ? ' selected' : '') + '>Yes</option><option value="0"' + (!t.verified ? ' selected' : '') + '>No</option></select>' +
        '</div>' +
        '<div class="td-field">' +
          '<label>Created</label>' +
          '<span class="text-dim">' + (t.created_at || '—') + '</span>' +
        '</div>' +
        '<button class="btn btn-compact" id="td-save-info"><i class="fas fa-save"></i> Save</button>';

      document.getElementById('td-save-info').addEventListener('click', async function () {
        try {
          await api('PATCH', '/api/teams/' + teamId, {
            team_name: document.getElementById('td-name').value,
            points: parseInt(document.getElementById('td-points').value),
            verified: parseInt(document.getElementById('td-verified').value)
          });
          toast('Team updated!', true);
          loadAllTeams();
          document.getElementById('td-title').textContent = document.getElementById('td-name').value;
        } catch (err) { toast(err.message); }
      });

      // Members (editable)
      document.getElementById('td-members').innerHTML = (t.members || []).map(function (m) {
        return '<div class="td-member" data-member-id="' + m.id + '">' +
          '<div class="td-member-fields">' +
            '<input type="text" value="' + esc(m.name) + '" data-field="name" placeholder="Name" />' +
            '<input type="text" value="' + esc(m.email || '') + '" data-field="email" placeholder="Email" />' +
            '<input type="text" value="' + esc(m.dept || '') + '" data-field="dept" placeholder="Dept" />' +
            '<label class="td-poc-label"><input type="checkbox" data-field="is_captain"' + (m.is_captain ? ' checked' : '') + ' /> PoC</label>' +
          '</div>' +
          '<button class="btn btn-compact td-member-save"><i class="fas fa-save"></i></button>' +
        '</div>';
      }).join('') || '<p class="text-dim">No members</p>';

      document.getElementById('td-members').querySelectorAll('.td-member-save').forEach(function (btn) {
        btn.addEventListener('click', async function () {
          var wrap = this.closest('[data-member-id]');
          var mid = wrap.dataset.memberId;
          var data = {};
          wrap.querySelectorAll('[data-field]').forEach(function (inp) {
            if (inp.type === 'checkbox') data[inp.dataset.field] = inp.checked ? 1 : 0;
            else data[inp.dataset.field] = inp.value;
          });
          try {
            await api('PATCH', '/api/teams/' + teamId + '/members/' + mid, data);
            toast('Member updated!', true);
            loadAllTeams();
          } catch (err) { toast(err.message); }
        });
      });

      // Point logs
      renderDetailLogs(t.point_logs || []);

    } catch (err) {
      toast(err.message);
      overlay.style.display = 'none';
    }
  }

  function renderDetailLogs(logs) {
    document.getElementById('td-logs').innerHTML = logs.map(function (l) {
      return '<tr><td>' + (l.points > 0 ? '+' : '') + l.points + '</td>' +
        '<td>' + esc(l.reason || '—') + '</td>' +
        '<td>' + esc(l.awarded_by_name || 'system') + '</td>' +
        '<td>' + timeAgo(l.created_at) + '</td>' +
        '<td><button class="btn-icon td-del-log" data-log-id="' + l.id + '" title="Delete"><i class="fas fa-trash"></i></button></td></tr>';
    }).join('') || '<tr><td colspan="5" class="text-dim">No history</td></tr>';

    document.getElementById('td-logs').querySelectorAll('.td-del-log').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        if (!confirm('Delete this point log entry? Team points will be adjusted.')) return;
        try {
          await api('DELETE', '/api/teams/' + currentDetailTeamId + '/logs/' + this.dataset.logId);
          toast('Log deleted', true);
          openTeamDetail(currentDetailTeamId);
          loadAllTeams();
        } catch (err) { toast(err.message); }
      });
    });
  }

  document.getElementById('td-reset-pw').addEventListener('click', async function () {
    var pw = prompt('New password for this team (min 4 characters):');
    if (!pw) return;
    try {
      await api('POST', '/api/teams/' + currentDetailTeamId + '/password', { password: pw });
      toast('Password reset. Tell the team their new password.', true);
    } catch (err) { toast(err.message); }
  });

  document.getElementById('td-delete-team').addEventListener('click', async function () {
    if (!confirm('DELETE this entire team? This cannot be undone.')) return;
    try {
      await api('DELETE', '/api/teams/' + currentDetailTeamId);
      toast('Team deleted', true);
      document.getElementById('team-detail-overlay').style.display = 'none';
      loadAllTeams();
    } catch (err) { toast(err.message); }
  });

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
    var d = new Date(ts + (ts.indexOf('+') === -1 && ts.indexOf('Z') === -1 ? 'Z' : ''));
    var ist = new Date(d.getTime() + 330 * 60000);
    var h = ist.getUTCHours();
    var m = ist.getUTCMinutes();
    var ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    var time = h + ':' + (m < 10 ? '0' : '') + m + ' ' + ampm;
    var today = new Date(Date.now() + 330 * 60000);
    if (ist.getUTCFullYear() === today.getUTCFullYear() && ist.getUTCMonth() === today.getUTCMonth() && ist.getUTCDate() === today.getUTCDate()) {
      return time;
    }
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return ist.getUTCDate() + ' ' + months[ist.getUTCMonth()] + ', ' + time;
  }

  // ---- Countdown ----

  // Registrations/leaderboard open from midnight; the countdown runs to the 10:00 AM start.
  var EVENT_DATE = new Date('2026-10-11T00:00:00+05:30').getTime();
  var START_DATE = new Date('2026-10-11T10:00:00+05:30').getTime();
  var isLive = Date.now() >= EVENT_DATE;

  function pad(n) { return n < 10 ? '0' + n : n; }

  function startCountdown() {
    var wrap = document.getElementById('countdown');
    if (!wrap) return;
    var dEl = document.getElementById('qp-days');
    var hEl = document.getElementById('qp-hours');
    var mEl = document.getElementById('qp-mins');
    var sEl = document.getElementById('qp-secs');

    function tick() {
      if (!isLive && Date.now() >= EVENT_DATE) goLive();
      var diff = START_DATE - Date.now();
      if (diff <= 0) {
        wrap.classList.add('is-live');
        return;
      }
      dEl.textContent = pad(Math.floor(diff / 86400000));
      hEl.textContent = pad(Math.floor((diff % 86400000) / 3600000));
      mEl.textContent = pad(Math.floor((diff % 3600000) / 60000));
      sEl.textContent = pad(Math.floor((diff % 60000) / 1000));
    }
    tick();
    setInterval(tick, 1000);

    // Shuffle animation on click
    wrap.addEventListener('click', function (e) {
      var box = e.target.closest('.countdown-box');
      if (!box) return;
      var numEl = box.querySelector('.countdown-num');
      if (!numEl || numEl.dataset.shuffling) return;
      numEl.dataset.shuffling = '1';
      var real = numEl.textContent;
      var count = 0;
      var iv = setInterval(function () {
        numEl.textContent = pad(Math.floor(Math.random() * 100));
        numEl.style.color = 'hsl(' + (count * 30 % 360) + ', 60%, 65%)';
        count++;
        if (count >= 10) {
          clearInterval(iv);
          numEl.textContent = real;
          numEl.style.color = '';
          delete numEl.dataset.shuffling;
        }
      }, 60);
    });
  }

  function goLive() {
    isLive = true;
    document.querySelectorAll('.pre-event-hide').forEach(function (el) {
      el.classList.remove('pre-event-hide');
    });
    var cd = document.getElementById('countdown');
    if (cd) {
      cd.querySelectorAll('.countdown-soon, .countdown-info').forEach(function (el) { el.style.display = 'none'; });
      if (Date.now() >= START_DATE) cd.classList.add('is-live');
    }
    updateNav();
  }

  // ---- Init ----

  async function init() {
    await checkAuth();
    if (isLive) goLive();
    startCountdown();
    updateNav();
    route();
  }

  init();
})();
