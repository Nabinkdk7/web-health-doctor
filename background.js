try { importScripts("crawl-planner.js"); } catch (e) {}
const crawlPlanner = (typeof self !== "undefined" && self.crawlPlanner) || (typeof globalThis !== "undefined" && globalThis.crawlPlanner) || {};

// Self-contained probe that runs in the page's MAIN world.
// Content scripts in the isolated world cannot see page globals
// (window.jQuery, window.Shopify, __NEXT_DATA__, ...) so we read them here.
const PROBE_GLOBALS = function () {
  var r = {};
  try { r.jQuery = !!window.jQuery; } catch (e) {}
  try { r.Shopify = !!window.Shopify; } catch (e) {}
  try { r.NextData = !!window.__NEXT_DATA__; } catch (e) {}
  try { r.Nuxt = !!(window.__NUXT__ || document.getElementById('__nuxt')); } catch (e) {}
  try { r.Vue = !!(window.Vue || window.__VUE__); } catch (e) {}
  try { r.Angular = !!(window.ng || window.ngZone); } catch (e) {}
  try { r.Analytics = !!(window.ga || window.gtag || window.dataLayer); } catch (e) {}
  try { r.GoogleTagManager = !!window.google_tag_manager; } catch (e) {}
  // React: scan DOM nodes for React fiber markers (capped for large pages)
  r.React = false;
  try {
    var els = document.querySelectorAll('*');
    for (var i = 0; i < Math.min(els.length, 5000); i++) {
      for (var k in els[i]) {
        if (k.indexOf('__reactFiber$') === 0 || k.indexOf('__reactInternalInstance') === 0) {
          r.React = true;
          break;
        }
      }
      if (r.React) break;
    }
  } catch (e) {}
  return r;
};

// =============================================
// VERSION MANAGER + GITHUB UPDATE CHECKER
// =============================================
const WD_GITHUB = { owner: "Nabinkdk7", repo: "web-health-doctor", api: "https://api.github.com" };

const KNOWN_VERSIONS = [
  { tag: "v1.3.0", label: "Version Manager \u2014 switch versions + GitHub update checker" },
  { tag: "v1.2.0", label: "Sci-fi danger sound + reliable audio playback" },
  { tag: "v1.1.0", label: "Scrollable tab rail + health verdict notification" },
  { tag: "v1.0.0", label: "Initial release" }
];

function wdVersionParts(v) {
  const m = String(v || "").trim().replace(/^v/i, "").match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!m) return null;
  return [parseInt(m[1] || 0, 10), parseInt(m[2] || 0, 10), parseInt(m[3] || 0, 10)];
}

function wdVersionCompare(a, b) {
  const pa = wdVersionParts(a), pb = wdVersionParts(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1;
  }
  return 0;
}

// Latest tags from GitHub first, falling back to the built-in known list when
// offline or rate-limited.
function wdFetchTags() {
  return fetch(WD_GITHUB.api + "/repos/" + WD_GITHUB.owner + "/" + WD_GITHUB.repo + "/tags?per_page=100", { cache: "no-store" })
    .then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    })
    .then(function (list) {
      const out = [];
      (list || []).forEach(function (t) { if (t && t.name) out.push(t.name); });
      return out;
    })
    .catch(function () { return []; });
}

function wdGetVersions() {
  return wdFetchTags().then(function (tags) {
    const map = Object.create(null);
    KNOWN_VERSIONS.forEach(function (v) { if (!map[v.tag]) map[v.tag] = { tag: v.tag, label: v.label }; });
    tags.forEach(function (t) { if (!map[t]) map[t] = { tag: t, label: "" }; });
    const items = [];
    for (const k in map) items.push(map[k]);
    items.sort(function (a, b) {
      const c = wdVersionCompare(a.tag, b.tag);
      return c === null ? (a.tag === b.tag ? 0 : a.tag < b.tag ? 1 : -1) : -c;
    });
    return items.filter(function (v) { return wdVersionParts(v.tag) !== null; });
  });
}

function wdActiveVersion() {
  return new Promise(function (resolve) {
    chrome.storage.local.get("wdActiveVersion", function (o) { resolve(o.wdActiveVersion || null); });
  });
}

function wdSetActiveVersion(tag) {
  return new Promise(function (resolve) {
    chrome.storage.local.set({ wdActiveVersion: tag }, function () {
      resolve(chrome.runtime.lastError ? null : tag);
    });
  });
}

// Shows the update notification once per published version unless forced.
function wdMaybeNotify(latest, force) {
  return new Promise(function (resolve) {
    chrome.storage.local.get("wdNotifiedTag", function (o) {
      if (!force && o.wdNotifiedTag === latest) { resolve(false); return; }
      chrome.notifications.create("wd-update", {
        type: "basic",
        iconUrl: chrome.runtime.getURL("icons/icon128.png"),
        title: "Web Doctor update available",
        message: "Version " + latest + " is now available. See what\u2019s new on GitHub.",
        priority: 2,
        requireInteraction: true,
        buttons: [{ title: "View release" }, { title: "Later" }]
      }, function () {
        if (chrome.runtime.lastError) { resolve(false); return; }
        chrome.storage.local.set({ wdNotifiedTag: latest }, function () { resolve(true); });
      });
    });
  });
}

function wdCheckUpdate(force) {
  return wdGetVersions().then(function (items) {
    const current = chrome.runtime.getManifest().version;
    const latest = items.length ? items[0].tag : null;
    const upd = !!latest && wdVersionCompare(latest, current) === 1;
    const status = { ok: true, current: current, latest: latest, update: upd, versionsCount: items.length };
    if (upd) return wdMaybeNotify(latest, force).then(function () { return status; });
    return status;
  }).catch(function (err) {
    return { ok: false, error: (err && err.message) || "Update check failed." };
  });
}

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (sender && sender.id !== chrome.runtime.id) return;
  if (message.action === "openDevicePreview") {
    handleDevicePreview(message, sendResponse);
    return true;
  }
  if (message.action === "deviceCapture") {
    // Screenshot of the device-frame window, requested by the popup. The
    // windowId travels with the message (the popup learned it when the device
    // window was created); falling back to the sender's window keeps older
    // in-page panels working.
    const windowId = (message && typeof message.windowId === "number") ? message.windowId : ((sender && sender.tab) ? sender.tab.windowId : null);
    captureDeviceWindow(windowId, 12000, sendResponse);
    return true;
  }
  if (message.action === "hostBlob") {
    // Popup-created Blob URLs die when the popup closes, so the popup hands
    // report HTML to the service worker, which owns the object URL instead.
    const name = String(message.name || "report.html");
    const html = String(message.html || "");
    if (!html) { sendResponse({ success: false, error: "Empty document." }); return true; }
    try {
      const url = URL.createObjectURL(new Blob([html], { type: String(message.mime || "text/html") }));
      if (blobHostMap[name]) { try { URL.revokeObjectURL(blobHostMap[name]); } catch (e) {} }
      blobHostMap[name] = url;
      sendResponse({ success: true, url: url });
    } catch (err) {
      sendResponse({ success: false, error: err.message });
    }
    return true;
  }
  if (message.action === "crawlSite") {
    crawlSite(message, sendResponse);
    return true;
  }
  if (message.action === "crawlStop") {
    stopCrawl();
    sendResponse({ success: true });
    return true;
  }
  if (message.action === "getVersions") {
    wdGetVersions().then(function (versions) {
      wdActiveVersion().then(function (active) {
        sendResponse({ ok: true, versions: versions, current: chrome.runtime.getManifest().version, active: active });
      });
    });
    return true;
  }
  if (message.action === "setActiveVersion") {
    wdSetActiveVersion(String(message.tag || "")).then(function (tag) {
      sendResponse(tag ? { ok: true, active: tag } : { ok: false, error: "Could not save the active version." });
    });
    return true;
  }
  if (message.action === "checkUpdate") {
    wdCheckUpdate(message.force === true).then(function (status) {
      sendResponse(status);
    });
    return true;
  }
  if (message.action !== "analyzeTab") return;

  chrome.tabs.query({ active: true, lastFocusedWindow: true }, function (tabs) {
    if (!tabs || tabs.length === 0) {
      sendResponse({ success: false, error: "No active tab found." });
      return;
    }

    const tab = tabs[0];
    const tabUrl = tab.url || "";

    // Block restricted pages
    if (tabUrl.startsWith("chrome://") || tabUrl.startsWith("chrome-extension://") ||
        tabUrl.startsWith("about:") || tabUrl.startsWith("edge://") ||
        tabUrl.startsWith("devtools://") || tabUrl.startsWith("view-source:")) {
      sendResponse({ success: false, error: "Cannot analyze this page. Chrome internal pages and extension pages are restricted." });
      return;
    }

    // Step 1: read page globals from the MAIN world (best effort).
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: PROBE_GLOBALS,
      world: "MAIN"
    }, function (probeRes) {
      var globals = {};
      if (!chrome.runtime.lastError && probeRes && probeRes[0] && probeRes[0].result) {
        globals = probeRes[0].result;
      }

      // Step 2: inject the analyzer into the ISOLATED world (has chrome.* APIs).
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"]
      }, function () {
        if (chrome.runtime.lastError) {
          sendResponse({ success: false, error: "Cannot access this page. " + (chrome.runtime.lastError.message || "Permission denied.") });
          return;
        }

        // Small delay to ensure the listener is registered.
        setTimeout(function () {
          chrome.tabs.sendMessage(tab.id, { action: "analyze", globals: globals }, function (response) {
            if (chrome.runtime.lastError) {
              sendResponse({ success: false, error: "Failed to communicate with the page. " + chrome.runtime.lastError.message });
              return;
            }
            if (!response || !response.success) {
              sendResponse(response || { success: false, error: "The page did not return analysis results." });
              return;
            }
            sendResponse(response);
          });
        }, 120);
      });
    });
  });

  return true; // Keep the message channel open for the async response.
});

// Waits for the device window's active tab to finish loading (polling every
// 250ms up to `timeoutMs`), then captures the whole window. Polling keeps this
// simple and robust when the load event is missed or the page redirects, so
// the popup always receives an image or a clear error.
function captureDeviceWindow(windowId, timeoutMs, sendResponse) {
  if (!windowId) {
    sendResponse({ success: false, error: "Could not capture the device window." });
    return;
  }
  const deadline = Date.now() + (timeoutMs || 12000);
  const poll = setInterval(function () {
    chrome.tabs.query({ windowId: windowId, active: true }, function (tabs) {
      if (chrome.runtime.lastError || !tabs || !tabs.length) {
        clearInterval(poll);
        sendResponse({ success: false, error: "Could not find the device window." });
        return;
      }
      const tab = tabs[0];
      if (tab.status === "complete" || Date.now() >= deadline) {
        clearInterval(poll);
        chrome.tabs.captureVisibleTab(windowId, { format: "png" }, function (dataUrl) {
          if (chrome.runtime.lastError || !dataUrl) {
            sendResponse({ success: false, error: (chrome.runtime.lastError && chrome.runtime.lastError.message) || "Could not capture the device window." });
            return;
          }
          sendResponse({ success: true, image: dataUrl });
        });
      }
    });
  }, 250);
  setTimeout(function () { clearInterval(poll); }, (timeoutMs || 12000) + 1500);
}

// Opens a new INCOGNITO browser window sized to a device width, then injects
// the analyzer into its tab and asks it to run the responsive check there.
// Privacy-friendly: the device test never runs in a normal browser tab.
// No per-site permission prompts are used here — the single optional site
// access grant the popup requests once covers this window.
function handleDevicePreview(message, sendResponse) {
  const url = String(message.url || "");
  const width = Math.round(Number(message.width) || 0);
  const height = Math.round(Number(message.height) || 0);
  const runCheck = message.runCheck !== false;

  if (!/^https?:\/\//i.test(url)) {
    sendResponse({ success: false, error: "Only http/https pages can open in a preview window." });
    return;
  }
  if (width < 240 || width > 5120 || height < 320 || height > 4096) {
    sendResponse({ success: false, error: "Invalid preview size." });
    return;
  }

  createPreviewWindow(url, width, height, runCheck, sendResponse);
}

function createPreviewWindow(url, width, height, runCheck, sendResponse) {
  // Window bounds are OUTER pixels (frame included), so pad to approximate the
  // inner viewport; on small screens the OS clamps heights to the display size.
  chrome.windows.create({
    url: url,
    focused: false,
    type: "normal",
    incognito: true,
    width: width + 16,
    height: Math.min(height + 132, 3000)
  }, function (win) {
    if (chrome.runtime.lastError || !win) {
      sendResponse({ success: false, error: "Could not open the Incognito window. " + (chrome.runtime.lastError ? chrome.runtime.lastError.message : "") });
      return;
    }
    chrome.tabs.query({ windowId: win.id, active: true }, function (tabs) {
      const tabId = tabs && tabs[0] ? tabs[0].id : null;
      if (runCheck && tabId) runPlaceholderCheck(tabId, url, width, height);
      sendResponse({ success: true, windowId: win.id, tabId: tabId });
    });
  });
}

// Runs the checker inside the page once the Incognito tab finishes loading.
// Reports failures back to the popup (e.g. the extension is not allowed in
// Incognito or site access was not granted).
function runPlaceholderCheck(tabId, url, width, height) {
  if (tabId === null) return;
  const origin = url.replace(/^(https?:\/\/[^/]+).*$/i, "$1");
  let handled = false;
  const attempt = function () {
    if (handled) return;
    handled = true;
    chrome.scripting.executeScript({ target: { tabId: tabId }, files: ["content.js"] }, function () {
      if (chrome.runtime.lastError) {
        notifyDeviceFailure(chrome.runtime.lastError.message);
        return;
      }
      chrome.runtime.sendMessage({ action: "deviceCheckStatus", ok: true }, function () { void chrome.runtime.lastError; });
      chrome.tabs.sendMessage(tabId, { action: "inPageDeviceCheck", width: width, height: height }, function () {
        void chrome.runtime.lastError;
      });
    });
  };
  const listener = function (updatedTabId, changeInfo, tab) {
    if (updatedTabId !== tabId || changeInfo.status !== "complete") return;
    if (!tab.url || !/^https?:\/\//i.test(tab.url)) return;
    if (tab.url.replace(/^(https?:\/\/[^/]+).*$/i, "$1") !== origin) return;
    chrome.tabs.onUpdated.removeListener(listener);
    attempt();
  };
  chrome.tabs.onUpdated.addListener(listener);
  // Fallback if the load event fired before the window was created.
  setTimeout(function () {
    chrome.tabs.onUpdated.removeListener(listener);
    if (handled) return;
    chrome.tabs.get(tabId, function (tab) {
      if (chrome.runtime.lastError || !tab || tab.status !== "complete") return;
      if (!tab.url || !/^https?:\/\//i.test(tab.url)) return;
      if (tab.url.replace(/^(https?:\/\/[^/]+).*$/i, "$1") !== origin) return;
      attempt();
    });
  }, 5000);
}

function notifyDeviceFailure(msg) {
  const m = String(msg || "");
  const hint = /incognito/i.test(m)
    ? "Enable \u201CAllow in Incognito\u201D for this extension."
    : "Site access is not granted for this page.";
  broadcast({ action: "deviceCheckStatus", ok: false, error: hint });
}

// =============================================
// SITE CRAWLER
// =============================================
// Scans the current site by loading child pages one at a time in a single
// foreground-hidden background tab, running the frontend audit in each page,
// then HTTP-probing every collected URL from the extension worker (host
// permission bypasses CORS). All results merge into one site report generated
// in the popup. Any page the crawler cannot reach is recorded, not fatal.
const crawlController = { stop: false, tabId: null, active: false };
const blobHostMap = Object.create(null);

// Best-effort broadcast (progress/status pings) with the rejection handled, so
// a missing receiver can never surface as an unhandled promise rejection.
function broadcast(payload) {
  try {
    const p = chrome.runtime.sendMessage(payload);
    if (p && typeof p.catch === "function") p.catch(function () {});
  } catch (e) {}
}

function stopCrawl() {
  crawlController.stop = true;
}

function crawlProgressMsg(payload) { broadcast(payload); }

// HTTP probe (HEAD, GET fallback for 405/501) from the worker context so host
// permission lets us verify URLs that the page's CORS would otherwise block.
function checkUrlProbe(url) {
  return new Promise(function (resolve) {
    const ctrl = typeof AbortController === "function" ? new AbortController() : null;
    let done = false;
    let timer = null;
    if (ctrl) {
      timer = setTimeout(function () {
        if (!done) { done = true; ctrl.abort(); resolve({ status: null, timedOut: true }); }
      }, 9000);
    }
    const settle = function (res) {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      resolve(res);
    };
    const opts = { cache: "no-store", redirect: "follow", credentials: "omit", signal: ctrl ? ctrl.signal : undefined };
    const probe = function (method) {
      return fetch(url, Object.assign({ method: method }, opts)).then(function (res) {
        let finalUrl = null;
        try { finalUrl = res.url || null; } catch (e) {}
        return { status: res.status, redirected: !!res.redirected, finalUrl: finalUrl };
      });
    };
    probe("HEAD").then(function (res) {
      if (!res.ok && (res.status === 405 || res.status === 501)) return probe("GET");
      return res;
    }).then(function (res) { settle(res); }, function () { settle({ status: null, timedOut: false }); });
  });
}

// Small concurrency pool over the given URLs; only real 404/410 count as
// broken (other failures are recorded as unverified, not broken).
function crawlProbeUrls(urls, max, isStopped) {
  const uniq = [];
  const seen = Object.create(null);
  (urls || []).forEach(function (u) {
    if (!u || seen[u]) return;
    seen[u] = true;
    if (uniq.length < (max || 300)) uniq.push(u);
  });
  const pool = Math.max(1, Math.min(6, uniq.length));
  const results = new Array(uniq.length);
  let next = 0;
  return new Promise(function (resolve) {
    if (!uniq.length) { resolve({ checked: 0, broken: [] }); return; }
    let remaining = uniq.length;
    const collect = function (done) {
      const broken = [];
      uniq.forEach(function (u, idx) {
        const r = results[idx];
        if (r && (r.status === 404 || r.status === 410)) {
          broken.push({ url: u, status: r.status, reason: "HTTP " + r.status + (r.status === 404 ? " \u2014 not found" : " \u2014 gone") });
        }
      });
      done({ checked: uniq.length, broken: broken });
    };
    const worker = function () {
      const i = next++;
      if (i >= uniq.length) return;
      checkUrlProbe(uniq[i]).then(function (res) {
        results[i] = res;
        if (--remaining === 0) collect(resolve);
        else if (isStopped && isStopped()) collect(resolve);
        else worker();
      }, function () {
        results[i] = null;
        if (--remaining === 0) collect(resolve);
        else if (isStopped && isStopped()) collect(resolve);
        else worker();
      });
    };
    for (let k = 0; k < pool; k++) worker();
  });
}

// Wait for a tab to finish loading (or time out). Also treats Chrome error
// pages as an immediate failure so the crawl can move on.
function crawlWaitLoad(tabId, timeoutMs, isStopped) {
  return new Promise(function (resolve) {
    let settled = false;
    const done = function (ok) {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timer);
      clearInterval(stopPoll);
      resolve(ok);
    };
    const listener = function (updatedId, changeInfo) {
      if (updatedId !== tabId) return;
      if (changeInfo.status === "complete") done(true);
      else if (changeInfo.title && /^error$/i.test(changeInfo.title)) done(false);
    };
    const timer = setTimeout(function () { done(false); }, timeoutMs);
    // Resolve quickly when the user stops the crawl mid-load.
    const stopPoll = setInterval(function () {
      if (isStopped && isStopped()) done(false);
    }, 250);
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId, function (tab) {
      if (chrome.runtime.lastError) { done(false); return; }
      if (tab && tab.status === "complete") done(true);
    });
  });
}

// Inject content.js into the worker tab and run the frontend audit there.
function crawlInjectAudit(tabId) {
  return new Promise(function (resolve) {
    chrome.scripting.executeScript({ target: { tabId: tabId }, files: ["content.js"] }, function () {
      if (chrome.runtime.lastError) {
        resolve({ success: false, error: chrome.runtime.lastError.message || "Cannot inject into the page." });
        return;
      }
      setTimeout(function () {
        chrome.tabs.sendMessage(tabId, { action: "frontendaudit" }, function (response) {
          if (chrome.runtime.lastError || !response) {
            resolve({ success: false, error: chrome.runtime.lastError ? chrome.runtime.lastError.message : "The page did not respond to the audit." });
            return;
          }
          resolve(response);
        });
      }, 90);
    });
  });
}

function crawlEnsureHostAccess(origin) {
  // The popup requests the optional host permission (it runs inside the user
  // gesture); the service worker cannot. This is a read-only contains() gate so
  // the crawl only proceeds when access was actually granted.
  return new Promise(function (resolve) {
    if (!chrome.permissions) { resolve(false); return; }
    const pattern = String(origin).replace(/\/$/, "") + "/*";
    chrome.permissions.contains({ origins: [pattern] }, function (has) {
      resolve(!!has);
    });
  });
}

function crawlSameOrigin(url, origin) {
  try { return new URL(url).origin === String(origin).replace(/\/$/, ""); } catch (e) { return false; }
}

// Loads pages one at a time in a reused background tab. The root page is
// loaded first and its internal links build the rest of the queue. Returns the
// per-page audit payloads together with the final queue state.
function crawlSiteRun(origin, rootHref, maxPages) {
  const pages = [];
  let completed = 0;
  let failed = 0;
  return new Promise(function (resolve, reject) {
    let queue = [{ href: rootHref, text: "Home" }];

    chrome.tabs.create({ url: rootHref, active: false }, function (tab) {
      if (chrome.runtime.lastError || !tab) {
        reject(new Error(chrome.runtime.lastError ? chrome.runtime.lastError.message : "Could not open a background page."));
        return;
      }
      crawlController.tabId = tab.id;
      const go = function () {
        if (crawlController.stop || completed >= queue.length || completed >= maxPages) {
          resolve({ pages: pages, queue: queue, completed: completed, failed: failed });
          return;
        }
        const entry = queue[completed];
        crawlProgressMsg({
          action: "crawlProgress", phase: "page", done: completed, total: Math.min(queue.length, maxPages),
          currentUrl: entry.href, currentTitle: entry.text, failed: failed
        });
        const audit = function () {
          crawlWaitLoad(tab.id, 15000, function () { return crawlController.stop; }).then(function () {
            if (crawlController.stop) { completed++; go(); return; }
            crawlInjectAudit(tab.id).then(function (res) {
              if (crawlController.stop) { completed++; go(); return; }
              if (!res.success) {
                failed++;
                pages.push({ url: entry.href, title: entry.text || "", error: res.error || "Page did not respond." });
              } else {
                const data = res.data || {};
                pages.push({ url: entry.href, title: data.title || entry.text || "Untitled page", data: data, error: null });
                // First page's internal links define the crawl queue.
                if (completed === 0 && data.internalLinks && data.internalLinks.links && crawlPlanner.crawlBuildQueue) {
                  const planned = crawlPlanner.crawlBuildQueue(rootHref, data.internalLinks.links, maxPages);
                  queue = planned.queue;
                }
              }
              completed++;
              go();
            });
          });
        };
        if (completed === 0) {
          setTimeout(audit, 60);
        } else {
          chrome.tabs.update(tab.id, { url: entry.href }, function () {
            if (chrome.runtime.lastError) {
              failed++;
              pages.push({ url: entry.href, title: entry.text || "Unreachable page", error: chrome.runtime.lastError.message });
              completed++;
              go();
              return;
            }
            audit();
          });
        }
      };
      go();
    });
  });
}

// Entry point: host-access check, per-page audits, then network probes for
// every link/image collected across the site.
function crawlSite(message, sendResponse) {
  const rootHref = String(message.url || "");
  if (!/^https?:\/\//i.test(rootHref)) {
    sendResponse({ success: false, error: "A valid http(s) URL is required to crawl the site." });
    return;
  }
  let origin;
  try { origin = new URL(rootHref).origin; } catch (e) {
    sendResponse({ success: false, error: "Could not parse the site URL." });
    return;
  }
  const maxPages = Math.max(1, Math.min(parseInt(message.maxPages, 10) || 8, 25));

  // Reentrancy guard: mark the controller active BEFORE any async hop so a
  // second crawl request is rejected instead of overlapping the running one.
  if (crawlController.active) {
    sendResponse({ success: false, error: "A site crawl is already running. Stop it first." });
    return;
  }
  crawlController.stop = false;
  crawlController.active = true;

  crawlEnsureHostAccess(origin).then(function (granted) {
    if (!granted) {
      crawlController.active = false;
      sendResponse({ success: false, error: "Site access is required to crawl child pages. Grant access to " + new URL(origin).host + " to continue." });
      return;
    }
    crawlProgressMsg({ action: "crawlProgress", phase: "start", total: maxPages, root: rootHref });

    crawlSiteRun(origin, rootHref, maxPages).then(function (result) {
      const pages = result.pages;
      const allLinks = [];
      const allImages = [];
      pages.forEach(function (p) {
        const cand = (p.data && p.data.urlCandidates) || {};
        (cand.links || []).forEach(function (u) { allLinks.push(u); });
        (cand.images || []).forEach(function (u) { allImages.push(u); });
      });
      crawlProgressMsg({ action: "crawlProgress", phase: "probe", total: pages.length, extra: { links: allLinks.length, images: allImages.length } });
      const sameOriginLinks = allLinks.filter(function (u) { return crawlSameOrigin(u, origin); });
      const linkProbe = crawlProbeUrls(sameOriginLinks, 300, function () { return crawlController.stop; });
      const imgProbe = crawlProbeUrls(allImages, 300, function () { return crawlController.stop; });
      Promise.all([linkProbe, imgProbe]).then(function (out) {
        const pageOf = function (url) {
          const refs = [];
          pages.forEach(function (p) {
            const cand = (p.data && p.data.urlCandidates) || {};
            if ((cand.links || []).indexOf(url) !== -1 || (cand.images || []).indexOf(url) !== -1) {
              refs.push(p.title || p.url);
            }
          });
          return refs.slice(0, 6).join(", ");
        };
        const brokenLinks = (out[0].broken || []).map(function (b) {
          return { url: b.url, status: b.status, reason: b.reason, foundOn: pageOf(b.url) };
        });
        const brokenImages = (out[1].broken || []).map(function (b) {
          return { url: b.url, status: b.status, reason: b.reason, foundOn: pageOf(b.url) };
        });
        crawlController.active = false;
        if (crawlController.tabId !== null) {
          chrome.tabs.remove(crawlController.tabId, function () { void chrome.runtime.lastError; });
          crawlController.tabId = null;
        }
        crawlProgressMsg({ action: "crawlProgress", phase: "done", total: pages.length, failed: result.failed });
        sendResponse({
          success: true,
          meta: { root: rootHref, origin: origin, maxPages: maxPages, scanned: pages.length, failed: result.failed, generated: Date.now() },
          pages: pages,
          probes: {
            linkChecked: out[0].checked,
            imageChecked: out[1].checked,
            brokenLinks: brokenLinks,
            brokenImages: brokenImages
          }
        });
      });
    }, function (err) {
      crawlController.active = false;
      if (crawlController.tabId !== null) {
        chrome.tabs.remove(crawlController.tabId, function () { void chrome.runtime.lastError; });
        crawlController.tabId = null;
      }
      sendResponse({ success: false, error: (err && err.message) || "Crawl failed." });
    });
  });
}

// Recurring + install-time update checks. The popup can also trigger one via
// the checkUpdate message.
chrome.runtime.onInstalled.addListener(function () { wdCheckUpdate(false); });
chrome.runtime.onStartup.addListener(function () { wdCheckUpdate(false); });
chrome.alarms.create("wd-update-check", { periodInMinutes: 360 });
chrome.alarms.onAlarm.addListener(function (alarm) {
  if (alarm && alarm.name === "wd-update-check") wdCheckUpdate(false);
});

chrome.notifications.onButtonClicked.addListener(function (id, index) {
  if (id !== "wd-update") return;
  if (index === 0) {
    chrome.tabs.create({ url: "https://github.com/" + WD_GITHUB.owner + "/" + WD_GITHUB.repo + "/tags" }, function () { void chrome.runtime.lastError; });
  }
  chrome.notifications.clear(id, function () { void chrome.runtime.lastError; });
});
