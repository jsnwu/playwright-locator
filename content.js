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
 * Up to `max` distinct Playwright-style locators using different strategies (for popup list).
 */
function generateLocatorCandidates(element, max = 5) {
    const candidates = [];
    const seen = new Set();

    function add(strategyLabel, locatorString) {
        if (!locatorString || seen.has(locatorString) || candidates.length >= max) return;
        seen.add(locatorString);
        candidates.push({ strategy: strategyLabel, locator: locatorString });
    }

    const testId = element.getAttribute('data-testid') || element.getAttribute('data-qa') || element.getAttribute('data-test');
    if (testId) add('Test ID', formatPlaywrightLocator('getByTestId', testId));

    const role = getImplicitRole(element);
    const accName = getAccessibleName(element);

    if (role && accName) add('Role + name', formatPlaywrightLocator('getByRole', role, { name: accName, exact: true }));

    const labelText = getLabelTextForControl(element);
    if (labelText && labelText.length > 0 && labelText.length < 200) {
        add('Label', formatPlaywrightLocator('getByLabel', labelText, { exact: true }));
    }

    const placeholder = element.getAttribute('placeholder');
    if (placeholder && placeholder.trim()) {
        add('Placeholder', formatPlaywrightLocator('getByPlaceholder', placeholder.trim(), { exact: true }));
    }

    const altText = element.getAttribute('alt');
    if (altText && altText.trim()) {
        add('Alt text', formatPlaywrightLocator('getByAltText', altText.trim(), { exact: true }));
    }

    if (accName) add('Text', formatPlaywrightLocator('getByText', accName, { exact: true }));

    const titleAttr = element.getAttribute('title');
    if (titleAttr && titleAttr.trim()) {
        add('Title', formatPlaywrightLocator('getByTitle', titleAttr.trim(), { exact: true }));
    }

    if (role && isLocatorUniqueInScope('getByRole', role, element, document)) {
        add('Role (unique)', formatPlaywrightLocator('getByRole', role));
    }

    const cssSelector = getRelativeCSS(element, element.parentElement);
    const cssLoc = `page.locator("${escapeLocatorStr(cssSelector)}") // WARNING: fragile CSS`;
    add('CSS', cssLoc);

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

    if (accName) return formatPlaywrightLocator('getByText', accName, { exact: true });
    
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

function clearVerifyHighlights() {
    document.querySelectorAll('[data-playwright-verifier-highlight]').forEach((el) => {
        el.style.outline = '';
        el.style.outlineOffset = '';
        el.style.boxShadow = '';
        el.style.backgroundColor = '';
        el.style.borderRadius = '';
        el.removeAttribute('data-playwright-verifier-highlight');
    });
}

function findAndHighlight(locatorString) {
    clearVerifyHighlights();

    let foundElements = [];
    try {
        const cssElements = Array.from(document.querySelectorAll(locatorString));
        if (cssElements.length > 0 && !locatorString.includes('getBy')) {
            foundElements = cssElements;
        }
    } catch (e) { /* Ignore invalid CSS selector errors */ }

    if (foundElements.length === 0) {
        const locatorMatch = locatorString.match(/(getBy[A-Za-z]+)\s*\((.*)\)/);
        const locatorCssMatch = locatorString.match(/locator\s*\(\s*(['"`])(.*?)\1\s*\)/);

        if (locatorCssMatch) {
            foundElements = Array.from(document.querySelectorAll(locatorCssMatch[2]));
        } else if (locatorMatch) {
            const method = locatorMatch[1];
            const rawArgs = locatorMatch[2].trim();
            const argMatch = rawArgs.match(/['"`](.*?)['"`]/);
            if (argMatch) {
                const value = argMatch[1];
                const allVisibleElements = Array.from(document.querySelectorAll('*')).filter(el => el.offsetParent !== null);
                foundElements = allVisibleElements.filter(el => {
      
                    switch (method) {
                        case 'getByRole':
                         
                            const nameMatch = rawArgs.match(/name\s*[=:]\s*['"`](.*?)['"`]/);
                            if (nameMatch) {
                                return getImplicitRole(el) === value && getAccessibleName(el).includes(nameMatch[1]);
                            }
                            return getImplicitRole(el) === value;

                        case 'getByText': 
                            return (el.innerText || el.textContent || "").trim().includes(value);
                        
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
    
    foundElements.forEach((el) => {
        el.setAttribute('data-playwright-verifier-highlight', 'true');
        el.style.outline = VERIFY_HIGHLIGHT.border;
        el.style.outlineOffset = VERIFY_HIGHLIGHT.outlineOffset;
        el.style.boxShadow = VERIFY_HIGHLIGHT.boxShadow;
        el.style.backgroundColor = VERIFY_HIGHLIGHT.background;
        el.style.borderRadius = VERIFY_HIGHLIGHT.borderRadius;
    });
    return foundElements.length;
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
        const alternatives = generateLocatorCandidates(picked, 5);
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