/**
 * HLS Stream Pro — Player JS
 * ExoPlayer-style HLS player with full control support
 */

(function () {
  'use strict';

  // ─── State ───────────────────────────────────────────────────────────────
  let hls         = null;   // HLS.js instance (for .m3u8 streams)
  let shakaPl     = null;   // Shaka Player instance (for .mpd / DASH streams)
  let activeType  = 'hls';  // 'hls' | 'dash' | 'native'
  let streamConfig = null;
  let controlsTimeout = null;
  let isFullscreen = false;
  let statsInterval = null;
  const formatBadge = document.getElementById('formatBadge');

  // ─── DOM Refs ─────────────────────────────────────────────────────────────
  const video         = document.getElementById('videoEl');
  const playerWrap    = document.getElementById('playerWrap');
  const exoPlayer     = document.getElementById('exoPlayer');
  const tapOverlay    = document.getElementById('tapOverlay');
  const tapPlayBtn    = document.getElementById('tapPlayBtn');
  const bufferOverlay = document.getElementById('bufferOverlay');
  const errorOverlay  = document.getElementById('errorOverlay');
  const errorMsg      = document.getElementById('errorMsg');
  const retryBtn      = document.getElementById('retryBtn');
  const centerAnim    = document.getElementById('centerAnim');
  const exoControls   = document.getElementById('exoControls');
  const playPauseBtn  = document.getElementById('playPauseBtn');
  const muteBtn       = document.getElementById('muteBtn');
  const volumeSlider  = document.getElementById('volumeSlider');
  const fullscreenBtn = document.getElementById('fullscreenBtn');
  const pipBtn        = document.getElementById('pipBtn');
  const settingsBtn   = document.getElementById('settingsBtn');
  const settingsPanel = document.getElementById('settingsPanel');
  const qualitySelect = document.getElementById('qualitySelect');
  const speedPills    = document.querySelectorAll('.speed-pill');
  const progressBar   = document.getElementById('progressBar');
  const progressFill  = document.getElementById('progressFill');
  const progressBuf   = document.getElementById('progressBuffered');
  const progressThumb = document.getElementById('progressThumb');
  const currentTime   = document.getElementById('currentTime');
  const liveIndicator = document.getElementById('liveIndicator');
  const noStreamMsg   = document.getElementById('noStreamMsg');
  const channelName   = document.getElementById('channelName');
  const channelDesc   = document.getElementById('channelDesc');
  const channelThumb  = document.getElementById('channelThumb');
  const scheduleList  = document.getElementById('scheduleList');
  const skipBackBtn   = document.getElementById('skipBackBtn');

  // Stats
  const statCodec      = document.getElementById('statCodec');
  const statResolution = document.getElementById('statResolution');
  const statBitrate    = document.getElementById('statBitrate');
  const statBuffer     = document.getElementById('statBuffer');
  const statLatency    = document.getElementById('statLatency');

  // ─── Init ─────────────────────────────────────────────────────────────────
  async function init() {
    await loadStreamConfig();
    await loadSchedule();
    setupControls();
  }

  // ─── Load Stream Config ───────────────────────────────────────────────────
  async function loadStreamConfig() {
    try {
      const res = await fetch('/api/stream');
      if (!res.ok) throw new Error('No config');
      const data = await res.json();
      streamConfig = data;

      if (!data.url) {
        showNoStream();
        return;
      }

      updateBanner(data);
      setupPlayer(data);
    } catch (e) {
      // Try localStorage fallback (for demo without CF functions)
      const local = localStorage.getItem('streamConfig');
      if (local) {
        try {
          const data = JSON.parse(local);
          if (data.url) {
            streamConfig = data;
            updateBanner(data);
            setupPlayer(data);
            return;
          }
        } catch (_) {}
      }
      showNoStream();
    }
  }

  function updateBanner(data) {
    channelName.textContent = data.name || 'Live Stream';
    channelDesc.textContent = data.description || 'Live broadcast';
    if (data.thumbnail) {
      channelThumb.innerHTML = `<img src="${data.thumbnail}" alt="thumb" />`;
    }
    liveIndicator.classList.add('visible');
  }

  function showNoStream() {
    playerWrap.style.display = 'none';
    noStreamMsg.style.display = 'flex';
    document.querySelector('.now-playing-banner').style.display = 'none';
  }

  // ─── Detect Stream Format ─────────────────────────────────────────────────
  function detectFormat(url) {
    // Strip query string for extension check, but keep full URL for matching
    const clean = url.split('?')[0].toLowerCase();
    if (clean.endsWith('.mpd') || url.includes('.mpd?') || url.includes('/dash/') || url.includes('proto=dash')) {
      return 'dash';
    }
    // m3u8 / hls
    return 'hls';
  }

  // ─── Setup Player (HLS + DASH) ────────────────────────────────────────────
  async function setupPlayer(config) {
    destroyPlayer();

    const rawUrl  = config.rawUrl || config.url;
    const headers = config.headers || {};
    const cookies = config.cookies || {};
    const format  = detectFormat(rawUrl);
    activeType = format;

    // Update format badge
    if (formatBadge) {
      formatBadge.textContent = format === 'dash' ? 'DASH' : 'HLS';
      formatBadge.style.background = format === 'dash'
        ? 'linear-gradient(135deg,#f59e0b,#ef4444)'
        : 'linear-gradient(135deg,#6C63FF,#E040FB)';
    }

    // Auto-proxy when cookies/headers present
    const needsProxy = !!config.useProxy || Object.keys(cookies).length > 0 || Object.keys(headers).length > 0;
    let streamUrl = rawUrl;
    if (needsProxy && !streamUrl.startsWith('/api/proxy')) {
      const hData = { headers, cookies };
      try {
        const hParam = btoa(unescape(encodeURIComponent(JSON.stringify(hData))));
        streamUrl = `/api/proxy?url=${encodeURIComponent(rawUrl)}&h=${encodeURIComponent(hParam)}`;
      } catch (_) {
        streamUrl = `/api/proxy?url=${encodeURIComponent(rawUrl)}`;
      }
    }

    playerWrap.style.display = 'block';
    noStreamMsg.style.display = 'none';
    document.querySelector('.now-playing-banner').style.display = 'flex';

    // ── MPEG-DASH via Shaka Player ──────────────────────────────────────────
    if (format === 'dash' && typeof shaka !== 'undefined') {
      shaka.polyfill.installAll();
      if (!shaka.Player.isBrowserSupported()) {
        showError('Your browser does not support DASH streaming.');
        return;
      }

      shakaPl = new shaka.Player(video);

      // Network request filter — inject headers for un-proxied requests
      if (!needsProxy && (Object.keys(headers).length || Object.keys(cookies).length)) {
        shakaPl.getNetworkingEngine().registerRequestFilter((type, request) => {
          Object.entries(headers).forEach(([k, v]) => {
            request.headers[k] = v;
          });
          const cookieStr = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
          if (cookieStr) request.headers['Cookie'] = cookieStr;
        });
      }

      shakaPl.configure({
        streaming: {
          bufferingGoal: 30,
          rebufferingGoal: 2,
          bufferBehind: 30,
          retryParameters: {
            maxAttempts: 4,
            baseDelay: 1000,
            backoffFactor: 2,
          },
        },
        abr: {
          enabled: true,
          defaultBandwidthEstimate: 5e6,
        },
      });

      shakaPl.addEventListener('error', (e) => {
        const err = e.detail;
        if (err.severity === shaka.util.Error.Severity.CRITICAL) {
          showError(`DASH error (${err.code}). Retrying in 5s...`);
          setTimeout(() => setupPlayer(config), 5000);
        }
      });

      shakaPl.addEventListener('buffering', (e) => {
        e.buffering ? showBuffering() : hideBuffering();
      });

      try {
        await shakaPl.load(streamUrl);
        populateQualityLevelsDash();
        showTapOverlay();
        startStatsPolling();
      } catch (err) {
        showError(`Failed to load DASH stream: ${err.message || err.code}`);
      }

    // ── HLS via HLS.js ─────────────────────────────────────────────────────
    } else if (format === 'hls' && Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 90,
        xhrSetup: function (xhr) {
          if (!needsProxy) {
            Object.entries(headers).forEach(([k, v]) => {
              try { xhr.setRequestHeader(k, v); } catch (_) {}
            });
            const cookieStr = Object.entries(cookies)
              .map(([k, v]) => `${k}=${v}`).join('; ');
            if (cookieStr) {
              try { xhr.setRequestHeader('Cookie', cookieStr); } catch (_) {}
            }
          }
          xhr.withCredentials = !!config.withCredentials;
        },
      });

      hls.loadSource(streamUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
        populateQualityLevelsHls(data.levels);
        showTapOverlay();
        startStatsPolling();
      });

      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hls.recoverMediaError();
              break;
            default:
              showError('Fatal stream error. Retrying in 5s...');
              setTimeout(() => setupPlayer(config), 5000);
          }
        }
      });

      hls.on(Hls.Events.FRAG_BUFFERED, () => hideBuffering());

    } else if (video.canPlayType('application/vnd.apple.mpegurl') || video.canPlayType('application/dash+xml')) {
      // Native (Safari / iOS — supports both HLS and DASH natively)
      activeType = 'native';
      video.src = streamUrl;
      showTapOverlay();
    } else {
      showError('Your browser does not support this stream format.');
      return;
    }

    // Video events
    video.addEventListener('waiting', showBuffering);
    video.addEventListener('playing', hideBuffering);
    video.addEventListener('pause', onPause);
    video.addEventListener('play', onPlay);
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('progress', onProgress);
    video.addEventListener('volumechange', onVolumeChange);
  }

  function destroyPlayer() {
    if (hls) { hls.destroy(); hls = null; }
    if (shakaPl) { shakaPl.destroy(); shakaPl = null; }
    stopStatsPolling();
    activeType = 'hls';
    video.removeEventListener('waiting', showBuffering);
    video.removeEventListener('playing', hideBuffering);
    video.removeEventListener('pause', onPause);
    video.removeEventListener('play', onPlay);
    video.removeEventListener('timeupdate', onTimeUpdate);
    video.removeEventListener('progress', onProgress);
    video.removeEventListener('volumechange', onVolumeChange);
    // Reset quality dropdown
    qualitySelect.innerHTML = '<option value="-1">Auto</option>';
  }

  // ─── Quality Levels (HLS.js) ──────────────────────────────────────────────
  function populateQualityLevelsHls(levels) {
    qualitySelect.innerHTML = '<option value="-1">Auto</option>';
    if (!levels || !levels.length) return;
    // Sort levels by height descending
    const sorted = levels
      .map((lvl, i) => ({ ...lvl, originalIndex: i }))
      .sort((a, b) => (b.height || 0) - (a.height || 0));
    sorted.forEach((lvl) => {
      const opt = document.createElement('option');
      opt.value = lvl.originalIndex;
      const fps = lvl.attrs && lvl.attrs.FRAME_RATE ? ` ${Math.round(parseFloat(lvl.attrs.FRAME_RATE))}fps` : '';
      const label = lvl.height ? `${lvl.height}p${fps}` : `${Math.round((lvl.bitrate || 0) / 1000)}kbps`;
      opt.textContent = label;
      qualitySelect.appendChild(opt);
    });
  }

  // ─── Quality Levels (Shaka / DASH) ───────────────────────────────────────
  function populateQualityLevelsDash() {
    if (!shakaPl) return;
    qualitySelect.innerHTML = '<option value="auto">Auto</option>';
    try {
      const tracks = shakaPl.getVariantTracks();
      // Deduplicate by height & bandwidth
      const seen = new Set();
      const unique = tracks
        .filter(t => {
          const key = `${t.height}|${Math.round((t.bandwidth || 0) / 1000)}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .sort((a, b) => (b.height || 0) - (a.height || 0));

      unique.forEach((t) => {
        const opt = document.createElement('option');
        opt.value = t.id;
        const fps = t.frameRate ? ` ${Math.round(t.frameRate)}fps` : '';
        const label = t.height ? `${t.height}p${fps}` : `${Math.round((t.bandwidth || 0) / 1000)}kbps`;
        opt.textContent = label;
        qualitySelect.appendChild(opt);
      });
    } catch (_) {}
  }

  qualitySelect.addEventListener('change', () => {
    const val = qualitySelect.value;
    if (activeType === 'dash' && shakaPl) {
      if (val === 'auto' || val === '-1') {
        shakaPl.configure({ abr: { enabled: true } });
      } else {
        shakaPl.configure({ abr: { enabled: false } });
        const tracks = shakaPl.getVariantTracks();
        const target = tracks.find(t => String(t.id) === String(val));
        if (target) shakaPl.selectVariantTrack(target, true);
      }
    } else if (activeType === 'hls' && hls) {
      const level = parseInt(val);
      hls.currentLevel = isNaN(level) ? -1 : level;
    }
  });

  // ─── Controls Setup ───────────────────────────────────────────────────────
  function setupControls() {
    // Play/Pause
    playPauseBtn.addEventListener('click', togglePlay);
    tapPlayBtn.addEventListener('click', startPlay);

    // Mute
    muteBtn.addEventListener('click', toggleMute);

    // Volume
    volumeSlider.value = 80;
    video.volume = 0.8;
    volumeSlider.addEventListener('input', () => {
      video.volume = volumeSlider.value / 100;
      video.muted = video.volume === 0;
      updateMuteIcon();
    });

    // Fullscreen
    fullscreenBtn.addEventListener('click', toggleFullscreen);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);

    // PiP
    pipBtn.addEventListener('click', async () => {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (video.requestPictureInPicture) {
        await video.requestPictureInPicture();
      }
    });

    // Settings
    settingsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isHidden = settingsPanel.style.display === 'none';
      settingsPanel.style.display = isHidden ? 'block' : 'none';
    });
    document.addEventListener('click', (e) => {
      if (!settingsPanel.contains(e.target) && e.target !== settingsBtn) {
        settingsPanel.style.display = 'none';
      }
    });

    // Speed pills
    speedPills.forEach(pill => {
      pill.addEventListener('click', () => {
        speedPills.forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        video.playbackRate = parseFloat(pill.dataset.speed);
      });
    });

    // Skip back
    skipBackBtn.addEventListener('click', () => {
      video.currentTime = Math.max(0, video.currentTime - 10);
      showCenterAnim('⏪');
    });

    // Controls auto-hide
    exoPlayer.addEventListener('mousemove', showControls);
    exoPlayer.addEventListener('mouseleave', scheduleHideControls);
    exoPlayer.addEventListener('click', (e) => {
      if (e.target === video || e.target === exoPlayer) {
        togglePlay();
      }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', onKeyDown);

    // Retry
    retryBtn.addEventListener('click', () => {
      errorOverlay.style.display = 'none';
      if (streamConfig) setupPlayer(streamConfig);
    });

    // Initial controls show
    showControls();
  }

  // ─── Playback ─────────────────────────────────────────────────────────────
  function startPlay() {
    tapOverlay.classList.add('hidden');
    video.play().catch(() => {});
  }

  function togglePlay() {
    if (tapOverlay && !tapOverlay.classList.contains('hidden')) {
      startPlay(); return;
    }
    if (video.paused) {
      video.play();
      showCenterAnim('▶');
    } else {
      video.pause();
      showCenterAnim('⏸');
    }
  }

  function showTapOverlay() {
    tapOverlay.classList.remove('hidden');
  }

  function onPlay() {
    playPauseBtn.querySelector('.icon-play').style.display = 'none';
    playPauseBtn.querySelector('.icon-pause').style.display = '';
  }

  function onPause() {
    playPauseBtn.querySelector('.icon-play').style.display = '';
    playPauseBtn.querySelector('.icon-pause').style.display = 'none';
  }

  // ─── Volume ───────────────────────────────────────────────────────────────
  function toggleMute() {
    video.muted = !video.muted;
    updateMuteIcon();
  }

  function updateMuteIcon() {
    const muted = video.muted || video.volume === 0;
    muteBtn.querySelector('.icon-vol').style.display = muted ? 'none' : '';
    muteBtn.querySelector('.icon-mute').style.display = muted ? '' : 'none';
    if (!muted) volumeSlider.value = video.volume * 100;
  }

  function onVolumeChange() { updateMuteIcon(); }

  // ─── Progress ─────────────────────────────────────────────────────────────
  function onTimeUpdate() {
    if (video.duration && !isNaN(video.duration)) {
      const pct = (video.currentTime / video.duration) * 100;
      progressFill.style.width = pct + '%';
      progressThumb.style.left = pct + '%';
      const cur = formatTime(video.currentTime);
      const dur = formatTime(video.duration);
      currentTime.textContent = `${cur} / ${dur}`;
    } else {
      currentTime.textContent = 'LIVE';
      progressFill.style.width = '100%';
    }
  }

  function onProgress() {
    if (video.buffered.length && video.duration) {
      const pct = (video.buffered.end(video.buffered.length - 1) / video.duration) * 100;
      progressBuf.style.width = pct + '%';
    }
  }

  function formatTime(s) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    return h > 0
      ? `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`
      : `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  }

  // Progress seek (for non-live)
  progressBar.addEventListener('click', (e) => {
    if (!video.duration || isNaN(video.duration)) return;
    const rect = progressBar.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    video.currentTime = pct * video.duration;
  });

  // ─── Buffering ────────────────────────────────────────────────────────────
  function showBuffering() {
    bufferOverlay.classList.add('active');
  }
  function hideBuffering() {
    bufferOverlay.classList.remove('active');
  }

  // ─── Error ────────────────────────────────────────────────────────────────
  function showError(msg) {
    errorMsg.textContent = msg;
    errorOverlay.style.display = 'flex';
    hideBuffering();
  }

  // ─── Controls Visibility ─────────────────────────────────────────────────
  function showControls() {
    exoPlayer.classList.remove('controls-hidden');
    clearTimeout(controlsTimeout);
    scheduleHideControls();
  }

  function scheduleHideControls() {
    clearTimeout(controlsTimeout);
    if (!video.paused) {
      controlsTimeout = setTimeout(() => {
        exoPlayer.classList.add('controls-hidden');
      }, 3000);
    }
  }

  // ─── Fullscreen ───────────────────────────────────────────────────────────
  function toggleFullscreen() {
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
      (exoPlayer.requestFullscreen || exoPlayer.webkitRequestFullscreen).call(exoPlayer);
    } else {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    }
  }

  function onFullscreenChange() {
    isFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement);
    fullscreenBtn.querySelector('.icon-fs').style.display = isFullscreen ? 'none' : '';
    fullscreenBtn.querySelector('.icon-exit-fs').style.display = isFullscreen ? '' : 'none';
  }

  // ─── Center Animation ─────────────────────────────────────────────────────
  function showCenterAnim(icon) {
    centerAnim.textContent = icon;
    centerAnim.classList.remove('show');
    void centerAnim.offsetWidth; // reflow
    centerAnim.classList.add('show');
  }

  // ─── Keyboard Shortcuts ───────────────────────────────────────────────────
  function onKeyDown(e) {
    if (['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;
    switch (e.code) {
      case 'Space':
      case 'KeyK':
        e.preventDefault();
        togglePlay();
        break;
      case 'KeyF':
        e.preventDefault();
        toggleFullscreen();
        break;
      case 'KeyM':
        e.preventDefault();
        toggleMute();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        video.currentTime = Math.max(0, video.currentTime - 5);
        showCenterAnim('⏪');
        break;
      case 'ArrowRight':
        e.preventDefault();
        video.currentTime += 5;
        showCenterAnim('⏩');
        break;
      case 'ArrowUp':
        e.preventDefault();
        video.volume = Math.min(1, video.volume + 0.1);
        volumeSlider.value = video.volume * 100;
        break;
      case 'ArrowDown':
        e.preventDefault();
        video.volume = Math.max(0, video.volume - 0.1);
        volumeSlider.value = video.volume * 100;
        break;
    }
    showControls();
  }

  // ─── Stats Polling ────────────────────────────────────────────────────────
  function startStatsPolling() {
    stopStatsPolling();
    statsInterval = setInterval(updateStats, 2000);
  }

  function stopStatsPolling() {
    if (statsInterval) { clearInterval(statsInterval); statsInterval = null; }
  }

  function updateStats() {
    // ── HLS.js stats ───────────────────────────────────────────────────────
    if (activeType === 'hls' && hls) {
      const level = hls.levels && hls.levels[hls.currentLevel];
      if (level) {
        if (statCodec) statCodec.textContent = level.videoCodec || 'AVC';
        if (statResolution) statResolution.textContent = level.width && level.height
          ? `${level.width}×${level.height}` : '—';
        if (statBitrate) statBitrate.textContent = level.bitrate
          ? `${Math.round(level.bitrate / 1000)} kbps` : '—';
      }
      if (hls.latency !== undefined && hls.latency !== null && statLatency) {
        statLatency.textContent = `${hls.latency.toFixed(2)}s`;
      }
    }

    // ── Shaka / DASH stats ─────────────────────────────────────────────────
    if (activeType === 'dash' && shakaPl) {
      try {
        const stats    = shakaPl.getStats();
        const active   = shakaPl.getVariantTracks().find(t => t.active);
        if (active) {
          if (statCodec) statCodec.textContent = [active.videoCodec, active.audioCodec].filter(Boolean).join(' / ') || 'DASH';
          if (statResolution) statResolution.textContent = active.width && active.height
            ? `${active.width}×${active.height}` : '—';
          if (statBitrate) statBitrate.textContent = active.bandwidth
            ? `${Math.round(active.bandwidth / 1000)} kbps` : '—';
        }
        if (stats && stats.liveLatency !== undefined && statLatency) {
          statLatency.textContent = `${stats.liveLatency.toFixed(2)}s`;
        }
      } catch (_) {}
    }

    // ── Buffer (both) ──────────────────────────────────────────────────────
    if (video.buffered.length && statBuffer) {
      const buf = video.buffered.end(video.buffered.length - 1) - video.currentTime;
      statBuffer.textContent = `${buf.toFixed(1)}s`;
    }
  }

  // ─── Schedule ─────────────────────────────────────────────────────────────
  async function loadSchedule() {
    try {
      const res = await fetch('/api/schedule');
      const data = await res.json();
      renderSchedule(data.items || []);
    } catch {
      // Try localStorage
      const local = localStorage.getItem('scheduleItems');
      if (local) {
        try { renderSchedule(JSON.parse(local)); return; } catch (_) {}
      }
      renderSchedule([]);
    }
  }

  function renderSchedule(items) {
    if (!items.length) {
      scheduleList.innerHTML = `
        <div style="padding:24px 18px;text-align:center;color:rgba(240,240,248,0.3);font-size:0.85rem;">
          No schedule available
        </div>`;
      return;
    }

    const now = new Date();
    scheduleList.innerHTML = items.map(item => {
      const start = new Date(item.startTime);
      const end   = new Date(item.endTime);
      const isActive = now >= start && now < end;
      const isPast   = now >= end;
      const cls = isActive ? 'active' : isPast ? 'past' : '';

      return `
        <div class="schedule-item ${cls}">
          <div class="sched-time">${formatScheduleTime(start)}</div>
          <div class="sched-content">
            <div class="sched-title">${escHtml(item.title)}</div>
            ${item.genre ? `<div class="sched-genre">${escHtml(item.genre)}</div>` : ''}
            ${isActive ? `<span class="sched-live-tag">● ON AIR</span>` : ''}
          </div>
        </div>`;
    }).join('');
  }

  function formatScheduleTime(date) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function escHtml(s) {
    return String(s)
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;');
  }

  // ─── Quick Stream Modal Controller ─────────────────────────────────────────
  const openQuickPlayBtn   = document.getElementById('openQuickPlayBtn');
  const quickModal         = document.getElementById('quickModal');
  const closeQuickModalBtn = document.getElementById('closeQuickModalBtn');
  const cancelQuickModalBtn= document.getElementById('cancelQuickModalBtn');
  const playQuickCmdBtn    = document.getElementById('playQuickCmdBtn');
  const quickCmdInput      = document.getElementById('quickCmdInput');

  if (openQuickPlayBtn && quickModal) {
    openQuickPlayBtn.addEventListener('click', () => {
      quickModal.style.display = 'flex';
      if (quickCmdInput) quickCmdInput.focus();
    });

    const hideQuickModal = () => { quickModal.style.display = 'none'; };
    if (closeQuickModalBtn) closeQuickModalBtn.addEventListener('click', hideQuickModal);
    if (cancelQuickModalBtn) cancelQuickModalBtn.addEventListener('click', hideQuickModal);
    quickModal.addEventListener('click', (e) => {
      if (e.target === quickModal) hideQuickModal();
    });

    if (playQuickCmdBtn) {
      playQuickCmdBtn.addEventListener('click', () => {
        const raw = quickCmdInput.value.trim();
        if (!raw) return;

        const parsed = parseQuickCommand(raw);
        if (!parsed.url) {
          alert('Could not find a valid stream URL in the input');
          return;
        }

        const config = {
          name: parsed.name || 'Quick Stream',
          description: 'Live custom stream',
          url: parsed.url,
          rawUrl: parsed.url,
          useProxy: true,
          headers: parsed.headers,
          cookies: parsed.cookies,
          active: true,
        };

        updateBanner(config);
        setupPlayer(config);
        hideQuickModal();
      });
    }
  }

  function parseQuickCommand(raw) {
    raw = raw.trim();
    const result = { url: '', name: '', headers: {}, cookies: {} };

    // 1. Streamlink: --http-header "Key=Value"
    const streamlinkRegex = /--http-header\s+["']?([^"'=]+)=([^"'\r\n]+)["']?/gi;
    let match;
    while ((match = streamlinkRegex.exec(raw)) !== null) {
      const k = match[1].trim();
      const v = match[2].trim();
      if (k.toLowerCase() === 'cookie') { parseCookieStr(v, result.cookies); result.headers['Cookie'] = v; }
      else { result.headers[k] = v; }
    }

    // 2. cURL / yt-dlp: -H "Key: Value" or --header "Key: Value"
    const curlHeaderRegex = /(?:-H|--header|--add-header)\s+["']([^"':]+):\s*([^"']+)["']/gi;
    while ((match = curlHeaderRegex.exec(raw)) !== null) {
      const k = match[1].trim();
      const v = match[2].trim();
      if (k.toLowerCase() === 'cookie') { parseCookieStr(v, result.cookies); result.headers['Cookie'] = v; }
      else { result.headers[k] = v; }
    }

    // 3. -A / --user-agent
    const uaMatch = /(?:-A|--user-agent)\s+["']([^"']+)["']/i.exec(raw);
    if (uaMatch) result.headers['User-Agent'] = uaMatch[1].trim();

    // 4. -e / --referer
    const refMatch = /(?:-e|--referer)\s+["']([^"']+)["']/i.exec(raw);
    if (refMatch) result.headers['Referer'] = refMatch[1].trim();

    // 5. -b / --cookie
    const cookieMatch = /(?:-b|--cookie)\s+["']([^"']+)["']/i.exec(raw);
    if (cookieMatch) { parseCookieStr(cookieMatch[1].trim(), result.cookies); result.headers['Cookie'] = cookieMatch[1].trim(); }

    // 6. Output filename (-o)
    const outMatch = /-o\s+["']?([^"'\s]+)["']?/i.exec(raw);
    if (outMatch) result.name = outMatch[1].replace(/\.[^/.]+$/, '').replace(/[-_]+/g, ' ').trim();

    // 7. Extract URL — prioritise .mpd / .m3u8, handle query strings with tokens
    const quotedUrls = [];
    const quotedUrlRegex = /["'](https?:\/\/[^"']+)["']/gi;
    while ((match = quotedUrlRegex.exec(raw)) !== null) {
      const candidate = match[1];
      const isReferer = raw.includes(`Referer=${candidate}`) || raw.includes(`Referer: ${candidate}`);
      if (!isReferer) quotedUrls.push(candidate);
    }

    if (quotedUrls.length > 0) {
      // Prefer explicit media URLs, including ones with query params containing tokens
      const mediaUrl = quotedUrls.find(u => {
        const base = u.split('?')[0].toLowerCase();
        return base.endsWith('.mpd') || base.endsWith('.m3u8') ||
               u.includes('.mpd?') || u.includes('/dash/') ||
               u.includes('proto=dash');
      });
      result.url = mediaUrl || quotedUrls[quotedUrls.length - 1];
    } else {
      // No quoted URL — look for bare URL (e.g. just the URL pasted directly)
      const unquoted = /(https?:\/\/[^\s"']+)/i.exec(raw);
      if (unquoted) result.url = unquoted[1];
    }

    // 8. Derive name from Referer or URL if not set from -o
    if (!result.name) {
      if (result.headers['Referer']) {
        try {
          const refParts = new URL(result.headers['Referer']).pathname.split('/').filter(Boolean);
          if (refParts.length) result.name = refParts[refParts.length - 1].replace(/[-_]+/g, ' ');
        } catch (_) {}
      }
      if (!result.name && result.url) {
        try {
          const urlParts = new URL(result.url).pathname.split('/').filter(Boolean);
          if (urlParts.length) result.name = urlParts[urlParts.length - 1].replace(/\.mpd$|\.m3u8$/i, '').replace(/[-_]+/g, ' ');
        } catch (_) {}
      }
    }

    return result;
  }

  function parseCookieStr(str, obj) {
    const parts = str.split(';');
    for (const part of parts) {
      const eqIdx = part.indexOf('=');
      if (eqIdx !== -1) {
        const k = part.substring(0, eqIdx).trim();
        const v = part.substring(eqIdx + 1).trim();
        if (k) obj[k] = v;
      }
    }
  }

  // ─── Start ────────────────────────────────────────────────────────────────
  init();

})();
