# Playwright Locator Assistant


The ultimate browser extension for generating and verifying stable Playwright locators on the fly. This tool is designed for QA engineers and developers who want to write more resilient and readable tests, faster.

---

## Why This Extension?

In modern web development, writing stable end-to-end tests is a challenge. CSS selectors are brittle, and manually crafting the perfect Playwright locator can be time-consuming. This extension solves that problem by embedding Playwright's best practices directly into your browser.

It follows the official locator priority, ensuring you always get the most resilient locator possible, preferring user-facing attributes over implementation details.

## ✨ Features

*   **🚀 Intelligent Locator Generation:** Click on any element, and the extension automatically generates the best possible locator based on Playwright's recommended priority:
    1.  `data-testid`
    2.  `getByRole` (with accessible name)
    3.  `getByText`, `getByLabel`, `getByPlaceholder`, etc.
    4.  Smart `getByRole` (when unique without a name)
    5.  `CSS` selector as a last resort (with a warning).

*   **🔗 Smart Locator Chaining:** For elements that aren't unique on their own, the extension finds a stable parent and creates a readable and robust chained locator (e.g., `page.getByRole('list').getByRole('listitem', { name: 'User 1' })`).

*   **✅ Multiple strategies per pick:** After you pick an element, the popup lists **up to five** different locators when available (e.g. test id, role + name, label, placeholder, text, title, unique role, CSS). Each row has **Verify** and **Copy**.

*   **📦 JavaScript output:** Generated locators use Playwright’s JavaScript / `playwright-test` style (`page.getByRole(...)`, etc.).

*   **💡 Lightweight & Fast:** Built with performance in mind to not slow down your browsing or debugging sessions.


## 🛠️ How to Use

1.  **Install the Extension:**
    *  

2.  **To Generate a Locator:**
    *   Click the extension icon in your browser toolbar.
    *   Click the "Pick Element" button.
    *   The popup will close. Click on any element on the web page.
    *   The extension **popup opens again** (or a small popup window) with **locator options** for that element. If picking fails, an error shows at the top of the popup.

3.  **To Verify a Locator:**
    *   Open the popup and choose a row under the strategy label you care about.
    *   Click **Verify** next to that row. Matching elements are highlighted on the page and a short status (match count or error) appears under the row.

## 🤝 Contributing

Contributions are welcome! If you have ideas for new features, find a bug, or want to improve the code, feel free to open an issue or submit a pull request.

## 📄 License

This project is licensed under the MIT License.
