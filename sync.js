// sync.js — minimal Firebase Realtime Database client over REST + Server-Sent Events.
//
// Why REST instead of the Firebase SDK: extension pages can't load scripts from
// gstatic.com (Manifest V3 only allows bundled scripts), and REST needs no
// bundling. It uses the same database and the same (open) access your Notes app
// uses. It only ever touches ONE path: SPLIT_DB_PATH (default "splitView/main").
(function () {
  'use strict';

  const cfg = window.SPLIT_FIREBASE_CONFIG || {};
  const path = String(window.SPLIT_DB_PATH || 'splitView/main').replace(/^\/+|\/+$/g, '');

  if (!cfg.databaseURL || !path) {
    console.warn('[SPLIT-SYNC] no databaseURL/path configured — sync disabled');
    return;
  }
  // Safety: refuse to ever point at the Notes app's data or the database root.
  if (/^textNotes(\/|$)/i.test(path)) {
    console.error('[SPLIT-SYNC] refusing to use the Notes app path — sync disabled');
    return;
  }

  const url = cfg.databaseURL.replace(/\/+$/, '') + '/' + path + '.json';

  let status = 'idle'; // idle | saving | ok | offline | denied | error
  const statusListeners = [];

  function setStatus(s) {
    if (s === status) return;
    status = s;
    statusListeners.forEach(function (fn) {
      try { fn(s); } catch (e) { /* ignore */ }
    });
  }

  function onStatus(fn) {
    statusListeners.push(fn);
    try { fn(status); } catch (e) { /* ignore */ }
  }

  // Resolves to: the stored object, null (reached DB, nothing stored yet),
  // or undefined (couldn't reach / not allowed).
  async function load(timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(function () { ctrl.abort(); }, timeoutMs || 4000);
    try {
      const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
      if (!res.ok) {
        setStatus(res.status === 401 || res.status === 403 ? 'denied' : 'error');
        return undefined;
      }
      const data = await res.json();
      setStatus('ok');
      return data;
    } catch (e) {
      setStatus('offline');
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  }

  // Overwrites ONLY splitView/main. Resolves true on success.
  async function save(data) {
    try {
      setStatus('saving');
      const res = await fetch(url, {
        method: 'PUT',
        body: JSON.stringify(data),
        keepalive: true
      });
      if (!res.ok) {
        setStatus(res.status === 401 || res.status === 403 ? 'denied' : 'error');
        return false;
      }
      setStatus('ok');
      return true;
    } catch (e) {
      setStatus('offline');
      return false;
    }
  }

  // Live updates. cb(data) is called with the full stored object (or null).
  function subscribe(cb) {
    let es;
    try {
      es = new EventSource(url);
    } catch (e) {
      return;
    }

    function refetch() {
      load(4000).then(function (d) { if (d !== undefined) cb(d); });
    }

    es.addEventListener('put', function (ev) {
      try {
        const msg = JSON.parse(ev.data);
        setStatus('ok');
        if (msg && msg.path === '/') cb(msg.data);
        else refetch();
      } catch (e) { /* ignore malformed event */ }
    });
    es.addEventListener('patch', function () { refetch(); });
    es.addEventListener('cancel', function () { setStatus('denied'); es.close(); });
    es.addEventListener('auth_revoked', function () { setStatus('denied'); es.close(); });
    // EventSource reconnects on its own after an error.
    es.onerror = function () { setStatus('offline'); };
  }

    // ── Visited-sites history ──
  // Stored at a SIBLING path (e.g. "splitView/main-history"), so saving the main
  // state (a PUT on splitView/main) can never overwrite it.
  const histUrl = cfg.databaseURL.replace(/\/+$/, '') + '/' + path + '-history.json';

  // Resolves to: the stored object, null (nothing stored yet), or undefined (couldn't reach).
  async function loadHistory(timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(function () { ctrl.abort(); }, timeoutMs || 4000);
    try {
      const res = await fetch(histUrl, { signal: ctrl.signal, cache: 'no-store' });
      if (!res.ok) return undefined;
      return await res.json();
    } catch (e) {
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  }

    async function saveHistory(data) {
    try {
      const res = await fetch(histUrl, { method: 'PUT', body: JSON.stringify(data) });
      return res.ok;
    } catch (e) {
      return false;
    }
  }

  // ── Added tab groups ──
  // Stored at its own sibling path (e.g. "splitView/main-groups"). This is the only
  // tab-bar data that syncs: groups you add. Visited sites are not synced.
  const grpUrl = cfg.databaseURL.replace(/\/+$/, '') + '/' + path + '-groups.json';

  // Resolves to: the stored object, null (nothing stored yet), or undefined (couldn't reach).
  async function loadGroups(timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(function () { ctrl.abort(); }, timeoutMs || 4000);
    try {
      const res = await fetch(grpUrl, { signal: ctrl.signal, cache: 'no-store' });
      if (!res.ok) return undefined;
      return await res.json();
    } catch (e) {
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  }

  async function saveGroups(data) {
    try {
      const res = await fetch(grpUrl, { method: 'PUT', body: JSON.stringify(data), keepalive: true });
      return res.ok;
    } catch (e) {
      return false;
    }
  }

    // ── Bookmarks + bookmark folders ──
  // Stored at its own sibling path (e.g. "splitView/main-bookmarks"): { v, ts, items: [...] }.
  const bmUrl = cfg.databaseURL.replace(/\/+$/, '') + '/' + path + '-bookmarks.json';

  // Resolves to: the stored object, null (nothing stored yet), or undefined (couldn't reach).
  async function loadBookmarks(timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(function () { ctrl.abort(); }, timeoutMs || 4000);
    try {
      const res = await fetch(bmUrl, { signal: ctrl.signal, cache: 'no-store' });
      if (!res.ok) return undefined;
      return await res.json();
    } catch (e) {
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  }

  async function saveBookmarks(data) {
    try {
      const res = await fetch(bmUrl, { method: 'PUT', body: JSON.stringify(data), keepalive: true });
      return res.ok;
    } catch (e) {
      return false;
    }
  }

  // Live updates for bookmarks. cb(data) gets the full stored object (or null).
  function subscribeBookmarks(cb) {
    let es;
    try {
      es = new EventSource(bmUrl);
    } catch (e) {
      return;
    }
    function refetch() {
      loadBookmarks(4000).then(function (d) { if (d !== undefined) cb(d); });
    }
    es.addEventListener('put', function (ev) {
      try {
        const msg = JSON.parse(ev.data);
        if (msg && msg.path === '/') cb(msg.data);
        else refetch();
      } catch (e) { /* ignore malformed event */ }
    });
    es.addEventListener('patch', function () { refetch(); });
    es.addEventListener('cancel', function () { es.close(); });
    es.addEventListener('auth_revoked', function () { es.close(); });
    // EventSource reconnects on its own after an error.
  }

  // ── Users: encrypted names/order + encrypted cookie jars (sibling paths, never the main state) ──
    function usrUrl(sub) {
      if (!/^-(users|jars-meta|jars\/[A-Za-z0-9_-]{1,40})$/.test(sub)) return '';
      return cfg.databaseURL.replace(/\/+$/, '') + '/' + path + sub + '.json';
    }
    // Resolves to: the stored value, null (nothing stored), or undefined (couldn't reach).
    async function usrGet(sub, timeoutMs) {
      const u = usrUrl(sub);
      if (!u) return undefined;
      const ctrl = new AbortController();
      const timer = setTimeout(function () { ctrl.abort(); }, timeoutMs || 4000);
      try {
        const res = await fetch(u, { signal: ctrl.signal, cache: 'no-store' });
        if (!res.ok) return undefined;
        return await res.json();
      } catch (e) {
        return undefined;
      } finally {
        clearTimeout(timer);
      }
    }
    async function usrPut(sub, data) {
      const u = usrUrl(sub);
      if (!u) return false;
      try {
        const res = await fetch(u, { method: 'PUT', body: JSON.stringify(data), keepalive: true });
        return res.ok;
      } catch (e) {
        return false;
      }
    }

      // ── Session: open tabs (single pages + whole splits) and the page in every pane ──
    // Stored at its own sibling path (e.g. "splitView/main-session").
    var sesUrl = cfg.databaseURL.replace(/\/+$/, '') + '/' + path + '-session.json';

    // Resolves to: the stored object, null (nothing stored yet), or undefined (couldn't reach).
    async function loadSession(timeoutMs) {
      var ctrl = new AbortController();
      var timer = setTimeout(function () { ctrl.abort(); }, timeoutMs || 4000);
      try {
        var res = await fetch(sesUrl, { signal: ctrl.signal, cache: 'no-store' });
        if (!res.ok) return undefined;
        return await res.json();
      } catch (e) {
        return undefined;
      } finally {
        clearTimeout(timer);
      }
    }

    async function saveSession(data) {
      try {
        var res = await fetch(sesUrl, { method: 'PUT', body: JSON.stringify(data), keepalive: true });
        return res.ok;
      } catch (e) {
        return false;
      }
    }

    window.SplitSync = {
      loadSession: loadSession,
      saveSession: saveSession,
      load: load,
    save: save,
    subscribe: subscribe,
    onStatus: onStatus,
    loadHistory: loadHistory,
    saveHistory: saveHistory,
    loadGroups: loadGroups,
        saveGroups: saveGroups,
    loadBookmarks: loadBookmarks,
    saveBookmarks: saveBookmarks,
    subscribeBookmarks: subscribeBookmarks,
        usrGet: usrGet,
        usrPut: usrPut
  };
})();
