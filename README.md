# Web Doctor

> Diagnose. Debug. Optimize.

**Web Doctor** is a browser extension that checks the health of any webpage. One click runs a full, on-demand audit of the page you're on — DOM size, core-web-vitals performance, responsiveness, SEO, accessibility, structure, and the technology behind the site — then shows you exactly what to fix and where.

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![Manifest](https://img.shields.io/badge/Chrome%20Manifest-v3-green)

## About

Web Doctor is a Manifest V3 extension for Chrome, Edge, and other Chromium browsers. It injects nothing into pages unless you ask for a scan, and every analysis runs locally in your browser via the `activeTab` permission — no accounts, no tracking, no remote servers.

It was built to answer three questions about any site you open:

1. **What is wrong with this page?** — a full diagnostic readout of DOM, performance, SEO, structure, accessibility, and media.
2. **Why is it slow / heavy / broken?** — Core Web Vitals (LCP, CLS, INP) measured from the real timeline, oversized DOM hotspots, broken links, missing alt text, unlabeled controls, dead anchors.
3. **What is it built with?** — technology, framework, CMS, and library detection with element-level targeting so fixes are concrete and locatable.

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
- **JavaScript tracker** — inline vs. external scripts, `defer` flags, parent-section context, and click-to-locate.
- **Elementor DOM inspector** — container/widget trees (`.e-con`, classic sections), hidden responsive elements, repeated widgets, and actionable suggestions.
- **CSS tools** — live toggle of any stylesheet, plus a sandboxed "apply/clear" style injection.
- **Forms tools** — form discovery, method/action parsing, required-field detection, and safe fill-testing.
- **Image tools** — dimensions/alt audit, flash-highlight, and per-image hide/restore.
- **Debug audit** — a single command-line-style report of everything above with severity verdicts (pass / warning / critical).

### Reporting
- **Complete audit report** — exports a clean, plain-text-branded HTML or Word-ready report generated from the audit.
- **Site crawler** — queue-based crawl across linked pages (deduped, capped, stop-safe) that keeps results in a dedicated report tab via a service-worker-hosted blob.

### Everything stays clean
- **Zero pre-injected content** into pages — the content script runs only on demand.
- **Permission-light** — `activeTab`, `scripting`, `windows`, `downloads`; host access is **optional** and requested only when a site crawl begins.
- **Accessible tab UI** — full keyboard support (arrow keys, Home/End), ARIA roles, and a scrollable tab rail that never clips or hides controls.

## Installation

### Option A — Load unpacked (for development / personal use)

1. Download or clone this repository.
2. Open Chrome or Edge and go to `chrome://extensions` (or `edge://extensions`).
3. Toggle **Developer mode** on (top-right corner).
4. Click **Load unpacked** and select the folder containing `manifest.json` (the repo root).
5. Pin **Web Doctor** to the toolbar, open any page, and click the icon.

### Option B — Packaged ZIP (for the Chrome Web Store / Edge Add-ons)

1. `Compress-Archive` the extension files into a ZIP or run the packaging helper in the repo.
2. In the store's developer dashboard, **Upload a new item** and select the ZIP.
3. Fill in the store listing (description, category, and assets).
4. Submit for review.

> The ZIP must contain `manifest.json` at its root — do not wrap the files in an extra folder unless the store validator accepts it.

### Building your own ZIP

```powershell
Compress-Archive -Path manifest.json, background.js, content.js, crawl-planner.js, `
  popup.html, popup.css, panel.css, popup.js, README.md, icons\ `
  -DestinationPath webdoctor.zip -Force
```

## Usage

1. Navigate to the page you want to check.
2. Open **Web Doctor** from the toolbar — the active page is analyzed automatically.
3. Browse the report by tab (**Overview**, **DOM**, **Dev Deep-Dive**, **Performance**, **SEO**, **Structure**, **Technology**, **Accessibility**, **Debug**, **Devices**, **Audit**).
4. Use **Rescan** to re-run on the current page, **Debug** for the deep-dive tools, and **Audit → Crawl** to analyze linked pages across the site.

## Project structure

```
├── manifest.json        # MV3 manifest (permissions, popup, background)
├── popup.html           # Popup UI / tab shell
├── popup.css            # Popup component styles
├── panel.css            # Tab rail + shared panel styles
├── popup.js             # Popup logic: tabs, analysis orchestration, reports
├── content.js           # On-demand page analysis engine (injected at scan time)
├── background.js        # Service worker: device windows, captures, crawl, blob hosting
├── crawl-planner.js     # Crawl queue builder (dedupe, cap, normalization)
└── icons/               # 16/32/48/128 px extension icons
```

## Privacy

- No accounts, no analytics, no telemetry, no remote servers.
- All page analysis happens locally through the `activeTab` permission you consciously grant each scan.
- The optional `http(s)://*/*` host permission is requested **only** when you start a site crawl and can be denied without losing any single-page functionality.
- The `downloads` permission is used only when you export an audit report.

## Author

Built by **Nabin Khadka** — [nabinkhadka.com](https://www.nabinkhadka.com)

## License

MIT — see the `LICENSE` file for details. (Add one before publishing if you haven't already.)