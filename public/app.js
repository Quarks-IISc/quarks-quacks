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
    if (hash === 'register') { go('login'); return; }
    if (hash === 'dashboard') {
      if (user) hash = 'admin';
      else if (teamData) hash = 'participant';
      else { go('login'); return; }
    }
    if (hash === 'superuser') hash = 'admin';
    if (hash === 'participant' && !teamData) { go('login'); return; }
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
      if (match.regLink) {
        html += '<a href="' + esc(match.regLink) + '" target="_blank" rel="noopener" class="btn" style="margin-top:1rem;width:auto;display:inline-flex">' +
          '<i class="fas fa-external-link-alt"></i> Register for this event</a>';
      }
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
    try {
      var team = await api('POST', '/api/teams/login', {
        team_name: name,
        password: pw
      });
      saveTeam(team);
      toast('Welcome, ' + team.team_name + '!', true);
      this.reset();
      go('participant');
    } catch (teamErr) {
      try {
        await api('POST', '/api/login', { username: name, password: pw });
        user = await api('GET', '/api/me');
        toast('Welcome, ' + user.username + '!', true);
        this.reset();
        go('dashboard');
      } catch (adminErr) {
        toast(teamErr.message);
      }
    }
  });

  // ---- Forgot Password ----

  document.getElementById('forgot-pw-link').addEventListener('click', function (e) {
    e.preventDefault();
    go('forgot');
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
      var membersHtml = data.members.map(function (m) {
        var info = esc(m.name);
        if (m.dept) info += ' <span class="text-dim" style="font-size:0.8rem">· ' + esc(m.dept) + '</span>';
        return '<li><span>' + info + '</span>' +
          (m.is_captain ? '<span class="member-badge">PoC</span>' : '') + '</li>';
      }).join('');
      document.getElementById('p-members').innerHTML =
        membersHtml || '<li class="text-dim">No members found</li>';

      var hist = await api('GET', '/api/points/' + teamData.id);
      document.getElementById('p-history').innerHTML = hist.map(function (h) {
        return '<tr><td>+' + h.points + '</td><td>' + esc(h.reason) + '</td><td>' + timeAgo(h.created_at) + '</td></tr>';
      }).join('') || '<tr><td colspan="3">No points yet</td></tr>';

    } catch (err) {
      if (err.message === 'Not authenticated') {
        clearTeam();
        go('login');
        return;
      }
      toast(err.message);
    }
  }


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
      if (ev.regLink) {
        regBtn = '<a href="' + esc(ev.regLink) + '" target="_blank" rel="noopener" class="events-browse-reg" onclick="event.stopPropagation()">' +
          '<i class="fas fa-external-link-alt"></i> Register</a>';
      }
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
        document.getElementById('thp-list').innerHTML = '<table><thead><tr><th>Points</th><th>Reason</th><th>When</th></tr></thead><tbody>' +
          logs.slice(0, 10).map(function (l) {
            return '<tr><td>+' + l.points + '</td><td>' + esc(l.reason || '—') + '</td><td>' + timeAgo(l.created_at) + '</td></tr>';
          }).join('') + '</tbody></table>';
      }
      wrap.style.display = '';
    } catch (e) { wrap.style.display = 'none'; }
  }

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
    if (!pts || pts === 0 || pts < -5000 || pts > 5000) { toast('Enter points between -5000 and 5000'); return null; }
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
      document.getElementById('team-history-preview').style.display = 'none';
      loadAdminHistory();
    } catch (err) {
      toast(err.message);
    }
  });


  /* ---- QR Scanner (disabled — admins award points directly) ----

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
      stopQrScanner();
    });
  }

  function stopQrScanner() {
    if (qrScanner) { qrScanner.stop().catch(function () {}); qrScanner = null; }
    document.querySelectorAll('.qr-reader').forEach(function (el) { el.classList.remove('is-active'); });
  }

  async function handleClaimQr(data) {
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
  }

  document.getElementById('claim-qr-btn').addEventListener('click', function () {
    startQrScanner('claim-qr-reader', handleClaimQr);
  });

  ---- end QR Scanner ---- */


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

  // ---- Countdown ----

  var EVENT_DATE = new Date('2026-10-11T00:00:00+05:30').getTime();
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
      var diff = EVENT_DATE - Date.now();
      if (diff <= 0) {
        wrap.classList.add('is-live');
        goLive();
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
    if (cd) cd.classList.add('is-live');
    updateNav();
  }

  // ---- Init ----

  async function init() {
    await checkAuth();
    if (isLive) goLive();
    else startCountdown();
    updateNav();
    route();
  }

  init();
})();
