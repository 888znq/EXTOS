// pane-popup.js — fits the site popup (#mgr) exactly over a pane, for ANY number of panes (1-6).
//
// index.js already mounts #mgr INSIDE the pane it opens on, so when you use that code path this
// file has nothing to do and stays out of the way. It only takes over when #mgr is NOT inside a
// pane: it then covers the pane that was most recently double-tapped / long-pressed.
// Load AFTER index.js in index.html if you want it (index.html does not load it by default).
(function () {
  'use strict';

  var mgr = document.getElementById('mgr');
  var wrapper = document.getElementById('panesWrapper');
  if (!mgr || !wrapper) return;

  var pressPane = null;   // pane element most recently pressed
  var pressAt = 0;
  var activePane = null;  // pane element the popup is currently fitted to

  function paneEls() {
    return Array.prototype.slice.call(wrapper.querySelectorAll('.pane'));
  }
  function isShown(el) {
    return !!el && !el.hidden && el.getBoundingClientRect().width > 0;
  }
  function insidePane() {
    return !!(mgr.parentElement && mgr.parentElement.closest && mgr.parentElement.closest('.pane'));
  }

  function mark(pane) {
    if (!pane) return;
    pressPane = pane;
    pressAt = Date.now();
    if (!mgr.hidden) activePane = pane;   // popup already open → follow the new pane
    fit();
    setTimeout(fit, 0);                   // covers index.js opening the popup after us
  }

  function fit() {
    if (mgr.hidden) return;
    if (insidePane()) { unfit(); return; }          // already sized by its pane
    var pane = activePane;
    if (!pane && pressPane && Date.now() - pressAt < 3000) pane = pressPane;
    if (!isShown(pane)) { unfit(); return; }        // opened some other way → normal centered dialog
    activePane = pane;
    var r = pane.getBoundingClientRect();
    mgr.classList.add('pane-fit');
    mgr.style.top    = r.top + 'px';
    mgr.style.left   = r.left + 'px';
    mgr.style.width  = r.width + 'px';
    mgr.style.height = r.height + 'px';
    mgr.style.right  = 'auto';
    mgr.style.bottom = 'auto';
  }

  function unfit() {
    mgr.classList.remove('pane-fit');
    ['top', 'left', 'width', 'height', 'right', 'bottom'].forEach(function (s) { mgr.style[s] = ''; });
  }

  // Double tap inside a framed page (message from content-swipe.js)
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || !d.splitViewMenu) return;
    paneEls().forEach(function (pane) {
      var f = pane.querySelector('iframe');
      if (f && f.contentWindow && e.source === f.contentWindow) mark(pane);
    });
  }, true);

  // Fallback surface shown when a page can't be framed (one listener covers every pane)
  function onCatcher(e) {
    var t = e.target;
    var c = t && t.closest && t.closest('.tap-catcher');
    if (!c) return;
    mark(c.closest('.pane'));
  }
  wrapper.addEventListener('pointerdown', onCatcher, true);
  wrapper.addEventListener('touchstart', onCatcher, { capture: true, passive: true });

  new MutationObserver(function () {
    if (mgr.hidden) { unfit(); activePane = null; pressPane = null; }
    else fit();
  }).observe(mgr, { attributes: true, attributeFilter: ['hidden'] });

  window.addEventListener('resize', fit);
  window.addEventListener('orientationchange', fit);

  var st = document.createElement('style');
  st.textContent =
    '.mgr.pane-fit{position:fixed;inset:auto;padding:0;background:transparent;}' +
    '.mgr.pane-fit .mgr-card{width:100%;height:100%;max-height:100%;border-radius:0;border-width:0;}' +
    '.mgr.pane-fit .mgr-grid{grid-template-columns:repeat(auto-fill,minmax(76px,1fr));gap:8px;padding:8px;}' +
    '.mgr.pane-fit .mgr-tile{padding:8px 4px 6px;gap:6px;}' +
    '.mgr.pane-fit .mgr-av{width:36px;height:36px;font-size:17px;}';
  document.head.appendChild(st);
})();
