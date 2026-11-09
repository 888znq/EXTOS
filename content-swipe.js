// content-swipe.js  (file name kept so manifest.json keeps working)
// Runs inside the pages framed by the Split View window (see manifest.json).
//
// Why this exists: the panes are cross-origin iframes, so touches/clicks inside
// them never reach index.js. This script detects a DOUBLE TAP inside the framed
// page and posts a message up to the Split View window:
//   • double tap (or double click with a mouse) → splitViewMenu  (open the site grid)
//   • any tap / click                            → splitViewTap   (lets an open popup close)
//
// v3: long press is NO LONGER used, so the browser's native long-press menu
// (copy text, copy image, copy link, paste, select, ...) works exactly as normal.
(function () {
  'use strict';

  // ── Only run when this frame is a DIRECT child of our own extension page ──
  // (Skips normal tabs, and nested iframes inside the framed sites. This script
  //  is injected on all sites so any site you add works, but does nothing
  //  anywhere else.)
  if (window === window.top) return;
  let extOrigin = '';
  try {
    extOrigin = chrome.runtime.getURL('').replace(/\/$/, '');
  } catch (e) {
    return;
  }
  const ancestors = location.ancestorOrigins;
  if (!ancestors || !ancestors.length) return;

  // 'pane'   = direct child of the Split View page (the site itself)
  // 'nested' = the site's own srcdoc iframe (e.g. CMP's #preview)
  const isPane   = ancestors.length === 1 && ancestors[0] === extOrigin;
  const isNested = ancestors.length === 2 && ancestors[1] === extOrigin &&
                   location.href === 'about:srcdoc';
  if (!isPane && !isNested) return;

  // Pane frames relay gestures coming from their srcdoc child up to Split View.
  if (isPane) {
    window.addEventListener('message', function (e) {
      const d = e.data;
      if (!d || e.source === window || e.source === window.parent) return;
            if (d.splitViewMenu || d.splitViewTap || d.trinityOS_pair) {
        try { window.parent.postMessage(d, '*'); } catch (err) { /* ignore */ }
      }
    });
  }

  // ── Tuning ──────────────────────────────────────────────────────
  const DOUBLE_MS = 300;      // max time between the two taps
  const DOUBLE_SLOP = 30;     // max px between the two taps
  const TAP_MAX_MS = 250;     // a touch held longer than this is a long press, not a tap
    const TAP_SLOP = 10;        // px a finger may wander and still count as a tap
  const ALLOW_MOUSE = false;  // double-click no longer opens the apps menu

  // A double tap that lands on one of these is left alone (links, buttons, sliders,
  // inputs, custom clickable divs) so quick repeated taps on controls never open the grid.
  const CLICKABLE =
    'a[href],button,input,select,textarea,label,summary,option,' +
    '[role="button"],[role="link"],[role="tab"],[role="menuitem"],[role="switch"],' +
    '[role="slider"],[role="checkbox"],[role="option"],[onclick],' +
    '[contenteditable=""],[contenteditable="true"]';

  function isClickable(target) {
    if (!(target instanceof Element)) return false;
    try {
      if (target.closest(CLICKABLE)) return true;
      // 'cursor' is inherited, so this also catches children of custom clickable divs.
      return getComputedStyle(target).cursor === 'pointer';
    } catch (e) {
      return false;
    }
  }

  function tellParent(msg) {
    try {
      window.parent.postMessage(msg, '*');
    } catch (e) { /* ignore */ }
  }

  function clearSelection() {
    try { window.getSelection().removeAllRanges(); } catch (e) { /* ignore */ }
  }

  let firedAt = 0;   // when the grid was last requested
  function recentlyFired() {
    return Date.now() - firedAt < 600;
  }

  function fire() {
    firedAt = Date.now();
    clearSelection();   // a mouse double-click selects a word; drop it
    tellParent({ splitViewMenu: true });
  }

  // Swallow any click that trails the double tap, so the page underneath doesn't react.
  document.addEventListener('click', function (e) {
    if (recentlyFired()) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  // Any touch / click inside this framed page tells Split View about it, so an open
  // popup (which covers the OTHER pane) can close as soon as you tap somewhere else.
  document.addEventListener('pointerdown', function (e) {
    if (!e.isTrusted) return;
    tellParent({ splitViewTap: true });
  }, true);

  // ── Touch: two quick taps ──
  let tap = null;    // the touch currently down: { x, y, t, moved, target }
  let last = null;   // the previous valid tap:   { x, y, t }

  document.addEventListener('touchstart', function (e) {
    if (!e.isTrusted) return;
    if (e.touches.length !== 1) { tap = null; last = null; return; }   // pinch / multi-finger
    const t = e.touches[0];
    tap = { x: t.clientX, y: t.clientY, t: Date.now(), moved: false, target: e.target };
  }, { capture: true, passive: true });

  document.addEventListener('touchmove', function (e) {
    if (!tap) return;
    if (e.touches.length > 1) { tap = null; last = null; return; }
    const t = e.touches[0];
    if (t && Math.hypot(t.clientX - tap.x, t.clientY - tap.y) > TAP_SLOP) tap.moved = true;
  }, { capture: true, passive: true });

  // Not passive: on the 2nd tap we cancel the touch so the browser doesn't also
  // do its own double-tap zoom or generate a click.
  document.addEventListener('touchend', function (e) {
    const tp = tap;
    tap = null;
    if (!tp || !e.isTrusted) return;
    const now = Date.now();

        // Scroll / drag / long press / tap on a control → not part of a double tap.
      if (tp.moved || now - tp.t > TAP_MAX_MS || isClickable(tp.target)) { last = null; return; }

      // Double tap no longer opens the apps menu.
      last = null;
    }, { capture: true, passive: false });

  document.addEventListener('touchcancel', function () {
    tap = null;
    last = null;
  }, { capture: true, passive: true });

  // ── Mouse: double-click ──
  if (ALLOW_MOUSE) {
    document.addEventListener('dblclick', function (e) {
      if (!e.isTrusted || e.button !== 0 || recentlyFired()) return;   // recentlyFired: touch already handled it
      if (isClickable(e.target)) return;
      fire();
    }, true);
  }

  // ── Handshake: lets index.js know this page can report gestures ──
  // (If a page never says "ready" — e.g. the browser blocked it from being
  // framed — index.js shows its own fallback surface so you can't get stuck.)
  if (isPane) {
      window.addEventListener('message', function (e) {
        var d = e.data;
        if (!d || e.source !== window.parent || !d.splitViewNav) return;
        try {
          if (d.splitViewNav === 'back') history.back();
          else if (d.splitViewNav === 'forward') history.forward();
        } catch (err) { /* ignore */ }
      });
      tellParent({ splitViewReady: true });
    window.addEventListener('load', function () {
      tellParent({ splitViewReady: true });
    });
  }
})();
