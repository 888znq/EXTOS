// cloud-sync.js — cloud-first file sync for EXT OS (the Folder Sync page, built into the extension).
// Load it in index.html AFTER sync.js and BEFORE index.js.
//
// Model: Firebase "extSync/main" (the same branch the Folder Sync page uses for EXTOS) is the master.
//   • push(name, text)  — a patch goes to the cloud first (old version saved in history).
//   • a loop every 3 s compares cloud and the project folder and copies whatever is newer, both ways.
//   • when files come down from the cloud the page (or the whole extension) reloads by itself.
//   • loadWorkspace()   — when the folder is not connected, patches can still start from the cloud copy.
// The folder handle is the one index.js already stores (IndexedDB DevWorkspaceDB / handles / workspaceDir).
(function () {
  'use strict';

  var cfg = window.SPLIT_FIREBASE_CONFIG || {};
  if (!cfg.databaseURL) { console.warn('[CLOUD-SYNC] no databaseURL: disabled'); return; }

  var DB_PATH = 'extSync/main';
  var BASE_URL = cfg.databaseURL.replace(/\/+$/, '') + '/' + DB_PATH;
  var POLL_MS = 3000;
  var MAX_BYTES = 5 * 1024 * 1024;
  var SKIP_DIRS = { '.git': 1, 'node_modules': 1 };
  var SKIP_FILE = /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini)$|\.crswap$|~$/;
  var RELOAD_RE = /\.(js|html|json|css)$/i;
  var EXT_LEVEL = /^(background\.js|manifest\.json|rules\.json|content-.*\.js)$/;

  if (/^(textNotes|splitView)(\/|$)/i.test(DB_PATH)) throw new Error('DB_PATH must not point at other apps');

  var DEVICE = (function () {
    var d = null;
    try { d = localStorage.getItem('cloudsync.device'); } catch (e) {}
    if (!d) {
      d = Math.random().toString(36).slice(2, 8);
      try { localStorage.setItem('cloudsync.device', d); } catch (e2) {}
    }
    return d;
  })();

  var api = { version: '1.0', say: function () {}, status: 'idle' };
  var BASE_KEY = 'cloudsync.base';
  var base = {};
  try { base = JSON.parse(localStorage.getItem(BASE_KEY) || '{}') || {}; } catch (e) { base = {}; }
  var hcache = {};
  var remote = {};
  var busy = false, holdUntil = 0, lastStatus = '', pendingReload = null, warned = {};

  function saveBase() { try { localStorage.setItem(BASE_KEY, JSON.stringify(base)); } catch (e) {} }
  function log(m) { try { console.log('[CLOUD-SYNC] ' + m); } catch (e) {} }
  function setStatus(s, msg) {
    api.status = s;
    if (s !== lastStatus) {
      lastStatus = s;
      if (msg) { try { api.say(msg); } catch (e) {} }
    }
  }

  // ───────── helpers ─────────
  function keyOf(p) {
    return Array.prototype.map.call(new TextEncoder().encode(p), function (c) {
      var ch = String.fromCharCode(c);
      return /[A-Za-z0-9_-]/.test(ch) ? ch : '~' + c.toString(16).padStart(2, '0');
    }).join('');
  }
  function b64enc(buf) {
    var b = new Uint8Array(buf), s = '', i;
    for (i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function b64dec(s) {
    var bin = atob(s), b = new Uint8Array(bin.length), i;
    for (i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
    return b;
  }
  async function sha(buf) {
    var h = await crypto.subtle.digest('SHA-256', buf);
    return Array.prototype.map.call(new Uint8Array(h), function (x) { return x.toString(16).padStart(2, '0'); }).join('');
  }

  // ───────── Firebase REST ─────────
  async function db(method, sub, body) {
    var tries = method === 'POST' ? 1 : 4, lastErr = null, i, r, url;
    url = BASE_URL + (sub ? '/' + sub : '') + '.json';
    for (i = 1; i <= tries; i++) {
      try {
        r = await fetch(url, {
          method: method,
          body: body === undefined ? undefined : JSON.stringify(body),
          cache: 'no-store',
          signal: AbortSignal.timeout(/^(blobs|history)\//.test(sub || '') ? 45000 : 15000)
        });
        if (!r.ok) throw new Error(method + ' ' + sub + ' HTTP ' + r.status);
        return method === 'GET' ? await r.json() : null;
      } catch (e) {
        lastErr = e;
        if (/HTTP 4\d\d/.test(String(e.message))) break;
        if (i < tries) await new Promise(function (res) { setTimeout(res, 800 * i); });
      }
    }
    throw lastErr;
  }

  // ───────── the project folder (same handle index.js stores) ─────────
  function openHandles() {
    return new Promise(function (res) {
      var r = indexedDB.open('DevWorkspaceDB', 1);
      r.onupgradeneeded = function (e) { e.target.result.createObjectStore('handles'); };
      r.onsuccess = function (e) { res(e.target.result); };
      r.onerror = function () { res(null); };
    });
  }
  async function getRoot() {
    var d = await openHandles();
    if (!d) return { h: null, why: 'nofolder' };
    if (!d.objectStoreNames.contains('handles')) { d.close(); return { h: null, why: 'nofolder' }; }
    var h = await new Promise(function (res) {
      var q = d.transaction('handles', 'readonly').objectStore('handles').get('workspaceDir');
      q.onsuccess = function () { res(q.result || null); };
      q.onerror = function () { res(null); };
    });
    d.close();
    if (!h) return { h: null, why: 'nofolder' };
    try {
      if ((await h.queryPermission({ mode: 'readwrite' })) !== 'granted') return { h: null, why: 'noperm' };
    } catch (e) { return { h: null, why: 'noperm' }; }
    return { h: h, why: '' };
  }
  async function scan(dir, prefix, out) {
    var it = dir.entries(), n, name, h;
    for (;;) {
      n = await it.next();
      if (n.done) break;
      name = n.value[0]; h = n.value[1];
      if (h.kind === 'directory') { if (!SKIP_DIRS[name]) await scan(h, prefix + name + '/', out); }
      else if (!SKIP_FILE.test(prefix + name)) out[prefix + name] = h;
    }
  }
  async function localState(root) {
    var handles = {}, out = {}, p, f, c, hash;
    await scan(root, '', handles);
    for (p in handles) {
      f = await handles[p].getFile();
      if (f.size > MAX_BYTES) { if (!warned[p]) { warned[p] = 1; log('skipping ' + p + ' (too large)'); } continue; }
      c = hcache[p];
      if (c && c.m === f.lastModified && c.s === f.size) hash = c.h;
      else { hash = await sha(await f.arrayBuffer()); hcache[p] = { m: f.lastModified, s: f.size, h: hash }; }
      out[p] = { hash: hash, mtime: f.lastModified, size: f.size };
    }
    return out;
  }
  async function dirFor(root, path, create) {
    var parts = path.split('/'), name = parts.pop(), d = root, i;
    if (!name || parts.concat(name).some(function (s) { return !s || s === '.' || s === '..'; })) throw new Error('unsafe path: ' + path);
    for (i = 0; i < parts.length; i++) d = await d.getDirectoryHandle(parts[i], { create: create });
    return { d: d, name: name };
  }
  async function readLocal(root, p) {
    var t = await dirFor(root, p, false);
    var f = await (await t.d.getFileHandle(t.name)).getFile();
    var buf = await f.arrayBuffer();
    return { buf: buf, hash: await sha(buf), mtime: f.lastModified };
  }
  async function writeLocal(root, p, bytes) {
    var t = await dirFor(root, p, true);
    var w = await (await t.d.getFileHandle(t.name, { create: true })).createWritable();
    await w.write(bytes);
    await w.close();
  }
  async function deleteLocal(root, p) {
    var t = await dirFor(root, p, false);
    await t.d.removeEntry(t.name);
  }

  // ───────── cloud operations (history keeps older versions) ─────────
  async function archiveCloud(p, reason) {
    var key = keyOf(p);
    var m = await db('GET', 'meta/' + key);
    var b = m && !m.deleted ? await db('GET', 'blobs/' + key) : null;
    if (!m || m.deleted || b == null) return;
    await db('PUT', 'history/' + Date.now() + '_' + key, { path: p, hash: m.hash, mtime: m.mtime, content: b, reason: reason, by: DEVICE });
  }
  async function upload(root, p) {
    var l = await readLocal(root, p), key = keyOf(p);
    if (remote[p] && !remote[p].deleted) await archiveCloud(p, 'before overwrite');
    await db('PUT', 'blobs/' + key, b64enc(l.buf));
    await db('PUT', 'meta/' + key, { path: p, hash: l.hash, size: l.buf.byteLength, mtime: l.mtime, deleted: false, by: DEVICE });
    base[p] = l.hash;
    log('uploaded ' + p);
  }
  async function download(root, p) {
    var b = await db('GET', 'blobs/' + keyOf(p));
    if (b == null) throw new Error('cloud has meta but no content for ' + p);
    var bytes = b64dec(b), hash = await sha(bytes);
    await writeLocal(root, p, bytes);
    base[p] = hash;
    delete hcache[p];
    log('downloaded ' + p);
  }
  async function deleteCloud(p) {
    var key = keyOf(p);
    await db('PUT', 'meta/' + key, { path: p, deleted: true, hash: null, mtime: Date.now(), by: DEVICE });
    await db('DELETE', 'blobs/' + key);
    delete base[p];
    log('deleted in cloud ' + p);
  }

  // ───────── reload after files came down from the cloud ─────────
  function requestReload(names) {
    var ext = !!(pendingReload && pendingReload.ext);
    names.forEach(function (n) { if (EXT_LEVEL.test(n.split('/').pop())) ext = true; });
    pendingReload = { ext: ext };
    tryReload();
  }
  function tryReload() {
    if (!pendingReload) return;
    if (Date.now() < holdUntil) { setTimeout(tryReload, 500); return; }
    var last = 0, ext = pendingReload.ext;
    try { last = Number(sessionStorage.getItem('cloudsync.reloadAt') || 0); } catch (e) {}
    pendingReload = null;
    if (Date.now() - last < 8000) { log('reload skipped (one just happened); reload by hand to load the new files'); return; }
    try { sessionStorage.setItem('cloudsync.reloadAt', String(Date.now())); } catch (e2) {}
    try { api.say('☁ Cloud files changed: reloading…'); } catch (e3) {}
    setTimeout(function () {
      if (ext && typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ type: 'RELOAD_APP' }, function () {
          if (chrome.runtime.lastError) location.reload();
        });
      } else location.reload();
    }, 800);
  }

  // ───────── one sync cycle ─────────
  async function cycle(why) {
    if (busy) return;
    busy = true;
    var errs = 0, written = [];
    try {
      var r = await getRoot();
      if (!r.h) {
        setStatus(r.why, r.why === 'noperm' ? '☁ Folder not connected: tap the folder button to reconnect (patches still go to the cloud)' : '');
        return;
      }
      var root = r.h;
      var loc = await localState(root);
      var rm = (await db('GET', 'meta')) || {};
      remote = {};
      Object.keys(rm).forEach(function (k) { if (rm[k] && rm[k].path) remote[rm[k].path] = rm[k]; });

      var acts = [], paths = {}, p;
      Object.keys(loc).concat(Object.keys(remote), Object.keys(base)).forEach(function (x) { paths[x] = 1; });
      for (p in paths) {
        var L = loc[p], Rm = remote[p], R = Rm && !Rm.deleted ? Rm : null, B = base[p];
        var lh = L ? L.hash : null, rh = R ? R.hash : null;
        if (lh === rh) { if (lh) base[p] = lh; else delete base[p]; continue; }
        if (L && !R) {
          if (B && lh === B && Rm && Rm.deleted) acts.push(['dl', p]);
          else acts.push(['up', p]);
        } else if (!L && R) {
          if (B && rh === B) acts.push(['dr', p]);
          else acts.push(['down', p]);
        } else if (lh === B) acts.push(['down', p]);
        else if (rh === B) acts.push(['up', p]);
        else if (L.mtime >= R.mtime) acts.push(['up', p]);
        else acts.push(['cdown', p]);
      }
      if (acts.length) setStatus('syncing', '');
      for (var i = 0; i < acts.length; i++) {
        var t = acts[i][0], f = acts[i][1];
        try {
          if (t === 'up') await upload(root, f);
          else if (t === 'down') { await download(root, f); written.push(f); }
          else if (t === 'cdown') {
            var old = await readLocal(root, f);
            await db('PUT', 'history/' + Date.now() + '_' + keyOf(f), { path: f, hash: old.hash, mtime: old.mtime, content: b64enc(old.buf), reason: 'lost conflict', by: DEVICE });
            await download(root, f); written.push(f);
          }
          else if (t === 'dl') { await deleteLocal(root, f); delete base[f]; written.push(f); }
          else if (t === 'dr') await deleteCloud(f);
        } catch (e) { errs++; log(t + ' ' + f + ' failed: ' + e.message); }
      }
      saveBase();
      setStatus(errs ? 'error' : 'ok', errs ? '☁ Sync error: see the console' : '');
      var reloadable = written.filter(function (n) { return RELOAD_RE.test(n); });
      if (reloadable.length) requestReload(reloadable);
    } catch (e) {
      if (e && e.name === 'NotFoundError') setStatus('nofolder', '☁ The project folder is missing: reconnect it');
      else setStatus('offline', '');
      log('cycle (' + why + ') failed: ' + (e && e.message));
    } finally { busy = false; }
  }

  async function lockWait() {
    while (busy) await new Promise(function (res) { setTimeout(res, 150); });
    busy = true;
  }

  // ───────── public API ─────────
  // A patch goes to the cloud first. Resolves true when the cloud has the new text.
  api.push = async function (path, text) {
    await lockWait();
    try {
      var bytes = new TextEncoder().encode(text), hash = await sha(bytes), key = keyOf(path);
      var m = await db('GET', 'meta/' + key);
      if (m && !m.deleted && m.hash === hash) return true;
      if (m && !m.deleted) await archiveCloud(path, 'before patch');
      await db('PUT', 'blobs/' + key, b64enc(bytes));
      var meta = { path: path, hash: hash, size: bytes.length, mtime: Date.now(), deleted: false, by: DEVICE };
      await db('PUT', 'meta/' + key, meta);
      remote[path] = meta;
      log('patch pushed to cloud: ' + path);
      return true;
    } catch (e) {
      log('push failed for ' + path + ': ' + e.message);
      return false;
    } finally { busy = false; }
  };
  // Text files (subfolders included) from the cloud, used when the folder is not connected. null = cloud unreachable.
  api.loadWorkspace = async function () {
    try {
      var m = (await db('GET', 'meta')) || {}, out = {}, k, info, b;
      for (k in m) {
        info = m[k];
        if (!info || info.deleted || !info.path || !RELOAD_RE.test(info.path)) continue;
        b = await db('GET', 'blobs/' + k);
        if (b == null) continue;
        out[info.path] = new TextDecoder().decode(b64dec(b)).replace(/\r\n/g, '\n');
      }
      return out;
    } catch (e) { log('loadWorkspace failed: ' + e.message); return null; }
  };
  // A file deleted by a patch: the old version goes to history, the cloud entry is marked deleted.
    api.remove = async function (path) {
      await lockWait();
      try {
        var key = keyOf(path), m = await db('GET', 'meta/' + key);
        if (m && !m.deleted) await archiveCloud(path, 'before delete');
        await deleteCloud(path);
        delete remote[path];
        return true;
      } catch (e) {
        log('remove failed for ' + path + ': ' + e.message);
        return false;
      } finally { busy = false; }
    };
    api.kick = function () { cycle('kick'); };
  api.hold = function (ms) { holdUntil = Date.now() + (ms || 8000); };
  window.CloudSync = api;

  try { if (navigator.locks) navigator.locks.request('cloudsync-keepalive', function () { return new Promise(function () {}); }); } catch (e) {}
  setInterval(function () { cycle('auto'); }, POLL_MS);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) cycle('visible'); });
  setTimeout(function () { cycle('start'); }, 800);
})();
