// theme.js — one button that changes the whole app's color.
// Click the palette button = next theme (the same colors Chrome offers).
// Right-click the button = pick any color you like. Saved on this device.
(function () {
  'use strict';

    var KEY = 'split-view:theme'; // sync test
  var DEFAULT_BG = '#000432';

  // Chrome's "Customize Chrome" colors, in the same order
  var THEMES = [
    { id: 'default', name: 'Default', bg: DEFAULT_BG },
    { id: 'grey',    name: 'Grey',       base: '#4a4a4a' },
    { id: 'steel',   name: 'Steel blue', base: '#274e86' },
    { id: 'slate',   name: 'Slate',      base: '#3b4864' },
    { id: 'sage',    name: 'Sage',       base: '#3d4b4b' },
    { id: 'teal',    name: 'Teal',       base: '#00544c' },
    { id: 'green',   name: 'Green',      base: '#1f5a23' },
    { id: 'olive',   name: 'Olive',      base: '#464b3b' },
    { id: 'gold',    name: 'Gold',       base: '#5e4c00' },
    { id: 'orange',  name: 'Orange',     base: '#7d3e00' },
    { id: 'brown',   name: 'Brown',      base: '#5e4638' },
    { id: 'rose',    name: 'Rose',       base: '#7c2a40' },
    { id: 'mauve',   name: 'Mauve',      base: '#5b4545' },
    { id: 'plum',    name: 'Plum',       base: '#6e2d5e' },
    { id: 'purple',  name: 'Purple',     base: '#4b3a82' }
  ];

  function hexToHsl(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return [220, 0.5, 0.3];
    var n = parseInt(m[1], 16);
    var r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, h = 0, s = 0;
    if (mx !== mn) {
      var d = mx - mn;
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return [h, s, l];
  }
  function hslToHex(h, s, l) {
    h /= 360;
    function f(p, q, t) {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    }
    var r, g, b;
    if (s === 0) { r = g = b = l; }
    else {
      var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      var p = 2 * l - q;
      r = f(p, q, h + 1 / 3); g = f(p, q, h); b = f(p, q, h - 1 / 3);
    }
    function x(v) { var t = Math.round(v * 255).toString(16); return t.length < 2 ? '0' + t : t; }
    return '#' + x(r) + x(g) + x(b);
  }
  // A dark version of any color, so the light text always stays readable
  function bgFor(base) {
    var c = hexToHsl(base);
    return hslToHex(c[0], Math.min(c[1], 0.7), Math.min(c[2], 0.16));
  }
  function themeBg(t) { return t.bg || bgFor(t.base); }

  function read() {
    try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch (e) { return null; }
  }
  function write(v) {
    try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {}
  }
    function apply(bg, acc) {
    document.documentElement.style.setProperty('--app-bg', bg);
    var accNames = ['--th-a', '--th-b', '--th-c'];
    for (var ai = 0; ai < accNames.length; ai++) {
      if (acc && acc[ai]) document.documentElement.style.setProperty(accNames[ai], acc[ai]);
      else document.documentElement.style.removeProperty(accNames[ai]);
    }
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', bg);
  }

    var saved = read();
  var current = { id: 'default', bg: DEFAULT_BG };

    // Every reopen: build a brand new theme (background + 3 accent glows) that was never used before.
  // Used combinations are remembered, so the same combination never shows twice.
  var USED_KEY = 'split-view:theme-used';
  function autoTheme() {
    var used = [];
    try { used = JSON.parse(localStorage.getItem(USED_KEY)) || []; } catch (e) { used = []; }
    if (!Array.isArray(used)) used = [];
    var seen = {};
    used.forEach(function (s) { seen[s] = 1; });
    var lastHue = hexToHsl(current.bg)[0];
    var pick = null, tries = 0;
    while (tries < 3000) {
      tries++;
      var h = Math.random() * 360;
      if (tries < 200) {
        var dh = Math.abs(h - lastHue);
        dh = Math.min(dh, 360 - dh);
        if (dh < 30) continue;
      }
            var bg = hslToHex(h, 0.35 + Math.random() * 0.35, 0.12 + Math.random() * 0.08);
      var a = hslToHex((h + 30 + Math.random() * 30) % 360, 0.65 + Math.random() * 0.25, 0.5 + Math.random() * 0.12);
      var b = hslToHex((h + 160 + Math.random() * 40) % 360, 0.65 + Math.random() * 0.25, 0.5 + Math.random() * 0.12);
      var c = hslToHex((h + 300 + Math.random() * 40) % 360, 0.65 + Math.random() * 0.25, 0.5 + Math.random() * 0.12);
      pick = { key: bg + a + b + c, bg: bg, acc: [a, b, c] };
      if (!seen[pick.key]) break;
    }
    used.push(pick.key);
    if (used.length > 5000) used = used.slice(-5000);
    try { localStorage.setItem(USED_KEY, JSON.stringify(used)); } catch (e2) {}
    current = { id: 'auto', bg: pick.bg, name: 'Auto', acc: pick.acc };
    write(current);
  }
      write(current);

    apply(current.bg, current.acc);

  var PALETTE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block"><path d="M12 3a9 9 0 0 0 0 18 1.6 1.6 0 0 0 1.2-2.7 1.6 1.6 0 0 1 1.2-2.7H16a5 5 0 0 0 5-5c0-4-4-7.6-9-7.6z"/><circle cx="7.6" cy="11" r="1" fill="currentColor"/><circle cx="10.5" cy="7.4" r="1" fill="currentColor"/><circle cx="15" cy="7.4" r="1" fill="currentColor"/></svg>';

  var btn = null;
  var toast = null;
  var toastTimer = 0;

  function say(text) {
    if (!btn) return;
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'th-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = text;
    toast.style.opacity = '1';
    var r = btn.getBoundingClientRect();
    toast.style.top = (r.bottom + 6) + 'px';
    var w = toast.offsetWidth;
    toast.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w)) + 'px';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { if (toast) toast.style.opacity = '0'; }, 1100);
  }

  function setTheme(t) {
    current = { id: t.id, bg: themeBg(t), name: t.name };
    if (t.base) current.base = t.base;
    apply(current.bg);
    write(current);
    if (btn) btn.title = 'Theme: ' + t.name + ' (click for next, right-click for any color)';
    say(t.name);
  }
  function nextTheme() {
    var i = -1;
    for (var k = 0; k < THEMES.length; k++) if (THEMES[k].id === current.id) i = k;
    setTheme(THEMES[(i + 1) % THEMES.length]);
  }

  function init() {
    if (document.getElementById('themeBtn')) return;
    var cx = document.getElementById('cxBtn');
    if (!cx || !cx.parentNode) return;
    btn = document.createElement('button');
    btn.id = 'themeBtn';
    btn.className = 'cx-btn';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Change theme');
    btn.title = 'Theme: ' + (current.name || (current.id === 'default' ? 'Default' : 'Custom')) + ' (click for next, right-click for any color)';
    btn.innerHTML = PALETTE;
    var before = document.getElementById('splitBtn') || cx;
    before.parentNode.insertBefore(btn, before);

    var inp = document.createElement('input');
    inp.type = 'color';
    inp.className = 'th-color';
    inp.value = current.base && /^#[0-9a-f]{6}$/i.test(current.base) ? current.base : '#2f5fa8';
    document.body.appendChild(inp);
    inp.addEventListener('input', function () {
      setTheme({ id: 'custom', name: 'Custom', base: inp.value });
    });

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      nextTheme();
    });
    btn.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      e.stopPropagation();
      try { inp.click(); } catch (err) {}
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
