/* ============================================
   HybridSpeed - Application JavaScript
   State Management, UI Updates, Event Handlers
   GAMER EDITION
   ============================================ */

'use strict';

/**
 * HybridSpeed Application
 * Manages speed test state and UI updates
 */
const HybridSpeed = (function () {
  // -------------------- DOM Selectors --------------------
  const selectors = {
    // Header
    header: '.site-header',
    navLinks: '.nav-link',
    mobileMenuBtn: '.mobile-menu-btn',

    // Speed Test
    startButton: '.start-button',
    speedDisplay: '#speedDisplay',
    speedUnit: '#speedUnit',
    speedIcon: '#speedIcon',
    progressRing: '#progressRing',

    // Scanning Metrics (by ID)
    pingDisplay: '#pingDisplay',
    jitterDisplay: '#jitterDisplay',
    lossDisplay: '#lossDisplay',

    // Status
    statusBadge: '.badge-status',
    statusTitle: '.status-header__title',
    testStatus: '#testStatus',
    testSubstatus: '#testSubstatus',

    // Actions
    cancelBtn: '#cancelBtn',
    restartBtn: '#restartBtn',
    shareBtn: '#shareBtn',

    // Results
    resultDownload: '#resultDownload',
    resultUpload: '#resultUpload',
    resultPing: '#resultPing',
    resultJitter: '#resultJitter',

    // Rank Badge
    rankBadge: '#rankBadge',
    rankTier: '#rankTier',
    rankLabel: '#rankLabel',

    // Error
    errorState: '#errorState',
    errorMessage: '#errorMessage',

    // Phase Indicator
    phasePing: '#phase-ping',
    phaseDownload: '#phase-download',
    phaseUpload: '#phase-upload',
  };

  const apiBase = (() => {
    if (window.HYBRIDSPEED_API_BASE) return window.HYBRIDSPEED_API_BASE;
    if (window.location && window.location.origin && window.location.origin !== 'null' && !window.location.origin.startsWith('file:')) {
      return window.location.origin;
    }
    return 'http://localhost:3000';
  })();

  const buildApiUrl = (path) => {
    const normalized = path.startsWith('/') ? path : `/${path}`;
    return apiBase.endsWith('/') ? `${apiBase.slice(0, -1)}${normalized}` : `${apiBase}${normalized}`;
  };

  // -------------------- State --------------------
  let state = {
    status: 'idle', // idle, running, complete, error
    progress: 0,
    currentPhase: null, // ping, download, upload
    results: {
      download: 0,
      upload: 0,
      ping: 0,
      jitter: 0,
      loss: 0,
    },
  };

  // -------------------- DOM Cache --------------------
  const dom = {};

  // -------------------- Initialization --------------------
  // Active SpeedTest instance (only on scanning page)
  let speedTestInstance = null;

  function init() {
    hydrateResultsFromStorage();
    cacheDom();
    setMobileMenuState(false);
    dismissPreloader();
    bindEvents();
    setActiveNavLink();
    probeServerInfo();
    populateResults();
    initScanningPage();
  }

  // -------------------- Page Preloader --------------------
  function dismissPreloader() {
    requestAnimationFrame(() => {
      const preloader = document.querySelector('.page-preloader');
      if (preloader) {
        preloader.classList.add('is-loaded');
        preloader.addEventListener('transitionend', () => preloader.remove(), { once: true });
      }
    });
  }

  function cacheDom() {
    Object.keys(selectors).forEach(key => {
      dom[key] = document.querySelector(selectors[key]);
    });

    // Cache all nav links for active state
    dom.allNavLinks = document.querySelectorAll(selectors.navLinks);
  }

  function bindEvents() {
    // Start button
    if (dom.startButton) {
      dom.startButton.addEventListener('click', handleStartTest);
    }

    // Cancel button
    if (dom.cancelBtn) {
      dom.cancelBtn.addEventListener('click', handleCancelTest);
    }

    // Keyboard ESC to cancel test on scanning page
    if (dom.cancelBtn) {
      document.addEventListener('keydown', (e) => {
        if (e.code === 'Escape') {
          handleCancelTest();
        }
      });
    }

    // Restart button
    if (dom.restartBtn) {
      dom.restartBtn.addEventListener('click', handleRestartTest);
    }

    // Share button
    if (dom.shareBtn) {
      dom.shareBtn.addEventListener('click', handleShare);
    }

    // Mobile menu
    if (dom.mobileMenuBtn) {
      dom.mobileMenuBtn.addEventListener('click', toggleMobileMenu);
    }

    // Close mobile nav when selecting a link
    if (dom.allNavLinks && dom.allNavLinks.length) {
      dom.allNavLinks.forEach((link) => {
        link.addEventListener('click', closeMobileMenu);
      });
    }

    // Close mobile nav on outside click
    document.addEventListener('click', (e) => {
      if (!isMobileMenuOpen()) return;
      if (e.target.closest('.mobile-menu-btn') || e.target.closest('.header-nav')) return;
      closeMobileMenu();
    });

    // Close mobile nav on viewport growth
    window.addEventListener('resize', () => {
      if (window.innerWidth >= 768) {
        closeMobileMenu();
      }
    });

    // SPACE keyboard shortcut to start test from homepage
    if (dom.startButton) {
      document.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && !e.target.closest('input, textarea, button, a')) {
          e.preventDefault();
          handleStartTest();
        }
      });
    }

    // Escape key closes mobile nav across pages
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') {
        closeMobileMenu();
      }
    });
  }

  // -------------------- Navigation --------------------
  function setActiveNavLink() {
    const currentPage = window.location.pathname.split('/').pop() || 'index.html';

    if (dom.allNavLinks) {
      dom.allNavLinks.forEach(link => {
        const href = link.getAttribute('href');
        if (href === currentPage || (currentPage === '' && href === 'index.html')) {
          link.classList.add('active');
        } else {
          link.classList.remove('active');
        }
      });
    }
  }

  function toggleMobileMenu() {
    setMobileMenuState(!isMobileMenuOpen());
  }

  function isMobileMenuOpen() {
    const nav = document.querySelector('.header-nav');
    return !!(nav && nav.classList.contains('mobile-open'));
  }

  function closeMobileMenu() {
    setMobileMenuState(false);
  }

  function setMobileMenuState(isOpen) {
    const nav = document.querySelector('.header-nav');
    if (!nav || !dom.mobileMenuBtn) return;
    nav.classList.toggle('mobile-open', isOpen);
    dom.mobileMenuBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    dom.mobileMenuBtn.setAttribute('aria-label', isOpen ? 'Close menu' : 'Open menu');
    document.body.classList.toggle('menu-open', isOpen);
  }

  // -------------------- Test Actions --------------------
  function handleStartTest() {
    state.status = 'running';
    state.progress = 0;
    clearResults();

    // Navigate to scanning page
    window.location.href = 'scanning.html';
  }

  function handleCancelTest() {
    // Abort the running SpeedTest engine first
    if (speedTestInstance) {
      try { speedTestInstance.abort(); } catch (e) { /* ignore */ }
      speedTestInstance = null;
    }
    state.status = 'idle';
    state.progress = 0;

    // Navigate back to home
    window.location.href = 'index.html';
  }

  function handleRestartTest() {
    state.status = 'idle';
    state.progress = 0;
    clearResults();
    state.results = {
      download: 0,
      upload: 0,
      ping: 0,
      jitter: 0,
      loss: 0,
    };

    // Navigate to scanning page
    window.location.href = 'scanning.html';
  }

  async function handleShare() {
    const r = state.results;
    const rank = getGamingRank(r.download, r.ping);
    const shareData = {
      title: 'HybridSpeed - My Gaming Stats',
      text: `Rank: ${rank.label} | DL ${r.download} Mbps | UL ${r.upload} Mbps | Ping ${r.ping} ms | HybridSpeed`,
      url: window.location.href,
    };

    try {
      if (navigator.share) {
        await navigator.share(shareData);
      } else {
        // Fallback: copy to clipboard
        await navigator.clipboard.writeText(shareData.text);
        showToast('Results copied to clipboard!');
      }
    } catch (err) {
      console.error('Share failed:', err);
    }
  }

  // -------------------- Motion Settings --------------------
  const motion = {
    // Check for reduced motion preference
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,

    // Easing function for count-up (ease-out)
    easeOut: t => 1 - Math.pow(1 - t, 3),

    // Duration presets (ms)
    duration: {
      instant: 100,
      fast: 150,
      normal: 250,
      slow: 400,
      number: 600,
    },
  };

  // -------------------- Animated Number Count-Up --------------------
  function animateNumber(element, start, end, duration = motion.duration.number, suffix = '') {
    if (!element || motion.reducedMotion) {
      if (element) element.textContent = end + suffix;
      return;
    }

    const startTime = performance.now();
    const delta = end - start;

    function update(currentTime) {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const easedProgress = motion.easeOut(progress);
      const current = start + (delta * easedProgress);

      // Handle decimals based on value magnitude
      if (end >= 100) {
        element.textContent = Math.round(current) + suffix;
      } else if (end >= 10) {
        element.textContent = current.toFixed(1) + suffix;
      } else {
        element.textContent = current.toFixed(1) + suffix;
      }

      if (progress < 1) {
        requestAnimationFrame(update);
      } else {
        element.textContent = end + suffix;
        // Add subtle pulse effect on completion
        element.classList.add('value-updating');
        setTimeout(() => element.classList.remove('value-updating'), 400);
      }
    }

    requestAnimationFrame(update);
  }

  // -------------------- UI Updates --------------------
  function updateSpeedDisplay(speed, animate = true) {
    if (dom.speedDisplay) {
      if (animate && !motion.reducedMotion) {
        const currentValue = parseFloat(dom.speedDisplay.textContent) || 0;
        animateNumber(dom.speedDisplay, currentValue, speed, motion.duration.number);
      } else {
        dom.speedDisplay.textContent = speed.toFixed(1);
      }
    }
  }

  function updateProgress(progress, animate = true) {
    state.progress = progress;

    if (dom.progressRing) {
      const circumference = 282.7;
      const offset = circumference - (progress / 100) * circumference;

      if (animate && !motion.reducedMotion) {
        dom.progressRing.style.transition = 'stroke-dashoffset 0.4s cubic-bezier(0.22, 1, 0.36, 1)';
      } else {
        dom.progressRing.style.transition = 'none';
      }

      dom.progressRing.style.strokeDashoffset = offset;
    }
  }

  function updateMetric(metric, value, animate = true) {
    // Try ID-based selectors first, fall back to data-metric
    const idMap = { ping: '#pingDisplay', jitter: '#jitterDisplay', loss: '#lossDisplay' };
    const element = document.querySelector(idMap[metric]) || document.querySelector(`[data-metric="${metric}"]`);
    if (element) {
      if (animate && !motion.reducedMotion) {
        const currentValue = parseFloat(element.textContent) || 0;
        animateNumber(element, currentValue, value, motion.duration.slow);
      } else {
        element.textContent = value;
      }
    }
    state.results[metric] = value;
  }

  function updateStatus(status, message) {
    state.status = status;

    if (dom.statusBadge) {
      dom.statusBadge.textContent = message;
    }
  }

  // -------------------- Phase Indicator --------------------
  function updatePhaseIndicator(phase) {
    state.currentPhase = phase;

    const phases = ['ping', 'download', 'upload'];
    const phaseIndex = phases.indexOf(phase);

    phases.forEach((p, i) => {
      const el = document.getElementById(`phase-${p}`);
      if (!el) return;

      el.classList.remove('active', 'completed');

      if (i < phaseIndex) {
        el.classList.add('completed');
      } else if (i === phaseIndex) {
        el.classList.add('active');
      }
    });

    // Update status text
    const statusEl = dom.testStatus;
    const substatusEl = dom.testSubstatus;

    if (statusEl) {
      const phaseNames = {
        ping: '<span class="status-header__title-accent">TESTING</span> // PING',
        download: '<span class="status-header__title-accent">TESTING</span> // DOWNLOAD',
        upload: '<span class="status-header__title-accent">TESTING</span> // UPLOAD',
      };
      statusEl.innerHTML = phaseNames[phase] || statusEl.innerHTML;
    }

    if (substatusEl) {
      const messages = {
        ping: 'Measuring latency & jitter...',
        download: 'Measuring download throughput...',
        upload: 'Measuring upload throughput...',
      };
      substatusEl.textContent = messages[phase] || substatusEl.textContent;
    }

    // Update speed icon
    if (dom.speedIcon) {
      const icons = { ping: 'network_ping', download: 'download', upload: 'upload' };
      dom.speedIcon.textContent = icons[phase] || dom.speedIcon.textContent;
    }
  }

  // -------------------- Gaming Rank Badge --------------------
  function getGamingRank(download, ping) {
    const dl = Number(download) || 0;
    const p = Number(ping) || 999;

    if (dl >= 500 && p <= 10) return { tier: 'S+', label: 'LEGENDARY', class: 'legendary' };
    if (dl >= 200 && p <= 20) return { tier: 'S', label: 'ELITE', class: 'elite' };
    if (dl >= 100 && p <= 40) return { tier: 'A', label: 'PRO', class: 'pro' };
    if (dl >= 50 && p <= 60) return { tier: 'B', label: 'COMPETITIVE', class: 'competitive' };
    if (dl >= 25) return { tier: 'C', label: 'CASUAL', class: 'casual' };
    return { tier: 'D', label: 'NEEDS UPGRADE', class: 'upgrade' };
  }

  function displayRankBadge(download, ping) {
    const badge = dom.rankBadge;
    const tierEl = dom.rankTier;
    const labelEl = dom.rankLabel;

    if (!badge || !tierEl || !labelEl) return;

    const rank = getGamingRank(download, ping);

    // Remove all rank classes
    badge.className = 'rank-badge rank-badge--' + rank.class;
    tierEl.textContent = rank.tier;
    labelEl.textContent = rank.label;

    // Show with animation
    badge.style.display = 'inline-flex';
  }

  // -------------------- Scanning Page Auto-Start --------------------
  function initScanningPage() {
    // Only run on scanning.html
    if (!dom.progressRing || !dom.testStatus) return;

    // Create SpeedTest instance wired to UI
    speedTestInstance = new SpeedTest({
      onProgress: (progress) => {
        updateProgress(progress, true);
      },
      onPhaseChange: (phase) => {
        const phaseMap = {
          'checking_server': null,
          'running_ping': 'ping',
          'running_download': 'download',
          'running_upload': 'upload',
        };
        const uiPhase = phaseMap[phase];
        if (uiPhase) {
          updatePhaseIndicator(uiPhase);
        }

        // Update unit label during ping phase
        if (dom.speedUnit && phase === 'running_ping') {
          dom.speedUnit.textContent = 'ms';
        } else if (dom.speedUnit && (phase === 'running_download' || phase === 'running_upload')) {
          dom.speedUnit.textContent = 'Mbps';
        }
      },
      onSpeedUpdate: (data) => {
        updateSpeedDisplay(data.speed, true);
        // Boost particles during active measurement
        if (window.setParticleBoost) window.setParticleBoost(1.5 + Math.min(data.speed / 100, 1.5));
      },
      onMetricUpdate: (data) => {
        if (typeof data.ping === 'number') {
          updateMetric('ping', data.ping, true);
        }
        if (typeof data.jitter === 'number') {
          updateMetric('jitter', data.jitter, true);
        }
      },
      onComplete: (results) => {
        // Reset particle boost
        if (window.setParticleBoost) window.setParticleBoost(1);

        // Save results to sessionStorage (for results page)
        saveResults({
          download: results.download,
          upload: results.upload,
          ping: results.ping,
          jitter: results.jitter,
          loss: 0,
        });

        // Also save to persistent history
        addToHistory({
          download: results.download,
          upload: results.upload,
          ping: results.ping,
          jitter: results.jitter,
          loss: 0,
          timestamp: Date.now(),
        });

        speedTestInstance = null;
        // Navigate to results page
        window.location.href = 'results.html';
      },
      onError: (error) => {
        if (window.setParticleBoost) window.setParticleBoost(1);
        speedTestInstance = null;
        showError(error.message || 'Speed test failed. Please try again.');
      },
    });

    // Auto-start the test
    updateMetric('loss', 0, false);
    speedTestInstance.start().catch((err) => {
      showError(err.message || 'Could not connect to server.');
    });
  }

  // -------------------- Error Display --------------------
  function showError(message) {
    const errorState = dom.errorState || document.getElementById('errorState');
    const errorMessage = dom.errorMessage || document.getElementById('errorMessage');
    const phaseIndicator = document.getElementById('phaseIndicator');
    const speedDisplay = document.querySelector('.speed-display');
    const metricsSection = document.querySelector('.metrics-section');
    const actionsSection = document.querySelector('.actions-section');
    const statusHeader = dom.testStatus ? dom.testStatus.closest('.status-header') : null;

    // Hide test UI
    if (phaseIndicator) phaseIndicator.style.display = 'none';
    if (speedDisplay) speedDisplay.style.display = 'none';
    if (metricsSection) metricsSection.style.display = 'none';
    if (actionsSection) actionsSection.style.display = 'none';
    if (statusHeader) statusHeader.style.display = 'none';

    // Show error state
    if (errorState) {
      errorState.style.display = 'block';
    }
    if (errorMessage) {
      errorMessage.textContent = message;
    }
  }

  // -------------------- Populate Results Page --------------------
  function populateResults() {
    const results = getResults();
    if (!results) return;

    // Populate results page
    const dl = dom.resultDownload;
    const ul = dom.resultUpload;
    const ping = dom.resultPing;
    const jitter = dom.resultJitter;

    if (dl && results.download) {
      animateNumber(dl, 0, Number(results.download), 800);
    }
    if (ul && results.upload) {
      animateNumber(ul, 0, Number(results.upload), 800);
    }
    if (ping && results.ping) {
      animateNumber(ping, 0, Number(results.ping), 600);
    }
    if (jitter && results.jitter) {
      animateNumber(jitter, 0, Number(results.jitter), 600);
    }

    // Show rank badge
    if (results.download && results.ping) {
      setTimeout(() => displayRankBadge(results.download, results.ping), 400);
    }

    // Update tip card based on results
    updateTipCard(results);

    // Populate analytics page (use history)
    populateAnalytics(results);
  }

  // -------------------- Dynamic Tip Card --------------------
  function updateTipCard(results) {
    const titleEl = document.getElementById('tipTitle');
    const textEl = document.getElementById('tipText');
    if (!titleEl || !textEl) return;

    const ping = Number(results.ping) || 999;
    const download = Number(results.download) || 0;

    if (ping > 80) {
      titleEl.textContent = 'High Latency Detected';
      textEl.innerHTML = 'Your ping is above <span class="tip-card__highlight">80ms</span>. Consider using a <span class="tip-card__highlight">wired ethernet connection</span> and enabling <span class="tip-card__highlight">QoS/Game Mode</span> on your router for better competitive gaming performance.';
    } else if (download < 25) {
      titleEl.textContent = 'Low Bandwidth Warning';
      textEl.innerHTML = 'Your download speed is under <span class="tip-card__highlight">25 Mbps</span>. Close background downloads and streaming apps before gaming. Consider upgrading your internet plan for a smoother experience.';
    } else if (ping <= 20 && download >= 200) {
      titleEl.textContent = 'Elite Connection Detected';
      textEl.innerHTML = 'Your connection is <span class="tip-card__highlight">tournament-ready</span>! Low ping and high bandwidth mean you have a competitive edge. Keep your setup optimized and enjoy lag-free gaming.';
    } else {
      titleEl.textContent = 'Gaming Optimization';
      textEl.innerHTML = 'Enable <span class="tip-card__highlight">Game Mode</span> on your router for traffic prioritization. Use a <span class="tip-card__highlight">wired connection</span> for the lowest ping and most stable gameplay.';
    }
  }

  // -------------------- Test History (IndexedDB + localStorage fallback) --------------------
  const HISTORY_KEY = 'hybridspeed_history';
  const MAX_HISTORY = 100;
  const DB_NAME = 'HybridSpeedDB';
  const DB_STORE = 'history';
  const DB_VERSION = 1;

  function openDB() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error('No IndexedDB')); return; }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(DB_STORE)) {
          db.createObjectStore(DB_STORE, { keyPath: 'id', autoIncrement: true });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function getHistoryIDB() {
    try {
      const db = await openDB();
      return new Promise((resolve) => {
        const tx = db.transaction(DB_STORE, 'readonly');
        const store = tx.objectStore(DB_STORE);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      });
    } catch (e) {
      return null; // signal to use localStorage fallback
    }
  }

  async function addToHistoryIDB(entry) {
    try {
      const db = await openDB();
      const tx = db.transaction(DB_STORE, 'readwrite');
      const store = tx.objectStore(DB_STORE);
      store.add(entry);

      // Trim old entries beyond MAX_HISTORY
      const countReq = store.count();
      countReq.onsuccess = () => {
        const excess = countReq.result - MAX_HISTORY;
        if (excess > 0) {
          const cursor = store.openCursor();
          let deleted = 0;
          cursor.onsuccess = (e) => {
            const c = e.target.result;
            if (c && deleted < excess) {
              c.delete();
              deleted++;
              c.continue();
            }
          };
        }
      };
      return true;
    } catch (e) {
      return false;
    }
  }

  function getHistoryLS() {
    try {
      const data = localStorage.getItem(HISTORY_KEY);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      return [];
    }
  }

  function addToHistoryLS(entry) {
    const history = getHistoryLS();
    history.push(entry);
    while (history.length > MAX_HISTORY) history.shift();
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  }

  async function getHistory() {
    const idbData = await getHistoryIDB();
    if (idbData !== null) return idbData;
    return getHistoryLS();
  }

  async function addToHistory(entry) {
    const ok = await addToHistoryIDB(entry);
    if (!ok) addToHistoryLS(entry);
  }

  // -------------------- Export / Import History --------------------
  async function exportHistory() {
    const history = await getHistory();
    if (!history.length) { showToast('No history to export'); return; }
    const blob = new Blob([JSON.stringify(history, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hybridspeed-history-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('History exported!');
  }

  async function importHistory(file) {
    try {
      const text = await file.text();
      const entries = JSON.parse(text);
      if (!Array.isArray(entries)) throw new Error('Invalid format');
      for (const entry of entries) {
        await addToHistory(entry);
      }
      showToast(`Imported ${entries.length} entries!`);
      setTimeout(() => window.location.reload(), 800);
    } catch (e) {
      showToast('Import failed — invalid file');
    }
  }

  // -------------------- Analytics Population --------------------
  function populateAnalytics(results) {
    const emptyState = document.getElementById('emptyState');
    const analyticsContent = document.getElementById('analyticsContent');

    if (!emptyState || !analyticsContent) return;

    const history = getHistory();
    const hasHistory = history.length > 0;
    const hasData = hasHistory || (results && hasResultData(results));

    if (!hasData) {
      emptyState.style.display = 'flex';
      analyticsContent.style.display = 'none';
      return;
    }

    emptyState.style.display = 'none';
    analyticsContent.style.display = 'block';

    // Use history for aggregate stats, fallback to single result
    const downloads = hasHistory ? history.map(h => Number(h.download) || 0) : [Number(results.download) || 0];
    const uploads = hasHistory ? history.map(h => Number(h.upload) || 0) : [Number(results.upload) || 0];
    const pings = hasHistory ? history.map(h => Number(h.ping) || 0) : [Number(results.ping) || 0];
    const jitters = hasHistory ? history.map(h => Number(h.jitter) || 0) : [Number(results.jitter) || 0];
    const losses = hasHistory ? history.map(h => Number(h.loss) || 0) : [Number(results.loss) || 0];

    const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    const peak = arr => arr.length ? Math.max(...arr) : 0;

    // KPI values (averaged across all tests)
    const kpiPing = document.getElementById('kpiPing');
    const kpiJitter = document.getElementById('kpiJitter');
    const kpiLoss = document.getElementById('kpiLoss');

    if (kpiPing) animateNumber(kpiPing, 0, Math.round(avg(pings)), 600);
    if (kpiJitter) animateNumber(kpiJitter, 0, Math.round(avg(jitters) * 10) / 10, 600);
    if (kpiLoss) kpiLoss.textContent = (Math.round(avg(losses) * 10) / 10).toString();

    // Chart stats
    const peakDl = document.getElementById('peakDownload');
    const avgDl = document.getElementById('avgDownload');
    const peakUl = document.getElementById('peakUpload');
    const avgUl = document.getElementById('avgUpload');

    if (peakDl) peakDl.innerHTML = `${peak(downloads).toFixed(1)} <span class="chart-stat__unit">Mbps</span>`;
    if (avgDl) avgDl.innerHTML = `${avg(downloads).toFixed(1)} <span class="chart-stat__unit">Mbps</span>`;
    if (peakUl) peakUl.innerHTML = `${peak(uploads).toFixed(1)} <span class="chart-stat__unit">Mbps</span>`;
    if (avgUl) avgUl.innerHTML = `${avg(uploads).toFixed(1)} <span class="chart-stat__unit">Mbps</span>`;

    // Render trend charts from history
    renderChart('downloadChart', downloads);
    renderChart('uploadChart', uploads);

    // Stability score (from averaged values)
    calculateStability({
      ping: avg(pings),
      jitter: avg(jitters),
      loss: avg(losses),
    });

    // Connection summary (latest result)
    const latest = hasHistory ? history[history.length - 1] : results;
    const summaryDl = document.getElementById('summaryDownload');
    const summaryUl = document.getElementById('summaryUpload');
    const summaryLat = document.getElementById('summaryLatency');
    const summaryJit = document.getElementById('summaryJitter');

    if (summaryDl) summaryDl.textContent = `${(Number(latest.download) || 0).toFixed(1)} Mbps`;
    if (summaryUl) summaryUl.textContent = `${(Number(latest.upload) || 0).toFixed(1)} Mbps`;
    if (summaryLat) summaryLat.textContent = `${Math.round(Number(latest.ping) || 0)} ms`;
    if (summaryJit) summaryJit.textContent = `${(Number(latest.jitter) || 0).toFixed(1)} ms`;
  }

  function renderChart(containerId, values) {
    const container = document.getElementById(containerId);
    if (!container) return;

    // Use requestIdleCallback if available for non-blocking render
    const render = () => {
      // Show last 10 values
      const data = values.slice(-10);
      const maxVal = Math.max(...data, 10) * 1.15;

      const frag = document.createDocumentFragment();
      const wrapper = document.createElement('div');
      wrapper.style.cssText = 'display:flex;align-items:flex-end;justify-content:center;height:280px;gap:6px;padding:0 8px';

      data.forEach((val, i) => {
        const barHeight = Math.max((val / maxVal) * 240, 4);
        const opacity = 0.5 + (i / data.length) * 0.5;
        const isLast = i === data.length - 1;

        const col = document.createElement('div');
        col.style.cssText = 'flex:1;max-width:60px;display:flex;flex-direction:column;align-items:center;gap:6px';

        const label = document.createElement('span');
        label.style.cssText = `font-family:var(--font-gaming);font-size:10px;font-weight:bold;white-space:nowrap;color:${isLast ? 'var(--color-primary)' : 'var(--color-text-muted)'}`;
        label.textContent = val.toFixed(1);

        const bar = document.createElement('div');
        bar.style.cssText = `width:100%;height:${barHeight}px;background:linear-gradient(180deg,${isLast ? 'var(--color-primary)' : 'rgba(0,240,255,0.5)'},var(--color-accent-purple));border-radius:var(--radius-sm) var(--radius-sm) 0 0;box-shadow:${isLast ? '0 0 15px var(--color-primary-glow)' : '0 0 5px rgba(0,240,255,0.1)'};opacity:${opacity};transition:height 0.8s var(--ease-spring)`;

        col.appendChild(label);
        col.appendChild(bar);
        wrapper.appendChild(col);
      });

      frag.appendChild(wrapper);
      container.textContent = '';
      container.appendChild(frag);
    };

    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(render);
    } else {
      render();
    }
  }

  function calculateStability(results) {
    const ping = Number(results.ping) || 0;
    const jitter = Number(results.jitter) || 0;
    const loss = Number(results.loss) || 0;

    // Score calculation (0-100)
    let score = 100;
    score -= Math.min(ping * 0.3, 30);
    score -= Math.min(jitter * 2, 25);
    score -= Math.min(loss * 10, 30);
    score = Math.max(0, Math.min(100, Math.round(score)));

    const valueEl = document.getElementById('stabilityValue');
    const fillEl = document.getElementById('stabilityFill');
    const statusEl = document.getElementById('stabilityStatus');
    const badgeEl = document.getElementById('stabilityBadge');

    if (valueEl) {
      animateNumber(valueEl, 0, score, 800, '');
      valueEl.innerHTML = `${score}<span class="stability-score__max">/100</span>`;
    }

    if (fillEl) {
      setTimeout(() => {
        fillEl.style.width = `${score}%`;
        fillEl.style.transition = 'width 1s var(--ease-out)';
      }, 200);
    }

    if (statusEl) {
      let statusText, statusIcon;
      if (score >= 85) {
        statusText = 'Tournament Ready';
        statusIcon = 'verified';
      } else if (score >= 60) {
        statusText = 'Good for Gaming';
        statusIcon = 'thumb_up';
      } else {
        statusText = 'Needs Improvement';
        statusIcon = 'warning';
      }
      statusEl.innerHTML = `<span class="material-symbols-rounded" style="font-size: 16px;">${statusIcon}</span><span>${statusText}</span>`;
    }

    if (badgeEl) {
      if (score >= 85) {
        badgeEl.className = 'badge badge-success';
        badgeEl.innerHTML = '<span class="material-symbols-rounded" style="font-size: 14px;">verified</span> Excellent';
      } else if (score >= 60) {
        badgeEl.className = 'badge badge-status';
        badgeEl.innerHTML = '<span class="material-symbols-rounded" style="font-size: 14px;">thumb_up</span> Good';
      } else {
        badgeEl.className = 'badge';
        badgeEl.style.borderColor = 'rgba(234, 179, 8, 0.3)';
        badgeEl.style.color = 'var(--color-warning)';
        badgeEl.innerHTML = '<span class="material-symbols-rounded" style="font-size: 14px;">warning</span> Fair';
      }
    }
  }

  // -------------------- Toast --------------------
  function getOrCreateToastContainer() {
    let container = document.querySelector('.toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    return container;
  }

  function showToast(message, icon) {
    const container = getOrCreateToastContainer();
    const toast = document.createElement('div');
    toast.className = 'toast';

    if (icon) {
      const iconEl = document.createElement('span');
      iconEl.className = 'material-symbols-rounded';
      iconEl.textContent = icon;
      toast.appendChild(iconEl);
    }

    const textEl = document.createElement('span');
    textEl.textContent = message;
    toast.appendChild(textEl);

    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('toast--exiting');
      toast.addEventListener('animationend', () => toast.remove(), { once: true });
    }, 3000);
  }

  // -------------------- Utilities --------------------
  function formatSpeed(bps) {
    const mbps = bps / 1000000;
    return mbps.toFixed(1);
  }

  function formatLatency(ms) {
    return Math.round(ms);
  }

  // -------------------- Session Storage --------------------
  function saveResults(results) {
    if (!results) return;

    state.results = {
      ...state.results,
      ...results,
    };

    sessionStorage.setItem('speedTestResults', JSON.stringify(state.results));
  }

  function getResults() {
    const data = sessionStorage.getItem('speedTestResults');
    return data ? JSON.parse(data) : null;
  }

  function clearResults() {
    sessionStorage.removeItem('speedTestResults');
  }

  function hydrateResultsFromStorage() {
    const stored = getResults();
    if (stored) {
      state.results = {
        ...state.results,
        ...stored,
      };
    }
  }

  function hasResultData(results) {
    if (!results) return false;
    return ['download', 'upload', 'ping', 'jitter', 'loss'].some(
      key => Number(results[key]) > 0
    );
  }

  function setResults(results) {
    if (!results) return;
    state.results = {
      ...state.results,
      ...results,
    };
  }

  function goToAnalytics() {
    // Prefer in-memory results; fall back to stored ones to avoid overwriting
    const stored = getResults();
    const payload = hasResultData(state.results) ? state.results : stored;

    if (payload) {
      saveResults(payload);
    }
    window.location.href = 'analytics.html';
  }

  async function fetchWithTimeout(url, options = {}, timeoutMs = 0) {
    const controller = new AbortController();
    const externalSignal = options.signal || null;
    let timer = null;

    const handleExternalAbort = () => controller.abort(externalSignal ? externalSignal.reason : undefined);

    if (externalSignal) {
      if (externalSignal.aborted) {
        controller.abort(externalSignal.reason);
      } else {
        externalSignal.addEventListener('abort', handleExternalAbort, { once: true });
      }
    }

    if (!controller.signal.aborted && timeoutMs > 0) {
      timer = setTimeout(() => controller.abort(new Error('Request timeout')), timeoutMs);
    }

    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
      if (externalSignal) {
        externalSignal.removeEventListener('abort', handleExternalAbort);
      }
    }
  }

  // -------------------- Server Probe (homepage info cards) --------------------
  async function probeServerInfo() {
    const ipEl = document.querySelector('[data-info="ip"]');
    const serverEl = document.querySelector('[data-info="server"]');
    const latencyEl = document.querySelector('[data-info="latency"]');
    const statusDotEl = document.querySelector('[data-info="status-dot"]');

    if (!ipEl && !serverEl && !latencyEl) return;

    setStatusDot(statusDotEl, 'offline');
    if (latencyEl) latencyEl.textContent = '-- ms';

    try {
      const infoResponse = await fetchWithTimeout(buildApiUrl('/api/speed/info'), {
        method: 'GET',
        cache: 'no-store',
      }, 2000);

      if (infoResponse.ok) {
        const info = await infoResponse.json();
        if (serverEl) serverEl.textContent = info.location || 'Online';
        if (ipEl) ipEl.textContent = 'localhost';
        setStatusDot(statusDotEl, 'online');
      }

      const latency = await quickPing(3);
      if (typeof latency === 'number' && latencyEl) {
        latencyEl.textContent = `${Math.round(latency)} ms`;
        setStatusDot(statusDotEl, 'online');
      }
    } catch (err) {
      console.warn('Server probe failed:', err);
      setStatusDot(statusDotEl, 'offline');
      if (serverEl) serverEl.textContent = 'Offline';
      if (ipEl) ipEl.textContent = '--';
    }
  }

  function setStatusDot(element, status) {
    if (!element) return;
    element.classList.remove('status-dot--online', 'status-dot--success', 'status-dot--offline');
    if (status === 'online') {
      element.classList.add('status-dot--online');
    } else if (status === 'success') {
      element.classList.add('status-dot--success');
    } else {
      element.classList.add('status-dot--offline');
    }
  }

  async function quickPing(samples = 2) {
    const timings = [];
    for (let i = 0; i < samples; i++) {
      const start = performance.now();
      try {
        const res = await fetchWithTimeout(buildApiUrl('/api/speed/ping'), {
          cache: 'no-store',
        }, 1500);
        if (!res.ok) throw new Error('Ping failed');
        await res.text();
        timings.push(performance.now() - start);
      } catch (err) {
        break;
      }
    }
    if (!timings.length) return null;
    return timings.reduce((a, b) => a + b, 0) / timings.length;
  }

  // -------------------- Public API --------------------
  return {
    init,
    updateSpeedDisplay,
    updateProgress,
    updateMetric,
    updateStatus,
    updatePhaseIndicator,
    animateNumber,
    getState: () => ({ ...state }),
    goToAnalytics,
    getResults,
    saveResults,
    clearResults,
    setResults,
    getGamingRank,
    displayRankBadge,
    exportHistory,
    importHistory,
    showToast,
  };
})();

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', HybridSpeed.init);
