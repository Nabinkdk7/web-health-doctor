# Web Doctor

> Diagnose. Debug. Optimize.

**Web Doctor** is a browser extension that checks the health of any webpage. One click runs a full, on-demand audit of the page you're on — DOM size, core-web-vitals performance, responsiveness, SEO, accessibility, structure, and the technology behind the site — then shows you exactly what to fix and where.

![Version](https://img.shields.io/badge/version-2.0.0-blue)
![Manifest](https://img.shields.io/badge/Chrome%20Manifest-v3-green)

## About

Web Doctor is a Manifest V3 extension for Chrome, Edge, and other Chromium browsers. It injects nothing into pages unless you ask for a scan, and every analysis runs locally in your browser via the `activeTab` permission — no accounts, no tracking, no remote servers.

It was built to answer three questions about any site you open:

1. **What is wrong with this page?** — a full diagnostic readout of DOM, performance, SEO, structure, accessibility, and media.
2. **Why is it slow / heavy / broken?** — Core Web Vitals (LCP, CLS, INP) measured from the real timeline, oversized DOM hotspots, broken links, missing alt text, unlabeled controls, dead anchors.
3. **What is it built with?** — technology, framework, CMS, and library detection with element-level targeting so fixes are concrete and locatable.

## What's New in v2.0.0

### New features
- **Unified Website Health card** — the Overview opens with a single animated health score out of 100: a letter grade, a live score ring, the top DOM contributor, a category grid, and prioritized quick wins pulled from every module at once.
- **Overview search bar** — search all findings across modules live (page, performance, SEO, accessibility, responsive, hidden content, DOM), with severity and category filters and a top-critical list that ranks the highest-impact issues first.
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
  popup.html, popup.css, panel.css, popup.js, README.md, icons\, tools\ `
  -DestinationPath webdoctor.zip -Force
```

## Usage

1. Navigate to the page you want to check.
2. Open **Web Doctor** from the toolbar — the active page is analyzed automatically.
3. Browse the report by tab (**Overview**, **DOM**, **DEV-MOD**, **Perf**, **SEO**, **Struct**, **Tech**, **A11y**, **Debug**, **Devices**, **Audit**).
4. In **Overview**, read the Website Health score, then use the search bar and filters to drill into every finding across all modules.
5. Use **Rescan** to re-run on the current page, **DEV-MOD** for the deep-dive tools, **Devices** to test at real screen sizes (and apply/responsive fixes), **Audit → Crawl** to analyze linked pages across the site, and **Audit → Export / Convert to Docs** to save the report.

## Project structure

The repository root is a minimal distribution package:

```
├── README.md        # This file
├── .gitignore       # Local tooling / artifact ignores
└── webdoctor.zip    # The complete extension (all source files, styles, and icons)
```

Every extension file — `manifest.json`, `popup.html`, `popup.css`, `panel.css`, `popup.js`, `content.js`, `background.js`, `crawl-planner.js`, and `icons/` — lives inside `webdoctor.zip` at its root, ready to load unpacked, and the `tools/` folder holds `webdoctor-update.ps1`, the GitHub-API apply step for switching versions. To work on the source, unzip the package, edit the files, and re-zip it.

## Release history

| Version | Highlights |
| --- | --- |
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