/**
 * @file popup.js
 * This script manages the UI and interactions within the extension's popup.
 * It communicates with the content script (content.js) to trigger actions on the page.
 */
function pureLocator(text) {
    return text.split(/ (#|\/\/)/)[0].trim();
}

function suggestedShortcutFallback() {
    const ua = navigator.userAgent || '';
    const platform = navigator.userAgentData?.platform || navigator.platform || '';
    const isMac = /Mac|iPhone|iPod|iPad/i.test(platform) || /Mac OS X/.test(ua);
    return isMac ? '⌘⇧F (Chrome default)' : 'Ctrl+Shift+F (Chrome default)';
}

function decodeBase64UrlToText(s) {
    if (!s) return '';
    let t = String(s).replace(/-/g, '+').replace(/_/g, '/');
    while (t.length % 4) t += '=';
    // atob gives a binary string; this is fine for ASCII JSON.
    return atob(t);
}

function refreshShortcutDisplay() {
    const bindingEl = document.getElementById('shortcutBinding');
    const labelEl = document.getElementById('shortcutCommandLabel');
    if (!bindingEl || !chrome.commands?.getAll) return;
    chrome.commands.getAll((commands) => {
        const cmd = commands.find((c) => c.name === 'toggle-picking-mode');
        if (labelEl && cmd && cmd.description) {
            labelEl.textContent = cmd.description;
        }
        const raw = cmd && cmd.shortcut ? cmd.shortcut.trim() : '';
        bindingEl.textContent = raw || 'Not set';
        if (!raw) {
            bindingEl.title = 'Assign a shortcut in Chrome settings. Suggested: ' + suggestedShortcutFallback();
        } else {
            bindingEl.title = raw;
        }
    });
}

document.addEventListener('DOMContentLoaded', function() {
    const pickElementButton = document.getElementById('pickElementButton');
    const locatorListEl = document.getElementById('locatorList');
    const locatorListEmptyEl = document.getElementById('locatorListEmpty');
    const editShortcutButton = document.getElementById('editShortcutButton');
    const shortcutHintEl = document.getElementById('shortcutHint');
    const evalLocatorInput = document.getElementById('evalLocatorInput');
    const evalLocatorButton = document.getElementById('evalLocatorButton');
    const evalLocatorMessage = document.getElementById('evalLocatorMessage');
    const pickFeedback = document.getElementById('pickFeedback');

    /** Keep in sync with MAX_LOCATOR_SUGGESTIONS in content.js and slice cap in background.js */
    const MAX_LOCATOR_SUGGESTIONS = 10;

    const EVAL_DRAFT_KEY = 'evalLocatorDraft';
    const EVAL_MSG_KEY = 'evalLocatorLastMessage';
    const EVAL_COLOR_KEY = 'evalLocatorLastColor';

    let locatorSuggestions = [];
    let evalDraftTimer = null;

    function persistEvalDraft(value) {
        chrome.storage.local.set({ [EVAL_DRAFT_KEY]: value == null ? '' : String(value) });
    }

    function persistEvalOutcome(text, color) {
        if (!text) {
            chrome.storage.local.remove([EVAL_MSG_KEY, EVAL_COLOR_KEY]);
            return;
        }
        chrome.storage.local.set({
            [EVAL_MSG_KEY]: text,
            [EVAL_COLOR_KEY]: color || '',
        });
    }

    function clearEvalPersisted() {
        chrome.storage.local.remove([EVAL_DRAFT_KEY, EVAL_MSG_KEY, EVAL_COLOR_KEY]);
    }

    function normalizeSuggestion(entry) {
        if (!entry) return null;
        if (typeof entry === 'string') return { strategy: 'Locator', locator: entry };
        if (entry.locator) return { strategy: entry.strategy || 'Locator', locator: entry.locator };
        return null;
    }

    function syncEvalButtonTone(color) {
        const footer = document.querySelector('.eval-footer');
        if (footer) {
            footer.classList.remove('eval-footer--success', 'eval-footer--warn', 'eval-footer--error');
        }
        if (evalLocatorButton) {
            evalLocatorButton.classList.remove('btn-eval--success', 'btn-eval--warn', 'btn-eval--error');
        }
        if (!color) return;
        const toneByColor = {
            '#15803d': 'success',
            '#c05621': 'warn',
            '#c53030': 'error',
        };
        const tone = toneByColor[color];
        if (!tone) return;
        footer?.classList.add('eval-footer--' + tone);
        evalLocatorButton?.classList.add('btn-eval--' + tone);
    }

    function setEvalMessage(text, color) {
        if (!evalLocatorMessage) return;
        evalLocatorMessage.textContent = text;
        evalLocatorMessage.style.color = color || '';
        evalLocatorMessage.style.display = text ? 'block' : 'none';
        syncEvalButtonTone(text ? color : '');
    }

    function runEvaluateLocator(rawInput) {
        const trimmed = (rawInput || '').trim();
        if (!trimmed) {
            const msg = 'Enter a locator or selector.';
            setEvalMessage(msg, '#c53030');
            persistEvalOutcome(msg, '#c53030');
            if (evalLocatorInput) persistEvalDraft(evalLocatorInput.value);
            return;
        }
        const selector = pureLocator(trimmed);
        chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
            if (!tabs.length) {
                const msg = 'No active tab.';
                setEvalMessage(msg, '#c53030');
                persistEvalOutcome(msg, '#c53030');
                if (evalLocatorInput) persistEvalDraft(evalLocatorInput.value);
                return;
            }
            if (evalLocatorButton) evalLocatorButton.disabled = true;
            setEvalMessage('');
            chrome.scripting.executeScript(
                {
                    target: { tabId: tabs[0].id },
                    func: (selectorToFind) => findAndHighlight(selectorToFind),
                    args: [selector],
                },
                function(results) {
                    if (evalLocatorButton) evalLocatorButton.disabled = false;
                    if (chrome.runtime.lastError) {
                        const msg =
                            'Error: ' + (chrome.runtime.lastError.message || 'Try refreshing the page.');
                        setEvalMessage(msg, '#c53030');
                        persistEvalOutcome(msg, '#c53030');
                        if (evalLocatorInput) persistEvalDraft(evalLocatorInput.value);
                        return;
                    }
                    if (results && results[0] && results[0].result !== undefined) {
                        const count = results[0].result;
                        if (count > 0) {
                            const msg =
                                count === 1 ? '1 element highlighted.' : `${count} elements highlighted.`;
                            setEvalMessage(msg, '#15803d');
                            persistEvalOutcome(msg, '#15803d');
                        } else {
                            const msg = 'No matching elements.';
                            setEvalMessage(msg, '#c05621');
                            persistEvalOutcome(msg, '#c05621');
                        }
                    } else {
                        const msg = 'Could not run on this page.';
                        setEvalMessage(msg, '#c53030');
                        persistEvalOutcome(msg, '#c53030');
                    }
                    if (evalLocatorInput) persistEvalDraft(evalLocatorInput.value);
                }
            );
        });
    }

    refreshShortcutDisplay();

    if (editShortcutButton) {
        editShortcutButton.addEventListener('click', () => {
            chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }, () => {
                if (chrome.runtime.lastError && shortcutHintEl) {
                    shortcutHintEl.textContent =
                        'Could not open settings. Go to chrome://extensions/shortcuts in the address bar.';
                } else if (shortcutHintEl) {
                    shortcutHintEl.textContent =
                        'Change the shortcut for this extension, then reopen this popup to see the update.';
                }
            });
        });
    }

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            refreshShortcutDisplay();
        }
    });

    function runVerify(loc, verifyBtn, statusEl) {
        chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
            if (!tabs.length) {
                statusEl.textContent = 'No active tab.';
                statusEl.style.color = '#c53030';
                statusEl.style.display = 'block';
                return;
            }
            const selector = pureLocator(loc);
            verifyBtn.disabled = true;
            statusEl.style.display = 'none';
            chrome.scripting.executeScript(
                {
                    target: { tabId: tabs[0].id },
                    func: (selectorToFind) => findAndHighlight(selectorToFind),
                    args: [selector],
                },
                function(results) {
                    verifyBtn.disabled = false;
                    statusEl.style.display = 'block';
                    if (chrome.runtime.lastError) {
                        statusEl.textContent =
                            'Error: ' +
                            (chrome.runtime.lastError.message || 'Try refreshing the page.');
                        statusEl.style.color = '#c53030';
                        return;
                    }
                    if (results && results[0] && results[0].result !== undefined) {
                        const count = results[0].result;
                        if (count > 0) {
                            statusEl.textContent =
                                count === 1 ? '1 match highlighted' : `${count} matches highlighted`;
                            statusEl.style.color = '#15803d';
                        } else {
                            statusEl.textContent = 'No matches';
                            statusEl.style.color = '#c05621';
                        }
                    } else {
                        statusEl.textContent = 'Could not run on this page.';
                        statusEl.style.color = '#c53030';
                    }
                }
            );
        });
    }

    function renderLocatorList() {
        locatorListEl.innerHTML = '';
        if (!locatorSuggestions.length) {
            locatorListEmptyEl.style.display = 'block';
            locatorListEl.style.display = 'none';
            return;
        }
        locatorListEmptyEl.style.display = 'none';
        locatorListEl.style.display = 'block';
        locatorSuggestions.slice(0, MAX_LOCATOR_SUGGESTIONS).forEach((raw) => {
            const item = normalizeSuggestion(raw);
            if (!item) return;
            const loc = item.locator;
            const li = document.createElement('li');
            li.className = 'locator-list-item';

            const strategyRow = document.createElement('div');
            strategyRow.className = 'locator-strategy-row';

            const strategyEl = document.createElement('div');
            strategyEl.className = 'locator-strategy-label';
            strategyEl.textContent = item.strategy;

            const code = document.createElement('code');
            code.className = 'locator-list-code';
            code.textContent = loc;
            code.title = loc;

            const actions = document.createElement('div');
            actions.className = 'locator-list-actions';

            const verifyBtn = document.createElement('button');
            verifyBtn.type = 'button';
            verifyBtn.className = 'btn-verify-locator';
            verifyBtn.textContent = 'Verify';
            verifyBtn.title = 'Highlight matching elements on the page';

            const copyBtn = document.createElement('button');
            copyBtn.type = 'button';
            copyBtn.className = 'btn-copy-locator';
            copyBtn.textContent = 'Copy';
            copyBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const text = pureLocator(loc);
                navigator.clipboard.writeText(text).then(() => {
                    copyBtn.classList.remove('btn-copy-locator--copied');
                    copyBtn.offsetWidth;
                    copyBtn.classList.add('btn-copy-locator--copied');
                });
            });
            copyBtn.addEventListener('animationend', () => {
                copyBtn.classList.remove('btn-copy-locator--copied');
            });

            const statusEl = document.createElement('div');
            statusEl.className = 'locator-list-status';
            statusEl.setAttribute('aria-live', 'polite');

            verifyBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                runVerify(loc, verifyBtn, statusEl);
            });

            actions.appendChild(verifyBtn);
            actions.appendChild(copyBtn);

            strategyRow.appendChild(strategyEl);
            strategyRow.appendChild(statusEl);
            li.appendChild(strategyRow);
            li.appendChild(code);
            li.appendChild(actions);
            locatorListEl.appendChild(li);
        });
    }

    // Debug mode: allow mocking the UI state directly via query params.
    // Usage:
    //   popup.html?debug=1&suggestions_b64=<url_safe_base64_json>&eval=<encoded>&error=<encoded>
    const params = new URLSearchParams(window.location.search || '');
    const debugMode = params.get('debug') === '1';
    const suggestionsB64 = params.get('suggestions_b64');
    const debugEval = params.get('eval');
    const debugError = params.get('error');

    let usingMockState = false;
    if (debugMode) {
        // Default mock UI so `popup.html?debug=1` is enough to stage the UI.
        locatorSuggestions = [
            { strategy: 'Role', locator: "page.getByRole('button', { name: 'Save' })" },
            { strategy: 'Text', locator: "page.getByText('Save')" },
            { strategy: 'Label', locator: "page.getByLabel('Email')" },
            { strategy: 'TestId', locator: "page.getByTestId('save-button')" },
            { strategy: 'CSS', locator: "page.locator('button[type=\"submit\"]')" },
        ].map(normalizeSuggestion).filter(Boolean).slice(0, MAX_LOCATOR_SUGGESTIONS);
        usingMockState = true;
    }

    // If provided, suggestions_b64 overrides the defaults.
    if (debugMode && suggestionsB64) {
        try {
            const jsonText = decodeBase64UrlToText(suggestionsB64);
            const parsed = JSON.parse(jsonText);
            if (Array.isArray(parsed)) {
                const parsedSuggestions = parsed.map(normalizeSuggestion).filter(Boolean).slice(0, MAX_LOCATOR_SUGGESTIONS);
                if (parsedSuggestions.length) {
                    locatorSuggestions = parsedSuggestions;
                    usingMockState = true;
                }
            }
        } catch (e) {
            // Keep defaults.
        }
    }

    if (debugMode && evalLocatorInput) {
        if (debugEval) {
            try {
                evalLocatorInput.value = decodeURIComponent(debugEval);
            } catch {
                evalLocatorInput.value = String(debugEval);
            }
        } else {
            evalLocatorInput.value = "page.getByRole('button', { name: 'Save' })";
        }
    }
    if (debugMode && debugError && pickFeedback) {
        try {
            pickFeedback.textContent = decodeURIComponent(debugError);
        } catch {
            pickFeedback.textContent = String(debugError);
        }
        pickFeedback.hidden = false;
    }
    if (debugMode && evalLocatorMessage) {
        const debugEvalMessage = params.get('eval_message');
        const debugEvalStatus = (params.get('eval_status') || '').toLowerCase();
        let msgColor = '#15803d';
        if (debugEvalStatus === 'error') msgColor = '#c53030';
        else if (debugEvalStatus === 'warn') msgColor = '#c05621';

        if (debugEvalMessage) {
            try {
                setEvalMessage(decodeURIComponent(debugEvalMessage), msgColor);
            } catch {
                setEvalMessage(String(debugEvalMessage), msgColor);
            }
        } else {
            setEvalMessage('3 elements highlighted.', msgColor);
        }
    }

    if (usingMockState) {
        renderLocatorList();
        if (locatorListEmptyEl) locatorListEmptyEl.style.display = locatorSuggestions.length ? 'none' : 'block';
    } else {
        chrome.storage.local.get(
            [
                'locatorSuggestions',
                'lastGeneratedLocator',
                'lastPickError',
                'locatorHistory',
                EVAL_DRAFT_KEY,
                EVAL_MSG_KEY,
                EVAL_COLOR_KEY,
            ],
            function(result) {
                if (Array.isArray(result.locatorSuggestions) && result.locatorSuggestions.length) {
                    locatorSuggestions = result.locatorSuggestions
                        .map(normalizeSuggestion)
                        .filter(Boolean)
                        .slice(0, MAX_LOCATOR_SUGGESTIONS);
                } else if (result.lastGeneratedLocator) {
                    locatorSuggestions = [
                        { strategy: 'Last pick', locator: result.lastGeneratedLocator },
                    ];
                } else if (Array.isArray(result.locatorHistory) && result.locatorHistory.length) {
                    const first = result.locatorHistory[0];
                    const loc = typeof first === 'string' ? first : first && first.locator;
                    if (loc) locatorSuggestions = [{ strategy: 'Last pick', locator: loc }];
                }
                renderLocatorList();
                if (!debugMode) {
                    if (evalLocatorInput && Object.prototype.hasOwnProperty.call(result, EVAL_DRAFT_KEY)) {
                        evalLocatorInput.value = result[EVAL_DRAFT_KEY] || '';
                    }
                    if (result[EVAL_MSG_KEY]) {
                        setEvalMessage(result[EVAL_MSG_KEY], result[EVAL_COLOR_KEY] || '#15803d');
                    }
                }
                if (result.lastPickError && pickFeedback) {
                    pickFeedback.textContent = result.lastPickError;
                    pickFeedback.hidden = false;
                    chrome.storage.local.remove('lastPickError');
                }
            }
        );
    }

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !changes.locatorSuggestions) return;
        if (usingMockState) return;
        const next = changes.locatorSuggestions.newValue;
        locatorSuggestions = Array.isArray(next)
            ? next.map(normalizeSuggestion).filter(Boolean).slice(0, MAX_LOCATOR_SUGGESTIONS)
            : [];
        renderLocatorList();
    });

    if (evalLocatorButton && evalLocatorInput) {
        evalLocatorButton.addEventListener('click', () => {
            runEvaluateLocator(evalLocatorInput.value);
        });
        evalLocatorInput.addEventListener('input', () => {
            clearTimeout(evalDraftTimer);
            evalDraftTimer = setTimeout(() => {
                persistEvalDraft(evalLocatorInput.value);
            }, 200);
            setEvalMessage('');
            chrome.storage.local.remove([EVAL_MSG_KEY, EVAL_COLOR_KEY]);
        });
        evalLocatorInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                runEvaluateLocator(evalLocatorInput.value);
            }
        });
    }

    function clearActiveTabVerifyHighlights() {
        chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
            if (!tabs.length) return;
            chrome.tabs.sendMessage(tabs[0].id, { action: 'clearVerifyHighlights' }, function() {
                void chrome.runtime.lastError;
            });
        });
    }

    window.addEventListener('pagehide', function() {
        clearActiveTabVerifyHighlights();
        if (evalLocatorInput) persistEvalDraft(evalLocatorInput.value);
    });

    pickElementButton.addEventListener('click', function() {
        clearEvalPersisted();
        if (evalLocatorInput) evalLocatorInput.value = '';
        setEvalMessage('');
        chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
            if (!tabs.length) return;
            chrome.tabs.sendMessage(tabs[0].id, { action: 'togglePickingMode' }, function(response) {
                if (chrome.runtime.lastError) {
                    locatorListEmptyEl.textContent =
                        'Could not connect. Refresh the page and try again.';
                    locatorListEmptyEl.style.display = 'block';
                    return;
                }
                locatorListEmptyEl.textContent =
                    'Pick an element to see locator strategies (scroll the list for more).';
                if (response && response.status === 'enabled') {
                    window.close();
                }
            });
        });
    });
});
