## Research Buddy Chrome Extension

This project creates a lightweight Chromium extension that monitors arXiv for
new papers that match a custom research profile and summarizes findings via a
local OpenAI-compatible LLM API.

### Features
- Stores a free-form research profile; if you leave the keyword field blank, the options page calls your local LLM (using your supplied base URL, model, and API key) to extract high-quality multi-word keywords (falls back to heuristics) and the popup shows the active terms
- Matches new arXiv results against your Google Scholar publications (optional): provide your Scholar profile URL and enable matching to highlight overlapping work in both the popup and notifications, which now list the exact related publication inline
- Queries the official arXiv API on a schedule (default: every 60 minutes)
- Calls a local LLM (OpenAI REST style) to produce short human-friendly digests
- Shows the latest results inside the action popup and via Chrome notifications
- Provides an options page for configuring arXiv keywords, LLM endpoint, and API key

### Project Layout
- `extension/manifest.json` – Chrome manifest v3 with permissions and pages
- `extension/background.js` – Service worker driving fetch/summarize/notify
- `extension/popup.html|js|styles/` – Popup UI for manual checks and reading digests
- `extension/options.html|js|styles/` – Settings screen for keywords, schedule, and LLM details
- `extension/icons/` – Add `icon32.png` / `icon128.png` before loading the extension
- `extension/styles/` – Shared styling used by popup and options pages

### Developing Locally
1. Open Chrome → `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select the `extension` directory.
4. Update the options page with:
   - Research profile text (context, long description, etc.)
   - Comma-separated keywords for arXiv searches (leave blank to auto-fill via the LLM using your profile when you hit Save)
   - Local LLM base URL (e.g., `http://localhost:11434/v1`)
   - LLM model ID (e.g., `gpt-4o-mini`, `Llama-3.3-70B-Instruct-AWQ-INT4`)
   - API key expected by the local OpenAI-compatible service
   - (Optional) Google Scholar profile URL and toggle to highlight matching publications; use the **Refresh Scholar data** button after saving to pull your latest publication list (previewed directly in the settings page)
   - Scan frequency in minutes
5. Click **Save**; the background worker will schedule scans and also listen for
   manual **Check now** actions from the popup.
6. Open the popup from the toolbar to review summaries or trigger an immediate scan. The status area lists the exact search terms being used.

### Notes
- arXiv requests use the official Atom feed and include a custom user agent.
- Only arXiv is wired today; additional sources can be added by extending
  `fetchResearchUpdates` in `background.js`.
- The LLM call expects `POST {baseUrl}/chat/completions` with messages. Adjust
  the payload in `invokeLLM` if your service uses a different schema.
- Scholar scraping uses a simple HTML fetch of the public profile page once per day (or whenever you click Refresh). Only titles are used locally to compute fuzzy matches; no data is sent elsewhere.

### Next Enhancements
- Add icons inside `extension/icons` so notifications show brand visuals.
- Support additional sources (Semantic Scholar, arXiv categories, RSS filters).
- Persist more history locally and add export/share actions.




