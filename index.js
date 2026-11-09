/* AI-NOTES
What this is: the whole extension page (panes, tiling, tabs, sync, event log) in ONE function. The dev patch engine (folder link, payload, patch apply, AI loop) is everything after the AI COMPILE & PATCH WORKSPACE ENGINE comment, in sections whose names start with Dev.
Dev bar: #dev-bar sits in the extensions panel. The buttons for auto-patch, nuts mode, tags, scan, replace everywhere, parts map, undo and redo are created by script in devInitButtons, they are not in index.html.
Patch format: a FILE header line, then OLD, a SPLIT line, NEW. Several blocks are joined by BLOCK lines. All blocks are applied together or not at all, and a syntax guard rejects a patch that breaks a js or json file. A new file is a FILE header with an empty OLD; a file is deleted with the DEV_DELETE marker line as NEW. Files in subfolders are loaded and addressed by their path, and a reference check rejects a patch that leaves a file named in manifest.json or index.html missing. The camera button collects facts about the elements under drawn boxes (no image).
Reload: a saved patch reloads the page, or the whole extension for background.js, manifest.json, rules.json and content-*.js. Undo and redo survive the reload (IndexedDB DevHistDB).
AI loop: content-ai.js posts aiReply from the AI pane, the dev engine listens to it and sends payloads back with sendToAI. Nuts mode state lives in sessionStorage keys starting with split-view:dev-.
Traps: DevWorkspaceDB is shared with cloud-sync.js, never change its version or stores. A line longer than 3000 characters cannot be split into parts. Every localStorage key starts with split-view:.
Part tags: sections are cut at comment lines made of box-drawing characters around a title, and @SectionName works like @partN. Part numbers change whenever code is added or removed.
*/
(function () {
  'use strict';

  // ════════ EVENT LOG (viewer + copy) ════════
  const LOG_KEY = 'split-view:log:v1';
  const LOG_MAX = 500;
  const evLog = [];
  try {
    const oldLog = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
    if (Array.isArray(oldLog)) {
      oldLog.slice(-LOG_MAX).forEach(function (l) {
        if (l && l.t && l.m) evLog.push(l);
      });
    }
  } catch (e) {}
  let logSaveTimer = 0;
  let logPanel = null;
  let logArea = null;
  const logBtn = document.getElementById('dev-btn-log');

  function logStr(v) {
    if (typeof v === 'string') return v;
    if (v instanceof Error) return v.stack || v.message;
    try {
      return JSON.stringify(v);
    } catch (e) {
      return String(v);
    }
  }
  function logStamp(t) {
    const d = new Date(t);
    const p = function (n, l) {
      return String(n).padStart(l || 2, '0');
    };
    return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + '.' + p(d.getMilliseconds(), 3);
  }
  function logLine(l) {
    return '[' + logStamp(l.t) + '] ' + l.k + ' | ' + l.m;
  }
  function renderLog() {
    if (!logArea) return;
    const atBottom = logArea.scrollTop + logArea.clientHeight >= logArea.scrollHeight - 30;
    logArea.value = evLog.map(logLine).join('\n');
    if (atBottom) logArea.scrollTop = logArea.scrollHeight;
  }
  function devLog(kind, msg) {
    const entry = { t: Date.now(), k: String(kind), m: String(logStr(msg)).slice(0, 1500) };
    evLog.push(entry);
    if (evLog.length > LOG_MAX) evLog.splice(0, evLog.length - LOG_MAX);
    clearTimeout(logSaveTimer);
    logSaveTimer = setTimeout(function () {
      try {
        localStorage.setItem(LOG_KEY, JSON.stringify(evLog));
      } catch (e) {}
    }, 400);
    if (logPanel && !logPanel.hidden) renderLog();
    else if (entry.k === 'ERROR' && logBtn) logBtn.style.color = '#ff6b6b';
  }
  function logHeader() {
    let v = '?';
    try {
      v = chrome.runtime.getManifest().version;
    } catch (e) {}
    let s = '';
    try {
      s =
        'layout=' + detectPreset(state.layout) + ' panes=' + visibleKeys().length +
        ' sites=' + state.sites.length + ' ' +
        visibleKeys().map(function (k) {
          return k + '=' + state.panes[k].active + '@' + state.panes[k].zoom;
        }).join(' ');
    } catch (e) {}
    return (
      '=== SPLIT VIEW LOG ===\n' +
      'Ext version: ' + v + '\n' +
      'Time: ' + new Date().toString() + '\n' +
      'UA: ' + navigator.userAgent + '\n' +
      'Window: ' + window.innerWidth + 'x' + window.innerHeight + '\n' +
      'State: ' + s + '\n' +
      'Entries: ' + evLog.length + '\n' +
      '======================\n'
    );
  }
  function logFallbackCopy(text) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      const r = document.execCommand('copy');
      document.body.removeChild(ta);
      return r;
    } catch (e) {
      return false;
    }
  }
  function copyLog() {
    const text = logHeader() + evLog.map(logLine).join('\n');
    const btn = document.getElementById('lp-copy');
    const done = function (ok) {
      devLog('LOG', ok ? 'Log copied to clipboard (' + text.length + ' chars)' : 'Log copy FAILED');
      if (btn) {
        btn.textContent = ok ? 'Copied ✓' : 'Failed ✕';
        setTimeout(function () {
          btn.textContent = 'Copy';
        }, 1500);
      }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () {
          done(true);
        },
        function () {
          done(logFallbackCopy(text));
        }
      );
    } else done(logFallbackCopy(text));
  }
  function buildLogPanel() {
    if (logPanel) return;
    const st = document.createElement('style');
    st.textContent =
      '#dev-log-panel{position:fixed;left:0;right:0;top:0;bottom:0;z-index:6000;display:flex;flex-direction:column;background:#000432;color:#fff;font:12px monospace}' +
      '#dev-log-panel[hidden]{display:none}' +
      '#dev-log-panel .lp-head{flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;padding:8px 10px;border-bottom:1px solid #fff;font-weight:bold}' +
      '#dev-log-panel .lp-btns{display:flex;gap:8px}' +
      '#dev-log-panel button{background:transparent;color:#fff;border:1px solid #fff;border-radius:999px;padding:5px 14px;font:bold 12px monospace;cursor:pointer}' +
      '#dev-log-panel button:active{background:rgba(255,255,255,0.25)}' +
      '#dev-log-panel textarea{flex:1 1 auto;min-height:0;width:100%;resize:none;border:none;outline:none;background:transparent;color:#fff;font:11px/1.45 monospace;padding:8px 10px;white-space:pre;overflow:auto}';
    document.head.appendChild(st);
    logPanel = document.createElement('div');
    logPanel.id = 'dev-log-panel';
    logPanel.hidden = true;
    logPanel.innerHTML =
      '<div class="lp-head"><span>Event Log</span><span class="lp-btns">' +
      '<button type="button" id="lp-copy">Copy</button>' +
      '<button type="button" id="lp-clear">Clear</button>' +
      '<button type="button" id="lp-close">✕</button></span></div>' +
      '<textarea id="lp-text" readonly spellcheck="false"></textarea>';
    document.body.appendChild(logPanel);
    logArea = document.getElementById('lp-text');
    document.getElementById('lp-copy').addEventListener('click', copyLog);
    document.getElementById('lp-clear').addEventListener('click', function () {
      evLog.length = 0;
      try {
        localStorage.removeItem(LOG_KEY);
      } catch (e) {}
      devLog('LOG', 'Log cleared');
      renderLog();
    });
    document.getElementById('lp-close').addEventListener('click', function () {
      logPanel.hidden = true;
    });
  }
  function toggleLogPanel() {
    buildLogPanel();
    logPanel.hidden = !logPanel.hidden;
    if (!logPanel.hidden) {
      if (logBtn) logBtn.style.color = '';
      renderLog();
      logArea.scrollTop = logArea.scrollHeight;
    }
  }
  if (logBtn) logBtn.addEventListener('click', toggleLogPanel);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && logPanel && !logPanel.hidden) logPanel.hidden = true;
  });

  function logDescribe(n) {
    if (!n || !n.tagName) return String(n);
    let s = n.tagName.toLowerCase();
    if (n.id) s += '#' + n.id;
    if (typeof n.className === 'string' && n.className.trim()) s += '.' + n.className.trim().split(/\s+/)[0];
    const label = n.getAttribute('aria-label') || n.getAttribute('title') || (n.textContent || '').trim();
    if (label) s += ' "' + label.replace(/\s+/g, ' ').slice(0, 40) + '"';
    return s;
  }

  // Errors
  window.addEventListener('error', function (e) {
    devLog('ERROR', 'Uncaught: ' + e.message + ' @ ' + (e.filename || '') + ':' + e.lineno + ':' + e.colno + (e.error && e.error.stack ? '\n' + e.error.stack : ''));
  });
  window.addEventListener('unhandledrejection', function (e) {
    const r = e.reason;
    devLog('ERROR', 'Unhandled promise rejection: ' + (r && (r.stack || r.message) ? r.stack || r.message : logStr(r)));
  });
  ['error', 'warn'].forEach(function (fn) {
    const orig = console[fn];
    console[fn] = function () {
      try {
        devLog(fn === 'error' ? 'ERROR' : 'WARN', Array.prototype.map.call(arguments, logStr).join(' '));
      } catch (e) {}
      return orig.apply(console, arguments);
    };
  });

  // Network (every fetch: URL, status, time, failures)
  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    const u = typeof input === 'string' ? input : (input && input.url) || '';
    const method = (init && init.method) || (input && input.method) || 'GET';
    const t0 = Date.now();
    return origFetch.apply(this, arguments).then(
      function (r) {
        devLog(r.ok ? 'NET' : 'NET-ERR', method + ' ' + u.slice(0, 200) + ' -> ' + r.status + ' (' + (Date.now() - t0) + 'ms)');
        return r;
      },
      function (err) {
        devLog('NET-ERR', method + ' ' + u.slice(0, 200) + ' FAILED: ' + (err && err.message ? err.message : err) + ' (' + (Date.now() - t0) + 'ms)');
        throw err;
      }
    );
  };

  // User clicks
  document.addEventListener(
    'click',
    function (e) {
      const t = e.target;
      if (!t || !t.closest) return;
      if (logPanel && logPanel.contains(t)) return;
      devLog('CLICK', logDescribe(t.closest('button,[role="button"],.mgr-tile,.divider,input,a') || t));
    },
    true
  );

        var diagOn = false, diagBox = null, diagLines = [], diagAll = [], diagTxt = null;
      function diagCopyText(t, btn) {
        var done = function (ok) {
          btn.textContent = ok ? 'COPIED' : 'COPY FAILED';
          setTimeout(function () {
            btn.textContent = 'COPY LOG';
          }, 1500);
        };
        var fb = function () {
          var ok = false;
          try {
            var ta = document.createElement('textarea');
            ta.value = t;
            ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
            document.body.appendChild(ta);
            ta.select();
            ok = document.execCommand('copy');
            ta.remove();
          } catch (e) {}
          done(ok);
        };
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(t).then(function () {
              done(true);
            }, fb);
            return;
          }
        } catch (e0) {}
        fb();
      }
            function diagShow(line) {
        try {
          if (!diagOn) return;
          if (!diagBox) {
            diagBox = document.createElement('div');
            diagBox.id = 'trinityDiag';
            diagBox.style.cssText = 'position:fixed;left:6px;top:122px;width:360px;max-height:30vh;overflow:hidden;background:rgba(0,0,0,.85);color:#0f0;font:10px/1.3 monospace;padding:4px 6px;z-index:2147483647;pointer-events:none;white-space:pre-wrap;word-break:break-all;border:1px solid #0f0;';
            document.body.appendChild(diagBox);
          }
          var diagStamp = new Date().toLocaleTimeString() + ' ' + line;
                diagLines.push(diagStamp);
                diagAll.push(diagStamp);
                if (diagAll.length > 500) diagAll.shift();
          if (diagLines.length > 6) diagLines.shift();
          if (!diagTxt) {
                  var diagBtn = document.createElement('button');
                  diagBtn.textContent = 'COPY LOG';
                  diagBtn.style.cssText = 'pointer-events:auto;cursor:pointer;display:block;margin:0 0 3px 0;background:#0f0;color:#000;border:0;font:bold 10px monospace;padding:2px 8px;';
                  diagBtn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    diagCopyText('EXT PAGE (relay monitor)\n' + diagAll.join('\n'), diagBtn);
                  });
                  diagTxt = document.createElement('div');
                  diagBox.appendChild(diagBtn);
                  diagBox.appendChild(diagTxt);
                }
                diagTxt.textContent = 'EXT PAGE (relay monitor)\n' + diagLines.join('\n');
        } catch (e) {}
      }
      window.addEventListener(
        'message',
        function (ev) {
          try {
            var d = ev.data;
            if (!d || typeof d !== 'object') return;
            var ks = Object.keys(d).join(',');
            if (!/trinity|pair|trade/i.test(ks)) return;
            var pn = null;
            try {
              pn = paneFromSource(ev.source);
            } catch (x1) {}
            var tg = [];
            try {
              visibleKeys().forEach(function (k) {
                var o = panes[k];
                if (!o || o === pn) return;
                var h = '?';
                try {
                  h = new URL(o.view.src).hostname;
                } catch (x2) {}
                tg.push(k + ':' + h + (o.view.contentWindow ? '' : '(nowin)'));
              });
            } catch (x3) {}
            var s = '';
            try {
              s = JSON.stringify(d);
            } catch (x4) {
              s = '?';
            }
            diagShow('IN from ' + (pn ? pn.key : 'NOT-A-PANE') + ' origin=' + ev.origin + ' ' + s.slice(0, 110) + ' -> relay targets: ' + (tg.join(' ') || 'NONE'));
          } catch (e0) {}
        },
        true
      );
      // Messages from the framed pages (only our own message types; everything else is skipped)
  window.addEventListener(
    'message',
    function (e) {
      const d = e.data;
      if (!d || typeof d !== 'object' || d.splitViewTap === true) return;
      if (!(d.splitViewReady || d.splitViewMenu || d.trinityOS_pair || d.trinityOS_trade || d.pair)) return;
      devLog('MSG', 'from ' + (e.origin || '?') + ' ' + JSON.stringify(d).slice(0, 200));
    },
    true
  );

  // ════════ PANES: six fixed slots (min 1, max 6 shown). The layout decides which are visible. ════════
  const PANE_KEYS = ['top', 'bottom', 'third', 'fourth', 'fifth', 'sixth'];
  const PANE_SUFFIX = { top: 'Top', bottom: 'Bottom', third: 'Third', fourth: 'Fourth', fifth: 'Fifth', sixth: 'Sixth' };
  const MIN_PANES = 1;
  const MAX_PANES = 6;
  const frame = document.getElementById('frame');
  const panesWrapper = document.getElementById('panesWrapper');
  const GRIP_SVG =
    '<svg viewBox="0 0 12 12" width="12" height="12" fill="currentColor" aria-hidden="true" style="display:block">' +
    '<circle cx="4" cy="3" r="1"/><circle cx="8" cy="3" r="1"/><circle cx="4" cy="6" r="1"/><circle cx="8" cy="6" r="1"/>' +
        '<circle cx="4" cy="9" r="1"/><circle cx="8" cy="9" r="1"/></svg>';
    const SWAP_SVG =
      '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;margin:auto">' +
      '<path d="M2.5 5.5h10M10 3l2.5 2.5L10 8"/><path d="M13.5 10.5h-10M6 8l-2.5 2.5L6 13"/></svg>';
  function buildPane(k) {
    const S = PANE_SUFFIX[k];
    const c = document.createElement('div');
    c.className = 'pane';
    c.id = 'pane' + S;
    c.setAttribute('data-pane', k);
    c.hidden = true;
    c.innerHTML =
      '<div class="pane-bar">' +
      '<div class="pane-grip" title="Drag onto another pane to swap, or onto its edge to dock here" aria-label="Move pane">' + GRIP_SVG + '</div>' +
            '<div class="pane-title" title="Tap to pick a site \u00b7 drag to move"></div>' +
      '<button class="pane-btn pane-swap" type="button" title="Swap with the next pane" aria-label="Swap with the next pane">' + SWAP_SVG + '</button>' +
      '<button class="pane-btn pane-add"type="button" title="Split this pane" aria-label="Split this pane">+</button>' +
      '<button class="pane-btn pane-close" type="button" title="Close pane" aria-label="Close pane">&times;</button>' +
      '</div>' +
      '<div class="pane-body">' +
      '<iframe id="view' + S + '" title="Pane" allow="clipboard-read; clipboard-write"></iframe>' +
      '<div class="tap-catcher" id="catcher' + S + '">Page unavailable or still loading &mdash; long-press to pick a site</div>' +
      '<div class="zoom-controls">' +
      '<div class="zoom-btn zout" id="zoomOut' + S + '" role="button" aria-label="Zoom out">&minus;</div>' +
            '<div class="zoom-btn zin" id="zoomIn' + S + '" role="button" aria-label="Zoom in">+</div>' +
      '<div class="zoom-btn zpo" id="panesOnly' + S + '" role="button" aria-label="Show only panes" title="Show only panes (hide top and bottom bars)"><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;pointer-events:none"><path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4"/></svg></div>' +
      '</div>' +
      '</div>';
    panesWrapper.appendChild(c);
    return {
      key: k,
      name: 'Pane',
      container: c,
      grip: c.querySelector('.pane-grip'),
      title: c.querySelector('.pane-title'),
            btnSwap: c.querySelector('.pane-swap'),
      btnAdd: c.querySelector('.pane-add'),
      btnClose: c.querySelector('.pane-close'),
      view: c.querySelector('iframe'),
      catcher: c.querySelector('.tap-catcher'),
      zoomIn: c.querySelector('.zin'),
      zoomOut: c.querySelector('.zout'),
      timer: 0
    };
  }
  const panes = {};
  PANE_KEYS.forEach(function (k) {
    panes[k] = buildPane(k);
  });

  // Pane page loads / failures
  PANE_KEYS.forEach(function (k) {
    const f = panes[k].view;
    f.addEventListener('load', function () {
      devLog('PANE', k + ' loaded: ' + (f.src || ''));
    });
    f.addEventListener('error', function () {
      devLog('ERROR', k + ' failed to load: ' + (f.src || ''));
    });
  });

  // App / browser events
  document.addEventListener('visibilitychange', function () {
    devLog('APP', 'visibility: ' + document.visibilityState);
  });
  document.addEventListener('fullscreenchange', function () {
    devLog('APP', 'fullscreen: ' + (document.fullscreenElement ? 'on' : 'off'));
  });
  window.addEventListener('online', function () {
    devLog('APP', 'network online');
  });
  window.addEventListener('offline', function () {
    devLog('APP', 'network offline');
  });
  devLog('APP', '=== Session start === ' + location.href);

    const MIN_RATIO = 0.15;
  const MAX_RATIO = 0.85;
  const ZOOM_MIN = 0.3;
  const ZOOM_MAX = 3;
  const ZOOM_STEP = 0.01;
    const LOCAL_KEY = 'split-view:state:v2';
  const QUAD_KEY = 'split-view:quad'; // old 4-pane divider positions (only read when converting an old save)
  const MAX_SITES = 200;
  const SAVE_DELAY_MS = 800;
  const REMOTE_WAIT_MS = 2000;
  const SESSION_RULE_ID = 9001;
  const SESSION_RULE_ID_SW = 9002;
  const FALLBACK_MS = 3000;
  function $(id) {
    return document.getElementById(id);
  }
  function clamp(n, lo, hi) {
    return Math.min(hi, Math.max(lo, n));
  }
  function safeGet(key) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? null : v;
    } catch (e) {
      return null;
    }
  }
  function safeSet(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (e) {}
  }
  function newId() {
    return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }
    // "www.aggr.trade" -> "aggr", "shop.example.co.uk" -> "shop.example", IPs / localhost are left alone
  function stripTld(host) {
    host = String(host || '').toLowerCase().replace(/^www\./, '');
    if (!host || host.indexOf('.') < 0 || host.indexOf(':') >= 0 || /^[\d.]+$/.test(host)) return host;
    var parts = host.split('.');
    var n = parts.length;
    var cut = n >= 3 && parts[n - 1].length === 2 && /^(co|com|org|net|gov|edu|ac)$/.test(parts[n - 2]) ? 2 : 1;
    return parts.slice(0, n - cut).join('.') || host;
  }
  function labelFor(url) {
    try {
      const u = new URL(url);
      if (u.hostname === '888znq.github.io') {
        return u.pathname.split('/').filter(Boolean)[0] || u.hostname;
      }
      return stripTld(u.hostname);
    } catch (e) {
      return url;
    }
  }
  // Name shown on a tile: a stored name that is just a domain (e.g. "aggr.trade") loses its ending
  function siteDisplayName(site) {
    var n = String((site && site.name) || '').trim();
    if (/^[^\s]+\.[a-z]{2,}$/i.test(n)) n = stripTld(n);
    return n || labelFor(site && site.url);
  }
  function normalizeUrl(input) {
    let s = String(input == null ? '' : input).trim();
    if (!s) return null;
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
      if (/^(javascript|data|blob|file|filesystem|about|chrome|chrome-extension|vbscript):/i.test(s)) return null;
      s = 'https://' + s;
    }
    try {
      const u = new URL(s);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
      if (!u.hostname) return null;
      return u.href;
    } catch (e) {
      return null;
    }
  }
  function cleanName(name, url) {
    const n = String(name == null ? '' : name).trim().slice(0, 40);
    return n || labelFor(url);
  }
  function defaultSites() {
    return {
      top: [
        { id: 'fft', name: 'FFT', url: 'https://888znq.github.io/FFT/' },
        { id: 'sys', name: 'SYS', url: 'https://888znq.github.io/SYS/' },
        { id: 'mip', name: 'MIP', url: 'https://888znq.github.io/MIP/' },
        { id: 'cmp', name: 'CMP', url: 'https://888znq.github.io/CMP/' },
        { id: 'aggr', name: 'aggr.trade', url: 'https://aggr.trade/' }
      ],
      bottom: [
        { id: 'olymp', name: 'OlympTrade', url: 'https://olymptrade.com/platform' },
        { id: 'rtn', name: 'RTN', url: 'https://888znq.github.io/RTN/' },
        { id: 'tnl', name: 'TNL', url: 'https://888znq.github.io/TNL/' },
        { id: 'img', name: 'Images', url: 'https://images.google.com/' },
        { id: 'gem', name: 'Gemini', url: 'https://gemini.google.com/' },
        { id: 'nte', name: 'NTE', url: 'https://888znq.github.io/NTE/' },
        { id: 'fil', name: 'FIL', url: 'https://888znq.github.io/FIL/' },
        { id: 'ptt', name: 'PTT', url: 'https://888znq.github.io/PTT/' }
      ]
    };
  }
  // ════════ LAYOUT TREE ════════
  // state.layout is a tree:
  //   leaf  = { p: 'top' }                                   one pane
  //   split = { d: 'r' | 'c', s: [shares], k: [children], g?: 1 }
  //           d: 'r' = children side by side, 'c' = children stacked
  //           s: share of each child (adds up to 1)
  //           g: grid flag (the rows of a grid move their dividers together)
  function isLeaf(n) {
    return !!n && typeof n.p === 'string';
  }
  function leafNode(k) {
    return { p: k };
  }
  function leavesOf(n, out) {
    out = out || [];
    if (isLeaf(n)) out.push(n.p);
    else n.k.forEach(function (c) {
      leavesOf(c, out);
    });
    return out;
  }
  function evenSizes(n) {
    const a = [];
    for (let i = 0; i < n; i++) a.push(1 / n);
    return a;
  }
  function makeSplit(d, kids, g) {
    const n = { d: d, s: evenSizes(kids.length), k: kids };
    if (g) n.g = 1;
    return n;
  }
  function numIn(v, lo, hi, fallback) {
    v = Number(v);
    return isFinite(v) ? clamp(v, lo, hi) : fallback;
  }
  function normSizes(sizes) {
    let sum = 0;
    sizes.forEach(function (s) {
      sum += s;
    });
    if (!(sum > 0)) return evenSizes(sizes.length);
    const out = sizes.map(function (s) {
      return s / sum;
    });
    // a sliver is never a good size: fall back to an even split
    for (let i = 0; i < out.length; i++) if (out[i] < 0.02) return evenSizes(out.length);
    return out;
  }
  // Rebuilds a layout from saved data. Returns null when it is unusable.
  function cleanLayout(raw, used) {
    if (!raw || typeof raw !== 'object') return null;
    if (typeof raw.p === 'string') {
      if (PANE_KEYS.indexOf(raw.p) < 0 || used[raw.p]) return null;
      used[raw.p] = true;
      return leafNode(raw.p);
    }
    const d = raw.d === 'r' || raw.d === 'c' ? raw.d : null;
    if (!d) return null;
    const rk = toArray(raw.k);
    const rs = toArray(raw.s);
    const kids = [];
    const sizes = [];
    rk.forEach(function (c, i) {
      const n = cleanLayout(c, used);
      if (!n) return;
      kids.push(n);
      const s = Number(rs[i]);
      sizes.push(isFinite(s) && s > 0 ? s : 0);
    });
    if (!kids.length) return null;
    if (kids.length === 1) return kids[0];
    const node = { d: d, s: normSizes(sizes), k: kids };
    if (raw.g) node.g = 1;
    return node;
  }
  // Collapses single-child splits and merges a split into its parent when both run the same way.
  function simplify(n) {
    if (isLeaf(n)) return n;
    const kids = [];
    const sizes = [];
    n.k.forEach(function (c, i) {
      const sc = simplify(c);
      const sz = n.s[i];
      if (!isLeaf(sc) && sc.d === n.d) {
        sc.k.forEach(function (gc, j) {
          kids.push(gc);
          sizes.push(sz * sc.s[j]);
        });
      } else {
        kids.push(sc);
        sizes.push(sz);
      }
    });
    if (kids.length === 1) return kids[0];
    n.k = kids;
    n.s = normSizes(sizes);
    return n;
  }
  function locate(root, key) {
    let found = null;
    (function walk(n, parent, idx) {
      if (found) return;
      if (isLeaf(n)) {
        if (n.p === key) found = { node: n, parent: parent, index: idx };
        return;
      }
      n.k.forEach(function (c, i) {
        walk(c, n, i);
      });
    })(root, null, -1);
    return found;
  }
  function removeLeaf(root, key) {
    const loc = locate(root, key);
    if (!loc || !loc.parent) return root;
    const par = loc.parent;
    const i = loc.index;
    const freed = par.s[i];
    par.k.splice(i, 1);
    par.s.splice(i, 1);
    par.s[i > 0 ? i - 1 : 0] += freed; // the neighbour grows into the freed space
    return simplify(root);
  }
  // side: 'left' | 'right' | 'top' | 'bottom'
  function insertBeside(root, targetKey, newKey, side) {
    const loc = locate(root, targetKey);
    if (!loc) return root;
    const d = side === 'left' || side === 'right' ? 'r' : 'c';
    const before = side === 'left' || side === 'top';
    const par = loc.parent;
    const fresh = leafNode(newKey);
    if (par && par.d === d) {
      const half = par.s[loc.index] / 2;
      par.s[loc.index] = half;
      const at = before ? loc.index : loc.index + 1;
      par.k.splice(at, 0, fresh);
      par.s.splice(at, 0, half);
      return simplify(root);
    }
    const split = makeSplit(d, before ? [fresh, loc.node] : [loc.node, fresh]);
    if (!par) return split;
    par.k[loc.index] = split;
    return simplify(root);
  }
  function swapLeaves(root, a, b) {
    const la = locate(root, a);
    const lb = locate(root, b);
    if (!la || !lb) return root;
    la.node.p = b;
    lb.node.p = a;
    return root;
  }
  function moveLeaf(root, key, targetKey, side) {
    if (key === targetKey) return root;
    return insertBeside(removeLeaf(root, key), targetKey, key, side);
  }
  function equalize(n) {
    if (isLeaf(n)) return;
    n.s = evenSizes(n.k.length);
    n.k.forEach(equalize);
  }
    // True when the screen is held upright (taller than wide)
  function isPortrait() {
    return window.innerHeight > window.innerWidth * 1.05;
  }
  // kind: 'cols' (side by side) | 'rows' (stacked) | 'grid'
  function presetLayout(kind, keys) {
    if (keys.length < 2) return leafNode(keys[0] || 'top');
    const leaves = keys.map(leafNode);
    if (kind === 'cols') return makeSplit('r', leaves);
    if (kind === 'rows') return makeSplit('c', leaves);
    if (keys.length === 2) return makeSplit(isPortrait() ? 'c' : 'r', leaves);
    const cols = isPortrait() ? (keys.length <= 3 ? 1 : 2) : Math.ceil(Math.sqrt(keys.length));
    const rows = [];
    for (let i = 0; i < leaves.length; i += cols) {
      const chunk = leaves.slice(i, i + cols);
      rows.push(chunk.length === 1 ? chunk[0] : makeSplit('r', chunk));
    }
    return makeSplit('c', rows, true);
  }
  function detectPreset(root) {
    if (isLeaf(root)) return 'single';
    const flat = root.k.every(function (c) {
      return isLeaf(c);
    });
    if (flat && root.d === 'r') return 'cols';
    if (flat && root.d === 'c') return 'rows';
    if (root.d === 'c' && root.g) return 'grid';
    return 'custom';
  }
  function defaultState() {
    const d = defaultSites();
    const oldRatio = parseFloat(safeGet('split-notes:ratio'));
    const oldZt = parseFloat(safeGet('split-notes:zoomTop'));
    const oldZb = parseFloat(safeGet('split-notes:zoomBottom'));
    const ratio = isFinite(oldRatio) ? clamp(oldRatio, MIN_RATIO, MAX_RATIO) : 0.58;
    const layout = makeSplit('c', [leafNode('top'), leafNode('bottom')]);
    layout.s = [ratio, 1 - ratio];
    return {
      v: 3,
      layout: layout,
      sites: d.top.concat(d.bottom),
      panes: {
        top: { active: 'fft', zoom: isFinite(oldZt) ? clamp(oldZt, ZOOM_MIN, ZOOM_MAX) : 1 },
        bottom: { active: 'olymp', zoom: isFinite(oldZb) ? clamp(oldZb, ZOOM_MIN, ZOOM_MAX) : 1 },
        third: { active: 'sys', zoom: 1 },
        fourth: { active: 'rtn', zoom: 1 },
        fifth: { active: 'mip', zoom: 1 },
        sixth: { active: 'cmp', zoom: 1 }
      },
      ts: 0
    };
  }
  function toArray(x) {
    if (Array.isArray(x)) return x;
    if (x && typeof x === 'object') {
      return Object.keys(x)
        .sort(function (a, b) {
          return a - b;
        })
        .map(function (k) {
          return x[k];
        });
    }
    return [];
  }
  function cleanSites(raw) {
    const out = [];
    const seen = {};
    toArray(raw).forEach(function (s) {
            if (!s || typeof s !== 'object') return;
        const url = normalizeUrl(s.url);
        if (!url) return;
        let id = typeof s.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(s.id) ? s.id : newId();
              if (seen[id]) id = newId();
        seen[id] = true;
              var one = { id: id, name: cleanName(s.name, url), url: url };
          if (s.gh === true) one.gh = true; // GitHub-synced app (locked, cannot be deleted here)
          var pr = Number(s.pr);
          var pc = Number(s.pc);
          if (s.pr != null && s.pc != null && isFinite(pr) && isFinite(pc) && pr >= 0 && pc >= 0 && pr < 100 && pc < 100) {
            one.pr = Math.floor(pr); // saved cell: row counted from the bottom
            one.pc = Math.floor(pc); // saved cell: column
          }
          out.push(one);
        });
        return out.slice(0, MAX_SITES);
  }
  // Saves from before the tiling rewrite (orient 'v' / 'h' / 's' / 'q' + ratio) become a layout tree here.
  function layoutFromRaw(raw) {
    if (raw.layout) {
      const node = cleanLayout(raw.layout, {});
      if (node) return simplify(node);
    }
    const ratio = numIn(raw.ratio, MIN_RATIO, MAX_RATIO, 0.58);
    if (raw.orient === 's') return leafNode('top');
    if (raw.orient === 'q') {
      let qx = 0.5;
      let qy = 0.5;
      try {
        const qs = JSON.parse(safeGet(QUAD_KEY) || 'null'); // 4-pane divider positions were kept on the device
        if (qs) {
          qx = numIn(qs.x, MIN_RATIO, MAX_RATIO, 0.5);
          qy = numIn(qs.y, MIN_RATIO, MAX_RATIO, 0.5);
        }
      } catch (e) {}
      const g = presetLayout('grid', ['top', 'bottom', 'third', 'fourth']);
      g.s = [qy, 1 - qy];
      g.k[0].s = [qx, 1 - qx];
      g.k[1].s = [qx, 1 - qx];
      return g;
    }
    const n = makeSplit(raw.orient === 'h' ? 'r' : 'c', [leafNode('top'), leafNode('bottom')]);
    n.s = [ratio, 1 - ratio];
    return n;
  }
  function normalizeState(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const d = defaultSites();
    const st = { v: 3, panes: {}, ts: Number(raw.ts) || 0 };
    // ONE shared list of apps for all panes. Older saves kept two lists (top + bottom):
    // those are merged here, so nothing you added is lost.
    let pool = [];
    if (raw.sites) pool = toArray(raw.sites);
    else {
      ['top', 'bottom'].forEach(function (k) {
        const rp = raw.panes && raw.panes[k];
        pool = pool.concat(toArray(rp && rp.sites));
      });
    }
    let sites = cleanSites(pool);
    if (!sites.length) sites = d.top.concat(d.bottom);
    st.sites = sites;
    const legacyZoom = { top: raw.zoomTop, bottom: raw.zoomBottom, third: raw.zoomThird, fourth: raw.zoomFourth };
    PANE_KEYS.forEach(function (k, i) {
      const rp = raw.panes && raw.panes[k];
      let active = rp && typeof rp.active === 'string' ? rp.active : null;
      if (
        !sites.some(function (x) {
          return x.id === active;
        })
      )
        active = (sites[i] || sites[0]).id;
      const z = rp && rp.zoom != null ? rp.zoom : legacyZoom[k];
      st.panes[k] = { active: active, zoom: numIn(z, ZOOM_MIN, ZOOM_MAX, 1) };
    });
    st.layout = layoutFromRaw(raw);
    return st;
  }
  function readLocal() {
    const raw = safeGet(LOCAL_KEY);
    if (!raw) return null;
    try {
      return normalizeState(JSON.parse(raw));
    } catch (e) {
      return null;
    }
  }
    let state = readLocal() || defaultState();
  let saveTimer = 0;
  let dirty = false;
  var sessPing = function () {};
  function writeLocal() {
    safeSet(LOCAL_KEY, JSON.stringify(state));
  }
    // LOCAL ONLY: panes, layout, zoom and apps stay on this device (localStorage). Nothing goes to Firebase.
  function pushRemote() {
    clearTimeout(saveTimer);
    dirty = false;
  }
  function persist() {
    state.ts = Date.now();
    if (uiReady) refreshAllChrome();
    writeLocal();
        dirty = true;
    sessPing();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(pushRemote, SAVE_DELAY_MS);
  }
        document.addEventListener('visibilitychange', function () {
      if (document.hidden && dirty) pushRemote();
    });

    // ════════ TILING (Vivaldi style) ════════
    // Dividers snap to even splits (1/4, 1/3, 1/2, 2/3, 3/4) when dragged close to them.
    // Drag a pane's title strip onto the middle of another pane to swap them, or onto its
    // edge to dock it there. The + on a strip splits that pane, the x closes (untiles) it.
    const MAGNET_POINTS = [1 / 4, 1 / 3, 1 / 2, 2 / 3, 3 / 4];
    const MAGNET_RANGE = 0.025;
    const MIN_PANE_PX = 90;
    let uiReady = false; // true once init() runs (everything the first render must not touch is defined by then)
    let dragging = false; // a divider or a pane is being dragged
    let focusKey = 'top';
    const focusListeners = [];
    const dividerEls = [];

        function visibleKeys() {
      return leavesOf(state.layout);
    }
    var HOME_URL = 'https://888znq.github.io/TNL/';
    function hasSrc(p) {
      const s = p.view.getAttribute('src');
      return !!s && s !== 'about:blank' && s !== HOME_URL;
    }
    function magnet(r) {
      for (let i = 0; i < MAGNET_POINTS.length; i++) {
        if (Math.abs(r - MAGNET_POINTS[i]) <= MAGNET_RANGE) return MAGNET_POINTS[i];
      }
      return r;
    }
    // Turns the tree into a rectangle per pane (0..1 of the wrapper) and a list of dividers.
    function layoutRects(root) {
      const rects = {};
      const dividers = [];
      (function walk(n, x, y, w, h, parent) {
        if (isLeaf(n)) {
          rects[n.p] = { x: x, y: y, w: w, h: h };
          return;
        }
        const row = n.d === 'r';
        let pos = 0;
        n.k.forEach(function (c, i) {
          const sz = n.s[i];
          if (row) walk(c, x + pos * w, y, sz * w, h, n);
          else walk(c, x, y + pos * h, w, sz * h, n);
          pos += sz;
          if (i < n.k.length - 1) dividers.push({ node: n, parent: parent, i: i, row: row, x: x, y: y, w: w, h: h, at: pos });
        });
      })(root, 0, 0, 1, 1, null);
      return { rects: rects, dividers: dividers };
    }

    function applyZoom(el, scale) {
      const clamped = Math.round(clamp(scale, ZOOM_MIN, ZOOM_MAX) * 100) / 100;
      const inv = (1 / clamped) * 100;
      el.style.width = inv + '%';
      el.style.height = inv + '%';
      el.style.transform = 'scale(' + clamped + ')';
      return clamped;
    }

    function setFocus(k) {
      if (!panes[k] || visibleKeys().indexOf(k) < 0) return;
      const changed = k !== focusKey;
      focusKey = k;
      const multi = visibleKeys().length > 1;
      PANE_KEYS.forEach(function (x) {
        panes[x].container.classList.toggle('focus', multi && x === focusKey);
      });
      if (changed)
        focusListeners.forEach(function (fn) {
          try {
            fn(k);
          } catch (e) {}
        });
    }
    function updatePaneChrome(p) {
      if (!uiReady) return;
      const s = activeSite(p);
      const name = s ? siteDisplayName(s) : '';
      if (p.title.textContent !== name) p.title.textContent = name;
      p.title.title = p.name + (s ? ' \u00b7 ' + s.url : '') + ' \u00b7 tap to pick a site, drag to move';
    }
    function refreshAllChrome() {
      if (!uiReady) return;
      const n = visibleKeys().length;
      PANE_KEYS.forEach(function (k) {
        const p = panes[k];
        updatePaneChrome(p);
        p.btnClose.disabled = n <= MIN_PANES;
                p.btnAdd.disabled = n >= MAX_PANES;
        p.btnSwap.disabled = n < 2;
      });
    }

    function makeDividerEl() {
      const el = document.createElement('div');
      el.className = 'divider';
      el.setAttribute('role', 'separator');
      el.setAttribute('aria-label', 'Resize panes');
      el.tabIndex = 0;
      panesWrapper.appendChild(el);
      wireDivider(el);
      return el;
    }
    // f = where the divider should sit, as a share (0..1) of the split it belongs to
    function moveDivider(dv, f, snap) {
      const node = dv.node;
      const i = dv.i;
      const rect = panesWrapper.getBoundingClientRect();
      const lenPx = (dv.row ? dv.w * rect.width : dv.h * rect.height) || 1;
      let left = 0;
      for (let a = 0; a < i; a++) left += node.s[a];
      const right = left + node.s[i] + node.s[i + 1];
      const span = right - left;
      if (snap) {
        f = left + magnet((f - left) / span) * span;
        const n = node.k.length;
        if (n > 2 && Math.abs(f - (i + 1) / n) <= MAGNET_RANGE) f = (i + 1) / n;
      }
      const min = clamp(MIN_PANE_PX / lenPx, 0.03, 0.45);
      f = left + min < right - min ? clamp(f, left + min, right - min) : (left + right) / 2;
      const sizes = node.s.slice();
      sizes[i] = f - left;
      sizes[i + 1] = right - f;
      node.s = sizes;
      // the rows of a grid keep their dividers lined up
      if (dv.parent && dv.parent.g && dv.parent.d === 'c' && node.d === 'r') {
        dv.parent.k.forEach(function (sib) {
          if (sib !== node && !isLeaf(sib) && sib.d === 'r' && sib.k.length === node.k.length) sib.s = sizes.slice();
        });
      }
      renderLayout();
    }
    function wireDivider(el) {
      let pid = null;
      let pending = null;
      let raf = 0;
      function flush() {
        raf = 0;
        const dv = el._dv;
        if (pid === null || !pending || !dv) return;
        const rect = panesWrapper.getBoundingClientRect();
        const startPx = dv.row ? rect.left + dv.x * rect.width : rect.top + dv.y * rect.height;
        const lenPx = (dv.row ? dv.w * rect.width : dv.h * rect.height) || 1;
        moveDivider(dv, ((dv.row ? pending.x : pending.y) - startPx) / lenPx, true);
        pending = null;
      }
      function end() {
        if (pid === null) return;
        if (raf) {
          cancelAnimationFrame(raf);
          raf = 0;
        }
        if (pending) flush();
        const id = pid;
        pid = null;
        pending = null;
        try {
          el.releasePointerCapture(id);
        } catch (err) {}
        el.classList.remove('active');
        document.body.classList.remove('is-dragging', 'is-dragging-col');
        dragging = false;
        persist();
      }
      el._end = end;
      el.addEventListener('pointerdown', function (e) {
        if (pid !== null || tileDrag) return;
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        pid = e.pointerId;
        dragging = true;
        try {
          el.setPointerCapture(pid);
        } catch (err) {}
        el.classList.add('active');
        document.body.classList.add('is-dragging');
        if (el._dv && el._dv.row) document.body.classList.add('is-dragging-col');
        closeTileMenu();
        e.preventDefault();
      });
      el.addEventListener('pointermove', function (e) {
        if (pid === null || e.pointerId !== pid) return;
        pending = { x: e.clientX, y: e.clientY };
        if (!raf) raf = requestAnimationFrame(flush);
      });
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
      el.addEventListener('lostpointercapture', end);
      el.addEventListener('keydown', function (e) {
        const dv = el._dv;
        if (!dv) return;
        let dir = 0;
        if (dv.row) dir = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
        else dir = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
        if (!dir) return;
        let left = 0;
        for (let a = 0; a < dv.i; a++) left += dv.node.s[a];
        moveDivider(dv, left + dv.node.s[dv.i] + dir * 0.02, false);
        persist();
        e.preventDefault();
      });
    }

    // Puts every pane and divider where the layout tree says.
    function renderLayout() {
      const root = state.layout;
      const L = layoutRects(root);
      const vis = leavesOf(root);
      panesWrapper.classList.toggle('solo', vis.length < 2);
      PANE_KEYS.forEach(function (k) {
        const p = panes[k];
        const r = L.rects[k];
        if (!r) {
          p.container.hidden = true;
          return;
        }
        const s = p.container.style;
        p.container.hidden = false;
        s.left = r.x * 100 + '%';
        s.top = r.y * 100 + '%';
        s.width = r.w * 100 + '%';
        s.height = r.h * 100 + '%';
        p.name = 'Pane ' + (vis.indexOf(k) + 1);
      });
      if (vis.indexOf(focusKey) < 0) setFocus(vis[0]);
      else setFocus(focusKey);
      L.dividers.forEach(function (dv, idx) {
        const el = dividerEls[idx] || (dividerEls[idx] = makeDividerEl());
        el._dv = dv;
        const s = el.style;
        s.display = '';
        el.classList.toggle('vert', dv.row);
        el.setAttribute('aria-orientation', dv.row ? 'vertical' : 'horizontal');
        if (dv.row) {
          s.left = (dv.x + dv.at * dv.w) * 100 + '%';
          s.top = dv.y * 100 + '%';
          s.height = dv.h * 100 + '%';
          s.width = '';
        } else {
          s.top = (dv.y + dv.at * dv.h) * 100 + '%';
          s.left = dv.x * 100 + '%';
          s.width = dv.w * 100 + '%';
          s.height = '';
        }
      });
      for (let i = L.dividers.length; i < dividerEls.length; i++) {
        dividerEls[i]._dv = null;
        dividerEls[i].style.display = 'none';
      }
      if (uiReady) {
        refreshAllChrome();
        if (mgrIsOpen() && mgr.pane && vis.indexOf(mgr.pane.key) < 0) closeManager();
      }
    }
    function applyStateToUI() {
      PANE_KEYS.forEach(function (k) {
        state.panes[k].zoom = applyZoom(panes[k].view, state.panes[k].zoom);
      });
      renderLayout();
    }

        // RULE: every open starts totally blank. Panes never auto-load a site from the saved or
    // Firebase state; a pane only loads when you pick a site yourself (grid, address bar, +).
    function ensureLoaded() {
      return;
    }
    // A pane that leaves the layout stops running (its site is remembered for when it comes back).
        let resetPaneTabs = function () {};
        // keep = true: the pane only leaves the screen (its page keeps running hidden in the background).
    function retirePane(k, keep) {
      const p = panes[k];
      clearTimeout(p.timer);
      if (keep) return;
      resetPaneTabs(k);
      p.catcher.classList.remove('on');
      try {
        p.view.src = 'about:blank';
      } catch (e) {}
    }
        function addPane(besideKey, noLoad) {
      const vis = visibleKeys();
      if (vis.length >= MAX_PANES) {
        showToast('Maximum is ' + MAX_PANES + ' panes');
        return null;
      }
            // prefer a pane that is not keeping a background tab's page alive
      const freeKeys = PANE_KEYS.filter(function (k) {
        return vis.indexOf(k) < 0;
      });
      const key =
        freeKeys.filter(function (k) {
          return !hasSrc(panes[k]);
        })[0] || freeKeys[0];
      if (hasSrc(panes[key])) {
        try {
          panes[key].view.src = 'about:blank';
        } catch (e) {}
      }
      const ref = besideKey && vis.indexOf(besideKey) >= 0 ? besideKey : vis.indexOf(focusKey) >= 0 ? focusKey : vis[0];
      const box = panes[ref].container.getBoundingClientRect();
      const side = box.width >= box.height * 1.15 ? 'right' : 'bottom';
      // the new pane starts on an app that is not on screen yet
      const shown = {};
      vis.forEach(function (k) {
        shown[state.panes[k].active] = true;
      });
      const pick =
        state.sites.filter(function (s) {
          return !shown[s.id] && !isGmailSite(s);
        })[0] || activeSite(panes[ref]);
      state.layout = insertBeside(state.layout, ref, key, side);
      state.panes[key].active = pick.id;
      renderLayout();
            if (!noLoad) loadSite(panes[key], pick, { persist: false });
      persist();
      setFocus(key);
      return panes[key];
    }
    function closePane(key) {
      const vis = visibleKeys();
      if (vis.length <= MIN_PANES || vis.indexOf(key) < 0) return;
      const name = panes[key].name;
      if (mgrIsOpen() && mgr.pane === panes[key]) closeManager();
      state.layout = removeLeaf(state.layout, key);
      retirePane(key);
      renderLayout();
      persist();
      showToast('Closed ' + name);
    }
    function untileAll() {
      const vis = visibleKeys();
      if (vis.length < 2) return;
      const keep = vis.indexOf(focusKey) >= 0 ? focusKey : vis[0];
      if (mgrIsOpen()) closeManager();
      vis.forEach(function (k) {
        if (k !== keep) retirePane(k);
      });
      state.layout = leafNode(keep);
      renderLayout();
      persist();
      showToast('Single pane');
    }
    const PRESET_NAME = { cols: 'Side by side', rows: 'Stacked', grid: 'Grid' };
    function applyPreset(kind) {
      if (visibleKeys().length < 2 && !addPane()) return;
      state.layout = presetLayout(kind, visibleKeys());
            renderLayout();
        persist();
        showToast(PRESET_NAME[kind]);
      }

      // ── Portrait support ──
      // Upright screens get stacked panes, wide screens get side-by-side panes. Side-by-side and
      // stacked layouts swap when the screen turns; custom layouts are left exactly as they are.
      try {
        let vpMeta = document.querySelector('meta[name="viewport"]');
        if (!vpMeta) {
          vpMeta = document.createElement('meta');
          vpMeta.setAttribute('name', 'viewport');
          vpMeta.setAttribute('content', 'width=device-width, initial-scale=1, viewport-fit=cover');
          document.head.appendChild(vpMeta);
        }
      } catch (e) {}
      let portraitNow = false;
      let orientTimer = 0;
      function followOrientation(force) {
        const up = isPortrait();
        if (!force && up === portraitNow) return;
        portraitNow = up;
        if (force && !up) return;
        const vis = visibleKeys();
        if (vis.length < 2) return;
        const kind = detectPreset(state.layout);
        let next = '';
        if (up) next = kind === 'cols' ? 'rows' : kind === 'grid' && !force ? 'grid' : '';
        else next = kind === 'rows' ? 'cols' : kind === 'grid' ? 'grid' : '';
        if (!next) return;
        state.layout = presetLayout(next, vis);
        renderLayout();
        persist();
        showToast(PRESET_NAME[next]);
      }
      function queueOrientation() {
        clearTimeout(orientTimer);
        orientTimer = setTimeout(function () {
          followOrientation(false);
        }, 250);
      }
      window.addEventListener('resize', queueOrientation);
      window.addEventListener('orientationchange', queueOrientation);

    // ── Drag a pane's title strip: middle of another pane = swap, edge = dock there ──
    const dropHint = document.createElement('div');
    dropHint.className = 'drop-hint';
    dropHint.style.display = 'none';
    panesWrapper.appendChild(dropHint);
    let tileDrag = null;

    function tileZoneAt(x, y, exceptKey) {
      const vis = visibleKeys();
      for (let i = 0; i < vis.length; i++) {
        const k = vis[i];
        if (k === exceptKey) continue;
        const r = panes[k].container.getBoundingClientRect();
        if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
        const fx = (x - r.left) / r.width;
        const fy = (y - r.top) / r.height;
        let zone;
        if (fx > 0.28 && fx < 0.72 && fy > 0.28 && fy < 0.72) zone = 'center';
        else {
          const m = Math.min(fx, 1 - fx, fy, 1 - fy);
          zone = m === fx ? 'left' : m === 1 - fx ? 'right' : m === fy ? 'top' : 'bottom';
        }
        return { key: k, zone: zone, rect: r };
      }
      return null;
    }
    function showDropHint(hit) {
      if (!hit) {
        dropHint.style.display = 'none';
        return;
      }
      const w = panesWrapper.getBoundingClientRect();
      const r = hit.rect;
      let left = r.left - w.left;
      let top = r.top - w.top;
      let width = r.width;
      let height = r.height;
      if (hit.zone === 'left') width = r.width / 2;
      else if (hit.zone === 'right') {
        left += r.width / 2;
        width = r.width / 2;
      } else if (hit.zone === 'top') height = r.height / 2;
      else if (hit.zone === 'bottom') {
        top += r.height / 2;
        height = r.height / 2;
      }
      const s = dropHint.style;
      s.left = left + 'px';
      s.top = top + 'px';
      s.width = width + 'px';
      s.height = height + 'px';
      s.display = 'block';
    }
    function onTileMove(e) {
      const t = tileDrag;
      if (!t || e.pointerId !== t.id) return;
      if (!t.active) {
        if (Math.hypot(e.clientX - t.sx, e.clientY - t.sy) < 8) return;
        t.active = true;
        dragging = true;
        if (mgrIsOpen()) closeManager();
        closeTileMenu();
        document.body.classList.add('is-moving');
        panes[t.key].container.classList.add('lifting');
      }
      t.hit = tileZoneAt(e.clientX, e.clientY, t.key);
      showDropHint(t.hit);
      e.preventDefault();
    }
    function endTileDrag(cancelled) {
      const t = tileDrag;
      if (!t) return;
      tileDrag = null;
      dragging = false;
      document.body.classList.remove('is-moving');
      panes[t.key].container.classList.remove('lifting');
      dropHint.style.display = 'none';
      try {
        t.h.releasePointerCapture(t.id);
      } catch (err) {}
      if (!t.active) {
        // a tap on the title opens the site grid for that pane
        if (!cancelled && t.tap) {
          setFocus(t.key);
          if (!mgrIsOpen() || mgr.pane !== panes[t.key]) openManager(panes[t.key]);
        }
        return;
      }
      if (cancelled || !t.hit) return;
      const hit = t.hit;
      if (hit.zone === 'center') {
        state.layout = swapLeaves(state.layout, t.key, hit.key);
        showToast('Swapped ' + panes[t.key].name + ' and ' + panes[hit.key].name);
      } else {
        state.layout = moveLeaf(state.layout, t.key, hit.key, hit.zone);
        showToast('Moved pane');
      }
      renderLayout();
      persist();
      setFocus(t.key);
    }
        // Swaps this pane with the next one (in screen order). With 2 panes it simply trades places.
    function swapWithNext(key) {
      const vis = visibleKeys();
      if (vis.length < 2) return;
      const other = vis[(vis.indexOf(key) + 1) % vis.length];
      state.layout = swapLeaves(state.layout, key, other);
      renderLayout();
      persist();
      setFocus(key);
      showToast('Swapped panes');
    }
    function wirePane(p) {
      p.btnSwap.addEventListener('click', function (e) {
        e.stopPropagation();
        swapWithNext(p.key);
      });
      p.zoomIn.addEventListener('click', function () {
        state.panes[p.key].zoom = applyZoom(p.view, state.panes[p.key].zoom + ZOOM_STEP);
        persist();
      });
      p.zoomOut.addEventListener('click', function () {
        state.panes[p.key].zoom = applyZoom(p.view, state.panes[p.key].zoom - ZOOM_STEP);
        persist();
      });
      p.btnClose.addEventListener('click', function (e) {
        e.stopPropagation();
        closePane(p.key);
      });
      p.btnAdd.addEventListener('click', function (e) {
        e.stopPropagation();
        const np = addPane(p.key);
        if (np) openManager(np);
      });
      // pressing anywhere on a pane's own chrome makes it the active one (taps inside the page come as messages)
      p.container.addEventListener(
        'pointerdown',
        function () {
          setFocus(p.key);
        },
        true
      );
      [p.grip, p.title].forEach(function (h) {
        h.addEventListener('pointerdown', function (e) {
          if (tileDrag || dragging) return;
          if (e.pointerType === 'mouse' && e.button !== 0) return;
          tileDrag = { key: p.key, id: e.pointerId, sx: e.clientX, sy: e.clientY, active: false, hit: null, h: h, tap: h === p.title };
          try {
            h.setPointerCapture(e.pointerId);
          } catch (err) {}
        });
        h.addEventListener('pointermove', onTileMove);
        h.addEventListener('pointerup', function () {
          endTileDrag(false);
        });
        h.addEventListener('pointercancel', function () {
          endTileDrag(true);
        });
        h.addEventListener('lostpointercapture', function () {
          endTileDrag(true);
        });
        h.addEventListener('contextmenu', function (e) {
          e.preventDefault();
        });
      });
    }
        PANE_KEYS.forEach(function (k) {
      wirePane(panes[k]);
    });
    // Keep the + / - zoom buttons of every pane on screen, above the page, at any window size.
    (function paneExtrasStyle() {
      if (document.getElementById('pane-extras-style')) return;
      const st = document.createElement('style');
      st.id = 'pane-extras-style';
            st.textContent =
        '#panesWrapper .pane .zoom-controls{position:absolute!important;left:50%!important;right:auto!important;bottom:8px!important;transform:translateX(-50%)!important;z-index:60!important;display:flex!important;flex-direction:row!important;gap:8px!important;opacity:1!important;visibility:visible!important;pointer-events:auto!important}' +
        '#panesWrapper .pane .zoom-btn{display:flex!important;align-items:center;justify-content:center;width:32px;height:32px;box-sizing:border-box;border-radius:50%;background:rgba(0,4,50,0.82);color:#fff;border:1px solid rgba(255,255,255,0.45);font:600 20px/1 system-ui,sans-serif;cursor:pointer;user-select:none;-webkit-user-select:none;touch-action:manipulation}' +
        '#panesWrapper .pane .zoom-btn:active{background:#fff;color:#000432}' +
        '#panesWrapper .pane-swap{display:inline-flex;align-items:center;justify-content:center}' +
        '#panesWrapper .pane-swap:disabled{opacity:0.35}' +
                '#frame.panes-only > .cr-strip,#frame.panes-only > #taskbarMain,#frame.panes-only > #bmBar,#frame.panes-only > #devBottomBar{display:none!important}' +
                '#panesWrapper .pane .zpo.on{background:#fff;color:#000432}';
              panesWrapper.addEventListener('click', function (e) {
                const b = e.target && e.target.closest ? e.target.closest('.zpo') : null;
                if (!b) return;
                e.stopPropagation();
                const on = frame.classList.toggle('panes-only');
                PANE_KEYS.forEach(function (k) {
                  const z = panes[k].container.querySelector('.zpo');
                  if (!z) return;
                  z.classList.toggle('on', on);
                  z.title = on ? 'Show top and bottom bars' : 'Show only panes (hide top and bottom bars)';
                  z.setAttribute('aria-label', z.title);
                });
                try {
                  window.dispatchEvent(new Event('resize'));
                } catch (err) {}
              });
      document.head.appendChild(st);
    })();

    // ── Page Tiling button (taskbar) → menu ──
    const orientBtn = document.getElementById('orientBtn');
    let tileMenu = null;
    function tIcon(inner) {
      return (
        '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        inner +
        '</svg>'
      );
    }
    const TILE_ICON = {
      single: tIcon('<rect x="2" y="2.5" width="12" height="11" rx="1.5"/><rect x="5" y="5.5" width="6" height="5" rx="0.8"/>'),
      cols: tIcon('<rect x="2" y="2.5" width="12" height="11" rx="1.5"/><path d="M8 2.5v11"/>'),
      rows: tIcon('<rect x="2" y="2.5" width="12" height="11" rx="1.5"/><path d="M2 8h12"/>'),
      grid: tIcon('<rect x="2" y="2.5" width="12" height="11" rx="1.5"/><path d="M8 2.5v11M2 8h12"/>'),
      add: tIcon('<path d="M8 3v10M3 8h10"/>'),
      close: tIcon('<path d="M4 4l8 8M12 4l-8 8"/>'),
      even: tIcon('<path d="M3 5h10M3 11h10M8 3v10"/>')
    };
    function closeTileMenu() {
      if (!tileMenu) return;
      tileMenu.remove();
      tileMenu = null;
      if (orientBtn) orientBtn.setAttribute('aria-expanded', 'false');
    }
    function runTileAction(id) {
      closeTileMenu();
      if (id === 'single') untileAll();
      else if (id === 'cols' || id === 'rows' || id === 'grid') applyPreset(id);
      else if (id === 'add') {
        const np = addPane();
        if (np) openManager(np);
      } else if (id === 'close') closePane(focusKey);
      else if (id === 'even') {
        equalize(state.layout);
        renderLayout();
        persist();
        showToast('Panes evened out');
      }
    }
    function openTileMenu() {
      closeTileMenu();
      if (mgrIsOpen()) closeManager();
      const vis = visibleKeys();
      const preset = detectPreset(state.layout);
      const m = document.createElement('div');
      m.className = 'tile-menu';
      m.setAttribute('role', 'menu');
      const head = document.createElement('div');
      head.className = 'tile-head';
      head.textContent = 'Page tiling \u00b7 ' + vis.length + ' / ' + MAX_PANES + ' panes' + (preset === 'custom' ? ' \u00b7 custom' : '');
      m.appendChild(head);
      const items = [
        { id: 'single', label: 'Single pane (untile all)', on: preset === 'single' },
        { id: 'cols', label: 'Side by side', on: preset === 'cols' },
        { id: 'rows', label: 'Stacked', on: preset === 'rows' },
        { id: 'grid', label: 'Grid', on: preset === 'grid' },
        null,
        { id: 'add', label: 'Add pane', disabled: vis.length >= MAX_PANES },
        { id: 'close', label: 'Close ' + panes[focusKey].name, disabled: vis.length <= MIN_PANES },
        { id: 'even', label: 'Even out sizes', disabled: vis.length < 2 }
      ];
      items.forEach(function (it) {
        if (!it) {
          const sep = document.createElement('div');
          sep.className = 'tile-sep';
          m.appendChild(sep);
          return;
        }
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'tile-item' + (it.on ? ' on' : '');
        b.setAttribute('role', 'menuitem');
        b.disabled = !!it.disabled;
        b.innerHTML = '<span class="tile-ico">' + TILE_ICON[it.id] + '</span><span class="tile-lbl"></span><span class="tile-tick">' + (it.on ? '\u2713' : '') + '</span>';
        b.querySelector('.tile-lbl').textContent = it.label;
        b.addEventListener('click', function () {
          runTileAction(it.id);
        });
        m.appendChild(b);
      });
      document.body.appendChild(m);
      tileMenu = m;
      if (orientBtn) {
        const ob = orientBtn.getBoundingClientRect();
        m.style.bottom = 'auto';
        m.style.top = (ob.bottom + 6) + 'px';
        m.style.right = Math.max(8, window.innerWidth - ob.right) + 'px';
        orientBtn.setAttribute('aria-expanded', 'true');
      }
    }
    function toggleTileMenu(e) {
      if (e) e.preventDefault();
      if (tileMenu) closeTileMenu();
      else openTileMenu();
    }
    if (orientBtn) {
      orientBtn.addEventListener('click', toggleTileMenu);
      orientBtn.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') toggleTileMenu(e);
      });
    }
    document.addEventListener(
      'pointerdown',
      function (e) {
        if (!tileMenu) return;
        if (tileMenu.contains(e.target) || (orientBtn && orientBtn.contains(e.target))) return;
        closeTileMenu();
      },
      true
    );
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && tileMenu) closeTileMenu();
    });
    // Losing focus / hiding the app ends any drag that is in progress
    function endAllDrags() {
      dividerEls.forEach(function (el) {
        if (el._end) el._end();
      });
      endTileDrag(true);
    }
    window.addEventListener('blur', endAllDrags);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) endAllDrags();
    });
    focusKey = visibleKeys()[0] || 'top';
    applyStateToUI();
  const fsButtons = document.querySelectorAll('.fs-btn');
  const root = document.documentElement;
  let toastTimer = 0;
  let lastToggle = 0;
    function fsElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }
  function showToast(msg) {
    devLog('TOAST', msg);
    let t = document.getElementById('fsToast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'fsToast';
      t.className = 'fs-toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      t.classList.remove('show');
    }, 3500);
  }
  function requestFs(el) {
    const fn = el.requestFullscreen || el.webkitRequestFullscreen || el.webkitRequestFullScreen;
    if (!fn) return Promise.reject(new Error('Fullscreen API not supported'));
    try {
      const r = fn.call(el);
      return r && typeof r.then === 'function' ? r : Promise.resolve();
    } catch (e) {
      return Promise.reject(e);
    }
  }
  function exitFs() {
    const fn = document.exitFullscreen || document.webkitExitFullscreen || document.webkitCancelFullScreen;
    if (!fn) return Promise.reject(new Error('Exit fullscreen not supported'));
    try {
      const r = fn.call(document);
      return r && typeof r.then === 'function' ? r : Promise.resolve();
    } catch (e) {
      return Promise.reject(e);
    }
  }
  function toggleFullscreen(e) {
    if (e) e.preventDefault();
    const now = Date.now();
    if (now - lastToggle < 400) return;
    lastToggle = now;
    if (fsElement()) {
      exitFs().catch(function (err) {
        showToast('Exit fullscreen failed: ' + (err && err.message ? err.message : err));
      });
      return;
    }
    requestFs(root)
      .catch(function () {
        return requestFs(document.getElementById('frame'));
      })
      .catch(function (err) {
        showToast('Fullscreen blocked: ' + (err && err.message ? err.message : err));
      });
  }
  function syncFullscreenLabels() {
    const on = !!fsElement();
    root.classList.toggle('is-fs', on);
    fsButtons.forEach(function (b) {
      b.setAttribute('aria-label', on ? 'Exit fullscreen' : 'Enter fullscreen');
      b.title = on ? 'Exit fullscreen' : 'Fullscreen';
    });
  }
  fsButtons.forEach(function (b) {
    b.addEventListener('click', toggleFullscreen);
    b.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') toggleFullscreen(e);
    });
  });
  document.addEventListener('fullscreenchange', syncFullscreenLabels);
  document.addEventListener('webkitfullscreenchange', syncFullscreenLabels);
  document.addEventListener('fullscreenerror', function () {
    showToast('Fullscreen was refused by the browser');
  });

    // ════════ SITE HISTORY: every site you add or visit, saved to Firebase ════════
        const siteHistory = (function () {
          const LS_HIST = 'split-view:history:v1';
          const MAX_ENTRIES = 500;
          const SAVE_MS = 1500;
          const map = {};
          const lastSeen = {};
          let timer = 0;
          let dirty = false;
          let busy = false;

          function keyOf(host) { return String(host).replace(/\./g, ','); }

          // Returns { host, url } for a normal website, or null (search pages, about:blank, etc.)
          function parse(url) {
            try {
              const u = new URL(String(url));
              if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
              const host = u.hostname.toLowerCase().replace(/^www\./, '');
              if (!host || !/^[a-z0-9.-]+$/.test(host)) return null;
              if (host.indexOf('.') < 0 && host !== 'localhost') return null;
              if (/(^|\.)google\.[a-z.]+$/.test(host) && u.pathname === '/search') return null;
              return { host: host, url: u.origin + '/' };
            } catch (e) {
              return null;
            }
          }

          function merge(remote) {
            if (!remote || typeof remote !== 'object') return;
            Object.keys(remote).forEach(function (rk) {
              const r = remote[rk];
              if (!r || typeof r !== 'object' || !r.h) return;
              const host = String(r.h).toLowerCase();
              if (!/^[a-z0-9.-]+$/.test(host)) return;
              const k = keyOf(host);
              const l = map[k];
              if (!l) {
                map[k] = { h: host, u: String(r.u || ''), n: +r.n || 0, ts: +r.ts || 0 };
                return;
              }
              if ((+r.n || 0) > l.n) l.n = +r.n;
              if ((+r.ts || 0) > l.ts) {
                l.ts = +r.ts;
                if (r.u) l.u = String(r.u);
              }
            });
          }

          function prune() {
            const keys = Object.keys(map);
            if (keys.length <= MAX_ENTRIES) return;
            keys.sort(function (a, b) { return (map[b].ts || 0) - (map[a].ts || 0); });
            keys.slice(MAX_ENTRIES).forEach(function (k) { delete map[k]; });
          }

                    // RULE: visited-site history stays in memory only. It is never saved to
          // localStorage or Firebase, so every fresh open starts blank.
          function store() {}

          // RULE: nothing is pushed to Firebase from here. Only added groups sync (see saveGroups).
          function push() {
            clearTimeout(timer);
            dirty = false;
          }

          function changed() {
            prune();
            store();
            dirty = true;
            clearTimeout(timer);
            timer = setTimeout(push, SAVE_MS);
          }

          // record(url)        -> a real visit (count + 1, last visited = now)
          // record(url, true)  -> just remember the site (used for apps), no visit counted
          function record(url, seed) {
            const p = parse(url);
            if (!p) return;
            const k = keyOf(p.host);
            const now = Date.now();
            if (seed) {
              if (map[k]) return;
              map[k] = { h: p.host, u: p.url, n: 0, ts: 0 };
            } else {
              if (lastSeen[k] && now - lastSeen[k] < 3000) return;
              lastSeen[k] = now;
              const e = map[k] || (map[k] = { h: p.host, u: p.url, n: 0, ts: 0 });
              e.u = p.url;
              e.n = (e.n || 0) + 1;
              e.ts = now;
            }
            changed();
          }

          function all() {
            return Object.keys(map).map(function (k) { return map[k]; });
          }

                    // RULE: start blank every time. No history is loaded from this device or from Firebase.

          return { record: record, all: all, parse: parse };
        })();

        // ════════ BROWSER BARS: tab bar, address bar, bookmark bar ════════
    (function initBrowserBars() {
      const tabBar = $('tabBar');
      const navUrl = $('navUrl');
      const navPane = $('navPane');
      const navReload = $('navReload');
      const navStar = $('navStar');
      const bmBar = $('bmBar');
      if (!tabBar || !navUrl || !bmBar || !navPane || !navReload || !navStar) return;

      const PANE_ORDER = PANE_KEYS;
      function paneTag(k) {
        return String(visibleKeys().indexOf(k) + 1);
      }
      const LS_BM = 'split-view:bookmarks';

            // ── Chrome-style puzzle button: all the old controls live in its pop-up ──
            (function () {
              const cxBtn = $('cxBtn');
              const cxPanel = $('cxPanel');
              if (!cxBtn || !cxPanel) return;
                            const devBar = $('dev-bar');
              const tbRight = document.querySelector('#taskbarMain .taskbar-right');
              // Patch bar lives in its own bar at the very bottom of the extension (always visible)
              const frameEl = $('frame');
              if (devBar && frameEl) {
                const bottomBar = document.createElement('div');
                bottomBar.id = 'devBottomBar';
                bottomBar.className = 'taskbar';
                bottomBar.appendChild(devBar);
                frameEl.appendChild(bottomBar);
              } else if (devBar) {
                cxPanel.appendChild(devBar);
              }
              if (tbRight) cxPanel.appendChild(tbRight);
              function cxSet(open) {
                cxPanel.hidden = !open;
                cxBtn.classList.toggle('open', open);
                cxBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
              }
              cxBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                cxSet(cxPanel.hidden);
              });
              document.addEventListener('pointerdown', function (e) {
                if (cxPanel.hidden) return;
                const t = e.target;
                if (cxPanel.contains(t) || cxBtn.contains(t)) return;
                if (t && t.closest && t.closest('.tile-menu, .mgr')) return;
                cxSet(false);
              }, true);
              document.addEventListener('keydown', function (e) {
                if (e.key === 'Escape' && !cxPanel.hidden) cxSet(false);
              });
            })();
            let target = focusKey;
      const paneTabs = {}; // every pane keeps its own tabs
      resetPaneTabs = function (k) { delete paneTabs[k]; };
      let tabs = [];
      let activeId = null;
      let seq = 0;
      let bookmarks = [];

      function readLS(k, d) {
        try {
          const v = JSON.parse(localStorage.getItem(k));
          return v == null ? d : v;
        } catch (e) { return d; }
      }
      function writeLS(k, v) {
        try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
      }
            function mk(tag, cls, text) {
              const e = document.createElement(tag);
              if (cls) e.className = cls;
              if (text != null) e.textContent = text;
              return e;
            }

            // ════════ Chrome-style bookmarks: star bubble + bookmark manager ════════
            const BM_BAR = 'bar';
            const BM_OTHER = 'other';
            const BM_FOLDERS = [[BM_BAR, 'Bookmarks bar'], [BM_OTHER, 'Other bookmarks']];
            let bmBub = null;        // the open star bubble: { el, apply }
            let bmMgr = null;        // the open manager: { root, side, list, input }
            let bmMenuEl = null;     // the open ⋮ menu inside the manager
            let bmFolderSel = BM_BAR;
            let bmQuery = '';

            function bmFolderIco() {
              return '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true" style="display:block;flex:0 0 auto"><path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>';
            }
                        function bmFolderById(id) {
              if (!id) return null;
              for (let i = 0; i < bookmarks.length; i++) {
                const x = bookmarks[i];
                if (x && x.folder && x.id === id) return x;
              }
              return null;
            }
            // Root a bookmark / folder lives under ('bar' or 'other'); items inside a folder follow that folder
            function bmFolderOf(b) {
              if (b && b.p) {
                const fo = bmFolderById(b.p);
                if (fo) return fo.f === BM_OTHER ? BM_OTHER : BM_BAR;
              }
              return b && b.f === BM_OTHER ? BM_OTHER : BM_BAR;
            }
            // Id of the folder an item sits in, or '' when it sits directly on the bar / in Other bookmarks
            function bmParentOf(b) {
              return b && b.p && bmFolderById(b.p) ? b.p : '';
            }
            function bmNewId() {
              return 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
            }
            // Put an item at a root ('bar' / 'other') or inside a folder (folder id). Folders only live at the top level.
            function bmPlace(b, val) {
              let fo = (val === BM_BAR || val === BM_OTHER) ? null : bmFolderById(val);
              if (fo && b.folder) { val = bmFolderOf(fo); fo = null; }
              if (fo) { b.p = fo.id; b.f = bmFolderOf(fo); }
              else { delete b.p; b.f = val === BM_OTHER ? BM_OTHER : BM_BAR; }
            }
            // Every place an item can go: [value, indented label, depth, plain title]
            function bmChoices() {
              const out = [];
              BM_FOLDERS.forEach(function (f) {
                out.push([f[0], f[1], 0, f[1]]);
                bookmarks.forEach(function (b) {
                  if (b && b.folder && !b.p && bmFolderOf(b) === f[0]) {
                    const t = b.title || 'New folder';
                    out.push([b.id, '\u00a0\u00a0\u00a0\u00a0' + t, 1, t]);
                  }
                });
              });
              return out;
            }
            function bmLocName(id) {
              const all = bmChoices();
              const c = all.find(function (x) { return x[0] === id; }) || all[0];
              return c[3];
            }
            function bmNorm(u) {
              u = String(u || '').trim();
              if (!u) return '';
              return /^[a-z][a-z0-9+.-]*:/i.test(u) ? u : 'https://' + u;
            }
                        // ════════ Firebase sync for bookmarks + folders (whole list, newest change wins) ════════
            const LS_BM_TS = 'split-view:bookmarks:ts';
            const LS_BM_DIRTY = 'split-view:bookmarks:dirty';
            let bmTs = Number(readLS(LS_BM_TS, 0)) || 0;   // time of the last local change or applied online copy
            let bmPushing = false;
            let bmPushAgain = false;

            function bmIsDirty() { return readLS(LS_BM_DIRTY, 0) === 1; }
            function bmSetDirty(on) {
              try {
                if (on) writeLS(LS_BM_DIRTY, 1);
                else localStorage.removeItem(LS_BM_DIRTY);
              } catch (e) {}
            }
            function bmSetTs(t) {
              bmTs = t;
              writeLS(LS_BM_TS, t);
            }
            // Plain copy of one bookmark / folder with only the fields we store online
            function bmCleanItem(b) {
              if (!b || typeof b !== 'object') return null;
              const o = {};
              if (b.folder) {
                o.folder = true;
                o.id = String(b.id || bmNewId());
              } else {
                const u = String(b.url || '').trim();
                if (!u) return null;
                o.url = u;
                if (b.id) o.id = String(b.id);
              }
              o.title = String(b.title || '');
              o.f = b.f === BM_OTHER ? BM_OTHER : BM_BAR;
              if (b.p) o.p = String(b.p);
              return o;
            }
            // Firebase may hand a list back as an array or as an object with numeric keys
            function bmNormList(raw) {
              let arr = raw;
              if (raw && !Array.isArray(raw) && typeof raw === 'object') {
                const obj = raw;
                arr = Object.keys(obj).sort(function (a, b) { return Number(a) - Number(b); }).map(function (k) { return obj[k]; });
              }
              if (!Array.isArray(arr)) return [];
              const out = [];
              arr.forEach(function (x) {
                const c = bmCleanItem(x);
                if (c) out.push(c);
              });
              return out;
            }
            // First sync on a device: keep what is online AND what is already here, without duplicates
            function bmUnion(remoteList, localList) {
              const out = remoteList.slice();
              const idMap = {};
              localList.forEach(function (b) {
                if (!b || !b.folder) return;
                const hit = out.find(function (x) {
                  return x.folder && (x.id === b.id || ((x.f || BM_BAR) === (b.f || BM_BAR) && x.title === b.title));
                });
                if (hit) idMap[b.id] = hit.id;
                else { out.push(b); idMap[b.id] = b.id; }
              });
              localList.forEach(function (b) {
                if (!b || b.folder) return;
                const p = b.p ? (idMap[b.p] || b.p) : '';
                const dup = out.some(function (x) {
                  return !x.folder && x.url === b.url && (x.p || '') === p && (x.f || BM_BAR) === (b.f || BM_BAR);
                });
                if (dup) return;
                const c = Object.assign({}, b);
                if (p) c.p = p; else delete c.p;
                out.push(c);
              });
              return out;
            }
            function bmApplyList(list, ts) {
              if (bmBub) bmCloseBubble(false);
              bookmarks.length = 0;
              list.forEach(function (x) { bookmarks.push(x); });
              if (bmClip && bookmarks.indexOf(bmClip) < 0) bmClip = null;
              writeLS(LS_BM, bookmarks);
              bmSetTs(ts);
              bmSetDirty(false);
              render();
              if (bmMgr) bmRefresh();
            }
            function bmPush() {
              const S = window.SplitSync;
              if (!S || !S.saveBookmarks) return;
              if (bmPushing) { bmPushAgain = true; return; }
              bmPushing = true;
              const ts = bmTs;
              S.saveBookmarks({ v: 1, ts: ts, items: bmNormList(bookmarks) }).then(function (ok) {
                bmPushing = false;
                if (ok && bmTs === ts) bmSetDirty(false);
                if (bmPushAgain) { bmPushAgain = false; bmPush(); }
              });
            }
            // Compare the online copy with this device and decide: push ours, take theirs, or merge (first sync)
            function bmReconcile(remote) {
              if (remote === undefined) return;
              const dirty = bmIsDirty();
              if (!remote || typeof remote !== 'object') {
                // nothing stored online yet
                if (bookmarks.length || dirty) {
                  if (!bmTs) bmSetTs(Date.now());
                  bmPush();
                }
                return;
              }
              const rts = Number(remote.ts) || 0;
              // same version as ours (for example our own push coming back): nothing to do
              if (bmTs && rts === bmTs) {
                if (dirty) bmSetDirty(false);
                return;
              }
              const list = bmNormList(remote.items);
              if (!bmTs && bookmarks.length && !dirty) {
                bmApplyList(bmUnion(list, bmNormList(bookmarks)), rts);
                bmSetTs(Math.max(Date.now(), rts + 1));
                bmSetDirty(true);
                bmPush();
                return;
              }
              if (dirty || bmTs > rts) { bmPush(); return; }
              bmApplyList(list, rts);
            }
            function bmPull() {
              const S = window.SplitSync;
              if (!S || !S.loadBookmarks) return;
              S.loadBookmarks(6000).then(bmReconcile);
            }
            function bmSyncStart(tries) {
              const S = window.SplitSync;
              if (!S || !S.loadBookmarks || !S.subscribeBookmarks) {
                const n = tries || 0;
                if (n < 10) setTimeout(function () { bmSyncStart(n + 1); }, 500);
                return;
              }
              bmPull();
              S.subscribeBookmarks(bmReconcile);
              document.addEventListener('visibilitychange', function () {
                if (!document.hidden) bmPull();
              });
              window.addEventListener('focus', bmPull);
            }
            setTimeout(bmSyncStart, 0);

            // Every change (add, delete, rename, move, folder, sort, ...) goes through here
            function bmSave() {
              bmSetTs(Math.max(Date.now(), bmTs + 1));
              bmSetDirty(true);
              writeLS(LS_BM, bookmarks);
              render();
              if (bmMgr) bmRefresh();
              bmPush();
            }

            (function bmStyleInit() {
              if (document.getElementById('bm-style')) return;
              const st = document.createElement('style');
              st.id = 'bm-style';
              st.textContent = `
      #frame #bmBar .bb-allmarks { display: inline-flex; align-items: center; gap: 6px; flex: 0 0 auto; cursor: pointer; }
            #frame #bmBar .bb-allmarks svg, #frame #bmBar .bb-foldmark svg { color: #5f6368; }
            #frame #bmBar .bb-foldmark { display: inline-flex; align-items: center; gap: 6px; flex: 0 0 auto; cursor: pointer; }
      @media (max-width: 900px) {
        #frame #bmBar { gap: 0 !important; overflow-x: hidden !important; }
        #frame #bmBar .bb-foldmark { padding: 0 !important; gap: 0 !important; min-width: 0 !important; overflow: hidden; }
        #frame #bmBar .bb-foldmark .bb-mark-title { font-size: clamp(8px, calc(100vw / 40), 13px) !important; padding: 0 !important; max-width: none !important; }
      }
      .bm-bubble { position: fixed; z-index: 2147483200; width: 320px; box-sizing: border-box; padding: 16px; background: #ffffff; color: #1f1f1f; border-radius: 12px; box-shadow: 0 2px 6px rgba(0,0,0,0.2), 0 8px 24px rgba(0,0,0,0.25); font: 13px "Segoe UI", system-ui, -apple-system, sans-serif; }
      .bm-bub-title { font-size: 15px; font-weight: 500; margin-bottom: 14px; }
      .bm-row { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
      .bm-lbl { flex: 0 0 48px; color: #5f6368; }
      .bm-in, .bm-sel { flex: 1 1 auto; min-width: 0; height: 32px; box-sizing: border-box; padding: 0 8px; border: 1px solid #747775; border-radius: 4px; background: #ffffff; color: #1f1f1f; font: inherit; }
      .bm-in:focus, .bm-sel:focus { outline: 2px solid #0b57d0; outline-offset: -1px; border-color: #0b57d0; }
      .bm-btns { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
      .bm-btn { height: 32px; padding: 0 16px; border: 1px solid #c4c7c5; border-radius: 16px; background: #ffffff; color: #0b57d0; font: 500 13px "Segoe UI", system-ui, sans-serif; cursor: pointer; }
      .bm-btn:hover { background: #eaf1fb; }
      .bm-btn.primary { background: #0b57d0; border-color: #0b57d0; color: #ffffff; }
      .bm-btn.primary:hover { background: #0a4cb8; }
      .bm-mgr { position: fixed; inset: 0; z-index: 2147483100; display: flex; flex-direction: column; background: #ffffff; color: #1f1f1f; font: 13px "Segoe UI", system-ui, -apple-system, sans-serif; }
      .bm-top { flex: 0 0 56px; display: flex; align-items: center; gap: 16px; padding: 0 16px; background: #f8fafd; border-bottom: 1px solid #dadce0; }
      .bm-top-title { flex: 0 0 auto; font-size: 18px; font-weight: 500; min-width: 120px; }
      .bm-search { flex: 1 1 auto; max-width: 680px; margin: 0 auto; height: 40px; display: flex; align-items: center; gap: 8px; padding: 0 14px; box-sizing: border-box; border-radius: 20px; background: #e9eef6; color: #444746; }
      .bm-search:focus-within { background: #ffffff; box-shadow: 0 0 0 2px #0b57d0; }
      .bm-search-in { flex: 1 1 auto; min-width: 0; border: 0; outline: 0; background: transparent; color: #1f1f1f; font: 14px "Segoe UI", system-ui, sans-serif; }
      .bm-top-btn, .bm-item-more { flex: 0 0 auto; width: 32px; height: 32px; padding: 0; border: 0; border-radius: 50%; background: transparent; color: #444746; font-size: 20px; line-height: 1; cursor: pointer; }
      .bm-top-btn:hover, .bm-item-more:hover { background: rgba(31,31,31,0.1); }
      .bm-body { flex: 1 1 auto; min-height: 0; display: flex; }
      .bm-side { flex: 0 0 256px; box-sizing: border-box; padding: 8px 8px 8px 0; overflow: auto; }
      .bm-side-item { width: 100%; height: 32px; display: flex; align-items: center; gap: 12px; padding: 0 16px; border: 0; border-radius: 0 16px 16px 0; background: transparent; color: #1f1f1f; font: inherit; text-align: left; cursor: pointer; }
      .bm-side-item:hover { background: #f1f3f4; }
      .bm-side-item.sel { background: #d3e3fd; color: #041e49; }
      .bm-list { flex: 1 1 auto; min-width: 0; overflow: auto; padding: 8px 24px; }
      .bm-list-head { max-width: 960px; margin: 0 auto; padding: 8px 16px; font-size: 14px; font-weight: 500; color: #444746; }
      .bm-item { max-width: 960px; margin: 0 auto; display: flex; align-items: center; gap: 16px; padding: 6px 8px 6px 16px; border-radius: 8px; cursor: pointer; }
      .bm-item:hover, .bm-item:focus { background: #f1f3f4; outline: 0; }
      .bm-item-ico { flex: 0 0 24px; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; border-radius: 50%; background: #dadce0; color: #3c4043; font: 700 12px/1 "Segoe UI", system-ui, sans-serif; }
      .bm-item-txt { flex: 1 1 auto; min-width: 0; }
      .bm-item-title, .bm-item-url { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .bm-item-url { font-size: 12px; color: #5f6368; }
      .bm-empty { max-width: 960px; margin: 40px auto; text-align: center; color: #5f6368; font-size: 14px; }
      .bm-menu { position: fixed; z-index: 2147483300; min-width: 200px; padding: 8px 0; background: #ffffff; color: #1f1f1f; border-radius: 8px; box-shadow: 0 2px 6px rgba(0,0,0,0.2), 0 8px 24px rgba(0,0,0,0.25); }
      .bm-menu-item { display: block; width: 100%; height: 32px; padding: 0 16px; border: 0; background: transparent; color: #1f1f1f; font: 13px "Segoe UI", system-ui, sans-serif; text-align: left; cursor: pointer; }
      .bm-menu-item:hover { background: #eaf1fb; }
            .bm-dlg-back { position: fixed; inset: 0; z-index: 2147483250; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.32); }
      .bm-dlg { width: 400px; max-width: calc(100vw - 32px); box-sizing: border-box; padding: 24px; background: #ffffff; border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.35); }
            .bm-dlg-title { font-size: 18px; font-weight: 500; margin-bottom: 16px; }
      .bm-menu { max-width: 320px; }
      .bm-menu-item { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .bm-menu-item:disabled { color: #9aa0a6; cursor: default; }
      .bm-menu-item:disabled:hover { background: transparent; }
      .bm-menu-sep { height: 1px; margin: 4px 0; background: #dadce0; }
      `;
              document.head.appendChild(st);
            })();

            // ── Star bubble ("Bookmark added" / "Edit bookmark") ──
            function bmCloseBubble(apply) {
              const b = bmBub;
              if (!b) return;
              bmBub = null;
              if (apply) b.apply();
              b.el.remove();
            }
            function bmOpenBubble(url, added) {
              bmCloseBubble(true);
              const bm = bookmarks.find(function (x) { return x && x.url === url; });
              if (!bm) return;
              const el = mk('div', 'bm-bubble');
              el.setAttribute('role', 'dialog');
              el.appendChild(mk('div', 'bm-bub-title', added ? 'Bookmark added' : 'Edit bookmark'));

              const r1 = mk('label', 'bm-row');
              r1.appendChild(mk('span', 'bm-lbl', 'Name'));
              const name = mk('input', 'bm-in');
              name.type = 'text';
              name.value = bm.title || hostOf(url);
              r1.appendChild(name);

              const r2 = mk('label', 'bm-row');
              r2.appendChild(mk('span', 'bm-lbl', 'Folder'));
              const sel = mk('select', 'bm-sel');
                            bmChoices().forEach(function (f) {
                const o = mk('option', '', f[1]);
                o.value = f[0];
                sel.appendChild(o);
              });
              sel.value = bmParentOf(bm) || bmFolderOf(bm);
              r2.appendChild(sel);

              const btns = mk('div', 'bm-btns');
              const rm = mk('button', 'bm-btn', 'Remove');
              rm.type = 'button';
              const done = mk('button', 'bm-btn primary', 'Done');
              done.type = 'button';
              btns.appendChild(rm);
              btns.appendChild(done);

              el.appendChild(r1);
              el.appendChild(r2);
              el.appendChild(btns);

              rm.addEventListener('click', function () {
                const i = bookmarks.indexOf(bm);
                if (i >= 0) bookmarks.splice(i, 1);
                bmBub = null;
                el.remove();
                bmSave();
              });
              done.addEventListener('click', function () { bmCloseBubble(true); });
              name.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') { e.preventDefault(); bmCloseBubble(true); }
              });

              bmBub = {
                el: el,
                apply: function () {
                  bm.title = name.value.trim() || hostOf(url);
                                    bmPlace(bm, sel.value);
                  bmSave();
                }
              };
              document.body.appendChild(el);
              const r = navStar.getBoundingClientRect();
              const w = el.offsetWidth;
              el.style.top = (r.bottom + 8) + 'px';
              el.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w + 12)) + 'px';
              name.focus();
              name.select();
            }

            // The star: first click bookmarks the page and shows the bubble; later clicks edit it.
            navStar.addEventListener('click', function (e) {
              e.preventDefault();
              e.stopImmediatePropagation();
              if (bmBub) { bmCloseBubble(true); return; }
              const t = activeTab();
              if (!t || !t.url) return;
              if (isBookmarked(t.url)) { bmOpenBubble(t.url, false); return; }
              bmEnsureAZ();
                            const nb = { url: t.url, title: hostOf(t.url), f: BM_BAR };
                            const ch = (hostOf(t.url).replace(/^www\./, '').charAt(0) || '').toUpperCase();
                            if (/^[0-9A-Z]$/.test(ch)) bmPlace(nb, 'az_' + ch);   // default folder = first letter/digit; change it in the bubble
                            bookmarks.push(nb);
              bmSave();
              bmOpenBubble(t.url, true);
            }, true);
            document.addEventListener('pointerdown', function (e) {
              if (!bmBub) return;
              const t = e.target;
              if (bmBub.el.contains(t) || navStar.contains(t)) return;
              bmCloseBubble(true);
            }, true);
            // Taps inside a pane's page arrive as a message (see content-swipe.js)
            window.addEventListener('message', function (e) {
              const d = e.data;
                            if (d && d.splitViewTap) {
                if (bmBub) bmCloseBubble(true);
                bmCloseMenu();
              }
            });

            // ── Bookmark manager (chrome://bookmarks look-alike) ──
            function bmCloseMenu() {
              if (bmMenuEl) { bmMenuEl.remove(); bmMenuEl = null; }
            }
            function bmCloseMgr() {
              bmCloseMenu();
              if (!bmMgr) return;
              bmMgr.root.remove();
              bmMgr = null;
              bmQuery = '';
            }
            function bmPopMenu(anchor, entries) {
              bmCloseMenu();
              if (!bmMgr) return;
              const m = mk('div', 'bm-menu');
              entries.forEach(function (en) {
                const it = mk('button', 'bm-menu-item', en[0]);
                it.type = 'button';
                it.addEventListener('click', function (e) {
                  e.stopPropagation();
                  bmCloseMenu();
                  en[1]();
                });
                m.appendChild(it);
              });
              bmMgr.root.appendChild(m);
              const r = anchor.getBoundingClientRect();
              const w = m.offsetWidth;
              const h = m.offsetHeight;
              m.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w)) + 'px';
              m.style.top = Math.max(8, Math.min(window.innerHeight - h - 8, r.bottom + 4)) + 'px';
              bmMenuEl = m;
            }
                        function bmEdit(b) {
              const back = mk('div', 'bm-dlg-back');
              const dlg = mk('div', 'bm-dlg');
              dlg.appendChild(mk('div', 'bm-dlg-title', 'Edit bookmark'));
              const r1 = mk('label', 'bm-row');
              r1.appendChild(mk('span', 'bm-lbl', 'Name'));
              const n = mk('input', 'bm-in');
              n.type = 'text';
              n.value = b.title || '';
              r1.appendChild(n);
              const r2 = mk('label', 'bm-row');
              r2.appendChild(mk('span', 'bm-lbl', 'URL'));
              const u = mk('input', 'bm-in');
              u.type = 'text';
              u.value = b.url || '';
              u.setAttribute('autocapitalize', 'off');
              u.spellcheck = false;
              r2.appendChild(u);
              const btns = mk('div', 'bm-btns');
              const cancel = mk('button', 'bm-btn', 'Cancel');
              cancel.type = 'button';
              const save = mk('button', 'bm-btn primary', 'Save');
              save.type = 'button';
              btns.appendChild(cancel);
              btns.appendChild(save);
              dlg.appendChild(r1);
              dlg.appendChild(r2);
              dlg.appendChild(btns);
              back.appendChild(dlg);
              function doSave() {
                const nu = bmNorm(u.value);
                if (!nu) { u.focus(); return; }
                b.url = nu;
                b.title = n.value.trim() || hostOf(nu);
                back.remove();
                bmSave();
              }
              cancel.addEventListener('click', function () { back.remove(); });
              save.addEventListener('click', doSave);
              back.addEventListener('pointerdown', function (e) { if (e.target === back) back.remove(); });
              [n, u].forEach(function (inp) {
                inp.addEventListener('keydown', function (e) {
                  if (e.key === 'Enter') { e.preventDefault(); doSave(); }
                });
              });
                            document.body.appendChild(back);
              n.focus();
              n.select();
            }
            function bmExport() {
              const esc = function (s) {
                return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
              };
              let h = '<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n<TITLE>Bookmarks</TITLE>\n<H1>Bookmarks</H1>\n<DL><p>\n';
              BM_FOLDERS.forEach(function (f) {
                h += '    <DT><H3>' + esc(f[1]) + '</H3>\n    <DL><p>\n';
                                const link = function (c, ind) {
                  return ind + '<DT><A HREF="' + esc(c.url) + '">' + esc(c.title || c.url) + '</A>\n';
                };
                bookmarks.forEach(function (b) {
                  if (!b || bmParentOf(b) || bmFolderOf(b) !== f[0]) return;
                  if (b.folder) {
                    h += '        <DT><H3>' + esc(b.title || 'New folder') + '</H3>\n        <DL><p>\n';
                    bookmarks.forEach(function (c) {
                      if (c && c.url && c.p === b.id) h += link(c, '            ');
                    });
                    h += '        </DL><p>\n';
                  } else if (b.url) {
                    h += link(b, '        ');
                  }
                });
                h += '    </DL><p>\n';
              });
              h += '</DL><p>\n';
              const a = document.createElement('a');
              a.href = URL.createObjectURL(new Blob([h], { type: 'text/html' }));
              a.download = 'bookmarks.html';
              document.body.appendChild(a);
              a.click();
              a.remove();
              setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
            }
            function bmRefresh() {
              if (!bmMgr) return;
              bmCloseMenu();
              const q = bmQuery.trim().toLowerCase();

                            // Sidebar: the two roots with their folders underneath
              const choices = bmChoices();
              if (!choices.some(function (c) { return c[0] === bmFolderSel; })) bmFolderSel = BM_BAR;
              bmMgr.side.textContent = '';
              choices.forEach(function (f) {
                const it = mk('button', 'bm-side-item' + (!q && bmFolderSel === f[0] ? ' sel' : ''));
                it.type = 'button';
                it.style.paddingLeft = (16 + f[2] * 20) + 'px';
                it.innerHTML = bmFolderIco();
                it.appendChild(mk('span', '', f[3]));
                it.addEventListener('click', function () {
                  bmFolderSel = f[0];
                  bmQuery = '';
                  bmMgr.input.value = '';
                  bmRefresh();
                });
                it.addEventListener('contextmenu', function (e) {
                  bmCtxMenu(e, bmFolderById(f[0]), f[0]);
                });
                bmMgr.side.appendChild(it);
              });

              // List
              const list = bmMgr.list;
              list.textContent = '';
                            const folderName = bmLocName(bmFolderSel);
              list.appendChild(mk('div', 'bm-list-head', q ? 'Search results' : folderName));
              let shown = 0;
              bookmarks.forEach(function (b) {
                                if (!b || (!b.url && !b.folder)) return;
                if (q) {
                  if (!b.url) return;
                  if ((b.title || '').toLowerCase().indexOf(q) < 0 && b.url.toLowerCase().indexOf(q) < 0) return;
                } else if ((bmParentOf(b) || bmFolderOf(b)) !== bmFolderSel) {
                  return;
                }
                shown++;
                if (b.folder) { list.appendChild(bmFolderRow(b)); return; }
                const row = mk('div', 'bm-item');
                row.tabIndex = 0;
                row.appendChild(mk('span', 'bm-item-ico', (hostOf(b.url).replace(/^www\./, '').charAt(0) || '?').toUpperCase()));
                const txt = mk('div', 'bm-item-txt');
                txt.appendChild(mk('div', 'bm-item-title', b.title || hostOf(b.url)));
                txt.appendChild(mk('div', 'bm-item-url', b.url));
                row.appendChild(txt);
                const dots = mk('button', 'bm-item-more', '\u22EE');
                dots.type = 'button';
                dots.title = 'More actions';
                dots.setAttribute('aria-label', 'More actions');
                row.appendChild(dots);
                row.addEventListener('click', function () { bmCloseMgr(); go(b.url); });
                row.addEventListener('keydown', function (e) {
                  if (e.key === 'Enter') { bmCloseMgr(); go(b.url); }
                });
                                dots.addEventListener('click', function (e) {
                  e.stopPropagation();
                  const r = dots.getBoundingClientRect();
                  bmShowMenu(r.right, r.bottom + 4, bmItemEntries(b, bmParentOf(b) || bmFolderOf(b)), true);
                });
                row.addEventListener('contextmenu', function (e) {
                  bmCtxMenu(e, b, bmParentOf(b) || bmFolderOf(b));
                });
                list.appendChild(row);
              });
              if (!shown) list.appendChild(mk('div', 'bm-empty', q ? 'No search results found' : 'No bookmarks'));
            }
            function bmOpenManager() {
              bmCloseBubble(true);
              if (bmMgr) { bmMgr.input.focus(); return; }
              const root = mk('div', 'bm-mgr');
              root.setAttribute('role', 'dialog');
              root.setAttribute('aria-label', 'Bookmarks');

              const top = mk('div', 'bm-top');
              top.appendChild(mk('div', 'bm-top-title', 'Bookmarks'));
              const sw = mk('div', 'bm-search');
              sw.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true" style="display:block;flex:0 0 auto"><path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>';
              const si = mk('input', 'bm-search-in');
              si.type = 'text';
              si.placeholder = 'Search bookmarks';
              si.setAttribute('aria-label', 'Search bookmarks');
              si.setAttribute('autocomplete', 'off');
              si.spellcheck = false;
              sw.appendChild(si);
              top.appendChild(sw);
              const more = mk('button', 'bm-top-btn', '\u22EE');
              more.type = 'button';
              more.title = 'Organize';
              more.setAttribute('aria-label', 'Organize');
              const close = mk('button', 'bm-top-btn', '\u00d7');
              close.type = 'button';
              close.title = 'Close';
              close.setAttribute('aria-label', 'Close');
              top.appendChild(more);
              top.appendChild(close);

              const body = mk('div', 'bm-body');
              const side = mk('div', 'bm-side');
              const list = mk('div', 'bm-list');
              body.appendChild(side);
              body.appendChild(list);
              root.appendChild(top);
              root.appendChild(body);
              document.body.appendChild(root);
                            bmMgr = { root: root, side: side, list: list, input: si };
              list.addEventListener('contextmenu', function (e) {
                if (e.target.closest && e.target.closest('.bm-item')) return;
                bmCtxMenu(e, null, bmFolderSel);
              });

              si.addEventListener('input', function () { bmQuery = si.value; bmRefresh(); });
              close.addEventListener('click', bmCloseMgr);
              more.addEventListener('click', function (e) {
                e.stopPropagation();
                                bmPopMenu(more, [
                  ['Add new bookmark', function () { bmAddPage(bmFolderSel); }],
                  ['Add new folder', function () { bmAddFolder(bmFolderSel); }],
                  ['Sort by name', function () {
                    bookmarks.sort(function (a, b) {
                      return String((a && a.title) || '').localeCompare(String((b && b.title) || ''));
                    });
                    bmSave();
                  }],
                  ['Export bookmarks', bmExport]
                ]);
              });
              root.addEventListener('pointerdown', function (e) {
                if (bmMenuEl && !bmMenuEl.contains(e.target)) bmCloseMenu();
              }, true);

              bmRefresh();
              si.focus();
            }
            document.addEventListener('keydown', function (e) {
              if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'O' || e.key === 'o')) {
                e.preventDefault();
                if (bmMgr) bmCloseMgr(); else bmOpenManager();
                return;
              }
              if (e.key !== 'Escape') return;
              if (bmMenuEl) { bmCloseMenu(); return; }
              const dlg = document.querySelector('.bm-dlg-back');
              if (dlg) { dlg.remove(); return; }
                            if (bmMgr) { bmCloseMgr(); return; }
                if (bmBub) bmCloseBubble(true);
              });

              // ── Folders: right-click menus, add page / add folder, cut & paste ──
              let bmClip = null;       // item chosen with "Cut", waiting for "Paste"
              let bmClosedFor = '';    // folder dropdown that the last outside click just closed
              let bmClosedAt = 0;

              // A floating menu at x,y. Entries: [label, fn, { disabled, ctx }] or null for a separator.
              function bmShowMenu(x, y, entries, alignRight) {
                bmCloseMenu();
                const m = mk('div', 'bm-menu');
                entries.forEach(function (en) {
                  if (!en) { m.appendChild(mk('div', 'bm-menu-sep')); return; }
                  const opt = en[2] || {};
                  const it = mk('button', 'bm-menu-item', en[0]);
                  it.type = 'button';
                  if (opt.disabled) it.disabled = true;
                  it.addEventListener('click', function (ev) {
                    ev.stopPropagation();
                    bmCloseMenu();
                    en[1]();
                  });
                  if (opt.ctx) it.addEventListener('contextmenu', opt.ctx);
                  m.appendChild(it);
                });
                document.body.appendChild(m);
                const w = m.offsetWidth;
                const h = m.offsetHeight;
                const left = alignRight ? x - w : x;
                m.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, left)) + 'px';
                m.style.top = Math.max(8, Math.min(window.innerHeight - h - 8, y)) + 'px';
                bmMenuEl = m;
                return m;
              }
              // Click anywhere outside an open menu closes it (works on the bar and inside the manager)
              document.addEventListener('pointerdown', function (e) {
                if (!bmMenuEl || bmMenuEl.contains(e.target)) return;
                bmClosedFor = bmMenuEl.dataset.for || '';
                bmClosedAt = Date.now();
                bmCloseMenu();
              }, true);

              // Small dialog with text boxes (works anywhere, not only inside the manager)
              function bmDialog(title, fields, okLabel, onOk) {
                const back = mk('div', 'bm-dlg-back');
                const dlg = mk('div', 'bm-dlg');
                dlg.appendChild(mk('div', 'bm-dlg-title', title));
                const ins = fields.map(function (f) {
                  const r = mk('label', 'bm-row');
                  r.appendChild(mk('span', 'bm-lbl', f.label));
                  const inp = mk('input', 'bm-in');
                  inp.type = 'text';
                  inp.value = f.value || '';
                  inp.setAttribute('autocapitalize', 'off');
                  inp.setAttribute('autocomplete', 'off');
                  inp.spellcheck = false;
                  r.appendChild(inp);
                  dlg.appendChild(r);
                  return inp;
                });
                const btns = mk('div', 'bm-btns');
                const cancel = mk('button', 'bm-btn', 'Cancel');
                cancel.type = 'button';
                const ok = mk('button', 'bm-btn primary', okLabel || 'Save');
                ok.type = 'button';
                btns.appendChild(cancel);
                btns.appendChild(ok);
                dlg.appendChild(btns);
                back.appendChild(dlg);
                function submit() {
                  const vals = ins.map(function (i) { return i.value; });
                  if (onOk(vals) === false) return;
                  back.remove();
                }
                cancel.addEventListener('click', function () { back.remove(); });
                ok.addEventListener('click', submit);
                back.addEventListener('pointerdown', function (e) { if (e.target === back) back.remove(); });
                ins.forEach(function (inp) {
                  inp.addEventListener('keydown', function (e) {
                    if (e.key === 'Enter') { e.preventDefault(); submit(); }
                  });
                });
                document.body.appendChild(back);
                ins[0].focus();
                ins[0].select();
              }
              function bmAddPage(where) {
                bmDialog('Add page', [{ label: 'Name', value: '' }, { label: 'URL', value: '' }], 'Save', function (v) {
                  const u = bmNorm(v[1]);
                  if (!u) return false;
                  const b = { url: u, title: v[0].trim() || hostOf(u) };
                  bmPlace(b, where || BM_BAR);
                  bookmarks.push(b);
                  bmSave();
                });
              }
              function bmAddFolder(where) {
                bmDialog('New folder', [{ label: 'Name', value: 'New folder' }], 'Save', function (v) {
                  const f = { id: bmNewId(), folder: true, title: v[0].trim() || 'New folder' };
                  bmPlace(f, where || BM_BAR);
                  bookmarks.push(f);
                  bmSave();
                });
              }
              function bmEditAny(b) {
                if (bmIsAZ(b)) return;
                                if (!b.folder) { bmEdit(b); return; }
                bmDialog('Rename folder', [{ label: 'Name', value: b.title || '' }], 'Save', function (v) {
                  b.title = v[0].trim() || 'New folder';
                  bmSave();
                });
              }
              // Deleting a folder also deletes what is inside it, like Chrome
              function bmRemove(b) {
                              if (bmIsAZ(b)) return;
                for (let i = bookmarks.length - 1; i >= 0; i--) {
                  const x = bookmarks[i];
                  if (x === b || (b.folder && x && x.p === b.id)) bookmarks.splice(i, 1);
                }
                if (bmClip === b) bmClip = null;
                bmSave();
              }
              function bmPaste(where) {
                const it = bmClip;
                if (!it) return;
                bmClip = null;
                const i = bookmarks.indexOf(it);
                if (i < 0) return;
                bookmarks.splice(i, 1);
                bmPlace(it, where || BM_BAR);
                bookmarks.push(it);
                bmSave();
              }
              // Menu for a bookmark or folder. "where" = the bar / Other bookmarks / folder id new things are added to.
              function bmItemEntries(b, where) {
                              if (bmIsAZ(b)) {
                                return [
                                  ['Add page\u2026', function () { bmAddPage(b.id); }],
                                  ['Paste', function () { bmPaste(b.id); }, { disabled: !bmClip }]
                                ];
                              }
                const en = [];
                if (b.url) {
                  en.push(['Open', function () { bmCloseMgr(); go(b.url); }]);
                  en.push(null);
                }
                en.push([b.folder ? 'Rename\u2026' : 'Edit\u2026', function () { bmEditAny(b); }]);
                en.push(['Cut', function () { bmClip = b; }]);
                en.push(['Paste', function () { bmPaste(where); }, { disabled: !bmClip }]);
                en.push(['Delete', function () { bmRemove(b); }]);
                en.push(null);
                en.push(['Add page\u2026', function () { bmAddPage(where); }]);
                en.push(['Add folder\u2026', function () { bmAddFolder(where); }]);
                if (!bmMgr) {
                  en.push(null);
                  en.push(['Bookmark manager', bmOpenManager]);
                }
                return en;
              }
              // Menu for empty space (bar, manager list)
              function bmAreaEntries(where) {
                const en = [
                  ['Add page\u2026', function () { bmAddPage(where); }],
                  ['Add folder\u2026', function () { bmAddFolder(where); }],
                  null,
                  ['Paste', function () { bmPaste(where); }, { disabled: !bmClip }]
                ];
                if (!bmMgr) {
                  en.push(null);
                  en.push(['Bookmark manager', bmOpenManager]);
                }
                return en;
              }
              function bmCtxMenu(e, item, where) {
                e.preventDefault();
                e.stopPropagation();
                bmCloseBubble(true);
                bmShowMenu(e.clientX, e.clientY, item ? bmItemEntries(item, where) : bmAreaEntries(where), false);
              }
              // Drop-down list of a folder's bookmarks (opens from the bar chip)
              function bmFolderDropdown(anchor, folder) {
                const entries = bookmarks.filter(function (c) {
                  return c && c.url && c.p === folder.id;
                }).map(function (c) {
                  return [c.title || hostOf(c.url), function () { go(c.url); }, {
                    ctx: function (ev) { bmCtxMenu(ev, c, folder.id); }
                  }];
                });
                if (!entries.length) entries.push(['(empty)', function () {}, { disabled: true }]);
                const r = anchor.getBoundingClientRect();
                const m = bmShowMenu(r.left, r.bottom + 2, entries, false);
                m.dataset.for = folder.id;
              }
              function bmBarFolderChip(b) {
                const m = mk('div', 'bb-mark bb-foldmark');
                m.title = b.title || 'New folder';
                m.innerHTML = bmFolderIco();
                m.appendChild(mk('span', 'bb-mark-title', b.title || 'New folder'));
                m.addEventListener('click', function () {
                  // a click that just closed this same dropdown acts as a toggle
                  if (bmClosedFor === b.id && Date.now() - bmClosedAt < 400) { bmClosedFor = ''; return; }
                  bmFolderDropdown(m, b);
                });
                m.addEventListener('contextmenu', function (e) { bmCtxMenu(e, b, BM_BAR); });
                return m;
              }
              // A folder as a row in the manager list: click to open it
              function bmFolderRow(b) {
                const loc = bmParentOf(b) || bmFolderOf(b);
                const row = mk('div', 'bm-item');
                row.tabIndex = 0;
                const ico = mk('span', 'bm-item-ico');
                ico.innerHTML = bmFolderIco();
                row.appendChild(ico);
                const txt = mk('div', 'bm-item-txt');
                txt.appendChild(mk('div', 'bm-item-title', b.title || 'New folder'));
                const n = bookmarks.filter(function (c) { return c && c.p === b.id; }).length;
                txt.appendChild(mk('div', 'bm-item-url', n + (n === 1 ? ' item' : ' items')));
                row.appendChild(txt);
                const dots = mk('button', 'bm-item-more', '\u22EE');
                dots.type = 'button';
                dots.title = 'More actions';
                dots.setAttribute('aria-label', 'More actions');
                row.appendChild(dots);
                function openIt() {
                  bmFolderSel = b.id;
                  bmQuery = '';
                  if (bmMgr) bmMgr.input.value = '';
                  bmRefresh();
                }
                row.addEventListener('click', openIt);
                row.addEventListener('keydown', function (e) {
                  if (e.key === 'Enter') openIt();
                });
                dots.addEventListener('click', function (e) {
                  e.stopPropagation();
                  const r = dots.getBoundingClientRect();
                  bmShowMenu(r.right, r.bottom + 4, bmItemEntries(b, loc), true);
                });
                row.addEventListener('contextmenu', function (e) { bmCtxMenu(e, b, loc); });
                return row;
              }
              // Right-click on empty space of the bookmarks bar (chips handle their own right-click)
              bmBar.addEventListener('contextmenu', function (e) {
                if (e.target.closest && e.target.closest('.bb-mark') && !e.target.closest('.bb-allmarks')) return;
                                bmCtxMenu(e, null, BM_BAR);
                        });
                function hostOf(u) {
        try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return u; }
      }
      function toUrl(raw) {
        const s = String(raw || '').trim();
        if (!s) return '';
        if (/^(https?:|about:)/i.test(s)) return s;
        if (/^localhost(:\d+)?(\/|$)/i.test(s) || /^[^\s\/]+\.[^\s\/]{2,}(\/\S*)?$/.test(s)) return 'https://' + s;
        return 'https://www.google.com/search?q=' + encodeURIComponent(s);
      }
      function curView() { return panes[target].view; }
            function paneUrlOf(k) {
        let u = '';
                try { u = panes[k].view.getAttribute('src') || ''; } catch (e) {}
          return /^about:blank$/i.test(u) || u === HOME_URL ? '' : u;
        }
        function paneUrl() { return paneUrlOf(target); }
        // One way to open a page in a pane: clears stale fallback state and any leftover sandbox.
        function setPaneUrl(p, url) {
          markReady(p);
          var dest = url && !/^about:blank$/i.test(url) ? url : HOME_URL;
          if (isBreakout(dest)) p.view.setAttribute('sandbox', SANDBOX_FLAGS);
          else p.view.removeAttribute('sandbox');
          p.view.src = dest;
        }
      // Workspace tabs: a tab is either one page, or a whole split (its layout + the page in every pane).
      function snapNow() {
        var vis = visibleKeys();
        var pm = {};
        vis.forEach(function (k) {
          pm[k] = { u: paneUrlOf(k), z: state.panes[k].zoom };
        });
        return { l: JSON.parse(JSON.stringify(state.layout)), p: pm, f: vis.indexOf(target) >= 0 ? target : vis[0] };
      }
      // Copies what is on screen into a tab (a split stays a split, a single pane becomes a plain page).
      function capTab(t) {
        if (!t) return;
        var vis = visibleKeys();
        if (vis.length > 1) {
          t.snap = snapNow();
          t.url = t.snap.p[t.snap.f].u;
        } else {
          t.snap = null;
          t.url = paneUrlOf(vis[0]);
        }
      }
      // Opens a page in a pane only when it is not already showing it ('' = the home page).
      function showUrl(k, u) {
        var cur = panes[k].view.getAttribute('src') || '';
        if (u) {
          if (cur !== u) setPaneUrl(panes[k], u);
        } else if (cur !== HOME_URL) {
          setPaneUrl(panes[k], '');
        }
      }
      // Puts a tab on screen: its whole split (or its single page) replaces what the panes show now.
      function applyTab(t) {
        var snap = t && t.snap && t.snap.l ? t.snap : null;
        var old = visibleKeys();
        var lay;
        var want;
        if (snap) {
          lay = JSON.parse(JSON.stringify(snap.l));
          want = leavesOf(lay);
                } else {
          // Single-page tab: reuse the pane that already holds this tab's page (so it is not
          // reloaded), otherwise use a spare pane so the page of the tab we leave keeps running.
          var pick = old.indexOf(target) >= 0 ? target : old[0];
          var wantUrl = (t && t.url) || '';
          var hold = null;
          var spare = null;
          PANE_KEYS.forEach(function (k) {
            if (wantUrl && !hold && paneUrlOf(k) === wantUrl) hold = k;
            if (!spare && old.indexOf(k) < 0 && !paneUrlOf(k)) spare = k;
          });
          want = [paneUrlOf(pick) === wantUrl ? pick : hold || spare || pick];
          lay = leafNode(want[0]);
        }
        if (mgrIsOpen()) closeManager();
        old.forEach(function (k) {
          if (want.indexOf(k) < 0) retirePane(k, true);
        });
        state.layout = lay;
        want.forEach(function (k) {
          var info = snap && snap.p ? snap.p[k] : null;
          if (info && info.z) state.panes[k].zoom = applyZoom(panes[k].view, info.z);
          showUrl(k, snap ? (info && info.u) || '' : (t && t.url) || '');
        });
        renderLayout();
        persist();
        setFocus(snap && snap.f && want.indexOf(snap.f) >= 0 ? snap.f : want[0]);
      }
      function initTabs() {
        var first = { id: ++seq, url: '', snap: null };
        tabs = [first];
        activeId = first.id;
        selSet = {};
        capTab(first);
        showUrl(target, '');
      }
      // Tell the active tab which page the target pane now shows.
      function noteUrl(k, u) {
        if (k !== target) return;
        var cur = activeTab();
        if (cur) cur.url = u;
      }
      // Icon, title and tooltip of a tab (a split shows its pane count and every site in it).
      function tabInfo(t) {
        var urls = [];
        if (t.id === activeId) {
          visibleKeys().forEach(function (k) { urls.push(paneUrlOf(k)); });
        } else if (t.snap && t.snap.l) {
          leavesOf(t.snap.l).forEach(function (k) {
            urls.push((t.snap.p && t.snap.p[k] && t.snap.p[k].u) || '');
          });
        } else {
          urls.push(t.url || '');
        }
        if (urls.length < 2) {
          var one = urls[0] || '';
          return {
            ico: one ? (hostOf(one).replace(/^www\./, '').charAt(0) || '?').toUpperCase() : '',
            title: one ? hostOf(one) : 'New Tab',
            blank: !one,
            tip: one || 'New Tab'
          };
        }
        var names = urls.map(function (x) { return x ? hostOf(x).replace(/^www\./, '') : 'blank'; });
        return {
          ico: String(urls.length),
          title: names.join(' + '),
          blank: false,
          tip: urls.map(function (x) { return x || 'blank'; }).join('\n')
        };
      }

      // ── Session: remembers every tab (single pages AND whole splits) and the page in each pane ──
      var LS_SESS = 'split-view:session:v1';
      var sessMute = true;      // true until the first restore is done, and while a restore runs
      var sessTouched = false;  // you changed something before the online copy arrived
      var sessSig = '';
      var sessTimer = 0;
      var sessTs = 0;
      function sessClean(u) {
        var s = String(u || '');
        return /^https?:\/\//i.test(s) ? s : '';
      }
      function sessData() {
        capTab(activeTab());
        var idx = 0;
        var list = tabs.map(function (t, i) {
          if (t.id === activeId) idx = i;
          if (t.snap && t.snap.l) return { s: { l: t.snap.l, p: t.snap.p, f: t.snap.f } };
          return { u: t.url || '' };
        });
        return { v: 1, a: idx, t: list };
      }
      function sessSaveNow() {
        sessTimer = 0;
        if (sessMute) return;
        var d = sessData();
        sessSig = JSON.stringify(d);
        d.ts = Date.now();
        sessTs = d.ts;
        try { localStorage.setItem(LS_SESS, JSON.stringify(d)); } catch (e) {}
        var S = window.SplitSync;
        if (S && S.saveSession) S.saveSession(d);
      }
      // Called after every tab / pane / layout change; saves only when something really changed.
      function sessNote() {
        if (sessMute) return;
        var sig = JSON.stringify(sessData());
        if (sig === sessSig) return;
        sessSig = sig;
        sessTouched = true;
        clearTimeout(sessTimer);
        sessTimer = setTimeout(sessSaveNow, 1500);
      }
      sessPing = sessNote;
      function sessFlush() {
        if (document.hidden && sessTimer) {
          clearTimeout(sessTimer);
          sessSaveNow();
        }
      }
      document.addEventListener('visibilitychange', sessFlush);
      window.addEventListener('pagehide', function () {
        if (sessTimer) {
          clearTimeout(sessTimer);
          sessSaveNow();
        }
      });
      // Rebuilds the tabs from a saved session and shows the active one.
      function sessApply(d) {
        var out = [];
        toArray(d && d.t).forEach(function (x) {
          if (!x || typeof x !== 'object') return;
          var t = { id: ++seq, url: sessClean(x.u), snap: null };
          var s = x.s;
          if (s && typeof s === 'object') {
            var lay = cleanLayout(s.l, {});
            if (lay) lay = simplify(lay);
            if (lay && !isLeaf(lay)) {
              var pm = {};
              var keys = leavesOf(lay);
              keys.forEach(function (k) {
                var pp = s.p && s.p[k];
                pm[k] = { u: sessClean(pp && pp.u), z: numIn(pp && pp.z, ZOOM_MIN, ZOOM_MAX, 1) };
              });
              var fk = typeof s.f === 'string' && pm[s.f] ? s.f : keys[0];
              t.snap = { l: lay, p: pm, f: fk };
              t.url = pm[fk].u;
            }
          }
          out.push(t);
        });
        if (!out.length) return false;
        var ai = Math.floor(Number(d.a));
        if (!(ai >= 0 && ai < out.length)) ai = 0;
        var was = sessMute;
        sessMute = true;
        try {
          tabs = out;
          activeId = out[ai].id;
          selSet = {};
          applyTab(out[ai]);
          navUrl.value = paneUrl();
          render();
        } catch (e) {
          devLog('ERROR', 'session restore failed: ' + (e && e.message ? e.message : e));
        }
        sessMute = was;
        return true;
      }
      function sessBoot() {
        function go() {
          var local = null;
          try { local = JSON.parse(localStorage.getItem(LS_SESS) || 'null'); } catch (e) { local = null; }
          if (local && typeof local === 'object' && sessApply(local)) sessTs = Number(local.ts) || 0;
          sessSig = JSON.stringify(sessData());
          sessTouched = false;
          sessMute = false;
          var S = window.SplitSync;
          if (!S || !S.loadSession) return;
          S.loadSession(5000).then(function (remote) {
            if (remote === undefined) return;
            var rts = remote && typeof remote === 'object' ? Number(remote.ts) || 0 : 0;
            if (rts > sessTs) {
              if (sessTouched) return;
              if (sessApply(remote)) {
                sessTs = rts;
                var d2 = sessData();
                sessSig = JSON.stringify(d2);
                d2.ts = rts;
                try { localStorage.setItem(LS_SESS, JSON.stringify(d2)); } catch (e) {}
              }
              return;
            }
            if (rts < sessTs && local && !sessTouched) S.saveSession(local);
          });
        }
        installFrameRule().then(go, go);
      }
      var selSet = {};
            var LS_GRP = 'bb:tabGroups';
                        function loadGroups() {
              try {
                var a = JSON.parse(localStorage.getItem(LS_GRP) || '[]');
                return Array.isArray(a) ? a : [];
              } catch (e) {
                return [];
              }
            }
            var groups = loadGroups();
            // RULE: groups you add are the ONLY thing synced to Firebase from the tab bar.
            var LS_GRP_DIRTY = 'bb:tabGroups:dirty';
            function pushGroups() {
              var S = window.SplitSync;
              if (!S || !S.saveGroups) return;
              try { localStorage.setItem(LS_GRP_DIRTY, '1'); } catch (e) {}
              S.saveGroups({ v: 1, ts: Date.now(), groups: groups }).then(function (ok) {
                if (ok) {
                  try { localStorage.removeItem(LS_GRP_DIRTY); } catch (e) {}
                }
              });
            }
            function pullGroups() {
              var S = window.SplitSync;
              if (!S || !S.loadGroups) return;
              S.loadGroups(6000).then(function (remote) {
                if (remote === undefined) return;
                var pending = false;
                try { pending = localStorage.getItem(LS_GRP_DIRTY) === '1'; } catch (e) {}
                if (pending || remote === null) {
                  if (groups.length) pushGroups();
                  return;
                }
                var list = remote.groups;
                if (list && !Array.isArray(list)) {
                  list = Object.keys(list).map(function (k) { return list[k]; });
                }
                groups = (list || []).filter(function (g) {
                  return g && Array.isArray(g.urls) && g.urls.length;
                });
                try { localStorage.setItem(LS_GRP, JSON.stringify(groups)); } catch (e) {}
                render();
              });
            }
            function saveGroups() {
              try {
                localStorage.setItem(LS_GRP, JSON.stringify(groups));
              } catch (e) {}
                            // LOCAL ONLY: groups stay on this device, nothing goes to Firebase.
              }
            function selCount() {
              var n = 0;
              var k;
              for (k in selSet) {
                if (selSet[k]) n++;
              }
              return n;
            }
            function clearSel() {
              selSet = {};
              render();
            }
                        function toggleSel(id) {
              var tg = tabs.find(function (x) { return x.id === id; });
              if (id === activeId || visibleKeys().length > 1 || (tg && tg.snap)) return;
              selSet[activeId] = true;
              if (selSet[id]) delete selSet[id];
              else selSet[id] = true;
              if (selCount() < 2) selSet = {};
              render();
            }
            function selectedPlan() {
              var act = activeTab();
              var urls = [];
              var keep = false;
              if (act && act.url) {
                urls.push(act.url);
                keep = true;
              }
              tabs.forEach(function (tb) {
                if (selSet[tb.id] && tb.url && (!act || tb.id !== act.id)) urls.push(tb.url);
              });
              return { urls: urls, keepFirst: keep };
            }
            function tileUrls(urls, reuse, keepFirst) {
              var origin = target;
              var slots = [origin];
              if (reuse) {
                visibleKeys().forEach(function (vk) {
                  if (vk !== origin) slots.push(vk);
                });
              }
              var ref = origin;
              var key = origin;
              var before = null;
              var np = null;
              var done = 0;
              var i = 0;
                            var added = 0;
              for (i = 0; i < urls.length; i++) {
                if (i < slots.length) {
                  key = slots[i];
                  if (!(i === 0 && keepFirst)) {
                    setPaneUrl(panes[key], urls[i]);
                    noteUrl(key, urls[i]);
                  }
                } else {
                  before = visibleKeys();
                  np = addPane(ref, true);
                  if (!np) break;
                  key = visibleKeys().filter(function (nk) {
                    return before.indexOf(nk) < 0;
                  })[0];
                  if (!key) break;
                  setPaneUrl(np, urls[i]);
                  noteUrl(key, urls[i]);
                  added++;
                }
                ref = key;
                done++;
              }
              // new panes get an even layout instead of ever-smaller halves
              if (added > 0) {
                var cnt = visibleKeys().length;
                state.layout = presetLayout(cnt >= 4 ? 'grid' : 'cols', visibleKeys());
                renderLayout();
                persist();
              }
              setFocus(origin);
              var at0 = activeTab();
              if (at0 && document.activeElement !== navUrl) navUrl.value = at0.url || '';
              render();
              return done;
            }
            function splitSelected() {
              var plan = selectedPlan();
              if (plan.urls.length < 2) {
                showToast('Ctrl+click 2 or more tabs that have a page open');
                return;
              }
                            var moving = {};
              tabs.forEach(function (tb) {
                if (selSet[tb.id] && tb.id !== activeId) moving[tb.id] = true;
              });
              var n = tileUrls(plan.urls, false, plan.keepFirst);
              if (n < plan.urls.length) showToast('Only ' + n + ' panes fit');
              else tabs = tabs.filter(function (tb) { return !moving[tb.id]; });
              selSet = {};
              render();
            }
            function groupSelected() {
              var plan = selectedPlan();
              if (plan.urls.length < 2) {
                showToast('Ctrl+click 2 or more tabs that have a page open');
                return;
              }
                      var gid = Date.now();
                            // Naming happens here, when the group is added. Cancel = no group; empty = default name.
              var gname = window.prompt('Name this group:', 'Group ' + (groups.length + 1));
              if (gname === null) return;
              gname = gname.trim().slice(0, 40) || 'Group ' + (groups.length + 1);
              groups.push({ id: gid, name: gname, urls: plan.urls.slice() });
              saveGroups();
                            splitSelected();
            }
                        function openGroup(g) {
              if (visibleKeys().length > 1) newTab();
              var n = tileUrls(g.urls, true, false);
              if (n < g.urls.length) showToast('Only ' + n + ' panes fit');
            }
            // ════════ Split button (before the puzzle icon): pick how open tabs / panes get tiled ════════
                        var spOrient = readLS('split-view:split-orient', 'v') === 'h' ? 'h' : 'v';
                        var spPop = null;

                        // Every way to cut n panes into consecutive groups, e.g. 4 -> [2,2] [1,3] [1,1,2] [1,1,1,1] ...
                        function spCompositions(n) {
                          var out = [];
                          (function rec(left, cur) {
                            if (!left) { out.push(cur.slice()); return; }
                            for (var i = 1; i <= left; i++) { cur.push(i); rec(left - i, cur); cur.pop(); }
                          })(n, []);
                          return out;
                        }
                        function spAllOnes(c) {
                          return c.every(function (x) { return x === 1; });
                        }
                        function spOptions(n) {
                          var all = spCompositions(n).filter(function (c) {
                            if (c.length < 2) return false;
                            return c.length <= 3 || spAllOnes(c);
                          });
                          function score(c) {
                            var m = n / c.length;
                            var v = 0;
                            c.forEach(function (x) { v += (x - m) * (x - m); });
                            return v;
                          }
                          all.sort(function (a, b) {
                            var ao = spAllOnes(a) ? 0 : 1;
                            var bo = spAllOnes(b) ? 0 : 1;
                            if (ao !== bo) return ao - bo;
                            var d = score(a) - score(b);
                            if (d) return d;
                            return a.join(',') < b.join(',') ? -1 : 1;
                          });
                          return all;
                        }
                        // 'v' = vertical dividers (groups side by side, panes inside a group stacked)
                        // 'h' = horizontal dividers (groups stacked, panes inside a group side by side)
                        function spBuild(comp, keys, orient) {
                          var inner = orient === 'v' ? 'c' : 'r';
                          var outer = orient === 'v' ? 'r' : 'c';
                          var i = 0;
                          var groups = comp.map(function (cnt) {
                            var leaves = [];
                            for (var j = 0; j < cnt; j++) leaves.push(leafNode(keys[i++]));
                            return leaves.length === 1 ? leaves[0] : makeSplit(inner, leaves);
                          });
                          return makeSplit(outer, groups);
                        }
                        function spPreview(node) {
                          var el = document.createElement('div');
                          el.style.flex = '1 1 0';
                          el.style.minWidth = '0';
                          el.style.minHeight = '0';
                          if (isLeaf(node)) {
                            el.className = 'sp-leaf';
                            el.textContent = String(Number(node.p) + 1);
                            return el;
                          }
                          el.style.display = 'flex';
                          el.style.gap = '2px';
                          el.style.flexDirection = node.d === 'r' ? 'row' : 'column';
                          node.k.forEach(function (c) { el.appendChild(spPreview(c)); });
                          return el;
                        }
                        // What can be tiled right now: panes already open + the other tabs of this tab bar (blank ones too)
                        function spPlan() {
                          var vis = visibleKeys();
                          var act = activeTab();
                          var items = tabs.filter(function (t) { return !t.g || t.id === activeId; });
                                                    var rest = items.filter(function (t) { return (!act || t.id !== act.id) && !t.snap; });
                          var room = Math.max(0, MAX_PANES - vis.length);
                          var extra = rest.slice(0, room);
                          return { vis: vis, extra: extra, total: vis.length + extra.length, cut: rest.length > extra.length };
                        }
                        function spApply(comp, orient) {
                          var plan = spPlan();
                          var vis0 = visibleKeys();
                          var origin = vis0.indexOf(target) >= 0 ? target : vis0[0];
                          var order = leavesOf(state.layout).slice();
                          var ref = origin;
                          var moved = {};
                          plan.extra.forEach(function (tb) {
                            var before = visibleKeys();
                            var np = addPane(ref, true);
                            if (!np) return;
                            var key = visibleKeys().filter(function (nk) { return before.indexOf(nk) < 0; })[0];
                            if (!key) return;
                            if (tb.url) {
                              setPaneUrl(np, tb.url);
                              noteUrl(key, tb.url);
                            }
                            moved[tb.id] = true;
                            order.push(key);
                            ref = key;
                          });
                          var vis = visibleKeys();
                          var keys = order.filter(function (k) { return vis.indexOf(k) >= 0; });
                          vis.forEach(function (k) { if (keys.indexOf(k) < 0) keys.push(k); });
                          var sum = comp.reduce(function (a, b) { return a + b; }, 0);
                          state.layout = keys.length === sum
                            ? spBuild(comp, keys, orient)
                            : presetLayout(orient === 'v' ? 'cols' : 'rows', keys);
                          renderLayout();
                          persist();
                          setFocus(origin);
                          tabs = tabs.filter(function (tb) { return !moved[tb.id]; });
                          selSet = {};
                          var at0 = activeTab();
                          if (at0 && document.activeElement !== navUrl) navUrl.value = at0.url || '';
                          render();
                          showToast('Split into ' + keys.length + ' panes');
                        }
                        function spClose() {
                          if (spPop) {
                            spPop.remove();
                            spPop = null;
                          }
                        }
                        function spOpen(btn) {
                          if (spPop) { spClose(); return; }
                          var plan = spPlan();
                          if (plan.total < 2) {
                            showToast('Open 2 or more tabs first, then tap Split');
                            return;
                          }
                          if (plan.cut) showToast('Only ' + MAX_PANES + ' panes fit');
                          var pop = mk('div', 'sp-pop');
                          pop.appendChild(mk('div', 'sp-title', 'Split ' + plan.total + ' panes'));
                          pop.appendChild(mk('div', 'sp-sub', plan.vis.length + ' open now' + (plan.extra.length ? ' + ' + plan.extra.length + ' from your tabs' : '')));
                          var seg = mk('div', 'sp-seg');
                          var bv = mk('button', '', 'Vertical');
                          bv.type = 'button';
                          bv.title = 'Vertical dividers: panes side by side';
                          var bh = mk('button', '', 'Horizontal');
                          bh.type = 'button';
                          bh.title = 'Horizontal dividers: panes stacked';
                          seg.appendChild(bv);
                          seg.appendChild(bh);
                          pop.appendChild(seg);
                          var grid = mk('div', 'sp-grid');
                          pop.appendChild(grid);
                          pop.appendChild(mk('div', 'sp-hint', 'Vertical = side by side \u2022 Horizontal = stacked'));
                          function paint() {
                            bv.className = spOrient === 'v' ? 'on' : '';
                            bh.className = spOrient === 'h' ? 'on' : '';
                            grid.textContent = '';
                            spOptions(plan.total).forEach(function (comp) {
                              var o = mk('button', 'sp-opt');
                              o.type = 'button';
                              o.title = comp.join(' + ');
                              var keys = [];
                              for (var i = 0; i < plan.total; i++) keys.push(String(i));
                              o.appendChild(spPreview(spBuild(comp, keys, spOrient)));
                              o.addEventListener('click', function (e) {
                                e.stopPropagation();
                                spClose();
                                spApply(comp, spOrient);
                              });
                              grid.appendChild(o);
                            });
                          }
                          bv.addEventListener('click', function () { spOrient = 'v'; writeLS('split-view:split-orient', 'v'); paint(); });
                          bh.addEventListener('click', function () { spOrient = 'h'; writeLS('split-view:split-orient', 'h'); paint(); });
                          paint();
                          document.body.appendChild(pop);
                          var r = btn.getBoundingClientRect();
                          var w = pop.offsetWidth;
                          pop.style.top = (r.bottom + 6) + 'px';
                          pop.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w)) + 'px';
                          spPop = pop;
                        }
                        (function spInit() {
                          if (!document.getElementById('sp-style')) {
                            var st = document.createElement('style');
                            st.id = 'sp-style';
                            st.textContent =
                              '.sp-pop{position:fixed;z-index:2147483150;width:280px;max-width:calc(100vw - 16px);max-height:calc(100vh - 80px);overflow:auto;box-sizing:border-box;padding:12px;background:#000432;color:#fff;border:1px solid rgba(255,255,255,0.4);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,0.45);font:13px "Segoe UI",system-ui,sans-serif;}' +
                              '.sp-title{font-weight:600;font-size:14px;}' +
                              '.sp-sub{font-size:12px;opacity:0.75;margin:2px 0 10px;}' +
                              '.sp-seg{display:flex;gap:6px;margin-bottom:10px;}' +
                              '.sp-seg button{flex:1 1 0;height:30px;border:1px solid rgba(255,255,255,0.4);border-radius:6px;background:transparent;color:#fff;cursor:pointer;font:inherit;}' +
                              '.sp-seg button.on{background:#fff;color:#000432;font-weight:600;}' +
                              '.sp-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;}' +
                              '.sp-opt{display:flex;height:64px;padding:4px;box-sizing:border-box;border:1px solid rgba(255,255,255,0.4);border-radius:6px;background:rgba(255,255,255,0.06);cursor:pointer;}' +
                              '.sp-opt:hover{background:rgba(255,255,255,0.2);border-color:#fff;}' +
                              '.sp-leaf{display:flex;align-items:center;justify-content:center;background:#fff;color:#000432;font:600 11px "Segoe UI",system-ui,sans-serif;border-radius:2px;}' +
                              '.sp-hint{margin-top:10px;font-size:11px;opacity:0.65;}';
                            document.head.appendChild(st);
                          }
                          var cxEl = document.getElementById('cxBtn');
                          if (!cxEl || !cxEl.parentNode || document.getElementById('splitBtn')) return;
                          var sb = document.createElement('button');
                          sb.className = 'cx-btn';
                          sb.id = 'splitBtn';
                          sb.type = 'button';
                          sb.title = 'Split tabs into panes';
                          sb.setAttribute('aria-label', 'Split tabs into panes');
                          sb.innerHTML = '<svg viewBox="0 0 16 16" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block"><rect x="2" y="2.5" width="12" height="11" rx="1.5"/><path d="M8 2.5v11M8 8h6"/></svg>';
                                                    cxEl.parentNode.insertBefore(sb, cxEl);
                          var fsb = document.querySelector('.fs-btn');
                          if (fsb) {
                            fsb.classList.add('cx-btn');
                            fsb.style.fontSize = '20px';
                            fsb.style.opacity = '1';
                            cxEl.parentNode.insertBefore(fsb, cxEl);
                          }
                          sb.addEventListener('click', function (e) {
                            e.stopPropagation();
                            spOpen(sb);
                          });
                          document.addEventListener('pointerdown', function (e) {
                            if (!spPop) return;
                            if (spPop.contains(e.target) || sb.contains(e.target)) return;
                            spClose();
                          }, true);
                          document.addEventListener('keydown', function (e) {
                            if (e.key === 'Escape' && spPop) spClose();
                          });
                          window.addEventListener('message', function (e) {
                            if (e.data && e.data.splitViewTap && spPop) spClose();
                          });
                        })();

                        function selBtn(label, tip, fn) {
              var b = mk('button', 'bb-selbtn', label);
              b.type = 'button';
              b.title = tip;
              b.addEventListener('click', function (e) {
                e.stopPropagation();
                fn();
              });
              return b;
            }
            function renderExtras() {
              groups.forEach(function (g, gi) {
                if (!g || !Array.isArray(g.urls)) return;
                var chip = mk('div', 'bb-group');
                                chip.title = 'Open group: ' + g.urls.map(function (u) { return hostOf(u); }).join(' + ');
                                // Name only, no count and no rename button. The name is chosen when the group is added.
                chip.appendChild(mk('span', 'bb-group-title', '\u25A6 ' + g.name));
                var gx = mk('button', 'bb-tab-x', '\u00d7');
                gx.type = 'button';
                gx.setAttribute('aria-label', 'Delete group');
                gx.addEventListener('click', function (e) {
                  e.stopPropagation();
                              var gone = groups.splice(gi, 1)[0];
                  tabs.forEach(function (tb) {
                    if (gone && tb.g === gone.id) delete tb.g;
                  });
                  saveGroups();
                  render();
                });
                chip.appendChild(gx);
                chip.addEventListener('click', function () { openGroup(g); });
                tabBar.appendChild(chip);
              });
              if (selCount() >= 2) {
                tabBar.appendChild(selBtn('Split', 'Split the selected tabs into panes', splitSelected));
                tabBar.appendChild(selBtn('Group', 'Save the selected tabs as a group and split them', groupSelected));
                tabBar.appendChild(selBtn('\u00d7', 'Clear selection', clearSel));
              }
            }
            function activeTab() {
        return tabs.find(function (t) { return t.id === activeId; });
      }
      function isBookmarked(u) {
        return !!u && bookmarks.some(function (b) { return b.url === u; });
      }

            // Drag a tab sideways to reorder it, like Chrome. With a mouse, click and drag.
      // On touch, hold the tab for a moment, then drag. Tabs inside a group stay where they are.
      function attachTabDrag(tab, t) {
        tab.setAttribute('data-tid', String(t.id));
        var st = null;
        var holdTimer = 0;
        function begin() {
          if (!st || st.on) return;
          st.on = true;
          try { tab.setPointerCapture(st.id); } catch (e) {}
          tab.style.position = 'relative';
          tab.style.zIndex = '20';
          tab.style.transition = 'none';
          tab.style.opacity = '0.85';
          tab.style.cursor = 'grabbing';
          tab.style.userSelect = 'none';
        }
        function moveTo(x) {
          var others = Array.prototype.filter.call(tabBar.querySelectorAll('.bb-tab'), function (el) { return el !== tab; });
          var center = x - st.grab + tab.offsetWidth / 2;
          var before = null;
          for (var i = 0; i < others.length; i++) {
            var r = others[i].getBoundingClientRect();
            if (center < r.left + r.width / 2) { before = others[i]; break; }
          }
          if (before) {
            if (tab.nextSibling !== before) tabBar.insertBefore(tab, before);
          } else if (others.length) {
            var last = others[others.length - 1];
            if (tab.previousSibling !== last) tabBar.insertBefore(tab, last.nextSibling);
          }
          tab.style.transform = '';
          var left = tab.getBoundingClientRect().left;
          tab.style.transform = 'translateX(' + (x - st.grab - left) + 'px)';
        }
        function finish() {
          clearTimeout(holdTimer);
          var s = st;
          st = null;
          if (!s || !s.on) return;
          try { tab.releasePointerCapture(s.id); } catch (e) {}
          tab._dragAt = Date.now();
          var order = Array.prototype.map.call(tabBar.querySelectorAll('.bb-tab'), function (el) { return el.getAttribute('data-tid'); });
          var byId = {};
          tabs.forEach(function (x) { byId[String(x.id)] = x; });
          var sorted = order.map(function (i) { return byId[i]; }).filter(Boolean);
          var n = 0;
          tabs = tabs.map(function (x) { return x.g ? x : (sorted[n++] || x); });
          render();
        }
        tab.addEventListener('pointerdown', function (e) {
          if (e.button !== 0 || e.ctrlKey || e.metaKey) return;
          if (e.target && e.target.closest && e.target.closest('.bb-tab-x')) return;
          var r = tab.getBoundingClientRect();
          st = { id: e.pointerId, x0: e.clientX, grab: e.clientX - r.left, on: false, touch: e.pointerType !== 'mouse' };
          clearTimeout(holdTimer);
          if (st.touch) holdTimer = setTimeout(begin, 250);
        });
        tab.addEventListener('pointermove', function (e) {
          if (!st || e.pointerId !== st.id) return;
          if (!st.on) {
            var d = Math.abs(e.clientX - st.x0);
            if (st.touch) {
              if (d > 8) { clearTimeout(holdTimer); st = null; }
              return;
            }
            if (d <= 5) return;
            begin();
          }
          moveTo(e.clientX);
          e.preventDefault();
        });
        tab.addEventListener('touchmove', function (e) {
          if (st && st.on && e.cancelable) e.preventDefault();
        }, { passive: false });
        tab.addEventListener('pointerup', finish);
        tab.addEventListener('pointercancel', finish);
        // The click that follows a drag must not activate the tab.
        tab.addEventListener('click', function (e) {
          if (tab._dragAt && Date.now() - tab._dragAt < 300) {
            e.stopImmediatePropagation();
            e.preventDefault();
          }
        }, true);
      }

      // ── Fixed 0-9 / A-Z folders: always exist, can't be renamed, cut or deleted ──
            function bmIsAZ(b) {
              return !!(b && b.folder && typeof b.id === 'string' && /^az_[0-9A-Z]$/.test(b.id));
            }
            function bmEnsureAZ() {
              '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach(function (ch) {
                const id = 'az_' + ch;
                const ex = bookmarks.find(function (x) { return x && x.folder && x.id === id; });
                if (ex) { ex.title = ch; ex.f = BM_BAR; delete ex.p; }
                else bookmarks.push({ id: id, folder: true, title: ch, f: BM_BAR });
              });
            }
                        function render() {
                                sessNote();
                                tabBar.textContent = '';
                      tabs.forEach(function (t) {
                                    // Every tab shows, blank ones too, so + always gives a visible new tab.
                                if (t.g && t.id !== activeId) return;
                var tab = mk('div', 'bb-tab' + (t.id === activeId ? ' active' : '') + (selSet[t.id] ? ' sel' : ''));
                tab.setAttribute('role', 'tab');
                                var ti = tabInfo(t);
                tab.title = ti.tip;
                tab.appendChild(mk('span', 'bb-tab-ico' + (ti.blank ? ' blank' : ''), ti.ico));
                tab.appendChild(mk('span', 'bb-tab-title', ti.title));
          const x = mk('button', 'bb-tab-x', '\u00d7');
          x.type = 'button';
          x.setAttribute('aria-label', 'Close tab');
          x.addEventListener('click', function (e) { e.stopPropagation(); closeTab(t.id); });
          tab.appendChild(x);
          tab.addEventListener('click', function (e) {
                      if (e.ctrlKey || e.metaKey) {
                        toggleSel(t.id);
                        return;
                      }
                      activate(t.id);
                    });
                    attachTabDrag(tab, t);
          tabBar.appendChild(tab);
        });
        renderExtras();
                var plus = mk('button', 'bb-tab-new', '+');
        plus.type = 'button';
        plus.title = 'New tab';
        plus.setAttribute('aria-label', 'New tab');
        plus.addEventListener('click', newTab);
        tabBar.appendChild(plus);

                const t = activeTab();
        const on = isBookmarked(t && t.url);
        // Chrome-style bookmark star: always visible in the address bar, outlined when off, filled blue when on
        navStar.innerHTML = on
          ? '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true" style="display:block"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.62L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>'
          : '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true" style="display:block"><path d="M22 9.24l-7.19-.62L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.63-7.03L22 9.24zM12 15.4l-3.76 2.27 1-4.28-3.32-2.88 4.38-.38L12 6.1l1.71 4.04 4.38.38-3.32 2.88 1 4.28L12 15.4z"/></svg>';
        navStar.style.color = on ? '#0b57d0' : '';
        navStar.title = on ? 'Remove bookmark' : 'Bookmark this page';
        navStar.style.display = '';

        bmBar.textContent = '';
                // The bookmark bar shows ONLY the 36 fixed folders: 0 1 2 ... 9 A B ... Z
                bmEnsureAZ();
                bmBar.style.display = 'flex';
                                bmBar.style.overflowX = 'hidden';
                bmBar.style.scrollbarWidth = 'none';
                '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach(function (ch) {
                  const f = bookmarks.find(function (x) { return x && x.folder && x.id === 'az_' + ch; });
                  if (!f) return;
                  const n = bookmarks.filter(function (c) { return c && c.url && c.p === f.id; }).length;
                  const chip = bmBarFolderChip(f);
                  chip.innerHTML = '';
                  chip.appendChild(mk('span', 'bb-mark-title', ch));
                  chip.title = ch + ' \u2022 ' + n + (n === 1 ? ' bookmark' : ' bookmarks');
                                    chip.style.flex = '1 1 0';
                  chip.style.minWidth = '0';
                  chip.style.justifyContent = 'center';
                  chip.style.fontWeight = '600';
                  chip.style.opacity = n ? '1' : '0.6';
                  bmBar.appendChild(chip);
                });
        if (!bookmarks.length) {
          bmBar.appendChild(mk('span', 'bb-hint', 'Tap \u2606 to bookmark a page'));
        }
                bookmarks.forEach(function (b, i) {
                    return; // old bar items are no longer drawn on the bar (they stay in the manager)
          if (b.folder) { bmBar.appendChild(bmBarFolderChip(b)); return; }
          if (!b.url) return;
          const m = mk('div', 'bb-mark');
          m.title = b.url;
          m.addEventListener('contextmenu', function (e) { bmCtxMenu(e, b, BM_BAR); });
          m.appendChild(mk('span', 'bb-mark-title', b.title || hostOf(b.url)));
          const x = mk('button', 'bb-tab-x bb-mark-x', '\u00d7');
          x.type = 'button';
          x.setAttribute('aria-label', 'Remove bookmark');
          x.addEventListener('click', function (e) {
            e.stopPropagation();
                        bookmarks.splice(i, 1);
            bmSave();
          });
          m.appendChild(x);
                    m.addEventListener('click', function () { go(b.url); });
              bmBar.appendChild(m);
            });
            // Chrome's "All Bookmarks" entry at the end of the bar opens the bookmark manager
            const allMarks = mk('div', 'bb-mark bb-allmarks');
            allMarks.title = 'Bookmark manager (Ctrl+Shift+O)';
            allMarks.innerHTML = bmFolderIco() + '<span class="bb-mark-title">All Bookmarks</span>';
            allMarks.addEventListener('click', function () { bmOpenManager(); });
            // "All Bookmarks" chip removed from the bar (manager: Ctrl+Shift+O or right-click menu)
          }

      function go(raw) {
        const u = toUrl(raw);
        const t = activeTab();
        if (!u || !t) return;
                siteHistory.record(u);
                t.url = u;
        setPaneUrl(panes[target], u);
        navUrl.value = u;
        render();
      }
            function activate(id) {
        var next = tabs.find(function (x) { return x.id === id; });
        selSet = {};
        if (!next) return;
        if (id !== activeId) {
          capTab(activeTab());
          activeId = id;
          applyTab(next);
        }
        navUrl.value = paneUrl();
        render();
      }
                        function newTab() {
                var t = { id: ++seq, url: '' };
                var gi = tabs.length;
                while (gi--) {
          if (tabs[gi].g) tabs.splice(gi, 1);
        }
        tabs.push(t);
        activate(t.id);
        try { navUrl.focus(); } catch (e) {}
      }
      function closeTab(id) {
        const i = tabs.findIndex(function (t) { return t.id === id; });
        if (i < 0) return;
        tabs.splice(i, 1);
                selSet = {};
        if (!tabs.length) tabs.push({ id: ++seq, url: '' });
                if (activeId === id) activate(tabs[Math.max(0, i - 1)].id);
          else render();
          purgeHiddenPanes();
        }
        // Stops background pages that no open tab owns any more (e.g. after a tab is closed).
        function purgeHiddenPanes() {
          var vis = visibleKeys();
          PANE_KEYS.forEach(function (k) {
            if (vis.indexOf(k) >= 0) return;
            var u = paneUrlOf(k);
            if (!u) return;
            var used = tabs.some(function (t) {
              if (t.url === u) return true;
              return !!(t.snap && t.snap.p && Object.keys(t.snap.p).some(function (pk) {
                return t.snap.p[pk] && t.snap.p[pk].u === u;
              }));
            });
            if (!used) {
              try { panes[k].view.src = 'about:blank'; } catch (e) {}
            }
          });
        }
      function syncFromPane() {
        const t = activeTab();
        const u = paneUrl();
        if (t) t.url = u;
        if (document.activeElement !== navUrl) navUrl.value = u;
        render();
      }

      navUrl.addEventListener('focus', function () { try { navUrl.select(); } catch (e) {} });
      navUrl.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          goTyped();
          navUrl.blur();
          e.preventDefault();
        } else if (e.key === 'Escape') {
          navUrl.value = (activeTab() && activeTab().url) || '';
          navUrl.blur();
        }
      });
      function paneGo(dir) {
              try {
                curView().contentWindow.postMessage({ splitViewNav: dir }, '*');
              } catch (e) {}
            }
            var navBackBtn = $('navBack');
            var navFwdBtn = $('navFwd');
            if (navBackBtn) navBackBtn.addEventListener('click', function () { paneGo('back'); });
            if (navFwdBtn) navFwdBtn.addEventListener('click', function () { paneGo('forward'); });
            navReload.addEventListener('click', function () {
        const u = paneUrl();
        if (u) curView().src = u;
      });
      navPane.addEventListener('click', function () {
        const vis = visibleKeys();
        setFocus(vis[(vis.indexOf(target) + 1) % vis.length]);
      });

      // Keep the address bar / tab in step with whatever the target pane loads
      // (site grid, restored state, links inside the page).
          PANE_ORDER.forEach(function (k) {
        const v = panes[k] && panes[k].view;
        if (v) v.addEventListener('load', function () {
                                                                        try { if (v.getAttribute('src') !== HOME_URL) siteHistory.record(v.getAttribute('src')); } catch (e) {}
                                    if (k === target) syncFromPane();
                  else noteUrl(k, paneUrlOf(k));
                });
      });

      // Tapping inside a pane (or on its title strip) makes the bars follow that pane.
            focusListeners.push(function (k) {
                target = k;
          navPane.textContent = paneTag(k);
          navPane.title = 'Target pane: ' + panes[k].name;
          syncFromPane();
        });

        // Tapping a blank pane (the home background) puts the cursor in the address bar,
        // so you can type a site straight away and it opens in the pane you tapped.
        window.addEventListener('message', function (e) {
          const d = e.data;
          if (!d || typeof d !== 'object' || d.splitViewTap !== true) return;
          for (let i = 0; i < PANE_KEYS.length; i++) {
            const k = PANE_KEYS[i];
            if (panes[k].view.contentWindow !== e.source) continue;
            setTimeout(function () {
              if (k === target && !paneUrlOf(k)) {
                try { navUrl.focus(); } catch (err) {}
              }
            }, 0);
            break;
          }
        });

      // ── Address-bar suggestions: your apps, visited sites, popular sites, then Google search ──
            const POPULAR = [
              'youtube.com', 'google.com', 'mail.google.com', 'drive.google.com', 'maps.google.com',
              'translate.google.com', 'docs.google.com', 'gemini.google.com', 'facebook.com', 'instagram.com',
              'x.com', 'twitter.com', 'reddit.com', 'github.com', 'wikipedia.org', 'amazon.com', 'amazon.in',
              'flipkart.com', 'netflix.com', 'linkedin.com', 'web.whatsapp.com', 'web.telegram.org',
              'chatgpt.com', 'claude.ai', 'tradingview.com', 'binance.com', 'coinmarketcap.com',
              'olymptrade.com', 'pocketoption.com', 'quotex.io', 'stackoverflow.com', 'spotify.com',
              'twitch.tv', 'pinterest.com', 'yahoo.com', 'bing.com', 'duckduckgo.com', 'outlook.com',
              'microsoft.com', 'apple.com', 'discord.com', 'notion.so', 'figma.com', 'bbc.com', 'hotstar.com'
            ];
            const SEARCH_SVG = '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true" style="display:block"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg>';
            const sugg = mk('div', 'bb-sugg');
            sugg.hidden = true;
            sugg.setAttribute('role', 'listbox');
            let rows = [];
            let sel = -1;
            (function () {
              const half = navUrl.closest('.bb-half');
              if (!half) return;
              half.style.position = 'relative';
              half.appendChild(sugg);
            })();

            function normQ(s) {
              return String(s).trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/^www\./, '');
            }
            function matchScore(host, label, q) {
              if (host.indexOf(q) === 0) return 300;
              if (label && label.indexOf(q) === 0) return 280;
              const segs = host.split('.');
              for (let i = 1; i < segs.length - 1; i++) {
                if (segs[i].indexOf(q) === 0) return 200;
              }
              if (label && label.indexOf(q) >= 0) return 120;
              if (host.indexOf(q) >= 0) return 100;
              return 0;
            }
            function findSites(raw) {
              const q = normQ(raw);
              if (!q || /[\s\/]/.test(q)) return [];
              const minScore = q.length < 3 ? 200 : 1;
              const best = {};
              const appHosts = {};
              const now = Date.now();
              function consider(key, host, url, main, sub, label, base) {
                const m = matchScore(host, label, q);
                if (m < minScore) return;
                const sc = m + base;
                if (best[key] && best[key].score >= sc) return;
                best[key] = { kind: 'site', score: sc, prefix: m >= 280, url: url, main: main, sub: sub };
              }
              (state.sites || []).forEach(function (s) {
                const p = siteHistory.parse(s.url);
                if (!p) return;
                appHosts[p.host] = true;
                const name = String(s.name || p.host);
                consider('a:' + s.url, p.host, s.url, name, name.toLowerCase() === p.host ? '' : p.host, name.toLowerCase(), 160);
              });
              siteHistory.all().forEach(function (e) {
                if (appHosts[e.h]) return;
                const age = now - (e.ts || 0);
                const bonus = Math.min(e.n || 0, 30) * 4 + (age < 864e5 ? 25 : age < 6048e5 ? 12 : 0);
                consider('h:' + e.h, e.h, e.u || 'https://' + e.h + '/', e.h, '', '', 100 + bonus);
              });
              POPULAR.forEach(function (h) {
                if (appHosts[h]) return;
                consider('h:' + h, h, 'https://' + h + '/', h, '', '', 0);
              });
              return Object.keys(best).map(function (k) { return best[k]; }).sort(function (a, b) {
                return b.score - a.score || a.main.length - b.main.length;
              }).slice(0, 6);
            }
                        // Suggest domain endings while typing: "wiki" -> wiki.com / wiki.in / wiki.org ...
            //                                       "foo.c" -> foo.com / foo.co / foo.co.in
            const TLD_LIST = ['com', 'in', 'org', 'net', 'io', 'co.in', 'co', 'ai', 'dev', 'app', 'info', 'me'];
            function guessTlds(raw) {
              const q = normQ(raw).replace(/\/+$/, '');
              if (!q || q.length < 2 || /[\s\/:?#@]/.test(q)) return [];
              if (/^localhost/.test(q) || /^[\d.]+$/.test(q)) return [];
              let base = q;
              let partial = '';
              const dot = q.lastIndexOf('.');
              if (dot >= 0) {
                base = q.slice(0, dot);
                partial = q.slice(dot + 1);
              }
              if (!base || !/^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(base)) return [];
              if (partial && !/^[a-z.]*$/.test(partial)) return [];
              const hosts = [];
              TLD_LIST.forEach(function (t) {
                if (t.indexOf(partial) === 0) hosts.push(base + '.' + t);
              });
              return hosts;
            }
            function buildRows(raw) {
              const out = findSites(raw);
              const u = toUrl(raw);
              const isUrl = !!u && u.indexOf('https://www.google.com/search?q=') !== 0;
              if (isUrl) {
                const qn = normQ(raw).replace(/\/+$/, '');
                const dup = out.some(function (r) { return normQ(r.url).replace(/\/+$/, '') === qn; });
                if (!dup) out.unshift({ kind: 'url', url: u, main: raw, sub: 'Open' });
              }
              // Add domain-ending guesses (.com, .in, ...) that are not already listed
              const seen = {};
              out.forEach(function (r) { seen[normQ(r.url).replace(/\/.*$/, '')] = true; });
              let added = 0;
              guessTlds(raw).forEach(function (h) {
                if (added >= 4 || seen[h]) return;
                seen[h] = true;
                added++;
                out.push({ kind: 'site', score: 0, prefix: false, url: 'https://' + h + '/', main: h, sub: '' });
              });
              out.push({ kind: 'search', url: 'https://www.google.com/search?q=' + encodeURIComponent(raw), main: raw, sub: 'Google Search' });
              return out;
            }
            function paint() {
              sugg.textContent = '';
              rows.forEach(function (r, i) {
                const row = mk('div', 'bb-sg' + (i === sel ? ' sel' : ''));
                row.setAttribute('role', 'option');
                const ico = mk('span', 'bb-sg-ico');
                if (r.kind === 'search') ico.innerHTML = SEARCH_SVG;
                else ico.textContent = (r.main.charAt(0) || '?').toUpperCase();
                row.appendChild(ico);
                row.appendChild(mk('span', 'bb-sg-main', r.main));
                if (r.sub) row.appendChild(mk('span', 'bb-sg-sub', r.sub));
                row.addEventListener('click', function () { pick(i); });
                sugg.appendChild(row);
              });
              sugg.hidden = !rows.length;
                            placePopups();
            }
            function hideSugg() {
              sugg.hidden = true;
              rows = [];
              sel = -1;
            }
            function updateSugg() {
              const raw = navUrl.value.trim();
              if (!raw) { hideSugg(); return; }
              rows = buildRows(raw);
              const first = rows[0];
              sel = first && (first.kind === 'url' || (first.kind === 'site' && first.prefix)) ? 0 : -1;
              paint();
            }
            function pick(i) {
              const r = rows[i];
              hideSugg();
              if (!r) return;
              go(r.url);
              try { navUrl.blur(); } catch (e) {}
            }
            // Enter: use the highlighted suggestion if there is one, otherwise what was typed.
            function goTyped() {
              const r = !sugg.hidden && sel >= 0 ? rows[sel] : null;
              hideSugg();
              go(r ? r.url : navUrl.value);
            }

            navUrl.addEventListener('input', updateSugg);
            navUrl.addEventListener('blur', hideSugg);

                        // ── Temp popup: shows what is being typed in the URL / prompt boxes ──
                        const peek = mk('div', 'type-peek');
                        peek.id = 'typePeek';
                        peek.hidden = true;
                        document.body.appendChild(peek);
                        let peekInput = null;
                        function placePopups() {
                          const vh = window.innerHeight, vw = window.innerWidth;
                          let floor = null;
                          if (peekInput && !peek.hidden) {
                            const r = peekInput.getBoundingClientRect();
                            const w = Math.min(vw - 16, Math.max(r.width, 260));
                            peek.style.width = w + 'px';
                            peek.style.left = Math.max(8, Math.min(r.left, vw - w - 8)) + 'px';
                            peek.style.top = (r.bottom + 6) + 'px';
                            peek.style.bottom = 'auto';
                            floor = peek.getBoundingClientRect().bottom;
                          }
                          if (!sugg.hidden) {
                            const om = navUrl.closest('.bb-omni') || navUrl;
                            const r = om.getBoundingClientRect();
                            const w = Math.min(vw - 16, Math.max(r.width, 260));
                            sugg.style.width = w + 'px';
                            sugg.style.left = Math.max(8, Math.min(r.left, vw - w - 8)) + 'px';
                            sugg.style.top = (r.bottom + 4) + 'px';
                            sugg.style.bottom = 'auto';
                            sugg.style.maxHeight = Math.max(80, vh - r.bottom - 16) + 'px';
                          }
                        }
                        function showPeek(inp) {
                          peekInput = inp;
                          peek.textContent = inp.value;
                          peek.hidden = !inp.value;
                          placePopups();
                        }
                        function hidePeek() {
                          peek.hidden = true;
                          peekInput = null;
                        }
                        [$('dev-instruction')].forEach(function (inp) {
                          if (!inp) return;
                          inp.addEventListener('input', function () { showPeek(inp); });
                          inp.addEventListener('focus', function () { showPeek(inp); });
                          inp.addEventListener('blur', hidePeek);
                        });
                        window.addEventListener('resize', placePopups);
            navUrl.addEventListener('keydown', function (e) {
              if (sugg.hidden || !rows.length) return;
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                sel += e.key === 'ArrowDown' ? 1 : -1;
                if (sel >= rows.length) sel = -1;
                else if (sel < -1) sel = rows.length - 1;
                paint();
                e.preventDefault();
              }
            });
            // Keep the input focused while a suggestion is being tapped
            sugg.addEventListener('mousedown', function (e) { e.preventDefault(); });

            // Remember every app you already have (saved to Firebase with the rest of the history)
            (state.sites || []).forEach(function (s) { siteHistory.record(s.url, true); });

      const saved = readLS(LS_BM, []);
      bookmarks = Array.isArray(saved) ? saved : [];
                        initTabs();
            navUrl.value = (activeTab() && activeTab().url) || '';
            render();
            setTimeout(sessBoot, 0);
    })();
  function ps(p) {
    return state.panes[p.key];
  }
  function findSite(id) {
    for (let i = 0; i < state.sites.length; i++) if (state.sites[i].id === id) return state.sites[i];
    return null;
  }
    function activeSite(p) {
    const s = findSite(ps(p).active) || state.sites[0];
    // Gmail never loads inside a pane: fall back to the first normal app
    if (s && isGmailSite(s)) {
      return (
        state.sites.filter(function (x) {
          return !isGmailSite(x);
        })[0] || s
      );
    }
    return s;
  }
  // Reload every pane currently showing this app (used after an address change or delete).
  function reloadPanesShowing(site, fallback) {
    visibleKeys().forEach(function (k) {
      // a pane that has not loaded anything yet is left alone
      if (!hasSrc(panes[k])) return;
      if (ps(panes[k]).active === site.id) loadSite(panes[k], fallback || site);
    });
  }
  function armFallback(p) {
    clearTimeout(p.timer);
    p.catcher.classList.remove('on');
    p.timer = setTimeout(function () {
      p.catcher.classList.add('on');
    }, FALLBACK_MS);
  }
  function markReady(p) {
    clearTimeout(p.timer);
    p.catcher.classList.remove('on');
  }
  // Sites that break out of the frame (top.location = ...) and replace this whole window.
  // They load in a sandboxed frame WITHOUT allow-top-navigation, so the break-out is blocked.
  // To add another site, put its hostname in this list.
  const BREAKOUT_HOSTS = ['mail.google.com', 'gmail.com', 'www.gmail.com', 'accounts.google.com'];
  // NO allow-popups and NO allow-top-navigation: the page can neither open a new window
  // (window.open / target=_blank) nor replace this window (top.location = ...).
  const SANDBOX_FLAGS = 'allow-scripts allow-same-origin allow-forms allow-modals allow-downloads allow-pointer-lock allow-presentation allow-orientation-lock';
  function isBreakout(url) {
    try {
      return BREAKOUT_HOSTS.indexOf(new URL(url).hostname.toLowerCase()) >= 0;
        } catch (e) {
        return false;
      }
    }
    // Gmail can't be shown inside a pane (it refuses to be framed), so it opens in its own popup window.
    // The Split View window stays open and unchanged.
    function isGmailSite(site) {
      return !!site && (isBreakout(site.url) || /gmail/i.test(site.name || ''));
    }
    const popupWins = {};
    function openPopupWindow(site) {
      const url = site.url;
      const fallback = function () {
        try {
          window.open(url, '_blank', 'popup=yes,width=1000,height=760');
        } catch (e) {}
      };
      if (typeof chrome === 'undefined' || !chrome.windows || !chrome.windows.create) {
        fallback();
        return;
      }
      const create = function () {
        chrome.windows.create({ url: url, type: 'popup', width: 1000, height: 760 }, function (w) {
          if (chrome.runtime.lastError || !w) {
            fallback();
            return;
          }
          popupWins[site.id] = w.id;
        });
      };
      if (popupWins[site.id] == null) {
        create();
        return;
      }
      // Already open: just bring it to the front. If it was closed, open a new one.
      chrome.windows.update(popupWins[site.id], { focused: true }, function (w) {
        if (chrome.runtime.lastError || !w) {
          popupWins[site.id] = null;
          create();
        }
      });
    }
        function loadSite(p, site, opts) {
      ps(p).active = site.id;
      updatePaneChrome(p);
      devLog('PANE', 'loadSite ' + p.key + ' -> ' + site.name + ' ' + site.url);
        armFallback(p);
      if (isBreakout(site.url) || /gmail/i.test(site.name || '')) p.view.setAttribute('sandbox', SANDBOX_FLAGS);
      else p.view.removeAttribute('sandbox');
      installFrameRule().then(function () {
        p.view.src = site.url;
      });
      if (!opts || opts.persist !== false) persist();
    }
  function paneFromSource(source) {
    if (!source) return null;
    for (let i = 0; i < PANE_KEYS.length; i++) {
      if (panes[PANE_KEYS[i]].view.contentWindow === source) return panes[PANE_KEYS[i]];
    }
    return null;
  }
  function isOlympUrl(url) {
    try {
      const h = new URL(url).hostname;
      return h === 'olymptrade.com' || h.endsWith('.olymptrade.com');
    } catch (e) {
      return false;
    }
  }
  function attachLongPress(node, onHold) {
    const HOLD_MS = 550;
    const SLOP = 12;
    let timer = 0,
      sx = 0,
      sy = 0;
    function cancel() {
      if (timer) {
        clearTimeout(timer);
        timer = 0;
      }
    }
    function begin(x, y) {
      cancel();
      sx = x;
      sy = y;
      timer = setTimeout(function () {
        timer = 0;
        onHold();
      }, HOLD_MS);
    }
    function move(x, y) {
      if (timer && Math.hypot(x - sx, y - sy) > SLOP) cancel();
    }
    node.addEventListener(
      'touchstart',
      function (e) {
        if (e.touches.length !== 1) {
          cancel();
          return;
        }
        begin(e.touches[0].clientX, e.touches[0].clientY);
      },
      { passive: true }
    );
    node.addEventListener(
      'touchmove',
      function (e) {
        if (e.touches.length !== 1) {
          cancel();
          return;
        }
        move(e.touches[0].clientX, e.touches[0].clientY);
      },
      { passive: true }
    );
    node.addEventListener('touchend', cancel, { passive: true });
    node.addEventListener('touchcancel', cancel, { passive: true });
    node.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'touch' || !e.isPrimary) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      begin(e.clientX, e.clientY);
    });
    node.addEventListener('pointermove', function (e) {
      if (e.pointerType !== 'touch') move(e.clientX, e.clientY);
    });
    node.addEventListener('pointerup', function (e) {
      if (e.pointerType !== 'touch') cancel();
    });
    node.addEventListener('pointercancel', function (e) {
      if (e.pointerType !== 'touch') cancel();
    });
    node.addEventListener('contextmenu', function (e) {
      e.preventDefault();
    });
  }
  PANE_KEYS.forEach(function (k) {
    attachLongPress(panes[k].catcher, function () {
      if (!mgrIsOpen()) openManager(panes[k]);
    });
  });
  const mgr = {
    el: $('mgr'),
    title: $('mgrTitle'),
    body: $('mgrBody'),
    grid: $('mgrGrid'),
    list: $('mgrList'),
    hint: $('mgrHint'),
    addBox: $('mgrAdd'),
    modeBtn: $('mgrMode'),
    msg: $('mgrMsg'),
    sync: $('mgrSync'),
    nameIn: $('mgrName'),
    urlIn: $('mgrUrl'),
    pane: null,
    mode: 'grid',
    editId: null,
        delId: null,
      delTimer: 0,
      drag: null,
      openedAt: 0,
      addCell: null,
      panel: $('mgrPanel'),
      fab: $('mgrFab')
    };
    const SYNC_TEXT = {
      idle: 'Sync: starting…',
      saving: 'Sync: saving…',
    ok: 'Synced ✓',
    offline: 'Offline — saved on this device',
    denied: 'Sync blocked by database rules — saved on this device',
    error: 'Sync error — saved on this device'
  };
    let syncStatus = 'idle';
  function renderSyncStatus() {
    if (mgr.sync) mgr.sync.textContent = SYNC_TEXT[syncStatus] || '';
  }
      // LOCAL ONLY: Firebase is not used.
    SYNC_TEXT.local = 'Saved on this device';
    syncStatus = 'local';
    renderSyncStatus();
    function mgrIsOpen() {
    return !mgr.el.hidden;
  }
  let msgTimer = 0;
  function setMsg(text, isErr) {
    mgr.msg.textContent = text || '';
    mgr.msg.className = 'mgr-msg' + (isErr ? ' err' : '');
    clearTimeout(msgTimer);
    if (text) {
      msgTimer = setTimeout(function () {
        mgr.msg.textContent = '';
      }, isErr ? 4000 : 1800);
    }
  }
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
    // ── Square grid: app tiles in rows and columns, over a plain grid background ──
  const HIVE_TARGET = 78; // preferred square size (px)
  const HIVE_MAX = 112; // biggest a square may grow (px)
    const HIVE_MIN = 36; // smallest a square may shrink (px)
  const HIVE_PAD = 0; // edge to edge: no side padding inside the popup
    const HIVE_COLS_MAX = 12; // most columns you can set
  const HIVE_ROWS_MAX = 20; // most rows you can set
  const HIVE_CODE_LEN = 3; // letters shown on a tile when it has no icon
  const HIVE_KEY = 'split-view:hive:v1';
  const ICON_KEY = 'split-view:icons:v2'; // v2: icons are stored as small data: images (v1 kept links that could break)
  const ICON_RETRY_MS = 5 * 60 * 1000; // retry a failed icon lookup after 5 minutes (never a week)
  const ICON_FETCH_MS = 6000;
  const ICON_PX = 96; // stored icons are shrunk to this size
  try { localStorage.removeItem('split-view:icons:v1'); } catch (e) {}
  const hiveEff = { cols: 3, rows: 3 };
  const hiveBar = $('mgrGridBar');
  const hiveColsVal = $('mgrColsVal');
  const hiveRowsVal = $('mgrRowsVal');
  const hiveCfg = readHiveCfg(); // 0 = automatic
  const iconCache = readIconCache();
  const iconPending = {};
  function readHiveCfg() {
    var out = { cols: 0, rows: 0 };
    try {
      var o = JSON.parse(safeGet(HIVE_KEY) || '{}');
      out.cols = clamp(parseInt(o.cols, 10) || 0, 0, HIVE_COLS_MAX);
      out.rows = clamp(parseInt(o.rows, 10) || 0, 0, HIVE_ROWS_MAX);
    } catch (e) {}
    return out;
  }
  function saveHiveCfg() {
    safeSet(HIVE_KEY, JSON.stringify(hiveCfg));
  }
  function stepHive(which, delta) {
    var max = which === 'cols' ? HIVE_COLS_MAX : HIVE_ROWS_MAX;
    var cur = hiveCfg[which] > 0 ? hiveCfg[which] : hiveEff[which];
    hiveCfg[which] = clamp(cur + delta, 1, max);
    saveHiveCfg();
    layoutHive();
  }
  function resetHive(which) {
    hiveCfg[which] = 0;
    saveHiveCfg();
    layoutHive();
  }
  $('mgrColsMinus').addEventListener('click', function () {
    stepHive('cols', -1);
  });
  $('mgrColsPlus').addEventListener('click', function () {
    stepHive('cols', 1);
  });
  $('mgrRowsMinus').addEventListener('click', function () {
    stepHive('rows', -1);
  });
  $('mgrRowsPlus').addEventListener('click', function () {
    stepHive('rows', 1);
  });
  hiveColsVal.addEventListener('click', function () {
    resetHive('cols');
  });
  hiveRowsVal.addEventListener('click', function () {
    resetHive('rows');
  });

  // ── App icons: PWA manifest icon → page icon → /favicon.ico → short text code ──
  function readIconCache() {
    try {
      var o = JSON.parse(safeGet(ICON_KEY) || '{}');
      return o && typeof o === 'object' ? o : {};
    } catch (e) {
      return {};
    }
  }
  function saveIconCache() {
    safeSet(ICON_KEY, JSON.stringify(iconCache));
  }
  function hiveCode(name) {
    var s = Array.from(String(name || '').replace(/\s+/g, '')).slice(0, HIVE_CODE_LEN).join('');
    return s.toUpperCase() || '\u2022';
  }
  function absUrl(href, base) {
    try {
      var u = new URL(href, base);
      if (u.protocol === 'https:' || u.protocol === 'http:') return u.href;
      if (u.protocol === 'data:' && /^data:image\//i.test(u.href)) return u.href;
      return '';
    } catch (e) {
      return '';
    }
  }
  function iconArea(sizes) {
    var best = 0;
    String(sizes || '')
      .split(/\s+/)
      .forEach(function (t) {
        var m = /^(\d+)x(\d+)$/i.exec(t);
        if (m) best = Math.max(best, Number(m[1]) * Number(m[2]));
        else if (/^any$/i.test(t)) best = Math.max(best, 512 * 512);
      });
    return best;
  }
  function pickIcon(list, base) {
    var best = '';
    var bestScore = -1;
    list.forEach(function (it) {
      if (!it || !it.src) return;
      if (/monochrome/i.test(String(it.purpose || ''))) return;
      var href = absUrl(it.src, base);
      if (!href) return;
      var score = iconArea(it.sizes) || 1;
      if (score > bestScore) {
        bestScore = score;
        best = href;
      }
    });
    return best;
  }
  function fetchTimed(url, kind) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () {
      ctrl.abort();
    }, ICON_FETCH_MS);
    return fetch(url, { signal: ctrl.signal, credentials: 'omit' })
      .then(function (res) {
        if (!res.ok) throw new Error('http ' + res.status);
        return (kind === 'json' ? res.json() : res.text()).then(function (data) {
          return { data: data, url: res.url || url };
        });
      })
      .then(
        function (v) {
          clearTimeout(timer);
          return v;
        },
        function (e) {
          clearTimeout(timer);
          throw e;
        }
      );
  }
  function discoverIcon(site) {
    return fetchTimed(site.url, 'text').then(function (page) {
      var base = page.url || site.url;
      var doc = new DOMParser().parseFromString(String(page.data || '').replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, ''), 'text/html');
      var fallback = absUrl('/favicon.ico', base);
      var fromPage = function () {
        var found = [];
        Array.prototype.forEach.call(doc.querySelectorAll('link[rel~="apple-touch-icon"][href], link[rel~="icon"][href]'), function (l) {
          var touch = /apple-touch-icon/i.test(l.getAttribute('rel') || '');
          found.push({ src: l.getAttribute('href'), sizes: l.getAttribute('sizes') || (touch ? '180x180' : '') });
        });
        return pickIcon(found, base) || fallback;
      };
      var manLink = doc.querySelector('link[rel~="manifest"][href]');
      var manUrl = manLink ? absUrl(manLink.getAttribute('href'), base) : '';
      if (!manUrl) return fromPage();
      return fetchTimed(manUrl, 'json').then(
        function (m) {
          var icons = m.data && Array.isArray(m.data.icons) ? m.data.icons : [];
          return pickIcon(icons, m.url) || fromPage();
        },
        function () {
          return fromPage();
        }
      );
    });
    }
  // Download an icon and shrink it to a small PNG data: URL, so it can be stored and shown
  // instantly later without depending on the network every time the grid is drawn.
  function iconToData(url) {
    if (/^data:image\//i.test(url)) return Promise.resolve(url);
    var ctrl = new AbortController();
    var timer = setTimeout(function () {
      ctrl.abort();
    }, ICON_FETCH_MS);
    return fetch(url, { signal: ctrl.signal, credentials: 'omit' })
      .then(function (res) {
        if (!res.ok) throw new Error('http ' + res.status);
        return res.blob();
      })
      .then(function (blob) {
        if (!blob || !blob.size) throw new Error('empty icon');
        return new Promise(function (resolve, reject) {
          var obj = URL.createObjectURL(blob);
          var img = new Image();
          img.onload = function () {
            try {
              var w = img.naturalWidth || ICON_PX;
              var h = img.naturalHeight || ICON_PX;
              var k = Math.min(1, ICON_PX / Math.max(w, h));
              var cv = document.createElement('canvas');
              cv.width = Math.max(1, Math.round(w * k));
              cv.height = Math.max(1, Math.round(h * k));
              cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
              resolve(cv.toDataURL('image/png'));
            } catch (e) {
              reject(e);
            } finally {
              URL.revokeObjectURL(obj);
            }
          };
          img.onerror = function () {
            URL.revokeObjectURL(obj);
            reject(new Error('icon could not be decoded'));
          };
          img.src = obj;
        });
      })
      .then(
        function (v) {
          clearTimeout(timer);
          return v;
        },
        function (e) {
          clearTimeout(timer);
          throw e;
        }
      );
  }
  // The stored icon (a data: image) for a site, or '' when there is none yet.
  function cachedIcon(site) {
    var hit = iconCache[site.url];
    return hit && typeof hit === 'object' && typeof hit.icon === 'string' && /^data:image\//i.test(hit.icon) ? hit.icon : '';
  }
  function resolveIcon(site) {
    var key = site.url;
    var hit = iconCache[key];
    if (hit && typeof hit === 'object') {
      if (cachedIcon(site)) return Promise.resolve(hit.icon);
      if (!hit.icon && Date.now() - (hit.t || 0) < ICON_RETRY_MS) return Promise.resolve('');
    }
    if (!iconPending[key]) {
      iconPending[key] = discoverIcon(site)
        .catch(function () {
          return absUrl('/favicon.ico', key);
        })
        .then(function (found) {
          // try the discovered icon first, then the plain /favicon.ico; keep the first one that really loads
          var list = [found, absUrl('/favicon.ico', key)].filter(function (u, i, a) {
            return u && a.indexOf(u) === i;
          });
          var i = 0;
          var next = function () {
            if (i >= list.length) return Promise.resolve('');
            return iconToData(list[i++]).catch(next);
          };
          return next();
        })
        .then(function (icon) {
          delete iconPending[key];
          iconCache[key] = { icon: icon || '', t: Date.now() };
          saveIconCache();
          return icon || '';
        });
    }
    return iconPending[key];
  }
  function attachIcon(btn, site, icon) {
    var img = document.createElement('img');
    img.className = 'mgr-ico';
    img.alt = '';
    img.draggable = false;
    img.referrerPolicy = 'no-referrer';
    img.onload = function () {
      if (img.naturalWidth && img.naturalWidth < 32) img.classList.add('sm');
      btn.classList.add('has-ico');
      btn.classList.remove('no-ico');
    };
    img.onerror = function () {
      if (img.parentNode) img.parentNode.removeChild(img);
      // forget the entry so the icon is looked up again next time (never keep a blank)
      delete iconCache[site.url];
      saveIconCache();
    };
    btn.appendChild(img);
    img.src = icon;
  }
  // Fills a tile button: short text code first, swapped for the icon (instantly when it is already stored).
  function paintHiveFace(btn, site) {
    // No icon (yet): full site name on a tile painted in a color of its own
    var shown = siteDisplayName(site);
    btn.classList.add('no-ico');
    btn.style.setProperty('--hue', String(hueFor(shown.toLowerCase())));
    btn.appendChild(el('span', 'mgr-code', shown));
    var stored = cachedIcon(site);
    if (stored) {
      attachIcon(btn, site, stored);
      return;
    }
    resolveIcon(site).then(function (icon) {
      if (icon && btn.isConnected) attachIcon(btn, site, icon);
    });
  }

    var hiveGhost = null;
    // Order-based layout: app #1 sits bottom-left, the list fills each row left to right and climbs upward.
    function hiveSlot(i, cols, rows) {
      return { r: rows - 1 - Math.floor(i / cols), c: i % cols };
    }
        // Apps with a saved cell (pr = row from bottom, pc = column) keep it. The rest fill the first free slot, bottom row first.
    function hivePlaces(cols, rows) {
      var out = {};
      var taken = {};
      var loose = [];
      state.sites.forEach(function (s) {
        var r = typeof s.pr === 'number' ? rows - 1 - s.pr : -1;
        if (typeof s.pc === 'number' && s.pc < cols && r >= 0 && !taken[r + ',' + s.pc]) {
          taken[r + ',' + s.pc] = true;
          out[s.id] = { r: r, c: s.pc };
        } else loose.push(s);
      });
      var i = 0;
      loose.forEach(function (s) {
        var p;
        do {
          p = hiveSlot(i++, cols, rows);
        } while (i <= cols * rows + 1 && (p.r < 0 || taken[p.r + ',' + p.c]));
        taken[p.r + ',' + p.c] = true;
        out[s.id] = p;
      });
      return out;
    }
    // Which square cell is under this screen point (row can be negative = above the current grid).
      function hexCellAt(x, y) {
      var w = hiveEff.w;
    var h = hiveEff.h || w;
    if (!w) return null;
    var box = mgr.body.getBoundingClientRect();
    if (x < box.left || x > box.right || y < box.top || y > box.bottom) return null;
    var g = mgr.grid.getBoundingClientRect();
    var best = { r: Math.floor((y - g.top) / h), c: Math.floor((x - g.left) / w) };
    if (best.c < 0 || best.c >= hiveEff.cols || best.r < -30 || best.r > hiveEff.rows - 1) return null;
    return best;
  }
  function showDropGhost(cell) {
    var g = hiveGhost;
    if (!cell || !hiveEff.w) {
      if (g) g.style.display = 'none';
      return;
    }
    if (!g) {
      g = document.createElement('div');
      g.className = 'mgr-ghost';
      hiveGhost = g;
    }
        if (g.parentNode !== mgr.grid) mgr.grid.appendChild(g);
    var w = hiveEff.w;
    var h = hiveEff.h || w;
    g.style.width = w + 'px';
    g.style.height = h + 'px';
    g.style.left = w * cell.c + 'px';
    g.style.top = h * cell.r + 'px';
    g.style.display = 'block';
  }
  function hideDropGhost() {
    if (hiveGhost && hiveGhost.parentNode) hiveGhost.parentNode.removeChild(hiveGhost);
  }
        // Drop an app on a blank box = move there. Drop on another app = swap places.
    function dropSiteOnCell(site, r, c) {
      var places = hiveEff.places || {};
      var rows = hiveEff.rows;
      if (r < 0 || c < 0 || !places[site.id]) {
        renderMgr();
        return;
      }
      var target = null;
      state.sites.forEach(function (s) {
        var p = places[s.id];
        if (s !== site && p && p.r === r && p.c === c) target = s;
      });
      var from = places[site.id];
      // freeze every app where it sits now
      state.sites.forEach(function (s) {
        var p = places[s.id];
        if (p) {
          s.pr = rows - 1 - p.r;
          s.pc = p.c;
        }
      });
      if (target) {
        target.pr = rows - 1 - from.r;
        target.pc = from.c;
      }
      site.pr = rows - 1 - r;
      site.pc = c;
      persist();
      renderMgr();
    }
  function layoutHive() {
    var hive = mgr.mode === 'grid';
    mgr.body.classList.toggle('hive', hive);
    hiveBar.hidden = !hive;
    if (!hive || mgr.el.hidden) return;
    var avail = mgr.body.clientWidth - 2 * HIVE_PAD;
    if (avail <= 0) return;
    var count = Math.max(1, state.sites.length);
    var maxCols = Math.max(1, Math.floor(avail / HIVE_MIN));
    var cols;
    if (hiveCfg.cols > 0) cols = hiveCfg.cols;
    else if (hiveCfg.rows > 0) cols = Math.ceil(count / hiveCfg.rows);
            else {
          cols = Math.max(2, Math.floor(avail / HIVE_TARGET));
          cols = Math.min(cols, HIVE_COLS_MAX); // edge to edge: fill the popup width
        }
                cols = Math.max(1, Math.min(cols, maxCols));
        var need = Math.max(1, Math.ceil(count / cols));
        state.sites.forEach(function (s) {
          if (typeof s.pr === 'number' && typeof s.pc === 'number' && s.pc < cols) need = Math.max(need, s.pr + 1);
        });
        var availH = mgr.body.clientHeight;
        var rowsAuto = Math.max(1, Math.floor(availH / HIVE_TARGET));
        var rowsShown = Math.max(need, hiveCfg.rows > 0 ? hiveCfg.rows : rowsAuto);
        var places = hivePlaces(cols, rowsShown); // apps fill bottom row first, then climb up
        // Edge to edge: cells stretch so the grid fills the whole popup (width and height).
        var w = Math.max(HIVE_MIN, avail / cols);
    var h = Math.max(HIVE_MIN, availH / rowsShown);
    mgr.body.classList.toggle('scroll', h * rowsShown > availH + 1);
    hiveEff.cols = cols;
    hiveEff.rows = rowsShown;
    hiveEff.w = w;
    hiveEff.h = h;
    hiveEff.places = places;
    hiveColsVal.textContent = hiveCfg.cols > 0 ? String(hiveCfg.cols) : 'auto';
    hiveRowsVal.textContent = hiveCfg.rows > 0 ? String(hiveCfg.rows) : 'auto';
    mgr.body.style.setProperty('--hw', w.toFixed(3) + 'px');
    mgr.body.style.setProperty('--hh', h.toFixed(3) + 'px');
    mgr.body.style.setProperty('--hm', Math.min(w, h).toFixed(2) + 'px');
    mgr.grid.style.setProperty('--hcols', cols);
    mgr.grid.style.gridTemplateRows = 'repeat(' + rowsShown + ', var(--hh, 84px))';
    Array.prototype.forEach.call(mgr.grid.children, function (li) {
      var p = places[li.getAttribute('data-id')];
      if (!p) return;
      li.style.gridColumn = p.c + 1;
      li.style.gridRow = p.r + 1;
    });
  }
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(function () {
      layoutHive();
    }).observe(mgr.body);
  }
  function openManager(p) {
    mgr.pane = p;
    mgr.mode = 'grid';
    mgr.editId = null;
    mgr.delId = null;
    mgr.drag = null;
    clearTimeout(mgr.delTimer);
    mgr.nameIn.value = '';
    mgr.urlIn.value = '';
        mgr.openedAt = Date.now();
      mgr.addCell = null;
      mgr.panel.hidden = true;
      setMsg('');
      p.container.appendChild(mgr.el);
      renderMgr();
      mgr.el.hidden = false;
      layoutHive();
      mgr.body.scrollTop = 0;
    }
    function closeManager() {
      clearTimeout(mgr.delTimer);
      mgr.el.hidden = true;
      mgr.addCell = null;
      mgr.addBox.hidden = true;
      mgr.panel.hidden = true;
      hideDropGhost();
      mgr.pane = null;
    mgr.mode = 'grid';
    mgr.editId = null;
    mgr.delId = null;
    mgr.drag = null;
  }
  function setMode(mode) {
    if (mgr.drag || gridDrag) return;
        mgr.mode = mode;
      mgr.editId = null;
      mgr.delId = null;
      mgr.addCell = null;
      clearTimeout(mgr.delTimer);
      setMsg('');
      renderMgr();
      mgr.body.scrollTop = 0;
    }
    function openSite(site) {
    const p = mgr.pane;
    if (!p) return;
    if (isGmailSite(site)) {
      openPopupWindow(site);
      closeManager();
      return;
    }
    if (site.id !== ps(p).active) {
      loadSite(p, site);
      showToast(p.name + ': ' + site.name);
    }
    closeManager();
  }
    function hueFor(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return h % 360;
  }
  function deleteSite(site) {
    const list = state.sites;
    if (site.gh) {
      setMsg('GitHub app — delete the repo / Pages on GitHub to remove it', true);
      return;
    }
    if (list.length < 2) return;
    const idx = list.findIndex(function (x) {
      return x.id === site.id;
    });
    if (idx < 0) return;
    list.splice(idx, 1);
    reloadPanesShowing(site, list[Math.min(idx, list.length - 1)]);
    clearTimeout(mgr.delTimer);
    mgr.delId = null;
    persist();
    setMsg('Removed');
    renderMgr();
  }
  function startReorder(e, handle, li, site) {
    if (mgr.drag || mgr.editId) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const items = Array.prototype.slice.call(mgr.list.children);
    const from = items.indexOf(li);
    if (from < 0) return;
    e.preventDefault();
    mgr.drag = {
      id: site.id,
      li: li,
      items: items,
      handle: handle,
      pid: e.pointerId,
      from: from,
      to: from,
      startY: e.clientY,
      startScroll: mgr.body.scrollTop
    };
    try {
      handle.setPointerCapture(e.pointerId);
    } catch (err) {}
    li.classList.add('is-dragging');
  }
  function moveReorder(e) {
    const d = mgr.drag;
    if (!d || e.pointerId !== d.pid) return;
    const box = mgr.body.getBoundingClientRect();
    if (e.clientY < box.top + 40) mgr.body.scrollTop -= 10;
    else if (e.clientY > box.bottom - 40) mgr.body.scrollTop += 10;
    d.li.style.transform = 'translateY(' + (e.clientY - d.startY + (mgr.body.scrollTop - d.startScroll)) + 'px)';
    const others = d.items.filter(function (x) {
      return x !== d.li;
    });
    let to = 0;
    others.forEach(function (x) {
      const r = x.getBoundingClientRect();
      if (e.clientY > r.top + r.height / 2) to++;
    });
    d.to = to;
    others.forEach(function (x, i) {
      x.classList.toggle('drop-before', i === to);
      x.classList.toggle('drop-after', to === others.length && i === others.length - 1);
    });
  }
  function endReorder(cancelled) {
    const d = mgr.drag;
    if (!d) return;
    mgr.drag = null;
    try {
      d.handle.releasePointerCapture(d.pid);
    } catch (err) {}
    if (mgr.pane && !cancelled && d.to !== d.from) {
      const list = state.sites;
      const idx = list.findIndex(function (x) {
        return x.id === d.id;
      });
      if (idx >= 0) {
                const moved = list.splice(idx, 1)[0];
                list.splice(d.to, 0, moved);
        list.forEach(function (x) {
          delete x.pr;
          delete x.pc;
        });
        persist();
        setMsg('Order saved');
      }
    }
    renderMgr();
  }
  let gridDrag = null;
  let gridPreventClick = false;
  function startGridDrag(e, li, site) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (mgr.mode !== 'grid') return;
    gridDrag = {
      id: site.id,
      site: site,
      li: li,
      pid: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      isDragging: false,
      initialRect: li.getBoundingClientRect()
    };
    gridPreventClick = false;
    try {
      li.setPointerCapture(e.pointerId);
    } catch (err) {}
  }
    function moveGridDrag(e) {
    if (!gridDrag || gridDrag.pid !== e.pointerId) return;
    const dx = e.clientX - gridDrag.startX;
    const dy = e.clientY - gridDrag.startY;
    if (!gridDrag.isDragging && Math.hypot(dx, dy) > 8) {
      gridDrag.isDragging = true;
      gridPreventClick = true;
      gridDrag.li.classList.add('is-dragging');
      mgr.body.classList.add('arranging');
    }
        if (gridDrag.isDragging) {
        gridDrag.li.style.transform = 'translate(' + dx + 'px, ' + dy + 'px)';
        const box = mgr.body.getBoundingClientRect();
        if (e.clientY < box.top + 40) mgr.body.scrollTop -= 10;
        else if (e.clientY > box.bottom - 40) mgr.body.scrollTop += 10;
                          gridDrag.cell = hexCellAt(e.clientX, e.clientY);
                  showDropGhost(gridDrag.cell);
                }
              }
  function endGridDrag(e) {
    if (!gridDrag) return;
    const wasDragging = gridDrag.isDragging; // A clean pointerup with no drag is a TAP. Because the <li> holds pointer // capture, the browser sends the click to the <li> and never to the tile // <button>, so the tap has to launch the site from here.
    const tappedSite = !wasDragging && e && e.type === 'pointerup' && mgr.pane && mgr.mode === 'grid' ? gridDrag.site : null;
        gridDrag.li.classList.remove('is-dragging');
    gridDrag.li.style.transform = '';
        try {
      gridDrag.li.releasePointerCapture(gridDrag.pid);
    } catch (err) {}
    var dropCell = gridDrag.cell;
    var dragSite = gridDrag.site;
    hideDropGhost();
    mgr.body.classList.remove('arranging');
    gridDrag = null;
    if (wasDragging && mgr.pane && dropCell && e && e.type === 'pointerup') dropSiteOnCell(dragSite, dropCell.r, dropCell.c);
    setTimeout(function () {
      gridPreventClick = false;
    }, 50);
    if (tappedSite) openSite(tappedSite);
  }
  function buildViewRow(site, li) {
    const row = el('div', 'mgr-row');
    const handle = el('div', 'mgr-handle', '\u2261');
    handle.setAttribute('role', 'button');
    handle.setAttribute('aria-label', 'Drag to reorder ' + site.name);
    handle.title = 'Drag to reorder';
    handle.addEventListener('pointerdown', function (e) {
      startReorder(e, handle, li, site);
    });
    handle.addEventListener('pointermove', moveReorder);
    handle.addEventListener('pointerup', function () {
      endReorder(false);
    });
    handle.addEventListener('pointercancel', function () {
      endReorder(true);
    });
    handle.addEventListener('lostpointercapture', function () {
      endReorder(true);
    });
        function startEdit() {
      if (site.gh) return; // GitHub apps are locked
      mgr.editId = site.id;
      mgr.delId = null;
      setMsg('');
      renderMgr();
    }
    const open = el('button', 'mgr-open');
    open.type = 'button';
    open.appendChild(el('span', 'mgr-name', site.name));
    open.appendChild(el('span', 'mgr-url', site.url));
    open.addEventListener('click', startEdit);
    const edit = el('button', 'mgr-btn', 'Edit');
    edit.type = 'button';
    edit.addEventListener('click', startEdit);
    const del = el('button', 'mgr-btn danger', mgr.delId === site.id ? 'Sure?' : 'Delete');
    del.type = 'button';
    del.disabled = state.sites.length < 2;
    del.title = state.sites.length < 2 ? 'You need at least one app' : '';
    del.addEventListener('click', function () {
      if (mgr.delId === site.id) {
        deleteSite(site);
        return;
      }
      mgr.delId = site.id;
      clearTimeout(mgr.delTimer);
            mgr.delTimer = setTimeout(function () {
            mgr.delId = null;
            renderMgr();
          }, 3000);
          renderMgr();
        });
        row.appendChild(handle);
        row.appendChild(open);
        if (!site.gh) {
          row.appendChild(edit);
          row.appendChild(del);
        }
        return row;
      }
      function buildEditRow(site) {
        const wrap = el('div', 'mgr-edit');
    const nameIn = el('input', 'mgr-in');
    nameIn.type = 'text';
    nameIn.value = site.name;
    nameIn.maxLength = 40;
    nameIn.placeholder = 'Name';
    nameIn.setAttribute('aria-label', 'Site name');
    const urlIn = el('input', 'mgr-in');
    urlIn.type = 'text';
    urlIn.value = site.url;
    urlIn.placeholder = 'Address, e.g. aggr.trade';
    urlIn.setAttribute('aria-label', 'Site address');
    urlIn.setAttribute('inputmode', 'url');
    urlIn.setAttribute('autocapitalize', 'off');
    urlIn.setAttribute('autocomplete', 'off');
    urlIn.spellcheck = false;
    const btns = el('div', 'mgr-edit-btns');
    const saveBtn = el('button', 'mgr-btn primary', 'Save');
    saveBtn.type = 'button';
    const cancelBtn = el('button', 'mgr-btn', 'Cancel');
    cancelBtn.type = 'button';
    btns.appendChild(saveBtn);
    btns.appendChild(cancelBtn);
    function save() {
      const url = normalizeUrl(urlIn.value);
      if (!url) {
        setMsg('That address isn’t valid — use https://… or a domain like aggr.trade', true);
        return;
      }
      const changedUrl = url !== site.url;
      site.name = cleanName(nameIn.value, url);
      site.url = url;
      mgr.editId = null;
      if (changedUrl) reloadPanesShowing(site);
      persist();
      setMsg('Saved');
      renderMgr();
    }
    saveBtn.addEventListener('click', save);
    cancelBtn.addEventListener('click', function () {
      mgr.editId = null;
      setMsg('');
      renderMgr();
    });
    [nameIn, urlIn].forEach(function (inp) {
      inp.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          save();
        }
      });
    });
    wrap.appendChild(nameIn);
    wrap.appendChild(urlIn);
    wrap.appendChild(btns);
    setTimeout(function () {
      nameIn.focus();
    }, 0);
    return wrap;
  }
  function renderMgr() {
    if (!mgr.pane) return;
    const s = ps(mgr.pane);
    const editing = mgr.mode === 'edit';
        mgr.grid.hidden = editing;
        mgr.list.hidden = !editing;
        mgr.hint.hidden = !editing;
    mgr.addBox.hidden = editing || !mgr.addCell;
        mgr.title.textContent = editing ? 'Edit apps' : 'Apps';
    mgr.grid.textContent = '';
    mgr.list.textContent = '';
    if (!editing) {
      state.sites.forEach(function (site) {
        var li = el('li');
        li.setAttribute('data-id', site.id);
        var b = el('button', 'mgr-tile' + (site.id === s.active ? ' is-active' : ''));
        b.type = 'button';
        b.title = site.name + ' — ' + site.url;
        b.setAttribute('aria-label', site.name);
        paintHiveFace(b, site);
        b.addEventListener('click', function (e) {
          if (gridPreventClick) {
            e.preventDefault();
            e.stopPropagation();
            return;
          }
                    openSite(site);
            });
            li.addEventListener('pointerdown', function (e) {
              if (e.target.closest && e.target.closest('.mgr-del')) return;
              startGridDrag(e, li, site);
            });
            li.addEventListener('pointermove', moveGridDrag);
            li.addEventListener('pointerup', endGridDrag);
            li.addEventListener('pointercancel', endGridDrag);
            li.addEventListener('lostpointercapture', endGridDrag);
            li.appendChild(b);
            // Delete "x" (only visible while the settings gear panel is open, see CSS)
            var delBtn = el('button', 'mgr-del', '\u2715');
            delBtn.type = 'button';
            delBtn.title = 'Delete ' + site.name;
            delBtn.setAttribute('aria-label', 'Delete ' + site.name);
                        delBtn.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                if (state.sites.length < 2) {
                  setMsg('You need at least one app', true);
                  return;
                }
                deleteSite(site);
              });
              if (!site.gh) li.appendChild(delBtn); // GitHub apps have no delete button
              mgr.grid.appendChild(li);
            });
    } else {
      state.sites.forEach(function (site) {
        const li = el('li', 'mgr-item' + (site.id === s.active ? ' is-active' : ''));
        li.appendChild(site.id === mgr.editId ? buildEditRow(site) : buildViewRow(site, li));
                mgr.list.appendChild(li);
            });
          }
          layoutHive();
          if (mgr.addCell && !editing) showDropGhost(mgr.addCell);
          renderSyncStatus();
        }
        function addSite() {
    if (!mgr.pane) return;
    const url = normalizeUrl(mgr.urlIn.value);
    if (!url) {
      setMsg('Enter a valid address — e.g. aggr.trade or https://example.com', true);
      return;
    }
    if (state.sites.length >= MAX_SITES) {
      setMsg('Limit of ' + MAX_SITES + ' apps', true);
      return;
    }
        var newSite = { id: newId(), name: cleanName(mgr.nameIn.value, url), url: url };
                siteHistory.record(url);
      if (mgr.addCell) {
        // Freeze where everything sits now, then put the new app exactly in the tapped box.
                var curPlaces = hiveEff.places || {};
          var rowsNow = hiveEff.rows;
          state.sites.forEach(function (s) {
            var pl = curPlaces[s.id];
            if (pl) {
              s.pr = rowsNow - 1 - pl.r;
              s.pc = pl.c;
            }
          });
          newSite.pr = rowsNow - 1 - mgr.addCell.r;
          newSite.pc = mgr.addCell.c;
        }
      state.sites.push(newSite);
      mgr.nameIn.value = '';
      mgr.urlIn.value = '';
      mgr.addCell = null;
      mgr.addBox.hidden = true;
      hideDropGhost();
      persist();
      setMsg('Added');
      renderMgr();
    }
    $('mgrAddBtn').addEventListener('click', addSite);
    [mgr.nameIn, mgr.urlIn].forEach(function (inp) {
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        addSite();
      }
    });
  });
  // ── Add an app straight into a grid box: tap an empty box ──
    function setAddCell(cell) {
    mgr.addCell = cell;
    mgr.addBox.hidden = !cell;
    if (cell) {
      showDropGhost(cell);
      setTimeout(function () {
        mgr.urlIn.focus();
      }, 0);
    } else {
      hideDropGhost();
    }
  }
  mgr.grid.addEventListener('click', function (e) {
    // Only taps on empty space land here (app tiles handle their own taps).
    if (e.target !== mgr.grid || mgr.mode !== 'grid' || !hiveEff.w) return;
    mgr.panel.hidden = true;
    var g = mgr.grid.getBoundingClientRect();
        var c = Math.floor((e.clientX - g.left) / hiveEff.w);
      var r = Math.floor((e.clientY - g.top) / hiveEff.h);
      if (c < 0 || c >= hiveEff.cols || r < 0 || r >= hiveEff.rows) return;
            if (mgr.addCell && mgr.addCell.r === r && mgr.addCell.c === c) {
          setAddCell(null);
          return;
        }
        setAddCell({ r: r, c: c });
      });
    $('mgrAddCancel').addEventListener('click', function () {
      setAddCell(null);
    });
  // Floating settings button (bottom right)
  mgr.fab.addEventListener('click', function (e) {
    e.stopPropagation();
    mgr.panel.hidden = !mgr.panel.hidden;
  });
  // Close the popup as soon as you tap anywhere outside it (other pane, divider, taskbar...)
  document.addEventListener(
    'pointerdown',
    function (e) {
      if (!mgrIsOpen() || mgr.el.contains(e.target)) return;
      if (Date.now() - mgr.openedAt < 400) return;
      if (mgr.drag || gridDrag) return;
      closeManager();
    },
    true
  );
  document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape' || !mgrIsOpen()) return;
    if (mgr.addCell) {
      setAddCell(null);
      return;
    }
    if (!mgr.panel.hidden) {
      mgr.panel.hidden = true;
      return;
    }
    if (mgr.editId) {
      mgr.editId = null;
      setMsg('');
      renderMgr();
    } else if (mgr.mode === 'edit') setMode('grid');
    else closeManager();
  });
  window.addEventListener('message', function (event) {
    const pane = paneFromSource(event.source);
    if (!pane) return;
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.splitViewTap === true || data.splitViewMenu === true) setFocus(pane.key);
    if (data.splitViewTap === true) closeTileMenu();
    if (data.splitViewReady === true) {
      markReady(pane);
      return;
    }
    // A tap inside a framed page = tap outside the popup → close it
        if (data.splitViewTap === true) {
      if (mgrIsOpen() && Date.now() - mgr.openedAt > 400) closeManager();
      return;
    }
    // Double tap / double click no longer opens the apps menu
    if (data.splitViewMenu === true) {
      return;
    }
    // ── AI loop bridge: content-ai.js (AI pane) <-> tool pane ──
        if (data.aiPaneReady === true) {
          window.__aiPaneKey = pane.key;
          if (window.__nutsMode === true) {
            try { pane.view.contentWindow.postMessage({ nutsMode: true }, '*'); } catch (e) {}
          }
          return;
        }
        if (typeof data.nutsMode === 'boolean') {
          window.__nutsMode = data.nutsMode;
          var nutsTargets = visibleKeys().map(function (k) { return panes[k]; }).filter(function (o) {
            return o !== pane && o.view && o.view.contentWindow;
          });
          if (window.__aiPaneKey && panes[window.__aiPaneKey] && panes[window.__aiPaneKey] !== pane) nutsTargets = [panes[window.__aiPaneKey]];
          nutsTargets.forEach(function (o) {
            try { o.view.contentWindow.postMessage({ nutsMode: data.nutsMode }, '*'); } catch (e) {}
          });
          return;
        }
        // Clipboard helper for the patch tool: its pane cannot touch the clipboard while you are in the AI pane, this page can.
        // Only the tool's own site (EXT_TOOL_ORIGIN) may use it.
        if (typeof data.copyToClipboard === 'string' || data.readClipboard === true) {
          var EXT_TOOL_ORIGIN = 'https://888znq.github.io';
          var cbReply = function (m) { try { pane.view.contentWindow.postMessage(m, '*'); } catch (e) {} };
          if (event.origin !== EXT_TOOL_ORIGIN) {
            cbReply(data.readClipboard === true ? { clipboardError: true, why: 'origin ' + event.origin + ' not allowed' } : { copyResult: false, why: 'origin ' + event.origin + ' not allowed' });
            return;
          }
          if (data.readClipboard === true) {
            navigator.clipboard.readText().then(function (t) { cbReply({ clipboardText: t || '' }); }, function (er) { cbReply({ clipboardError: true, why: String((er && er.message) || er) }); });
          } else {
            var cbText = data.copyToClipboard;
            navigator.clipboard.writeText(cbText).then(function () { cbReply({ copyResult: true }); }, function (er) {
              var ok = false;
              try {
                var ta = document.createElement('textarea');
                ta.value = cbText;
                ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
                document.body.appendChild(ta);
                ta.select();
                ok = document.execCommand('copy');
                ta.remove();
              } catch (e2) {}
              cbReply({ copyResult: ok, why: ok ? '' : String((er && er.message) || er) });
            });
          }
          return;
        }
        if (typeof data.aiReply === 'string' || typeof data.sendToAI === 'string') {
          var fromAi = typeof data.aiReply === 'string';
          if (fromAi) window.__aiPaneKey = pane.key;
          if (!fromAi && window.AI_AUTO_PASTE !== true && data.nuts !== true) return;   // tool -> AI auto-paste is OFF: you paste into the AI yourself
          var aiTargets = visibleKeys().map(function (k) { return panes[k]; }).filter(function (o) {
            return o !== pane && o.view && o.view.contentWindow;
          });
          if (!fromAi && window.__aiPaneKey && panes[window.__aiPaneKey] && panes[window.__aiPaneKey] !== pane) {
            aiTargets = [panes[window.__aiPaneKey]];
          }
          aiTargets.forEach(function (o) {
            try {
              o.view.contentWindow.postMessage(fromAi ? { aiReply: data.aiReply, aiCode: data.aiCode || [], aiFinal: data.aiFinal === true } : { sendToAI: data.sendToAI, nuts: data.nuts === true }, '*');
            } catch (e) {}
          });
          return;
        }
        var tradeMsg = data.trinityOS_trade;
                if (tradeMsg && typeof tradeMsg === 'object') {
                  var tPair = String(tradeMsg.pair || '').trim();
                  var tAmt = Number(tradeMsg.amount);
                  if (!/^[A-Za-z0-9]{3,12}$/.test(tPair) || !isFinite(tAmt) || tAmt <= 0 || (tradeMsg.direction !== 'buy' && tradeMsg.direction !== 'sell')) return;
                  var tTargets = visibleKeys()
                    .map(function (k) {
                      return panes[k];
                    })
                    .filter(function (o) {
                      return o !== pane && o.view && o.view.contentWindow;
                    });
                  if (!tTargets.length) {
                    devLog('RELAY', 'no target pane for trade ' + tPair);
                    return;
                  }
                  tTargets.forEach(function (other) {
                    devLog('RELAY', 'TRADE ' + tradeMsg.direction + ' ' + tPair + ' ' + pane.key + ' -> ' + other.key);
                    try {
                      other.view.contentWindow.postMessage({ trinityOS_trade: { pair: tPair, amount: tAmt, direction: tradeMsg.direction } }, '*');
                    } catch (e) {}
                  });
                  return;
                }
                const pair = data.trinityOS_pair;
    if (typeof pair !== 'string' || !/^[A-Za-z0-9]{3,12}$/.test(pair.trim())) return; // Relay to the OTHER pane, whatever site it is (GitHub site, OlympTrade, ...).
    const relayKeys = visibleKeys();
    const targets = relayKeys
      .map(function (k) {
        return panes[k];
      })
      .filter(function (o) {
        return o !== pane && o.view && o.view.contentWindow;
      });
    if (!targets.length) {
      devLog('RELAY', 'no target pane for ' + pair);
      return;
    }
    targets.forEach(function (other) {
      devLog('RELAY', pair.trim() + ' ' + pane.key + ' -> ' + other.key);
      try {
        other.view.contentWindow.postMessage({ trinityOS_pair: pair.trim() }, '*');
      } catch (e) {}
    });
    });
      async function installFrameRule() {
      try {
        if (!chrome || !chrome.tabs || !chrome.tabs.getCurrent || !chrome.declarativeNetRequest || !chrome.declarativeNetRequest.updateSessionRules) return;
        var tab = await chrome.tabs.getCurrent();
        var strip = {
          type: 'modifyHeaders',
          responseHeaders: [
            { header: 'X-Frame-Options', operation: 'remove' },
            { header: 'Content-Security-Policy', operation: 'remove' },
            { header: 'Content-Security-Policy-Report-Only', operation: 'remove' }
          ]
        };
        var tabCond = tab && tab.id != null
          ? { tabIds: [tab.id], resourceTypes: ['sub_frame'] }
          : { initiatorDomains: [chrome.runtime.id], resourceTypes: ['sub_frame'] };
        await chrome.declarativeNetRequest.updateSessionRules({
          removeRuleIds: [SESSION_RULE_ID, SESSION_RULE_ID_SW],
          addRules: [
            {
              id: SESSION_RULE_ID,
              priority: 2,
              action: strip,
              condition: tabCond
            },
            {
              id: SESSION_RULE_ID_SW,
              priority: 2,
              action: strip,
              condition: { tabIds: [-1], resourceTypes: ['sub_frame', 'xmlhttprequest', 'other'] }
            }
          ]
        });
      } catch (e) {
        console.warn('[SPLIT] frame rule failed', e);
      }
    }
    function applyRemote(raw) {
    const remote = normalizeState(raw);
    if (!remote || remote.ts <= state.ts || dirty || dragging || gridDrag) return;
    const before = visibleKeys();
    state.layout = remote.layout;
    state.sites = remote.sites;
    PANE_KEYS.forEach(function (k) {
      const rp = remote.panes[k];
      if (!rp) return;
      // a pane that was not open yet takes the site the other device had in it
      if (!hasSrc(panes[k])) state.panes[k].active = rp.active;
      state.panes[k].zoom = rp.zoom;
    });
    const now = visibleKeys();
    before.forEach(function (k) {
      if (now.indexOf(k) < 0) retirePane(k);
    });
    applyStateToUI();
    now.forEach(function (k) {
      if (hasSrc(panes[k]) && !findSite(state.panes[k].active)) loadSite(panes[k], state.sites[0], { persist: false });
    });
    ensureLoaded();
    state.ts = remote.ts;
    writeLocal();
    if (mgrIsOpen() && !mgr.drag && !gridDrag) renderMgr();
  }
    // ════════ GitHub auto-sync ════════
    // Every GitHub Pages repo of GH_USER is an app. They are locked: no delete / edit here.
    // They disappear only when the repo (or its Pages site) is removed on GitHub.
    const GH_USER = '888znq';
    const GH_HOST = GH_USER.toLowerCase() + '.github.io';
    const GH_SYNC_MS = 10 * 60 * 1000;
    const GH_MIN_GAP_MS = 3 * 60 * 1000;
    const GH_INIT_KEY = 'split-view:gh-init:v1';
    let ghBusy = false;
    let ghLast = 0;
    function ghUrl(name) {
      if (name.toLowerCase() === GH_HOST) return 'https://' + GH_HOST + '/';
      return 'https://' + GH_HOST + '/' + encodeURIComponent(name) + '/';
    }
    function ghIsUrl(url) {
      try {
        return new URL(url).hostname.toLowerCase() === GH_HOST;
      } catch (e) {
        return false;
      }
    }
    function ghKey(url) {
      try {
        const u = new URL(url);
        return u.hostname.toLowerCase() + u.pathname.replace(/\/+$/, '').toLowerCase();
      } catch (e) {
        return String(url || '').toLowerCase();
      }
    }
    async function ghFetchRepos() {
      let all = [];
      for (let page = 1; page <= 10; page++) {
        const res = await fetch('https://api.github.com/users/' + GH_USER + '/repos?per_page=100&page=' + page, { cache: 'no-store' });
        if (!res.ok) throw new Error('GitHub ' + res.status);
        const list = await res.json();
        if (!Array.isArray(list)) throw new Error('GitHub: bad response');
        all = all.concat(list);
        if (list.length < 100) break;
      }
      // Only repos with GitHub Pages enabled
      return all.filter(function (r) {
        return r && r.name && r.has_pages;
      });
    }
    function ghSlug(name, used) {
      const base = 'gh_' + name.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 34);
      let id = base;
      let n = 2;
      while (used[id]) id = base + '_' + n++;
      used[id] = true;
      return id;
    }
    function ghSig() {
      return state.sites
        .map(function (s) {
          return s.id + '|' + (s.gh ? 1 : 0) + '|' + s.name + '|' + s.url;
        })
        .join('\n');
    }
    async function ghSync(force) {
      if (ghBusy || (!force && Date.now() - ghLast < GH_MIN_GAP_MS)) return;
      ghBusy = true;
      try {
        const repos = await ghFetchRepos();
        if (mgr.drag || gridDrag) return; // busy dragging: try again on the next tick
        const want = {};
        const order = [];
        repos.forEach(function (r) {
          const url = ghUrl(r.name);
          const k = ghKey(url);
          if (!want[k]) {
            want[k] = { name: r.name, url: url };
            order.push(k);
          }
        });
        const before = ghSig();
        const seen = {};
        const removed = [];
        let kept = [];
        state.sites.forEach(function (s) {
          if (!(s.gh || ghIsUrl(s.url))) {
            kept.push(s);
            return;
          }
          const k = ghKey(s.url);
          if (want[k] && !seen[k]) {
            seen[k] = true;
            s.gh = true;
            s.name = want[k].name;
            s.url = want[k].url;
            kept.push(s);
          } else removed.push(s); // repo deleted / Pages turned off on GitHub
        });
        const used = {};
        kept.forEach(function (s) {
          used[s.id] = true;
        });
        let at = -1;
        kept.forEach(function (s, i) {
          if (s.gh) at = i;
        });
        order.forEach(function (k) {
          if (seen[k]) return;
          at++;
          kept.splice(at, 0, { id: ghSlug(want[k].name, used), name: want[k].name, url: want[k].url, gh: true });
        });
        // One time: GitHub apps go first = bottom rows of the grid
        if (!safeGet(GH_INIT_KEY)) {
          kept = kept
            .filter(function (s) {
              return s.gh;
            })
            .concat(
              kept.filter(function (s) {
                return !s.gh;
              })
            );
          safeSet(GH_INIT_KEY, '1');
        }
        if (!kept.length) return;
        state.sites = kept;
        ghLast = Date.now();
        if (ghSig() !== before) {
          removed.forEach(function (s) {
            reloadPanesShowing(s, kept[0]);
          });
          persist();
                    if (mgrIsOpen() && !mgr.drag && !gridDrag) renderMgr();
            }
          } catch (e) {
            // offline / rate limited: keep the current list untouched
            devLog('ERROR', 'GitHub sync failed: ' + (e && e.message ? e.message : e));
          } finally {
            ghBusy = false;
          }
    }
    // ════════ USER SWITCHER (like Chrome profiles): every user has its own cookies for every site ════════
        var USR_KEY = 'split-view:users:v1';
        var USR_JAR = 'split-view:jar:';
        var USR_DOM_KEY = 'split-view:udomains:v1';
        var USR_PP = 'split-view:usrpp';
        var USR_PP_SKIP = 'split-view:usrpp-skip';
        var USR_MAX = 20;
        var USR_SESSION_DAYS = 180;
        var usrBusy = false;
        var usrKey = null;
        var usrReady = false;
        var usrEditEl = null;
        var usrHeld = false;
        var usrSaveTimer = 0;

        function usrDefaultUser() {
          return { id: 'default', name: 'Default', color: 'hsl(220 65% 45%)' };
        }
        // The default user is always first and always exists.
        function usrFixList(list) {
          var seen = {};
          var out = [];
          (Array.isArray(list) ? list : []).forEach(function (u) {
            if (!u || typeof u.id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(u.id) || seen[u.id]) return;
            seen[u.id] = true;
            out.push({
              id: u.id,
              name: String(u.name || 'User').slice(0, 40),
              color: typeof u.color === 'string' && /^[#\w(),.% -]{3,40}$/.test(u.color) ? u.color : 'hsl(220 65% 45%)'
            });
          });
          var di = out.findIndex(function (u) { return u.id === 'default'; });
          var def = di >= 0 ? out.splice(di, 1)[0] : usrDefaultUser();
          out.unshift(def);
          return out.slice(0, USR_MAX);
        }
        function usrLoad() {
          var o = null;
          try { o = JSON.parse(safeGet(USR_KEY) || 'null'); } catch (e) {}
          var u = { v: 1, ts: Number(o && o.ts) || 0, active: o && typeof o.active === 'string' ? o.active : 'default', list: usrFixList(o && o.list) };
          if (!u.list.some(function (x) { return x.id === u.active; })) u.active = 'default';
          return u;
        }
        var usr = usrLoad();
        function usrSave() {
          safeSet(USR_KEY, JSON.stringify(usr));
        }
        function usrFind(id) {
          for (var i = 0; i < usr.list.length; i++) if (usr.list[i].id === id) return usr.list[i];
          return null;
        }
        function usrLoadJar(id) {
          try {
            var j = JSON.parse(safeGet(USR_JAR + id) || 'null');
            if (j && Array.isArray(j.c)) return { ts: Number(j.ts) || 0, c: j.c };
          } catch (e) {}
          return { ts: 0, c: [] };
        }
        function usrStoreJar(id, jar) {
          safeSet(USR_JAR + id, JSON.stringify(jar));
        }

        // ── which sites to manage: your apps, every page a pane has loaded, and anything already in a saved jar ──
        function usrReg(h) {
          if (/\.github\.io$/.test(h)) return h;
          var p = h.split('.');
          var n = p.length;
          if (n <= 2) return h;
          var cut = p[n - 1].length === 2 && /^(co|com|org|net|gov|edu|ac)$/.test(p[n - 2]) ? 3 : 2;
          return p.slice(n - cut).join('.');
        }
        function usrDomOf(url) {
          try {
            var h = new URL(String(url)).hostname.toLowerCase();
            if (!h || h.indexOf('.') < 0 || h.indexOf(':') >= 0 || /^[\d.]+$/.test(h)) return '';
            return usrReg(h);
          } catch (e) {
            return '';
          }
        }
        var usrDomains = (function () {
          try {
            var a = JSON.parse(safeGet(USR_DOM_KEY) || '[]');
            return Array.isArray(a) ? a : [];
          } catch (e) {
            return [];
          }
        })();
        function usrNoteHost(url) {
          var d = usrDomOf(url);
          if (d && usrDomains.indexOf(d) < 0) {
            usrDomains.push(d);
            safeSet(USR_DOM_KEY, JSON.stringify(usrDomains.slice(-300)));
          }
        }
        function usrJarDomains(jar) {
          var out = [];
          (jar.c || []).forEach(function (r) {
            var d = usrReg(String(r.d || '').replace(/^\./, '').toLowerCase());
            if (d && d.indexOf('.') > 0 && out.indexOf(d) < 0) out.push(d);
          });
          return out;
        }
        function usrHostsNow(extra) {
          var out = [];
          function add(d) {
            if (d && out.indexOf(d) < 0) out.push(d);
          }
          usrDomains.forEach(add);
          (state.sites || []).forEach(function (s) { add(usrDomOf(s.url)); });
          PANE_KEYS.forEach(function (k) {
            try { add(usrDomOf(panes[k].view.getAttribute('src') || '')); } catch (e) {}
          });
          (extra || []).forEach(add);
          return out;
        }

        // ── cookies ──
        async function usrRead(domains) {
          var seen = {};
          var out = [];
          for (var i = 0; i < domains.length; i++) {
            var list = [];
            try { list = await chrome.cookies.getAll({ domain: domains[i] }); } catch (e) {}
            list.forEach(function (c) {
              if (c.partitionKey) return;
              var k = c.name + '|' + c.domain + '|' + c.path;
              if (seen[k]) return;
              seen[k] = 1;
              out.push(c);
            });
          }
          return out;
        }
        function usrPicks(raw) {
          return raw
            .map(function (c) {
              return { n: c.name, v: c.value, d: c.domain, p: c.path, s: c.secure ? 1 : 0, h: c.httpOnly ? 1 : 0, o: c.hostOnly ? 1 : 0, ss: c.sameSite || '', e: c.session ? 0 : c.expirationDate || 0 };
            })
            .sort(function (a, b) {
              var x = a.d + '|' + a.p + '|' + a.n;
              var y = b.d + '|' + b.p + '|' + b.n;
              return x < y ? -1 : x > y ? 1 : 0;
            });
        }
        function usrRemoveAll(raw) {
          return Promise.all(
            raw.map(function (c) {
              var url = (c.secure ? 'https' : 'http') + '://' + String(c.domain).replace(/^\./, '') + (c.path || '/');
              return chrome.cookies.remove({ url: url, name: c.name }).catch(function () { return null; });
            })
          );
        }
        function usrSetOne(r, now) {
          var host = String(r.d || '').replace(/^\./, '');
          if (!host || !r.n) return Promise.resolve(null);
          var det = { url: (r.s ? 'https' : 'http') + '://' + host + (r.p || '/'), name: r.n, value: r.v || '', path: r.p || '/', secure: !!r.s, httpOnly: !!r.h };
          if (!r.o) det.domain = r.d;
          var ss = r.ss;
          if (ss === 'no_restriction' && !r.s) ss = 'unspecified';
          if (ss) det.sameSite = ss;
          det.expirationDate = r.e && r.e > now ? r.e : now + USR_SESSION_DAYS * 86400; // logins last: session cookies become long-lived
          return chrome.cookies.set(det).catch(function () { return null; });
        }
        async function usrInstall(jar) {
          var now = Date.now() / 1000;
          await Promise.all(
            (jar.c || []).filter(function (r) { return !(r.e && r.e <= now); }).map(function (r) { return usrSetOne(r, now); })
          );
        }
        async function usrReplaceWith(jar) {
          var raw = await usrRead(usrHostsNow(usrJarDomains(jar)));
          await usrRemoveAll(raw);
          await usrInstall(jar);
        }
        function usrReloadPanes() {
          visibleKeys().forEach(function (k) {
            var p = panes[k];
            var s = p.view.getAttribute('src');
            if (s && s !== 'about:blank') p.view.src = s;
          });
        }

        // ── saving the active user's cookies on this device (and to Firebase, encrypted) ──
        async function usrSaveActive(force) {
          if (usrBusy || typeof chrome === 'undefined' || !chrome.cookies) return;
          var id = usr.active;
          if (!usrFind(id)) return;
          var old = usrLoadJar(id);
          var raw = await usrRead(usrHostsNow(usrJarDomains(old)));
          var picks = usrPicks(raw);
          if (!force && JSON.stringify(picks) === JSON.stringify(old.c)) return;
          var jar = { ts: Date.now(), c: picks };
          usrStoreJar(id, jar);
          usrPushJar(id, jar);
        }

        // ── encryption: AES-256-GCM, key from your passphrase (PBKDF2) ──
        function usrB64(buf) {
          var b = new Uint8Array(buf);
          var s = '';
          for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
          return btoa(s);
        }
        function usrUnb64(s) {
          var b = atob(s);
          var u = new Uint8Array(b.length);
          for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
          return u;
        }
        async function usrDeriveKey(pass, saltB64) {
          var base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
          return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: usrUnb64(saltB64), iterations: 310000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
        }
        async function usrEnc(key, obj) {
          var iv = crypto.getRandomValues(new Uint8Array(12));
          var ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
          return { iv: usrB64(iv), ct: usrB64(ct) };
        }
        async function usrDec(key, blob) {
          var pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: usrUnb64(blob.iv) }, key, usrUnb64(blob.ct));
          return JSON.parse(new TextDecoder().decode(pt));
        }

        // ── Firebase: encrypted jars, encrypted user list ──
        async function usrPushJar(id, jar) {
          var S = window.SplitSync;
          if (!usrKey || !S || !S.usrPut) return;
          try {
            var blob = await usrEnc(usrKey, jar);
            blob.ts = jar.ts;
            await S.usrPut('-jars/' + id, blob);
          } catch (e) {
            devLog('ERROR', 'user jar upload failed: ' + (e && e.message ? e.message : e));
          }
        }
        // true when a newer copy from another device replaced the local one
        async function usrPullJar(id) {
          var S = window.SplitSync;
          if (!usrKey || !S || !S.usrGet) return false;
          var remote = await S.usrGet('-jars/' + id, 6000);
          if (!remote || !remote.ct) return false;
          var local = usrLoadJar(id);
          if ((remote.ts || 0) <= local.ts) return false;
          try {
            var jar = await usrDec(usrKey, remote);
            if (!jar || !Array.isArray(jar.c)) return false;
            jar.ts = remote.ts;
            usrStoreJar(id, jar);
            return true;
          } catch (e) {
            devLog('ERROR', 'user jar decrypt failed: ' + (e && e.message ? e.message : e));
            return false;
          }
        }
        async function usrPushList() {
          var S = window.SplitSync;
          if (!usrKey || !S || !S.usrPut) return;
          try {
            var blob = await usrEnc(usrKey, { list: usr.list });
            blob.ts = usr.ts;
            await S.usrPut('-users', blob);
          } catch (e) {}
        }
        async function usrPullList() {
          var S = window.SplitSync;
          if (!usrKey || !S || !S.usrGet) return;
          var r = await S.usrGet('-users', 6000);
          if (r === undefined) return;
          if (!r || !r.ct) {
            await usrPushList();
            return;
          }
          if ((r.ts || 0) <= usr.ts) {
            if ((r.ts || 0) < usr.ts) await usrPushList();
            return;
          }
          var d = await usrDec(usrKey, r);
          var list = usrFixList(d && d.list);
          var gone = usr.list.filter(function (u) {
            return !list.some(function (x) { return x.id === u.id; });
          });
          usr.list = list;
          usr.ts = r.ts;
          gone.forEach(function (u) {
            try { localStorage.removeItem(USR_JAR + u.id); } catch (e) {}
          });
          usrSave();
          usrPaint();
          if (!usrFind(usr.active)) await usrSwitchTo('default');
        }
        async function usrPushOthers() {
          var S = window.SplitSync;
          if (!usrKey || !S || !S.usrGet) return;
          for (var i = 0; i < usr.list.length; i++) {
            var u = usr.list[i];
            if (u.id === usr.active) continue;
            var jar = usrLoadJar(u.id);
            if (!jar.ts) continue;
            var rem = await S.usrGet('-jars/' + u.id, 6000);
            if (rem === undefined) return;
            if (!rem || (rem.ts || 0) < jar.ts) await usrPushJar(u.id, jar);
          }
        }
        async function usrAskPass(force) {
          var pp = safeGet(USR_PP) || '';
          if (pp && !force) return pp;
          if (!force && safeGet(USR_PP_SKIP) === '1') return '';
          var v = window.prompt('Passphrase to encrypt your logins and sync them to Firebase.\nUse 4 or more random words. Type the same one on every device:', '');
          if (v === null) {
            safeSet(USR_PP_SKIP, '1');
            return '';
          }
          v = v.trim();
          if (v.length < 8) {
            showToast('Passphrase needs at least 8 characters');
            return '';
          }
          safeSet(USR_PP, v);
          try { localStorage.removeItem(USR_PP_SKIP); } catch (e) {}
          return v;
        }
        async function usrSyncStart(force) {
          var S = window.SplitSync;
          if (!S || !S.usrGet || !window.crypto || !crypto.subtle) return false;
          var pp = await usrAskPass(force);
          if (!pp) return false;
          var meta = await S.usrGet('-jars-meta', 6000);
          if (meta === undefined) {
            showToast('Sync offline: logins are saved on this device');
            return false;
          }
          var key;
          if (meta && meta.salt && meta.check) {
            key = await usrDeriveKey(pp, meta.salt);
            try {
              var ok = await usrDec(key, meta.check);
              if (!ok || ok.ok !== 1) throw new Error('bad');
            } catch (e) {
              showToast('Wrong sync passphrase. Hold the user button and tap the key to enter it again');
              try { localStorage.removeItem(USR_PP); } catch (e2) {}
              return false;
            }
          } else {
            var salt = usrB64(crypto.getRandomValues(new Uint8Array(16)));
            key = await usrDeriveKey(pp, salt);
            var chk = await usrEnc(key, { ok: 1 });
            await S.usrPut('-jars-meta', { salt: salt, check: chk });
          }
          usrKey = key;
          return true;
        }
        async function usrBoot(force) {
          try {
            if (typeof chrome === 'undefined' || !chrome.cookies) return;
            if (await usrSyncStart(force)) {
              await usrPullList();
              if (await usrPullJar(usr.active)) await usrReplaceWith(usrLoadJar(usr.active));
              await usrPushOthers();
              usrPaint();
              if (force) showToast('User sync is on');
            }
          } catch (e) {
            devLog('ERROR', 'user sync failed: ' + (e && e.message ? e.message : e));
          }
          usrReady = true;
          usrSaveActive(false);
        }

        // ── switching ──
        async function usrSwitchTo(id) {
          if (usrBusy || id === usr.active || !usrFind(id)) return;
          if (typeof chrome === 'undefined' || !chrome.cookies) {
            showToast('Users need the cookies permission: reload the extension');
            return;
          }
          usrBusy = true;
          try {
            var from = usr.active;
            await usrPullJar(id); // newest copy from your other devices
            var toJar = usrLoadJar(id);
            var raw = await usrRead(usrHostsNow(usrJarDomains(toJar).concat(usrJarDomains(usrLoadJar(from)))));
            if (usrFind(from)) {
              var jar = { ts: Date.now(), c: usrPicks(raw) };
              usrStoreJar(from, jar);
              usrPushJar(from, jar);
            }
            await usrRemoveAll(raw);
            await usrInstall(toJar);
            usr.active = id;
            usrSave();
            usrPaint();
            usrReloadPanes();
            showToast('User: ' + usrFind(id).name);
          } catch (e) {
            devLog('ERROR', 'user switch failed: ' + (e && e.message ? e.message : e));
            showToast('Could not switch user');
          } finally {
            usrBusy = false;
          }
        }
        async function usrAdd() {
          usrCloseEditor(true);
          if (usrBusy) return;
          if (usr.list.length >= USR_MAX) {
            showToast('Limit of ' + USR_MAX + ' users');
            return;
          }
          var id = 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
          var hue = (usr.list.length * 67 + 200) % 360;
          usr.list.push({ id: id, name: 'User ' + usr.list.length, color: 'hsl(' + hue + ' 65% 42%)' });
          usr.ts = Date.now();
          usrSave();
          usrPushList();
          await usrSwitchTo(id);
          if (usr.active === id) usrOpenEditor();
        }
        async function usrRemove(id) {
          if (id === 'default' || !usrFind(id)) return;
          if (usr.active === id) await usrSwitchTo('default');
          if (usr.active === id) return;
          usr.list = usr.list.filter(function (u) { return u.id !== id; });
          usr.ts = Date.now();
          usrSave();
          try { localStorage.removeItem(USR_JAR + id); } catch (e) {}
          var S = window.SplitSync;
          if (S && S.usrPut) S.usrPut('-jars/' + id, null);
          usrPushList();
          usrPaint();
          showToast('User removed');
        }

        // ── taskbar button + hold-to-edit box ──
        function usrPaint() {
          var u = usrFind(usr.active) || usr.list[0];
          var dot = $('usrDot');
          var btn = $('usrBtn');
          if (!dot || !btn || !u) return;
          dot.textContent = (u.name.trim().charAt(0) || '?').toUpperCase();
          dot.style.background = u.color;
          btn.title = 'User: ' + u.name + ' \u00b7 click = next user \u00b7 hold = rename / remove';
          btn.setAttribute('aria-label', 'User: ' + u.name);
        }
        function usrCloseEditor(commit) {
          if (!usrEditEl) return;
          var box = usrEditEl;
          usrEditEl = null;
          if (commit) {
            var inp = box.querySelector('input');
            var u = usrFind(box.getAttribute('data-id'));
            var v = inp ? inp.value.trim().slice(0, 40) : '';
            if (u && v && v !== u.name) {
              u.name = v;
              usr.ts = Date.now();
              usrSave();
              usrPushList();
              usrPaint();
            }
          }
          box.remove();
        }
        function usrOpenEditor() {
          usrCloseEditor(true);
          var u = usrFind(usr.active);
          if (!u) return;
          var box = document.createElement('div');
          box.className = 'usr-edit';
          box.setAttribute('data-id', u.id);
          var inp = document.createElement('input');
          inp.type = 'text';
          inp.maxLength = 40;
          inp.value = u.name;
          inp.spellcheck = false;
          inp.setAttribute('aria-label', 'User name');
          inp.addEventListener('keydown', function (e) {
            e.stopPropagation();
            if (e.key === 'Enter') {
              usrCloseEditor(true);
              e.preventDefault();
            } else if (e.key === 'Escape') usrCloseEditor(false);
          });
          box.appendChild(inp);
          var keyBtn = document.createElement('button');
          keyBtn.type = 'button';
          keyBtn.textContent = '\uD83D\uDD11';
          keyBtn.title = 'Sync passphrase';
          keyBtn.addEventListener('click', function () {
            usrCloseEditor(true);
            usrBoot(true);
          });
          box.appendChild(keyBtn);
          if (u.id !== 'default') {
            var del = document.createElement('button');
            var armed = false;
            del.type = 'button';
            del.textContent = '\u00d7';
            del.title = 'Remove this user';
            del.addEventListener('click', function () {
              if (!armed) {
                armed = true;
                del.textContent = 'Sure?';
                setTimeout(function () {
                  armed = false;
                  del.textContent = '\u00d7';
                }, 3000);
                return;
              }
              usrCloseEditor(false);
              usrRemove(u.id);
            });
            box.appendChild(del);
          }
          document.body.appendChild(box);
          usrEditEl = box;
          inp.focus();
          inp.select();
        }
        function userSwitcherInit() {
          var btn = $('usrBtn');
          var add = $('usrAdd');
          if (!btn || !add) return;
          usrPaint();
          attachLongPress(btn, function () {
            usrHeld = true;
            setTimeout(function () { usrHeld = false; }, 1500);
            usrOpenEditor();
          });
          function clickUser() {
            if (usrHeld) {
              usrHeld = false;
              return;
            }
            usrCloseEditor(true);
            if (usr.list.length < 2) {
              showToast('Tap + to add another user');
              return;
            }
            var i = usr.list.findIndex(function (u) { return u.id === usr.active; });
            usrSwitchTo(usr.list[(i + 1) % usr.list.length].id);
          }
          btn.addEventListener('click', clickUser);
          add.addEventListener('click', usrAdd);
          [btn, add].forEach(function (b) {
            b.addEventListener('keydown', function (e) {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                b.click();
              }
            });
          });
          document.addEventListener(
            'pointerdown',
            function (e) {
              if (usrEditEl && !usrEditEl.contains(e.target) && !btn.contains(e.target)) usrCloseEditor(true);
            },
            true
          );
          PANE_KEYS.forEach(function (k) {
            panes[k].view.addEventListener('load', function () {
              usrNoteHost(panes[k].view.getAttribute('src') || '');
              clearTimeout(usrSaveTimer);
              usrSaveTimer = setTimeout(function () {
                if (usrReady) usrSaveActive(false);
              }, 20000);
            });
          });
          document.addEventListener('visibilitychange', function () {
            if (document.hidden && usrReady) usrSaveActive(false);
          });
          setInterval(function () {
            if (usrReady) usrSaveActive(false);
          }, 4 * 60 * 1000);
          usrBoot(false);
        }
        function startGithubSync() {
      ghSync(true);
      setInterval(function () {
        ghSync(false);
      }, GH_SYNC_MS);
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden) ghSync(false);
      });
    }
        async function init() {
      uiReady = true;
      // LOCAL ONLY: no Firebase load and no live subscription. State was read from localStorage at startup.
            await installFrameRule();
      followOrientation(true);
      renderLayout();
      ensureLoaded();
      startGithubSync();
            userSwitcherInit();
    }
  init();
  // ════════ AI COMPILE & PATCH WORKSPACE ENGINE ════════
  let devWorkspace = {};
  let devDirHandle = null;
  let modifiedFilesToSave = new Set();
  const $devBar = $('dev-bar');
  const $devToast = $('dev-toast');
  const $folderInput = $('dev-folder-input');
    function devToast(msg, dur = 2500) {
    devLog('TOAST', msg);
    if (!$devToast) return;
    $devToast.textContent = msg;
    $devToast.classList.add('show');
    setTimeout(() => $devToast.classList.remove('show'), dur);
  }
    function devCopyText(text, done) {
    const fallback = function () {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        done(true);
      } catch (e) {
        done(false);
      }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, fallback);
    } else {
      fallback();
    }
  }
  // Pop-out error box (sits just above the bottom patch bar): shows the error with a Copy button
  function devErrPopup(title, text) {
    try {
      let box = document.getElementById('dev-err-popup');
      if (!box) {
        box = document.createElement('div');
        box.id = 'dev-err-popup';
        box.style.cssText = 'position:fixed;right:8px;bottom:64px;z-index:2147483600;width:min(520px,calc(100vw - 16px));' +
          'box-sizing:border-box;padding:8px;background:#000432;color:#ffffff;border:1px solid #ffffff;border-radius:12px;' +
          'box-shadow:0 8px 24px rgba(0,0,0,0.5);font:12px system-ui,-apple-system,"Segoe UI",sans-serif;';
        const head = document.createElement('div');
        head.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:6px;';
        const ttl = document.createElement('span');
        ttl.id = 'dev-err-title';
        ttl.style.cssText = 'flex:1 1 auto;font-weight:600;';
        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.id = 'dev-err-copy';
        copyBtn.textContent = 'Copy error';
        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.textContent = '\u2715';
        closeBtn.setAttribute('aria-label', 'Close');
        const btnCss = 'padding:3px 10px;background:transparent;color:#ffffff;border:1px solid #ffffff;border-radius:999px;cursor:pointer;font:inherit;';
        copyBtn.style.cssText = btnCss;
        closeBtn.style.cssText = btnCss;
        const pre = document.createElement('pre');
        pre.id = 'dev-err-text';
        pre.style.cssText = 'margin:0;max-height:40vh;overflow:auto;white-space:pre-wrap;word-break:break-word;' +
          'user-select:text;font:12px/1.4 ui-monospace,Menlo,Consolas,monospace;';
        copyBtn.addEventListener('click', function () {
          devCopyText(pre.textContent, function (ok) {
            copyBtn.textContent = ok ? 'Copied \u2713' : 'Copy failed';
            if (ok) { setTimeout(function () { try { box.remove(); } catch (e) {} }, 400); return; }
            setTimeout(function () { copyBtn.textContent = 'Copy error'; }, 1500);
          });
        });
        closeBtn.addEventListener('click', function () {
          box.remove();
        });
        head.appendChild(ttl);
        head.appendChild(copyBtn);
        head.appendChild(closeBtn);
        box.appendChild(head);
        box.appendChild(pre);
        document.body.appendChild(box);
      }
      const t = box.querySelector('#dev-err-title');
      const p = box.querySelector('#dev-err-text');
      if (t) t.textContent = title || 'Error';
      if (p) p.textContent = p.textContent ? p.textContent + '\n\n' + text : text;
    } catch (e) {}
  }
  function devShowErr(msg) {
    try { devLog('ERROR', 'PATCH ERROR: ' + msg); } catch (e) {}
    devErrPopup('PATCH ERROR', String(msg));
  }
  // Any uncaught script error / failed promise also pops out the error box
  window.addEventListener('error', function (ev) {
    const m = String((ev && ev.message) || '');
    if (!m || /ResizeObserver loop/i.test(m)) return;
    const where = ev.filename ? '\n' + ev.filename + ':' + (ev.lineno || 0) + ':' + (ev.colno || 0) : '';
    const stack = ev.error && ev.error.stack ? '\n' + ev.error.stack : '';
    devErrPopup('Error', m + where + stack);
  });
  window.addEventListener('unhandledrejection', function (ev) {
    const r = ev && ev.reason;
    const m = r && r.stack ? r.stack : String(r && r.message ? r.message : r);
    devErrPopup('Unhandled promise error', m);
  });
  async function saveDirHandle(handle) {
    return new Promise((resolve) => {
      const req = indexedDB.open('DevWorkspaceDB', 1);
      req.onupgradeneeded = (e) => e.target.result.createObjectStore('handles');
      req.onsuccess = (e) => {
        const db = e.target.result;
        const tx = db.transaction('handles', 'readwrite');
        tx.objectStore('handles').put(handle, 'workspaceDir');
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
      };
    });
  }
  async function loadDirHandle() {
    return new Promise((resolve) => {
      const req = indexedDB.open('DevWorkspaceDB', 1);
      req.onupgradeneeded = (e) => e.target.result.createObjectStore('handles');
      req.onsuccess = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('handles')) {
          db.close();
          return resolve({ handle: null, granted: false });
        }
        const tx = db.transaction('handles', 'readonly');
        const getReq = tx.objectStore('handles').get('workspaceDir');
        getReq.onsuccess = async (e) => {
          let handle = e.target.result;
          let granted = false;
          if (handle) {
            try {
              granted = (await handle.queryPermission({ mode: 'readwrite' })) === 'granted';
            } catch (err) {
              handle = null;
              granted = false;
            }
          }
          db.close();
          resolve({ handle: handle || null, granted });
        };
                getReq.onerror = () => resolve({ handle: null, granted: false });
            };
            req.onerror = () => resolve({ handle: null, granted: false });
          });
        }
          function updateLinkButtonLabel() {
          const btn = $('dev-btn-link');
          if (!btn) return;
          // Line icons use currentColor, so they stay white like the other taskbar buttons
          const svgOpen = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block">';
          const ICON_FOLDER = svgOpen + '<path d="M2 4.5a1 1 0 0 1 1-1h3l1.5 1.5H13a1 1 0 0 1 1 1v5.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z"/></svg>';
          const ICON_RECONNECT = svgOpen + '<path d="M13.5 8a5.5 5.5 0 1 1-1.7-4"/><path d="M13.5 2.5v3h-3"/></svg>';
              btn.innerHTML = devDirHandle ? ICON_RECONNECT : ICON_FOLDER;
            // Green = folder connected and readable, red = not connected
            btn.classList.toggle('link-on', devConnected);
            btn.classList.toggle('link-off', !devConnected);
            btn.title = (devDirHandle ? 'Reconnect Folder' : 'Project Folder') + (devConnected ? ' (connected)' : ' (not connected)');
            btn.setAttribute('aria-label', btn.title);
          }
          let devConnected = false;
          var DEV_TEXT_RE = /\.(js|html|json|css)$/i;
          var DEV_SKIP_DIRS = { '.git': 1, 'node_modules': 1, '_to_delete': 1 };
          async function devScanDir(dir, prefix, out, depth) {
            if (depth > 6) return;
            for await (var entry of dir.values()) {
              if (entry.kind === 'directory') {
                if (!DEV_SKIP_DIRS[entry.name]) await devScanDir(entry, prefix + entry.name + '/', out, depth + 1);
              } else if (DEV_TEXT_RE.test(entry.name)) {
                var file = await entry.getFile();
                if (file.size > 3e6) continue;
                out[prefix + entry.name] = (await file.text()).replace(/\r\n/g, '\n');
              }
            }
          }
          async function refreshWorkspaceFromDisk() {
                        var fresh = {};
            await devScanDir(devDirHandle, '', fresh, 0);
            devWorkspace = fresh;
          devConnected = true;
          updateLinkButtonLabel();
        }
        async function initDevWorkspace() {
          try {
            const { handle, granted } = await loadDirHandle();
            devDirHandle = handle;
            if (devDirHandle && granted) {
              await refreshWorkspaceFromDisk();
              return;
            }
            devConnected = false;
            updateLinkButtonLabel();
            if (window.CloudSync) {
              const cw = await window.CloudSync.loadWorkspace();
              if (cw && Object.keys(cw).length) {
                devWorkspace = cw;
                devToast('☁ Folder not connected: patches go to the cloud (' + Object.keys(cw).length + ' files)', 4000);
              }
            }
          } catch (e) {
            devConnected = false;
            updateLinkButtonLabel();
          }
        }
  $('dev-btn-link')?.addEventListener('click', async () => {
    if (devDirHandle) {
      try {
        const perm = await devDirHandle.requestPermission({ mode: 'readwrite' });
        if (perm === 'granted') {
          await refreshWorkspaceFromDisk();
          devToast(`✅ Reconnected! Loaded ${Object.keys(devWorkspace).length} files.`);
          if (window.CloudSync) window.CloudSync.kick();
          return;
        }
      } catch (err) {}
    }
    if ('showDirectoryPicker' in window) {
      try {
        devDirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
        await saveDirHandle(devDirHandle);
        await refreshWorkspaceFromDisk();
        devToast(`✅ Linked ${Object.keys(devWorkspace).length} files!`);
        if (window.CloudSync) window.CloudSync.kick();
      } catch (e) {}
    } else {
      $folderInput?.click();
    }
  });
  $folderInput?.addEventListener('change', async (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    devWorkspace = {};
    for (const file of files) {
      if (file.webkitRelativePath && (file.webkitRelativePath.includes('node_modules') || file.webkitRelativePath.includes('.git'))) continue;
            if (file.name.endsWith('.js') || file.name.endsWith('.html') || file.name.endsWith('.json') || file.name.endsWith('.css')) {
            devWorkspace[file.name] = await file.text();
          }
        }
        devConnected = true;
        updateLinkButtonLabel();
        devToast(`✅ Loaded ${Object.keys(devWorkspace).length} files!`);
      });
  // ════════ DEV STATE ════════
  const DEV_SPLIT = '===' + 'SPLIT' + '===';
  const DEV_BLOCK = '===' + 'BLOCK' + '===';
  const DEV_DELETE = '===' + 'DELETE' + '===';
  const DEV_ERR_MAX = 3;
  let devAuto = false, devNuts = false, devTries = 0, devBusy = false;
    let devReq = '', devTags = [], devLastPatch = '', devSeenReply = '', devNutsTimer = 0, devNutsSeen = '', devFailOld = '';
  devAuto = true;
  try { devAuto = localStorage.getItem('split-view:dev-auto') !== 'false'; } catch (e) {}
  try {
    devNuts = sessionStorage.getItem('split-view:dev-nuts') === '1';
    devTries = Number(sessionStorage.getItem('split-view:dev-tries') || 0) || 0;
    devReq = sessionStorage.getItem('split-view:dev-req') || '';
  } catch (e) {}
  window.__nutsMode = devNuts;
  const devHist = { undo: [], redo: [] };
  function devSetTries(n) { devTries = n; try { sessionStorage.setItem('split-view:dev-tries', String(n)); } catch (e) {} }
  function devSetReq(r) { devReq = r; try { sessionStorage.setItem('split-view:dev-req', r); } catch (e) {} }
  // ════════ DEV PROMPT ════════
  const SUPER_PROMPT = [
    '[Give me the result as Find-and-Replace blocks for a multi-file project (a browser extension: index.js, index.html, background.js, manifest.json, content scripts...).',
        'FORMAT: the WHOLE patch goes in ONE fenced code block (triple backticks). The first line inside the fence is the FILE header, and the fence contains ONLY headers, OLD code, ' + DEV_SPLIT + ' lines, NEW code and ' + DEV_BLOCK + ' lines, never a sentence:',
    '==== FILE: index.js ====',
    '(OLD code, copied exactly from the code shown, unique inside that file, with 6-8 lines of unchanged context)',
    DEV_SPLIT,
    '(NEW code, same context lines kept)',
        'Several independent fixes: keep them all inside the same single fenced code block and separate the blocks with ' + DEV_BLOCK + ' on its own line. Every block needs its own FILE header. If any block fails, NOTHING is applied.',
    'New file: put its path in the FILE header, leave the OLD part empty and write the whole file after the ' + DEV_SPLIT + ' line. Delete a file: empty OLD and the single line ' + DEV_DELETE + ' after the split line. Files in subfolders are addressed by path, for example lib/util.js.',
    '(This works for ANY language. Ignore JS-specific scope rules if not applicable.)',
    'The 11 Surgery Scenarios You Must Handle:',
    'Scenario 1 (The Swap): changing one value or line for another.',
    'Scenario 2 (The Excision): deleting code while keeping the rest of the file clean.',
    'Scenario 3 (The Injection): bolting new features onto existing code.',
    'Scenario 4 (The Interceptor): adding a safety check or a rule inside an existing process.',
    'Scenario 5 (The Migration): moving a button or a piece of logic from one place to another.',
    'Scenario 6 (The Refactor): rewriting a complex formula or loop to make it faster.',
    'Scenario 7 (The Sweep): renaming a word/variable everywhere it appears.',
    'Scenario 8 (The Database Bump): updating saved data settings so the app does not crash on old info.',
    'Scenario 9 (The Link Shift): changing where the app connects to (APIs, URLs, tokens).',
    'Scenario 10 (The Sync): when you change one side of a pair (content script and index.js, background.js and its caller, manifest and the code it names) you must also fix the other side.',
    'Scenario 11 (The Layer Fix): fixing UI issues where things are hidden or unclickable.',
    'If any variable is declared with const or let inside a function or block that gets re-executed, move the declaration outside or convert it to var. Never declare the same identifier twice in the same scope.',
    'Files loaded by the extension itself (background.js, manifest.json, rules.json, content-*.js) reload the whole extension when patched. Never put a line longer than 3000 characters or a base64 blob in a patch.',
        'OUTPUT RULE (strict, the tool reads your reply by machine): your reply is exactly ONE fenced code block with the whole patch in it, preceded by at most ONE plain sentence naming the confirmed cause. Nothing at all after the fence and nothing between fences. Never put prose, comments about the patch, warnings, error messages or annotations inside the fence. A patch written outside a fenced code block is rejected. If you have a concern about the existing code, state it in that one plain sentence BEFORE the fence, never inside it.',
    'ROOT-CAUSE RULE: never patch from a guess. Before any patch, trace the cause end to end: what produces the behaviour, what calls, overrides, saves or restores it, and what runs it at startup. If any link of that chain is not in the code shown, reply with ONLY the @names of the parts you need and NO patch. Once the cause is confirmed, give ONE definitive set of blocks (no alternatives, no apply-this-if options) and put one plain sentence naming the confirmed cause before the code.',
    'Before you give me the solution, double-check that you have not left any bracket } or parenthesis ) unclosed.]'
  ].join('\n') + '\n';
  // ════════ LITE MODE (send only the relevant parts of big files) ════════
  const LITE_MIN_LINES = 400;
  let liteChunks = [];
  const liteStop = 'the and for with that this from into make change please then when also should would could just have are was but you your its all any can will get need want'.split(' ');
  ['dev-inc-user', 'dev-inc-prompt', 'dev-inc-source', 'dev-inc-lite'].forEach(function (id) {
    const el = $(id);
    if (!el) return;
    try {
      const saved = localStorage.getItem('split-view:' + id);
      if (saved !== null) el.checked = saved === 'true';
    } catch (e) {}
    el.addEventListener('change', function () {
      try { localStorage.setItem('split-view:' + id, String(el.checked)); } catch (e) {}
    });
  });
  function liteWords(instr) {
    return (instr.replace(/@[\w$-]+/g, ' ').toLowerCase().match(/[a-z0-9_$#.\-]{3,}/g) || []).filter(function (w, k, a) {
      return a.indexOf(w) === k && liteStop.indexOf(w) < 0;
    });
  }
  function liteTags(instr) {
    return (instr.match(/@[\w$-]+/g) || []).map(function (x) { return x.slice(1).toLowerCase(); });
  }
  // A comment line made of box-drawing / = characters around a title starts a named section: @SectionName works like @partN
  const devSecRe = /^\s*(?:\/\/|\/\*|<!--)\s*(?:[─═━]{2,}|={3,})\s*(.+?)\s*[─═━=\-]*\s*(?:\*\/|-->)?\s*$/;
  function devSecName(line, file) {
    if (line.indexOf('──') < 0 && line.indexOf('══') < 0 && line.indexOf('===') < 0) return '';
    const m = devSecRe.exec(line);
    if (!m) return '';
    let nm = m[1].replace(/\s*(?:\(|—|:| - ).*$/, '').replace(/[^A-Za-z0-9_$]+/g, ' ').trim();
    if (!nm) return '';
    nm = nm.split(' ').map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join('').slice(0, 28);
    if (/\.css$/i.test(file) && /^\s*\/\*/.test(line)) nm += 'Css';
    else if (/\.html?$/i.test(file) && /^\s*<!/.test(line)) nm += 'Html';
    return nm;
  }
  function liteBuild() {
    const bound = /^\s*(<script\b|<style\b|<!--|(async\s+)?function\s+\w|class\s+\w|(const|let|var)\s+\w+\s*=\s*(async\s*)?(function\b|\([^)]*\)\s*=>))/;
    const closeTag = /<\/(script|style)>\s*$/;
    const nameRe = /function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>)|id="([^"]+)"/g;
    const out = [];
    Object.keys(devWorkspace).forEach(function (file) {
      const L = devWorkspace[file].split('\n');
      const N = L.length;
      if (N < LITE_MIN_LINES) return;
      const cuts = [0];
      let st = 0;
      for (let i = 1; i < N; i++) {
        const len = i - st;
        if (((bound.test(L[i]) || closeTag.test(L[i - 1])) && len >= 40) || len >= 150 || (len >= 3 && devSecName(L[i], file))) { cuts.push(i); st = i; }
      }
      let prevSec = '';
      for (let c = 0; c < cuts.length; c++) {
        const s = cuts[c];
        const e = c + 1 < cuts.length ? cuts[c + 1] : N;
        const t = L.slice(s, e).join('\n');
        const names = [];
        let m;
        nameRe.lastIndex = 0;
        while ((m = nameRe.exec(t)) && names.length < 10) {
          const nm = m[1] || m[2] || m[3];
          if (nm && names.indexOf(nm) < 0) names.push(nm);
        }
        let sec = '', cont = false;
        for (let k = s; k < s + 3 && k < e && !sec; k++) sec = devSecName(L[k], file);
        if (!sec && c > 0 && prevSec && !/^\s*<(script|style)\b/i.test(L[s]) && !closeTag.test(L[s - 1])) { sec = prevSec; cont = true; }
        prevSec = sec;
        if (sec) { const k2 = names.indexOf(sec); if (k2 >= 0) names.splice(k2, 1); names.unshift(sec); }
        out.push({ n: out.length + 1, file: file, s: s + 1, e: e, t: t, low: t.toLowerCase(), names: names, sec: sec, cont: cont });
      }
    });
    liteChunks = out;
    return out;
  }
  // ════════ DEV CONTEXT ════════
  function devLinks(chunks) {
    if (!chunks || chunks._lk) return chunks;
    chunks._lk = 1;
    const defRe = /function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>)|window\.([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?function\b/g;
    const callRe = /([A-Za-z_$][\w$]*)\s*\(/g;
    const defs = Object.create(null);
    let m, nm, d;
    chunks.forEach(function (ch) {
      ch.calls = []; ch.by = [];
      defRe.lastIndex = 0;
      while ((m = defRe.exec(ch.t))) {
        nm = m[1] || m[2] || m[3];
        if (!nm || nm.length < 4) continue;
        d = defs[nm] || (defs[nm] = { ns: [], sig: '' });
        if (d.ns.indexOf(ch.n) < 0) d.ns.push(ch.n);
        if (!d.sig) {
          const a = ch.t.lastIndexOf('\n', m.index) + 1, b = ch.t.indexOf('\n', m.index);
          d.sig = ch.t.slice(a, b < 0 ? ch.t.length : b).trim().slice(0, 110);
        }
      }
    });
    chunks.forEach(function (ch) {
      const seen = {};
      callRe.lastIndex = 0;
      while ((m = callRe.exec(ch.t))) {
        nm = m[1];
        d = defs[nm];
        if (!d || d.ns.length !== 1 || d.ns[0] === ch.n || seen[nm]) continue;
        seen[nm] = 1;
        ch.calls.push({ name: nm, n: d.ns[0], sig: d.sig });
        const tgt = chunks[d.ns[0] - 1];
        if (tgt && tgt.by.indexOf(ch.n) < 0) tgt.by.push(ch.n);
      }
    });
    chunks.forEach(function (ch) { ch.by.sort(function (x, y) { return x - y; }); });
    return chunks;
  }
  function devLineBag(src) {
    const bag = Object.create(null);
    src.split('\n').forEach(function (l) { const k = l.trim(); if (k) bag[k] = (bag[k] || 0) + 1; });
    return bag;
  }
  // which parts differ from the files as they were before the first patch in the saved history
  function devMarkChanged(chunks) {
    if (!chunks || chunks._ch) return;
    chunks._ch = 1;
    const base = {};
    devHist.undo.forEach(function (en) { Object.keys(en.files).forEach(function (f) { if (!(f in base)) base[f] = en.files[f].b; }); });
    const bags = {};
    Object.keys(base).forEach(function (f) { bags[f] = devLineBag(base[f] || ''); });
    chunks.forEach(function (ch) {
      ch.added = 0;
      const bag = bags[ch.file];
      if (!bag) return;
      ch.t.split('\n').forEach(function (l) {
        const x = l.trim();
        if (!x) return;
        if (bag[x] > 0) bag[x]--; else ch.added++;
      });
    });
  }
  const devAiTag = '@' + 'ai:';
  function devChunkNotes(ch) {
    if (ch.ai === undefined) {
      ch.ai = '';
      if (ch.t.indexOf(devAiTag) >= 0) {
        const re = new RegExp('(?:\\/\\/|\\/\\*)\\s*' + devAiTag + '\\s*([^\\n*]+)', 'g');
        const out = [];
        let m;
        while ((m = re.exec(ch.t)) && out.length < 3) out.push(m[1].trim().slice(0, 110));
        ch.ai = out.join(' / ');
      }
    }
    return ch.ai;
  }
  // runtime errors of this page session (from the event log): [{m, f, l, c}]
  function devSessionErrors() {
    const start = Date.now() - (window.performance && performance.now ? performance.now() : 0) - 500;
    const out = [], seen = {};
    evLog.forEach(function (en) {
      if (en.k !== 'ERROR' || en.t < start || /^PATCH ERROR/.test(en.m)) return;
      let m = /^Uncaught: ([\s\S]*?) @ (\S*?):(\d+):(\d+)/.exec(en.m), e = null;
      if (m) e = { m: m[1], f: m[2].split('/').pop().split('?')[0], l: +m[3], c: +m[4] };
      else if (/^Unhandled promise rejection/.test(en.m)) {
        const s = /(\S+\.(?:js|html)):(\d+):(\d+)/.exec(en.m);
        e = { m: en.m.split('\n')[0].slice(0, 300), f: s ? s[1].split('/').pop().split('?')[0] : '', l: s ? +s[2] : 0, c: s ? +s[3] : 0 };
      }
      if (!e || seen[e.m + e.f + e.l]) return;
            var ck = null, q;
            for (q = evLog.length - 1; q >= 0; q--) {
              if (evLog[q].k === 'CLICK' && evLog[q].t <= en.t) { ck = evLog[q]; break; }
            }
            if (ck && en.t - ck.t < 15000) { e.a = ck.m; e.ad = en.t - ck.t; }
      seen[e.m + e.f + e.l] = 1;
      out.push(e);
    });
    return out;
  }
  function devPartAt(f, l, chunks) {
    if (!f || !l) return '';
    const ch = chunks.filter(function (c) { return c.file === f && l >= c.s && l <= c.e; })[0];
    return ch ? '@part' + ch.n + (ch.sec ? ' @' + ch.sec : '') : '';
  }
  function devFmtErr(e, chunks) {
    const w = devPartAt(e.f, e.l, chunks || liteChunks || []);
    return e.m + (e.f ? '  @ ' + e.f + ':' + e.l + (e.c ? ':' + e.c : '') : '  (no line)') + (w ? '  (' + w + ')' : '') + (e.a ? '  after clicking ' + e.a + ' ' + (e.ad / 1000).toFixed(1) + 's earlier' : '');
  }
  function devTail(ch, errs) {
    let s = '';
    try {
      if (ch.added) s += '  <<CHANGED +' + ch.added + '>>';
      const er = errs.filter(function (e) { return e.f === ch.file && e.l >= ch.s && e.l <= ch.e; })[0];
      if (er) s += '  <<ERROR: L' + er.l + ' ' + er.m.slice(0, 60) + '>>';
      if (ch.calls && ch.calls.length) s += '  | calls: ' + ch.calls.slice(0, 5).map(function (x) { return x.name + '(' + x.n + ')'; }).join(', ');
      if (ch.by && ch.by.length) s += '  | used by: ' + ch.by.slice(0, 6).join(', ');
      const nt = devChunkNotes(ch);
      if (nt) s += '  | NOTE: ' + nt;
    } catch (e) {}
    return s;
  }
  function devElBrief(el) {
      var cl = (typeof el.className === 'string' ? el.className : '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
      return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (cl.length ? '.' + cl.join('.') : '');
    }
    function devOwnText(el) {
      return Array.prototype.filter.call(el.childNodes, function (n) { return n.nodeType === 3; }).map(function (n) { return n.nodeValue; }).join(' ').replace(/\s+/g, ' ').trim();
    }
    // part numbers whose code mentions this element's id or class names (names that appear in too many parts are ignored)
    function devElParts(el, chunks, cache) {
      var toks = [], out = [];
      if (el.id) toks.push(el.id);
      (typeof el.className === 'string' ? el.className : '').trim().split(/\s+/).filter(Boolean).slice(0, 3).forEach(function (c) { toks.push(c); });
      toks.forEach(function (tk) {
        if (out.length >= 2 || tk.length < 4) return;
        var low = tk.toLowerCase(), hit = cache[low];
        if (!hit) {
          hit = chunks.filter(function (ch) { return ch.low.indexOf(low) >= 0; }).map(function (ch) { return ch.n; });
          cache[low] = hit;
        }
        if (!hit.length || hit.length > chunks.length * 0.25) return;
        hit.slice(0, 2).forEach(function (n) { if (out.length < 2 && out.indexOf(n) < 0) out.push(n); });
      });
      return out;
    }
    function devUiMap(chunks) {
      var tagOk = /^(BUTTON|INPUT|SELECT|TEXTAREA|A|CANVAS)$/, list = document.body.querySelectorAll('*'), out = [], cache = Object.create(null), more = false, i, el, r, cs, t, pt;
      for (i = 0; i < list.length && i < 4000; i++) {
        el = list[i];
        if (!(el.id || tagOk.test(el.tagName))) continue;
        if (el.closest && el.closest('svg, #dev-log-panel, #dev-err-popup, .bm-mgr, .type-peek')) continue;
        r = el.getBoundingClientRect();
        if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) continue;
        cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        if (out.length >= 40) { more = true; break; }
        t = el.children.length ? '' : (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 28);
        if (!t) t = (el.getAttribute('placeholder') || el.title || '').slice(0, 28);
        pt = devElParts(el, chunks, cache);
        out.push('  ' + devElBrief(el) + (t ? ' "' + t + '"' : '') + '  (' + Math.round(r.left) + ',' + Math.round(r.top) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + ')' + (pt.length ? '  ' + pt.map(function (n) { return '@part' + n; }).join(' ') : ''));
      }
      if (!out.length) return '';
      return '=== UI MAP (visible elements of this extension page, viewport ' + window.innerWidth + 'x' + window.innerHeight + ', (x,y w x h) in px, @partN = a part whose code mentions the element' + (more ? ', first 40 shown' : '') + ') ===\n' + out.join('\n');
    }
    function devAiNotes() {
    const re = new RegExp('(?:<!' + '--|\\/\\*)\\s*AI-NOTES([\\s\\S]*?)(?:-' + '->|\\*\\/)');
    const out = [];
    Object.keys(devWorkspace).forEach(function (f) {
      const m = re.exec(devWorkspace[f]);
      if (m && m[1].trim()) out.push('=== AI-NOTES in ' + f + ' (written by the author, treat as true) ===\n' + m[1].trim());
    });
    return out;
  }
  function devConnBlock(instruction, chunks) {
    const tags = liteTags(instruction);
    if (!tags.length) return '';
    const shown = chunks.filter(function (ch) {
      return tags.indexOf('part' + ch.n) >= 0 || tags.indexOf('p' + ch.n) >= 0 || ch.names.some(function (x) { return tags.indexOf(x.toLowerCase()) >= 0; });
    }).slice(0, 8);
    if (!shown.length) return '';
    devLinks(chunks);
    const lines = [];
    shown.forEach(function (ch) {
      const l = [];
      if (ch.calls.length) l.push('  calls: ' + ch.calls.slice(0, 6).map(function (x) { return x.name + ' (PART ' + x.n + ') ' + x.sig; }).join('\n         '));
      if (ch.by.length) l.push('  used by: PART ' + ch.by.slice(0, 8).join(', PART '));
      if (l.length) lines.push('PART ' + ch.n + ' ' + ch.file + (ch.sec ? ' @' + ch.sec : '') + ':\n' + l.join('\n'));
    });
    if (!lines.length) return '';
    return '=== CONNECTIONS OF THE SHOWN PARTS (heuristic, from names; a call shows only the signature line of the callee, ask for its @partN if you need the body) ===\n' + lines.join('\n');
  }
  // extra context blocks added after the code in the payload
  function devExtras(isIdx, instruction, chunks) {
    const out = [];
    try { devAiNotes().forEach(function (x) { out.push(x); }); } catch (e1) {}
    try {
      if (devHist.undo.length) {
        out.push('=== SESSION CHANGES (patches applied by this tool, oldest first; the files may have been edited by hand since) ===\n' +
          devHist.undo.slice(-8).map(function (en) { return new Date(en.t).toTimeString().slice(0, 5) + ' ' + en.label; }).join('\n'));
      }
    } catch (e2) {}
    try {
      const errs = devSessionErrors();
      if (errs.length) out.push('=== RUNTIME ERRORS IN THIS EXTENSION PAGE (line numbers are file lines) ===\n' + errs.slice(0, 6).map(function (e) { return devFmtErr(e, chunks); }).join('\n'));
    } catch (e3) {}
    try { if (!isIdx && chunks.length) { const cb = devConnBlock(instruction || '', chunks); if (cb) out.push(cb); } } catch (e4) {}
        try { if (isIdx && chunks.length) { var ui = devUiMap(chunks); if (ui) out.push(ui); } } catch (e5) {}
    return out;
  }
  // ════════ DEV INDEX AND SOURCE ════════
  function liteIndex(instr) {
    const chunks = devLinks(liteBuild());
    devMarkChanged(chunks);
    const errs = devSessionErrors();
    const hitInfo = {};
    liteWords(instr).forEach(function (w) {
      const hit = chunks.filter(function (ch) { return ch.low.indexOf(w) >= 0; });
      if (!hit.length || hit.length > chunks.length * 0.25) return;
      hit.forEach(function (ch) { (hitInfo[ch.n] = hitInfo[ch.n] || []).push(w); });
    });
    const lines = chunks.map(function (ch) {
      let label = ch.names.slice(0, 8).join(', ');
      if (!label) {
        const first = ch.t.split('\n').map(function (x) { return x.trim(); }).filter(Boolean)[0] || '';
        label = '(' + first.slice(0, 60) + ')';
      }
      const h = hitInfo[ch.n];
      return 'PART ' + ch.n + ' ' + ch.file + ' L' + ch.s + '-' + ch.e + ': ' + label + (h ? '  <<MATCH: ' + h.slice(0, 4).join(', ') + '>>' : '') + devTail(ch, errs);
    });
    const small = Object.keys(devWorkspace).filter(function (f) {
      return !chunks.some(function (ch) { return ch.file === f; });
    }).map(function (f) { return f + ' (' + devWorkspace[f].split('\n').length + ' lines)'; });
    const legend = 'LEGEND (end of each part line): <<MATCH>> = words from the request were found in it; <<CHANGED +n>> = n lines differ from the file before the first patch of the saved history; <<ERROR>> = a runtime error of this page maps to this part; calls = functions defined in OTHER parts that this part calls, as name(part number); used by = parts that call something defined here; NOTE = author note written in the code. The first name of each part is its section name: you may tag @SectionName instead of @partN (parts sharing a name are all selected). Links are heuristic, based on names.\n';
    return '[INDEX MODE: No code is attached on purpose. The request is the text above. Reply in plain text with ONE line only: the request copied exactly, followed by @partN tags for every part you must see to write the patch (parts marked MATCH contain words from the request). Do NOT write any patch and do NOT guess the cause from names alone. Select parts so the full cause chain is visible in the next step: (1) the code that produces the behaviour in the request, (2) every function, timer, event listener or CSS rule that calls, sets, overrides, saves or restores it, (3) the boot, init or restore code that runs it at startup. Parts marked MATCH are only hints. Be generous (up to about 12 parts): a second round costs more than a few extra parts. Small files are always attached in full later, so tag only PART numbers.]\n\n' +
      '=== PARTS (' + chunks.length + ' total) ===\n' + legend + lines.join('\n') +
      '\n\n=== SMALL FILES (attached in full later) ===\n' + small.join('\n');
  }
  function liteSource(instr) {
    const chunks = liteBuild();
    const tags = liteTags(instr);
    const forced = {};
    const scores = {};
    chunks.forEach(function (ch) {
      if (tags.indexOf('part' + ch.n) >= 0 || tags.indexOf('p' + ch.n) >= 0 || ch.names.some(function (x) { return tags.indexOf(x.toLowerCase()) >= 0; })) forced[ch.n] = 1;
    });
    liteWords(instr).forEach(function (w) {
      const hit = chunks.filter(function (ch) { return ch.low.indexOf(w) >= 0; });
      if (!hit.length || hit.length > chunks.length * 0.25) return;
      hit.forEach(function (ch) {
        scores[ch.n] = (scores[ch.n] || 0) + Math.min(ch.low.split(w).length - 1, 5) / hit.length;
      });
    });
    let rank = chunks.filter(function (ch) { return !forced[ch.n] && scores[ch.n] > 0; })
      .sort(function (a, b) { return scores[b.n] - scores[a.n]; });
    let used = 0;
    const budget = 60000;
    Object.keys(forced).forEach(function (k) { used += chunks[k - 1].t.length; });
    if (Object.keys(forced).length) rank = [];
    rank = rank.filter(function (ch) {
      if (used + ch.t.length > budget) return false;
      used += ch.t.length;
      return true;
    }).slice(0, 12);
    const sel = Object.keys(forced).map(Number).concat(rank.map(function (ch) { return ch.n; }));
    const picked = {};
    sel.forEach(function (n) { picked[n] = 1; });
    const out = ['[LITE MODE: some files are large, so only the relevant parts of them are shown below (small files are shown in full). STRICT RULES: (1) Trace the cause of the request through the shown parts before writing anything: what produces the behaviour, what calls, overrides, saves or restores it, and what runs it at startup. (2) If any link of that chain is missing or you are guessing, reply in plain text with ONLY the @names you need and NO patch, not even a partial or probable one. (3) Only when the cause is confirmed from the shown code, give ONE definitive set of patch blocks, with one plain sentence before them naming the confirmed cause. Never give alternatives, optional patches, or a patch together with a request for more parts. Patch format: put the WHOLE patch in ONE fenced code block with nothing but patch text inside it (no prose), and at most one plain sentence before the fence. Inside the fence: ==== FILE: name ==== headers and OLD' + DEV_SPLIT + 'NEW blocks whose OLD text is copied exactly from the parts shown and is unique in that whole file (include a few surrounding lines). If you need a part that is not shown, reply in plain text with only its name from the list, like @functionName.]'];
    if (!sel.length) out.push('(No part of the large files matched the instruction. Name one with @name.)');
    Object.keys(devWorkspace).forEach(function (file) {
      const mine = chunks.filter(function (ch) { return ch.file === file; });
      if (!mine.length) {
        out.push('==== FILE: ' + file + ' ====\n' + devWorkspace[file].trim());
        return;
      }
      const shown = mine.filter(function (ch) { return picked[ch.n]; });
      if (!shown.length) return;
      out.push('==== FILE: ' + file + ' (partial: only the parts below are shown) ====\n' + shown.map(function (ch) {
        return '=== PART ' + ch.n + ' (lines ' + ch.s + '-' + ch.e + ') ===\n' + ch.t;
      }).join('\n\n'));
    });
    const rest = chunks.filter(function (ch) { return !picked[ch.n] && ch.names.length; })
      .slice(0, 300).map(function (ch) { return ch.n + ' ' + ch.file + ' L' + ch.s + '-' + ch.e + ': ' + ch.names.slice(0, 5).join(', '); });
    out.push('=== OTHER PARTS (names only) ===\n' + rest.join('\n'));
    return out.join('\n\n');
  }
  async function liteAutoTags() {
    try {
      const text = await navigator.clipboard.readText();
      if (!text || text.length > 4000 || text.indexOf('LITE MODE') >= 0 || text.indexOf('INDEX MODE') >= 0 || text.indexOf('==SPLIT') >= 0) return;
      const found = text.match(/@[\w$-]+/g) || [];
      if (!found.length) return;
      const known = {};
      liteBuild().forEach(function (ch) {
        known['part' + ch.n] = 1;
        known['p' + ch.n] = 1;
        ch.names.forEach(function (x) { known[x.toLowerCase()] = 1; });
      });
      const box = $('dev-instruction');
      if (!box) return;
      const have = (box.value.match(/@[\w$-]+/g) || []).map(function (x) { return x.toLowerCase(); });
      const add = found.filter(function (t, i) {
        return found.indexOf(t) === i && known[t.slice(1).toLowerCase()] === 1 && have.indexOf(t.toLowerCase()) < 0;
      });
      if (!add.length) return;
      box.value = (box.value.trim() + ' ' + add.join(' ')).trim();
      devToast('📎 Auto-added ' + add.length + ' tag(s) from clipboard');
    } catch (err) {}
  }
  function devKnownTag(tag) {
    const key = tag.slice(1).toLowerCase();
    if (/^(part|p)\d+$/.test(key)) return true;
    return liteBuild().some(function (ch) { return ch.names.some(function (x) { return x.toLowerCase() === key; }); });
  }
  // ════════ DEV PAYLOAD ════════
  function devMakePayload(instruction) {
    const wantUser = $('dev-inc-user')?.checked ?? true;
    const wantSuper = $('dev-inc-prompt')?.checked ?? true;
    const wantSource = $('dev-inc-source')?.checked ?? true;
    if (Object.keys(devWorkspace).length === 0 && wantSource) {
      devToast('⚠️ No files loaded. Link folder first.');
      return null;
    }
    const parts = [];
    const wantLite = !!($('dev-inc-lite') && $('dev-inc-lite').checked);
    const tg = liteTags(instruction || '');
    const isAuto = tg.indexOf('auto') >= 0;
    const hasTags = tg.filter(function (x) { return x !== 'auto'; }).length > 0;
    const chunks = (wantSource && wantLite) ? liteBuild() : [];
    const big = chunks.length > 0;
    const idx = !!(big && wantUser && instruction && !hasTags && !isAuto);
    if (wantSuper && !idx) parts.push(SUPER_PROMPT);
    if (wantUser && instruction) parts.push('User Instruction: ' + instruction);
        if (window.__devShot) {
          parts.push(window.__devShot);
          if (!idx) { window.__devShot = ''; if (window.__devShotClear) window.__devShotClear(); }
        }
    if (wantSource) {
      if (idx) parts.push(liteIndex(instruction));
      else if (big) parts.push(liteSource(instruction || ''));
      else {
        let all = '';
        for (const [filename, content] of Object.entries(devWorkspace)) all += '==== FILE: ' + filename + ' ====\n' + content + '\n\n';
        parts.push(all.trim());
      }
      devExtras(idx, instruction, chunks.length ? devLinks(chunks) : []).forEach(function (x) { if (x) parts.push(x); });
    }
    if (!parts.length) { devToast('⚠️ Nothing to copy'); return null; }
    return { text: parts.join('\n\n'), idx: idx, big: big, hasTags: hasTags || isAuto };
  }
  function devAiWin() {
    const p = window.__aiPaneKey && panes[window.__aiPaneKey];
    return (p && p.view && p.view.contentWindow) || null;
  }
  function devSendAI(text) {
    const w = devAiWin();
    if (!w) return false;
    try { w.postMessage({ sendToAI: String(text), nuts: true }, '*'); return true; } catch (e) { return false; }
  }
  // the AI pane may still be loading after a reload: keep trying for ~20 s
  function devSendAIWait(text, n) {
    if (devSendAI(text)) return;
    if ((n || 0) >= 14) { devToast('🥜 No AI pane found: open Claude, ChatGPT or Gemini in a pane', 8000); return; }
    setTimeout(function () { devSendAIWait(text, (n || 0) + 1); }, 1500);
  }
  function devPostNuts(on) {
    window.__nutsMode = on;
    const w = devAiWin();
    if (w) { try { w.postMessage({ nutsMode: on }, '*'); } catch (e) {} }
  }
  async function devDeliver(text, idx) {
    let sent = false, copied = false;
    if (devNuts) {
      sent = devSendAI(text);
      if (!sent) devToast('⚠️ No AI pane found: payload copied, paste it yourself', 5000);
    }
    await new Promise(function (res) { devCopyText(text, function (ok) { copied = ok; res(); }); });
    if (!copied && !sent) { devToast('❌ Failed to copy: click this page, then press ▲ again', 6000); return; }
    if (sent) devToast('🥜 ' + (idx ? 'Index' : 'Payload') + ' sent to the AI', 3000);
    else if (idx) devToast((devAuto ? '🧭 Index copied: paste it to the AI, then copy its reply: auto-patch does the rest' : '🧭 Index copied (no code): paste to Claude, copy its reply, then press ▲'), 4000);
    else devToast('🚀 Payload copied!');
  }
  async function devPayloadClick() {
    if (devBusy) return;
    if (!devAuto && !devNuts) await liteAutoTags();
    await devFreshen();
    const box = $('dev-instruction');
    const instruction = (box ? box.value : '').trim();
    devSetTries(0);
    devNutsSeen = '';
    const p = devMakePayload(instruction);
    if (!p) return;
    await devDeliver(p.text, p.idx);
    if (p.hasTags && box) box.value = box.value.replace(/\s*@[\w$-]+/g, '').trim();
    if (p.idx && (devAuto || devNuts)) { devSetReq(instruction); devTags = []; }
    else if (!p.hasTags) { devSetReq(''); devTags = []; }
  }
  $('dev-btn-payload')?.addEventListener('click', devPayloadClick);
  // ════════ DEV SYNTAX GUARD ════════
  // Bracket scanner: skips strings, template literals (with ${}), comments and regex literals. Returns '' when balanced.
  function devBracketScan(s) {
    const st = [], n = s.length;
    let i = 0, prev = '';
    const lineOf = function (p) { return s.slice(0, p).split('\n').length; };
    const tpl = function (p) {
      while (p < n) {
        const c = s[p];
        if (c === '\\') { p += 2; continue; }
        if (c === '`') return p + 1;
        if (c === '$' && s[p + 1] === '{') { st.push('${'); return p + 2; }
        p++;
      }
      return n;
    };
    while (i < n) {
      const c = s[i], d = s[i + 1];
      if (c === '/' && d === '/') { const k = s.indexOf('\n', i); if (k < 0) break; i = k; continue; }
      if (c === '/' && d === '*') { const k = s.indexOf('*/', i + 2); if (k < 0) return 'unterminated /* comment at line ' + lineOf(i); i = k + 2; continue; }
      if (c === '"' || c === "'") {
        i++;
        while (i < n && s[i] !== c && s[i] !== '\n') { if (s[i] === '\\') i++; i++; }
        i++; prev = c; continue;
      }
      if (c === '`') { i = tpl(i + 1); prev = '`'; continue; }
      if (c === '/') {
        let rx = prev === '' || /[(,=:\[!&|?{};+\-*%<>~^]/.test(prev);
        if (!rx && /[A-Za-z]/.test(prev)) rx = /(?:^|[^\w$.])(?:return|typeof|case|in|of|void|delete|throw|new|else|do)\s*$/.test(s.slice(Math.max(0, i - 12), i));
        if (rx) {
          let j = i + 1, cls = false, closed = false;
          while (j < n && s[j] !== '\n') {
            const x = s[j];
            if (x === '\\') { j += 2; continue; }
            if (x === '[') cls = true; else if (x === ']') cls = false;
            else if (x === '/' && !cls) { closed = true; break; }
            j++;
          }
          if (closed) { i = j + 1; while (i < n && /[a-z]/i.test(s[i])) i++; prev = ')'; continue; }
        }
        prev = '/'; i++; continue;
      }
      if (c === '(' || c === '[' || c === '{') { st.push(c); prev = c; i++; continue; }
      if (c === ')' || c === ']' || c === '}') {
        const top = st.pop();
        if (c === '}' && top === '${') { i = tpl(i + 1); prev = '`'; continue; }
        const want = c === ')' ? '(' : c === ']' ? '[' : '{';
        if (top !== want) return "unexpected '" + c + "' at line " + lineOf(i);
        prev = c; i++; continue;
      }
      if (!/\s/.test(c)) prev = c;
      i++;
    }
    return st.length ? st.length + " unclosed bracket(s), the last one is '" + st[st.length - 1] + "'" : '';
  }
  let devNoEval = false;
  // true / false = the code parses / does not; null = cannot tell (eval blocked by the extension CSP)
  function devParses(src) {
    if (devNoEval) return null;
    try { new Function(src); return true; } catch (e) {
      if (e instanceof SyntaxError) return false;
      devNoEval = true;
      return null;
    }
  }
  function devJsProblem(a, b) {
    const pb = devParses(b);
    if (pb === false) {
      if (devParses(a) !== false) {
        let why = '';
        try { new Function(b); } catch (e) { why = e.message; }
        return 'no longer parses as JavaScript: ' + why;
      }
      return '';
    }
    if (pb === true) return '';
    const sb = devBracketScan(b);
    return (sb && !devBracketScan(a)) ? 'has unbalanced brackets: ' + sb : '';
  }
  // beforeMap = {file: textBeforeThePatch}. Returns '' when every changed file still looks valid, else the error text.
  function devGuardChanges(beforeMap) {
    for (const f of Object.keys(beforeMap)) {
      const a = beforeMap[f] == null ? '' : beforeMap[f], b = devWorkspace[f];
            let why = '';
            if (b === undefined) continue;
      if (/\.json$/i.test(f)) {
        let wasOk = true;
        if (beforeMap[f] != null) { try { JSON.parse(a); } catch (e) { wasOk = false; } }
        if (wasOk) { try { JSON.parse(b); } catch (e2) { why = 'is no longer valid JSON: ' + e2.message; } }
      } else if (/\.js$/i.test(f)) why = devJsProblem(a, b);
      if (why) return '🛑 SYNTAX GUARD: ' + f + ' ' + why + '\n\nThe patch was NOT applied and NOTHING WAS CHANGED. Check that every block closes its brackets and that OLD and NEW keep the same surrounding lines.';
    }
    return '';
  }
  // ════════ DEV HISTORY ════════
  async function devFreshen() {
    if (!devDirHandle || !devConnected) return;
    try {
      if ((await devDirHandle.queryPermission({ mode: 'readwrite' })) !== 'granted') return;
      await refreshWorkspaceFromDisk();
    } catch (e) {}
  }
  function devHistDb() {
    return new Promise(function (res) {
      try {
        const r = indexedDB.open('DevHistDB', 1);
        r.onupgradeneeded = function (e) { e.target.result.createObjectStore('h'); };
        r.onsuccess = function (e) { res(e.target.result); };
        r.onerror = function () { res(null); };
      } catch (e) { res(null); }
    });
  }
  async function devHistLoad() {
    const db = await devHistDb();
    if (!db) return;
    const v = await new Promise(function (res) {
      try {
        const q = db.transaction('h', 'readonly').objectStore('h').get('stack');
        q.onsuccess = function () { res(q.result || null); };
        q.onerror = function () { res(null); };
      } catch (e) { res(null); }
    });
    db.close();
    if (v && Array.isArray(v.undo) && Array.isArray(v.redo)) { devHist.undo = v.undo; devHist.redo = v.redo; }
    devUndoUi();
  }
  async function devHistSave() {
    const db = await devHistDb();
    if (!db) return;
    await new Promise(function (res) {
      try {
        const tx = db.transaction('h', 'readwrite');
        tx.objectStore('h').put({ undo: devHist.undo, redo: devHist.redo }, 'stack');
        tx.oncomplete = function () { res(); };
        tx.onerror = function () { res(); };
        tx.onabort = function () { res(); };
      } catch (e) { res(); }
    });
    db.close();
  }
  function devUndoUi() {
    const u = $('dev-btn-undo'), r = $('dev-btn-redo');
    if (u) { u.disabled = !devHist.undo.length; u.title = devHist.undo.length ? 'Undo: ' + devHist.undo[devHist.undo.length - 1].label.slice(0, 80) : 'Undo (nothing to undo)'; }
    if (r) { r.disabled = !devHist.redo.length; r.title = devHist.redo.length ? 'Redo: ' + devHist.redo[devHist.redo.length - 1].label.slice(0, 80) : 'Redo (nothing to redo)'; }
  }
  // beforeMap = {file: textBefore}; the text after is read from devWorkspace. Marks the files to be saved.
  async function devCommit(beforeMap, label) {
    const files = {};
    Object.keys(beforeMap).forEach(function (f) {
      files[f] = { b: beforeMap[f], a: (f in devWorkspace) ? devWorkspace[f] : null };
      modifiedFilesToSave.add(f);
    });
    devHist.undo.push({ t: Date.now(), label: label, files: files });
    devHist.redo = [];
    let size = 0;
    devHist.undo.forEach(function (en) { Object.keys(en.files).forEach(function (f) { size += (en.files[f].b || '').length + (en.files[f].a || '').length; }); });
    while (devHist.undo.length > 1 && (devHist.undo.length > 15 || size > 16e6)) {
      const gone = devHist.undo.shift();
      Object.keys(gone.files).forEach(function (f) { size -= (gone.files[f].b || '').length + (gone.files[f].a || '').length; });
    }
    await devHistSave();
    devUndoUi();
  }
  async function devStep(from, to, mode) {
    if (devBusy) return;
    if (!from.length) { devToast('ℹ Nothing to ' + mode); return; }
    devBusy = true;
    try {
      await devFreshen();
      const en = from[from.length - 1];
      const names = Object.keys(en.files);
      const expect = mode === 'undo' ? 'a' : 'b', put = mode === 'undo' ? 'b' : 'a';
      var stale = names.filter(function (f) { return ((f in devWorkspace) ? devWorkspace[f] : null) !== en.files[f][expect]; });
      if (stale.length && !confirm(stale.join(', ') + ' changed since this patch (edited by hand or by another patch).\n\nOverwrite it anyway with the ' + (mode === 'undo' ? 'older' : 'newer') + ' version?')) return;
      from.pop();
      to.push(en);
      names.forEach(function (f) {
              var v = en.files[f][put];
              if (v == null) delete devWorkspace[f];
              else devWorkspace[f] = v;
              modifiedFilesToSave.add(f);
            });
      await devHistSave();
      devUndoUi();
      if (window.CloudSync) window.CloudSync.hold(10000);
      devLog('PATCH', mode + ': ' + en.label);
      devToast((mode === 'undo' ? '↶ Undone: ' : '↷ Redone: ') + en.label.slice(0, 60), 3000);
      setTimeout(savePatchedFiles, 300);
    } finally { devBusy = false; }
  }
  // ════════ DEV PATCH APPLY ════════
  function parseAllBlocks(text) {
    const normalized = text.replace(/\r\n/g, '\n');
    const cleaned = normalized.replace(/\/\/\s*(OLD|NEW)\s*CHUNK\s*/gi, '').trim();
    const stripped = cleaned
      .replace(/^```[\w]*\n?/gm, '')
      .replace(/^```$/gm, '')
      .trim();
    const units = stripped
      .split(/={3,}\s*BLOCK[^=\n]*={3,}/i)
      .map((u) => u.trim())
      .filter(Boolean);
    const extractCleanBlock = (raw) => raw.replace(/^\n+|\n+$/g, '');
    const fileHeaderRe = /^[ \t]*={3,}\s*FILE:\s*(.+?)\s*={3,}[ \t]*\n?/im;
    const splitRe = /={3,}\s*SPLIT\s*={3,}/i;
    const parsed = units
      .map((u) => {
                let filename = null;
        const fm = u.match(fileHeaderRe);
        if (fm) {
          filename = fm[1].trim();
          u = u.slice(fm.index + fm[0].length).trim();
        }
        const m = u.match(splitRe);
        if (!m) return null;
        const idx = u.indexOf(m[0]);
        return {
          filename,
          oldCode: extractCleanBlock(u.slice(0, idx)),
          newCode: extractCleanBlock(u.slice(idx + m[0].length))
        };
      })
      .filter(Boolean);
    return parsed;
  }
  function findFingerprintedChunk(source, chunk) {
    const buildResult = (startIdx, matchedText, isFuzzy) => {
      const lineStartIdx = source.lastIndexOf('\n', startIdx - 1) + 1;
      const leadingSpace = source.substring(lineStartIdx, startIdx).match(/^[ \t]*/)[0];
      const conf = Math.round((Math.min(chunk.length, matchedText.length) / Math.max(chunk.length, matchedText.length)) * 100);
      return { originalText: matchedText, startIndex: startIdx, endIndex: startIdx + matchedText.length, baseIndent: leadingSpace, confidence: conf, isFuzzy: isFuzzy };
    };
    const literalIdx = source.indexOf(chunk);
    if (literalIdx !== -1) {
      const second = source.indexOf(chunk, literalIdx + 1);
      if (second === -1) return buildResult(literalIdx, chunk, false);
      const result = buildResult(literalIdx, chunk, false);
      result.ambiguous = true;
      return result;
    }
    try {
      if (chunk.length > 4000) return null;
      const escaped = chunk.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
      const allMatches = [...source.matchAll(new RegExp(escaped, 'g'))];
      if (allMatches.length === 0) return null;
      if (allMatches.length === 1) return buildResult(allMatches[0].index, allMatches[0][0], true);
      const result = buildResult(allMatches[0].index, allMatches[0][0], true);
      result.ambiguous = true;
      return result;
    } catch (e) {
      return null;
    }
  }
  function devApplyBlock(parsed) {
    devFailOld = parsed.oldCode;
    const has = function (k) { return Object.prototype.hasOwnProperty.call(devWorkspace, k); };
    let named = null;
    var wantName = parsed.filename ? parsed.filename.replace(/\\/g, '/').replace(/^\.?\//, '') : '';
        if (wantName && has(wantName)) named = wantName;
        else if (wantName) {
          var base = wantName.split('/').pop();
          var hits = Object.keys(devWorkspace).filter(function (k) { return k === base || k.slice(-(base.length + 1)) === '/' + base; });
          if (hits.length === 1) named = hits[0];
          else if (hits.length > 1) return { success: false, error: 'File name "' + wantName + '" matches several files (' + hits.join(', ') + '). Use the full path in the FILE header.' };
        }
        var emptyOld = !String(parsed.oldCode || '').trim();
        if (emptyOld && !wantName) return { success: false, error: 'The OLD part is empty: add a FILE header to create or delete a file, or give the OLD code to replace.' };
        if (named && emptyOld) {
          if (parsed.newCode.trim() !== DEV_DELETE) return { success: false, error: 'The OLD part is empty but ' + named + ' already exists. Give the OLD code to replace, or use a new file name.' };
          if (/^(index\.html|index\.js|background\.js|manifest\.json)$/.test(named)) return { success: false, error: 'Refusing to delete the core file ' + named + '.' };
          delete devWorkspace[named];
          return { success: true, file: named };
        }
        if (!named && emptyOld) {
          if (wantName.split('/').indexOf('..') >= 0 || !/\.(js|html|json|css)$/i.test(wantName)) return { success: false, error: 'New file "' + wantName + '" must be a .js, .html, .json or .css file and its path must not contain "..".' };
          if (parsed.newCode.trim() === DEV_DELETE) return { success: false, error: 'Cannot delete "' + wantName + '": no such file.' };
          devWorkspace[wantName] = parsed.newCode.replace(/\r\n/g, '\n').replace(/\s+$/, '') + '\n';
          return { success: true, file: wantName };
        }
    const names = named ? [named] : Object.keys(devWorkspace);
    const cands = [], ambiguous = [], low = [];
    names.forEach(function (f) {
      const loc = findFingerprintedChunk(devWorkspace[f], parsed.oldCode);
      if (!loc) return;
      if (loc.ambiguous) { ambiguous.push(f); return; }
      if (loc.isFuzzy && loc.confidence < 70) { low.push(f + ' ' + loc.confidence + '%'); return; }
      cands.push({ f: f, loc: loc });
    });
    if (!cands.length) {
      const where = named || 'any file';
      if (ambiguous.length) return { success: false, error: 'Ambiguous match in ' + ambiguous.join(', ') + ': this OLD block matches more than one location. Send a larger, more unique chunk of surrounding code.' };
      if (low.length) return { success: false, error: 'Low confidence match (' + low.join(', ') + '): the OLD block matched only fuzzily. Send a larger context window around the change.' };
      return { success: false, error: 'Chunk not found in ' + where + '. The OLD block did not match anything:\n"' + parsed.oldCode.slice(0, 120).trim() + (parsed.oldCode.length > 120 ? '…' : '') + '"' };
    }
    if (cands.length > 1) return { success: false, error: 'Ambiguous match across files (' + cands.map(function (c) { return c.f; }).join(', ') + '). Add a ==== FILE: name ==== header or a more unique OLD block.' };
    const filename = cands[0].f, content = devWorkspace[filename];
    const currentLoc = findFingerprintedChunk(content, cands[0].loc.originalText);
    if (!currentLoc || currentLoc.ambiguous) return { success: false, error: 'Ambiguous match on re-check in ' + filename + '. The matched text appears more than once.' };
    let newT = parsed.newCode.replace(/\r\n/g, '\n');
    if (newT.trim().length > 0) {
      let lines = newT.split('\n');
      const nonEmpty = lines.filter(function (l) { return l.trim(); });
      const minIndent = nonEmpty.length ? Math.min.apply(null, nonEmpty.map(function (l) { return l.match(/^[ \t]*/)[0].length; })) : 0;
      const needed = currentLoc.baseIndent || '';
      if (needed.length > minIndent) {
        const padding = needed.substring(minIndent);
        lines = lines.map(function (l, i) { return (i === 0 || !l.trim()) ? l : padding + l; });
        newT = lines.join('\n');
      }
    }
    devWorkspace[filename] = content.slice(0, currentLoc.startIndex) + newT + content.slice(currentLoc.endIndex);
    return { success: true, file: filename };
  }
  function devRefProblems(ws) {
      var out = [], m, re;
      function norm(p) { return String(p || '').replace(/\\/g, '/').replace(/^\.?\//, '').split('?')[0]; }
      function need(p, who) {
        var n = norm(p);
        if (!n || /^(https?:|data:|chrome-extension:|\/\/)/i.test(String(p))) return;
        if (!Object.prototype.hasOwnProperty.call(ws, n)) out.push(who + ' needs ' + n);
      }
      if (typeof ws['manifest.json'] === 'string') {
        var mf = null;
        try { mf = JSON.parse(ws['manifest.json']); } catch (e) { mf = null; }
        if (mf) {
          if (mf.background && mf.background.service_worker) need(mf.background.service_worker, 'manifest.json background');
          (mf.content_scripts || []).forEach(function (cs) {
            (cs.js || []).concat(cs.css || []).forEach(function (p) { need(p, 'manifest.json content script'); });
          });
        }
      }
      if (typeof ws['index.html'] === 'string') {
        re = /<script[^>]+src=["']([^"']+)["']/gi;
        while ((m = re.exec(ws['index.html']))) need(m[1], 'index.html script');
      }
      return out;
    }
    function devNewRefProblems(before, after) {
      var was = {};
      devRefProblems(before).forEach(function (x) { was[x] = 1; });
      var bad = devRefProblems(after).filter(function (x) { return !was[x]; });
      return bad.length ? '🛑 REFERENCE CHECK: ' + bad.join('; ') + '.\n\nThe patch was NOT applied and NOTHING WAS CHANGED. A file named in manifest.json or index.html would be missing: create it in the same patch (FILE header, empty OLD) or fix the reference.' : '';
    }
    function devDescribe(f, a, b) {
      if (a == null) return f + ' (new file, ' + b.split('\n').length + ' lines)';
      if (b == null) return f + ' (deleted)';
      const A = a.split('\n'), B = b.split('\n');
    let i = 0;
    while (i < A.length && i < B.length && A[i] === B[i]) i++;
    const d = B.length - A.length;
    const first = (B[i] || '').trim().slice(0, 60);
    return f + ' L' + (i + 1) + ' (' + (d >= 0 ? '+' : '') + d + ' lines)' + (first ? ': ' + first : '');
  }
  function devFail(msg) {
    devLog('PATCH', 'FAILED: ' + String(msg).slice(0, 300));
    devShowErr(msg);
    if (devNuts) devNutsSendError(String(msg), 'patch');
    return false;
  }
  // Applies every block to the workspace; on any failure the workspace is put back and nothing is saved.
  async function devApplyText(text) {
    if (devBusy) { devToast('⏳ Busy: try again in a moment'); return false; }
    if (!Object.keys(devWorkspace).length) { devToast('❌ No workspace linked'); return false; }
    devBusy = true;
    try {
      await devFreshen();
      const blocks = parseAllBlocks(text);
      if (!blocks.length) return devFail('No valid patch found.\nExpected:\n==== FILE: filename ====\nOLD code\n' + DEV_SPLIT + '\nNEW code\n\nSeparate several blocks with ' + DEV_BLOCK + '.');
      const MAX_LINE = 3000;
      for (let k = 0; k < blocks.length; k++) {
        let worst = 0;
        (blocks[k].newCode || '').split('\n').forEach(function (l) { if (l.length > worst) worst = l.length; });
        const b64 = /base64,[A-Za-z0-9+\/=]{2000,}/.test(blocks[k].newCode || '');
        if (worst > MAX_LINE || b64) {
          devToast('🚫 PATCH BLOCKED: line too long (' + worst + ' chars)', 8000);
          return devFail('🚫 PATCH BLOCKED (block ' + (k + 1) + ')\n\n' + (b64 ? 'It contains an embedded base64 blob.' : 'It has a line of ' + worst + ' characters (limit ' + MAX_LINE + ').') + '\n\nVery long lines cannot be split into parts, so the AI index could not show or request them.\n\nNOTHING WAS CHANGED. Keep that data in a separate file or use a normal multi-line format.');
        }
      }
      if (window.CloudSync) window.CloudSync.hold(10000);
      devLog('PATCH', 'Applying ' + blocks.length + ' block(s)');
      const before = Object.assign({}, devWorkspace);
      const restore = function () {
              Object.keys(devWorkspace).forEach(function (k) { if (!(k in before)) delete devWorkspace[k]; });
              Object.keys(before).forEach(function (k) { devWorkspace[k] = before[k]; });
            };
      for (let k = 0; k < blocks.length; k++) {
        const r = devApplyBlock(blocks[k]);
        if (!r.success) {
          restore();
          return devFail('Block ' + (k + 1) + ' of ' + blocks.length + ' failed: ' + r.error + '\n\nNOTHING WAS CHANGED (all blocks are applied together or not at all).');
        }
      }
      var allKeys = Object.keys(devWorkspace).concat(Object.keys(before).filter(function (k) { return !(k in devWorkspace); }));
            const changed = allKeys.filter(function (f) { return devWorkspace[f] !== before[f]; });
      if (!changed.length) { devToast('ℹ The patch changed nothing (NEW equals OLD)', 4000); return false; }
      const beforeMap = {};
      changed.forEach(function (f) { beforeMap[f] = (f in before) ? before[f] : null; });
      const guard = devGuardChanges(beforeMap);
      if (guard) { restore(); return devFail(guard); }
            var refBad = devNewRefProblems(before, devWorkspace);
            if (refBad) { restore(); return devFail(refBad); }
      const label = changed.map(function (f) { return devDescribe(f, before[f], devWorkspace[f]); }).join(' | ');
      await devCommit(beforeMap, label);
      devLog('PATCH', 'OK ' + blocks.length + ' block(s): ' + label);
      devToast('⚡ Patched ' + changed.join(', ') + '. Saving…', 4000);
      setTimeout(savePatchedFiles, 300);
      return true;
    } finally { devBusy = false; }
  }
  $('dev-btn-paste')?.addEventListener('click', async () => {
    if (Object.keys(devWorkspace).length === 0) {
      devToast('❌ No workspace linked');
      return;
    }
    let text = '';
    try { text = await navigator.clipboard.readText(); } catch (err) { text = ''; }
    if ((!text || text.indexOf(DEV_SPLIT) < 0) && devLastPatch) { text = devLastPatch; devToast('📋 Using the last patch from the AI reply', 2500); }
    if (!text || !text.trim()) {
      devToast('⚠️ Clipboard is empty or unreadable: copy the patch from the AI first');
      return;
    }
    devNutsSeen = '';
    if (await devApplyText(text)) devLastPatch = '';
  });
  async function devWriteFile(path, content) {
      var parts = path.split('/'), nm = parts.pop(), d = devDirHandle, i, fh, w;
      for (i = 0; i < parts.length; i++) d = await d.getDirectoryHandle(parts[i], { create: true });
      fh = await d.getFileHandle(nm, { create: true });
      w = await fh.createWritable();
      await w.write(content);
      await w.close();
    }
    async function devRemoveFile(path) {
      var parts = path.split('/'), nm = parts.pop(), d = devDirHandle, i, cloudOk = false, diskOk = false;
      if (d) {
        try {
          for (i = 0; i < parts.length; i++) d = await d.getDirectoryHandle(parts[i]);
          await d.removeEntry(nm);
          diskOk = true;
        } catch (e) {
          if (e && e.name === 'NotFoundError') diskOk = true;
          else devLog('ERROR', 'delete failed: ' + path + ' ' + ((e && e.message) || e));
        }
      }
      if (window.CloudSync && window.CloudSync.remove) {
        try { cloudOk = await window.CloudSync.remove(path); } catch (e2) { cloudOk = false; }
      }
      if (!diskOk && !cloudOk) devToast('⚠️ Could not delete ' + path + ': delete it by hand', 6000);
      else if (!diskOk) devToast('☁ Deleted in the cloud only: reconnect the folder to remove it here', 6000);
      return diskOk || cloudOk;
    }
    async function savePatchedFiles() {
    if (modifiedFilesToSave.size === 0) return;
    let savedCount = 0;
    let cloudOnly = 0;
    for (const filename of modifiedFilesToSave) {
            const content = devWorkspace[filename];
      if (content === undefined) { await devRemoveFile(filename); savedCount++; continue; }
      if (content) {
        let cloudOk = false;
        if (window.CloudSync) {
          try { cloudOk = await window.CloudSync.push(filename, content); } catch (e) { cloudOk = false; }
        }
        let directWriteSuccess = false;
        if (devDirHandle) {
          try {
            await devWriteFile(filename, content);
            savedCount++;
            directWriteSuccess = true;
          } catch (e) {
            console.warn('Direct write failed', e);
          }
        }
        if (!directWriteSuccess && cloudOk) {
          savedCount++;
          cloudOnly++;
        } else if (!directWriteSuccess) {
          const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(url), 10000);
          savedCount++;
        }
      }
    } // Only files loaded by the extension itself (not the page) need a full extension reload.
        const needsExtReload = Array.from(modifiedFilesToSave).some(function (f) {
      return f === 'background.js' || f === 'manifest.json' || f === 'rules.json' || /^content-.*\.js$/.test(f);
    });
    devLog('PATCH', 'Saved ' + savedCount + ' file(s): ' + Array.from(modifiedFilesToSave).join(', ') + ' | full extension reload: ' + needsExtReload);
    modifiedFilesToSave.clear();
    if (cloudOnly > 0 && cloudOnly === savedCount) {
      devToast('☁ Saved to the cloud. Folder not connected: reconnect it to apply the files here.', 6000);
      return;
    }
    try { sessionStorage.setItem('split-view:dev-pending', JSON.stringify({ t: Date.now() })); } catch (e) {}
    devToast(`✅ Saved ${savedCount} file(s)! Reloading...`, 2000);
    setTimeout(() => {
      if (needsExtReload && typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ type: 'RELOAD_APP' }, function () {
          // Reading lastError marks it handled; if no one answered, just reload the page.
          if (chrome.runtime.lastError) window.location.reload();
        });
      } else {
        window.location.reload();
      }
    }, 1500);
  }
  // ════════ DEV AI LOOP ════════
  function devNutsApply(patch, fin) {
    clearTimeout(devNutsTimer);
    devToast(fin ? '🥜 Reply finished: applying patch…' : '🥜 Making sure the reply is complete…', 3000);
    devNutsTimer = setTimeout(function () {
      devNutsTimer = 0;
      if (!devNuts) return;
      const sig = patch.length + ':' + patch.slice(0, 60) + ':' + patch.slice(-60);
      if (sig === devNutsSeen) { devToast('🥜 Same patch already applied, skipped', 3000); return; }
      devNutsSeen = sig;
      devApplyText(patch);
    }, fin ? 2000 : 6000);
  }
  // kind: 'patch' (not applied, nothing changed) or 'runtime' (applied, but the page throws)
  function devNutsSendError(msg, kind, extra) {
    if (!devNuts) return;
    if (devTries + 1 > DEV_ERR_MAX) { devToast('🥜 Auto-fix stopped after ' + DEV_ERR_MAX + ' failed tries: fix it by hand (use Copy error)', 8000); return; }
    devSetTries(devTries + 1);
    devNutsSeen = '';
    let r;
    if (kind === 'runtime') {
      r = 'RUNTIME ERROR after your last patch: the patch was applied and saved, but the extension page now throws.\n\n' + msg + '\n\n' + (extra ? 'CODE AROUND THE ERROR:\n\n' + extra + '\n\n' : '') +
        'Find the cause and resend a corrected patch in the same format: the WHOLE patch in ONE fenced code block (==== FILE: name ==== header, OLD' + DEV_SPLIT + 'NEW, no prose inside the fence), plus at most one plain sentence before the fence naming the confirmed cause. Nothing after the fence.';
    } else {
      r = 'PATCH ERROR: your last patch was NOT applied and nothing was changed (all blocks are applied together or not at all).\n\nError: ' + msg;
      if (/^(Block \d+ of \d+ failed: )?(Chunk not found|Ambiguous|Low confidence)/.test(msg) && devFailOld) {
        try { r += '\n\nCURRENT CODE (copy the OLD text from here exactly):\n\n' + liteSource(devFailOld); } catch (e) {}
      }
      r += '\n\nFix it and resend ALL blocks of the corrected patch in the same format: the WHOLE patch in ONE fenced code block (==== FILE: name ==== header, OLD' + DEV_SPLIT + 'NEW, ' + DEV_BLOCK + ' between blocks, no prose inside the fence), plus at most one plain sentence before the fence naming the confirmed cause. Nothing after the fence.';
    }
    devToast('🥜 ' + (kind === 'runtime' ? 'Runtime error after the patch' : 'Patch failed') + ': sending it to the AI (try ' + devTries + '/' + DEV_ERR_MAX + ')', 4000);
    setTimeout(function () {
      devSendAIWait(r, 0);
      try { const p = document.getElementById('dev-err-popup'); if (p) p.remove(); } catch (e) {}
    }, 500);
  }
  function devFire(tags) {
    tags.forEach(function (t) { if (devTags.indexOf(t) < 0) devTags.push(t); });
    const p = devMakePayload((devReq + ' ' + devTags.join(' ')).trim());
    if (!p) return;
    devToast('⚡ Auto-patch: ' + devTags.length + ' part(s) tagged, building the payload', 2500);
    devDeliver(p.text, false);
  }
  function devOnReply(d) {
    const text = d.aiReply;
    const codes = (d.aiCode || []).filter(function (c) { return c.indexOf(DEV_SPLIT) >= 0; });
    const patch = codes.length ? codes.join('\n' + DEV_BLOCK + '\n') : (text.indexOf(DEV_SPLIT) >= 0 ? text : '');
    if (patch) {
      devLastPatch = patch;
            if (devNuts) devNutsApply(patch, d.aiFinal === true);
      else devToast(devAuto ? '📋 Patch ready: copy the AI reply and it applies by itself (or press ⌘)' : '📋 Patch ready: press ⌘ to apply it', 5000);
      return;
    }
    if (text.length > 4000 || text.indexOf('LITE MODE') >= 0 || text.indexOf('INDEX MODE') >= 0 || text.indexOf('PATCH ERROR') >= 0) return;
    const found = (text.match(/@[\w$-]+/g) || []).filter(function (t, i, a) { return a.indexOf(t) === i && devKnownTag(t); });
    if (!found.length) return;
    const sig = text.length + ':' + text.slice(-80);
    if (sig === devSeenReply) return;
    devSeenReply = sig;
    const req = text.replace(/@[\w$-]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (req) devSetReq(req);
    devFire(found);
  }
  window.addEventListener('message', function (e) {
    const d = e.data;
    if (!d || typeof d !== 'object' || typeof d.aiReply !== 'string') return;
        if (!(devAuto || devNuts) || !paneFromSource(e.source)) return;
      devOnReply(d);
    });
    // ════════ DEV CLIPBOARD WATCH (auto mode works like the HTML tool: copy the AI reply = next step runs by itself) ════════
    (function devClipWatch() {
      let seen = null, reading = false;
      setInterval(function () {
        if (!devAuto) seen = null;
        if (!devAuto || devNuts || devBusy || reading) return;
        if (!Object.keys(devWorkspace).length) return;
        reading = true;
        navigator.clipboard.readText().then(function (text) {
          reading = false;
          text = text || '';
          if (seen === null) { seen = text; return; }
          if (text === seen) return;
          seen = text;
          if (!text.trim() || /^\s*PATCH ERROR/.test(text) || text.indexOf('LITE MODE') >= 0 || text.indexOf('INDEX MODE') >= 0 || text.indexOf('Surgery Scenarios') >= 0) return;
          if (text.indexOf(DEV_SPLIT) >= 0) {
            devLastPatch = text;
            devNutsSeen = '';
            devApplyText(text).then(function (ok) {
              if (ok) { devLastPatch = ''; devSetReq(''); devTags = []; devSeenReply = ''; }
            });
            return;
          }
          if (text.length > 4000) return;
          const found = (text.match(/@[\w$-]+/g) || []).filter(function (t, i, a) { return a.indexOf(t) === i && devKnownTag(t); });
          if (!found.length) return;
          const sig = text.length + ':' + text.slice(-80);
          if (sig === devSeenReply) return;
          devSeenReply = sig;
          const req = text.replace(/@[\w$-]+/g, ' ').replace(/\s+/g, ' ').trim();
          if (req) devSetReq(req);
          devFire(found);
        }, function () { reading = false; });
      }, 700);
    })();
  // ════════ DEV WATCH ════════
  (function devWatchStart() {
    let pend = null;
    try { pend = JSON.parse(sessionStorage.getItem('split-view:dev-pending') || 'null'); sessionStorage.removeItem('split-view:dev-pending'); } catch (e) { pend = null; }
    if (!pend || !pend.t || Date.now() - pend.t > 120000) return;
    setTimeout(function () {
      const errs = devSessionErrors();
      if (!errs.length) {
        devSetTries(0);
        devToast('✅ Patched files loaded without errors', 3000);
        return;
      }
      let chunks = [];
      try { chunks = liteBuild(); } catch (e0) {}
      const txt = errs.slice(0, 5).map(function (e) { return devFmtErr(e, chunks); }).join('\n');
      devToast('⚠️ New error after the patch (' + errs.length + '): ' + errs[0].m.slice(0, 60), 6000);
      if (!devNuts) return;
      let extra = '';
      try {
        const e1 = errs[0];
        const hit = chunks.filter(function (ch) { return ch.file === e1.f && e1.l >= ch.s && e1.l <= ch.e; })[0];
        if (hit) extra = '=== PART ' + hit.n + ' ' + hit.file + ' (lines ' + hit.s + '-' + hit.e + ') ===\n' + hit.t;
      } catch (e2) {}
      devNutsSendError(txt, 'runtime', extra);
    }, 6000);
  })();
  // ════════ DEV TOOLS ════════
  function devEsc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function devScan() {
    const box = $('dev-instruction');
    const instr = box ? box.value.trim() : '';
    if (!Object.keys(devWorkspace).length) { devToast('❌ No files loaded'); return; }
    if (!instr) { devToast('⚠️ Type what to find in the instruction box first'); return; }
    const pats = [], labels = [];
    (instr.match(/#[0-9a-f]{3,8}\b/gi) || []).forEach(function (h) {
      const hex = h.slice(1);
      pats.push('(?:^|[^0-9a-f])' + devEsc(hex) + '(?![0-9a-f])');
      labels.push(h);
      if (hex.length === 6) {
        const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
        pats.push('(?:^|[^0-9])' + r + '\\s*,\\s*' + g + '\\s*,\\s*' + b + '(?![0-9])');
        labels.push('rgb(' + r + ',' + g + ',' + b + ')');
      }
    });
    if (!pats.length) {
      (instr.match(/`[^`]+`|"[^"]+"|'[^']+'/g) || []).forEach(function (q) { pats.push(devEsc(q.slice(1, -1))); labels.push(q.slice(1, -1)); });
    }
    if (!pats.length) { pats.push(devEsc(instr)); labels.push(instr); }
    let re;
    try { re = new RegExp(pats.join('|'), 'gi'); } catch (e) { devToast('❌ Bad search term'); return; }
    const chunks = liteBuild();
    const units = chunks.map(function (ch) {
      return { label: 'PART ' + ch.n + ' ' + ch.file + ' (L' + ch.s + '-' + ch.e + ')', tag: '@part' + ch.n, t: ch.t, s: ch.s, names: ch.names };
    });
    Object.keys(devWorkspace).forEach(function (f) {
      if (!chunks.some(function (c) { return c.file === f; })) units.push({ label: 'FILE ' + f + ' (small, always sent whole)', tag: '', t: devWorkspace[f], s: 1, names: [] });
    });
    const hits = [];
    let total = 0;
    units.forEach(function (u) {
      let cnt = 0, m;
      const lns = [];
      re.lastIndex = 0;
      while ((m = re.exec(u.t)) !== null) {
        cnt++;
        if (m[0].length === 0) re.lastIndex++;
        const ln = u.s + u.t.slice(0, m.index + m[0].length - 1).split('\n').length - 1;
        if (lns.length < 8 && lns.indexOf(ln) < 0) lns.push(ln);
      }
      if (cnt) { total += cnt; hits.push({ u: u, cnt: cnt, lns: lns }); }
    });
    const out = ['SCAN REPORT', 'Searched: ' + labels.join('  |  '), 'Files: ' + Object.keys(devWorkspace).length + ', big-file parts: ' + chunks.length, 'Found ' + total + ' matches in ' + hits.length + ' places:', ''];
    hits.forEach(function (h) {
      out.push(h.u.label + ' x' + h.cnt + (h.u.names.length ? ' [' + h.u.names.slice(0, 3).join(', ') + ']' : '') + ' lines: ' + h.lns.join(', '));
    });
    const tags = hits.filter(function (h) { return h.u.tag; }).map(function (h) { return h.u.tag; });
    if (tags.length) out.push('', 'TAGS: ' + tags.join(' '));
    if (!hits.length) out.push('No literal matches found.');
    devCopyText(out.join('\n'), function (ok) { devToast(ok ? '🔍 Scan report copied: paste it to the AI' : '❌ Failed to copy report'); });
  }
  // old => new in every js / html / css file (manifest.json and rules.json are never touched this way)
  async function devReplaceAll() {
    const box = $('dev-instruction');
    const halves = (box ? box.value : '').split('=>');
    if (halves.length !== 2) { devToast('⚠️ Type it like:  old => new'); return; }
    const from = halves[0].trim(), to = halves[1].trim();
    if (!from) { devToast('⚠️ Nothing to find before =>'); return; }
    if (!Object.keys(devWorkspace).length) { devToast('❌ No files loaded'); return; }
    if (devBusy) return;
    devBusy = true;
    try {
      await devFreshen();
      const hf = from.match(/^#([0-9a-f]{6})$/i), ht = to.match(/^#([0-9a-f]{6})$/i);
      const before = {}, per = [];
      let total = 0;
      Object.keys(devWorkspace).forEach(function (f) {
        if (!/\.(js|html|css)$/i.test(f)) return;
        const text = devWorkspace[f];
        let cnt = 0;
        let out = text.replace(new RegExp(devEsc(from), hf ? 'gi' : 'g'), function () { cnt++; return to; });
        if (hf && ht) {
          const a = [0, 2, 4].map(function (i) { return parseInt(hf[1].substr(i, 2), 16); });
          const b = [0, 2, 4].map(function (i) { return parseInt(ht[1].substr(i, 2), 16); });
          const re = new RegExp('(rgba?\\(\\s*)' + a[0] + '\\s*,\\s*' + a[1] + '\\s*,\\s*' + a[2] + '(?![0-9])', 'gi');
          out = out.replace(re, function (all, pre) { cnt++; return pre + b[0] + ',' + b[1] + ',' + b[2]; });
        }
        if (cnt) { before[f] = text; devWorkspace[f] = out; per.push(f + ' x' + cnt); total += cnt; }
      });
      if (!total) { devToast('ℹ No matches found for: ' + from); return; }
      const guard = devGuardChanges(before);
      if (guard) {
        Object.keys(before).forEach(function (f) { devWorkspace[f] = before[f]; });
        devShowErr(guard);
        return;
      }
      if (window.CloudSync) window.CloudSync.hold(10000);
      await devCommit(before, 'replace everywhere: ' + from.slice(0, 30) + ' => ' + to.slice(0, 30) + ' (' + per.join(', ') + ')');
      devToast('🔁 Replaced ' + total + ' matches (' + per.join(', ') + '). ↶ undoes it', 4000);
      setTimeout(savePatchedFiles, 300);
    } finally { devBusy = false; }
  }
  async function devAddTagsFromClipboard() {
    let text = '';
    try { text = await navigator.clipboard.readText(); } catch (err) { devToast("❌ Couldn't read clipboard"); return; }
    const found = text.match(/@[\w$-]+/g) || [];
    if (!found.length) { devToast('ℹ No @tags found in clipboard'); return; }
    const box = $('dev-instruction');
    if (!box) return;
    const have = (box.value.match(/@[\w$-]+/g) || []).map(function (x) { return x.toLowerCase(); });
    const add = found.filter(function (t, i) { return found.indexOf(t) === i && have.indexOf(t.toLowerCase()) < 0; });
    if (!add.length) { devToast('ℹ Those tags are already in the box'); return; }
    box.value = (box.value.trim() + ' ' + add.join(' ')).trim();
    devToast('📎 Added ' + add.length + ' tag(s): press ▲');
  }
  // Parts map: every part of the big files as a header you tap to add / remove its @part tag
  const devMap = { ov: null, scroller: null, search: null, count: null, heads: [], open: false, chunks: [], btn: null };
  function devMapIsOn(n) {
    const box = $('dev-instruction');
    return !!box && new RegExp('(^|\\s)@part' + n + '(?=\\s|$)').test(box.value);
  }
  function devMapToggle(n) {
    const box = $('dev-instruction');
    if (!box) return;
    let v = box.value;
    const re = new RegExp('(^|\\s)@part' + n + '(?=\\s|$)');
    if (re.test(v)) v = v.replace(re, '');
    else v = v + ((v && !/\s$/.test(v)) ? ' ' : '') + '@part' + n;
    box.value = v;
    devMapPaint();
  }
  function devMapPaint() {
    let on = 0;
    devMap.heads.forEach(function (h) {
      const s = devMapIsOn(h.n);
      if (s) on++;
      h.el.style.background = s ? '#FFD700' : '#E2E8F0';
      h.el.style.color = '#000432';
    });
    if (devMap.count) devMap.count.textContent = on + ' tagged';
  }
  function devDedent(text) {
    const lines = text.split('\n');
    let min = 1e9;
    lines.forEach(function (l) { if (!l.trim()) return; const k = l.match(/^[ \t]*/)[0].length; if (k < min) min = k; });
    if (min === 1e9 || min === 0) return text;
    return lines.map(function (x) { return x.slice(Math.min(min, x.length - x.replace(/^[ \t]+/, '').length)); }).join('\n');
  }
  function devMk(tag, css, txt) { const e = document.createElement(tag); if (css) e.style.cssText = css; if (txt !== undefined) e.textContent = txt; return e; }
  function devMapRender() {
    const q = (devMap.search.value || '').toLowerCase().trim().replace(/^@/, '');
    devMap.scroller.textContent = '';
    devMap.heads = [];
    let shown = 0;
    const preview = function (ch) {
      const ls = ch.t.split('\n').filter(function (x) { return x.trim(); }).slice(0, 5);
      return devDedent(ls.join('\n')).split('\n').map(function (x) { return x.length > 140 ? x.slice(0, 140) + '…' : x; }).join('\n') + '\n…';
    };
    devMap.chunks.forEach(function (ch) {
      const label = ch.names.slice(0, 8).join(', ');
      if (q && ('part' + ch.n).indexOf(q) < 0 && ch.file.toLowerCase().indexOf(q) < 0 && label.toLowerCase().indexOf(q) < 0 && ch.low.indexOf(q) < 0) return;
      shown++;
      const sec = devMk('div', 'margin:0 0 10px;');
      const hd = devMk('div', 'position:sticky;top:0;z-index:2;cursor:pointer;padding:8px 14px;font-weight:800;font-size:12px;border-radius:999px;margin:0 6px 4px;word-break:break-word;', '@part' + ch.n + '   ·   ' + ch.file + ' L' + ch.s + '-' + ch.e + (label ? '   ·   ' + label : ''));
      hd.addEventListener('click', function () { devMapToggle(ch.n); });
      const pre = devMk('pre', 'margin:0 10px;padding:6px 10px;background:rgba(255,255,255,0.08);color:#fff;border-radius:10px;font-size:11px;white-space:pre;overflow-x:auto;cursor:zoom-in;user-select:text;-webkit-user-select:text;', preview(ch));
      let expanded = false;
      pre.addEventListener('click', function () {
        expanded = !expanded;
        if (expanded) { pre.textContent = devDedent(ch.t); pre.style.maxHeight = '60vh'; pre.style.overflow = 'auto'; pre.style.cursor = 'zoom-out'; }
        else { pre.textContent = preview(ch); pre.style.maxHeight = ''; pre.style.overflow = ''; pre.style.overflowX = 'auto'; pre.style.cursor = 'zoom-in'; }
      });
      sec.appendChild(hd);
      sec.appendChild(pre);
      devMap.scroller.appendChild(sec);
      devMap.heads.push({ n: ch.n, el: hd });
    });
    if (!shown) devMap.scroller.appendChild(devMk('div', 'padding:20px;text-align:center;color:#fff;', 'No part matches.'));
    devMapPaint();
  }
  function devMapClose() {
    if (devMap.ov) devMap.ov.style.display = 'none';
    devMap.open = false;
    if (devMap.btn) devMap.btn.classList.remove('dv-on');
  }
  function devMapOpen() {
    if (!Object.keys(devWorkspace).length) { devToast('❌ No files loaded'); return; }
    devMap.chunks = liteBuild();
    if (!devMap.chunks.length) { devToast('ℹ️ All files are under ' + LITE_MIN_LINES + ' lines: they are sent whole (no parts)', 4000); return; }
    if (!devMap.ov) {
      const ov = devMk('div', 'position:fixed;left:0;right:0;top:0;bottom:0;z-index:2147483000;background:#000432;display:none;flex-direction:column;font-family:monospace;color:#fff;');
      const head = devMk('div', 'display:flex;gap:6px;align-items:center;padding:8px;border-bottom:1px solid #fff;flex-wrap:wrap;');
      head.appendChild(devMk('b', 'font-size:13px;', '🧩 PARTS MAP'));
      const search = devMk('input', 'flex:1 1 140px;min-width:0;background:#E2E8F0;color:#000432;border:none;border-radius:999px;padding:5px 12px;font-size:12px;');
      search.placeholder = 'search file / name / code / part number...';
      search.addEventListener('input', devMapRender);
      const count = devMk('span', 'font-size:11px;', '0 tagged');
      const pill = 'background:transparent;color:#fff;border:1px solid #fff;border-radius:999px;padding:4px 10px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;';
      const bClr = devMk('button', pill, 'CLEAR');
      bClr.addEventListener('click', function () {
        const box = $('dev-instruction');
        if (box) box.value = box.value.replace(/(^|\s)@part\d+(?=\s|$)/g, '').replace(/^\s+/, '');
        devMapPaint();
      });
      const bClose = devMk('button', pill, '✕');
      bClose.addEventListener('click', devMapClose);
      [search, count, bClr, bClose].forEach(function (x) { head.appendChild(x); });
      const hint = devMk('div', 'padding:4px 10px;font-size:10px;opacity:0.8;', 'Tap a header = add or remove its @part tag in the instruction box. Tap the code below it = expand / collapse. Files under ' + LITE_MIN_LINES + ' lines are always sent whole.');
      const scroller = devMk('div', 'flex:1 1 auto;overflow:auto;padding:6px 0;');
      ov.appendChild(head); ov.appendChild(hint); ov.appendChild(scroller);
      document.body.appendChild(ov);
      devMap.ov = ov; devMap.scroller = scroller; devMap.search = search; devMap.count = count;
      const box = $('dev-instruction');
      if (box) box.addEventListener('input', function () { if (devMap.open) devMapPaint(); });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && devMap.open) devMapClose(); });
    }
    devMap.search.value = '';
    devMapRender();
    devMap.ov.style.display = 'flex';
    devMap.open = true;
    if (devMap.btn) devMap.btn.classList.add('dv-on');
  }
    // ════════ DEV PUSH TO GITHUB (⬆) ════════
  // One tap: compares the workspace with the repo and pushes only the changed text files as ONE commit.
  const DEV_GH = { owner: '888znq', repo: 'EXTOS', branch: 'main' };
  const DEV_GH_TEXT = /\.(js|html|json|css)$/i;
  let devPushBusy = false;
  async function devGhToken(force) {
    let tok = '';
    if (!force) {
      try { tok = localStorage.getItem('split-view:gh-token') || ''; } catch (e) {}
      if (!tok) {
        try {
          const base = (window.SPLIT_FIREBASE_CONFIG && window.SPLIT_FIREBASE_CONFIG.databaseURL) || '';
          if (base) {
            const r = await fetch(base.replace(/\/$/, '') + '/aicompiler/gh_config.json', { cache: 'no-store' });
            const c = r.ok ? await r.json() : null;
            if (c && typeof c === 'object') tok = String(c.token || c.pat || c.ghToken || c.gh_token || c.github_token || '').trim();
            else if (typeof c === 'string') tok = c.trim();
          }
        } catch (e) {}
      }
    }
    if (!tok) tok = String(window.prompt('GitHub token for ' + DEV_GH.owner + '/' + DEV_GH.repo + ' (needs contents: write):') || '').trim();
    if (tok) { try { localStorage.setItem('split-view:gh-token', tok); localStorage.removeItem('split-view:gh-reprompt'); } catch (e) {} }
    return tok;
  }
  async function devGh(token, method, path, body) {
    const headers = { 'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    if (body) headers['Content-Type'] = 'application/json';
    const res = await fetch('https://api.github.com/repos/' + DEV_GH.owner + '/' + DEV_GH.repo + path, {
      method: method, cache: 'no-store', headers: headers, body: body ? JSON.stringify(body) : undefined
    });
    let data = null;
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) {
      const err = new Error(method + ' ' + path.split('?')[0] + ' -> ' + res.status + ' ' + ((data && data.message) || res.statusText));
      err.status = res.status;
      throw err;
    }
    return data;
  }
  async function devGitBlobSha(text) {
    const enc = new TextEncoder();
    const body = enc.encode(text);
    const head = enc.encode('blob ' + body.length + '\0');
    const all = new Uint8Array(head.length + body.length);
    all.set(head, 0);
    all.set(body, head.length);
    const dig = await crypto.subtle.digest('SHA-1', all);
    return Array.from(new Uint8Array(dig)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }
  async function devPushToGitHub(ev) {
    if (devPushBusy) return;
    const btn = $('dev-btn-push');
    if (!Object.keys(devWorkspace).length) { devToast('⚠ Link the project folder first: nothing to push', 4000); return; }
    devPushBusy = true;
    if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
    try {
      let reprompt = false;
      try { reprompt = localStorage.getItem('split-view:gh-reprompt') === '1'; } catch (e) {}
      const token = await devGhToken(!!(ev && ev.shiftKey) || reprompt);
      if (!token) { devToast('⬆ Push cancelled: no GitHub token', 3500); return; }
      devToast('⬆ Comparing with ' + DEV_GH.owner + '/' + DEV_GH.repo + '…', 4000);
      const ref = await devGh(token, 'GET', '/git/ref/heads/' + DEV_GH.branch);
      const headSha = ref.object.sha;
      const headCommit = await devGh(token, 'GET', '/git/commits/' + headSha);
      const baseTree = headCommit.tree.sha;
      const tree = await devGh(token, 'GET', '/git/trees/' + baseTree + '?recursive=1');
      if (tree.truncated) throw new Error('The repo tree is too large to compare in one request');
      const remote = {};
      tree.tree.forEach(function (e) { if (e.type === 'blob') remote[e.path] = e; });
      const entries = [], changed = [];
      const names = Object.keys(devWorkspace).filter(function (f) { return DEV_GH_TEXT.test(f) && f.indexOf('..') < 0; });
      for (const f of names) {
        const text = String(devWorkspace[f]).replace(/\r\n/g, '\n');
        const r = remote[f];
        if (r && r.sha === await devGitBlobSha(text)) continue;
        changed.push(f);
        entries.push({ path: f, mode: r ? r.mode : '100644', type: 'blob', content: text });
      }
      const remoteText = Object.keys(remote).filter(function (p) { return p.indexOf('/') < 0 && DEV_GH_TEXT.test(p); });
      const removed = remoteText.filter(function (p) { return !(p in devWorkspace); });
      if (removed.length > Math.max(2, Math.floor(remoteText.length / 3))) {
        throw new Error('Not pushing: ' + removed.length + ' repo files are missing from the workspace (' + removed.slice(0, 6).join(', ') + '). Re-link the folder and try again.');
      }
      removed.forEach(function (p) { entries.push({ path: p, mode: remote[p].mode, type: 'blob', sha: null }); });
      if (!entries.length) { devToast('⬆ Nothing to push: GitHub already matches', 4000); return; }
      const newTree = await devGh(token, 'POST', '/git/trees', { base_tree: baseTree, tree: entries });
      const shown = changed.concat(removed.map(function (p) { return '-' + p; }));
      const msg = 'EXT OS patch: ' + shown.slice(0, 5).join(', ') + (shown.length > 5 ? ' +' + (shown.length - 5) + ' more' : '');
      const commit = await devGh(token, 'POST', '/git/commits', { message: msg, tree: newTree.sha, parents: [headSha] });
      await devGh(token, 'PATCH', '/git/refs/heads/' + DEV_GH.branch, { sha: commit.sha });
      devLog('PUSH', msg + ' | ' + commit.sha);
      devToast('⬆ Pushed ' + entries.length + ' file(s) to ' + DEV_GH.branch + ' (' + commit.sha.slice(0, 7) + ')', 5000);
    } catch (e) {
      const m = String((e && e.message) || e);
      if (e && e.status === 401) { try { localStorage.setItem('split-view:gh-reprompt', '1'); } catch (x) {} }
      try { devLog('ERROR', 'PUSH ERROR: ' + m); } catch (x) {}
      devToast('⚠ Push failed: see the error box', 5000);
      devErrPopup('PUSH ERROR', m + (e && e.status === 401 ? '\nToken rejected: press ⬆ again and enter a new one.' : ''));
    } finally {
      devPushBusy = false;
      if (btn) { btn.disabled = false; btn.textContent = '⬆'; }
    }
  }
  // ════════ DEV BUTTONS ════════
  (function devInitButtons() {
    const bar = $('dev-control-bar');
    const payloadBtn = $('dev-btn-payload');
    const pasteBtn = $('dev-btn-paste');
    if (!bar || !payloadBtn || !pasteBtn) return;
    const css = document.createElement('style');
    css.textContent =
      '#dev-control-bar .dev-btn.dv-x { font-size: 14px; font-weight: 400; font-family: system-ui, -apple-system, "Segoe UI", "Segoe UI Emoji", sans-serif; line-height: 1; }' +
      '#dev-control-bar .dev-btn.dv-x:disabled { opacity: 0.35; cursor: default; }' +
      '#dev-control-bar .dev-btn.dv-x.dv-on { background: #7df5c0; color: #000432; }' +
      '#dev-control-bar .dev-btn.dv-x.dv-nuts.dv-on { background: #ff4d4d; color: #ffffff; animation: dvPulse 1s ease-in-out infinite alternate; }' +
      '@keyframes dvPulse { from { opacity: 0.6; } to { opacity: 1; } }';
    document.head.appendChild(css);
    const mkBtn = function (id, txt, title) {
      const b = document.createElement('button');
      b.id = id; b.type = 'button'; b.className = 'dev-btn dv-x'; b.textContent = txt; b.title = title; b.setAttribute('aria-label', title);
      return b;
    };
    const autoBtn = mkBtn('dev-btn-auto', '⚡', '');
    const nutsBtn = mkBtn('dev-btn-nuts', '🥜', '');
    nutsBtn.classList.add('dv-nuts');
    payloadBtn.parentNode.insertBefore(autoBtn, payloadBtn.nextSibling);
    payloadBtn.parentNode.insertBefore(nutsBtn, autoBtn.nextSibling);
    let ref = pasteBtn;
    const after = function (el) { ref.parentNode.insertBefore(el, ref.nextSibling); ref = el; return el; };
    const tagsBtn = after(mkBtn('dev-btn-tags', '📎', 'Copy the AI reply first, then press: adds its @tags to the instruction box'));
    const scanBtn = after(mkBtn('dev-btn-scan', '🔍', 'Scan every file for the text in the instruction box and copy a report'));
    const repBtn = after(mkBtn('dev-btn-replace', '🔁', 'Replace everywhere (js, html, css): type  old => new  in the instruction box'));
    const mapBtn = after(mkBtn('dev-btn-map', '🧩', 'Parts map: tap any @part to add/remove it in the instruction box'));
    const undoBtn = after(mkBtn('dev-btn-undo', '↶', 'Undo'));
        const redoBtn = after(mkBtn('dev-btn-redo', '↷', 'Redo'));
    const pushBtn = after(mkBtn('dev-btn-push', '⬆', 'Push changed files to GitHub (' + DEV_GH.owner + '/' + DEV_GH.repo + ', ' + DEV_GH.branch + ') in one commit. Shift+click = enter a new token'));
    devMap.btn = mapBtn;
        function paintAuto() {
      pasteBtn.style.display = (devAuto || devNuts) ? 'none' : '';
      autoBtn.title = devAuto ? 'Auto-patch ON: an AI reply with @parts builds the payload by itself, a reply with a patch waits for ⌘. Click to turn OFF' : 'Auto-patch OFF. Click to turn ON (AI loop: a reply with @parts builds the payload by itself)';
    }
    function paintNuts() {
      nutsBtn.classList.toggle('dv-on', devNuts);
      nutsBtn.title = 'Total nuts mode (' + (devNuts ? 'ON' : 'OFF') + '): auto-paste into the AI, keep it scrolled until the reply is complete, apply the patch, send errors back';
    }
    autoBtn.addEventListener('click', function () {
      devAuto = !devAuto;
      try { localStorage.setItem('split-view:dev-auto', String(devAuto)); } catch (e) {}
      paintAuto();
      devToast(devAuto ? '⚡ Auto-patch ON: type your request and press ▲' : '🖐 Auto-patch OFF', 3000);
    });
    nutsBtn.addEventListener('click', function () {
      devNuts = !devNuts;
      clearTimeout(devNutsTimer);
      devNutsTimer = 0;
      devNutsSeen = '';
      try { sessionStorage.setItem('split-view:dev-nuts', devNuts ? '1' : '0'); } catch (e) {}
      if (devNuts) devSetTries(0);
      devPostNuts(devNuts);
      paintNuts();
      paintAuto();
      devToast(devNuts ? '🥜 NUTS MODE ON: auto paste + auto patch after the full reply' : '🖐 Nuts mode OFF', 4000);
    });
    tagsBtn.addEventListener('click', devAddTagsFromClipboard);
    scanBtn.addEventListener('click', devScan);
    repBtn.addEventListener('click', devReplaceAll);
    mapBtn.addEventListener('click', function () { if (devMap.open) devMapClose(); else devMapOpen(); });
    undoBtn.addEventListener('click', function () { devStep(devHist.undo, devHist.redo, 'undo'); });
        redoBtn.addEventListener('click', function () { devStep(devHist.redo, devHist.undo, 'redo'); });
    pushBtn.addEventListener('click', devPushToGitHub);
    paintAuto();
    paintNuts();
    devUndoUi();
    if (devNuts) setTimeout(function () { devPostNuts(true); }, 1500);
  })();
  devHistLoad();
  (function devShotInit() {
      var mapBtn = $('dev-btn-map'), ins = $('dev-instruction');
      if (!mapBtn || !mapBtn.parentNode || !ins) return;
      var isOpen = false, drawing = false, boxes = [], cur = null, sx = 0, sy = 0;
      var btn = document.createElement('button');
      btn.id = 'dev-btn-shot';
      btn.type = 'button';
      btn.className = 'dev-btn dv-x';
      btn.textContent = '📷';
      btn.title = 'Screenshot facts: draw boxes over the UI; the elements under them (styles, what covers them, code parts) go into the next payload and their @parts are tagged';
      btn.setAttribute('aria-label', 'Screenshot facts');
      mapBtn.parentNode.insertBefore(btn, mapBtn.nextSibling);
      var ov = document.createElement('div');
      ov.style.cssText = 'position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483200;display:none;cursor:crosshair;background:rgba(0,0,0,0.25);touch-action:none;outline:2px dashed #ffffff;outline-offset:-2px;';
      var bar = document.createElement('div');
      bar.style.cssText = 'position:fixed;z-index:2147483201;top:8px;left:50%;transform:translateX(-50%);display:none;gap:6px;align-items:center;background:#000432;border:1px solid #ffffff;border-radius:999px;padding:5px 10px;color:#ffffff;font:700 11px monospace;';
      bar.innerHTML = '<span>Drag boxes over the UI</span><button type="button" data-a="undo" title="Remove last box">↶</button><button type="button" data-a="done" title="Collect the facts">✓ Done</button><button type="button" data-a="clear" title="Remove the stored facts">🗑</button><button type="button" data-a="x" title="Cancel">✕</button>';
      document.body.appendChild(ov);
      document.body.appendChild(bar);
      Array.prototype.forEach.call(bar.querySelectorAll('button'), function (b) {
        b.style.cssText = 'background:transparent;border:1px solid #ffffff;color:#ffffff;padding:3px 10px;border-radius:999px;font:700 11px monospace;cursor:pointer;';
      });
      function place(d, b) { d.style.left = b.x + 'px'; d.style.top = b.y + 'px'; d.style.width = b.w + 'px'; d.style.height = b.h + 'px'; }
      function mkBox(b) {
        var d = document.createElement('div');
        d.style.cssText = 'position:absolute;border:2px solid #ff2d2d;background:rgba(255,45,45,0.15);pointer-events:none;';
        place(d, b);
        ov.appendChild(d);
        return d;
      }
      function clearBoxes() {
        boxes.forEach(function (b) { if (b.el && b.el.parentNode) b.el.parentNode.removeChild(b.el); });
        boxes = [];
      }
      function paintBtn(on) { btn.style.background = on ? '#FFD700' : ''; btn.style.color = on ? '#000432' : ''; }
      window.__devShotClear = function () { paintBtn(false); };
      function closeShot() {
        ov.style.display = 'none';
        bar.style.display = 'none';
        isOpen = false;
        drawing = false;
        cur = null;
        clearBoxes();
      }
      function openShot() {
        clearBoxes();
        ov.style.display = 'block';
        bar.style.display = 'flex';
        isOpen = true;
      }
      ov.addEventListener('pointerdown', function (e) {
        if (e.target !== ov) return;
        sx = e.clientX;
        sy = e.clientY;
        drawing = true;
        cur = { x: sx, y: sy, w: 0, h: 0, el: null };
        cur.el = mkBox(cur);
        try { ov.setPointerCapture(e.pointerId); } catch (e1) {}
        e.preventDefault();
      });
      ov.addEventListener('pointermove', function (e) {
        if (!drawing || !cur) return;
        var x = Math.max(0, Math.min(window.innerWidth, e.clientX)), y = Math.max(0, Math.min(window.innerHeight, e.clientY));
        cur.x = Math.min(sx, x);
        cur.y = Math.min(sy, y);
        cur.w = Math.abs(x - sx);
        cur.h = Math.abs(y - sy);
        place(cur.el, cur);
      });
      function endDraw() {
        if (!drawing || !cur) return;
        drawing = false;
        if (cur.w < 8 || cur.h < 8) { if (cur.el.parentNode) cur.el.parentNode.removeChild(cur.el); }
        else boxes.push(cur);
        cur = null;
      }
      ov.addEventListener('pointerup', endDraw);
      ov.addEventListener('pointercancel', endDraw);
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && isOpen) closeShot(); });
      function rank(el) { return (el.id ? 2 : 0) + (/^(BUTTON|INPUT|SELECT|TEXTAREA|A|CANVAS)$/.test(el.tagName.toUpperCase()) ? 1 : 0); }
      function finish() {
        if (!boxes.length) { devToast('⚠️ Draw at least one box first'); return; }
        var bx = boxes.map(function (b) { return { x: b.x, y: b.y, w: b.w, h: b.h }; });
        closeShot();
        var chunks = [];
        try { chunks = liteBuild(); } catch (e1) {}
        var cache = Object.create(null), all = document.body.querySelectorAll('*'), cand = [], tags = [], i, el, r, ix, iy;
        var skip = /^(SCRIPT|STYLE|LINK|META|BR|NOSCRIPT|HTML|HEAD|BODY)$/, tagOk = /^(BUTTON|INPUT|SELECT|TEXTAREA|A|LABEL|CANVAS|IMG|IFRAME)$/;
        bx.forEach(function (b) {
          for (i = 0; i < all.length && i < 5000; i++) {
            el = all[i];
            if (skip.test(el.tagName.toUpperCase()) || (el.closest && el.closest('svg'))) continue;
            r = el.getBoundingClientRect();
            if (r.width < 2 || r.height < 2) continue;
            ix = Math.min(b.x + b.w, r.right) - Math.max(b.x, r.left);
            iy = Math.min(b.y + b.h, r.bottom) - Math.max(b.y, r.top);
            if (ix <= 0 || iy <= 0 || (ix * iy) / (r.width * r.height) < 0.5) continue;
            if (!(el.id || tagOk.test(el.tagName.toUpperCase()) || devOwnText(el))) continue;
            if (cand.indexOf(el) < 0) cand.push(el);
          }
        });
        cand = cand.map(function (el2, k) { return { el: el2, i: k }; })
          .sort(function (p, q) { return (rank(q.el) - rank(p.el)) || (p.i - q.i); })
          .slice(0, 8)
          .map(function (p) { return p.el; });
        var lines = cand.map(function (e2, k) {
          var rr = e2.getBoundingClientRect(), cs = getComputedStyle(e2), cx = rr.left + rr.width / 2, cy = rr.top + rr.height / 2, top = null, cover, pt, tx = devOwnText(e2).slice(0, 30), html = '';
          if (cx < 0 || cy < 0 || cx > window.innerWidth || cy > window.innerHeight) cover = 'center is outside the viewport';
          else {
            try { top = document.elementFromPoint(cx, cy); } catch (e3) {}
            if (!top) cover = 'nothing';
            else if (top === e2 || e2.contains(top)) cover = 'the element itself (clickable)';
            else cover = devElBrief(top) + '  <-- NOT this element: it covers or intercepts it';
          }
          pt = devElParts(e2, chunks, cache);
          pt.forEach(function (n) { var t = '@part' + n; if (tags.indexOf(t) < 0) tags.push(t); });
          try { html = e2.cloneNode(false).outerHTML.slice(0, 170); } catch (e4) {}
          return (k + 1) + '. ' + devElBrief(e2) + (tx ? ' "' + tx + '"' : '') + '  ' + Math.round(rr.width) + 'x' + Math.round(rr.height) + ' at (' + Math.round(rr.left) + ',' + Math.round(rr.top) + ')' +
            '\n   style: display:' + cs.display + ' position:' + cs.position + ' z-index:' + cs.zIndex + ' overflow:' + cs.overflow + ' visibility:' + cs.visibility + ' opacity:' + cs.opacity + ' pointer-events:' + cs.pointerEvents +
            '\n   on top at its center: ' + cover + (pt.length ? '\n   code: ' + pt.map(function (n) { return '@part' + n; }).join(' ') : '') + '\n   tag: ' + html;
        });
        window.__devShot = '[SCREENSHOT FACTS: viewport ' + window.innerWidth + 'x' + window.innerHeight + ' px, pixel ratio ' + window.devicePixelRatio + '. No image is attached. Boxes I drew: ' +
          bx.map(function (b, k) { return (k + 1) + '=(' + Math.round(b.x) + ',' + Math.round(b.y) + ' ' + Math.round(b.w) + 'x' + Math.round(b.h) + ')'; }).join(' ') +
          '. Elements under the boxes, with the code parts that mention them:\n' + (lines.length ? lines.join('\n') : '(none detected)') + ']';
        var have = (ins.value.match(/@[\w$-]+/g) || []).map(function (x) { return x.toLowerCase(); });
        var add = tags.slice(0, 4).filter(function (t) { return have.indexOf(t.toLowerCase()) < 0; });
        if (add.length) {
          ins.value = (ins.value.trim() + ' ' + add.join(' ')).trim();
          ins.dispatchEvent(new Event('input', { bubbles: true }));
        }
        paintBtn(true);
        devToast('📷 ' + cand.length + ' element(s) captured' + (add.length ? ', ' + add.length + ' part(s) tagged' : '') + ': press ▲', 5000);
      }
      bar.addEventListener('click', function (e) {
        var a = e.target && e.target.getAttribute ? e.target.getAttribute('data-a') : null;
        if (a === 'undo') {
          var last = boxes.pop();
          if (last && last.el && last.el.parentNode) last.el.parentNode.removeChild(last.el);
        } else if (a === 'done') finish();
        else if (a === 'clear') { window.__devShot = ''; paintBtn(false); closeShot(); devToast('🗑 Screenshot facts removed'); }
        else if (a === 'x') closeShot();
      });
      btn.addEventListener('click', function () { if (isOpen) closeShot(); else openShot(); });
    })();
    if (window.CloudSync) window.CloudSync.say = function (m) { devToast(m, 4000); };
  initDevWorkspace();
})();
