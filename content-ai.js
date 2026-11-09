// content-ai.js — AI loop bridge for EXT OS (runs inside the AI pane only).
//   AI pane  ──{aiReply, aiCode}──►  index.js  ──►  tool pane (CMP)
//   AI pane  ◄──{sendToAI}─────────  index.js  ◄──  tool pane (CMP)
// If a site changes its HTML, fix the selector lists in SITES below. Nothing else needs to change.
(function () {
  'use strict';

  // Only run when this frame is a DIRECT child of the extension page (same check as content-swipe.js)
  if (window === window.top) return;
  var extOrigin = '';
  try { extOrigin = chrome.runtime.getURL('').replace(/\/$/, ''); } catch (e) { return; }
  var anc = location.ancestorOrigins;
  if (!anc || anc.length !== 1 || anc[0] !== extOrigin) return;

  // ── Per-site selectors (first match in each list wins) ──
  var SITES = {
    'claude.ai': {
      input: ['div.ProseMirror[contenteditable="true"]', '[contenteditable="true"][role="textbox"]'],
      send:  ['button[aria-label="Send message"]', 'button[aria-label="Send Message"]'],
      stop:  ['button[aria-label="Stop response"]', 'button[aria-label="Stop Response"]'],
      reply: ['.font-claude-response', '.font-claude-message', '[data-is-streaming]']
    },
    'chatgpt.com': {
      input: ['#prompt-textarea', 'div.ProseMirror[contenteditable="true"]'],
      send:  ['button[data-testid="send-button"]', 'button[aria-label="Send prompt"]'],
      stop:  ['button[data-testid="stop-button"]', 'button[aria-label="Stop streaming"]'],
      reply: ['[data-message-author-role="assistant"]']
    },
    'gemini.google.com': {
      input: ['rich-textarea div.ql-editor[contenteditable="true"]', 'div.ql-editor[contenteditable="true"]'],
      send:  ['button.send-button', 'button[aria-label="Send message"]'],
      stop:  ['button[aria-label="Stop response"]', 'button.send-button.stop', 'button.stop'],
      reply: ['message-content', '.model-response-text']
    }
  };

  var host = Object.keys(SITES).filter(function (h) {
    return location.hostname === h || location.hostname.slice(-(h.length + 1)) === '.' + h;
  })[0];
  if (!host) return;
  var cfg = SITES[host];
  var T0 = Date.now();

  function up(msg) { try { window.parent.postMessage(msg, '*'); } catch (e) { /* ignore */ } }
  function visible(el) { var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }
  function first(list) {
    for (var i = 0; i < list.length; i++) {
      var els = document.querySelectorAll(list[i]);
      for (var j = 0; j < els.length; j++) if (visible(els[j])) return els[j];
    }
    return null;
  }
  function all(list) {
    for (var i = 0; i < list.length; i++) {
      var els = document.querySelectorAll(list[i]);
      if (els.length) return els;
    }
    return [];
  }

  // ── Tell index.js this pane is an AI chat (so payloads know where to go) ──
  up({ aiPaneReady: true, aiSite: host });
  window.addEventListener('load', function () { up({ aiPaneReady: true, aiSite: host }); });

  // ── Reply finished? → report the last assistant reply upward ──
  var wasGen = false, idleSince = 0, sawStop = false, lastKey = '';
  var lastSig = '', changes = [];

  // Fallback when the Stop-button selector never matches: the reply text is changing fast
  function streaming() {
    var els = all(cfg.reply), el = els.length ? els[els.length - 1] : null, now = Date.now();
    var sig = el ? (el.textContent.length + '|' + el.childElementCount) : '';
    if (sig !== lastSig) { lastSig = sig; changes.push(now); }
    changes = changes.filter(function (t) { return now - t < 2500; });
    if (now - T0 < 6000) changes = [];   // ignore the page still loading its old chat
    return changes.length >= 4;
  }

  function report(isFinal) {
    var els = all(cfg.reply);
    if (!els.length) return;
    var el = els[els.length - 1];
    var text = el.innerText || el.textContent || '';
    var key = els.length + '|' + text.length + '|' + text.slice(-120);
    if (!text.trim() || key === lastKey) return;
    lastKey = key;
    var codes = [], nodes = el.querySelectorAll('pre code');
    if (!nodes.length) nodes = el.querySelectorAll('pre');
    for (var i = 0; i < nodes.length; i++) codes.push(nodes[i].textContent);
    up({ aiReply: text, aiCode: codes, aiSite: host, aiFinal: isFinal === true });
  }

  var NUTS_IDLE_MS = 3500;   // total nuts mode: the reply must be quiet this long before it counts as finished
  var nutsOn = false;
  var idleSig = '';

  function nutsScroller(el) {
    var n = el;
    var cs = null;
    while (n && n !== document.body && n !== document.documentElement) {
      cs = window.getComputedStyle(n);
      if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && n.scrollHeight > n.clientHeight + 4) return n;
      n = n.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  }

  function forceScroll() {
    var els = all(cfg.reply);
    var el = els.length ? els[els.length - 1] : null;
    var sc = nutsScroller(el || document.body);
    try { sc.scrollTop = sc.scrollHeight; } catch (e) { /* ignore */ }
    try { window.scrollTo(0, document.documentElement.scrollHeight); } catch (e2) { /* ignore */ }
    if (el) { try { el.scrollIntoView({ block: 'end' }); } catch (e3) { /* ignore */ } }
  }

  window.addEventListener('message', function (e) {
    var d = e.data;
    if (e.source !== window.parent || !d || typeof d.nutsMode !== 'boolean') return;
    nutsOn = d.nutsMode;
  });

  // nuts mode: keep the chat scrolled to the bottom for as long as the AI is generating
  setInterval(function () {
    if (nutsOn && wasGen) forceScroll();
  }, 250);

  setInterval(function () {
    var stopEl = first(cfg.stop);
    if (stopEl) sawStop = true;
    var s = streaming();
    var gen = !!stopEl || (!sawStop && s);
    if (gen) { wasGen = true; idleSince = 0; idleSig = ''; return; }
    if (!wasGen) return;
    if (!idleSince) { idleSince = Date.now(); idleSig = lastSig; }
    if (nutsOn && lastSig !== idleSig) { idleSince = Date.now(); idleSig = lastSig; return; }   // text still changing: keep waiting
    if (Date.now() - idleSince < (nutsOn ? NUTS_IDLE_MS : 1200)) return;   // idle long enough = the reply is finished
    wasGen = false; idleSince = 0; idleSig = '';
    if (nutsOn) {
      forceScroll();
      setTimeout(function () { report(true); }, 800);
    } else {
      report(false);
    }
  }, 600);

  // ── Insert text into the chat box and press Send ──
  function has(input, text) {
    var a = (input.innerText || input.textContent || input.value || '').replace(/\s+/g, '');
    return a.indexOf(text.replace(/\s+/g, '').slice(0, 40)) >= 0;
  }
  function fill(input, text) {
    input.focus();
    if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
      var proto = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, text);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    try {
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, text);
    } catch (e) { /* ignore */ }
    if (has(input, text)) return;
    // Fallback: synthetic paste (the site may turn a long paste into an attachment, which is fine)
    try {
      var dt = new DataTransfer();
      dt.setData('text/plain', text);
      input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    } catch (e2) { /* ignore */ }
  }

  var sending = false;
  function clickSend(input, n) {
    var b = first(cfg.send);
    if (b && !b.disabled && b.getAttribute('aria-disabled') !== 'true') { b.click(); sending = false; return; }
    if (n >= 16) {   // no usable Send button after ~4s → try Enter
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
      sending = false;
      return;
    }
    setTimeout(function () { clickSend(input, n + 1); }, 250);
  }
  function send(text, tries) {
    if (tries > 120) { sending = false; return; }                                                         // gave up after ~90s
    var input = first(cfg.input);
    if (first(cfg.stop) || !input) { setTimeout(function () { send(text, tries + 1); }, 700); return; }   // still generating / page not ready
    fill(input, text);
    setTimeout(function () { clickSend(input, 0); }, 600);
  }

  window.addEventListener('message', function (e) {
    if (e.source !== window.parent) return;
    var d = e.data;
    if (!d || typeof d.sendToAI !== 'string' || !d.sendToAI || sending) return;
    sending = true;
    if (d.nuts === true) nutsOn = true;
    send(d.sendToAI, 0);
  });
})();
