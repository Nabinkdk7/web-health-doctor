// Pure planning helpers for the Site Crawler. Kept in their own classic
// script so the background service worker can importScripts() them and the
// Node test harness can evaluate them in a VM sandbox.
(function (root) {
  "use strict";

  var ASSET_EXT = /\.(png|jpe?g|gif|webp|svg|ico|css|js|mjs|json|woff2?|ttf|otf|eot|mp4|webm|ogv|mp3|wav|pdf|zip|gz|7z|docx?|xlsx?|pptx?|txt|rtf|xml)$/i;
  var TRACKING_PARAMS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid", "ref", "source", "mc_cid", "mc_eid"];

  // True when the URL points at a file/feed/API rather than a page worth
  // crawling (images, scripts, fonts, archives, feeds, wp-json, robots, sitemaps).
  function crawlLooksPageAsset(url) {
    try {
      var u = typeof url === "string" ? new URL(url) : url;
      if (ASSET_EXT.test(u.pathname.toLowerCase())) return true;
      if (/^\/(feed|wp-json|xmlrpc\.php|robots\.txt|sitemap(_index)?\.xml)(\/|\?|$)/i.test(u.pathname)) return true;
      if (/\/wp-json\//i.test(u.pathname)) return true;
      return false;
    } catch (e) { return true; }
  }

  // Canonical, de-duplicated crawler link. Returns null for anything that is
  // not a same-origin http(s) page (external hosts, assets, fragments-only).
  // Keeps the query string (minus tracking params) so /?page=2 type children
  // still get crawled once.
  function crawlNormalizeChild(href, sameOrigin) {
    var raw = String(href || "").trim();
    if (!raw || /^(#|javascript:|mailto:|tel:|sms:|data:|blob:)/i.test(raw)) return null;
    var u;
    try {
      u = new URL(raw, sameOrigin || "https://unknown.invalid/");
    } catch (e) { return null; }
    if (u.origin.replace(/\/$/, "") === "https://unknown.invalid") return null;
    if (!/^https?:$/.test(u.protocol)) return null;
    if (sameOrigin && u.origin.toLowerCase() !== String(sameOrigin).toLowerCase().replace(/\/$/, "")) return null;
    if (crawlLooksPageAsset(u)) return null;
    u.hash = "";
    if (u.searchParams) {
      for (var i = 0; i < TRACKING_PARAMS.length; i++) {
        try { u.searchParams.delete(TRACKING_PARAMS[i]); } catch (e) {}
      }
    }
    return u.href;
  }

  // Builds the ordered crawl queue. The root always leads the queue; shallow
  // child pages (path depth <= 1) come before deeper ones so key sections are
  // audited even when the page cap is small.
  function crawlBuildQueue(rootHref, collectedLinks, maxPages) {
    var origin = null;
    try { origin = new URL(rootHref).origin; } catch (e) { origin = null; }
    var seen = Object.create(null);
    var queue = [];
    var push = function (u, text) {
      if (!u || seen[u]) return;
      seen[u] = true;
      queue.push({ href: u, text: text });
    };
    var root = crawlNormalizeChild(rootHref, null) || String(rootHref || "");
    push(root, "Home");
    var shallow = [];
    var deep = [];
    (collectedLinks || []).forEach(function (link) {
      var u = crawlNormalizeChild(link && link.href, origin);
      if (!u) return;
      var n = 0;
      try { n = new URL(u).pathname.split("/").filter(function (p) { return !!p; }).length; } catch (e) { n = 0; }
      (n <= 1 ? shallow : deep).push({ href: u, text: (link && link.text) || "" });
    });
    shallow.concat(deep).forEach(function (link) { push(link.href, link.text); });
    var cap = Math.max(1, Math.min(parseInt(maxPages, 10) || 8, 25));
    return { queue: queue.slice(0, cap), totalFound: queue.length, capped: queue.length > cap };
  }

  root.crawlPlanner = {
    crawlLooksPageAsset: crawlLooksPageAsset,
    crawlNormalizeChild: crawlNormalizeChild,
    crawlBuildQueue: crawlBuildQueue
  };
})(typeof globalThis !== "undefined" ? globalThis : (typeof self !== "undefined" ? self : this));