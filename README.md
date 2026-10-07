# Website Doctor

> Diagnose. Debug. Optimize.

**Website Doctor** is a browser extension that checks the health of any webpage. One click runs a full, on-demand audit of the page you're on — DOM size, core-web-vitals performance, responsiveness, SEO, accessibility, structure, and the technology behind the site — then shows you exactly what to fix and where.

![Version](https://img.shields.io/badge/version-2.4.3-blue)
![Manifest](https://img.shields.io/badge/Chrome%20Manifest-v3-green)

## Install

1. Download `webdoctor.zip` from this repo and unzip it into a folder.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and select that folder.

## What's New in v2.4.3

- **Automatic local updates**: `tools/auto-update-watch.ps1` watches GitHub, downloads the latest `webdoctor.zip`, backs up your current folder, extracts over the unpacked extension, and shows a Windows notification. The dashboard also checks for updates every hour and notifies you in Chrome.

## What's New in v2.4.2

- **Real Chrome Side Panel**: "Dashboard" in the popup now opens the dashboard directly in Chrome's side panel (falls back to a normal tab if unsupported). The dashboard auto-switches to the compact layout at narrow side-panel widths.

## What's New in v2.4.1

- **Compact side-panel view**: a "Compact" toggle button in the dashboard header switches the sidebar to icon-only and tightens spacing for narrow side-panel / popup widths. Preference is saved.

## What's New in v2.4.0

- **Emergency alerts setting** in the popup's settings menu (toggle on/off, persisted).
- Emergency overlay is more compact and now auto-dismisses after 3 seconds (was 4).
- Emergency chime is shorter and quieter.

## What's New in v2.3.2

- **Manual updates**: the Update tab now has an **Install from file…** button — pick any `webdoctor.zip` from your PC and it runs through the same verify → backup → install → auto-restore flow as GitHub updates.
- GitHub auto-update (check, download, install) still works as before, toggleable in the same tab.

## What's New in v2.3.1

- Fixed update tab state restore when leaving the Update tab and the header update pill text.

## What's New in v2.3.0

- **Update tab** in the dashboard: shows installed vs latest version, last check, auto-update switch, "Check now" and "Update now" buttons, plus a restore point for the pre-update backup.
- **True GitHub auto-update**: connect your extension folder once, enable the switch, and the dashboard downloads the latest release from GitHub, verifies every file in the package, backs up your current version, installs file-by-file, re-checks every byte, and reloads the extension. If any step fails, your previous version is restored automatically.
- A notification-style **update banner** appears at the top of the dashboard whenever a new release is published.
- The updater engine ships with a **Node test suite** (`tests/updater.test.js`) covering zip parsing, package validation, backup/rollback and real GitHub downloads — 21 tests.

## What's New in v2.2.0

- Renamed to **Website Doctor**.
- **Animated Overview** with staggered stat cards, growing and shimmering issue bars, and a glowing health ring.
- **New sidebar icons** — every dashboard section has its own icon.
- **GitHub auto-update**: the dashboard header shows *Update vX.Y.Z available* whenever a newer release is published here. One click downloads it. `tools/website-doctor-update.ps1` backs up your current copy, then installs the update. Press **Reload** at `chrome://extensions` to finish.
- Fixed padding on timing rows and spacing in the Overview.

## About

Web Doctor is a Manifest V3 extension for Chrome, Edge, and other Chromium browsers. It injects nothing into pages unless you ask for a scan, and every analysis runs locally in your browser via the `activeTab` permission — no accounts, no tracking, no remote servers.

It was built to answer three questions about any site you open:

1. **What is wrong with this page?** — a full diagnostic readout of DOM, performance, SEO, structure, accessibility, and media.
2. **Why is it slow / heavy / broken?** — Core Web Vitals (LCP, CLS, INP) measured from the real timeline, oversized DOM hotspots, broken links, missing alt text, unlabeled controls, dead anchors.
3. **What is it built with?** — technology, framework, CMS, and library detection with element-level targeting so fixes are concrete and locatable.

## What's New in v2.1.0

### Developer Dashboard
- A full-page audit view (the **Dashboard** button in the popup header) that opens the scan in a browser tab. Same real engine, same normalized issue list, far more room: **Overview** (score ring, issue bars by area, Core Web Vitals, timing, top issues), **Performance & CWV**, **DOM & Structure**, **SEO**, **Accessibility**, **Responsive**, **JavaScript**, **CSS**, **Images**, **Links**, **Forms**, **Technology & Platform** (with a platform blueprint for WordPress/Shopify/Wix/BigCommerce/Elementor), and **Reports**.
- Each issue card expands to Evidence / Why it matters / Fix / Measured-with, plus an **Affected elements** list showing the exact CSS selector, URL, and HTML snippet the analyzer captured.
- **Rescan** re-runs the analyzer against the previously scanned tab (or the current active tab), and **CSV / JSON** exports are generated locally.
- The dashboard opens instantly on the popup's latest scan: results are cached in `chrome.storage.session` and, when missing or stale, a rescan restores them.

### Real Core Web Vitals
- LCP and INP now truly populate: the analyzer keeps **buffered `PerformanceObserver`s** for `largest-contentful-paint` and interaction `event` entries, because Chrome does not return those entry types from `getEntriesByType()`. INP is the worst qualifying interaction; a page that never reported a value shows **Not available** — never an estimate.

### Per-element evidence everywhere
- Image alt gaps, unlabeled inputs, unnamed buttons/links/iframes/navs, empty headings, duplicate IDs, placeholder/fragment links, and oversized images now carry real selectors (`cssPathOf`) and HTML snippets captured at scan time.

### Polished popup
- Live **Core Web Vitals quick-scan** card with LCP / INP / CLS verdicts plus TTFB / First Paint / FCP / Load timing on the Overview.
- **Verification sounds** toggle in Settings (persisted, default on).
- Version pill always reads `chrome.runtime.getManifest().version` — never hardcoded.

### Optional AI assistant (dashboard)
- **AI Chat** and **AI Providers** sections in the dashboard, plus **Debug with AI** on every issue card. Multi-provider: bring your own key for OpenRouter, AgentRouter, Google Gemini, Groq, Cerebras, Mistral, OpenAI, or any OpenAI-compatible endpoint.
- **One-key AI welcome screen** in the AI Chat tab: until a provider is connected, a friendly setup card asks for a single API key (OpenRouter `sk-or-…`, Google `AIza…`, Groq `gsk_…`, OpenAI `sk-…`). The provider is auto-detected as you type, a default model is seeded, the connection is tested, and the chat is immediately ready — no settings hunt required.
- **AI Core** (`ai-core.js`) routes by technical task requirements, streams replies, retries with rate-limit awareness, and falls back across providers; **Free AI Mode** restricts to free models. API keys stay in `chrome.storage.local`, are sent only to that provider's endpoint, are masked in the UI, and diagnostics are sanitized before leaving the machine.
- Hallucination guard: scan facts are labeled **Detected**, reasoning is labeled **Possible cause**, and a **Before / After** compare re-scans the page to verify a fix with real measured values. The scanner never depends on AI — everything else works with no provider configured.

## What's New in v2.0.0

### New features
- **Lightweight Overview** — the popup Overview shows only the essentials: the Website Health score out of 100 (letter grade plus score ring), the Core Vitals quick scan, the issue summary, and the top DOM contributor, with a single button into the Dashboard. Hover lifts and entrance animations were removed so the popup stays fast.
- **Dashboard findings browser** — search all findings across modules live (page, performance, SEO, accessibility, responsive, hidden content, DOM), with severity and category filters, per-category scores, and prioritized quick wins pulled from every module at once.
- **Dark mode & light mode** — a high-contrast dark theme is the default; switch to light anytime from the Settings menu. The choice is persisted and applied instantly.
- **Compact single-row header** — brand, version pill, domain pill with favicon, and scan action all fit in one slim row with a settings menu (theme, repository link).
- **DEV-MOD hidden-content scanner** — discovers sections hidden by `display:none`, media queries, and builder techniques (Elementor and other page builders detected), then lets you **Unhide All**, inspect one at a time, or **Restore All** to revert.
- **Clean CSS inspector (Style Mark)** — an element picker that outputs *clean, reusable* CSS for the hovered element, with a scoped sanitized stylesheet view that strips page scripts, inline handlers, and page-wide styles from the sample.
- **Devices tab overhaul** — device presets plus a custom-size tester, cache-busted preview windows, **Advanced Auto-Inspect** of the live page, a four-breakpoint responsive scan (1280 / 1024 / 768 / 390 px), and **Apply suggested fixes / Restore** for anything provably broken at those widths.
- **Convert to Docs export** — the Audit tab can open any generated report as an editable Google Doc (optional Google sign-in), or export the same report as `.html` or `.doc` download. Without OAuth configured, the extension shows the one-time setup steps and falls back to a `.doc` download.

### Versioning & updates
- **Update checker** — the background service worker compares the installed version against the latest GitHub tag (on install, on browser start, every 6 hours, and on popup open) and raises a **browser notification** with a *View release* button. Each published version notifies only once.
- **In-popup update banner** — when a newer version exists, a slim banner appears under the header with a *View release* link.
- **Version pill** — the header shows the running build. Published releases are tagged on GitHub and switched automatically via the GitHub API using the packaged **`tools/webdoctor-update.ps1`** apply step.

## Features

### Full-site diagnosis
- **DOM Health** — element/node counts, container nesting depth, oversized-section hotspots with selectors, repeated-element detection, and DOM coverage vs. a clean baseline.
- **Performance** — TTFB, load, First Paint, LCP, CLS, and INP read from the browser's real performance timeline, with Core Web Vitals scoring and per-issue recommendations.
- **SEO** — title, meta description, viewport, heading hierarchy, canonical and Open Graph signal checks.
- **Accessibility (A11y)** — unlabeled controls, icon-only buttons, missing alt text, landmark hygiene, and contrast-pattern checks.
- **Structure** — landmarks, language, duplicate `id`s, and section-level cues.
- **Responsiveness** — missing viewport meta, absent `@media` rules, off-screen elements, oversized images, fixed-width culprits, and text overflow, plus a **live device preview** that opens the page in a real phone/tablet-sized window and captures it.

### Deep-debug suite
- **Typography inspector** — dominant fonts, sizes, weights, and mixing detection.
- **Broken link checker** — internal/external validation with broken, redirect, missing-fragment (SPA-safe), and unverified classifications, each with click-to-locate.
- **Media tracker** — hover/click tracking of images, inline SVGs, and CSS backgrounds, with download-ready markup.
- **Design inspector** — element picker with a floating toolbar to copy clean, reusable **HTML + CSS**.
- **Hidden-content scanner** — finds and previews content hidden by styles, media-query rules, and builder output, with one-click **Unhide All / Restore All**.
- **JavaScript tracker** — inline vs. external scripts, `defer` flags, parent-section context, and click-to-locate.
- **Elementor DOM inspector** — container/widget trees (`.e-con`, classic sections), hidden responsive elements, repeated widgets, and actionable suggestions.
- **CSS tools** — live toggle of any stylesheet, plus a sandboxed "apply/clear" style injection.
- **Forms tools** — form discovery, method/action parsing, required-field detection, and safe fill-testing.
- **Image tools** — dimensions/alt audit, flash-highlight, and per-image hide/restore.
- **Debug audit** — a single command-line-style report of everything above with severity verdicts (pass / warning / critical).

### Devices & responsive fixes
- **Device presets** — open the current page at phone, tablet, and desktop sizes in new test windows.
- **Custom size** — test any width x height combination.
- **Advanced Auto-Inspect** — one-click check of the live page for overflow, off-screen content, and oversized assets.
- **Four-breakpoint responsive audit** — scans 1280 / 1024 / 768 / 390 px, classifies proven breakage (horizontal overflow, fixed-width containers, min-width floors, oversized images, text overflow, off-screen elements, over-padding), and offers **suggested fixes you can apply temporarily and restore**.

### Reporting
- **Complete audit report** — exports a clean, plain-text-branded HTML or Word-ready report generated from the audit.
- **Convert to Docs** — send any report to an editable Google Doc (optional Google sign-in) or download it as `.doc`.
- **Site crawler** — queue-based crawl across linked pages (deduped, capped, stop-safe) that keeps results in a dedicated report tab via a service-worker-hosted blob.

### Dynamic version switching (GitHub API)
- Released versions are tracked as GitHub tags; the extension reads the tag list live (with a built-in fallback) and marks what is installed.
- **`tools/webdoctor-update.ps1`** (shipped inside `webdoctor.zip`) is the apply step: run `.\tools\webdoctor-update.ps1 -Version v1.2.0` in the unpacked folder and reload the extension. With no `-Version` it applies the latest tag.
- **Updates live in the Git repository.** All package changes are made by editing the source inside `webdoctor.zip`, rebuilding it, and committing `webdoctor.zip` + `README.md` to the repo (`github.com/Nabinkdk7/web-health-doctor`) — the repo is the single source of truth, and every release ships only through it.
- **Update notifications** — the extension checks GitHub in the background (on install, startup, every 6 h, and on popup open) and raises a browser notification when a newer version is published, plus an in-popup banner pointing at the release.

### Everything stays clean
- **Zero pre-injected content** into pages — the content script runs only on demand.
- **Permission-light** — only what each feature needs: `activeTab`, `scripting`, `windows`, `downloads` for scanning and exporting, plus `notifications`, `alarms`, and `storage` for update checks; site host access is **optional** and requested only when a site crawl or device test begins.
- **Accessible tab UI** — full keyboard support (arrow keys, Home/End), ARIA roles, and a scrollable tab rail that never clips or hides controls.

## Installation

### Option A — Load unpacked (for development / personal use)

1. Download or clone this repository (or grab `webdoctor.zip` directly).
2. Unzip `webdoctor.zip` into a folder.
3. Open Chrome or Edge and go to `chrome://extensions` (or `edge://extensions`).
4. Toggle **Developer mode** on (top-right corner).
5. Click **Load unpacked** and select the unzipped folder containing `manifest.json`.
6. Pin **Web Doctor** to the toolbar, open any page, and click the icon.

### Option B — Packaged ZIP (for the Chrome Web Store / Edge Add-ons)

1. `Compress-Archive` the extension files into a ZIP or run the packaging helper in the repo.
2. In the store's developer dashboard, **Upload a new item** and select the ZIP.
3. Fill in the store listing (description, category, and assets).
4. Submit for review.

> The ZIP must contain `manifest.json` at its root — do not wrap the files in an extra folder unless the store validator accepts it.

### Building your own ZIP

The `webdoctor.zip` in the repo root **is** the packaged extension. To rebuild it after working on the source (extract the zip, edit the files, then re-package from that folder):

```powershell
Compress-Archive -Path manifest.json, background.js, content.js, crawl-planner.js, `
  popup.html, popup.css, panel.css, popup.js, wd-common.js, `
  dashboard.html, dashboard.css, dashboard.js, ai-core.js, README.md, icons\, tools\ `
  -DestinationPath webdoctor.zip -Force
```

## Usage

1. Navigate to the page you want to check.
2. Open **Web Doctor** from the toolbar — the active page is analyzed automatically.
3. Browse the report by tab (**Overview**, **DOM**, **DEV-MOD**, **Perf**, **SEO**, **Struct**, **Tech**, **A11y**, **Debug**, **Devices**, **Audit**).
4. In **Overview**, read the Website Health score, then use the search bar and filters to drill into every finding across all modules.
5. Use **Rescan** to re-run on the current page, **DEV-MOD** for the deep-dive tools, **Devices** to test at real screen sizes (and apply/responsive fixes), **Audit → Crawl** to analyze linked pages across the site, and **Audit → Export / Convert to Docs** to save the report. Press **Dashboard** any time to open the same scan in a full-page developer dashboard with rescan and CSV/JSON exports.

## Project structure

The repository root is a minimal distribution package:

```
├── README.md        # This file
├── .gitignore       # Local tooling / artifact ignores
└── webdoctor.zip    # The complete extension (all source files, styles, and icons)
```

Every extension file — `manifest.json`, `popup.html`, `popup.css`, `panel.css`, `popup.js`, `wd-common.js` (shared data helpers for popup + dashboard), `dashboard.html`, `dashboard.css`, `dashboard.js` (full-page audit view), `ai-core.js` (optional multi-provider AI layer for the dashboard — the scanner never depends on it), `content.js`, `background.js`, `crawl-planner.js`, and `icons/` — lives inside `webdoctor.zip` at its root, ready to load unpacked, and the `tools/` folder holds `webdoctor-update.ps1`, the GitHub-API apply step for switching versions. To work on the source, unzip the package, edit the files, and re-zip it.

## Release history

| Version | Highlights |
| --- | --- |
| **v2.1.0** | Developer Dashboard tab (15 sections + reports + rescan + CSV/JSON exports), real LCP/INP via buffered PerformanceObservers, per-element issue evidence, Live CWV quick-scan card, optional multi-provider AI assistant (chat, Debug-with-AI, Before/After compare), scan cache via `chrome.storage.session`, verification-sound toggle, manifest-driven version pill |
| **v2.0.0** | Website Health score card + global Overview search, dark/light theme, compact header, hidden-content scanner with Unhide All, clean CSS inspector, Devices tab with 4-breakpoint responsive audit + apply/restore fixes, Convert-to-Docs export, update checker + in-popup banner |
| v1.3.0 | Version Manager, GitHub update checker with browser notification, in-popup update banner, scan verdict toast, reliable synthesized audio, tab-rail polish |
| v1.2.0 | Sci-fi danger sound + reliable (autoplay-safe) audio playback |
| v1.1.0 | Scrollable tab rail + health verdict notification |
| v1.0.0 | Initial release |

## Privacy

- No accounts, no analytics, no telemetry, no remote servers.
- All page analysis happens locally through the `activeTab` permission you consciously grant each scan.
- The optional `http(s)://*/*` host permission is requested **only** when you start a site crawl or a device test and can be denied without losing any single-page functionality.
- Update checks call the public GitHub API for the repository's version tags only — no usage data or site content is transmitted.
- The `downloads` permission is used only when you export an audit report.
- Google sign-in is used **only** when you explicitly choose **Convert to Docs**; without it, reports still export as local downloads.

## Author

Built by **Nabin Khadka** — [nabinkhadka.com](https://www.nabinkhadka.com)

## License

MIT — see the `LICENSE` file for details. (Add one before publishing if you haven't already.)