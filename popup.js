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

/** Semi-transparent popup so tab highlights remain visible behind the UI */
function setHighlightPeekMode(on) {
    document.documentElement.classList.toggle('popup-highlight-peek', Boolean(on));
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

    let locatorSuggestions = [];

    function normalizeSuggestion(entry) {
        if (!entry) return null;
        if (typeof entry === 'string') return { strategy: 'Locator', locator: entry };
        if (entry.locator) return { strategy: entry.strategy || 'Locator', locator: entry.locator };
        return null;
    }

    function setEvalMessage(text, color) {
        if (!evalLocatorMessage) return;
        evalLocatorMessage.textContent = text;
        evalLocatorMessage.style.color = color;
        evalLocatorMessage.style.display = text ? 'block' : 'none';
    }

    function runEvaluateLocator(rawInput) {
        const trimmed = (rawInput || '').trim();
        if (!trimmed) {
            setEvalMessage('Enter a locator or selector.', '#c53030');
            return;
        }
        const selector = pureLocator(trimmed);
        chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
            if (!tabs.length) {
                setEvalMessage('No active tab.', '#c53030');
                return;
            }
            setHighlightPeekMode(true);
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
                        setEvalMessage(
                            'Error: ' + (chrome.runtime.lastError.message || 'Try refreshing the page.'),
                            '#c53030'
                        );
                        return;
                    }
                    if (results && results[0] && results[0].result !== undefined) {
                        const count = results[0].result;
                        if (count > 0) {
                            setEvalMessage(
                                count === 1 ? '1 element highlighted.' : `${count} elements highlighted.`,
                                '#15803d'
                            );
                        } else {
                            setEvalMessage('No matching elements.', '#c05621');
                        }
                    } else {
                        setEvalMessage('Could not run on this page.', '#c53030');
                    }
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
            setHighlightPeekMode(true);
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
        locatorSuggestions.forEach((raw) => {
            const item = normalizeSuggestion(raw);
            if (!item) return;
            const loc = item.locator;
            const li = document.createElement('li');
            li.className = 'locator-list-item';

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
                    copyBtn.textContent = 'Copied!';
                    setTimeout(() => {
                        copyBtn.textContent = 'Copy';
                    }, 1500);
                });
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

            li.appendChild(strategyEl);
            li.appendChild(code);
            li.appendChild(actions);
            li.appendChild(statusEl);
            locatorListEl.appendChild(li);
        });
    }

    chrome.storage.local.get(
        ['locatorSuggestions', 'lastGeneratedLocator', 'lastPickError', 'locatorHistory'],
        function(result) {
            if (Array.isArray(result.locatorSuggestions) && result.locatorSuggestions.length) {
                locatorSuggestions = result.locatorSuggestions.map(normalizeSuggestion).filter(Boolean);
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
        if (result.lastPickError) {
            const pickFeedback = document.getElementById('pickFeedback');
            if (pickFeedback) {
                pickFeedback.textContent = result.lastPickError;
                pickFeedback.hidden = false;
            }
            chrome.storage.local.remove('lastPickError');
        }
    });

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !changes.locatorSuggestions) return;
        const next = changes.locatorSuggestions.newValue;
        locatorSuggestions = Array.isArray(next) ? next.map(normalizeSuggestion).filter(Boolean) : [];
        renderLocatorList();
    });

    if (evalLocatorButton && evalLocatorInput) {
        evalLocatorButton.addEventListener('click', () => {
            runEvaluateLocator(evalLocatorInput.value);
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

    window.addEventListener('pagehide', clearActiveTabVerifyHighlights);

    pickElementButton.addEventListener('click', function() {
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
                    'Pick an element to see up to five locator options (role, label, test id, CSS, etc.).';
                if (response && response.status === 'enabled') {
                    window.close();
                }
            });
        });
    });
});
