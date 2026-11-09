// TRINITY PAIR SYNC — ported from Tampermonkey userscript to a Chrome extension
// content script. Injected into the OlympTrade iframe (all_frames: true, see
// manifest.json) so it can auto-switch pairs the same way it did standalone.
(function TRINITY_PAIR_SYNC_OMNI() {
    'use strict';

        if (window.__trinitySyncInjected) return;
    window.__trinitySyncInjected = true;

    // ── DETECT BROKER ─────────────────────────────────────────────
    const IS_OT = location.hostname.includes('olymptrade.com');
    const IS_PO = location.hostname.includes('pocketoption.com') || location.hostname.includes('po.trade');
    const IS_QX = location.hostname.includes('qxbroker') || location.hostname.includes('quotex') || location.hostname.includes('market-qx');

    // ── CONFIG ────────────────────────────────────────────────────
    const POLL_MS  = 250;
        const SHOW_HUD = false; // HUD + calculator hidden: pair switching runs silently
    const SHOW_DIAG = false; // yellow info log box hidden

    // ── STATE & LOGGING ───────────────────────────────────────────
    let lastSwitchedPair = null;
    let lastSwitchedAt   = 0;
    let pollId           = null;
    let hudEl            = null;
    let lastClipboardRaw = null;

    const log  = (m) => console.log(`%c[TRINITY-SYNC] ${m}`, 'color:#FFFFFF;font-weight:bold');
    const warn = (m) => dgWarn(m) || console.warn(`%c[TRINITY-SYNC] ${m}`, 'color:#FFFFFF;font-weight:bold');
    const ok   = (m) => console.log(`%c[TRINITY-SYNC] ✅ ${m}`, 'color:#FFFFFF;font-weight:bold');

    // ── PAIR DATA (AOFS 28-Pair List) ──────────────────────────────
    const PAIRS = {
                'BTCUSD': { ot: '[data-test="asset-select-button-Bitcoin/ftt"]', poLabel: 'BTC/USD', keywords: ['btcusd', 'btc/usd', 'bitcoin'], display: '₿ BTCUSD' },
        'ETHUSD': { ot: '[data-test="asset-select-button-ETHUSD/ftt"]', poLabel: 'ETH/USD', keywords: ['ethusd', 'eth/usd', 'ethereum'], display: 'Ξ ETHUSD' },
        'LTCUSD': { ot: '[data-test="asset-select-button-LTCUSD/ftt"]', poLabel: 'LTC/USD', keywords: ['ltcusd', 'ltc/usd', 'litecoin'], display: 'Ł LTCUSD' },
        'XAGUSD': { ot: '[data-test="asset-select-button-XAGUSD/ftt"]', poLabel: 'XAG/USD', keywords: ['xagusd', 'xag/usd'], display: '🥈 XAGUSD' },
        'XAUUSD': { ot: '[data-test="asset-select-button-XAUUSD/ftt"]', poLabel: 'XAU/USD', keywords: ['xauusd', 'xau/usd'], display: '🥇 XAUUSD' },
        'XPTUSD': { ot: '[data-test="asset-select-button-PL/ftt"]', poLabel: 'XPT/USD', keywords: ['pl', 'platinum', 'xptusd', 'xpt/usd'], display: '⚪ XPTUSD' },
        'AUDCAD': { ot: '[data-test="asset-select-button-AUDCAD/ftt"]', poLabel: 'AUD/CAD', keywords: ['audcad', 'aud/cad'], display: '💱 AUDCAD' },
        'AUDCHF': { ot: '[data-test="asset-select-button-AUDCHF/ftt"]', poLabel: 'AUD/CHF', keywords: ['audchf', 'aud/chf'], display: '💱 AUDCHF' },
        'AUDJPY': { ot: '[data-test="asset-select-button-AUDJPY/ftt"]', poLabel: 'AUD/JPY', keywords: ['audjpy', 'aud/jpy'], display: '💱 AUDJPY' },
        'AUDNZD': { ot: '[data-test="asset-select-button-AUDNZD/ftt"]', poLabel: 'AUD/NZD', keywords: ['audnzd', 'aud/nzd'], display: '💱 AUDNZD' },
        'AUDUSD': { ot: '[data-test="asset-select-button-AUDUSD/ftt"]', poLabel: 'AUD/USD', keywords: ['audusd', 'aud/usd'], display: '💱 AUDUSD' },
        'EURAUD': { ot: '[data-test="asset-select-button-EURAUD/ftt"]', poLabel: 'EUR/AUD', keywords: ['euraud', 'eur/aud'], display: '💱 EURAUD' },
        'EURCAD': { ot: '[data-test="asset-select-button-EURCAD/ftt"]', poLabel: 'EUR/CAD', keywords: ['eurcad', 'eur/cad'], display: '💱 EURCAD' },
        'EURCHF': { ot: '[data-test="asset-select-button-EURCHF/ftt"]', poLabel: 'EUR/CHF', keywords: ['eurchf', 'eur/chf'], display: '💱 EURCHF' },
        'EURGBP': { ot: '[data-test="asset-select-button-EURGBP/ftt"]', poLabel: 'EUR/GBP', keywords: ['eurgbp', 'eur/gbp'], display: '💱 EURGBP' },
        'EURJPY': { ot: '[data-test="asset-select-button-EURJPY/ftt"]', poLabel: 'EUR/JPY', keywords: ['eurjpy', 'eur/jpy'], display: '💱 EURJPY' },
        'EURNZD': { ot: '[data-test="asset-select-button-EURNZD/ftt"]', poLabel: 'EUR/NZD', keywords: ['eurnzd', 'eur/nzd'], display: '💱 EURNZD' },
        'EURUSD': { ot: '[data-test="asset-select-button-EURUSD/ftt"]', poLabel: 'EUR/USD', keywords: ['eurusd', 'eur/usd'], display: '💱 EURUSD' },
        'GBPAUD': { ot: '[data-test="asset-select-button-GBPAUD/ftt"]', poLabel: 'GBP/AUD', keywords: ['gbpaud', 'gbp/aud'], display: '💱 GBPAUD' },
        'GBPCAD': { ot: '[data-test="asset-select-button-GBPCAD/ftt"]', poLabel: 'GBP/CAD', keywords: ['gbpcad', 'gbp/cad'], display: '💱 GBPCAD' },
        'GBPCHF': { ot: '[data-test="asset-select-button-GBPCHF/ftt"]', poLabel: 'GBP/CHF', keywords: ['gbpchf', 'gbp/chf'], display: '💱 GBPCHF' },
        'GBPJPY': { ot: '[data-test="asset-select-button-GBPJPY/ftt"]', poLabel: 'GBP/JPY', keywords: ['gbpjpy', 'gbp/jpy'], display: '💱 GBPJPY' },
        'GBPNZD': { ot: '[data-test="asset-select-button-GBPNZD/ftt"]', poLabel: 'GBP/NZD', keywords: ['gbpnzd', 'gbp/nzd'], display: '💱 GBPNZD' },
        'GBPUSD': { ot: '[data-test="asset-select-button-GBPUSD/ftt"]', poLabel: 'GBP/USD', keywords: ['gbpusd', 'gbp/usd'], display: '💱 GBPUSD' },
                'NZDJPY': { ot: '[data-test="asset-select-button-NZDJPY/ftt"]', poLabel: 'NZD/JPY', keywords: ['nzdjpy', 'nzd/jpy'], display: '💱 NZDJPY' },
        'NZDUSD': { ot: '[data-test="asset-select-button-NZDUSD/ftt"]', poLabel: 'NZD/USD', keywords: ['nzdusd', 'nzd/usd'], display: '💱 NZDUSD' },
        'USDCAD': { ot: '[data-test="asset-select-button-USDCAD/ftt"]', poLabel: 'USD/CAD', keywords: ['usdcad', 'usd/cad'], display: '💱 USDCAD' },
        'USDCHF': { ot: '[data-test="asset-select-button-USDCHF/ftt"]', poLabel: 'USD/CHF', keywords: ['usdchf', 'usd/chf'], display: '💱 USDCHF' },
        'USDJPY': { ot: '[data-test="asset-select-button-USDJPY/ftt"]', poLabel: 'USD/JPY', keywords: ['usdjpy', 'usd/jpy'], display: '💱 USDJPY' },
        'USDMXN': { ot: '[data-test="asset-select-button-USDMXN/ftt"]', poLabel: 'USD/MXN', keywords: ['usdmxn', 'usd/mxn'], display: '💱 USDMXN' },
        'USDNOK': { ot: '[data-test="asset-select-button-USDNOK/ftt"]', poLabel: 'USD/NOK', keywords: ['usdnok', 'usd/nok'], display: '💱 USDNOK' },
    };

    function buildHUD() {
        if (!SHOW_HUD || document.getElementById('_trinity_sync_hud')) return;

        hudEl = document.createElement('div');
        hudEl.id = '_trinity_sync_hud';
                hudEl.style.cssText = `
            position: fixed; bottom: 0; left: 0; width: 100%; height: 45px;
            background: #000432;
            border-top: 1px solid #ffffff;
            z-index: 999999;
            font-family: monospace; font-weight: bold; letter-spacing: 0;
            display: flex; flex-direction: row; align-items: center; justify-content: center; gap: 30px;
            pointer-events: auto; user-select: none; box-sizing: border-box;
        `;
        hudEl.innerHTML = `
            <span id="trinity-hud-pair" style="color: #ffffff; font-size: 16px;">IDLE</span>
            <div style="display: flex; align-items: center; gap: 12px;">
                <input id="t-prin" type="number" value="70" style="width: 80px; background: rgba(255,255,255,0.1); border: 1px solid #fff; color: #fff; font-size: 14px; text-align: center; padding: 4px; outline: none; border-radius: 4px;" title="Principle Amount">
                <span style="color: #ffffff; font-size: 14px;">x</span>
                <input id="t-perc" type="number" step="0.01" value="1.80" style="width: 70px; background: rgba(255,255,255,0.1); border: 1px solid #fff; color: #fff; font-size: 14px; text-align: center; padding: 4px; outline: none; border-radius: 4px;" title="Multiplier / %">
                <span style="color: #ffffff; font-size: 14px;">=</span>
                <span id="t-targ" style="color: #00ff00; font-size: 16px; cursor: pointer; padding: 4px 12px; background: rgba(0,255,0,0.15); border-radius: 4px; border: 1px dashed #00ff00; transition: all 0.15s ease;" title="Click to compound into Principle">126.00</span>
            </div>
        `;
        document.body.appendChild(hudEl);

        const prin = document.getElementById('t-prin');
        const perc = document.getElementById('t-perc');
        const targ = document.getElementById('t-targ');
        
        const calcTarget = () => {
            const p = parseFloat(prin.value) || 0;
            const pt = parseFloat(perc.value) || 0;
            targ.innerText = (p * pt).toFixed(2);
        };
        
        prin.addEventListener('input', calcTarget);
        perc.addEventListener('input', calcTarget);

        // Compounding logic: click total to make it the new principle
        targ.addEventListener('click', () => {
            const currentTotal = parseFloat(targ.innerText);
            if (!isNaN(currentTotal) && currentTotal > 0) {
                prin.value = currentTotal.toFixed(2);
                calcTarget(); // Calculate the newly spawned total

                // Visual flash indicator
                targ.style.backgroundColor = '#ffffff';
                targ.style.color = '#000000';
                setTimeout(() => {
                    targ.style.backgroundColor = 'rgba(0,255,0,0.15)';
                    targ.style.color = '#00ff00';
                }, 150);
            }
        });
    }

    function updateHUD(pairStr) {
        if (!hudEl) return;
        const span = document.getElementById('trinity-hud-pair');
        if (span) {
            span.innerText = PAIRS[pairStr] ? PAIRS[pairStr].display : pairStr;
            hudEl.style.background = '#ffffff';
            span.style.color = '#000432';

            setTimeout(() => {
                hudEl.style.background = '#000432';
                span.style.color = '#ffffff';
            }, 600);
        }
    }

    function nativeClick(el, offsetXRatio = 0.5) {
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const cx = rect.width > 0 ? rect.left + rect.width * offsetXRatio : 0;
        const cy = rect.height > 0 ? rect.top + rect.height / 2 : 0;
        const opts = { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy, pointerId: 1, pointerType: 'mouse', isPrimary: true };
        ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(type => {
            try { el.dispatchEvent(new MouseEvent(type, opts)); } catch(e){}
        });
    }

    function switchOT(pairStr, pairConfig) {
        ok(`OT Tab Switch initiated for ${pairStr}`);
        if (pairConfig.ot) {
            const directTab = document.querySelector(pairConfig.ot);
            if (directTab && directTab.getBoundingClientRect().top <= 90) {
                nativeClick(directTab, 0.90);
                if (directTab.parentElement && typeof directTab.parentElement.className === 'string' && directTab.parentElement.className.includes('assets-tabs-tab')) {
                    nativeClick(directTab.parentElement, 0.90);
                }
                return;
            }
        }
        const topBarElements = Array.from(document.querySelectorAll('div, p, span')).filter(el => {
            const r = el.getBoundingClientRect();
            if (r.top < 0 || r.top > 90 || r.width === 0 || r.height === 0) return false;
            const txt = (el.innerText || el.textContent || '').trim().toLowerCase().replace(/\s+/g, ' ');
            if (txt.includes('otc')) return false;
            return pairConfig.keywords.some(kw => txt.includes(kw)) && txt.length < 40;
        });

        if (topBarElements.length > 0) {
            const validCandidates = topBarElements.filter(el => {
                const cls = (typeof el.className === 'string' ? el.className : '').toLowerCase();
                const isClose = cls.includes('close') || cls.includes('remove') || cls.includes('delete') || el.textContent.trim() === '✖' || el.textContent.trim() === '×';
                return !isClose && el.tagName !== 'svg' && el.tagName !== 'path';
            });
            if (validCandidates.length > 0) {
                let targetEl = validCandidates[0];
                for (const el of validCandidates) {
                    const dt = el.getAttribute('data-test') || '';
                    const cls = typeof el.className === 'string' ? el.className : '';
                    if (dt.includes('asset-select-button') || cls.includes('assets-tabs-tab')) {
                        targetEl = el;
                        break;
                    }
                }
                nativeClick(targetEl, 0.90);
                if (targetEl.parentElement && targetEl.parentElement.getBoundingClientRect().top <= 90) {
                    nativeClick(targetEl.parentElement, 0.90);
                }
                ok(`Selected OT top tab: ${pairStr}`);
            }
        }
    }

    function switchPO(pairStr, pairConfig) {
        ok(`PO Switch initiated for ${pairStr} (${pairConfig.poLabel})`);
        const topBarElements = Array.from(document.querySelectorAll('a, div, li, span')).filter(el => {
            const rect = el.getBoundingClientRect();
            if (rect.top > 120 || rect.width === 0 || rect.height === 0) return false;
            const txt = (el.innerText || el.textContent || '').trim().toUpperCase();
            return txt.includes(pairConfig.poLabel) && txt.length < 30;
        });
        if (topBarElements.length > 0) {
            const validCandidates = topBarElements.filter(el => {
                const cls = (typeof el.className === 'string' ? el.className : '').toLowerCase();
                const isClose = cls.includes('close') || cls.includes('remove') || cls.includes('delete') || el.textContent.trim() === '✖' || el.textContent.trim() === '×';
                return !isClose && el.tagName !== 'SVG' && el.tagName !== 'PATH';
            });
            if (validCandidates.length > 0) {
                let targetEl = validCandidates[validCandidates.length - 1]; 
                for (const el of validCandidates) {
                    const cls = typeof el.className === 'string' ? el.className : '';
                    if (cls.includes('assets-favorites-item__label') || cls.includes('assets-favorites-item')) {
                        targetEl = el;
                        break;
                    }
                }
                ok(`PO Switch: Successfully targeting top box tab for ${pairStr}`);
                nativeClick(targetEl, 0.3); 
                if (targetEl.parentElement && targetEl.parentElement.getBoundingClientRect().top <= 120) {
                    nativeClick(targetEl.parentElement, 0.3);
                }
                return;
            }
        }
        warn(`PO: Top tab for ${pairStr} not found. Falling back to dropdown menu.`);
        const menuBtn = document.querySelector('.current-symbol') || document.querySelector('[class*="asset-select"]');
        if (menuBtn) nativeClick(menuBtn);

        setTimeout(() => {
            const searchInput = document.querySelector('input[placeholder*="Search" i], input[class*="search" i]');
            if (searchInput) {
                searchInput.value = pairConfig.poLabel;
                searchInput.dispatchEvent(new Event('input', { bubbles: true }));
                searchInput.dispatchEvent(new Event('change', { bubbles: true }));
                setTimeout(() => {
                    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
                    while (walker.nextNode()) {
                        const el = walker.currentNode;
                        if (el.textContent.trim() === pairConfig.poLabel) {
                            nativeClick(el);
                            break;
                        }
                    }
                }, 500);
            }
        }, POLL_MS);
    }

    function switchQX(pairStr, pairConfig) {
        ok(`QX Switch initiated for ${pairStr} (${pairConfig.poLabel})`);
        const existingTab = Array.from(document.querySelectorAll('div, span, button')).find(el => {
            const txt = el.textContent ? el.textContent.trim().toUpperCase() : '';
            return (txt === pairConfig.poLabel || txt === `${pairConfig.poLabel} (OTC)`) && el.children.length === 0;
        });

        if (existingTab && existingTab.offsetWidth > 0) {
            let topTab = existingTab;
            for (let i = 0; i < 3; i++) {
                if (!topTab.parentElement) break;
                if (topTab.parentElement.offsetTop < 120) {
                    topTab = topTab.parentElement;
                    break;
                }
                topTab = topTab.parentElement;
            }
            ok(`QX Switch: Clicking top bar tab for ${pairStr}`);
            nativeClick(topTab);
            nativeClick(existingTab);
            return;
        }

        const menuBtn = document.getElementById('header-mobile-asset-btn') 
            || document.querySelector('[id*="asset-btn"]')
            || Array.from(document.querySelectorAll('div, button, a')).find(el => {
                const id = el.id ? el.id.toLowerCase() : '';
                const cls = el.className && typeof el.className === 'string' ? el.className.toLowerCase() : '';
                return (id.includes('asset') || cls.includes('asset')) && el.offsetWidth > 0;
            });

        if (menuBtn) {
            nativeClick(menuBtn);
        } else {
            warn(`QX: Asset header button not found.`);
        }

        setTimeout(() => {
            const allInputs = Array.from(document.querySelectorAll('input'));
            const searchInput = allInputs.find(input => {
                const val = input.value || '';
                const isTimeOrAmount = val === '100' || val.includes('00:') || input.classList.contains('mobile-time-input__block');
                return !isTimeOrAmount && input.offsetWidth > 0;
            }) || document.querySelector('input[placeholder*="earch" i]');

            if (searchInput) {
                searchInput.focus();
                const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
                nativeSetter.call(searchInput, pairConfig.poLabel);
                searchInput.dispatchEvent(new Event('input', { bubbles: true }));
                searchInput.dispatchEvent(new Event('change', { bubbles: true }));

                setTimeout(() => {
                    const candidates = Array.from(document.querySelectorAll('div, span, li, p')).filter(el => {
                        if (el.children.length > 2) return false;
                        const txt = el.textContent ? el.textContent.trim().toUpperCase() : '';
                        return txt === pairConfig.poLabel || txt === `${pairConfig.poLabel} (OTC)`;
                    });

                    if (candidates.length > 0) {
                        const targetTextEl = candidates[candidates.length - 1];
                        let clickContainer = targetTextEl;

                        for (let i = 0; i < 4; i++) {
                            if (!clickContainer.parentElement) break;
                            const p = clickContainer.parentElement;
                            if (p.tagName === 'LI' || p.tagName === 'A' || p.tagName === 'BUTTON' || (p.className && typeof p.className === 'string' && p.className.includes('item')) || window.getComputedStyle(p).cursor === 'pointer') {
                                clickContainer = p;
                                break;
                            }
                            clickContainer = p;
                        }
                        ok(`QX Switch: Executing click for ${pairStr}`);
                        nativeClick(clickContainer);
                        nativeClick(targetTextEl);
                    } else {
                        warn(`QX: Could not locate ${pairStr} in search dropdown.`);
                    }
                }, 400);
            } else {
                warn("QX: Search input not found after opening menu.");
            }
        }, POLL_MS);
    }

    function executeSwitch(pairStr) {
        if (!pairStr) return;
        const cleanPair = pairStr.trim().toUpperCase();
        if (cleanPair === lastSwitchedPair && Date.now() - lastSwitchedAt < 1500) return;

                const pairConfig = PAIRS[cleanPair];
        if (!pairConfig) { warn('Unknown pair ' + cleanPair + ' (not in PAIRS)'); return; }
        if (IS_OT && pairConfig.ot && document.querySelector(pairConfig.ot + '[data-selected="true"]')) {
            lastSwitchedPair = cleanPair;
            lastSwitchedAt = Date.now();
            return;
        }

        lastSwitchedPair = cleanPair;
        lastSwitchedAt = Date.now();
        updateHUD(cleanPair);

        if (IS_OT)      switchOT(cleanPair, pairConfig);
        else if (IS_PO) switchPO(cleanPair, pairConfig);
        else if (IS_QX) switchQX(cleanPair, pairConfig);
        else            warn(`Unknown broker — cannot switch to ${cleanPair}.`);
    }

    async function checkClipboard() {
        try {
            const text = await navigator.clipboard.readText();
            const clean = (text || '').trim().toUpperCase();
            if (clean === lastClipboardRaw) return;
            lastClipboardRaw = clean;
            if (PAIRS[clean]) executeSwitch(clean);
        } catch (e) {}
    }

        const TRADE_ORIGINS = [(function () { try { return chrome.runtime.getURL('').replace(/\/$/, ''); } catch (e) { return ''; } })()].filter(Boolean);
    const MAX_AMOUNT = 10;
    const TRADE_COOLDOWN_MS = 3000;
    const AMOUNT_SEL = '[data-test="amount-input"] input';
    const UP_SEL = 'button[data-test="deal-submit-button-up"]';
    const DOWN_SEL = 'button[data-test="deal-submit-button-down"]';
        let tradeBusy = false;
    let lastTradeAt = 0;
    const lastTradeByPair = {};
    const doneIds = new Set();

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    async function waitFor(fn, timeout) {
        const t0 = Date.now();
        while (Date.now() - t0 < timeout) {
            const v = fn();
            if (v) return v;
            await sleep(80);
        }
        return null;
    }

    function setReactInput(el, value) {
        el.focus();
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(el, String(value));
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    const readAmount = () => {
        const el = document.querySelector(AMOUNT_SEL);
        return el ? parseFloat(String(el.value).replace(/[^\d.]/g, '')) : NaN;
    };

    async function runTrade(order) {
        if (!IS_OT) return;
        const cleanPair = String(order.pair || '').trim().toUpperCase();
        const cfg = PAIRS[cleanPair];
        const amount = Number(order.amount);
        const direction = order.direction;
        if (!cfg) { warn(`Trade ignored: unknown pair ${cleanPair}`); return; }
        if (!Number.isFinite(amount) || amount <= 0) { warn(`Trade ignored: bad amount ${order.amount}`); return; }
        if (amount > MAX_AMOUNT) { warn(`Trade ignored: amount ${amount} exceeds MAX_AMOUNT ${MAX_AMOUNT}`); return; }
        if (direction !== 'buy' && direction !== 'sell') { warn(`Trade ignored: bad direction ${direction}`); return; }
        if (tradeBusy) { warn('Trade ignored: previous trade still running'); return; }
                const sigId = order.id ? String(order.id).slice(0, 200) : '';
        if (sigId && doneIds.has(sigId)) { warn('Trade ignored: signal already traded ' + sigId); return; }
        if (Date.now() - (lastTradeByPair[cleanPair] || 0) < TRADE_COOLDOWN_MS) { warn('Trade ignored: cooldown ' + cleanPair); return; }
        if (sigId) {
            if (doneIds.size > 500) doneIds.clear();
            doneIds.add(sigId);
        }
        tradeBusy = true;
        try {
            executeSwitch(cleanPair);
            const sel = await waitFor(() => document.querySelector(cfg.ot + '[data-selected="true"]'), 4000);
            if (!sel) { warn(`Trade aborted: ${cleanPair} did not become the selected asset`); return; }
            let stuck = false;
            for (let i = 0; i < 2 && !stuck; i++) {
                const inp = await waitFor(() => document.querySelector(AMOUNT_SEL), 3000);
                if (!inp) break;
                setReactInput(inp, amount);
                await sleep(250);
                inp.blur();
                await sleep(250);
                stuck = readAmount() === amount;
            }
            if (!stuck) { warn(`Trade aborted: amount did not stick (page shows ${readAmount()})`); return; }
            if (!document.querySelector(cfg.ot + '[data-selected="true"]')) { warn('Trade aborted: selected pair changed'); return; }
            const btn = document.querySelector(direction === 'buy' ? UP_SEL : DOWN_SEL);
            if (!btn) { warn(`Trade aborted: ${direction} button not found`); return; }
            if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') { warn(`Trade aborted: ${direction} button disabled (asset closed?)`); return; }
                        nativeClick(btn, 0.5);
            lastTradeAt = Date.now();
            lastTradeByPair[cleanPair] = lastTradeAt;
            ok(`${direction.toUpperCase()} clicked: ${cleanPair} @ ${amount}`);
        } catch (e) {
            warn(`Trade error: ${e && e.message}`);
        } finally {
            tradeBusy = false;
        }
    }

    window.addEventListener('message', (event) => {
        const tradeMsg = event.data?.trinityOS_trade;
        if (tradeMsg) {
            if (!TRADE_ORIGINS.includes(event.origin)) {
                warn(`Trade message rejected from origin ${event.origin}`);
                return;
            }
            runTrade(tradeMsg);
            return;
        }
        const pair = event.data?.trinityOS_pair || event.data?.pair;
        if (pair) {
            log(`postMessage received: ${pair}`);
            executeSwitch(pair.toString());
        }
    });

    var dgBox = null, dgTxt = null, dgAll = [], dgLines = [], dgCount = { total: 0, rel: 0 }, dgLast = { sel: '', keys: '', amt: '' };
        function dgCopyText(t, btn) {
            var done = function (ok) {
                btn.textContent = ok ? 'COPIED' : 'COPY FAILED';
                setTimeout(function () { btn.textContent = 'COPY LOG'; }, 1500);
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
                    navigator.clipboard.writeText(t).then(function () { done(true); }, fb);
                    return;
                }
            } catch (e0) {}
            fb();
        }
        function dgWarn(m) { dgPush('WARN ' + m); }
        function dgState() {
            var tabs = document.querySelectorAll('[data-test^="asset-select-button-"]');
            return 'tabs=' + tabs.length + ' amount=' + (document.querySelector(AMOUNT_SEL) ? 'ok' : 'MISSING') + ' up=' + (document.querySelector(UP_SEL) ? 'ok' : 'MISSING') + ' down=' + (document.querySelector(DOWN_SEL) ? 'ok' : 'MISSING');
        }
        function dgPaint() {
            if (!dgBox) return;
            if (!dgTxt) {
                        var dgBtn = document.createElement('button');
                        dgBtn.textContent = 'COPY LOG';
                        dgBtn.style.cssText = 'pointer-events:auto;cursor:pointer;display:block;margin:0 0 3px 0;background:#ff0;color:#000;border:0;font:bold 10px monospace;padding:2px 8px;';
                        dgBtn.addEventListener('click', function (e) {
                            e.stopPropagation();
                            dgCopyText('OLYMP PANE (trade monitor) msgs=' + dgCount.total + ' relevant=' + dgCount.rel + '\n' + dgState() + '\n' + dgAll.join('\n'), dgBtn);
                        });
                        dgTxt = document.createElement('div');
                        dgBox.appendChild(dgBtn);
                        dgBox.appendChild(dgTxt);
                    }
                    dgTxt.textContent = 'OLYMP PANE (trade monitor) msgs=' + dgCount.total + ' relevant=' + dgCount.rel + '\n' + dgState() + '\n' + dgLines.join('\n');
        }
                function dgPush(line) {
            try {
                if (!SHOW_DIAG) return;
                if (!(window === window.top || window.parent === window.top)) return;
                var host = document.body || document.documentElement;
                if (!host) return;
                dgLines = dgLines || [];
                if (!dgBox) {
                    dgBox = document.createElement('div');
                    dgBox.id = '_trinity_diag';
                    dgBox.style.cssText = 'position:fixed;left:6px;bottom:30px;width:430px;max-height:45vh;overflow:hidden;background:rgba(0,0,0,.85);color:#ff0;font:10px/1.3 monospace;padding:4px 6px;z-index:2147483647;pointer-events:none;white-space:pre-wrap;word-break:break-all;border:1px solid #ff0;';
                    host.appendChild(dgBox);
                }
                var dgStamp = new Date().toLocaleTimeString() + ' ' + line;
                            dgLines.push(dgStamp);
                            dgAll.push(dgStamp);
                            if (dgAll.length > 500) dgAll.shift();
                if (dgLines.length > 8) dgLines.shift();
                dgPaint();
            } catch (e) {}
        }
        window.addEventListener('message', function (ev) {
            try {
                dgCount.total++;
                var d = ev.data;
                if (!d || typeof d !== 'object') return;
                var ks = Object.keys(d).join(',');
                if (!/trinity|pair|trade|splitView/i.test(ks)) return;
                dgCount.rel++;
                var s = '';
                try { s = JSON.stringify(d); } catch (e1) { s = '?'; }
                dgPush('MSG from ' + ev.origin + ' ' + s.slice(0, 120));
                if (d.trinityOS_trade) {
                    var tp = String(d.trinityOS_trade.pair || '').trim().toUpperCase();
                    var tc = PAIRS[tp];
                    dgPush('trade check: origin ' + (TRADE_ORIGINS.indexOf(ev.origin) >= 0 ? 'OK' : 'REJECTED (allowed: ' + TRADE_ORIGINS.join('|') + ')') + ' | PAIRS[' + tp + '] ' + (tc ? 'found, tab selector ' + tc.ot + ' present=' + !!document.querySelector(tc.ot) : 'MISSING'));
                }
            } catch (e0) {}
        }, true);
        document.addEventListener('click', function (ev) {
            try {
                var t = ev.target && ev.target.closest ? ev.target.closest('[data-test^="deal-submit-button-"]') : null;
                if (t) dgPush('CLICK ' + t.getAttribute('data-test') + ' trusted=' + ev.isTrusted);
            } catch (e) {}
        }, true);
        setInterval(function () {
            try {
                var tabs = document.querySelectorAll('[data-test^="asset-select-button-"]');
                var sel = '', keys = [], i, k;
                for (i = 0; i < tabs.length; i++) {
                    k = tabs[i].getAttribute('data-test').replace('asset-select-button-', '');
                    keys.push(k);
                    if (tabs[i].getAttribute('data-selected') === 'true') sel = k;
                }
                var kj = keys.join(',');
                if (kj !== dgLast.keys) { dgLast.keys = kj; dgPush('tab keys: ' + kj); }
                if (sel !== dgLast.sel) { dgLast.sel = sel; dgPush('selected tab -> ' + (sel || 'none')); }
                var a = document.querySelector(AMOUNT_SEL);
                var av = a ? a.value : 'MISSING';
                if (av !== dgLast.amt) { dgLast.amt = av; dgPush('amount box -> ' + av); }
                dgPaint();
            } catch (e) {}
        }, 1000);
        dgPush('script active | IS_OT=' + IS_OT + ' | frame=' + (window === window.top ? 'top' : 'child') + ' | allowed origin: ' + TRADE_ORIGINS.join('|'));
        window._trinitySync = {
        go: (pair) => executeSwitch(pair),
        list: () => { log('Active pairs: ' + Object.keys(PAIRS).join(', ')); },
        stop: () => { clearInterval(pollId); hudEl?.remove(); ok('Sync stopped.'); }
    };

    function init() {
        buildHUD();
        pollId = setInterval(checkClipboard, POLL_MS);

        let brokerName = 'Unknown Broker';
        if (IS_OT) brokerName = 'OlympTrade';
        else if (IS_PO) brokerName = 'PocketOption';
        else if (IS_QX) brokerName = 'Quotex';

        log(`══ TRINITY PAIR SYNC v7.7 EXTENSION ACTIVE — ${brokerName} ══`);
    }

    if (document.body) init();
    else document.addEventListener('DOMContentLoaded', init);

})();