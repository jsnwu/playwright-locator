/**
 * @file content.js
 * This script is injected into web pages. It handles two main features:
 * 1. The "Locator Generator": An element picking mode to automatically generate a stable Playwright locator.
 * 2. The "Selector Verifier": An engine to find and highlight elements on the page based on a manually entered locator string (CSS or Playwright).
 */

// --- STATE VARIABLES ---
let isPickingMode = false;
let pickingHighlightEl = null;
let pickingStyleEl = null;
let pickingHoverTarget = null;

const PICKING_UI_ATTR = 'data-playwright-locator-ui';
const VERIFY_BANNER_ID = 'playwright-locator-verify-banner';
/** Must match storage cap in background.js when persisting `locatorSuggestions`. */
const MAX_LOCATOR_SUGGESTIONS = 5;

let verifyBannerTimer = null;

function removeVerifyBanner() {
    if (verifyBannerTimer) {
        clearTimeout(verifyBannerTimer);
        verifyBannerTimer = null;
    }
    const el = document.getElementById(VERIFY_BANNER_ID);
    if (el) el.remove();
}

/** In-page status: extension popups cannot be transparent; this sits on the page over highlights. */
function showVerifyBanner(matchCount) {
    removeVerifyBanner();
    const wrap = document.createElement('div');
    wrap.id = VERIFY_BANNER_ID;
    wrap.setAttribute(PICKING_UI_ATTR, 'verify-banner');
    wrap.setAttribute('role', 'status');
    wrap.style.cssText = [
        'position:fixed',
        'left:50%',
        'bottom:20px',
        'transform:translateX(-50%)',
        'display:flex',
        'align-items:center',
        'gap:10px',
        'flex-wrap:wrap',
        'max-width:min(90vw,420px)',
        'padding:10px 14px',
        'font:600 13px system-ui,-apple-system,Segoe UI,Roboto,sans-serif',
        'color:#14532d',
        'background:rgba(255,255,255,0.85)',
        'backdrop-filter:blur(12px)',
        '-webkit-backdrop-filter:blur(12px)',
        'border:1px solid rgba(22,163,74,0.4)',
        'border-radius:10px',
        'box-shadow:0 4px 24px rgba(0,0,0,0.12)',
        'z-index:2147483647',
    ].join(';');

    const msg = document.createElement('span');
    msg.textContent =
        matchCount === 1 ? '1 match highlighted on this page.' : `${matchCount} matches highlighted on this page.`;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Dismiss';
    btn.style.cssText =
        'flex-shrink:0;padding:4px 10px;font:600 12px system-ui,sans-serif;cursor:pointer;border-radius:6px;border:1px solid #15803d;background:#f0fdf4;color:#14532d';
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeVerifyBanner();
    });

    wrap.appendChild(msg);
    wrap.appendChild(btn);
    document.body.appendChild(wrap);
    verifyBannerTimer = setTimeout(removeVerifyBanner, 8000);
}

/** Picking-mode hover frame (blue) */
const LOCATOR_HIGHLIGHT = {
    border: '2px solid #61afef',
    borderRadius: '4px',
    background: 'rgba(97, 175, 239, 0.12)',
    boxShadow: '0 0 0 1px rgba(0,0,0,0.25), 0 2px 12px rgba(97, 175, 239, 0.35)',
    outlineOffset: '2px',
};

/** Verify / Evaluate matches on the page */
const VERIFY_HIGHLIGHT = {
    border: '2px solid #16a34a',
    borderRadius: '4px',
    background: 'rgba(34, 197, 94, 0.16)',
    boxShadow: '0 0 0 1px rgba(0,0,0,0.2), 0 2px 12px rgba(22, 163, 74, 0.45)',
    outlineOffset: '2px',
};

// --- UTILITY FUNCTIONS ---

function getImplicitRole(element) {
    const tagName = element.tagName.toLowerCase();
    const type = element.getAttribute('type');
    const explicitRole = element.getAttribute('role');
    if (explicitRole) return explicitRole;

    const roleMappings = {
        'a': 'link', 'area': 'link', 'button': 'button',
        'h1': 'heading', 'h2': 'heading', 'h3': 'heading', 'h4': 'heading', 'h5': 'heading', 'h6': 'heading',
        'img': 'img', 'textarea': 'textbox', 'select': 'combobox',
        'li': 'listitem', 'ul': 'list', 'ol': 'list',
        'nav': 'navigation', 'form': 'form', 'dialog': 'dialog',
        'table': 'table', 'tr': 'row', 'td': 'cell', 'th': 'columnheader', 'thead': 'rowgroup', 'tbody': 'rowgroup', 'tfoot': 'rowgroup',
        'fieldset': 'group', 'option': 'option', 'optgroup': 'group',
        'progress': 'progressbar', 'meter': 'progressbar',
        'article': 'article', 'aside': 'complementary', 'footer': 'contentinfo', 'header': 'banner', 'main': 'main', 'section': 'region',
        'summary': 'button', 'details': 'group',
    };
    if (roleMappings[tagName]) return roleMappings[tagName];

    if (tagName === 'input') {
        const inputTypeRoles = {
            'button': 'button', 'submit': 'button', 'reset': 'button',
            'checkbox': 'checkbox', 'radio': 'radio',
            'text': 'textbox', 'email': 'textbox', 'password': 'textbox', 'search': 'textbox',
            'tel': 'textbox', 'url': 'textbox', 'number': 'spinbutton', 'range': 'slider',
            'date': 'textbox', 'time': 'textbox', 'datetime-local': 'textbox'
        };
        return inputTypeRoles[type] || 'textbox';
    }
    return null;
}

function getAccessibleName(element) {
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel.trim();

    if (element.id) {
        const label = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
        if (label) return (label.innerText || label.textContent).trim();
    }

    const tagName = element.tagName.toLowerCase();
    const type = element.getAttribute('type');

    // =================================================================
    // ADDED THIS BLOCK TO CORRECTLY GET THE NAME FROM <input type="submit">
    // =================================================================
    if (tagName === 'input' && ['submit', 'button', 'reset'].includes(type)) {
        if (element.value) {
            return element.value.trim();
        }
    }

    if (tagName === 'img') {
        const altText = element.getAttribute('alt');
        if (altText) return altText.trim();
    }

    const text = (element.innerText || "").trim().replace(/\s+/g, ' ');
    if (text && text.length < 120) return text;
    
    const title = element.getAttribute('title');
    if (title) return title.trim();
    
    return '';
}

function getRelativeCSS(element, parent) {
    let selector = element.tagName.toLowerCase();
    const stableClasses = Array.from(element.classList)
        .filter(cls => cls && !cls.includes(':') && !cls.includes('[') && cls.length > 2);
    if (stableClasses.length > 0) selector += '.' + stableClasses.join('.');

    const siblings = Array.from(parent.children);
    const elementsWithSameSelector = siblings.filter(sibling => sibling.matches(selector));

    if (elementsWithSameSelector.length > 1) {
        const index = elementsWithSameSelector.indexOf(element);
        selector += `:nth-of-type(${index + 1})`;
    }
    return selector;
}

function isLocatorUniqueInScope(locator, value, targetElement, scope = document) {
    if (locator === 'getByRole') {
        const elements = Array.from(scope.querySelectorAll('*')).filter(el => getImplicitRole(el) === value);
        return elements.length === 1 && elements[0] === targetElement;
    }
    return false;
}

function escapeLocatorStr(str) {
    return str.replace(/"/g, '\\"');
}

function normalizeTextContent(s) {
    return String(s || '')
        .trim()
        .replace(/\s+/g, ' ');
}

/**
 * Text sources for getByText / locator.hasText (inner text, values, aria-label, etc.).
 */
function getElementTextMatchSources(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return [];
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    const parts = [];
    const add = (v) => {
        if (v == null || v === '') return;
        const n = normalizeTextContent(String(v));
        if (n) parts.push(n);
    };
    add(el.innerText);
    add(el.textContent);
    if (tag === 'input' || tag === 'textarea') {
        add(el.value);
    }
    add(el.getAttribute('aria-label'));
    add(el.getAttribute('placeholder'));
    if (tag === 'a' || tag === 'area') {
        add(el.getAttribute('href'));
        add(el.getAttribute('title'));
    }
    if (tag === 'button' || (tag === 'input' && ['submit', 'button', 'reset'].includes(type))) {
        add(el.getAttribute('title'));
    }
    return [...new Set(parts)];
}

function elementMatchesGetByText(el, text, exact) {
    const t = normalizeTextContent(text);
    const raw = String(text).trim();
    if (!t && !raw) return false;
    const sources = getElementTextMatchSources(el);
    if (exact) {
        return sources.some((s) => s === t);
    }
    return sources.some((s) => s.includes(t) || (raw && s.includes(raw)));
}

function countElementsMatchingGetByTextExact(text) {
    const t = normalizeTextContent(text);
    return Array.from(document.querySelectorAll('*')).filter(
        (el) => el.nodeType === Node.ELEMENT_NODE && getElementTextMatchSources(el).some((s) => s === t)
    ).length;
}

function singleExactTextMatchUnderScope(scopeRoot, picked, text) {
    const t = normalizeTextContent(text);
    const nodes = [scopeRoot, ...scopeRoot.querySelectorAll('*')];
    const hits = nodes.filter(
        (el) =>
            el.nodeType === Node.ELEMENT_NODE && getElementTextMatchSources(el).some((s) => s === t)
    );
    return hits.length === 1 && hits[0] === picked;
}

/** Narrowing locator when bare getByText would match many nodes (e.g. nested "Cart" text). */
function buildScopedGetByTextLocator(picked, text) {
    let node = picked.parentElement;
    while (node && node !== document.body) {
        const sel = buildStableClassCssSelector(node);
        if (sel) {
            try {
                const matches = document.querySelectorAll(sel);
                if (
                    matches.length === 1 &&
                    matches[0] === node &&
                    singleExactTextMatchUnderScope(node, picked, text)
                ) {
                    const inner = `getByText("${escapeLocatorStr(text)}", { exact: true })`;
                    return `page.locator("${escapeLocatorStr(sel)}").${inner}`;
                }
            } catch (_) {
                /* invalid selector */
            }
        }
        node = node.parentElement;
    }
    return null;
}

/**
 * page.locator('scope').getByText('x', { exact: true }) — scope CSS parsed with escapes.
 */
function parseLocatorGetByTextChain(rawInput) {
    const s = rawInput.split(/ (#|\/\/)/)[0].trim();
    const head = s.match(/^\s*(?:page\.)?locator\s*\(\s*(["'])/);
    if (!head) return null;
    const q = head[1];
    let pos = head.index + head[0].length;
    let scopeCss = '';
    while (pos < s.length) {
        if (s[pos] === '\\' && pos + 1 < s.length) {
            scopeCss += s[pos + 1];
            pos += 2;
            continue;
        }
        if (s[pos] === q) {
            pos++;
            break;
        }
        scopeCss += s[pos];
        pos++;
    }
    while (pos < s.length && /\s/.test(s[pos])) pos++;
    if (s[pos] !== ')') return null;
    pos++;
    while (pos < s.length && /\s/.test(s[pos])) pos++;
    if (s[pos] !== '.') return null;
    pos++;
    while (pos < s.length && /\s/.test(s[pos])) pos++;
    const gbt = s.slice(pos).match(/^getByText\s*\(\s*(["'])/);
    if (!gbt) return null;
    pos += gbt[0].length;
    const tq = gbt[1];
    let text = '';
    while (pos < s.length) {
        if (s[pos] === '\\' && pos + 1 < s.length) {
            text += s[pos + 1];
            pos += 2;
            continue;
        }
        if (s[pos] === tq) {
            pos++;
            break;
        }
        text += s[pos];
        pos++;
    }
    const tail = s.slice(pos).trim();
    let exact = false;
    if (/\bexact\s*:\s*true\b/.test(tail)) exact = true;
    else if (/\bexact\s*:\s*false\b/.test(tail)) exact = false;
    return { scopeCss, text, exact };
}

function skipWsStr(s, i) {
    while (i < s.length && /\s/.test(s[i])) i++;
    return i;
}

function parseQuotedStrAt(s, i) {
    const q = s[i];
    if (q !== '"' && q !== "'" && q !== '`') return null;
    i++;
    let val = '';
    while (i < s.length) {
        if (s[i] === '\\' && i + 1 < s.length) {
            val += s[i + 1];
            i += 2;
            continue;
        }
        if (s[i] === q) return { value: val, next: i + 1 };
        val += s[i];
        i++;
    }
    return null;
}

function consumeBracedObjectEnd(s, pos) {
    if (s[pos] !== '{') return null;
    let depth = 0;
    let i = pos;
    while (i < s.length) {
        const c = s[i];
        if (c === '"' || c === "'" || c === '`') {
            const pq = parseQuotedStrAt(s, i);
            if (!pq) return null;
            i = pq.next;
            continue;
        }
        if (c === '{') depth++;
        else if (c === '}') {
            depth--;
            if (depth === 0) return i + 1;
        }
        i++;
    }
    return null;
}

/**
 * Parse one getByRole("role"[, { name, exact, hasText, hasNotText }]) starting at pos. Returns nextPos after closing ")".
 */
function parseGetByRoleInvocationAt(s, pos) {
    pos = skipWsStr(s, pos);
    if (!s.startsWith('getByRole', pos)) return null;
    pos += 'getByRole'.length;
    pos = skipWsStr(s, pos);
    if (s[pos] !== '(') return null;
    pos++;
    pos = skipWsStr(s, pos);
    const rq = parseQuotedStrAt(s, pos);
    if (!rq) return null;
    const role = rq.value;
    pos = skipWsStr(s, rq.next);
    if (s[pos] === ')') {
        return { role, name: null, nameExact: false, hasText: undefined, hasNotText: undefined, nextPos: pos + 1 };
    }
    if (s[pos] !== ',') return null;
    pos++;
    pos = skipWsStr(s, pos);

    let name = null;
    let nameExact = false;

    if (s[pos] === '{') {
        const objEnd = consumeBracedObjectEnd(s, pos);
        if (objEnd !== null) {
            const optBody = s.slice(pos, objEnd);
            const nameMatch = optBody.match(/\bname\s*:\s*(['"])/);
            if (nameMatch) {
                const qposInBody = nameMatch.index + nameMatch[0].length - 1;
                const pq = parseQuotedStrAt(optBody, qposInBody);
                if (pq) name = pq.value;
            }
            nameExact = /\bexact\s*:\s*true\b/.test(optBody);
            const textPreds = parseTextFilterFromOptionsBody(optBody);
            pos = skipWsStr(s, objEnd);
            if (s[pos] === ')') {
                return {
                    role,
                    name,
                    nameExact,
                    hasText: textPreds.hasText,
                    hasNotText: textPreds.hasNotText,
                    nextPos: pos + 1,
                };
            }
        } else {
            const fromBrace = s.slice(pos);
            const nm = fromBrace.match(/name\s*:\s*(['"])((?:\\.|[^\\])*?)\1/);
            if (nm) {
                name = nm[2].replace(/\\(.)/g, '$1');
                let j = pos + nm.index + nm[0].length;
                j = skipWsStr(s, j);
                if (s[j] === '}') j = skipWsStr(s, j + 1);
                j = skipWsStr(s, j);
                if (s[j] === ')') {
                    const sliceOpts = s.slice(pos, j + 1);
                    nameExact = /\bexact\s*:\s*true\b/.test(sliceOpts);
                    const textPreds = parseTextFilterFromOptionsBody(sliceOpts);
                    return {
                        role,
                        name,
                        nameExact,
                        hasText: textPreds.hasText,
                        hasNotText: textPreds.hasNotText,
                        nextPos: j + 1,
                    };
                }
            }
        }
    }

    const rest = s.slice(pos);
    const tol = rest.match(/^name\s*:\s*(['"])((?:\\.|[^\\])*?)\1\s*/);
    if (tol) {
        name = tol[2].replace(/\\(.)/g, '$1');
        let j = pos + tol.index + tol[0].length;
        j = skipWsStr(s, j);
        if (s[j] === '}') j = skipWsStr(s, j + 1);
        j = skipWsStr(s, j);
        if (s[j] === ')') {
            const sliceOpts = s.slice(pos, j + 1);
            nameExact = /\bexact\s*:\s*true\b/.test(sliceOpts);
            const textPreds = parseTextFilterFromOptionsBody(sliceOpts);
            return {
                role,
                name,
                nameExact,
                hasText: textPreds.hasText,
                hasNotText: textPreds.hasNotText,
                nextPos: j + 1,
            };
        }
    }
    return null;
}

/**
 * Chained Playwright locators, e.g. page.getByRole("search").getByRole("button", { name: "Google Search" }).
 */
function parsePlaywrightLocatorChain(rawInput) {
    const s0 = rawInput.split(/ (#|\/\/)/)[0].trim();
    const s = s0.replace(/^\s*page\.\s*/, '').trim();
    const steps = [];
    let pos = 0;
    while (pos < s.length) {
        pos = skipWsStr(s, pos);
        if (pos >= s.length) break;
        const gr = parseGetByRoleInvocationAt(s, pos);
        if (!gr) break;
        steps.push({
            kind: 'getByRole',
            role: gr.role,
            name: gr.name,
            nameExact: gr.nameExact,
            hasText: gr.hasText,
            hasNotText: gr.hasNotText,
        });
        pos = skipWsStr(s, gr.nextPos);
        if (pos >= s.length) break;
        if (s[pos] === '.') {
            pos++;
            continue;
        }
        break;
    }
    return steps.length >= 2 ? steps : null;
}

function elementMatchesGetByRoleStep(el, step) {
    const r = getImplicitRole(el);
    if (!step.role || !r) return false;
    if (r.toLowerCase() !== String(step.role).toLowerCase()) return false;
    if (step.name != null && step.name !== '') {
        const n = getAccessibleName(el);
        const okName = step.nameExact
            ? normalizeTextContent(n) === normalizeTextContent(step.name)
            : n.includes(step.name);
        if (!okName) return false;
    }
    if (step.hasText || step.hasNotText) {
        if (!elementMatchesLocatorFilterStep(el, { hasText: step.hasText, hasNotText: step.hasNotText })) {
            return false;
        }
    }
    return true;
}

function collectVisibleSubtreeNodes(rootEls) {
    const out = [];
    const seen = new Set();
    for (const r of rootEls) {
        if (!r || r.nodeType !== Node.ELEMENT_NODE) continue;
        const walk = [r, ...r.querySelectorAll('*')];
        for (const el of walk) {
            if (el.nodeType !== Node.ELEMENT_NODE) continue;
            if (el.offsetParent === null) continue;
            if (!seen.has(el)) {
                seen.add(el);
                out.push(el);
            }
        }
    }
    return out;
}

function resolvePlaywrightLocatorChain(steps) {
    let roots = null;
    for (const step of steps) {
        if (step.kind !== 'getByRole') return [];
        let candidates;
        if (roots === null) {
            candidates = Array.from(document.querySelectorAll('*')).filter((el) => el.offsetParent !== null);
        } else {
            candidates = collectVisibleSubtreeNodes(roots);
        }
        roots = candidates.filter((el) => elementMatchesGetByRoleStep(el, step));
        if (!roots.length) return [];
    }
    return roots;
}

/**
 * hasText / hasNotText inside `{ ... }` (locator options or .filter({...})).
 * Supports quoted strings and /regex/flags. See https://playwright.dev/docs/locators#filter-by-text
 */
function extractTextPredicate(body, propName) {
    const re = new RegExp(`\\b${propName}\\s*:`, 'i');
    const m = body.match(re);
    if (!m) return null;
    let i = m.index + m[0].length;
    i = skipWsStr(body, i);
    if (i >= body.length) return null;
    if (body[i] === '"' || body[i] === "'" || body[i] === '`') {
        const pq = parseQuotedStrAt(body, i);
        if (!pq) return null;
        return { kind: 'substring', value: pq.value };
    }
    if (body[i] === '/') {
        let j = i + 1;
        while (j < body.length) {
            if (body[j] === '\\') {
                j += 2;
                continue;
            }
            if (body[j] === '/') {
                const pattern = body.slice(i + 1, j);
                j++;
                let flags = '';
                while (j < body.length && /[a-z]/i.test(body[j])) flags += body[j++];
                try {
                    new RegExp(pattern, flags);
                } catch (_) {
                    return null;
                }
                return { kind: 'regex', source: pattern, flags };
            }
            j++;
        }
        return null;
    }
    return null;
}

function parseTextFilterFromOptionsBody(body) {
    const step = {};
    const ht = extractTextPredicate(body, 'hasText');
    if (ht) step.hasText = ht;
    const hnt = extractTextPredicate(body, 'hasNotText');
    if (hnt) step.hasNotText = hnt;
    return step;
}

function elementMatchesTextPredicate(el, pred) {
    if (!pred) return true;
    const sources = getElementTextMatchSources(el);
    const testSource = (str) => {
        if (!str) return false;
        if (pred.kind === 'substring') {
            const raw = String(pred.value).trim();
            if (!raw) return false;
            const needleLo = normalizeTextContent(pred.value).toLowerCase();
            const hayLo = normalizeTextContent(str).toLowerCase();
            if (needleLo && hayLo.includes(needleLo)) return true;
            return String(str).toLowerCase().includes(raw.toLowerCase());
        }
        if (pred.kind === 'regex') {
            try {
                return new RegExp(pred.source, pred.flags).test(str);
            } catch (_) {
                return false;
            }
        }
        return false;
    };
    return sources.some(testSource);
}

function elementMatchesLocatorFilterStep(el, step) {
    if (step.hasText && !elementMatchesTextPredicate(el, step.hasText)) return false;
    if (step.hasNotText && elementMatchesTextPredicate(el, step.hasNotText)) return false;
    return true;
}

/**
 * page.locator("css"[, { hasText: 'x', hasNotText: /y/i }]).filter({ hasText: 'z' }) ...
 */
function parsePageLocatorWithTextFilters(rawInput) {
    const s0 = rawInput.split(/ (#|\/\/)/)[0].trim();
    let s = s0.replace(/^\s*page\.\s*/, '').trim();
    s = s.replace(/;+\s*$/g, '').trim();
    let pos = skipWsStr(s, 0);
    if (!s.startsWith('locator', pos)) return null;
    pos += 'locator'.length;
    pos = skipWsStr(s, pos);
    if (s[pos] !== '(') return null;
    pos++;
    pos = skipWsStr(s, pos);
    const selQ = parseQuotedStrAt(s, pos);
    if (!selQ) return null;
    const css = selQ.value;
    pos = skipWsStr(s, selQ.next);

    const filterSteps = [];

    if (s[pos] === ',') {
        pos++;
        pos = skipWsStr(s, pos);
        if (s[pos] !== '{') return null;
        const objEnd = consumeBracedObjectEnd(s, pos);
        if (objEnd === null) return null;
        const body = s.slice(pos, objEnd);
        const step = parseTextFilterFromOptionsBody(body);
        if (Object.keys(step).length) filterSteps.push(step);
        pos = skipWsStr(s, objEnd);
    }

    if (s[pos] !== ')') return null;
    pos++;

    while (true) {
        pos = skipWsStr(s, pos);
        if (pos >= s.length) break;
        const dotFilter = s.slice(pos).match(/^\.\s*filter\b/);
        if (!dotFilter) break;
        pos += dotFilter[0].length;
        pos = skipWsStr(s, pos);
        if (s[pos] !== '(') return null;
        pos++;
        pos = skipWsStr(s, pos);
        if (s[pos] !== '{') return null;
        const fEnd = consumeBracedObjectEnd(s, pos);
        if (fEnd === null) return null;
        const fBody = s.slice(pos, fEnd);
        const step = parseTextFilterFromOptionsBody(fBody);
        if (Object.keys(step).length) filterSteps.push(step);
        pos = skipWsStr(s, fEnd);
        if (s[pos] !== ')') return null;
        pos++;
    }

    pos = skipWsStr(s, pos);
    if (pos < s.length) return null;
    if (filterSteps.length === 0) return null;
    return { css, filterSteps };
}

/**
 * True when the string clearly uses locator text filtering (.filter or second-arg {…}).
 * Used to avoid falling back to querySelector(first locator only), which drops filters.
 */
function locatorExpressionUsesTextFilterSyntax(base) {
    if (/\.\s*filter\s*\(/i.test(base)) return true;
    return /\blocator\s*\(\s*(["'`])(?:\\.|(?!\1).)*\1\s*,\s*\{/i.test(base);
}

function resolveLocatorWithTextFilters(parsed) {
    let els = Array.from(document.querySelectorAll(unescapePlaywrightCssSelector(parsed.css)));
    els = els.filter((el) => el.nodeType === Node.ELEMENT_NODE && el.offsetParent !== null);
    for (const step of parsed.filterSteps) {
        els = els.filter((el) => elementMatchesLocatorFilterStep(el, step));
    }
    return els;
}

function formatPlaywrightLocator(method, value, options = null) {
    const formattedValue = `"${escapeLocatorStr(value)}"`;
    if (!options) return `page.${method}(${formattedValue})`;
    const optionsStr = `{ ${Object.entries(options).map(([k, v]) => `${k}: ${typeof v === 'boolean' ? v : `"${escapeLocatorStr(v)}"`}`).join(', ')} }`;
    return `page.${method}(${formattedValue}, ${optionsStr})`;
}

function getLabelTextForControl(element) {
    if (element.id) {
        const lbl = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
        if (lbl) {
            return (lbl.innerText || lbl.textContent || '').trim().replace(/\s+/g, ' ');
        }
    }
    const wrap = element.closest('label');
    if (wrap) {
        const clone = wrap.cloneNode(true);
        clone.querySelectorAll('input, select, textarea, button').forEach((n) => n.remove());
        return (clone.innerText || clone.textContent || '').trim().replace(/\s+/g, ' ');
    }
    return '';
}

/**
 * Popup suggestion: only when visible text / submit value matches (getByText in verifier also uses value & aria-label).
 */
function shouldSuggestGetByText(element, accName) {
    if (!accName || !String(accName).trim()) return false;
    const name = normalizeTextContent(accName);
    const tag = element.tagName.toLowerCase();
    const type = (element.getAttribute('type') || '').toLowerCase();

    const inner = normalizeTextContent(element.innerText || '');
    if (inner.length > 0 && inner === name) {
        return true;
    }

    if (tag === 'input' && ['submit', 'button', 'reset'].includes(type)) {
        return normalizeTextContent(element.value || '') === name;
    }

    return false;
}

/** `value` inside a double-quoted CSS attribute selector. */
function escapeCssAttrValueDoubleQuoted(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function buildCssAriaLabelSelector(element) {
    const raw = element.getAttribute('aria-label');
    if (!raw) return null;
    const label = raw.trim();
    if (!label) return null;
    if (/[\[\]]/.test(label)) return null;
    const tag = element.tagName.toLowerCase();
    return `${tag}[aria-label="${escapeCssAttrValueDoubleQuoted(label)}"]`;
}

function buildStableClassCssSelector(element) {
    const tag = element.tagName.toLowerCase();
    const stableClasses = Array.from(element.classList).filter(
        (cls) => cls && !cls.includes(':') && !cls.includes('[') && cls.length > 2
    );
    if (stableClasses.length === 0) return null;
    return `${tag}.${stableClasses.map((c) => CSS.escape(c)).join('.')}`;
}

function buildCssClassAndAriaLabelSelector(element) {
    const raw = element.getAttribute('aria-label');
    if (!raw) return null;
    const label = raw.trim();
    if (!label || /[\[\]]/.test(label)) return null;
    const tag = element.tagName.toLowerCase();
    const stableClasses = Array.from(element.classList).filter(
        (cls) => cls && !cls.includes(':') && !cls.includes('[') && cls.length > 2
    );
    if (stableClasses.length === 0) return null;
    const cls = stableClasses.map((c) => CSS.escape(c)).join('.');
    return `${tag}.${cls}[aria-label="${escapeCssAttrValueDoubleQuoted(label)}"]`;
}

/**
 * Add `page.locator("...")` if the selector matches `element`, even when other nodes match too
 * (e.g. several buttons share the same aria-label).
 */
function tryAddCssLocatorSuggestion(strategyLabel, cssSelector, element, add) {
    if (!cssSelector) return false;
    let matches;
    try {
        matches = Array.from(document.querySelectorAll(cssSelector));
    } catch {
        return false;
    }
    if (!matches.includes(element)) return false;
    const locCore = `page.locator("${escapeLocatorStr(cssSelector)}")`;
    const note =
        matches.length === 1
            ? '// unique in document'
            : `// WARNING: matches ${matches.length} elements`;
    return add(strategyLabel, `${locCore} ${note}`);
}

/**
 * Up to `max` distinct Playwright-style locators using different strategies (for popup list).
 */
function generateLocatorCandidates(element, max = MAX_LOCATOR_SUGGESTIONS) {
    const candidates = [];
    const seen = new Set();

    function add(strategyLabel, locatorString) {
        if (!locatorString || seen.has(locatorString) || candidates.length >= max) return false;
        seen.add(locatorString);
        candidates.push({ strategy: strategyLabel, locator: locatorString });
        return true;
    }

    const testId = element.getAttribute('data-testid') || element.getAttribute('data-qa') || element.getAttribute('data-test');
    const role = getImplicitRole(element);
    const accName = getAccessibleName(element);
    const labelText = getLabelTextForControl(element);
    const placeholder = element.getAttribute('placeholder');
    const altText = element.getAttribute('alt');
    const titleAttr = element.getAttribute('title');

    // Suggestion order matches Playwright-style priority (user-facing first, testId, then CSS).
    // 1 — Role + name
    if (role && accName) add('Role + name', formatPlaywrightLocator('getByRole', role, { name: accName, exact: true }));
    if (role && isLocatorUniqueInScope('getByRole', role, element, document)) {
        add('Role (unique)', formatPlaywrightLocator('getByRole', role));
    }

    // 2 — Text (only when visible text / value matches; not for aria-label-only names)
    if (shouldSuggestGetByText(element, accName)) {
        const bare = formatPlaywrightLocator('getByText', accName, { exact: true });
        const globalExactCount = countElementsMatchingGetByTextExact(accName);
        const scoped = buildScopedGetByTextLocator(element, accName);
        if (globalExactCount > 1 && scoped) {
            add('Text (scoped)', scoped);
            add('Text', `${bare} // WARNING: ${globalExactCount} elements with exact innerText`);
        } else if (globalExactCount > 1 && !scoped) {
            add('Text', `${bare} // WARNING: ${globalExactCount} elements with exact innerText`);
        } else {
            add('Text', bare);
        }
    }

    // 3 — Label
    if (labelText && labelText.length > 0 && labelText.length < 200) {
        add('Label', formatPlaywrightLocator('getByLabel', labelText, { exact: true }));
    }

    // 4 — Placeholder / Alt / Title
    if (placeholder && placeholder.trim()) {
        add('Placeholder', formatPlaywrightLocator('getByPlaceholder', placeholder.trim(), { exact: true }));
    }
    if (altText && altText.trim()) {
        add('Alt text', formatPlaywrightLocator('getByAltText', altText.trim(), { exact: true }));
    }
    if (titleAttr && titleAttr.trim()) {
        add('Title', formatPlaywrightLocator('getByTitle', titleAttr.trim(), { exact: true }));
    }

    // 5 — Test ID
    if (testId) add('Test ID', formatPlaywrightLocator('getByTestId', testId));

    // 6 — CSS (class / aria-label / generic css selector)
    const ariaCssSel = buildCssAriaLabelSelector(element);
    const ariaCssAdded = tryAddCssLocatorSuggestion('CSS (aria-label)', ariaCssSel, element, add);

    const classCssSel = buildStableClassCssSelector(element);
    const classCssAdded = tryAddCssLocatorSuggestion('CSS (class)', classCssSel, element, add);

    const cssSelector = getRelativeCSS(element, element.parentElement);
    const duplicatesSpecificCss =
        (ariaCssAdded && cssSelector === ariaCssSel) ||
        (classCssAdded && cssSelector === classCssSel);
    if (!duplicatesSpecificCss) {
        const cssLoc = `page.locator("${escapeLocatorStr(cssSelector)}") // WARNING: fragile CSS`;
        add('CSS', cssLoc);
    }

    return candidates.slice(0, max);
}

function generateBestLocator(element) {
    const testId = element.getAttribute('data-testid') || element.getAttribute('data-qa') || element.getAttribute('data-test');
    if (testId) return formatPlaywrightLocator('getByTestId', testId);

    const role = getImplicitRole(element);
    const accName = getAccessibleName(element);

    if (role && accName) return formatPlaywrightLocator('getByRole', role, { name: accName, exact: true });

    const placeholder = element.getAttribute('placeholder');
    if (placeholder) return formatPlaywrightLocator('getByPlaceholder', placeholder, { exact: true });

    const altText = element.getAttribute('alt');
    if (altText) return formatPlaywrightLocator('getByAltText', altText, { exact: true });

    if (shouldSuggestGetByText(element, accName)) {
        const globalExactCount = countElementsMatchingGetByTextExact(accName);
        const scoped = buildScopedGetByTextLocator(element, accName);
        if (globalExactCount > 1 && scoped) return scoped;
        return formatPlaywrightLocator('getByText', accName, { exact: true });
    }
    
    if (role && isLocatorUniqueInScope('getByRole', role, element, document)) {
        return formatPlaywrightLocator('getByRole', role);
    }
    
    let parentElement = element.parentElement;
    for (let i = 0; i < 4 && parentElement && parentElement.tagName !== 'BODY'; i++) {
        const parentLocator = generateBestLocator(parentElement);
        if (parentLocator && !parentLocator.includes('locator(') && !parentLocator.includes('WARNING')) {
            let childLocator;
            if (role && isLocatorUniqueInScope('getByRole', role, element, parentElement)) {
                childLocator = formatPlaywrightLocator('getByRole', role).replace(/^page\./, '');
                return `${parentLocator}.${childLocator}`;
            }
            const relativeCSS = getRelativeCSS(element, parentElement);
            if (parentElement.querySelectorAll(relativeCSS).length === 1) {
                const childCssLocator = `locator("${escapeLocatorStr(relativeCSS)}")`;
                return `${parentLocator}.${childCssLocator}`;
            }
        }
        parentElement = parentElement.parentElement;
    }
    
    const cssSelector = getRelativeCSS(element, element.parentElement);
    const locator = `page.locator("${escapeLocatorStr(cssSelector)}")`;
    return `${locator} // WARNING: CSS selector fallback. Consider adding a data-testid.`;
}

/**
 * Playwright locator strings use \\\" inside CSS; querySelector needs [attr="value"] without those backslashes.
 * Only unescapes \\" \\' \\\\; other \\x is kept (e.g. .foo\\:bar).
 */
function unescapePlaywrightCssSelector(css) {
    if (css == null || css === '') return css;
    let out = '';
    for (let i = 0; i < css.length; i++) {
        if (css[i] === '\\' && i + 1 < css.length) {
            const n = css[i + 1];
            if (n === '"' || n === "'" || n === '\\') {
                out += n;
                i++;
                continue;
            }
        }
        out += css[i];
    }
    return out;
}

/**
 * CSS string inside page.locator("...") / locator('...'), including inner quotes as \" or \'.
 */
function extractLocatorCssSelector(rawInput) {
    const s = rawInput.split(/ (#|\/\/)/)[0].trim();
    const match = s.match(/locator\s*\(\s*(["'`])/);
    if (!match) return null;
    const quote = match[1];
    let i = match.index + match[0].length;
    let out = '';
    while (i < s.length) {
        const ch = s[i];
        if (ch === '\\' && i + 1 < s.length) {
            out += s[i + 1];
            i += 2;
            continue;
        }
        if (ch === quote) return unescapePlaywrightCssSelector(out);
        out += ch;
        i += 1;
    }
    return null;
}

function clearVerifyHighlights() {
    removeVerifyBanner();
    document.querySelectorAll('[data-playwright-verifier-highlight]').forEach((el) => {
        el.style.outline = '';
        el.style.outlineOffset = '';
        el.style.boxShadow = '';
        el.style.backgroundColor = '';
        el.style.borderRadius = '';
        el.removeAttribute('data-playwright-verifier-highlight');
    });
}

/**
 * Strip trailing Playwright-style `.nth(n)` (0-based). Supports chains: `.nth(2).nth(0)`.
 */
function parsePlaywrightNthChain(rawInput) {
    let rest = rawInput.split(/ (#|\/\/)/)[0].trim();
    const nthChain = [];
    let m;
    while ((m = rest.match(/\.nth\s*\(\s*(\d+)\s*\)\s*$/))) {
        const idx = parseInt(m[1], 10);
        if (Number.isNaN(idx) || idx < 0) break;
        nthChain.unshift(idx);
        rest = rest.slice(0, m.index).trim();
    }
    return { base: rest, nthChain };
}

function applyNthToElements(elements, idx) {
    if (!elements.length || idx < 0 || idx >= elements.length) return [];
    return [elements[idx]];
}

function findAndHighlight(locatorString) {
    clearVerifyHighlights();

    const { base: baseRaw, nthChain } = parsePlaywrightNthChain(locatorString);
    const base = baseRaw.replace(/;+\s*$/g, '').trim();

    let foundElements = [];
    let skipBareLocatorCssExtract = false;
    try {
        const rawCssTry = unescapePlaywrightCssSelector(base);
        const cssElements = Array.from(document.querySelectorAll(rawCssTry));
        if (cssElements.length > 0 && !base.includes('getBy')) {
            foundElements = cssElements;
        }
    } catch (e) { /* Ignore invalid CSS selector errors */ }

    if (foundElements.length === 0) {
        const chain = parseLocatorGetByTextChain(base);
        if (chain) {
            try {
                const roots = Array.from(document.querySelectorAll(unescapePlaywrightCssSelector(chain.scopeCss)));
                const hits = [];
                for (const root of roots) {
                    if (root.nodeType !== Node.ELEMENT_NODE) continue;
                    const nodes = [root, ...root.querySelectorAll('*')];
                    for (const el of nodes) {
                        if (el.nodeType !== Node.ELEMENT_NODE) continue;
                        if (el.offsetParent === null) continue;
                        if (elementMatchesGetByText(el, chain.text, chain.exact)) hits.push(el);
                    }
                }
                foundElements = hits;
            } catch (e) {
                /* invalid selector */
            }
        }
    }

    if (foundElements.length === 0 && /\)\s*\.\s*getBy[A-Za-z]+\s*\(/.test(base)) {
        const chainSteps = parsePlaywrightLocatorChain(base);
        if (chainSteps) {
            foundElements = resolvePlaywrightLocatorChain(chainSteps);
        }
    }

    if (foundElements.length === 0) {
        const textFilterLoc = parsePageLocatorWithTextFilters(base);
        if (textFilterLoc !== null) {
            skipBareLocatorCssExtract = true;
            try {
                foundElements = resolveLocatorWithTextFilters(textFilterLoc);
            } catch (e) {
                foundElements = [];
            }
        } else if (locatorExpressionUsesTextFilterSyntax(base)) {
            skipBareLocatorCssExtract = true;
        }
    }

    if (foundElements.length === 0 && !skipBareLocatorCssExtract) {
        const cssFromLocator = extractLocatorCssSelector(base);
        if (cssFromLocator) {
            try {
                foundElements = Array.from(document.querySelectorAll(unescapePlaywrightCssSelector(cssFromLocator)));
            } catch (e) { /* invalid selector */ }
        }
    }

    if (foundElements.length === 0) {
        const locatorMatch = base.match(/(getBy[A-Za-z]+)\s*\((.*)\)/);

        if (locatorMatch) {
            const method = locatorMatch[1];
            const rawArgs = locatorMatch[2].trim();
            const argMatch = rawArgs.match(/['"`](.*?)['"`]/);
            if (argMatch) {
                const value = argMatch[1];
                const getByTextExact = /\bexact\s*:\s*true\b/.test(rawArgs);
                let getByRoleTextStep = null;
                if (method === 'getByRole') {
                    const bi = rawArgs.indexOf('{');
                    if (bi !== -1) {
                        const be = consumeBracedObjectEnd(rawArgs, bi);
                        if (be !== null) {
                            const ob = rawArgs.slice(bi, be);
                            const tf = parseTextFilterFromOptionsBody(ob);
                            if (tf.hasText || tf.hasNotText) getByRoleTextStep = tf;
                        }
                    }
                }
                const allVisibleElements = Array.from(document.querySelectorAll('*')).filter(el => el.offsetParent !== null);
                foundElements = allVisibleElements.filter(el => {
      
                    switch (method) {
                        case 'getByRole': {
                            const r = getImplicitRole(el);
                            if (!r || r.toLowerCase() !== String(value).toLowerCase()) return false;
                            const nameMatch = rawArgs.match(/name\s*[=:]\s*['"`](.*?)['"`]/);
                            if (nameMatch) {
                                const n = getAccessibleName(el);
                                const nameExactOpt = /\bexact\s*:\s*true\b/.test(rawArgs);
                                if (nameExactOpt) {
                                    if (normalizeTextContent(n) !== normalizeTextContent(nameMatch[1])) return false;
                                } else if (!n.includes(nameMatch[1])) return false;
                            }
                            if (getByRoleTextStep && !elementMatchesLocatorFilterStep(el, getByRoleTextStep)) {
                                return false;
                            }
                            return true;
                        }

                        case 'getByText':
                            return elementMatchesGetByText(el, value, getByTextExact);
                        
                        case 'getByLabel': 
                            return getAccessibleName(el).includes(value);

                        case 'getByPlaceholder': 
                           
                            return el.getAttribute('placeholder')?.includes(value);

                        case 'getByAltText': 
                         
                            return el.getAttribute('alt')?.includes(value);

                        case 'getByTitle': 
                         
                            return el.getAttribute('title')?.includes(value);

                        case 'getByTestId': 
                            return (el.getAttribute('data-testid') || el.getAttribute('data-qa') || el.getAttribute('data-test')) === value;

                        default: 
                            return false;
                    }
// ...
                });
            }
        }
    }

    for (const idx of nthChain) {
        foundElements = applyNthToElements(foundElements, idx);
    }

    foundElements.forEach((el) => {
        el.setAttribute('data-playwright-verifier-highlight', 'true');
        el.style.outline = VERIFY_HIGHLIGHT.border;
        el.style.outlineOffset = VERIFY_HIGHLIGHT.outlineOffset;
        el.style.boxShadow = VERIFY_HIGHLIGHT.boxShadow;
        el.style.backgroundColor = VERIFY_HIGHLIGHT.background;
        el.style.borderRadius = VERIFY_HIGHLIGHT.borderRadius;
    });
    const n = foundElements.length;
    if (n > 0) {
        showVerifyBanner(n);
    }
    return n;
}

function pickElementFromEvent(event) {
    if (event.composedPath) {
        for (const node of event.composedPath()) {
            if (node === document || node === window) continue;
            if (!node || node.nodeType !== Node.ELEMENT_NODE) continue;
            if (node.closest && node.closest(`[${PICKING_UI_ATTR}]`)) continue;
            return node;
        }
    }
    const t = event.target;
    if (t && t.nodeType === Node.ELEMENT_NODE && t.closest && !t.closest(`[${PICKING_UI_ATTR}]`)) {
        return t;
    }
    return null;
}

function updatePickingHighlight(element) {
    if (!pickingHighlightEl) return;
    if (!element ||
        element === document.documentElement ||
        element === document.body) {
        pickingHighlightEl.style.display = 'none';
        return;
    }
    const rect = element.getBoundingClientRect();
    if (rect.width < 1 && rect.height < 1) {
        pickingHighlightEl.style.display = 'none';
        return;
    }
    const pad = 2;
    pickingHighlightEl.style.display = 'block';
    pickingHighlightEl.style.top = `${rect.top - pad}px`;
    pickingHighlightEl.style.left = `${rect.left - pad}px`;
    pickingHighlightEl.style.width = `${rect.width + pad * 2}px`;
    pickingHighlightEl.style.height = `${rect.height + pad * 2}px`;
}

function refreshPickingHighlight() {
    if (isPickingMode && pickingHoverTarget) {
        updatePickingHighlight(pickingHoverTarget);
    }
}

function handlePickingMouseMove(event) {
    if (!isPickingMode) return;
    const el = pickElementFromEvent(event);
    if (!el || el === pickingHoverTarget) {
        if (!el) {
            pickingHoverTarget = null;
            updatePickingHighlight(null);
        }
        return;
    }
    pickingHoverTarget = el;
    updatePickingHighlight(el);
}

function ensurePickingChrome() {
    if (!pickingStyleEl) {
        pickingStyleEl = document.createElement('style');
        pickingStyleEl.id = 'playwright-locator-picking-style';
        pickingStyleEl.textContent = `
html.playwright-locator-picking-mode,
html.playwright-locator-picking-mode *,
html.playwright-locator-picking-mode *::before,
html.playwright-locator-picking-mode *::after {
    cursor: crosshair !important;
}`;
        (document.head || document.documentElement).appendChild(pickingStyleEl);
    }
    if (!pickingHighlightEl) {
        pickingHighlightEl = document.createElement('div');
        pickingHighlightEl.setAttribute(PICKING_UI_ATTR, 'highlight');
        pickingHighlightEl.style.cssText = [
            'display:none',
            'position:fixed',
            'box-sizing:border-box',
            'pointer-events:none',
            'z-index:2147483646',
            `border:${LOCATOR_HIGHLIGHT.border}`,
            `border-radius:${LOCATOR_HIGHLIGHT.borderRadius}`,
            `background:${LOCATOR_HIGHLIGHT.background}`,
            `box-shadow:${LOCATOR_HIGHLIGHT.boxShadow}`,
            'transition:top 40ms ease-out,left 40ms ease-out,width 40ms ease-out,height 40ms ease-out',
        ].join(';');
        document.body.appendChild(pickingHighlightEl);
    }
}

function removePickingChrome() {
    document.documentElement.classList.remove('playwright-locator-picking-mode');
    document.body.style.cursor = '';
    if (pickingStyleEl) {
        pickingStyleEl.remove();
        pickingStyleEl = null;
    }
    if (pickingHighlightEl) {
        pickingHighlightEl.remove();
        pickingHighlightEl = null;
    }
    pickingHoverTarget = null;
}

/**
 * Escape: exit pick mode (and clear highlights), or clear verify/evaluate highlights only.
 */
function handleExtensionEscapeKey(event) {
    if (event.key !== 'Escape') return;
    if (isPickingMode) {
        event.preventDefault();
        event.stopPropagation();
        disablePickingMode();
        return;
    }
    if (document.querySelector('[data-playwright-verifier-highlight]')) {
        clearVerifyHighlights();
    }
}

function handlePageClick(event) {
    if (!isPickingMode) return;
    event.preventDefault();
    event.stopPropagation();
    const picked = pickElementFromEvent(event);
    if (!picked) {
        disablePickingMode();
        return;
    }
    try {
        const alternatives = generateLocatorCandidates(picked, MAX_LOCATOR_SUGGESTIONS);
        if (alternatives.length > 0) {
            const primaryLocator = alternatives[0].locator;
            chrome.runtime.sendMessage(
                {
                    action: 'elementPicked',
                    alternatives,
                    primaryLocator,
                },
                () => void chrome.runtime.lastError
            );
        } else {
            chrome.runtime.sendMessage(
                { action: "pickError", error: "Could not generate a unique locator." },
                () => void chrome.runtime.lastError
            );
        }
    } catch (error) {
        console.error("Error during locator generation:", error);
        chrome.runtime.sendMessage(
            { action: "pickError", error: `An error occurred: ${error.message}` },
            () => void chrome.runtime.lastError
        );
    } finally {
        disablePickingMode();
    }
}

function enablePickingMode() {
    if (isPickingMode) return;
    clearVerifyHighlights();
    isPickingMode = true;
    ensurePickingChrome();
    document.documentElement.classList.add('playwright-locator-picking-mode');
    document.addEventListener('mousemove', handlePickingMouseMove, true);
    document.addEventListener('scroll', refreshPickingHighlight, true);
    window.addEventListener('resize', refreshPickingHighlight);
    document.addEventListener('click', handlePageClick, { capture: true, once: true });
}

function disablePickingMode() {
    if (!isPickingMode) return;
    isPickingMode = false;
    clearVerifyHighlights();
    document.removeEventListener('mousemove', handlePickingMouseMove, true);
    document.removeEventListener('scroll', refreshPickingHighlight, true);
    window.removeEventListener('resize', refreshPickingHighlight);
    document.removeEventListener('click', handlePageClick, { capture: true });
    removePickingChrome();
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "togglePickingMode") {
        if (isPickingMode) {
            disablePickingMode();
            sendResponse({ status: "disabled" });
        } else {
            enablePickingMode();
            sendResponse({ status: "enabled" });
        }
        return true;
    }
    if (request.action === "disablePickingMode") {
        disablePickingMode();
        sendResponse({ status: "disabled" });
        return true;
    }
    if (request.action === "clearVerifyHighlights") {
        clearVerifyHighlights();
        sendResponse({ status: "cleared" });
        return true;
    }
});

disablePickingMode();

document.addEventListener('keydown', handleExtensionEscapeKey, true);