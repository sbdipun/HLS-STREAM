/**
 * HLS Stream Pro — Admin Panel JS
 * Full CRUD admin panel with stream config, headers, cookies, schedule
 */

(function () {
  'use strict';

  // ─── Constants ────────────────────────────────────────────────────────────
  const STORAGE_KEY = 'hlsStreamProConfig';
  const ADMIN_PASS_KEY = 'hlsAdminAuthed';
  const DEFAULT_PASSWORD = 'admin123';

  // ─── State ────────────────────────────────────────────────────────────────
  let state = {
    authed: false,
    config: {
      name: '',
      description: '',
      url: '',
      thumbnail: '',
      type: 'hls',
      withCredentials: false,
      active: true,
      headers: {},
      cookies: {},
      hlsOptions: {
        lowLatency: true,
        backBuffer: 90,
        maxBuffer: 30,
        startLevel: -1,
        manifestOverride: '',
      },
    },
    schedule: [],
  };

  // ─── DOM Refs ─────────────────────────────────────────────────────────────
  const loginScreen   = document.getElementById('loginScreen');
  const adminApp      = document.getElementById('adminApp');
  const loginPassword = document.getElementById('loginPassword');
  const loginBtn      = document.getElementById('loginBtn');
  const loginError    = document.getElementById('loginError');
  const logoutBtn     = document.getElementById('logoutBtn');
  const saveBtn       = document.getElementById('saveBtn');
  const saveIndicator = document.getElementById('saveIndicator');
  const menuToggle    = document.getElementById('menuToggle');
  const adminSidebar  = document.getElementById('adminSidebar');
  const toastContainer = document.getElementById('toastContainer');

  // Stream fields
  const fStreamName    = document.getElementById('streamName');
  const fStreamDesc    = document.getElementById('streamDesc');
  const fStreamUrl     = document.getElementById('streamUrl');
  const fStreamThumb   = document.getElementById('streamThumb');
  const fStreamType    = document.getElementById('streamType');
  const fWithCred      = document.getElementById('withCredentials');
  const fStreamActive  = document.getElementById('streamActive');
  const fLowLatency    = document.getElementById('lowLatency');
  const fBackBuffer    = document.getElementById('backBuffer');
  const fMaxBuffer     = document.getElementById('maxBuffer');
  const fStartLevel    = document.getElementById('startLevel');
  const fManifest      = document.getElementById('manifestOverride');
  const testUrlBtn     = document.getElementById('testUrlBtn');
  const urlTestResult  = document.getElementById('urlTestResult');
  const streamStatus   = document.getElementById('streamStatus');
  const streamStatusTxt= document.getElementById('streamStatusText');

  // Headers
  const headersList  = document.getElementById('headersList');
  const headersEmpty = document.getElementById('headersEmpty');
  const addHeaderBtn = document.getElementById('addHeaderBtn');

  // Cookies
  const cookiesList  = document.getElementById('cookiesList');
  const cookiesEmpty = document.getElementById('cookiesEmpty');
  const addCookieBtn = document.getElementById('addCookieBtn');

  // Schedule
  const programsList  = document.getElementById('programsList');
  const programsEmpty = document.getElementById('programsEmpty');
  const addProgramBtn = document.getElementById('addProgramBtn');
  const programForm   = document.getElementById('programForm');
  const cancelProgBtn = document.getElementById('cancelProgBtn');
  const saveProgBtn   = document.getElementById('saveProgBtn');
  const progTitle     = document.getElementById('progTitle');
  const progGenre     = document.getElementById('progGenre');
  const progStart     = document.getElementById('progStart');
  const progEnd       = document.getElementById('progEnd');
  const progDesc      = document.getElementById('progDesc');

  // Preview
  const loadPreviewBtn  = document.getElementById('loadPreviewBtn');
  const previewPlaceholder = document.getElementById('previewPlaceholder');
  const previewVideo    = document.getElementById('previewVideo');
  const previewInfo     = document.getElementById('previewInfo');
  const piStatus        = document.getElementById('piStatus');
  const piUrl           = document.getElementById('piUrl');

  // Nav items
  const navItems = document.querySelectorAll('.nav-item');
  const tabs     = document.querySelectorAll('.tab-content');
  const pageTitle= document.getElementById('pageTitle');

  const TAB_TITLES = {
    stream:   'Stream Configuration',
    headers:  'HTTP Headers',
    cookies:  'Cookie Manager',
    schedule: 'Program Schedule',
    preview:  'Live Preview',
  };

  // ─── Auth ─────────────────────────────────────────────────────────────────
  function checkAuth() {
    const authed = sessionStorage.getItem(ADMIN_PASS_KEY);
    if (authed === 'yes') {
      showAdmin();
    }
  }

  loginBtn.addEventListener('click', doLogin);
  loginPassword.addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });

  function doLogin() {
    const pwd = loginPassword.value;
    // Check against stored password or default
    const storedPwd = localStorage.getItem('hlsAdminPassword') || DEFAULT_PASSWORD;
    if (pwd === storedPwd) {
      sessionStorage.setItem(ADMIN_PASS_KEY, 'yes');
      loginError.style.display = 'none';
      showAdmin();
    } else {
      loginError.style.display = 'block';
      loginPassword.value = '';
      loginPassword.focus();
    }
  }

  logoutBtn.addEventListener('click', () => {
    sessionStorage.removeItem(ADMIN_PASS_KEY);
    adminApp.style.display = 'none';
    loginScreen.style.display = 'flex';
    loginPassword.value = '';
  });

  function showAdmin() {
    loginScreen.style.display = 'none';
    adminApp.style.display = 'flex';
    loadState();
    populateForm();
    renderHeaders();
    renderCookies();
    renderSchedule();
    updateStreamStatus();
  }

  // ─── State Persistence ────────────────────────────────────────────────────
  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        state.config   = { ...state.config, ...parsed.config };
        state.schedule = parsed.schedule || [];
      }
    } catch (_) {}
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        config: state.config,
        schedule: state.schedule,
      }));
      // Also write to streamConfig key for player.js
      localStorage.setItem('streamConfig', JSON.stringify(state.config));
      localStorage.setItem('scheduleItems', JSON.stringify(state.schedule));
    } catch (_) {}
    showSaveIndicator();
  }

  async function persistToServer() {
    // Try to save to CF Pages Functions KV
    try {
      await fetch('/api/admin/stream', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': getAdminToken() },
        body: JSON.stringify(state.config),
      });
      await fetch('/api/admin/schedule', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': getAdminToken() },
        body: JSON.stringify(state.schedule),
      });
    } catch (_) {
      // Silent fail — localStorage is used as fallback
    }
  }

  function getAdminToken() {
    return btoa(localStorage.getItem('hlsAdminPassword') || DEFAULT_PASSWORD);
  }

  // ─── Save ─────────────────────────────────────────────────────────────────
  saveBtn.addEventListener('click', async () => {
    collectFormData();
    collectHeaders();
    collectCookies();
    saveState();
    await persistToServer();
    updateStreamStatus();
    toast('Configuration saved!', 'success');
  });

  function showSaveIndicator() {
    saveIndicator.style.display = 'flex';
    setTimeout(() => { saveIndicator.style.display = 'none'; }, 3000);
  }

  // ─── Form Population ──────────────────────────────────────────────────────
  function populateForm() {
    const c = state.config;
    fStreamName.value   = c.name || '';
    fStreamDesc.value   = c.description || '';
    fStreamUrl.value    = c.url || '';
    fStreamThumb.value  = c.thumbnail || '';
    fStreamType.value   = c.type || 'hls';
    fWithCred.checked   = c.withCredentials || false;
    fStreamActive.checked = c.active !== false;
    const o = c.hlsOptions || {};
    fLowLatency.checked = o.lowLatency !== false;
    fBackBuffer.value   = o.backBuffer || 90;
    fMaxBuffer.value    = o.maxBuffer || 30;
    fStartLevel.value   = o.startLevel !== undefined ? o.startLevel : -1;
    fManifest.value     = o.manifestOverride || '';
  }

  function collectFormData() {
    state.config.name        = fStreamName.value.trim();
    state.config.description = fStreamDesc.value.trim();
    state.config.url         = fStreamUrl.value.trim();
    state.config.thumbnail   = fStreamThumb.value.trim();
    state.config.type        = fStreamType.value;
    state.config.withCredentials = fWithCred.checked;
    state.config.active      = fStreamActive.checked;
    state.config.hlsOptions  = {
      lowLatency:       fLowLatency.checked,
      backBuffer:       parseInt(fBackBuffer.value) || 90,
      maxBuffer:        parseInt(fMaxBuffer.value) || 30,
      startLevel:       parseInt(fStartLevel.value),
      manifestOverride: fManifest.value.trim(),
    };
  }

  function updateStreamStatus() {
    const active = state.config.active && !!state.config.url;
    const el = document.getElementById('streamStatus');
    if (active) {
      el.classList.add('active');
      streamStatusTxt.textContent = 'Active';
    } else {
      el.classList.remove('active');
      streamStatusTxt.textContent = state.config.url ? 'Inactive' : 'No URL';
    }
  }

  // ─── URL Test ─────────────────────────────────────────────────────────────
  testUrlBtn.addEventListener('click', async () => {
    const url = fStreamUrl.value.trim();
    if (!url) { toast('Enter a URL first', 'error'); return; }
    urlTestResult.style.display = 'block';
    urlTestResult.className = 'url-test-result';
    urlTestResult.textContent = 'Testing...';
    try {
      const res = await fetch(url, { method: 'HEAD', mode: 'no-cors' });
      urlTestResult.className = 'url-test-result ok';
      urlTestResult.textContent = '✓ URL is reachable (note: no-cors mode, CORS headers may differ in player)';
    } catch (e) {
      // no-cors may not throw, try GET
      try {
        await fetch(url, { signal: AbortSignal.timeout(5000) });
        urlTestResult.className = 'url-test-result ok';
        urlTestResult.textContent = '✓ URL responded successfully';
      } catch (e2) {
        urlTestResult.className = 'url-test-result err';
        urlTestResult.textContent = `✗ ${e2.message || 'Could not reach URL'}`;
      }
    }
  });

  // ─── Headers ──────────────────────────────────────────────────────────────
  function renderHeaders() {
    headersList.innerHTML = '';
    const entries = Object.entries(state.config.headers || {});
    headersEmpty.style.display = entries.length ? 'none' : 'flex';
    entries.forEach(([k, v]) => addHeaderRow(k, v));
  }

  function addHeaderRow(key = '', val = '') {
    headersEmpty.style.display = 'none';
    const row = document.createElement('div');
    row.className = 'kv-row';
    row.innerHTML = `
      <input type="text" class="kv-key" placeholder="Header-Name" value="${escHtml(key)}" />
      <input type="text" class="kv-val" placeholder="value" value="${escHtml(val)}" />
      <button class="kv-remove" title="Remove">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M2 2l8 8M10 2l-8 8"/>
        </svg>
      </button>`;
    row.querySelector('.kv-remove').addEventListener('click', () => {
      row.remove();
      if (!headersList.children.length) headersEmpty.style.display = 'flex';
    });
    headersList.appendChild(row);
  }

  function collectHeaders() {
    const rows = headersList.querySelectorAll('.kv-row');
    state.config.headers = {};
    rows.forEach(row => {
      const k = row.querySelector('.kv-key').value.trim();
      const v = row.querySelector('.kv-val').value.trim();
      if (k) state.config.headers[k] = v;
    });
  }

  addHeaderBtn.addEventListener('click', () => addHeaderRow());

  // Header presets
  document.querySelectorAll('.preset-chip:not(.cookie-preset)').forEach(chip => {
    chip.addEventListener('click', () => {
      addHeaderRow(chip.dataset.key, chip.dataset.val);
    });
  });

  // ─── Cookies ──────────────────────────────────────────────────────────────
  function renderCookies() {
    cookiesList.innerHTML = '';
    const entries = Object.entries(state.config.cookies || {});
    cookiesEmpty.style.display = entries.length ? 'none' : 'flex';
    entries.forEach(([k, v]) => addCookieRow(k, v));
  }

  function addCookieRow(key = '', val = '') {
    cookiesEmpty.style.display = 'none';
    const row = document.createElement('div');
    row.className = 'kv-row';
    row.innerHTML = `
      <input type="text" class="kv-key" placeholder="cookie_name" value="${escHtml(key)}" />
      <input type="text" class="kv-val" placeholder="cookie_value" value="${escHtml(val)}" />
      <button class="kv-remove" title="Remove">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M2 2l8 8M10 2l-8 8"/>
        </svg>
      </button>`;
    row.querySelector('.kv-remove').addEventListener('click', () => {
      row.remove();
      if (!cookiesList.children.length) cookiesEmpty.style.display = 'flex';
    });
    cookiesList.appendChild(row);
  }

  function collectCookies() {
    const rows = cookiesList.querySelectorAll('.kv-row');
    state.config.cookies = {};
    rows.forEach(row => {
      const k = row.querySelector('.kv-key').value.trim();
      const v = row.querySelector('.kv-val').value.trim();
      if (k) state.config.cookies[k] = v;
    });
  }

  addCookieBtn.addEventListener('click', () => addCookieRow());

  // Cookie presets
  document.querySelectorAll('.cookie-preset').forEach(chip => {
    chip.addEventListener('click', () => {
      addCookieRow(chip.dataset.key, chip.dataset.val);
    });
  });

  // ─── Schedule ─────────────────────────────────────────────────────────────
  function renderSchedule() {
    programsList.innerHTML = '';
    const items = state.schedule;
    programsEmpty.style.display = items.length ? 'none' : 'flex';
    const now = new Date();
    items
      .slice()
      .sort((a, b) => new Date(a.startTime) - new Date(b.startTime))
      .forEach((item, idx) => {
        const start = new Date(item.startTime);
        const end   = new Date(item.endTime);
        const isActive = now >= start && now < end;
        const el = document.createElement('div');
        el.className = 'program-item' + (isActive ? ' active-prog' : '');
        el.innerHTML = `
          <div class="prog-time">${formatDT(start)} – ${formatDT(end)}</div>
          <div class="prog-info">
            <div class="prog-title">${escHtml(item.title)}</div>
            ${item.genre ? `<div class="prog-genre">${escHtml(item.genre)}</div>` : ''}
          </div>
          ${isActive ? `<span class="prog-on-air">● ON AIR</span>` : ''}
          <div class="prog-actions">
            <button class="prog-del-btn" data-id="${item.id}" title="Delete">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M2 2l8 8M10 2l-8 8"/>
              </svg>
            </button>
          </div>`;
        el.querySelector('.prog-del-btn').addEventListener('click', () => {
          state.schedule = state.schedule.filter(s => s.id !== item.id);
          renderSchedule();
        });
        programsList.appendChild(el);
      });
  }

  addProgramBtn.addEventListener('click', () => {
    programForm.style.display = 'block';
    progTitle.focus();
    // Set default times
    const now = new Date();
    const later = new Date(now.getTime() + 60 * 60 * 1000);
    progStart.value = toDatetimeLocal(now);
    progEnd.value   = toDatetimeLocal(later);
  });

  cancelProgBtn.addEventListener('click', () => {
    programForm.style.display = 'none';
    clearProgForm();
  });

  saveProgBtn.addEventListener('click', () => {
    const title = progTitle.value.trim();
    if (!title) { toast('Program title is required', 'error'); return; }
    if (!progStart.value || !progEnd.value) { toast('Start and end time are required', 'error'); return; }
    const item = {
      id: Date.now().toString(),
      title,
      genre:       progGenre.value.trim(),
      description: progDesc.value.trim(),
      startTime:   new Date(progStart.value).toISOString(),
      endTime:     new Date(progEnd.value).toISOString(),
    };
    state.schedule.push(item);
    renderSchedule();
    programForm.style.display = 'none';
    clearProgForm();
    toast('Program added', 'success');
  });

  function clearProgForm() {
    progTitle.value = '';
    progGenre.value = '';
    progStart.value = '';
    progEnd.value   = '';
    progDesc.value  = '';
  }

  function toDatetimeLocal(date) {
    const pad = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function formatDT(date) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // ─── Preview ──────────────────────────────────────────────────────────────
  let previewHls = null;

  loadPreviewBtn.addEventListener('click', () => {
    collectFormData();
    collectHeaders();
    collectCookies();
    const url = state.config.url;
    if (!url) { toast('No stream URL configured', 'error'); return; }

    previewPlaceholder.style.display = 'none';
    previewVideo.style.display = 'block';
    previewInfo.style.display  = 'block';
    piUrl.textContent = url;

    if (previewHls) { previewHls.destroy(); previewHls = null; }

    if (Hls.isSupported()) {
      const headers = state.config.headers || {};
      previewHls = new Hls({
        xhrSetup: (xhr) => {
          Object.entries(headers).forEach(([k, v]) => { try { xhr.setRequestHeader(k, v); } catch(_){} });
          xhr.withCredentials = state.config.withCredentials;
        },
      });
      previewHls.loadSource(url);
      previewHls.attachMedia(previewVideo);
      previewHls.on(Hls.Events.MANIFEST_PARSED, () => {
        previewVideo.play().catch(() => {});
        piStatus.textContent = '✓ Playing';
        piStatus.style.color = '#34d399';
      });
      previewHls.on(Hls.Events.ERROR, (_, d) => {
        if (d.fatal) {
          piStatus.textContent = '✗ Error: ' + d.details;
          piStatus.style.color = '#f87171';
        }
      });
    } else if (previewVideo.canPlayType('application/vnd.apple.mpegurl')) {
      previewVideo.src = url;
      previewVideo.play().catch(() => {});
      piStatus.textContent = '✓ Playing (Native HLS)';
    } else {
      piStatus.textContent = '✗ HLS not supported';
    }
  });

  // ─── Tab Navigation ───────────────────────────────────────────────────────
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const tab = item.dataset.tab;
      navItems.forEach(n => n.classList.remove('active'));
      tabs.forEach(t => t.classList.remove('active'));
      item.classList.add('active');
      document.getElementById(`tab-${tab}`).classList.add('active');
      pageTitle.textContent = TAB_TITLES[tab] || tab;
      if (window.innerWidth <= 768) adminSidebar.classList.remove('open');
    });
  });

  menuToggle.addEventListener('click', () => {
    adminSidebar.classList.toggle('open');
  });

  // ─── Toast ────────────────────────────────────────────────────────────────
  function toast(message, type = 'info') {
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.innerHTML = `
      ${type === 'success' ? '✓' : type === 'error' ? '✗' : 'ℹ'} ${escHtml(message)}`;
    toastContainer.appendChild(el);
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 350);
    }, 3000);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────
  function escHtml(s) {
    return String(s)
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;');
  }

  // ─── Init ─────────────────────────────────────────────────────────────────
  checkAuth();

})();
