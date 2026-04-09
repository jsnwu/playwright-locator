# Playwright Locator Helper

This project is a fork of [**tickytec/Playwright-Locator-Assistant**](https://github.com/tickytec/Playwright-Locator-Assistant), a solid Playwright locator helper. This fork adds changes tailored to my own workflow.

Ehancements:
* Top locator suggestions by Role, Text, Placeholder / Alt / Title, Test-id or CSS
* Add shortcut key for capturing locator, this is ensential for capturing dropdown items or mouseover/toggle elements
* Add element highlights on capturing
* Simplified UI flow
* Add support for .nth() locator evaludation

A Chrome extension that generates and verifies Playwright-style locators from the page you are on. It is aimed at QA engineers and developers who want quicker, more readable, and more stable selectors.


**Further reading:** [Playwright locators guide — getByRole, getByText, getByLabel, CSS, XPath](https://dev.to/keepcodn/playwright-locators-guide-getbyrole-getbytext-getbylabel-css-xpath-24n0) (dev.to).

---

## Why This Extension?

End-to-end tests break when selectors are brittle. Playwright recommends user-facing locators (`getByRole`, labels, test ids) over raw CSS. This extension applies that priority on a real DOM: pick an element, compare several strategies, then copy or verify the one you want.

## Features

*   **Locator generation:** Use **Pick Element**, then click a node on the page. The extension suggests a primary chained locator when needed and follows Playwright-style priorities (`data-testid`, role + name, label, placeholder, text, title, unique role, CSS fallback, etc.).

*   **Up to five strategies per pick:** The popup lists labeled alternatives (not a long history of old picks). Each row includes **Verify** and **Copy**.

*   **Chaining:** When a target is not unique, the extension can walk up to a stable parent and build a chained locator (for example `page.getByRole('list').getByRole('listitem', { name: '…' })`).

*   **Evaluate:** The **Evaluate locator** box accepts a CSS selector or a `page.getBy…` / `page.locator('…')` style string. **Ctrl+Enter** (Windows/Linux) or **⌘+Enter** (macOS) runs it; behavior matches **Verify** on the active tab.

*   **Match highlighting:** Successful **Verify** and **Evaluate** runs draw a **green** outline and light fill on matched elements. Highlights are **cleared** when you **close the popup** or use **Pick Element** (entering or leaving pick mode), so the page does not keep stale overlays.

*   **Keyboard shortcut:** Toggle pick mode with **Ctrl+Shift+F** or **⌘⇧F** (Chrome’s default for this extension). Use **Edit** in the popup to open [**Extension shortcuts**](chrome://extensions/shortcuts) and change it.

*   **On-page status banner:** Chrome does not allow a semi-transparent extension popup, so after **Verify** or **Evaluate** finds matches, a short **frosted banner** is drawn on the **webpage** (bottom center) with the match count. It auto-dismisses or you can click **Dismiss**. It is removed when highlights are cleared.

*   **Output format:** Suggestions use Playwright’s JavaScript / `playwright-test` style (`page.getByRole(…)`, etc.).

*   **Picking mode:** Crosshair cursor, hover outline, and `composedPath()`-based targeting help with nested and shadow DOM content where possible.

## How to Use

1.  **Install (Load unpacked)**
    *   Open Chrome and go to the [**Extensions**](chrome://extensions) page.
    *   Turn on **Developer mode**.
    *   Click **Load unpacked** and choose this repository folder (the one that contains `manifest.json`).

2.  **Generate locators**
    *   Click the extension icon, then **Pick Element**. The popup closes; click the element you care about.
    *   The popup opens again (or a small window, depending on Chrome) with up to five strategy rows for **that** pick. If something fails, an error can be shown when the popup reopens.

3.  **Verify**
    *   Click **Verify** on a strategy row. Matching nodes are highlighted in green; a short status appears under the row.

4.  **Evaluate**
    *   Paste or type a locator in **Evaluate locator** and click **Evaluate**, or use **Ctrl+Enter** / **⌘+Enter**.

5.  **Shortcut**
    *   From a normal web tab, use the configured shortcut to start or stop pick mode without opening the popup first.

## Debug mode (mock a picked element UI state)

You can open the popup directly in a “picked element” state without actually picking anything.

1. **Find your extension id**
   - Go to the [**Extensions**](chrome://extensions) page.
   - Enable **Developer mode**.
   - Copy the extension **ID** shown on the card.

## Contributing

Contributions are welcome through issues and pull requests.

## License

This project is licensed under the MIT License; see [`LICENSE`](LICENSE).
