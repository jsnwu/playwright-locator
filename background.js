function tryOpenExtensionPopup() {
    const fallback = () => {
        chrome.windows.create(
            {
                url: chrome.runtime.getURL('popup.html'),
                type: 'popup',
                width: 400,
                height: 640,
                focused: true,
            },
            () => void chrome.runtime.lastError
        );
    };
    try {
        const p = chrome.action.openPopup();
        if (p && typeof p.catch === 'function') {
            p.catch(fallback);
        } else {
            chrome.action.openPopup(() => {
                if (chrome.runtime.lastError) fallback();
            });
        }
    } catch (_) {
        fallback();
    }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'pickError' && message.error) {
        chrome.storage.local.set({ lastPickError: message.error }, () => {
            tryOpenExtensionPopup();
            sendResponse({ ok: true });
        });
        return true;
    }
    if (message.action !== 'elementPicked') return;

    let alternatives = Array.isArray(message.alternatives) ? [...message.alternatives] : [];
    if (alternatives.length === 0 && message.locator) {
        alternatives = [{ strategy: 'Picker', locator: message.locator }];
    }
    const primaryLocator =
        message.primaryLocator ||
        (alternatives[0] && alternatives[0].locator) ||
        message.locator ||
        '';

    if (!primaryLocator || alternatives.length === 0) return;

    chrome.storage.local.set(
        {
            locatorSuggestions: alternatives.slice(0, 5),
            lastGeneratedLocator: primaryLocator || alternatives[0].locator,
            lastPickError: '',
        },
        () => {
            sendResponse({ ok: true });
            tryOpenExtensionPopup();
        }
    );
    return true;
});

chrome.commands.onCommand.addListener((command) => {
    if (command !== 'toggle-picking-mode') return;
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs[0];
        if (!tab?.id) return;
        chrome.tabs.sendMessage(tab.id, { action: 'togglePickingMode' }, () => {
            void chrome.runtime.lastError;
        });
    });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'loading') {
        chrome.tabs.sendMessage(tabId, { action: 'disablePickingMode' }).catch(() => {});
    }
});
