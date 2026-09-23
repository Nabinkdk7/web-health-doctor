(function () {
  if (window.__wspc_analyzed) return;
  window.__wspc_analyzed = true;

  let hotspotElements = [];
  let responsiveElements = [];
  let debugElements = [];
  let currentResults = null;

  // Small shared helper set used across the analyzers.

  // Ownership guard for the fixed DOM ids the extension injects into the page.
  // Pages can ship elements with the same ids; by tagging every node we create
  // and only ever touching tagged nodes we never remove or restyle page DOM.
  function wspcOwned(id) {
    var el = document.getElementById(id);
    if (!el || el.getAttribute("data-wspc-own") !== "1") return null;
    return el;
  }
  function wspcTag(el) {
    try { el.setAttribute("data-wspc-own", "1"); } catch (e) {}
    return el;
  }

  // Tag set that participates in the responsive passes (matches the historical
  // selector lists). Kept in JS so the responsive scan can reuse the single
  // all-elements census instead of running another broad querySelectorAll.
  const RESPONSIVE_TAGS = new Set([
    "div", "section", "article", "main", "aside", "table", "form", "header",
    "footer", "ul", "ol", "nav", "img", "video", "iframe", "figure",
    "h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "label", "span", "a",
    "button", "input", "textarea", "select"
  ]);

  function responsiveCandidates(all) {
    const out = [];
    for (let i = 0; i < all.length; i++) {
      if (RESPONSIVE_TAGS.has(all[i].tagName.toLowerCase())) out.push(all[i]);
    }
    return out;
  }

  // One DOM walk shared by every analyzer. Element references never leave this
  // world (they must not end up in the chrome message payload), so the census
  // is built fresh per analyze() call and only passed around internally.
  function buildCensus() {
    const all = document.querySelectorAll("*");
    const byTag = Object.create(null);
    for (let i = 0; i < all.length; i++) {
      const t = all[i].tagName.toLowerCase();
      if (!byTag[t]) byTag[t] = [];
      byTag[t].push(all[i]);
    }
    return { all: all, byTag: byTag };
  }

  // Short "<tag#id>" / "<tag.cls>" label for a shift-source node.
  // ---- Live CLS accumulation ----
  // layout-shift is a live metric: buffered timeline entries already cover
  // shifts since navigation, and a listener keeps collecting shifts up to the
  // moment the user runs a scan. Both lists are merged at analysis time.
  const liveShiftEntries = [];
  if (typeof window.PerformanceObserver === "function") {
    try {
      const po = new PerformanceObserver(function (list) {
        list.getEntries().forEach(function (e) {
          if (liveShiftEntries.length >= 2000) liveShiftEntries.shift();
          liveShiftEntries.push(e);
        });
      });
      po.observe({ type: "layout-shift", buffered: true });
    } catch (e) {}
  }

  // ---- Persistent "track section" highlight ----
  // Pins a scroll-following outline + label over a specific DOM section so the
  // user can keep eyes on the biggest DOM contributor while scrolling the page.
  let tracked = null;
  let trackingRAF = 0;

  function requestTrackingFrame() {
    if (trackingRAF) return;
    trackingRAF = requestAnimationFrame(function () {
      trackingRAF = 0;
      positionTracking();
    });
  }

  function clearTracking() {
    if (!tracked) return;
    if (tracked.overlay && tracked.overlay.parentNode) tracked.overlay.parentNode.removeChild(tracked.overlay);
    if (tracked.badge && tracked.badge.parentNode) tracked.badge.parentNode.removeChild(tracked.badge);
    if (trackingRAF) cancelAnimationFrame(trackingRAF);
    trackingRAF = 0;
    if (typeof window.removeEventListener === "function") {
      window.removeEventListener("scroll", requestTrackingFrame, { passive: true });
      window.removeEventListener("resize", requestTrackingFrame, { passive: true });
    }
    tracked = null;
  }

  function positionTracking() {
    if (!tracked) return;
    // The tracked node may have been removed by page JS / SPA navigation;
    // self-clean the overlay instead of leaving a floating 0x0 outline.
    if (!tracked.el.isConnected) { clearTracking(); return; }
    const r = tracked.el.getBoundingClientRect();
    const ov = tracked.overlay;
    ov.style.left = Math.max(0, r.left - 4) + "px";
    ov.style.top = Math.max(0, r.top - 4) + "px";
    ov.style.width = r.width + "px";
    ov.style.height = r.height + "px";
    const badge = tracked.badge;
    let bx = r.right + 8;
    if (bx + badge.offsetWidth > window.innerWidth) bx = Math.max(8, r.left - badge.offsetWidth - 8);
    badge.style.left = bx + "px";
    badge.style.top = Math.max(6, r.top) + "px";
  }

  function startTracking(el, info) {
    clearTracking();
    const ov = document.createElement("div");
    ov.style.cssText = "position:fixed;z-index:2147483646;pointer-events:none;box-sizing:border-box;" +
      "border:3px solid #6366f1;background:rgba(99,102,241,0.10);border-radius:6px;" +
      "box-shadow:0 0 0 4px rgba(99,102,241,0.18);transition:opacity .2s;";
    const badge = document.createElement("div");
    badge.style.cssText = "position:fixed;z-index:2147483647;pointer-events:none;" +
      "background:#4f46e5;color:#fff;font:600 11px/1.4 -apple-system,'Segoe UI',sans-serif;" +
      "padding:6px 10px;border-radius:6px;box-shadow:0 3px 10px rgba(79,70,229,0.35);" +
      "max-width:340px;";
    if (typeof info === "string") info = { title: info, lines: [] };
    const title = document.createElement("div");
    title.style.cssText = "font-weight:800;font-size:11px;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
    title.textContent = info.title || "Tracked section";
    badge.appendChild(title);
    (info.lines || []).forEach(function (line) {
      const d = document.createElement("div");
      d.style.cssText = "font-size:10px;line-height:1.45;color:#e0e7ff;margin-top:2px;white-space:pre-line;";
      d.textContent = line;
      badge.appendChild(d);
    });
    document.body.appendChild(ov);
    document.body.appendChild(badge);
    tracked = { el: el, overlay: ov, badge: badge };
    window.addEventListener("scroll", requestTrackingFrame, { passive: true });
    window.addEventListener("resize", requestTrackingFrame, { passive: true });
    try {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (e) {}
    requestTrackingFrame();
  }

  // One-shot red flash used by "Locate" for both hotspots and device issues.
  function flashElement(el) {
    try {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (e) {}
    setTimeout(function () {
      // The element may have been removed by page JS while we waited.
      if (!el) return;
      let connected = true;
      try { connected = typeof el.isConnected === "boolean" ? el.isConnected : el.parentNode !== null; } catch (e2) { connected = true; }
      if (!connected) return;
      let rect;
      try { rect = el.getBoundingClientRect(); } catch (e) { return; }
      const ov = document.createElement("div");
      ov.style.cssText = "position:fixed;z-index:2147483647;pointer-events:none;border:3px solid #ef4444;" +
        "background:rgba(239,68,68,0.08);border-radius:4px;transition:opacity .6s ease;";
      ov.style.left = rect.left + "px";
      ov.style.top = rect.top + "px";
      ov.style.width = rect.width + "px";
      ov.style.height = rect.height + "px";
      document.body.appendChild(ov);
      setTimeout(function () { ov.style.opacity = "0"; }, 2200);
      setTimeout(function () { if (ov.parentNode) ov.parentNode.removeChild(ov); }, 3000);
    }, 140);
  }

  function analyze(globals) {
    const results = {};
    responsiveElements = [];

    // One shared DOM walk supporting every analyzer. Element references stay in
    // the page context and are never part of the returned results payload.
    const census = buildCensus();

    // ===== PAGE INFO =====
    results.page = {
      url: location.href,
      host: location.host,
      title: document.title || ""
    };

    // ===== DOM STRUCTURE =====
    results.dom = analyzeDOM(census);

    // ===== PERFORMANCE =====
    results.performance = analyzePerformance();

    // ===== SEO =====
    results.seo = analyzeSEO();

    // ===== HEADING HIERARCHY =====
    results.headings = analyzeHeadings(census.byTag);

    // ===== WEBSITE STRUCTURE =====
    results.structure = analyzeStructure(census.byTag);

    // ===== TECHNOLOGY DETECTION =====
    results.technology = detectTechnology(globals);

    // ===== ACCESSIBILITY =====
    results.accessibility = analyzeAccessibility(results.dom, census.byTag);

    // ===== FORMS =====
    results.forms = analyzeForms(census.byTag);

    // ===== LINKS =====
    results.links = analyzeLinks(census.byTag);

    // ===== BROKEN LINKS =====
    // Structural pass (synchronous): placeholder hrefs and fragment links
    // pointing at missing page targets. Deep HTTP 404 verification lives in
    // the dedicated Broken Links tab (analyzebrokenlinks).
    results.brokenLinks = {
      counts: {
        valid: Math.max(0, results.links.total - results.links.brokenInternal),
        broken: results.links.brokenInternal,
        redirect: 0,
        unverified: 0,
        total: results.links.total
      },
      placeholderCount: results.links.placeholderCount,
      fragmentTargetMissing: results.links.fragmentTargetMissing,
      examples: results.links.missingFragmentExamples || [],
      source: "structural"
    };

    // ===== IMAGES =====
    results.images = analyzeImages(census.byTag);

    // ===== RESPONSIVE =====
    results.responsive = analyzeResponsive(responsiveCandidates(census.all));

    // ===== SCORES =====
    results.scores = calculateScores(results);

    return results;
  }

  // =============================================
  // DOM STRUCTURE ANALYZER
  // =============================================
  function analyzeDOM(census) {
    const root = document.documentElement;
    const totalElements = (census && census.all) ? census.all.length : document.querySelectorAll("*").length;

    let maxDepth = 0;
    let maxChildren = 0;
    let deepestElement = "";
    let largestParent = "";
    const tagCounts = Object.create(null);
    let hiddenCount = 0;
    let hiddenSampled = false;
    let emptyCount = 0;
    let excessiveNestingCount = 0;
    let inlineStyleCount = 0;
    let inlineStyleBytes = 0;
    const idMap = Object.create(null);
    const DEPTH_WARNING = 15;
    const STYLE_SAMPLE_MAX = 1200;
    const CONTAINER_TAGS = new Set(["div", "section", "article", "main", "header", "footer", "nav", "aside", "form", "ul", "ol"]);

    // Single iterative post-order pass: depths, child counts, tags, and
    // per-element subtree sizes (so no repeated getComputedStyle on huge pages).
    const subtree = new Map();
    const depthOf = new Map();
    const parents = new Map();
    const parentOf = new Map();
    const containerEls = [];
    const stack = [{ el: root, phase: 0 }];
    let processed = 0;

    while (stack.length) {
      const f = stack[stack.length - 1];
      if (f.phase === 0) {
        f.phase = 1;
        const el = f.el;
        const kids = el.children;

        const tag = el.tagName.toLowerCase();
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
        if (CONTAINER_TAGS.has(tag)) containerEls.push(el);

        const depth = parents.get(el) || 0;
        depthOf.set(el, depth);
        if (depth > maxDepth) {
          maxDepth = depth;
          deepestElement = tag;
        }
        if (depth > DEPTH_WARNING) excessiveNestingCount++;

        const childCount = kids.length;
        if (childCount > maxChildren) {
          maxChildren = childCount;
          largestParent = tag;
        }

        if (el.id) idMap[el.id] = (idMap[el.id] || 0) + 1;

        const inlineStyle = el.getAttribute ? el.getAttribute("style") : null;
        if (inlineStyle) {
          inlineStyleCount++;
          inlineStyleBytes += inlineStyle.length;
        }

        // getComputedStyle is expensive; sample on very large pages. The raw
        // count is rescaled below so reported numbers stay meaningful, and the
        // flag lets the UI say the figure is an estimate.
        processed++;
        if (processed <= STYLE_SAMPLE_MAX) {
          let style = null;
          try { style = window.getComputedStyle(el); } catch (e) { style = null; }
          if (style && (style.display === "none" || style.visibility === "hidden" || style.opacity === "0")) {
            hiddenCount++;
          }
        } else {
          hiddenSampled = true;
        }

        for (let i = kids.length - 1; i >= 0; i--) {
          parents.set(kids[i], depth + 1);
          parentOf.set(kids[i], el);
          stack.push({ el: kids[i], phase: 0 });
        }
      } else {
        stack.pop();
        const el = f.el;
        let c = 0;
        const kids = el.children;
        for (let i = 0; i < kids.length; i++) c += 1 + (subtree.get(kids[i]) || 0);
        subtree.set(el, c);
        if (c === 0 && !el.textContent.trim() &&
            !el.querySelector("img, svg, canvas, video, audio, input, textarea, select")) {
          emptyCount++;
        }
      }
    }

    const duplicateIds = [];
    Object.keys(idMap).forEach(function (id) {
      if (idMap[id] > 1) duplicateIds.push({ id: id, count: idMap[id] });
    });

    const mostRepeated = Object.keys(tagCounts).reduce(function (a, b) {
      return tagCounts[a] > tagCounts[b] ? a : b;
    }, "");

    // ---- Layout container metrics (real counts via memoized depth walks) ----
    const containerDepth = new Map();
    function cDepth(el) {
      if (containerDepth.has(el)) return containerDepth.get(el);
      let d = 0;
      let p = parentOf.get(el);
      while (p && p !== root) {
        if (CONTAINER_TAGS.has(p.tagName.toLowerCase())) { d = cDepth(p) + 1; break; }
        p = parentOf.get(p);
      }
      containerDepth.set(el, d);
      return d;
    }
    let containerCount = 0;
    let nestedContainerCount = 0;
    let maxContainerNesting = 0;
    containerEls.forEach(function (el) {
      const d = cDepth(el);
      containerCount++;
      if (d > 0) nestedContainerCount++;
      if (d > maxContainerNesting) maxContainerNesting = d;
    });

    const majorStructuralElements =
      (tagCounts["main"] || 0) + (tagCounts["header"] || 0) + (tagCounts["footer"] || 0) +
      (tagCounts["nav"] || 0) + (tagCounts["aside"] || 0) + (tagCounts["section"] || 0) +
      (tagCounts["article"] || 0);

    function makeLabel(el) {
      const tag = el.tagName.toLowerCase();
      let label = tag;
      if (el.id) {
        label = tag + "#" + el.id;
      } else if (el.className && typeof el.className === "string") {
        const cls = el.className.split(/\s+/).filter(function (s) { return s; }).slice(0, 2).join(".");
        if (cls) label = tag + "." + cls;
      }
      return label;
    }

    // Real node total for a subtree: walks every node (elements, text,
    // comments) starting at the element itself, capped so a single giant
    // section can never stall the scan. No estimates below the cap.
    function countNodes(el, fallback) {
      try {
        let n = 1;
        const w = document.createTreeWalker(el, NodeFilter.SHOW_ALL);
        let cur = w.nextNode();
        const MAX_NODES = 8000;
        while (cur && n < MAX_NODES) { n++; cur = w.nextNode(); }
        return n;
      } catch (e) {
        return fallback;
      }
    }

    // ================= ELEMENTOR (WordPress page builder) ANALYSIS =================
    let elementor = { detected: false };
    const elementorStructs = [];
    try {
      const qList = document.querySelectorAll(".e-con, .elementor-container, .elementor-section");
      for (let i = 0; i < qList.length; i++) elementorStructs.push(qList[i]);
      const detected =
        elementorStructs.length > 0 ||
        document.querySelector(".elementor") !== null ||
        document.querySelector("[data-elementor-type]") !== null ||
        !!(window.elementorFrontend || window.elementor);
      if (detected) {
        const flexContainers = document.querySelectorAll(".e-con").length;
        const legacySections = document.querySelectorAll(".elementor-section").length;
        const structSet = new Set(elementorStructs);
        const elDepth = new Map();
        function eDepth(el) {
          if (elDepth.has(el)) return elDepth.get(el);
          let d = 0;
          let p = parentOf.get(el);
          let steps = 0;
          while (p && p !== root && steps++ < 4000) {
            if (structSet.has(p)) { d = eDepth(p) + 1; break; }
            p = parentOf.get(p);
          }
          elDepth.set(el, d);
          return d;
        }
        let nestedContainers = 0;
        let maxNesting = 0;
        const roots = [];
        const deep = [];
        const heavy = [];
        for (let i = 0; i < elementorStructs.length; i++) {
          const d = eDepth(elementorStructs[i]);
          if (d > 0) nestedContainers++;
          if (d > maxNesting) maxNesting = d;
          if (d === 0) roots.push(elementorStructs[i]);
          if (d >= 8) deep.push(elementorStructs[i]);
          heavy.push({
            label: makeLabel(elementorStructs[i]),
            elements: (subtree.get(elementorStructs[i]) || 0) + 1,
            nesting: d,
            depth: depthOf.get(elementorStructs[i]) || 0,
            children: elementorStructs[i].children.length
          });
        }
        heavy.sort(function (a, b) { return b.elements - a.elements; });
        let elementCount = 0;
        roots.forEach(function (r) { elementCount += (subtree.get(r) || 0) + 1; });
        if (elementCount > totalElements) elementCount = totalElements;
        const share = totalElements ? Math.round((elementCount / totalElements) * 100) : 0;

        let level = "good";
        let message = "Elementor markup is well balanced for this page.";
        if (elementorStructs.length >= 400 || share >= 70) {
          level = "critical";
          message = "Excessive Elementor container usage \u2014 " + elementorStructs.length + " containers/legacy sections make up ~" + share + "% of the page DOM. This bloats the rendered tree, slows layout, and makes editing harder.";
        } else if (elementorStructs.length >= 180 || share >= 50 || maxNesting >= 8 || deep.length >= 15) {
          level = "warn";
          message = "Elevated Elementor markup \u2014 " + elementorStructs.length + " containers (~" + share + "% of DOM)" + (maxNesting >= 8 ? ", with containers nested up to " + maxNesting + " levels deep" : "") + ". Consider flattening redundant wrappers.";
        } else if (maxNesting >= 6 || (elementorStructs.length >= 100 && deep.length >= 6)) {
          level = "warn";
          message = "Deeply nested Elementor containers (" + maxNesting + " levels) inflate the DOM \u2014 flatten template structures where possible.";
        }

        elementor = {
          detected: true,
          signal: flexContainers > 0 ? "e-con flexbox containers" : "legacy .elementor-section markup",
          containers: elementorStructs.length,
          flexContainers: flexContainers,
          legacySections: legacySections,
          nestedContainers: nestedContainers,
          maxNesting: maxNesting,
          deepContainers: deep.length,
          deepNestingTop: deep.map(makeLabel).slice(0, 5),
          elementCount: elementCount,
          share: share,
          excessive: { level: level, message: message },
          heaviest: heavy.slice(0, 5)
        };
      }
    } catch (err) {}

    // ================= TOP SECTIONS (largest DOM contributors) =================
    // Greedily pick the biggest, non-overlapping subtrees so each entry points
    // at a specific page section instead of page-level wrappers (html/body).
    const hotspots = [];
    const picked = [];
    try {
      const cap = Math.max(120, totalElements * 0.7);
      const all = [];
      subtree.forEach(function (count, el) {
        if (el === root || el === document.body) return;
        if (count >= 4 && count <= cap) all.push({ el: el, count: count, tried: false });
      });
      all.sort(function (a, b) { return b.count - a.count; });

      function pickSections(minCount) {
        for (let i = 0; i < all.length && picked.length < 5; i++) {
          const e = all[i];
          if (e.tried || e.count < minCount) continue;
          let nested = false;
          for (let j = 0; j < picked.length; j++) {
            if (picked[j].contains(e.el) || e.el.contains(picked[j])) { nested = true; break; }
          }
          if (nested) { e.tried = true; continue; }
          picked.push(e.el);
          e.tried = true;
        }
      }
      pickSections(10);
      pickSections(5);
      pickSections(4);

      for (let i = 0; i < picked.length; i++) {
        const el = picked[i];
        const tag = el.tagName.toLowerCase();
        const entryCount = (subtree.get(el) || 0);
        let elementorContainers = 0;
        for (let s = 0; s < elementorStructs.length; s++) {
          if (el.contains(elementorStructs[s])) elementorContainers++;
        }
        const childCount = el.children.length;
        const depth = depthOf.get(el) || 0;
        const nodes = countNodes(el, entryCount + 1);
        const share = Math.round((entryCount / Math.max(1, totalElements)) * 100);

        // What actually fills the subtree: the tag mix plus the most repeated
        // element signature tell us whether the bloat is one duplicated
        // pattern, a page-builder layer cake, or media/product-heavy content.
        const tagMix = {};
        const sigCounts = {};
        const mixStack = [el];
        const MIX_MAX = 4000;
        let mixSeen = 0;
        while (mixStack.length && mixSeen < MIX_MAX) {
          const c = mixStack.pop();
          const kids = c.children;
          for (let mix = 0; mix < kids.length && mixSeen < MIX_MAX; mix++) {
            mixSeen++;
            const k = kids[mix];
            const kt = k.tagName.toLowerCase();
            tagMix[kt] = (tagMix[kt] || 0) + 1;
            let sig = kt;
            if (k.className && typeof k.className === "string") {
              const cls = k.className.split(/\s+/).filter(function (s) { return s; }).join(".");
              if (cls) sig = kt + "." + cls;
            } else if (k.id) {
              sig = kt + "#" + k.id;
            }
            sigCounts[sig] = (sigCounts[sig] || 0) + 1;
            mixStack.push(k);
          }
        }
        const topTags = Object.keys(tagMix)
          .map(function (t) { return { tag: t, count: tagMix[t] }; })
          .sort(function (a, b) { return b.count - a.count; })
          .slice(0, 4);

        // Most repeated element signature inside the section. Classed patterns
        // (e.g. 18x "div.card") are the smoking gun for duplicated card/list
        // markup, so they win over generic <div> repeats.
        let repeated = null;
        {
          let bestClassed = null;
          let bestBare = null;
          Object.keys(sigCounts).forEach(function (sig) {
            const c = sigCounts[sig];
            if (sig.indexOf(".") !== -1 || sig.indexOf("#") !== -1) {
              if (c >= 4 && (!bestClassed || c > bestClassed.count)) bestClassed = { pattern: sig, count: c };
            } else if (c >= 8 && (!bestBare || c > bestBare.count)) {
              bestBare = { pattern: sig, count: c };
            }
          });
          repeated = bestClassed || bestBare;
        }

        let cause;
        if (elementorContainers >= 8) {
          cause = "Contains " + elementorContainers + " Elementor containers stacked inside each other \u2014 each wrapper adds markup layers that inflate the DOM.";
        } else if (repeated && repeated.count >= 8) {
          cause = "Dominated by " + repeated.count + " repeating <" + repeated.pattern + "> elements \u2014 duplicated markup that multiplies the DOM.";
        } else if (depth >= 12) {
          cause = "Very deep nesting (" + depth + " levels) \u2014 every level adds its own wrapper elements.";
        } else if (childCount >= 25) {
          cause = childCount + " direct children, and most children bring their own descendant wrapper markup.";
        } else {
          cause = entryCount + " descendant elements make this the largest subtree in the page DOM.";
        }

        let recommendation;
        if (elementorContainers >= 8) {
          recommendation = "Flatten the stacked Elementor containers and reuse saved templates instead of nesting inner sections \u2014 every wrapper adds markup the browser must render, style, and hold in memory.";
        } else if (repeated && repeated.count >= 8) {
          recommendation = "Render the " + repeated.count + " repeated <" + repeated.pattern + "> blocks from a loop/template instead of duplicating markup, and paginate or virtualize long lists so the DOM stays lean.";
        } else if (depth >= 12) {
          recommendation = "Unwrap redundant intermediate wrappers and rely on CSS Grid or Flexbox \u2014 layout can express deep structures without deep element nesting.";
        } else if (childCount >= 25) {
          recommendation = "Group the " + childCount + " direct children under a real collection (\u003Cul\u003E, \u003Col\u003E, <template>, or a shared component) and delete empty wrapper divs that only add node weight.";
        } else if (topTags.length && (topTags[0].tag === "img" || topTags[0].tag === "iframe")) {
          recommendation = "The section is media-heavy (" + topTags[0].count + " " + (topTags[0].tag === "img" ? "images" : "iframes") + "). Lazy-load below-the-fold media and serve responsively sized files to cut DOM and layout cost.";
        } else {
          recommendation = "Extract this section into a reusable component and remove any empty wrapper elements that only add node weight.";
        }

        const excessive =
          entryCount >= 1500 || share >= 30 ? "critical" :
          entryCount >= 800 || share >= 15 ? "warn" : "good";

        hotspots.push({
          label: makeLabel(el),
          tag: tag,
          count: entryCount,
          share: share,
          depth: depth,
          nodes: nodes,
          childCount: childCount,
          elementorContainers: elementorContainers,
          elementor: elementorContainers > 0,
          cause: cause,
          recommendation: recommendation,
          excessive: excessive,
          topTags: topTags,
          repeated: repeated
        });
      }
      hotspotElements = picked.slice();
      if (elementor.detected) {
        elementor.topSectionIsElementor = !!(hotspots[0] && hotspots[0].elementorContainers > 0);
      }
    } catch (err) {}

    // Count all nodes in the page tree: elements, text nodes, comments, etc.
    // This is the exact live count from the rendered page — never estimated.
    let nodeCount = 0;
    let textNodeCount = 0;
    let commentNodeCount = 0;
    try {
      const walker = document.createTreeWalker(document, NodeFilter.SHOW_ALL);
      let n = walker.nextNode();
      while (n) {
        nodeCount++;
        if (n.nodeType === 3) textNodeCount++;
        else if (n.nodeType === 8) commentNodeCount++;
        n = walker.nextNode();
      }
    } catch (e) {
      nodeCount = totalElements;
    }

    const domStructure = buildDOMTree();

    return {
      totalElements: totalElements,
      totalNodes: nodeCount,
      textNodes: textNodeCount,
      commentNodes: commentNodeCount,
      maxDepth: maxDepth,
      maxChildren: maxChildren,
      deepestElement: deepestElement,
      largestParent: largestParent,
      mostRepeatedElement: mostRepeated,
      divCount: tagCounts["div"] || 0,
      sectionCount: tagCounts["section"] || 0,
      articleCount: tagCounts["article"] || 0,
      headerCount: tagCounts["header"] || 0,
      footerCount: tagCounts["footer"] || 0,
      mainCount: tagCounts["main"] || 0,
      navCount: tagCounts["nav"] || 0,
      formCount: tagCounts["form"] || 0,
      inputCount: (tagCounts["input"] || 0) + (tagCounts["textarea"] || 0) + (tagCounts["select"] || 0),
      buttonCount: tagCounts["button"] || 0,
      linkCount: tagCounts["a"] || 0,
      imageCount: tagCounts["img"] || 0,
      iframeCount: tagCounts["iframe"] || 0,
      scriptCount: tagCounts["script"] || 0,
      styleCount: (tagCounts["style"] || 0) + document.querySelectorAll("link[rel='stylesheet']").length,
      hiddenElements: hiddenSampled ? Math.round(hiddenCount * (totalElements / Math.max(1, processed))) : hiddenCount,
      hiddenElementsSampled: hiddenSampled,
      hiddenSampledFrom: Math.min(processed, totalElements),
      emptyElements: emptyCount,
      inlineStyleCount: inlineStyleCount,
      inlineStyleBytes: inlineStyleBytes,
      duplicateIds: duplicateIds,
      excessiveNestingCount: excessiveNestingCount,
      containerCount: containerCount,
      nestedContainerCount: nestedContainerCount,
      maxContainerNesting: maxContainerNesting,
      majorStructuralElements: majorStructuralElements,
      elementor: elementor,
      domTree: domStructure,
      tagCounts: tagCounts,
      hotspots: hotspots,
      topSection: hotspots[0] || null,
      // Cumulative share of the page DOM held by the top contributing sections
      // — a single number that frames how concentrated (or spread out) the DOM
      // weight is. Also a global verdict for the DOM tab's health banner.
      coverage: (function () {
        let sum = 0;
        hotspots.forEach(function (h) { sum += h.count; });
        return Math.round((sum / Math.max(1, totalElements)) * 100);
      })(),
      verdict: (function () {
        if (totalElements > 3000 || maxContainerNesting >= 12 ||
            (elementor.detected && elementor.maxNesting >= 8)) return "critical";
        if (totalElements > 1500 || maxDepth > 20 || maxContainerNesting >= 8 ||
            (elementor.detected && elementor.maxNesting >= 6 && elementor.containers >= 100)) return "warn";
        return "good";
      })()
    };
  }

  function buildDOMTree() {
    const landmarkTags = ["html", "body", "header", "nav", "main", "section", "article", "aside", "footer"];
    const tree = [];

    function walk(el, depth) {
      if (depth > 6) return;
      const tag = el.tagName.toLowerCase();
      if (landmarkTags.indexOf(tag) !== -1 || (depth < 3 && tag !== "div" && tag !== "span")) {
        tree.push({ tag: tag, depth: depth });
      }
      for (let i = 0; i < el.children.length && tree.length < 30; i++) {
        walk(el.children[i], depth + 1);
      }
    }

    walk(document.documentElement, 0);
    return tree;
  }

  // =============================================
  // PERFORMANCE ANALYZER
  // Reads real browser timing entries (Navigation,
  // Paint, LCP, Layout-Shift, Event-Timing, Resource).
  // Anything the page did not surface is reported as
  // null ("Not available") — never estimated.
  // =============================================
// Returns the qualifying shift entries (spec-filtered, sorted) plus how many
  // were excluded because they were tied to recent user input.
  function collectShifts(entries) {
    const valid = [];
    let inputExcluded = 0;
    if (entries) {
      entries.forEach(function (e) {
        if (!e) return;
        if (e.hadRecentInput) { inputExcluded++; return; }
        if ((e.value || 0) > 0 && e.startTime >= 0) valid.push(e);
      });
    }
    valid.sort(function (a, b) { return a.startTime - b.startTime; });
    return { valid: valid, inputExcluded: inputExcluded };
  }

  // Session-window CLS algorithm from the spec: splits a sorted shift list into
  // windows separated by either a 1s gap or a 5s window length. Returns every
  // window (with event count + largest single shift) so callers can report the
  // worst one, not just the total.
  function sessionWindows(list) {
    const windows = [];
    if (!list || !list.length) return windows;
    const gapLimit = 1000;
    const windowLimit = 5000;
    let winFirst = list[0].startTime;
    let lastTs = list[0].startTime;
    let winSum = list[0].value || 0;
    let winEvents = 1;
    let winLargest = list[0].value || 0;
    for (let i = 1; i < list.length; i++) {
      const ts = list[i].startTime;
      const v = list[i].value || 0;
      if ((ts - lastTs) >= gapLimit || (ts - winFirst) > windowLimit) {
        windows.push({ startTime: winFirst, sum: winSum, events: winEvents, largest: winLargest, endTime: list[i - 1].startTime });
        winFirst = ts;
        winSum = v;
        winEvents = 1;
        winLargest = v;
      } else {
        winSum += v;
        winEvents++;
        if (v > winLargest) winLargest = v;
      }
      lastTs = ts;
    }
    windows.push({ startTime: winFirst, sum: winSum, events: winEvents, largest: winLargest, endTime: list[list.length - 1].startTime });
    return windows;
  }

  function computeCLS(entries) {
    const list = collectShifts(entries).valid;
    if (list.length === 0) return null;
    const windows = sessionWindows(list);
    let maxCls = 0;
windows.forEach(function (w) { if (w.sum > maxCls) maxCls = w.sum; });
    return Math.round(maxCls * 1000) / 1000;
  }

  // Whether the browser actually implements the layout-shift timeline. The
  // supportedEntryTypes list is authoritative; older engines that lack it are
  // only treated as "supported" when real shift entries exist.
  function layoutShiftMetricSupported() {
    try {
      if (window.PerformanceObserver && Array.isArray(PerformanceObserver.supportedEntryTypes)) {
        return PerformanceObserver.supportedEntryTypes.indexOf("layout-shift") !== -1;
      }
      if (typeof performance.getEntriesByType === "function") {
        const list = performance.getEntriesByType("layout-shift");
        return Array.isArray(list) && list.length > 0;
      }
    } catch (e) {}
    return false;
  }

  function analyzePerformance() {
    const perf = performance || {};
    const get = function (type) {
      try {
        if (typeof perf.getEntriesByType !== "function") return [];
        const e = perf.getEntriesByType(type);
        return Array.isArray(e) ? e : [];
      } catch (e) { return []; }
    };

    const nav = get("navigation")[0] || null;
    const resources = get("resource");
    const paint = get("paint");
    const lcpEntries = get("largest-contentful-paint");
    const shiftEntries = get("layout-shift");
    const eventEntries = get("event");

    // ---- Loading timing (Navigation Timing) ----
    let ttfb = null;
    let domContentLoaded = null;
    let loadTime = null;
    if (nav) {
      if (isFinite(nav.responseStart) && isFinite(nav.requestStart) && nav.responseStart >= nav.requestStart) {
        ttfb = Math.round(nav.responseStart - nav.requestStart);
      }
      if (nav.domContentLoadedEventEnd) domContentLoaded = Math.round(nav.domContentLoadedEventEnd - nav.startTime);
      if (nav.loadEventEnd) loadTime = Math.round(nav.loadEventEnd - nav.startTime);
    }

    // ---- Paint (Paint Timing) ----
    let firstPaint = null;
    let firstContentfulPaint = null;
    paint.forEach(function (entry) {
      if (entry.name === "first-paint") firstPaint = Math.round(entry.startTime || 0);
      if (entry.name === "first-contentful-paint") firstContentfulPaint = Math.round(entry.startTime || 0);
    });

    // ---- Largest Contentful Paint (live entry so far) ----
    let largestContentfulPaint = null;
    if (lcpEntries.length) {
      const last = lcpEntries[lcpEntries.length - 1];
      if (last && isFinite(last.startTime)) largestContentfulPaint = Math.round(last.startTime);
    }

    // ---- Cumulative Layout Shift (session-window algorithm) ----
    // Merge the buffered timeline with shifts our live observer recorded, then
    // dedupe by record key (startTime + value): the observer's buffered:true
    // flush mirrors timeline entries exactly once, while two *real* shifts in
    // the same millisecond with different values are both kept.
    const mergedShifts = [];
    {
      const seen = new Set();
      [shiftEntries, liveShiftEntries].forEach(function (list) {
        (list || []).forEach(function (e) {
          if (!e) return;
          const key = e.startTime + "|" + (e.value || 0);
          if (!seen.has(key)) { seen.add(key); mergedShifts.push(e); }
        });
      });
    }
    let cumulativeLayoutShift = computeCLS(mergedShifts);
    if (cumulativeLayoutShift === null && layoutShiftMetricSupported()) {
      // The browser exposes layout-shift and recorded no shifts (or only
      // input-shifts, which spec CLS excludes) — the true value is 0, not
      // "unknown". Only truly unsupported browsers get the Not-available state.
      cumulativeLayoutShift = 0;
    }

    // ---- Interaction to Next Paint: worst interaction from Event Timing ----
    let interactionToNextPaint = null;
    if (eventEntries.length) {
      let worst = 0;
      eventEntries.forEach(function (entry) {
        if (entry.interactionId && isFinite(entry.duration) && entry.duration > 0 && entry.duration > worst) {
          worst = entry.duration;
        }
      });
      if (worst > 0) interactionToNextPaint = Math.round(worst);
    }

    // ---- Network / resource aggregation (Resource Timing) ----
    const types = {
      script: { count: 0, bytes: 0 },
      css: { count: 0, bytes: 0 },
      img: { count: 0, bytes: 0 },
      font: { count: 0, bytes: 0 },
      iframe: { count: 0, bytes: 0 },
      media: { count: 0, bytes: 0 },
      xhr: { count: 0, bytes: 0 },
      other: { count: 0, bytes: 0 }
    };
    let thirdPartyCount = 0;
    const currentHost = location.hostname;
    const large = [];

    resources.forEach(function (res) {
      const initiator = String(res.initiatorType || "").toLowerCase();
      let group;
      if (initiator === "script") group = "script";
      else if (initiator === "css" || initiator === "link") group = "css";
      else if (initiator === "img") group = "img";
      else if (initiator === "font") group = "font";
      else if (initiator === "iframe") group = "iframe";
      else if (initiator === "media") group = "media";
      else if (initiator === "xmlhttprequest" || initiator === "fetch") group = "xhr";
      else group = "other";
      types[group].count++;
      types[group].bytes += res.transferSize || 0;

      try {
        const u = new URL(res.name);
        if (u.hostname !== currentHost) thirdPartyCount++;
      } catch (e) {}

      if ((res.transferSize || 0) > 200000) {
        large.push({
          name: res.name.split("/").pop().split("?")[0] || res.name.substring(0, 60),
          bytes: res.transferSize || 0,
          type: group
        });
      }
    });
    large.sort(function (a, b) { return b.bytes - a.bytes; });

    const documentBytes = nav ? (nav.transferSize || 0) : 0;
    let resourceBytes = 0;
    Object.keys(types).forEach(function (key) { resourceBytes += types[key].bytes; });
    const totalTransferredBytes = documentBytes + resourceBytes;

    // ---- Script bloat from the live DOM (independent of Resource Timing) ----
    let scriptTagCount = 0;
    let externalScriptCount = 0;
    let inlineScriptCount = 0;
    let inlineScriptBytes = 0;
    try {
      const scriptTags = document.querySelectorAll("script");
      scriptTagCount = scriptTags.length;
      scriptTags.forEach(function (s) {
        if (s.getAttribute && s.getAttribute("src")) externalScriptCount++;
        else {
          inlineScriptCount++;
          inlineScriptBytes += (s.textContent || "").length;
        }
      });
    } catch (e) {}

    const ms = function (v) { return v / 1000; };
    const fmtBytes = function (b) { return formatBytes(b || 0); };

    // ---- Major performance issues (only from measured values) ----
    const issues = [];
    if (largestContentfulPaint !== null && largestContentfulPaint > 2500) {
      issues.push({
        level: largestContentfulPaint > 4000 ? "critical" : "warning",
        title: "Slow Largest Contentful Paint",
        desc: "LCP is " + ms(largestContentfulPaint).toFixed(2) + "s \u2014 above the 2.5s \u201Cgood\u201D threshold.",
        rec: "Optimise the main content image/video, reduce render-blocking CSS & JS, and preload the hero element."
      });
    }
    if (interactionToNextPaint !== null && interactionToNextPaint > 200) {
      issues.push({
        level: interactionToNextPaint > 500 ? "critical" : "warning",
        title: "Sluggish interactions (INP)",
        desc: "Worst measured interaction took " + interactionToNextPaint + "ms \u2014 above the 200ms threshold.",
        rec: "Break up long main-thread tasks, defer non-critical work, and keep event handlers lightweight."
      });
    }
    if (cumulativeLayoutShift !== null && cumulativeLayoutShift > 0.1) {
      issues.push({
        level: cumulativeLayoutShift > 0.25 ? "critical" : "warning",
        title: "Layout shift (CLS)",
        desc: "CLS is " + cumulativeLayoutShift + " \u2014 above the 0.1 \u201Cgood\u201D threshold.",
        rec: "Reserve space for images/ads/embeds and avoid injecting content above settled positions."
      });
    }
    if (ttfb !== null && ttfb > 800) {
      issues.push({
        level: ttfb > 1800 ? "critical" : "warning",
        title: "Slow server response (TTFB)",
        desc: "TTFB is " + ttfb + "ms \u2014 above the 800ms \u201Cgood\u201D threshold.",
        rec: "Use a CDN, caching, and remove server-side bottlenecks / re-crawl-generating work on first paint."
      });
    }
    if (firstContentfulPaint !== null && firstContentfulPaint > 1800) {
      issues.push({
        level: firstContentfulPaint > 3000 ? "critical" : "warning",
        title: "Slow First Contentful Paint",
        desc: "FCP is " + ms(firstContentfulPaint).toFixed(2) + "s \u2014 above the 1.8s \u201Cgood\u201D threshold.",
        rec: "Reduce render-blocking styles and scripts, and inline critical CSS."
      });
    }
    if (loadTime !== null && loadTime > 3000) {
      issues.push({
        level: loadTime > 5000 ? "critical" : "warning",
        title: "Slow page load",
        desc: "Measured load time is " + ms(loadTime).toFixed(1) + "s.",
        rec: "Trim unused JavaScript, lazy-load below-the-fold media, and enable compression/caching."
      });
    }
    if (types.script.bytes > 600 * 1024) {
      issues.push({
        level: types.script.bytes > 1024 * 1024 ? "critical" : "warning",
        title: "Large JavaScript payload",
        desc: types.script.count.toLocaleString() + " scripts download " + fmtBytes(types.script.bytes) + " \u2014 more than ~600KB transferred.",
        rec: "Code-split bundles, drop unused libraries, and serve modern minified builds."
      });
    }
    if (types.img.bytes > 2 * 1024 * 1024) {
      issues.push({
        level: "warning",
        title: "Heavy image payload",
        desc: "Images transfer " + fmtBytes(types.img.bytes) + " \u2014 more than ~2MB.",
        rec: "Serve responsive, compressed images (AVIF/WebP) and lazy-load off-screen media."
      });
    }
    if (resources.length > 100) {
      issues.push({
        level: resources.length > 150 ? "critical" : "warning",
        title: "High request count",
        desc: resources.length + " network requests were made.",
        rec: "Consolidate assets and remove unnecessary third-party scripts to cut HTTP requests."
      });
    }
    if (thirdPartyCount > 20) {
      issues.push({
        level: "warning",
        title: "Many third-party resources",
        desc: thirdPartyCount + " cross-origin requests detected.",
        rec: "Audit third-party scripts/iframes and keep only ones that are essential."
      });
    }

    return {
      // Timing
      ttfb: ttfb,
      domContentLoaded: domContentLoaded,
      loadTime: loadTime,
      firstPaint: firstPaint,
      firstContentfulPaint: firstContentfulPaint,
      largestContentfulPaint: largestContentfulPaint,
      cumulativeLayoutShift: cumulativeLayoutShift,
      interactionToNextPaint: interactionToNextPaint,
      // Counts
      resourceCount: resources.length,
      jsCount: types.script.count,
      cssCount: types.css.count,
      imageCount: types.img.count,
      fontCount: types.font.count,
      iframeCount: types.iframe.count,
      mediaCount: types.media.count,
      xhrCount: types.xhr.count,
      otherCount: types.other.count,
      // Script tags
      scriptTagCount: scriptTagCount,
      externalScriptCount: externalScriptCount,
      inlineScriptCount: inlineScriptCount,
      inlineScriptBytes: inlineScriptBytes,
      // Sizes
      totalTransferred: formatBytes(totalTransferredBytes),
      totalTransferredBytes: totalTransferredBytes,
      documentBytes: documentBytes,
      resourceBytes: resourceBytes,
      jsBytes: types.script.bytes,
      cssBytes: types.css.bytes,
      imageBytes: types.img.bytes,
      fontBytes: types.font.bytes,
      mediaBytes: types.media.bytes,
      xhrBytes: types.xhr.bytes,
      otherBytes: types.other.bytes,
      // Quality
      thirdPartyCount: thirdPartyCount,
      largeResources: large.slice(0, 5),
      issues: issues
    };
  }

  // =============================================
  // SEO ANALYZER
  // =============================================
  function analyzeSEO() {
    const title = document.title || "";
    const titleLength = title.trim().length;

    const metaDesc = document.querySelector('meta[name="description"]');
    const description = metaDesc ? metaDesc.getAttribute("content") || "" : "";
    const descLength = description.trim().length;

    const canonicals = document.querySelectorAll('link[rel="canonical"]');
    const canonical = canonicals.length > 0 ? canonicals[0].getAttribute("href") : null;

    const metaRobots = document.querySelector('meta[name="robots"]');
    const robotsContent = metaRobots ? metaRobots.getAttribute("content") || "" : "";

    const ogTitle = document.querySelector('meta[property="og:title"]');
    const ogDescription = document.querySelector('meta[property="og:description"]');
    const ogImage = document.querySelector('meta[property="og:image"]');
    const ogUrl = document.querySelector('meta[property="og:url"]');

    const jsonLd = document.querySelectorAll('script[type="application/ld+json"]');
    const microdata = document.querySelectorAll("[itemscope]");

    return {
      title: title,
      titleLength: titleLength,
      hasTitle: titleLength > 0,
      titleOk: titleLength >= 30 && titleLength <= 60,
      description: description.substring(0, 160),
      descriptionLength: descLength,
      hasDescription: descLength > 0,
      descriptionOk: descLength >= 120 && descLength <= 160,
      canonical: canonical,
      hasCanonical: !!canonical,
      multipleCanonicals: canonicals.length > 1,
      robotsContent: robotsContent,
      hasNoindex: robotsContent.toLowerCase().indexOf("noindex") !== -1,
      hasNofollow: robotsContent.toLowerCase().indexOf("nofollow") !== -1,
      ogTitle: ogTitle ? ogTitle.getAttribute("content") : null,
      ogDescription: ogDescription ? ogDescription.getAttribute("content") : null,
      ogImage: ogImage ? ogImage.getAttribute("content") : null,
      ogUrl: ogUrl ? ogUrl.getAttribute("content") : null,
      hasOgTitle: !!ogTitle,
      hasOgDescription: !!ogDescription,
      hasOgImage: !!ogImage,
      hasOgUrl: !!ogUrl,
      jsonLdCount: jsonLd.length,
      microdataCount: microdata.length,
      hasStructuredData: jsonLd.length > 0 || microdata.length > 0
    };
  }

  // =============================================
  // HEADING HIERARCHY ANALYZER
  // =============================================
  function analyzeHeadings(byTag) {
    // Collected in true document order (one query for all heading levels), so
    // counts, skipped-level detection and the heading tree reflect the real
    // visual structure of the page instead of level-grouped order.
    const els = document.querySelectorAll("h1, h2, h3, h4, h5, h6");
    const headings = [];
    const counts = { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 };
    const issues = [];

    const level = function (el) { return parseInt(el.tagName.charAt(1), 10); };

    els.forEach(function (el) {
      const lv = level(el);
      counts["h" + lv]++;
      headings.push({ level: lv, text: el.textContent.trim().substring(0, 80), empty: !el.textContent.trim() });
    });

    if (counts.h1 === 0) issues.push("Missing H1 heading");
    if (counts.h1 > 1) issues.push("Multiple H1 headings found (" + counts.h1 + ")");

    const emptyHeadings = headings.filter(function (h) { return h.empty; });
    if (emptyHeadings.length > 0) issues.push(emptyHeadings.length + " empty heading(s) found");

    // Check for skipped levels in real document order
    let prevLevel = 0;
    let skippedLevels = false;
    headings.forEach(function (h) {
      if (prevLevel > 0 && h.level > prevLevel + 1) {
        skippedLevels = true;
        issues.push("Heading level jumps from H" + prevLevel + " to H" + h.level);
      }
      prevLevel = h.level;
    });

    const tree = buildHeadingTree(headings);

    return {
      counts: counts,
      headings: headings,
      tree: tree,
      issues: issues,
      hasH1: counts.h1 > 0,
      singleH1: counts.h1 === 1,
      skippedLevels: skippedLevels,
      totalHeadings: headings.length
    };
  }

  function buildHeadingTree(headings) {
    const tree = [];
    const stack = [];
    headings.forEach(function (h) {
      const node = { level: h.level, text: h.text, children: [] };
      while (stack.length > 0 && stack[stack.length - 1].level >= h.level) {
        stack.pop();
      }
      if (stack.length > 0) {
        stack[stack.length - 1].children.push(node);
      } else {
        tree.push(node);
      }
      stack.push(node);
    });
    return tree;
  }

  // =============================================
  // WEBSITE STRUCTURE ANALYZER
  // =============================================
  function analyzeStructure(byTag) {
    const tag = function (t) { return (byTag && byTag[t]) || []; };
    const hasLinks = function () {
      const l = tag("a");
      for (let i = 0; i < l.length; i++) { if (l[i].hasAttribute("href")) return true; }
      return false;
    };
    const hasVideos = function () {
      if (tag("video").length) return true;
      const f = tag("iframe");
      for (let i = 0; i < f.length; i++) {
        const src = f[i].getAttribute("src") || "";
        if (src.indexOf("youtube") !== -1 || src.indexOf("vimeo") !== -1) return true;
      }
      return false;
    };
    const hasButtons = function () {
      let c = tag("button").length;
      const ins = tag("input");
      for (let i = 0; i < ins.length; i++) {
        const t = ins[i].getAttribute("type");
        if (t === "submit" || t === "button") c++;
      }
      return c > 0;
    };

    return {
      hasHeader: tag("header").length > 0,
      hasNav: tag("nav").length > 0,
      hasMain: tag("main").length > 0,
      hasSections: tag("section").length,
      hasArticles: tag("article").length,
      hasAside: tag("aside").length > 0,
      hasFooter: tag("footer").length > 0,
      hasForms: tag("form").length > 0,
      hasSearch: document.querySelector('[role="search"], [type="search"], form[role="search"]') !== null,
      hasBreadcrumbs: document.querySelector('[aria-label*="breadcrumb"], nav.breadcrumb, .breadcrumb, [class*="breadcrumb"]') !== null,
      hasTables: tag("table").length,
      hasLists: tag("ul").length + tag("ol").length,
      hasButtons: hasButtons(),
      hasLinks: hasLinks(),
      hasImages: tag("img").length > 0,
      hasVideos: hasVideos(),
      hasIframes: tag("iframe").length > 0,
      htmlLang: document.documentElement.getAttribute("lang") || ""
    };
  }

  // =============================================
  // TECHNOLOGY DETECTOR
  // =============================================
  // Serializing an entire page (documentElement.outerHTML) to match vendor
  // markers can clone megabytes of markup on huge DOMs. Every marker this
  // detector cares about — builder/CMS/framework class names, CDN hosts,
  // script paths — lives in an attribute value, so walk the tree and scan
  // attributes only. Bounded, so detection stays honest on giant pages.
  function technologyMarkers() {
    const CAP = 4000000;
    let out = "";
    let used = 0;
    const stack = [document.documentElement];
    while (stack.length && used < CAP) {
      const el = stack.pop();
      let attrs = "";
      try {
        const at = el.attributes;
        if (at && at.length) {
          for (let i = 0; i < at.length && used < CAP; i++) {
            attrs += at[i].name + "=" + at[i].value + " ";
            used += (at[i].value || "").length;
          }
        }
      } catch (e) {}
      if (attrs) {
        out += attrs;
        if (out.length >= CAP) break;
      }
      const kids = (el && el.children) || [];
      for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
    }
    return out.toLowerCase();
  }

  function detectTechnology(globals) {
    globals = globals || {};
    const detected = [];
    const seen = {};

    // ---- One bounded, normalized haystack of everything that can fingerprint a technology ----
    const htmlLower = technologyMarkers();
    const genEl = document.querySelector('meta[name="generator"]');
    const generatorMeta = genEl ? (genEl.getAttribute("content") || "").toLowerCase() : "";

    const scriptSrcs = [];
    const linkHrefs = [];
    const metaContents = [];
    try {
      document.querySelectorAll("script[src]").forEach(function (s) { scriptSrcs.push((s.getAttribute("src") || "").toLowerCase()); });
    } catch (e) {}
    try {
      document.querySelectorAll("link[href]").forEach(function (l) {
        const h = (l.getAttribute("href") || "").toLowerCase();
        if (h.indexOf("data:") !== 0 && h.indexOf("javascript:") !== 0 && h.indexOf("#") !== 0) linkHrefs.push(h);
      });
    } catch (e) {}
    try {
      document.querySelectorAll("meta[content]").forEach(function (m) {
        const c = (m.getAttribute("content") || "").toLowerCase();
        if (c && c.length < 320 && metaContents.length < 80) metaContents.push(c);
      });
    } catch (e) {}
    // Bounded inline-script scan: catches framework seed data and runtime markers
    // that never appear in src attributes (NEXT_DATA, boot loader code, etc.).
    let inline = "";
    let inlineUsed = 0;
    try {
      const scripts = document.querySelectorAll("script:not([src])");
      for (let i = 0; i < scripts.length && inlineUsed < 160000; i++) {
        const txt = (scripts[i].textContent || "");
        const take = txt.length > 24000 ? txt.slice(0, 24000) : txt;
        inline += take + " ";
        inlineUsed += take.length;
      }
    } catch (e) {}

    const srcs = scriptSrcs.join(" ");
    const links = linkHrefs.join(" ");
    const hay = (htmlLower + " " + srcs + " " + links + " " + metaContents.join(" ") + " " + inline + " " + generatorMeta).toLowerCase();
    const HOST = (location.hostname || location.host || "").toLowerCase();

    const esc = function (t) { return t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); };
    const mk = function (tokens) { return new RegExp(tokens.map(esc).join("|"), "i"); };
    const any = function (re) { try { return re.test(hay); } catch (e) { return false; } };
    const has = function (sel) { try { return document.querySelector(sel) !== null; } catch (e) { return false; } };

    function addTech(name, category, confidence, evidence) {
      if (seen[name]) return;
      seen[name] = true;
      detected.push({ name: name, category: category, confidence: confidence, evidence: evidence });
    }

    // Signature table: every pattern is matched against the whole haystack once
    // (compiled alternations), so hundreds of signatures cost one scan each.
    const RX = {
      wordpress: mk(["wp-content/", "wp-includes/", "wp-json", "wp-embed", "wp-admin/", "wordpress"]),
      shopify: mk(["cdn.shopify.com", "cdn.shopifycloud.com"]),
      bigcommerce: mk(["cdn11.bigcommerce.com", "cdn.bigcommerce.com"]),
      wix: mk(["static.parastorage.com", "wixstatic.com", "/_api/wix"]),
      squarespace: mk(["static1.squarespace.com"]),
      webflow: mk(["assets.website-files.com"]),
      ghost: mk(["ghost.org", "ghost.min.js"]),
      sitecore: mk(["sitecore", "__sc_", "sitecoreclt."]),
      contentful: mk(["cdn.contentful.com", "contentful/"]),
      sanity: mk(["sanity.io", "@sanity/", "sanity.min"]),
      strapi: mk(["strapi"]),
      opencart: mk(["opencart", "route=checkout/cart"]),
      nop: mk(["nopcommerce"]),
      beaver: mk(["bb-plugin", "fl-builder.min", "fl-builder.js"]),
      oxygen: mk(["oxygen", "oxy-"]),
      brizy: mk(["data-brz"]),
      wpforms: mk(["wpforms.min", "wpforms-"]),
      cf7: mk(["contact-form-7"]),
      wpRocket: mk(["wp-rocket.min", "rocket-loader.min"]),
      w3tc: mk(["w3tc", "w3-total-cache"]),
      autoptimize: mk(["autoptimize"]),
      jetpack: mk(["jetpack"]),
      litespeed: mk(["litespeed-cache", "litespeed"]),
      yoast: mk(["yoast-seo", "web-stories/inc", "yoast.com/seo"]),
      rankmath: mk(["rankmath"]),
      aioseo: mk(["all in one seo", "aioseo"]),
      next: mk(["_next/static", "/_next/webpack-hmr", "next/dist/client"]),
      react: mk(["react-dom", "react.production", "react.development", "react@"]),
      vue: mk(["vue.min", "vue.global", "/vue.js"]),
      nuxt: mk(["/_nuxt/", "__nuxt"]),
      angular: mk(["angular.min", "@angular/"]),
      svelte: mk(["svelte.min", "svelte/internal"]),
      sveltekit: mk(["__sveltekit", "@sveltejs/kit"]),
      astro: mk(["astro/"]),
      gatsby: mk(["gatsby"]),
      remix: mk(["__remix", "remix.run"]),
      preact: mk(["preact"]),
      alpine: mk(["alpinejs", "alpine.min"]),
      htmx: mk(["htmx.org", "htmx.min"]),
      lit: mk(["lit-html", "lit-element", "@lit/"]),
      ember: mk(["ember.min", "ember.js"]),
      backbone: mk(["backbone.min", "backbone.js"]),
      qwik: mk(["@builder.io/qwik"]),
      turbolinks: mk(["turbolinks"]),
      stimulus: mk(["@hotwired/stimulus", "stimulus.min"]),
      bootstrap: mk(["bootstrap@", "bootstrap.min", "bootstrap.bundle", "getbootstrap", "maxcdn.bootstrapcdn.com/bootstrap", "cdn.jsdelivr.net/npm/bootstrap"]),
      tailwind: mk(["cdn.tailwindcss.com", "tailwindcss", "tailwind.config"]),
      foundation: mk(["foundation.min", "foundation.zurb"]),
      bulma: mk(["bulma"]),
      uikit: mk(["uikit.min", "cdn.jsdelivr.net/npm/uikit"]),
      materialize: mk(["materialize.min", "materialize-"]),
      semantic: mk(["semantic.min", "semantic-ui"]),
      antd: mk(["antd.min", "ant-design"]),
      mui: mk(["@mui/", "material-ui"]),
      chakra: mk(["chakra-ui"]),
      mantine: mk(["@mantine"]),
      fontAwesome: mk(["font-awesome", "fontawesome", "fa-solid.min", "font-awesome@"]),
      bootstrapIcons: mk(["bootstrap-icons"]),
      materialIcons: mk(["material-icons"]),
      jquery: mk(["jquery"]),
      jqueryUi: mk(["jquery-ui"]),
      jqueryMigrate: mk(["jquery-migrate"]),
      lodash: mk(["lodash.min", "lodash.js"]),
      underscore: mk(["underscore.min", "underscore.js"]),
      moment: mk(["moment.min", "moment.js"]),
      dayjs: mk(["dayjs"]),
      axios: mk(["axios.min", "/axios@"]),
      gsap: mk(["gsap.min", "greensock", "gsap/"]),
      three: mk(["three.min.js", "three.module"]),
      d3: mk(["d3.v", "d3.min.js"]),
      chartjs: mk(["chart.min.js", "chart.umd"]),
      apexcharts: mk(["apexcharts"]),
      highcharts: mk(["highcharts"]),
      leaflet: mk(["leaflet"]),
      mapbox: mk(["api.mapbox.com", "mapbox-gl"]),
      swiper: mk(["swiper"]),
      slick: mk(["slick.min", "slick-carousel"]),
      owl: mk(["owl.carousel", "owlcarousel"]),
      isotope: mk(["isotope"]),
      masonry: mk(["masonry.min", "masonry-layout"]),
      tinymce: mk(["tinymce"]),
      ckeditor: mk(["ckeditor"]),
      quill: mk(["quill.min"]),
      fancybox: mk(["fancybox", "fancyapps"]),
      lightbox: mk(["lightbox.min"]),
      aos: mk(["aos/dist", "aos.min"]),
      particles: mk(["particles.min", "particles.js"]),
      typed: mk(["typed.min"]),
      clipboard: mk(["clipboard.min", "clipboardjs"]),
      lazysizes: mk(["lazysizes.min"]),
      hammer: mk(["hammer.min"]),
      anime: mk(["anime.min"]),
      ganalytics: mk(["google-analytics.com/analytics.js", "googletagmanager.com/gtag/js", "gtag(", "ga('", "analytics.js"]),
      gtm: mk(["googletagmanager.com/gtm.js", "gtm.start"]),
      metaPixel: mk(["connect.facebook.net/fbevents.js", "fbevents.js"]),
      clarity: mk(["clarity.ms"]),
      hotjar: mk(["static.hotjar.com"]),
      mixpanel: mk(["cdn.mxpnl.com", "mixpanel.min"]),
      amplitude: mk(["cdn.amplitude.com", "amplitude.min"]),
      segment: mk(["cdn.segment.com", "segment.min"]),
      posthog: mk(["posthog"]),
      matomo: mk(["matomo", "piwik"]),
      plausible: mk(["plausible.io"]),
      fathom: mk(["usefathom.com", "cdn.usefathom.com"]),
      heap: mk(["heapanalytics.com"]),
      yandex: mk(["mc.yandex.ru", "yandexmetrica"]),
      intercom: mk(["intercom"]),
      drift: mk(["js.driftt.com"]),
      crisp: mk(["crisp.chat", "client.crisp"]),
      tawk: mk(["tawk.to"]),
      zendesk: mk(["static.zdassets.com"]),
      livechat: mk(["livechatinc.com", "__lc."]),
      mailchimp: mk(["list-manage.com"]),
      klaviyo: mk(["klaviyo.com", "klaviyo.js"]),
      convertkit: mk(["convertkit.com"]),
      trustpilot: mk(["trustpilot"]),
      gorgias: mk(["gorgias.chat"]),
      cookieyes: mk(["cookieyes.com"]),
      onetrust: mk(["onetrust", "cdn.cookielaw.org"]),
      cookiebot: mk(["cookiebot.com"]),
      recaptcha: mk(["google.com/recaptcha", "recaptcha/api"]),
      hcaptcha: mk(["hcaptcha"]),
      googleFonts: mk(["fonts.googleapis.com", "fonts.gstatic.com"]),
      adobeFonts: mk(["use.typekit.net", "p.typekit.net"]),
      vercel: mk(["vercel-analytics", "/_vercel/", "vercel.live"]),
      netlify: mk(["/.netlify/", "netlify"]),
      cloudflare: mk(["cdnjs.cloudflare.com", "challenges.cloudflare.com", "rocket-loader.min.js", "_cfuvid", "_cfx"]),
      jsdelivr: mk(["cdn.jsdelivr.net"]),
      unpkg: mk(["unpkg.com"]),
      cdnjs: mk(["cdnjs.cloudflare.com"]),
      aws: mk(["s3.amazonaws.com", "amazonaws.com", "cloudfront.net", "cloudfront."]),
      firebase: mk(["firebaseapp.com", ".web.app"]),
      heroku: mk(["herokuapp.com"]),
      amplify: mk(["amplifyapp.com"]),
      azureStatic: mk(["azurestaticapps.net", "blob.core.windows.net"]),
      render: mk(["onrender.com"]),
      railway: mk(["up.railway.app"]),
      surge: mk([".surge.sh"]),
      weebly: mk(["weebly.com", "weeblystatic"]),
      jimdo: mk(["jimdo.com", "jimstatic."]),
      tilda: mk(["tilda.ws", "tilda.cc"]),
      unbounce: mk(["unbounce.com", "builderx"]),
      strikingly: mk(["strikinglycdn.com"]),
      site123: mk(["site123.me", "s123cdn.com"])
    };

    // ---------------- CMS / Website Builders ----------------
    if (htmlLower.indexOf("wp-content") !== -1 || htmlLower.indexOf("wp-includes") !== -1 || generatorMeta.indexOf("wordpress") !== -1) {
      addTech("WordPress", "CMS", "High", "wp-content paths or WP generator meta");
    }

    if (globals.Shopify || htmlLower.indexOf("cdn.shopify.com") !== -1) {
      addTech("Shopify", "E-commerce", "High", "Shopify globals or CDN assets");
    }

    if (htmlLower.indexOf("bigcommerce") !== -1 || htmlLower.indexOf("cdn11.bigcommerce") !== -1) {
      addTech("BigCommerce", "E-commerce", "High", "BigCommerce markers or CDN assets");
    }

    // Wix
    if (srcs.indexOf("static.parastorage.com") !== -1 || srcs.indexOf("wixstatic.com") !== -1 ||
        has("#SITE_ROOT") || htmlLower.indexOf("wix.com") !== -1) {
      addTech("Wix", "Website Builder", "High", "Wix CDN assets or SITE_ROOT container");
    }

    // Squarespace
    if (srcs.indexOf("static1.squarespace.com") !== -1 || has("#siteWrapper") || has(".sqs-block") ||
        htmlLower.indexOf("squarespace") !== -1) {
      addTech("Squarespace", "Website Builder", "High", "Squarespace CDN, siteWrapper or sqs classes");
    }

    // Webflow (precise: website-files CDN, data-wf attributes, webflow root)
    if (srcs.indexOf("assets.website-files.com") !== -1 || has("[data-wf-page]") || has("[data-wf-domain]") ||
        has("#webflow-root") || htmlLower.indexOf("webflow") !== -1) {
      addTech("Webflow", "Website Builder", "High", "Webflow CDN assets or data-wf attributes");
    }

    if (generatorMeta.indexOf("drupal") !== -1 || htmlLower.indexOf("drupal") !== -1) {
      addTech("Drupal", "CMS", "High", "Drupal generator meta or markers");
    }
    if (generatorMeta.indexOf("joomla") !== -1 || htmlLower.indexOf("joomla") !== -1) {
      addTech("Joomla", "CMS", "High", "Joomla generator meta or markers");
    }
    if (generatorMeta.indexOf("ghost") !== -1 || srcs.indexOf("ghost.org") !== -1) {
      addTech("Ghost", "CMS", "High", "Ghost generator meta or Ghost CDN");
    }

    // ---------------- WordPress Ecosystem ----------------
    if (htmlLower.indexOf("elementor") !== -1 || has("[data-elementor-type]") || has(".elementor-section")) {
      const isPro = htmlLower.indexOf("elementor-pro") !== -1 || has("[class*=\"elementor-pro\"]");
      addTech(isPro ? "Elementor Pro" : "Elementor", "Page Builder", "High", "Elementor markup detected");
    }
    if (htmlLower.indexOf("et_pb") !== -1 || has("#et-boc") || has(".et_pb_section")) {
      addTech("Divi", "Page Builder", "High", "Divi / ET builder markup detected");
    }
    if (htmlLower.indexOf("wpb_") !== -1 || htmlLower.indexOf("vc_row") !== -1 ||
        srcs.indexOf("js_composer") !== -1 || has(".wpb_wrapper")) {
      addTech("WPBakery", "Page Builder", "High", "WPBakery / Visual Composer markup detected");
    }
    if (has(".wp-block")) {
      addTech("Gutenberg", "Editor", "Medium", "Gutenberg block classes detected");
    }
    if (htmlLower.indexOf("woocommerce") !== -1 || htmlLower.indexOf("wc-block-grid") !== -1 ||
      (globals && globals.woocommerce) || has(".woocommerce, .wc-block, [class*='wc-block']")) {
      addTech("WooCommerce", "E-commerce", "High", "WooCommerce markers detected (product/checkout classes or scripts)");
    }

    // ---------------- JavaScript Frameworks ----------------
    if (has("#__next") || htmlLower.indexOf("_next/static") !== -1 || globals.NextData) {
      addTech("Next.js", "Framework", "High", "__next container, _next assets or __NEXT_DATA__");
    }
    if (globals.React || has("[data-reactroot]") || has("[data-reactid]")) {
      addTech("React", "Framework", "Medium", "React fiber markers or root attributes");
    }
    if (globals.Vue || has("[data-v-]")) {
      addTech("Vue", "Framework", "Medium", "Vue globals or scoped attribute markers");
    }
    if (has("#__nuxt") || globals.Nuxt) {
      addTech("Nuxt", "Framework", "High", "__nuxt container or __NUXT__ state");
    }
    if (has("[ng-version]") || has("[ng-app]") || has("[_nghost]") || globals.Angular) {
      addTech("Angular", "Framework", "High", "Angular attributes or global detected");
    }
    if (has("[class*=\"svelte-\"]")) {
      addTech("Svelte", "Framework", "Medium", "Svelte scoped class markers");
    }
    if (has("[class*=\"astro-\"]")) {
      addTech("Astro", "Framework", "Medium", "Astro scoped class markers");
    }
    if (htmlLower.indexOf("__gatsby") !== -1 || has("#gatsby-focus-wrapper") || srcs.indexOf("gatsby") !== -1) {
      addTech("Gatsby", "Framework", "Medium", "Gatsby runtime markers detected");
    }
    if (has("[data-remix-root]") || htmlLower.indexOf("__remix") !== -1 || htmlLower.indexOf("remix.run") !== -1) {
      addTech("Remix", "Framework", "Medium", "Remix runtime markers detected");
    }

    // Extra frameworks
    if (any(RX.preact)) {
      addTech("Preact", "Framework", "Medium", "Preact runtime detected");
    }
    if (any(RX.alpine) || has("[x-data]")) {
      addTech("Alpine.js", "Framework", "Medium", "Alpine directives or scripts detected");
    }
    if (any(RX.htmx) || has("[hx-get], [hx-post], [hx-target]")) {
      addTech("HTMX", "Framework", "Medium", "htmx runtime or attributes detected");
    }
    if (has("#__sveltekit") || any(RX.sveltekit)) {
      addTech("SvelteKit", "Framework", "Medium", "SvelteKit runtime markers detected");
    }
    if (any(RX.lit)) addTech("Lit", "Framework", "Medium", "Lit render code detected");
    if (any(RX.ember)) addTech("Ember", "Framework", "Medium", "Ember runtime detected");
    if (any(RX.backbone)) addTech("Backbone.js", "Framework", "Medium", "Backbone runtime detected");
    if (any(RX.qwik)) addTech("Qwik", "Framework", "Medium", "Qwik runtime detected");
    if (any(RX.turbolinks)) addTech("Turbo (Hotwire)", "Framework", "Medium", "Turbolinks runtime detected");
    if (any(RX.stimulus)) addTech("Stimulus (Hotwire)", "Framework", "Medium", "Stimulus runtime detected");

    // ---------------- CSS frameworks & UI libraries ----------------
    if (any(RX.bootstrap) || has("[data-bs-toggle], [data-bs-dismiss], [data-bs-target], [data-bs-spy]")) {
      addTech("Bootstrap", "CSS Framework", any(RX.bootstrap) ? "High" : "Medium", "Bootstrap assets or data-bs attributes");
    }
    if (any(RX.tailwind) || has("script[src*=\"tailwindcss\"]")) {
      addTech("Tailwind CSS", "CSS Framework", "High", "Tailwind assets or runtime detected");
    }
    if (any(RX.foundation)) addTech("Foundation", "CSS Framework", "Medium", "Foundation CSS detected");
    if (any(RX.bulma)) addTech("Bulma", "CSS Framework", "Medium", "Bulma CSS detected");
    if (any(RX.uikit)) addTech("UIkit", "CSS Framework", "Medium", "UIkit CSS detected");
    if (any(RX.materialize)) addTech("Materialize", "CSS Framework", "Medium", "Materialize CSS detected");
    if (any(RX.semantic)) addTech("Semantic UI", "CSS Framework", "Medium", "Semantic UI detected");
    if (any(RX.antd)) addTech("Ant Design", "Library", "Medium", "Ant Design components detected");
    if (any(RX.mui)) addTech("Material UI (MUI)", "Library", "Medium", "MUI components detected");
    if (any(RX.chakra)) addTech("Chakra UI", "Library", "Medium", "Chakra UI detected");
    if (any(RX.mantine)) addTech("Mantine", "Library", "Medium", "Mantine components detected");

    // ---------------- Icons & fonts ----------------
    if (any(RX.fontAwesome)) addTech("Font Awesome", "Font", "Medium", "Font Awesome icons or assets");
    if (any(RX.bootstrapIcons)) addTech("Bootstrap Icons", "Font", "Medium", "Bootstrap Icons detected");
    if (any(RX.materialIcons)) addTech("Material Icons", "Font", "Medium", "Material Icons glyphs detected");
    if (any(RX.googleFonts)) addTech("Google Fonts", "Font", "High", "Fonts served from fonts.googleapis.com");
    if (any(RX.adobeFonts)) addTech("Adobe Fonts", "Font", "High", "Typekit / use.typekit.net assets");

    // ---------------- JavaScript libraries ----------------
    if (any(RX.jqueryUi)) addTech("jQuery UI", "Library", "Medium", "jQuery UI components detected");
    if (any(RX.jqueryMigrate)) addTech("jQuery Migrate", "Library", "Medium", "jQuery Migrate layer detected");
    if (any(RX.lodash)) addTech("Lodash", "Library", "Medium", "Lodash runtime detected");
    if (any(RX.underscore)) addTech("Underscore.js", "Library", "Medium", "Underscore runtime detected");
    if (any(RX.moment)) addTech("Moment.js", "Library", "Medium", "Moment.js detected");
    if (any(RX.dayjs)) addTech("Day.js", "Library", "Medium", "Day.js detected");
    if (any(RX.axios)) addTech("Axios", "Library", "Medium", "Axios HTTP client detected");
    if (any(RX.gsap)) addTech("GSAP", "Library", "Medium", "GreenSock animation runtime detected");
    if (any(RX.three)) addTech("Three.js", "Library", "Medium", "Three.js 3D runtime detected");
    if (any(RX.d3)) addTech("D3.js", "Library", "Medium", "D3 data-visualization runtime detected");
    if (any(RX.chartjs)) addTech("Chart.js", "Library", "Medium", "Chart.js detected");
    if (any(RX.apexcharts)) addTech("ApexCharts", "Library", "Medium", "ApexCharts detected");
    if (any(RX.highcharts)) addTech("Highcharts", "Library", "Medium", "Highcharts detected");
    if (any(RX.leaflet)) addTech("Leaflet", "Library", "Medium", "Leaflet maps detected");
    if (any(RX.mapbox)) addTech("Mapbox GL", "Library", "Medium", "Mapbox GL detected");
    if (any(RX.swiper)) addTech("Swiper", "Library", "Medium", "Swiper slider detected");
    if (any(RX.slick)) addTech("Slick Carousel", "Library", "Medium", "Slick slider detected");
    if (any(RX.owl)) addTech("Owl Carousel", "Library", "Medium", "Owl Carousel detected");
    if (any(RX.isotope)) addTech("Isotope", "Library", "Medium", "Isotope layout library detected");
    if (any(RX.masonry)) addTech("Masonry", "Library", "Medium", "Masonry layout detected");
    if (any(RX.tinymce)) addTech("TinyMCE", "Library", "Medium", "TinyMCE editor detected");
    if (any(RX.ckeditor)) addTech("CKEditor", "Library", "Medium", "CKEditor detected");
    if (any(RX.quill)) addTech("Quill", "Library", "Medium", "Quill editor detected");
    if (any(RX.fancybox)) addTech("Fancybox", "Library", "Medium", "Fancybox lightbox detected");
    if (any(RX.lightbox)) addTech("Lightbox", "Library", "Medium", "Lightbox script detected");
    if (any(RX.aos)) addTech("AOS", "Library", "Medium", "Animate on Scroll detected");
    if (any(RX.particles)) addTech("particles.js", "Library", "Medium", "particles.js detected");
    if (any(RX.typed)) addTech("Typed.js", "Library", "Medium", "Typed.js detected");
    if (any(RX.clipboard)) addTech("ClipboardJS", "Library", "Medium", "ClipboardJS detected");
    if (any(RX.lazysizes)) addTech("LazySizes", "Library", "Medium", "LazySizes detected");
    if (any(RX.hammer)) addTech("Hammer.js", "Library", "Medium", "Hammer.js detected");
    if (any(RX.anime)) addTech("anime.js", "Library", "Medium", "anime.js detected");

    // ---------------- Other Platforms ----------------
    if (htmlLower.indexOf("magento") !== -1 || srcs.indexOf("mage/") !== -1) {
      addTech("Magento", "E-commerce", "High", "Magento paths detected");
    }
    if (htmlLower.indexOf("prestashop") !== -1) {
      addTech("PrestaShop", "E-commerce", "High", "PrestaShop markers detected");
    }
    if (htmlLower.indexOf("hubspot") !== -1 || srcs.indexOf("hs-scripts") !== -1) {
      addTech("HubSpot", "CMS/CRM", "High", "HubSpot scripts detected");
    }
    if (has("#dm-root") || has("[data-duda]") || htmlLower.indexOf("duda") !== -1) {
      addTech("Duda", "Website Builder", "Medium", "Duda root or markers detected");
    }
    if (has("[data-framer-slot]") || srcs.indexOf("framer") !== -1 || htmlLower.indexOf("framer") !== -1) {
      addTech("Framer", "Website Builder", "Medium", "Framer markers or assets detected");
    }
    if (has("[data-carrd]") || htmlLower.indexOf("carrd") !== -1) {
      addTech("Carrd", "Website Builder", "Medium", "Carrd markers detected");
    }

    // ---------------- Hosting / deployment platforms ----------------
    const host = location.hostname.toLowerCase();
    if (host === "vercel.app" || host.lastIndexOf(".vercel.app", host.length - 11) !== -1 ||
        htmlLower.indexOf("vercel-analytics") !== -1 || htmlLower.indexOf("/_vercel/") !== -1 ||
        htmlLower.indexOf("vercel.live") !== -1) {
      addTech("Vercel", "Platform", /vercel\.app$/.test(host) ? "High" : "Medium", "Vercel domain or deployment markers");
    }
    if (host === "netlify.app" || host.lastIndexOf(".netlify.app", host.length - 12) !== -1 ||
        htmlLower.indexOf("netlify") !== -1) {
      addTech("Netlify", "Platform", /netlify\.app/.test(host) ? "High" : "Medium", "Netlify domain or deployment markers");
    }
    if (host === "github.io" || host.lastIndexOf(".github.io", host.length - 10) !== -1) {
      addTech("GitHub Pages", "Platform", "High", "GitHub Pages domain");
    }

    // ---------------- Additional website builders ----------------
    if (any(RX.weebly)) addTech("Weebly", "Website Builder", "Medium", "Weebly assets or markers");
    if (any(RX.jimdo)) addTech("Jimdo", "Website Builder", "Medium", "Jimdo assets or markers");
    if (any(RX.tilda) || has("div.t-record")) addTech("Tilda", "Website Builder", "Medium", "Tilda builders or markers");
    if (any(RX.unbounce)) addTech("Unbounce", "Website Builder", "Medium", "Unbounce landing-page platform");
    if (any(RX.strikingly)) addTech("Strikingly", "Website Builder", "Medium", "Strikingly CDN assets");
    if (any(RX.site123)) addTech("SITE123", "Website Builder", "Medium", "SITE123 assets or markers");

    // ---------------- More CMS / E-commerce ----------------
    if (any(RX.sitecore)) addTech("Sitecore", "CMS", "Medium", "Sitecore markers detected");
    if (any(RX.contentful)) addTech("Contentful", "CMS", "Medium", "Contentful content API detected");
    if (any(RX.sanity)) addTech("Sanity", "CMS", "Medium", "Sanity studio/runtime detected");
    if (any(RX.strapi)) addTech("Strapi", "CMS", "Medium", "Strapi backend detected");
    if (any(RX.opencart)) addTech("OpenCart", "E-commerce", "High", "OpenCart markers detected");
    if (any(RX.nop)) addTech("nopCommerce", "E-commerce", "High", "nopCommerce markers detected");

    // ---------------- More page builders ----------------
    if (any(RX.beaver) || has(".fl-builder-content") || has(".fl-row")) {
      addTech("Beaver Builder", "Page Builder", "High", "Beaver Builder markup detected");
    }
    if (any(RX.oxygen) || has("[data-oxygen-id]")) {
      addTech("Oxygen Builder", "Page Builder", "High", "Oxygen Builder markup detected");
    }
    if (any(RX.brizy) || has("[data-brz-id], [data-brz-class]")) {
      addTech("Brizy", "Page Builder", "High", "Brizy builder markup detected");
    }

    // ---------------- WordPress plugins (only surface when relevant markers appear) ----------------
    if (any(RX.yoast)) addTech("Yoast SEO", "SEO", "High", "Yoast SEO assets or schema detected");
    if (any(RX.rankmath)) addTech("Rank Math", "SEO", "High", "Rank Math assets detected");
    if (any(RX.aioseo)) addTech("All in One SEO", "SEO", "Medium", "AIOSEO markers detected");
    if (any(RX.wpforms) || has(".wpforms-container")) addTech("WPForms", "Form", "Medium", "WPForms assets or container");
    if (any(RX.cf7) || has(".wpcf7")) addTech("Contact Form 7", "Form", "Medium", "CF7 form markup detected");
    if (any(RX.wpRocket)) addTech("WP Rocket", "Performance", "Medium", "WP Rocket cache assets detected");
    if (any(RX.w3tc)) addTech("W3 Total Cache", "Performance", "Medium", "W3TC markers detected");
    if (any(RX.autoptimize)) addTech("Autoptimize", "Performance", "Medium", "Autoptimize cache assets detected");
    if (any(RX.jetpack)) addTech("Jetpack", "Performance", "Medium", "Jetpack markers detected");
    if (any(RX.litespeed)) addTech("LiteSpeed Cache", "Performance", "Medium", "LiteSpeed cache assets detected");

    // ---------------- Hosting / deployment / CDN services ----------------
    if (HOST.endsWith(".pages.dev")) {
      addTech("Cloudflare Pages", "Platform", "High", "pages.dev domain");
    } else if (any(RX.cloudflare) || HOST.endsWith(".cloudflaressl.com") || has("#cf-turnstile")) {
      addTech("Cloudflare", "CDN", /cloudflare/i.test(HOST) || /cloudflare/i.test(htmlLower) ? "High" : "Medium", "Cloudflare assets or domain markers");
    }
    if (any(RX.jsdelivr)) addTech("jsDelivr", "CDN", "Medium", "Assets served from cdn.jsdelivr.net");
    if (any(RX.unpkg)) addTech("unpkg", "CDN", "Medium", "Assets served from unpkg.com");
    if (any(RX.cdnjs)) addTech("cdnjs", "CDN", "Medium", "Assets served from cdnjs.cloudflare.com");
    if (any(RX.aws)) addTech("Amazon AWS", "CDN", "Medium", "S3 / CloudFront / AWS asset domains");
    if (HOST.endsWith(".web.app") || HOST.endsWith(".firebaseapp.com") || any(RX.firebase)) {
      addTech("Firebase", "Platform", HOST.endsWith(".web.app") || HOST.endsWith(".firebaseapp.com") ? "High" : "Medium", "Firebase hosting domain or assets");
    }
    if (HOST.endsWith(".herokuapp.com")) addTech("Heroku", "Platform", "High", "Heroku app domain");
    if (HOST.endsWith(".amplifyapp.com")) addTech("AWS Amplify", "Platform", "High", "Amplify app domain");
    if (HOST.endsWith(".azurestaticapps.net") || any(RX.azureStatic)) addTech("Azure Static Web Apps", "Platform", "Medium", "Azure static hosting domain");
    if (HOST.endsWith(".onrender.com")) addTech("Render", "Platform", "High", "Render app domain");
    if (HOST.endsWith(".up.railway.app")) addTech("Railway", "Platform", "High", "Railway app domain");
    if (HOST.endsWith(".surge.sh")) addTech("Surge", "Platform", "High", "Surge.sh domain");

    // ---------------- Analytics / Marketing / Privacy / Security ----------------
    if (any(RX.gtm)) {
      addTech("Google Tag Manager", "Analytics", "High", "GTM container script detected");
    }
    if (any(RX.metaPixel)) addTech("Meta Pixel", "Analytics", "High", "Facebook/Meta Pixel script detected");
    if (any(RX.clarity)) addTech("Microsoft Clarity", "Analytics", "High", "Clarity analytics detected");
    if (any(RX.hotjar)) addTech("Hotjar", "Analytics", "High", "Hotjar script detected");
    if (any(RX.mixpanel)) addTech("Mixpanel", "Analytics", "High", "Mixpanel SDK detected");
    if (any(RX.amplitude)) addTech("Amplitude", "Analytics", "High", "Amplitude SDK detected");
    if (any(RX.segment)) addTech("Segment", "Analytics", "High", "Segment analytics.js detected");
    if (any(RX.posthog)) addTech("PostHog", "Analytics", "Medium", "PostHog SDK detected");
    if (any(RX.matomo)) addTech("Matomo", "Analytics", "High", "Matomo/Piwik tracking detected");
    if (any(RX.plausible)) addTech("Plausible", "Analytics", "High", "Plausible analytics detected");
    if (any(RX.fathom)) addTech("Fathom Analytics", "Analytics", "High", "Fathom script detected");
    if (any(RX.heap)) addTech("Heap", "Analytics", "High", "Heap analytics detected");
    if (any(RX.yandex)) addTech("Yandex Metrica", "Analytics", "High", "Yandex Metrica detected");
    if (any(RX.intercom)) addTech("Intercom", "Marketing", "High", "Intercom messenger detected");
    if (any(RX.drift)) addTech("Drift", "Marketing", "High", "Drift chat detected");
    if (any(RX.crisp)) addTech("Crisp", "Marketing", "High", "Crisp live chat detected");
    if (any(RX.tawk)) addTech("Tawk.to", "Marketing", "High", "Tawk.to widget detected");
    if (any(RX.zendesk)) addTech("Zendesk", "Marketing", "High", "Zendesk widget detected");
    if (any(RX.livechat)) addTech("LiveChat", "Marketing", "High", "LiveChat widget detected");
    if (any(RX.mailchimp)) addTech("Mailchimp", "Marketing", "Medium", "Mailchimp forms detected");
    if (any(RX.klaviyo)) addTech("Klaviyo", "Marketing", "High", "Klaviyo email/automation detected");
    if (any(RX.convertkit)) addTech("ConvertKit", "Marketing", "High", "ConvertKit forms detected");
    if (any(RX.trustpilot)) addTech("Trustpilot", "Marketing", "Medium", "Trustpilot widget detected");
    if (any(RX.gorgias)) addTech("Gorgias", "Marketing", "Medium", "Gorgias helpdesk detected");
    if (any(RX.cookieyes)) addTech("CookieYes", "Privacy", "High", "CookieYes consent banner detected");
    if (any(RX.onetrust)) addTech("OneTrust", "Privacy", "High", "OneTrust/CookieLaw consent detected");
    if (any(RX.cookiebot)) addTech("CookieBot", "Privacy", "High", "CookieBot consent banner detected");
    if (any(RX.recaptcha)) addTech("reCAPTCHA", "Security", "High", "Google reCAPTCHA detected");
    if (any(RX.hcaptcha)) addTech("hCaptcha", "Security", "High", "hCaptcha detected");

    // ---------------- Analytics / CDN / Libraries ----------------
    if (globals.GoogleTagManager && !globals.Analytics && !any(RX.gtm)) {
      addTech("Google Tag Manager", "Analytics", "High", "GTM global detected");
    }
    if (htmlLower.indexOf("google-analytics") !== -1 || htmlLower.indexOf("gtag") !== -1 ||
        htmlLower.indexOf("googletagmanager") !== -1 || globals.Analytics) {
      addTech("Google Analytics", "Analytics", "High", "GA / gtag scripts or globals");
    }
    if (htmlLower.indexOf("cloudflare") !== -1) {
      addTech("Cloudflare", "CDN", "Medium", "Cloudflare markers detected");
    }
    if (globals.jQuery || htmlLower.indexOf("jquery") !== -1) {
      addTech("jQuery", "Library", "Medium", "jQuery globals or scripts");
    }

    // ---------------- Categorize & prioritize ----------------
    const groups = {
      cms: [], ecommerce: [], builders: [], pageBuilders: [], editors: [],
      frameworks: [], cssFrameworks: [], libraries: [], fonts: [],
      analytics: [], marketing: [], privacy: [], security: [], seo: [], forms: [], performance: [],
      cdns: [], platforms: []
    };
    detected.forEach(function (t) {
      const cat = t.category;
      if (cat === "CMS") groups.cms.push(t);
      else if (cat === "E-commerce") groups.ecommerce.push(t);
      else if (cat === "Website Builder") groups.builders.push(t);
      else if (cat === "Page Builder") groups.pageBuilders.push(t);
      else if (cat === "Editor") groups.editors.push(t);
      else if (cat === "Framework") groups.frameworks.push(t);
      else if (cat === "CSS Framework") groups.cssFrameworks.push(t);
      else if (cat === "Library") groups.libraries.push(t);
      else if (cat === "Font") groups.fonts.push(t);
      else if (cat === "Analytics") groups.analytics.push(t);
      else if (cat === "Marketing") groups.marketing.push(t);
      else if (cat === "Privacy") groups.privacy.push(t);
      else if (cat === "Security") groups.security.push(t);
      else if (cat === "SEO") groups.seo.push(t);
      else if (cat === "Form") groups.forms.push(t);
      else if (cat === "Performance") groups.performance.push(t);
      else if (cat === "CDN") groups.cdns.push(t);
      else if (cat === "Platform" || cat === "Hosting") groups.platforms.push(t);
    });

    // Single most-likely platform: CMS > Website Builder > E-commerce > Page
    // Builder > Editor > Framework > Hosting platform.
    const tier = [];
    ["cms", "builders", "ecommerce", "pageBuilders", "editors", "frameworks", "platforms"].forEach(function (k) {
      tier.push.apply(tier, groups[k]);
    });

    return {
      all: detected,
      primary: tier.length > 0 ? tier[0] : (detected.length > 0 ? detected[0] : null),
      cms: groups.cms.length > 0 ? groups.cms[0] : null,
      ecommerce: groups.ecommerce.length > 0 ? groups.ecommerce[0] : null,
      pageBuilder: (groups.pageBuilders.length > 0 ? groups.pageBuilders[0] : (groups.editors.length > 0 ? groups.editors[0] : null)),
      framework: groups.frameworks.length > 0 ? groups.frameworks[0] : null,
      websiteBuilder: groups.builders.length > 0 ? groups.builders[0] : null,
      analytics: groups.analytics,
      categoryCount: detected.filter(function (t, i, arr) {
        return arr.findIndex(function (o) { return o.category === t.category; }) === i;
      }).length,
      groups: groups
    };
  }
// =============================================
  // ACCESSIBILITY ANALYZER
  // =============================================
  function analyzeAccessibility(dom, byTag) {
    const issues = [];
    const tag = function (t) { return (byTag && byTag[t]) || []; };

    // Images missing alt (from the shared census — no extra DOM walk)
    const imgs = tag("img");
    let missingAlt = 0;
    let emptyAlt = 0;
    imgs.forEach(function (img) {
      if (!img.hasAttribute("alt")) missingAlt++;
      else if (img.getAttribute("alt") === "") emptyAlt++;
    });
    if (missingAlt > 0) issues.push({ type: "error", message: missingAlt + " image(s) missing alt attribute" });

    // Buttons without accessible names
    const buttons = (tag("button") || []).slice();
    tag("input").forEach(function (i) {
      const t = i.getAttribute("type");
      if (t === "submit" || t === "button") buttons.push(i);
    });
    document.querySelectorAll("[role='button']").forEach(function (r) { buttons.push(r); });
    let buttonsNoName = 0;
    buttons.forEach(function (btn) {
      // For <input> the "text" IS the accessible name (the value attribute):
      // textContent is always empty on an input, so read value for those.
      let hasText = (btn.textContent || "").trim();
      if (btn.tagName && btn.tagName.toLowerCase() === "input") {
        hasText = (btn.getAttribute("value") || "").trim() || (btn.value || "").trim();
      }
      const ariaLabel = btn.getAttribute("aria-label") || "";
      const title = btn.getAttribute("title") || "";
      if (!hasText && !ariaLabel && !title) buttonsNoName++;
    });
    if (buttonsNoName > 0) issues.push({ type: "error", message: buttonsNoName + " button(s) without accessible name" });

    // Links without accessible text
    const links = (tag("a") || []).filter(function (a) { return a.hasAttribute("href"); });
    let linksNoText = 0;
    links.forEach(function (link) {
      const text = (link.textContent || "").trim();
      const ariaLabel = link.getAttribute("aria-label") || "";
      const img = link.querySelector("img[alt]");
      if (!text && !ariaLabel && !img) linksNoText++;
    });
    if (linksNoText > 0) issues.push({ type: "warning", message: linksNoText + " link(s) without accessible text" });

    // label[for] ids resolved once so per-input lookups are O(1), not a query.
    const labelFor = new Set();
    tag("label").forEach(function (l) {
      const f = l.getAttribute("for");
      if (f) labelFor.add(f);
    });

    // Forms without labels
    const visibleInputs = (tag("input") || []).filter(function (i) {
      const t = (i.getAttribute("type") || "").toLowerCase();
      return t !== "hidden" && t !== "submit" && t !== "button" && t !== "reset";
    });
    const inputs = visibleInputs.concat(tag("textarea")).concat(tag("select"));
    let inputsNoLabel = 0;
    inputs.forEach(function (input) {
      const id = input.id;
      const ariaLabel = input.getAttribute("aria-label") || "";
      const ariaLabelledBy = input.getAttribute("aria-labelledby") || "";
      const title = input.getAttribute("title") || "";
      const hasLabel = !!(id && labelFor.has(id));
      const parentLabel = input.closest("label");
      if (!hasLabel && !parentLabel && !ariaLabel && !ariaLabelledBy && !title) inputsNoLabel++;
    });
    if (inputsNoLabel > 0) issues.push({ type: "warning", message: inputsNoLabel + " form input(s) without labels" });

    // Duplicate IDs (reuse the DOM analysis to avoid a second full scan)
    const duplicateCount = (dom && dom.duplicateIds) ? dom.duplicateIds.length : 0;
    if (duplicateCount > 0) {
      issues.push({ type: "error", message: duplicateCount + " duplicate ID(s) found" });
    }

    // Missing main landmark
    if (!document.querySelector("main, [role='main']")) {
      issues.push({ type: "warning", message: "Missing main landmark element" });
    }

    // Nav without accessible name
    const navs = tag("nav");
    let navsNoName = 0;
    navs.forEach(function (nav) {
      if (!nav.getAttribute("aria-label") && !nav.getAttribute("aria-labelledby")) navsNoName++;
    });
    if (navsNoName > 0 && navs.length > 1) {
      issues.push({ type: "warning", message: navsNoName + " navigation(s) without accessible name" });
    }

    // Iframes without title
    const iframes = tag("iframe");
    let iframesNoTitle = 0;
    iframes.forEach(function (iframe) {
      if (!iframe.getAttribute("title")) iframesNoTitle++;
    });
    if (iframesNoTitle > 0) issues.push({ type: "warning", message: iframesNoTitle + " iframe(s) without title" });

    // Missing document language
    if (!document.documentElement.getAttribute("lang")) {
      issues.push({ type: "error", message: "Missing document language (lang attribute)" });
    }

    const errors = issues.filter(function (i) { return i.type === "error"; });
    const warnings = issues.filter(function (i) { return i.type === "warning"; });

    let level = "good";
    if (errors.length >= 3) level = "critical";
    else if (errors.length > 0 || warnings.length >= 3) level = "warning";

    return {
      issues: issues,
      level: level,
      imagesMissingAlt: missingAlt,
      imagesEmptyAlt: emptyAlt,
      buttonsNoName: buttonsNoName,
      linksNoText: linksNoText,
      inputsNoLabel: inputsNoLabel,
      iframesNoTitle: iframesNoTitle,
      navsNoName: navsNoName,
      duplicateIdCount: duplicateCount
    };
  }

  // =============================================
  // FORMS ANALYZER
  // =============================================
  function analyzeForms(byTag) {
    const tag = function (t) { return (byTag && byTag[t]) || []; };
    const forms = tag("form");
    const inputs = tag("input");
    const textareas = tag("textarea");
    const selects = tag("select");
    const buttons = tag("button");

    let textFields = 0, emailFields = 0, passwordFields = 0;
    let checkboxes = 0, radios = 0, submitButtons = 0, missingLabels = 0, requiredFields = 0;

    const labelFor = new Set();
    tag("label").forEach(function (l) {
      const f = l.getAttribute("for");
      if (f) labelFor.add(f);
    });

    function consider(input) {
      const type = (input.getAttribute("type") || "text").toLowerCase();
      if (input.tagName === "TEXTAREA" || input.tagName === "SELECT") {
        // textarea/select are tracked by their own dedicated counters below
        // and must not be counted as generic "text" fields.
      } else if (type === "text" || type === "url" || type === "tel" || type === "number" || type === "search" || type === "") textFields++;
      else if (type === "email") emailFields++;
      else if (type === "password") passwordFields++;
      else if (type === "checkbox") checkboxes++;
      else if (type === "radio") radios++;
      else if (type === "submit" || type === "button") submitButtons++;

      if (input.hasAttribute("required")) requiredFields++;

      const id = input.id;
      const ariaLabel = input.getAttribute("aria-label") || "";
      const ariaLabelledBy = input.getAttribute("aria-labelledby") || "";
      const title = input.getAttribute("title") || "";
      const hasLabel = !!(id && labelFor.has(id));
      const parentLabel = input.closest("label");
      if (!hasLabel && !parentLabel && !ariaLabel && !ariaLabelledBy && !title) missingLabels++;
    }

    inputs.forEach(consider);
    textareas.forEach(consider);
    selects.forEach(consider);

    // Standalone <button> elements are also submit-action targets in modern forms.
    buttons.forEach(function (b) {
      if (b.getAttribute("type") === "submit" || !b.getAttribute("type") || b.getAttribute("type") === "button") submitButtons++;
    });

    return {
      formCount: forms.length,
      inputCount: inputs.length + textareas.length + selects.length,
      textFields: textFields,
      emailFields: emailFields,
      passwordFields: passwordFields,
      checkboxes: checkboxes,
      radioButtons: radios,
      selects: selects.length,
      textareas: textareas.length,
      submitButtons: submitButtons,
      missingLabels: missingLabels,
      requiredFields: requiredFields
    };
  }

  // =============================================
  // LINKS ANALYZER
  // =============================================
  function analyzeLinks(byTag) {
    const links = ((byTag && byTag.a) || []).filter(function (a) { return a.hasAttribute("href"); });
    let total = links.length;
    let internal = 0, external = 0, empty = 0, noText = 0;
    let targetBlank = 0, nofollow = 0, sponsored = 0, ugc = 0;
    const currentHost = location.hostname;

    // Structural broken-link detection (synchronous): single-# placeholders,
    // dead javascript: URLs, and internal fragment links whose target id does
    // not exist on the page are provably broken without a network round-trip.
    let placeholderCount = 0;
    let fragmentTargetMissing = 0;
    const missingFragmentExamples = [];

    links.forEach(function (link) {
      const href = link.getAttribute("href") || "";
      const rel = (link.getAttribute("rel") || "").toLowerCase();
      const text = (link.textContent || "").trim();
      const ariaLabel = link.getAttribute("aria-label") || "";

      if (!href || href === "#" || /^javascript:/i.test(href)) {
        empty++;
        placeholderCount++;
      } else {
        try {
          const url = new URL(href, location.href);
          if (url.hostname === currentHost || url.hostname === "") internal++;
          else external++;
        } catch (e) {
          empty++;
        }
        if (href.charAt(0) === "#" && href.length > 1) {
          const frag = href.substring(1);
          let targetEl = null;
          try { targetEl = document.getElementById(frag); } catch (e) { targetEl = null; }
          if (!targetEl) {
            fragmentTargetMissing++;
            if (missingFragmentExamples.length < 5) missingFragmentExamples.push(href);
          }
        }
      }

      if (!text && !ariaLabel && !link.querySelector("img[alt]")) noText++;
      if (link.getAttribute("target") === "_blank") targetBlank++;
      if (rel.indexOf("nofollow") !== -1) nofollow++;
      if (rel.indexOf("sponsored") !== -1) sponsored++;
      if (rel.indexOf("ugc") !== -1) ugc++;
    });

    return {
      total: total,
      internal: internal,
      external: external,
      empty: empty,
      placeholderCount: placeholderCount,
      fragmentTargetMissing: fragmentTargetMissing,
      brokenInternal: placeholderCount + fragmentTargetMissing,
      missingFragmentExamples: missingFragmentExamples,
      noAccessibleText: noText,
      targetBlank: targetBlank,
      nofollow: nofollow,
      sponsored: sponsored,
      ugc: ugc
    };
  }

  // =============================================
  // IMAGES ANALYZER
  // =============================================
  function analyzeImages(byTag) {
    const imgs = (byTag && byTag.img) || document.querySelectorAll("img");
    let total = imgs.length;
    let withAlt = 0, missingAlt = 0, emptyAlt = 0;
    let lazyLoaded = 0, noDimensions = 0, svgCount = 0;
    let largeImages = 0;

    imgs.forEach(function (img) {
      if (!img.hasAttribute("alt")) missingAlt++;
      else if (img.getAttribute("alt") === "") emptyAlt++;
      else withAlt++;

      const loading = img.getAttribute("loading");
      if (loading === "lazy") lazyLoaded++;

      if (!img.hasAttribute("width") && !img.hasAttribute("height")) noDimensions++;

      const src = img.getAttribute("src") || "";
      if (src.indexOf(".svg") !== -1 || src.indexOf("data:image/svg") !== -1) svgCount++;

      const naturalWidth = img.naturalWidth || 0;
      const naturalHeight = img.naturalHeight || 0;
      if (naturalWidth > 2000 || naturalHeight > 2000) largeImages++;
    });

    // Background images (sample a spread of container elements).
    let bgImageCount = 0;
    const srcTags = ["div", "section", "header", "footer", "main", "aside"];
    const sampleEls = [];
    srcTags.forEach(function (t) {
      const arr = (byTag && byTag[t]) || [];
      for (let i = 0; i < arr.length; i++) sampleEls.push(arr[i]);
    });
    const maxSample = Math.min(sampleEls.length, 120);
    const step = Math.max(1, Math.floor(sampleEls.length / maxSample)) || 1;
    for (let i = 0; i < sampleEls.length; i += step) {
      const style = window.getComputedStyle(sampleEls[i]);
      if (style.backgroundImage && style.backgroundImage !== "none") bgImageCount++;
    }

    return {
      total: total,
      withAlt: withAlt,
      missingAlt: missingAlt,
      emptyAlt: emptyAlt,
      lazyLoaded: lazyLoaded,
      noDimensions: noDimensions,
      svgCount: svgCount,
      largeImages: largeImages,
      bgImageSample: bgImageCount
    };
  }

  // =============================================
  // RESPONSIVE ANALYZER
  // =============================================
  function analyzeResponsive(candidates) {
    if (!candidates || !candidates.length) {
      candidates = document.querySelectorAll("div, section, article, main, aside, table, form, header, footer, ul, ol, nav, img, video, iframe, figure, h1, h2, h3, h4, h5, h6, p, li, label, span, a, button");
    }
    const vp = document.querySelector('meta[name="viewport"]');
    const vpContent = vp ? (vp.getAttribute("content") || "") : "";
    const widthDevice = vpContent.toLowerCase().indexOf("width=device-width") !== -1;

    const winW = window.innerWidth;
    const docEl = document.documentElement;
    const scrollW = docEl.scrollWidth || 0;
    const overflowNow = scrollW > winW + 1;
    const overflowPx = overflowNow ? scrollW - winW : 0;

    function labelOf(el) {
      const tag = el.tagName.toLowerCase();
      if (el.id) return tag + "#" + el.id;
      const c = (el.className && typeof el.className === "string")
        ? el.className.split(/\s+/).filter(function (s) { return s; }).slice(0, 2).join(".") : "";
      return tag + (c ? "." + c : "");
    }

    // Element-level pass (sampled style reads): culprits wider than the viewport,
    // fixed pixel widths, oversized images, real text overflow, and content that
    // sticks out of the current screen area.
    const culprits = [];
    const fixedWidthEls = [];
    const oversizedImgs = [];
    const textOverflows = [];
    const offscreenEls = [];
    let fixedWidthCount = 0;
    let oversizedImageCount = 0;
    let textOverflowCount = 0;
    let offscreenCount = 0;

    const maxCandidates = Math.min(candidates.length, 2500);
    const step = Math.max(1, Math.round(maxCandidates / 1400));
    for (let i = 0; i < maxCandidates; i += step) {
      const el = candidates[i];
      let rect, cs;
      try {
        rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        cs = window.getComputedStyle(el);
      } catch (e) { continue; }
      const tag = el.tagName.toLowerCase();
      const w = rect.width;

      // Elements wider than the current viewport (overflow culprits).
      if (w > winW + 1 && culprits.length < 5) {
        culprits.push({
          tag: tag,
          cls: (el.className && typeof el.className === "string")
            ? el.className.split(/\s+/).slice(0, 2).join(".") : "",
          id: el.id || "",
          width: Math.round(w)
        });
      }

      // Fixed pixel-width boxes that exceed the viewport (can't shrink, may reflow).
      if (/px$/.test(cs.width)) {
        const fw = parseFloat(cs.width);
        if (fw > winW + 1 && fw > winW * 0.45) {
          fixedWidthCount++;
          if (fixedWidthEls.length < 3) fixedWidthEls.push(labelOf(el) + " \u00B7 " + Math.round(fw) + "px");
        }
      }

      // Images rendering wider than the viewport.
      if (tag === "img" && w > winW + 1) {
        oversizedImageCount++;
        if (oversizedImgs.length < 3) oversizedImgs.push(labelOf(el) + " \u00B7 " + Math.round(w) + "px");
      }

      // Real text truncation/overflow in too-narrow boxes.
      if ((cs.whiteSpace === "nowrap" || cs.textOverflow === "ellipsis") &&
          el.scrollWidth > el.clientWidth + 2 &&
          cs.overflowX !== "auto" && cs.overflowX !== "scroll") {
        textOverflowCount++;
        if (textOverflows.length < 3) textOverflows.push(labelOf(el) + " \u00B7 " + Math.round(el.scrollWidth) + "px");
      }

      // Elements sticking out of the current page area (real, now).
      if (rect.right > winW + 2 || (rect.left < -9 && rect.right > 0)) {
        offscreenCount++;
        if (offscreenEls.length < 3) {
          offscreenEls.push(labelOf(el) + " \u00B7 " + Math.round(Math.max(rect.right - winW, -rect.left)) + "px");
        }
      }
    }
    culprits.sort(function (a, b) { return b.width - a.width; });

    const maxContentWidth = culprits.length > 0 ? culprits[0].width : scrollW;

    // Concrete, copy-pasteable fixes tied to whatever was actually found. The
    // popup renders these verbatim, so they stay practical rather than generic.
    const layoutHints = [];
    if (!vp) {
      layoutHints.push({ kind: "viewport", priority: "high",
        title: "Add a responsive viewport",
        message: 'Set <meta name="viewport" content="width=device-width, initial-scale=1"> so mobile browsers don\u2019t render the page as a zoomed-out desktop.' });
    }
    if (culprits.length > 0) {
      const c0 = culprits[0];
      const target = c0.tag === "img" ? "img." + c0.cls : (c0.cls || c0.tag + " of " + c0.width + "px");
      if (c0.tag === "img") {
        layoutHints.push({ kind: "overflow", priority: "high",
          title: "Overflowing image",
          message: "Make " + target.replace(/\.$/, "") + " fluid: add width:100%; height:auto; (or max-width:100%) so it cannot exceed the viewport." });
      } else {
        layoutHints.push({ kind: "overflow", priority: "high",
          title: "Horizontal overflow",
          message: target.replace(/\.$/, "") + " forces the page to " + Math.round(c0.width) + "px (viewport " + Math.round(winW) + "px). Give it max-width:100% (on a fluid wrapper, overflow-x:hidden) or rebuild it with flexible layout." });
      }
    }
    if (fixedWidthCount > 0) {
      const fwSample = fixedWidthEls[0] || "";
      layoutHints.push({ kind: "fixed-width", priority: "high",
        title: "Fixed pixel widths",
        message: (fwSample ? fwSample + " \u2014 " : "") + fixedWidthCount + " box(es) use a hard-coded width wider than the viewport. Switch width to max-width:100% (or width:auto + box-sizing:border-box) so they can shrink." });
    }
    if (oversizedImageCount > 0) {
      layoutHints.push({ kind: "image", priority: "medium",
        title: "Oversized images",
        message: (oversizedImgs[0] || "") + " \u2014 apply width:100%;height:auto on large media, and drop max-width:100% on the img rule so images scale down with the layout." });
    }
    if (textOverflowCount > 0) {
      const tfSample = textOverflows[0] || "";
      layoutHints.push({ kind: "text-overflow", priority: "medium",
        title: "Truncated / clipped text",
        message: (tfSample ? tfSample + " \u2014 " : "") + "elements use white-space:nowrap and overflow their box. Let text wrap (white-space:normal) or, inside flex/grid, give the child min-width:0 so it can shrink." });
    }
    if (offscreenCount > 0) {
      const offSample = offscreenEls[0] || "";
      layoutHints.push({ kind: "offscreen", priority: "high",
        title: "Content out of screen",
        message: (offSample ? offSample + " \u2014 " : "") + "elements stick out past the right edge. Remove fixed min-widths, replace them with max-width percentages, and let content wrap instead of pushing the page wide." });
    }

    // Count media queries and min-width rules from readable stylesheets (CSSOM),
    // bounded per sheet and total so a huge bundled stylesheet can't stall the
    // scan. @media blocks are recursed into with the same budget.
    let breakPoints = 0;
    let minWidthRules = 0;
    const MAX_SHEETS = 40;
    const MAX_RULES = 900;
    try {
      function countRules(list, budget) {
        if (!list || budget.used >= budget.max) return;
        for (let j = 0; j < list.length && budget.used < budget.max; j++) {
          const rule = list[j];
          if (!rule) continue;
          budget.used++;
          const isMedia = rule.type === 4 || (rule.constructor && rule.constructor.name === "CSSMediaRule");
          if (isMedia) {
            breakPoints++;
            countRules(rule.cssRules, budget);
            continue;
          }
          try {
            const cssText = (rule.style && rule.style.cssText) || rule.cssText || "";
            if (cssText.indexOf("min-width") !== -1) {
              const mw = parseInt((cssText.match(/min-width\s*:\s*([0-9]+)px/) || [])[1] || "", 10);
              if (!isNaN(mw) && mw > 320) minWidthRules++;
            }
          } catch (e) {}
        }
      }
      const sheetCount = Math.min(document.styleSheets.length, MAX_SHEETS);
      for (let s = 0; s < sheetCount; s++) {
        let rules;
        try { rules = document.styleSheets[s].cssRules; } catch (e) { continue; }
        countRules(rules, { used: 0, max: MAX_RULES });
      }
    } catch (e) {}

    if (minWidthRules > 3) {
      layoutHints.push({ kind: "breakpoints", priority: "medium",
        title: "Desktop-first breakpoints",
        message: minWidthRules + " @media rules use min-width. Prefer mobile-first max-width breakpoints so small screens get a dedicated narrow layout instead of inheriting wide rules." });
    }

    return {
      viewportMeta: !!vp,
      viewportContent: vpContent,
      widthDevice: widthDevice,
      viewportWidth: winW,
      overflowNow: overflowNow,
      overflowPx: overflowPx,
      scrollWidth: scrollW,
      maxContentWidth: maxContentWidth,
      breakPoints: breakPoints,
      minWidthRules: minWidthRules,
      culprits: culprits,
      fixedWidthCount: fixedWidthCount,
      fixedWidthElements: fixedWidthEls,
      oversizedImageCount: oversizedImageCount,
      oversizedImages: oversizedImgs,
      textOverflowCount: textOverflowCount,
      textOverflowElements: textOverflows,
      offscreenCount: offscreenCount,
      offscreenElements: offscreenEls,
      layoutHints: layoutHints
    };
  }

  // =============================================
  // TARGET-VIEWPORT RESPONSIVE SCAN (Device tab)
  // =============================================
  // Projects the live page layout onto a target viewport width. Honest signal
  // set: red = provably broken (page/depth already overflows the current
  // window, or a fixed box is wider than the current window too); yellow =
  // needs attention at narrower sizes (may legally reflow via media queries);
  // green = nothing found. Problem elements stay trackable on the real page.
  function scanResponsiveAt(targetW) {
    const vw = window.innerWidth;
    const docEl = document.documentElement;
    const bodyEl = document.body;
    responsiveElements = [];

    function tagLabel(el) {
      const tag = el.tagName.toLowerCase();
      if (el.id) return tag + "#" + el.id;
      const c = (el.className && typeof el.className === "string")
        ? el.className.split(/\s+/).filter(Boolean).slice(0, 2).join(".") : "";
      return tag + (c ? "." + c : "");
    }

    function addOffender(el, w) {
      responsiveElements.push(el);
      return { i: responsiveElements.length - 1, label: tagLabel(el) + (w ? " \u00B7 " + Math.round(w) + "px" : "") };
    }

    function pushCheck(id, label, status, message, offenders) {
      checks.push({ id: id, label: label, status: status, message: message, count: offenders.length, offenders: offenders });
    }
    const checks = [];

    // 1) Viewport meta
    const vp = document.querySelector('meta[name="viewport"]');
    const vpContent = vp ? (vp.getAttribute("content") || "") : "";
    const hasDeviceWidth = /width\s*=\s*device-width/i.test(vpContent);
    if (!vp) {
      pushCheck("viewport", "Viewport meta", targetW <= 1024 ? 2 : 1,
        targetW <= 1024
          ? "Missing viewport meta \u2014 on mobile this page renders zoomed-out."
          : "Missing viewport meta. Not a problem at desktop widths.", []);
    } else if (!hasDeviceWidth) {
      pushCheck("viewport", "Viewport meta", 1, "Viewport meta exists but is not set to width=device-width.", []);
    } else {
      pushCheck("viewport", "Viewport meta", 0, "Viewport meta configured for responsive scaling.", []);
    }

    // 2) Live page-level horizontal overflow (measured now, fully trustworthy)
    const pageW = Math.max(docEl && docEl.scrollWidth ? docEl.scrollWidth : 0,
      bodyEl && bodyEl.scrollWidth ? bodyEl.scrollWidth : 0);
    const overBy = pageW - targetW;
    const pageOverflow = overBy > 1;
    const pageOffenders = [];
    pushCheck("pageOverflow", "Horizontal overflow at " + targetW + "px", pageOverflow ? 2 : 0,
      pageOverflow
        ? "Page layout is " + pageW + "px wide \u2014 overflows by " + overBy + "px."
        : "Page fits without horizontal scrolling at this width.",
      pageOffenders);

    // 3) Element-level pass (sampled for style reads)
    const elems = responsiveCandidates(document.querySelectorAll("*"));
    const STEP = Math.max(1, Math.ceil(elems.length / 2200));

    const wide = [];
    const minWide = [];
    const imgWide = [];
    const textOv = [];
    const offscreen = [];
    const smallTap = [];

    for (let i = 0; i < elems.length; i += STEP) {
      const el = elems[i];
      if (el === docEl || el === bodyEl) continue;
      let cs, rect;
      try {
        cs = window.getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden") continue;
        rect = el.getBoundingClientRect();
      } catch (e) { continue; }
      if (rect.width === 0 && rect.height === 0) continue;

      const tag = el.tagName.toLowerCase();

      // Fixed pixel-width boxes wider than the target (filtered by relative size
      // to cut flex/sidebar noise: needs to be ~60% of the current window too).
      if (/px$/.test(cs.width)) {
        const w = parseFloat(cs.width);
        if (w > targetW + 1 && w > vw * 0.6) {
          wide.push({ o: addOffender(el, w), w: w, hi: w > vw + 1 });
        }
      }
      // min-width floors that cannot shrink below the target width.
      if (/px$/.test(cs.minWidth)) {
        const mw = parseFloat(cs.minWidth);
        if (mw > targetW + 1 && mw > vw * 0.6) {
          minWide.push({ o: addOffender(el, mw), w: mw, hi: mw > vw + 1 });
        }
      }
      // Images rendering wider than the viewport.
      if (tag === "img" && rect.width > Math.max(targetW, vw) + 1) {
        imgWide.push({ o: addOffender(el, rect.width), w: rect.width, hi: rect.width > vw + 1 });
      }
      // Real text truncation/overflow in too-narrow boxes.
      if ((cs.whiteSpace === "nowrap" || cs.textOverflow === "ellipsis") &&
          el.scrollWidth > el.clientWidth + 2 &&
          cs.overflowX !== "auto" && cs.overflowX !== "scroll") {
        textOv.push({ o: addOffender(el, el.scrollWidth), w: el.scrollWidth });
      }
      // Elements sticking out of the CURRENT page area (real, now).
      if (rect.right > vw + 2 || (rect.left < -9 && rect.right > 0)) {
        offscreen.push({ o: addOffender(el, Math.max(rect.right - vw, -rect.left)), w: Math.max(rect.right - vw, -rect.left) });
      }
      // Tap targets too small for touch (mobile widths only).
      if (targetW <= 768 && tag !== "input" && (tag === "a" || tag === "button" || tag === "select" ||
          tag === "textarea" || el.getAttribute("role") === "button")) {
        if (rect.width > 0 && rect.height > 0 && rect.width < 40 && rect.height < 40) {
          smallTap.push({ o: addOffender(el, rect.height), w: rect.height });
        }
      }
    }

if (pageOverflow) {
      const sorted = wide.slice().sort(function (a, b) { return b.w - a.w; }).slice(0, 4);
      sorted.forEach(function (x) { pageOffenders.push(x.o); });
      if (pageOffenders.length === 0) pageOffenders.push(addOffender(docEl, pageW));
    }

    // Navigation containing fixed-width content (mobile check).
    const navMarked = [];
    if (targetW <= 768) {
      wide.forEach(function (x) {
        let p = responsiveElements[x.o.i].parentElement;
        let d = 0;
        while (p && d < 3) {
          if (p.tagName && p.tagName.toLowerCase() === "nav" && navMarked.indexOf(p) === -1) {
            navMarked.push(p);
            break;
          }
          d++; p = p.parentElement;
        }
      });
    }

    const sortedO = function (arr) {
      return arr.slice().sort(function (a, b) { return b.w - a.w; }).slice(0, 4).map(function (x) { return x.o; });
    };

    const hiWide = wide.filter(function (x) { return x.hi; }).length;
    pushCheck("oversizedContainers", "Oversized containers", hiWide > 0 ? 2 : (wide.length > 0 ? 1 : 0),
      wide.length > 0
        ? (hiWide > 0
            ? wide.length + " fixed-width box(es) wider than this viewport (incl. " + hiWide + " wider than the current window \u2014 provably broken)."
            : wide.length + " fixed-width box(es) wider than " + targetW + "px \u2014 verify they shrink via media queries.")
        : "No fixed-width boxes wider than this viewport.",
      sortedO(wide));

    const hiMin = minWide.filter(function (x) { return x.hi; }).length;
    pushCheck("minWidthFloors", "min-width floors", hiMin > 0 ? 2 : (minWide.length > 0 ? 1 : 0),
      minWide.length > 0
        ? minWide.length + " element(s) enforce a min-width wider than this viewport."
        : "No min-width rules exceed this viewport.",
      sortedO(minWide));

    const hiImg = imgWide.filter(function (x) { return x.hi; }).length;
    pushCheck("oversizedImages", "Oversized images", hiImg > 0 ? 2 : (imgWide.length > 0 ? 1 : 0),
      imgWide.length > 0
        ? imgWide.length + " image(s) render wider than this viewport."
        : "Images fit within this viewport.",
      sortedO(imgWide));

    pushCheck("textOverflow", "Text overflow", textOv.length > 0 ? 2 : 0,
      textOv.length > 0
        ? textOv.length + " element(s) truncate/overflow their text."
        : "No obvious text truncation detected.",
      sortedO(textOv));

    pushCheck("offscreen", "Out of view", offscreen.length > 0 ? 2 : 0,
      offscreen.length > 0
        ? offscreen.length + " element(s) stick out of the visible page area."
        : "No elements positioned outside the visible area.",
      sortedO(offscreen));

    if (targetW <= 768) {
      pushCheck("tapTargets", "Tap target sizes", smallTap.length > 0 ? 1 : 0,
        smallTap.length > 0
          ? smallTap.length + " interactive element(s) smaller than 40\u00d740px \u2014 hard to tap on touch screens."
          : "Interactive elements are at least 40\u00d740px.",
        smallTap.slice(0, 5).map(function (x) { return x.o; }));
      pushCheck("mobileNav", "Mobile navigation", navMarked.length > 0 ? 1 : 0,
        navMarked.length > 0
          ? "Navigation includes fixed-width content that likely overflows at this size."
          : "Navigation fits at this width.",
        navMarked.slice(0, 3).map(function (el) {
          const r = el.getBoundingClientRect();
          return addOffender(el, r.width);
        }));
    } else {
      pushCheck("tapTargets", "Tap target sizes", 0, "Not applicable at desktop widths.", []);
      pushCheck("mobileNav", "Mobile navigation", 0, "Not applicable at desktop widths.", []);
    }

    return { width: targetW, currentWidth: vw, checks: checks };
  }

  // Full responsive report drawn inside the preview-window page: screenshot of
  // the rendered page, verdict chips, every check with its offenders, and a
  // concrete fix for each. Root id stays #wspc-device-pill so re-runs replace
  // the previous panel instead of piling up duplicates.
  function deviceFixFor(kind) {
    const fixes = {
      viewport: "Add <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"> so mobile browsers render at the device scale instead of zoomed-out.",
      pageOverflow: "Locate the element forcing the page wide and give it max-width:100% (or clip the body wrapper with overflow-x:hidden).",
      oversizedContainers: "Add max-width:100% (or a fluid wrapper) so this box can shrink below its fixed pixel width.",
      minWidthFloors: "Replace the min-width with max-width:100% (+ box-sizing:border-box) so the box can shrink at this width.",
      oversizedImages: "Apply width:100%; height:auto (or max-width:100%) to the image so it scales with its container.",
      textOverflow: "Let the text wrap \u2014 remove white-space:nowrap, or give flex/grid children min-width:0 so they can shrink.",
      offscreen: "Trim or reposition the elements sticking out past the right edge, and drop fixed min-widths.",
      tapTargets: "Enlarge the interactive hit area to at least 40\u00d740px (padding or size) for touchscreens.",
      mobileNav: "Let the navigation wrap or switch to a collapsed (hamburger) menu below this width.",
      default: "Verify the layout reflows cleanly at this width and fix the offending element identified above."
    };
    return fixes[kind] || fixes.default;
  }

  function showDevicePill(data) {
    const existing = wspcOwned("wspc-device-pill");
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    if (!wspcOwned("wspc-pill-style")) {
      const st = document.createElement("style");
      st.id = "wspc-pill-style";
      wspcTag(st);
      st.textContent = "#wspc-device-pill{position:fixed;right:14px;bottom:14px;z-index:2147483647;" +
        "box-sizing:border-box;width:358px;max-width:calc(100vw - 20px);max-height:calc(100vh - 28px);" +
        "overflow-y:auto;pointer-events:auto;" +
        "background:rgba(28,29,34,.98);" +
        "color:#e1e3e8;font:12px/1.5 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;padding:12px 14px;" +
        "border-radius:8px;box-shadow:0 14px 40px rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.08);}" +
        "#wspc-device-pill *{box-sizing:border-box}" +
        "#wspc-device-pill .wspc-pill-head{display:flex;align-items:center;gap:6px}" +
        "#wspc-device-pill .wspc-pill-title{font-weight:800;font-size:12.5px;color:#e1e3e8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
        "#wspc-device-pill .wspc-btn{border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:#e1e3e8;font-size:10px;font-weight:700;border-radius:7px;padding:3px 8px;cursor:pointer;pointer-events:auto}" +
        "#wspc-device-pill .wspc-btn:hover{background:rgba(255,255,255,.12)}" +
        "#wspc-device-pill .wspc-pill-x{margin-left:auto;cursor:pointer;pointer-events:auto;border:0;background:none;color:#8c92a0;font-size:13px;line-height:1;padding:2px 6px;border-radius:5px}" +
        "#wspc-device-pill .wspc-pill-x:hover{color:#e1e3e8;background:rgba(255,255,255,.1)}" +
        "#wspc-device-pill .wspc-pill-actions{display:flex;gap:5px;margin-left:6px}" +
        "#wspc-device-pill .wspc-pill-note{font-size:10px;color:#8c92a0;margin:5px 0 8px}" +
        "#wspc-device-pill .wspc-shot{margin:2px 0 9px;border:1px solid rgba(255,255,255,.1);border-radius:8px;overflow:hidden;background:#16171a}" +
        "#wspc-device-pill .wspc-shot img{display:block;width:100%;height:auto}" +
        "#wspc-device-pill .wspc-shot-empty{font-size:10px;color:#8c92a0;text-align:center;padding:14px 8px}" +
        "#wspc-device-pill .wspc-pill-verdict{font-size:11.5px;font-weight:800;line-height:1.4;margin-bottom:7px}" +
        "#wspc-device-pill .wspc-pill-verdict.wspc-v-bad{color:#f43f5e}" +
        "#wspc-device-pill .wspc-pill-verdict.wspc-v-warn{color:#f59e0b}" +
        "#wspc-device-pill .wspc-pill-verdict.wspc-v-good{color:#10b981}" +
        "#wspc-device-pill .wspc-pill-chips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}" +
        "#wspc-device-pill .wspc-chip{font-size:10px;font-weight:800;padding:2px 8px;border-radius:999px;border:1px solid rgba(255,255,255,.12)}" +
        "#wspc-device-pill .wspc-chip.wspc-red{color:#fb7185;border-color:rgba(244,63,94,.4);background:rgba(244,63,94,.14)}" +
        "#wspc-device-pill .wspc-chip.wspc-yellow{color:#fbbf24;border-color:rgba(245,158,11,.4);background:rgba(245,158,11,.14)}" +
        "#wspc-device-pill .wspc-chip.wspc-green{color:#34d399;border-color:rgba(16,185,129,.4);background:rgba(16,185,129,.14)}" +
        "#wspc-device-pill .wspc-pill-list{display:flex;flex-direction:column;gap:6px}" +
        "#wspc-device-pill .wspc-row{border:1px solid rgba(255,255,255,.06);border-radius:8px;padding:7px 9px;background:rgba(255,255,255,.025)}" +
        "#wspc-device-pill .wspc-row-head{display:flex;align-items:center;gap:7px}" +
        "#wspc-device-pill .wspc-dot{flex:0 0 auto;width:8px;height:8px;border-radius:50%}" +
        "#wspc-device-pill .wspc-dot.wspc-d2{background:#f43f5e}#wspc-device-pill .wspc-dot.wspc-d1{background:#f59e0b}#wspc-device-pill .wspc-dot.wspc-d0{background:#10b981}" +
        "#wspc-device-pill .wspc-row-label{font-size:11px;font-weight:700;color:#e1e3e8}" +
        "#wspc-device-pill .wspc-row-msg{font-size:10px;color:#8c92a0;line-height:1.45;margin-top:2px}" +
        "#wspc-device-pill .wspc-off{display:flex;flex-wrap:wrap;gap:4px;margin-top:5px}" +
        "#wspc-device-pill .wspc-off-chip{font-size:9px;font-weight:600;color:#a6acb9;background:rgba(138,146,160,.14);border-radius:6px;padding:1px 6px;font-family:ui-monospace,Consolas,monospace}" +
        "#wspc-device-pill .wspc-fix{font-size:10px;color:#818cf8;background:rgba(99,102,241,.12);border:1px solid rgba(99,102,241,.28);border-radius:7px;padding:5px 8px;margin-top:6px;line-height:1.4}" +
        "#wspc-device-pill .wspc-fix b{color:#e1e3e8}";
      if (document.head && document.head.appendChild) document.head.appendChild(st);
    }
    let bad = 0, warn = 0, good = 0;
    data.checks.forEach(function (c) {
      if (c.status === 2) bad++;
      else if (c.status === 1) warn++;
      else good++;
    });
    const w = data.width;
    const h = data.height || Math.round(window.innerHeight);
    const pill = document.createElement("div");
    pill.id = "wspc-device-pill";
    wspcTag(pill);

    const verdict = bad > 0
      ? "Needs work \u2014 " + bad + " provable problem" + (bad === 1 ? "" : "s") + " at " + w + "px."
      : (warn > 0
          ? "Mostly fine \u2014 " + warn + " pattern" + (warn === 1 ? "" : "s") + " to double-check at " + w + "px."
          : "Looks good \u2014 no issues detected at " + w + "px.");
    const verdictCls = bad > 0 ? "wspc-v-bad" : (warn > 0 ? "wspc-v-warn" : "wspc-v-good");

    let listHtml = "";
    data.checks.forEach(function (c) {
      const chipCls = c.status === 2 ? "wspc-d2" : (c.status === 1 ? "wspc-d1" : "wspc-d0");
      listHtml += '<div class="wspc-row">'
        + '<div class="wspc-row-head"><span class="wspc-dot ' + chipCls + '"></span><span class="wspc-row-label">' + c.label + '</span></div>'
        + '<div class="wspc-row-msg">' + c.message + '</div>';
      if (c.offenders && c.offenders.length) {
        let offHtml = "";
        (c.offenders || []).slice(0, 5).forEach(function (o) {
          offHtml += '<span class="wspc-off-chip">' + (o.label || "element") + '</span>';
        });
        listHtml += '<div class="wspc-off">' + offHtml + '</div>';
      }
      if (c.status > 0) {
        listHtml += '<div class="wspc-fix"><b>Fix:</b> ' + deviceFixFor(c.id) + '</div>';
      }
      listHtml += '</div>';
    });

    pill.innerHTML =
      '<div class="wspc-pill-head"><span class="wspc-pill-title">Responsive report \u00B7 ' + w + ' \u00D7 ' + h + '</span>' +
      '<span class="wspc-pill-actions">' +
      '<button class="wspc-btn wspc-cap" title="Screenshot this device frame">Capture</button>' +
      '<button class="wspc-btn wspc-rerun" title="Re-run the responsive check">Re-run</button>' +
      '</span>' +
      '<button class="wspc-pill-x" aria-label="Dismiss">\u2715</button></div>' +
      '<div class="wspc-pill-note">Rendered at ' + w + 'px wide \u00B7 live scan of the real page in this window</div>' +
      '<div class="wspc-shot"></div>' +
      '<div class="wspc-pill-verdict ' + verdictCls + '">' + verdict + '</div>' +
      '<div class="wspc-pill-chips">' +
      '<span class="wspc-chip wspc-red">' + bad + ' issue' + (bad === 1 ? "" : "s") + '</span>' +
      '<span class="wspc-chip wspc-yellow">' + warn + ' attention</span>' +
      '<span class="wspc-chip wspc-green">' + good + ' good</span>' +
      '</div>' +
      '<div class="wspc-pill-list">' + listHtml + '</div>';

    const x = pill.querySelector(".wspc-pill-x");
    if (x) {
      x.onclick = function () {
        if (pill.parentNode) pill.parentNode.removeChild(pill);
        const ownStyle = wspcOwned("wspc-pill-style");
        if (ownStyle && ownStyle.parentNode) ownStyle.parentNode.removeChild(ownStyle);
      };
    }
    const rerun = pill.querySelector(".wspc-rerun");
    if (rerun) {
      rerun.onclick = function () { showDevicePill(scanResponsiveAt(w)); };
    }
    const cap = pill.querySelector(".wspc-cap");
    if (cap) {
      cap.onclick = function () {
        const shot = pill.querySelector(".wspc-shot");
        if (shot && !shot.getAttribute("data-captured")) {
          shot.setAttribute("data-captured", "1");
          shot.innerHTML = '<div class="wspc-shot-empty">Capturing this window\u2026</div>';
        }
        if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
          try {
            chrome.runtime.sendMessage({ action: "deviceCapture" }, function (res) {
              if (chrome.runtime.lastError || !res || !res.success || !res.image) {
                if (shot) shot.innerHTML = '<div class="wspc-shot-empty">Screenshot unavailable \u2014 re-open the device window and try again.</div>';
                return;
              }
              shot.innerHTML = '<img src="' + res.image + '" alt="Device-frame screenshot" />';
            });
          } catch (e) {
            shot.innerHTML = '<div class="wspc-shot-empty">Screenshot unavailable in this page context.</div>';
          }
        } else {
          shot.innerHTML = '<div class="wspc-shot-empty">Screenshot unavailable in this page context.</div>';
        }
      };
    }

    // Grab a screenshot automatically the first time the report renders.
    if (pill.querySelector(".wspc-shot") && typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
      try {
        chrome.runtime.sendMessage({ action: "deviceCapture" }, function (res) {
          const shot = pill.querySelector(".wspc-shot");
          if (!shot || shot.getAttribute("data-captured")) return;
          shot.setAttribute("data-captured", "1");
          if (chrome.runtime.lastError || !res || !res.success || !res.image) {
            shot.innerHTML = '<div class="wspc-shot-empty">Screenshot unavailable \u2014 re-open the device window and retry.</div>';
            return;
          }
          shot.innerHTML = '<img src="' + res.image + '" alt="Device-frame screenshot" />';
        });
      } catch (e) {}
    } else {
      const shotFirst = pill.querySelector(".wspc-shot");
      if (shotFirst) shotFirst.innerHTML = '<div class="wspc-shot-empty">Screenshot unavailable in this page context.</div>';
      if (shotFirst) shotFirst.removeAttribute("data-captured");
    }

    if (document.body && document.body.appendChild) document.body.appendChild(pill);
  }

  // =============================================
  // CONSOLE FIX REPORT
  // =============================================
  function logConsoleReport() {
    // Reuse the last analysis when available so the console report never
    // triggers another full *-scan of the document.
    const dom = (currentResults && currentResults.dom) ? currentResults.dom : analyzeDOM();
    console.groupCollapsed("%cWeb Doctor",
      "background:#4f46e5;color:#fff;padding:2px 8px;border-radius:3px;font-weight:700");
    console.info("Total elements:", dom.totalElements,
      "| Max depth:", dom.maxDepth,
      "| Largest subtree:", (dom.hotspots[0] ? dom.hotspots[0].label : "n/a"));
    if (dom.duplicateIds.length) {
      console.warn("Duplicate IDs:", dom.duplicateIds.map(function (d) { return d.id; }).join(", "));
    }
    console.log("--- Fix commands to paste in this console ---");
    console.log("// 1) Find the 10 largest DOM subtrees:");
    console.log("[...document.querySelectorAll('*')].map(el=>({count:el.querySelectorAll('*').length,tag:el.tagName.toLowerCase(),id:el.id})).sort((a,b)=>b.count-a.count).slice(0,10)");
    console.log("// 2) Find duplicate IDs:");
    console.log("[...document.querySelectorAll('[id]')].reduce((m,e)=>(m[e.id]=(m[e.id]||0)+1,m),{})");
    console.log("// 3) Count elements nested deeper than 20 levels:");
    console.log("[...document.querySelectorAll('*')].filter(el=>{let d=0,n=el;while(n.parentElement){d++;n=n.parentElement}return d>20}).length");
    console.log("// 4) Remove truly empty wrappers (review before running!):");
    console.log("[...document.querySelectorAll('div,section,span')].filter(el=>!el.textContent.trim()&&!el.querySelectorAll('*').length&&!el.querySelector('img,svg,canvas,iframe,input')).forEach(el=>el.remove())");
    console.groupEnd();
  }

  // =============================================
  // SCORE CALCULATOR
  // =============================================
  function calculateScores(results) {
    const domScore = calcDomScore(results.dom);
    const perfScore = calcPerfScore(results.performance);
    const seoScore = calcSeoScore(results.seo, results.headings);
    const accessScore = calcAccessScore(results.accessibility);
    const structScore = calcStructScore(results.structure);

    const overall = Math.round((domScore + perfScore + seoScore + accessScore + structScore) / 5);

    return {
      overall: overall,
      dom: domScore,
      performance: perfScore,
      seo: seoScore,
      accessibility: accessScore,
      structure: structScore
    };
  }

  function calcDomScore(dom) {
    let score = 100;
    if (dom.totalElements > 3000) score -= 30;
    else if (dom.totalElements > 1500) score -= 15;
    else if (dom.totalElements > 800) score -= 5;

    if (dom.maxDepth > 20) score -= 25;
    else if (dom.maxDepth > 15) score -= 15;
    else if (dom.maxDepth > 10) score -= 5;

    if (dom.duplicateIds.length > 0) score -= dom.duplicateIds.length * 5;
    if (dom.excessiveNestingCount > 10) score -= 15;
    else if (dom.excessiveNestingCount > 5) score -= 8;

    if (dom.emptyElements > 50) score -= 10;
    else if (dom.emptyElements > 20) score -= 5;

    return Math.max(0, Math.min(100, score));
  }

  function calcPerfScore(perf) {
    let score = 100;

    if (perf.loadTime !== null) {
      if (perf.loadTime > 5000) score -= 30;
      else if (perf.loadTime > 3000) score -= 20;
      else if (perf.loadTime > 1500) score -= 10;
    }

    if (perf.firstContentfulPaint !== null) {
      if (perf.firstContentfulPaint > 3000) score -= 25;
      else if (perf.firstContentfulPaint > 1800) score -= 15;
      else if (perf.firstContentfulPaint > 1000) score -= 5;
    }

    // Core Web Vitals — applied only when the page actually surfaced the value.
    if (perf.largestContentfulPaint !== null) {
      if (perf.largestContentfulPaint > 4000) score -= 20;
      else if (perf.largestContentfulPaint > 2500) score -= 12;
    }
    if (perf.cumulativeLayoutShift !== null) {
      if (perf.cumulativeLayoutShift > 0.25) score -= 15;
      else if (perf.cumulativeLayoutShift > 0.1) score -= 8;
    }
    if (perf.interactionToNextPaint !== null) {
      if (perf.interactionToNextPaint > 500) score -= 15;
      else if (perf.interactionToNextPaint > 200) score -= 8;
    }

    if (perf.resourceCount > 100) score -= 15;
    else if (perf.resourceCount > 60) score -= 8;

    if (perf.thirdPartyCount > 20) score -= 15;
    else if (perf.thirdPartyCount > 10) score -= 8;

    if ((perf.jsBytes || 0) > 1024 * 1024) score -= 15;
    else if ((perf.jsBytes || 0) > 600 * 1024) score -= 8;

    if (perf.largeResources.length > 3) score -= 10;
    else if (perf.largeResources.length > 0) score -= 5;

    return Math.max(0, Math.min(100, score));
  }

  function calcSeoScore(seo, headings) {
    let score = 100;

    if (!seo.hasTitle) score -= 20;
    else if (!seo.titleOk) score -= 8;

    if (!seo.hasDescription) score -= 20;
    else if (!seo.descriptionOk) score -= 8;

    if (!seo.hasCanonical) score -= 10;
    if (seo.multipleCanonicals) score -= 5;

    if (seo.hasNoindex) score -= 20;

    if (!seo.hasOgTitle) score -= 5;
    if (!seo.hasOgDescription) score -= 5;
    if (!seo.hasOgImage) score -= 5;

    if (!seo.hasStructuredData) score -= 5;

    if (!headings.hasH1) score -= 10;
    else if (!headings.singleH1) score -= 5;

    if (headings.issues.length > 2) score -= 10;
    else if (headings.issues.length > 0) score -= 5;

    return Math.max(0, Math.min(100, score));
  }

  function calcAccessScore(acc) {
    let score = 100;

    acc.issues.forEach(function (issue) {
      if (issue.type === "error") score -= 12;
      else score -= 6;
    });

    return Math.max(0, Math.min(100, score));
  }

  function calcStructScore(struct) {
    let score = 100;

    if (!struct.hasHeader) score -= 15;
    if (!struct.hasNav) score -= 10;
    if (!struct.hasMain) score -= 15;
    if (!struct.hasFooter) score -= 15;
    if (struct.hasSections === 0) score -= 5;
    if (!struct.htmlLang) score -= 10;

    return Math.max(0, Math.min(100, score));
  }

  // =============================================
  // UTILITIES
  // =============================================
  function formatBytes(bytes) {
    if (bytes === 0) return "0 B";
    var k = 1024;
    var sizes = ["B", "KB", "MB", "GB"];
    var i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  }

  // =============================================
  // DEV-MOD: link checker, typography, style mark
  // =============================================

  function devEsc(str) {
    return String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function devLabel(el) {
    try {
      var t = el.tagName ? el.tagName.toLowerCase() : "element";
      if (t === "a") {
        var hasImg = false;
        try { hasImg = !!el.querySelector("img"); } catch (e) { hasImg = false; }
        return (hasImg ? "Image link" : "Link") + (el.id ? " #" + el.id : "");
      }
      if (t === "button") return "Button" + (el.id ? " #" + el.id : "");
      if (t === "input") {
        var ty = (el.getAttribute && el.getAttribute("type")) || "";
        return ty ? "Button (" + ty + ")" : "Button";
      }
      return t + (el.id ? " #" + el.id : "");
    } catch (e) {
      return "Element";
    }
  }

  function devContextChain(el) {
    var chain = [];
    var node = el.parentElement || null;
    while (node && chain.length < 4) {
      var t = node.tagName ? node.tagName.toLowerCase() : "";
      var cls = (node.className && typeof node.className === "string") ? node.className : "";
      if (t === "header") chain.push("Header");
      else if (t === "footer") chain.push("Footer");
      else if (t === "nav") chain.push("Navigation");
      else if (t === "main") chain.push("Content");
      else if (t === "form") chain.push("Form");
      else if (t === "section") chain.push(/hero/i.test(cls) ? "Hero" : "Section");
      else if (t === "article" || t === "aside") chain.push("Content");
      else if (/cta/i.test(cls)) chain.push("CTA");
      else if (/hero/i.test(cls)) chain.push("Hero");
      else if (/card/i.test(cls)) chain.push("Card");
      else if (/menu|navbar/i.test(cls)) chain.push("Navigation");
      node = node.parentElement || null;
    }
    if (chain.length === 0) chain.push("Content");
    return chain.slice(0, 2);
  }

  function devOrigin(el) {
    var chain = devContextChain(el);
    return chain.length ? chain[0] : "Content";
  }

  // id -> unique? cache. Whole-document querySelectorAll is the most expensive
  // part of selector building; the scanning DOM is stable within one scan, so
  // cache per scan and reset it in collectLinkRows.
  var idUniqCache = Object.create(null);

  function devSelectorFor(el) {
    try {
      var id = el && (el.id || (el.getAttribute && el.getAttribute("id")));
      if (id) {
        var idStr = String(id);
        var idSel = "#" + idStr.replace(/([^a-zA-Z0-9_-])/g, "\\$1");
        if (idUniqCache[idStr] === undefined) {
          var idCount = 0;
          try { idCount = document.querySelectorAll(idSel).length; } catch (e) { idCount = 0; }
          idUniqCache[idStr] = idCount === 1;
        }
        if (idUniqCache[idStr]) return idSel;
      }
      var chain = [];
      var n = el;
      while (n && n.tagName && chain.length < 12) {
        var t = String(n.tagName).toLowerCase();
        if (t === "html" || t === "body") { chain.unshift(t); if (t === "html") break; n = n.parentElement || null; continue; }
        var idx = 1;
        var sib = n.previousElementSibling;
        while (sib) {
          if (sib.tagName === n.tagName) idx++;
          sib = sib.previousElementSibling;
        }
        chain.unshift(t + ":nth-of-type(" + idx + ")");
        n = n.parentElement || null;
      }
      if (chain.length === 0) return "*";
      var best = chain.join(" > ");
      var limit = Math.min(chain.length, 5);
      for (var start = 1; start < limit - 1; start++) {
        var candidate = chain.slice(start).join(" > ");
        var matched = 0;
        try { matched = document.querySelectorAll(candidate).length; } catch (e) { matched = 0; }
        if (matched === 1) { best = candidate; break; }
      }
      return best;
    } catch (e) {
      return "*";
    }
  }

  function devRow(el, type, status, code, reason, url) {
    var hrefVal = url;
    if (hrefVal === null || hrefVal === undefined) {
      var raw = el.getAttribute ? el.getAttribute("href") : null;
      hrefVal = raw ? String(raw).trim() : "";
    }
    return {
      type: type || null,
      status: status,
      code: code === null || code === undefined ? null : code,
      reason: reason || null,
      url: String(hrefVal),
      finalUrl: null,
      label: devLabel(el),
      origin: devOrigin(el),
      path: devContextChain(el).concat(devLabel(el)).join(" \u2192 "),
      selector: devSelectorFor(el)
    };
  }

  // Resolves whether a named fragment (the part after "#") exists on this
  // page, either as a regular id or as a legacy <a name="..."> anchor.
  function fragmentHasTarget(frag) {
    if (!frag) return false;
    try {
      if (document.getElementById(frag)) return true;
    } catch (e) {}
    try {
      var named = document.getElementsByName(frag);
      if (named && named.length > 0) return true;
    } catch (e) {}
    return false;
  }

  // Fragments used purely as popup/modal/accordion/menu triggers are wired by
  // a click handler and never need a matching element, so they must not be
  // flagged. Detect the common signalling attributes/roles/classes.
  function fragmentJsWired(el) {
    if (!el) return false;
    var attrList = ["aria-haspopup", "aria-controls", "data-toggle", "data-bs-toggle", "data-target", "data-bs-target", "data-modal", "data-modal-target", "data-accordion", "data-nav", "data-open", "aria-expanded"];
    for (var i = 0; i < attrList.length; i++) {
      var v = el.getAttribute ? el.getAttribute(attrList[i]) : null;
      if (v !== null && v !== undefined && v !== "") return true;
    }
    var role = el.getAttribute ? el.getAttribute("role") : null;
    if (role === "button" || role === "tab" || role === "menuitem" || role === "dialog") return true;
    var cls = (el.className && typeof el.className === "string") ? el.className : "";
    if (/(?:^|\s)(?:dropdown-toggle|accordion-[a-z-]+|nav-link|menu-item|modal-trigger|js-[\w-]+|toggle|tab-link)(?:\s|$)/i.test(cls)) return true;
    // Bare onclick handlers that call preventDefault/stopPropagation are the
    // strongest JS-wiring signal of all.
    if (el.getAttribute && el.getAttribute("onclick")) return true;
    if (el.closest) {
      try {
        if (el.closest("[data-toggle], [data-bs-toggle], [data-target], [data-bs-target], .dropdown-menu, .accordion")) return true;
      } catch (e) {}
    }
    return false;
  }

  // Tracking / analytics / affiliate / retargeting URLs produce false
  // positives on 404 checks (a dead click-tracking pixel is not a real broken
  // link), so rows that look like them are skipped before any probe runs.
  function isTrackingUrl(url) {
    var u = String(url || "");
    if (!u) return false;
    if (/[?&](?:utm_|fbclid|gclid|msclkid|mc_cid|mc_eid|igshid|phpsessid|srsltid|li_fat_id|twclid|affiliate|aff_id|ref_code|referrer|click_id|clickid|s_kwcid|cvid|oly_enc_id|vero_id|hsa_cam|wbraid|gbraid|mkt_tok|hsa_tgt|hsa_grp|hsa_acc|hsa_net|hsa_src|hsa_ad|hsa_kw|hsa_mt|hsa_ver|_hsenc|_hsmi|hsCtaTracking|__hssc|__hstc|__hsfp|s_cid|zanpid|itm_(?:campaign|source|medium|keyword)|%40|adid|dclid|gclsrc|utm_source|utm_medium|utm_campaign|utm_term|utm_content|mc_[a-z]+|email_workflow|custid|cjdata|subid|aff_sub|s1|s2)/i.test(u)) return true;
    var host = "";
    try { host = new URL(u).hostname; } catch (e) { host = ""; }
    if (/^(?:clk\.click|r\.click|links\.|tracking\.|click\.|go\.|out\.|redirect\.|clicks\.|lb\.amaprint|adservice\.)/i.test(host)) return true;
    if (/^(?:www\.|m\.)?(?:amazon\.[a-z.]+|ebay\.[a-z]+|alibaba|aliexpress)(?:\b|$)/i.test(host) && /[?&](?:tag|aff|ef_id|pf_rd)/i.test(u)) return true;
    return false;
  }

  function collectLinkRows() {
    var ROW_CAP = 500;
    var rows = [];
    var scanned = 0;
    var truncatedRows = false;
    idUniqCache = Object.create(null);
    var els = document.querySelectorAll("a, button, input[type='submit'], input[type='button'], [role='button']");
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      scanned++;
      if (rows.length >= ROW_CAP) { truncatedRows = true; continue; }
      var getAttr = function (name) { return el.getAttribute ? el.getAttribute(name) : null; };
      var t = el.tagName ? el.tagName.toLowerCase() : "";
      var raw = getAttr("href");
      var hrefVal = raw ? String(raw).trim() : "";
      var isAnchor = t === "a";
      if (!isAnchor) {
        // Buttons with "#" or javascript: hrefs are usually popup/menu
        // triggers wired by a click handler, so only a single "#" (a link
        // that can never open anything) is a genuine failure.
        if (raw !== null && hrefVal === "#") {
          rows.push(devRow(el, "Button without real link", "broken", null, "\u201C#\u201D placeholder href \u2014 a single-# link opens nothing"));
          continue;
        }
        if (raw !== null && hrefVal === "") {
          rows.push(devRow(el, "Button without real link", "unverified", null, "Empty href on a button \u2014 usually wired by a click handler, not flagged"));
          continue;
        }
        if (getAttr("data-href")) { rows.push(devRow(el, "Button without real link", "unverified", null, "Only a data-href attribute \u2014 handled by scripts, not flagged")); continue; }
        if (typeof el.querySelector === "function" && el.querySelector("a[href]")) continue;
        var type = getAttr("type") || "";
        if (type === "submit" || type === "button") {
          if (typeof el.closest === "function" && el.closest("form")) continue;
        } else if (type) {
          continue;
        }
        if (getAttr("aria-haspopup") || getAttr("aria-expanded")) continue;
        var text = (el.textContent || "").trim();
        var linky = /(read ?more|learn ?more|click ?here|see ?more|view ?all|more|details|continue|get started|sign ?up|register|download|shop|buy|get now|try now|watch|listen|subscribe)/i.test(text);
        if (linky && text.length < 60) rows.push(devRow(el, "Button without link", "unverified", null, "Looks like a button/CTA but has no href \u2014 may be wired by JS, not flagged"));
        continue;
      }
      if (raw === null) { rows.push(devRow(el, "Missing href", "unverified", null, "href attribute missing \u2014 there is no URL to verify, so it is not flagged")); continue; }
      if (hrefVal === "") { rows.push(devRow(el, "Empty href", "unverified", null, "Empty href \u2014 there is no URL to verify, so it is not flagged")); continue; }
      if (/^#/.test(hrefVal)) {
        // "#fragment" links: a bare "#" always opens nothing, and a named
        // fragment that matches no element on the page opens nothing either,
        // so both are flagged broken. A fragment that resolves to a real
        // element (or that carries JS-trigger signals such as popup/modal/
        // accordion wiring) is left alone to avoid false positives.
        var frag = hrefVal.slice(1);
        if (!frag) {
          rows.push(devRow(el, "Placeholder link", "broken", null, "\u201C#\u201D placeholder \u2014 a single-# link opens nothing"));
        } else if (fragmentHasTarget(frag)) {
          rows.push(devRow(el, "In-page anchor", "valid", null, "In-page anchor to #" + frag + " \u2014 the target element exists on this page"));
        } else if (fragmentJsWired(el)) {
          rows.push(devRow(el, "JS-wired fragment", "unverified", null, "Fragment to #" + frag + " \u2014 has JS-trigger signals (popup/modal/accordion wiring), not flagged"));
        } else {
          rows.push(devRow(el, "Missing anchor target", "unverified", null, "#" + frag + " points to no element on this page \u2014 could be SPA hash routing or a dynamic target, so it is not flagged as broken"));
        }
        continue;
      }
      if (/^javascript:/i.test(hrefVal)) { rows.push(devRow(el, "JavaScript URL", "unverified", null, "javascript: URL \u2014 runs code, not a web link")); continue; }
      if (/^(mailto:|tel:|sms:)/i.test(hrefVal)) {
        var scheme = (hrefVal.match(/^([a-z]+):/) || [])[1] || "link";
        rows.push(devRow(el, null, "valid", null, scheme + ": scheme \u2014 not a web page (not verified)"));
        continue;
      }
      var u = null;
      try { u = new URL(hrefVal, location.href); } catch (e) { rows.push(devRow(el, "Invalid URL", "unverified", null, "Malformed URL \u2014 cannot be parsed, so not flagged")); continue; }
      if (u.protocol !== "http:" && u.protocol !== "https:") {
        rows.push(devRow(el, "Non-HTTP scheme", "unverified", null, u.protocol.replace(":", "") + ": URL \u2014 cannot be verified"));
        continue;
      }
      if (isTrackingUrl(u.href)) {
        rows.push(devRow(el, "Tracking/affiliate URL", "unverified", null, "Tracking, analytics or affiliate URL \u2014 skipped to avoid false positives"));
        continue;
      }
      rows.push(devRow(el, null, "pending", null, null, u.href));
    }
    return { rows: rows, scanned: scanned, rowsTruncated: truncatedRows };
  }

  function httpReason(status) {
    if (status === 404) return "HTTP 404 \u2014 page not found";
    if (status === 403) return "HTTP 403 \u2014 forbidden";
    if (status === 401) return "HTTP 401 \u2014 authentication required";
    if (status === 500) return "HTTP 500 \u2014 server error";
    if (status === 503) return "HTTP 503 \u2014 service unavailable";
    if (status === 410) return "HTTP 410 \u2014 gone";
    if (status === 429) return "HTTP 429 \u2014 too many requests";
    return "HTTP " + status + " \u2014 request failed";
  }

  async function checkBrokenLinkStatus(url) {
    var status = null;
    var redirected = false;
    var finalUrl = null;
    var timedOut = false;
    var ctrl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { timedOut = true; ctrl.abort(); }, 8000) : null;
    try {
      var opts = { cache: "no-store", redirect: "follow", credentials: "omit", signal: ctrl ? ctrl.signal : undefined };
      var res = await fetch(url, Object.assign({ method: "HEAD" }, opts));
      // 405/501 mean "HEAD not supported" but the resource usually exists, so a
      // GET fallback is safe there. Never GET on 403 (would retry on a blocked /
      // state-changing endpoint) — report the HEAD status instead.
      if (!res.ok && (res.status === 405 || res.status === 501)) {
        res = await fetch(url, Object.assign({ method: "GET" }, opts));
      }
      status = res.status;
      redirected = !!res.redirected;
      try { finalUrl = res.url || null; } catch (e) { finalUrl = null; }
    } catch (e) {
      status = null;
    } finally {
      if (timer) clearTimeout(timer);
    }
    return { status: status, redirected: redirected, finalUrl: finalUrl, timedOut: timedOut };
  }

  function applyResult(row, result) {
    if (!result || result.status === null || result.status === undefined || result.status === 0) {
      row.status = "unverified";
      row.code = null;
      row.reason = result && result.timedOut ? "Timed out while verifying" : "Unable to verify \u2014 the browser blocked the request (CORS, CSP or network restriction, or an external link without additional permission)";
      return;
    }
    var final = result.status;
    row.finalUrl = result.finalUrl;
    // Only a real 404/410 page is a certain dead URL. Anything else that is
    // not a plain 2xx could still work for real visitors (auth, WAF, rate
    // limiting, temporary server errors), so it is reported as unable to
    // verify instead of being flagged as broken.
    if (final === 404 || final === 410) {
      row.status = "broken";
      row.code = final;
      row.type = "HTTP " + final;
      row.reason = httpReason(final);
    } else if (final >= 200 && final < 300 && !result.redirected) {
      row.status = "valid";
      row.code = final;
    } else if (final >= 400) {
      row.status = "unverified";
      row.code = final;
      row.type = "HTTP " + final;
      row.reason = httpReason(final) + " \u2014 not a 404, treated as unable to verify";
    } else {
      row.status = "redirect";
      row.code = final;
      row.type = "Redirect";
      row.reason = "Redirects to " + (result.finalUrl ? result.finalUrl : row.url) + (result.redirected ? "" : " (redirect target not fully followed)");
    }
  }

  async function analyzeBrokenLinks() {
    var scan = collectLinkRows();
    var pending = scan.rows.filter(function (r) { return r.status === "pending"; });
    var seen = Object.create(null);
    var uniq = [];
    pending.forEach(function (r) {
      if (!seen[r.url]) { seen[r.url] = true; uniq.push(r.url); }
    });
    var CAP = 50;
    var capped = uniq.length > CAP;
    var toTest = capped ? uniq.slice(0, CAP) : uniq;
    var checked = await poolScan(toTest);
    var byUrl = Object.create(null);
    toTest.forEach(function (url, idx) { byUrl[url] = checked[idx]; });
    pending.forEach(function (row) {
      if (!(row.url in byUrl)) {
        row.status = "unverified";
        row.reason = "Not tested \u2014 scan limit of " + CAP + " unique URLs reached";
        return;
      }
      applyResult(row, byUrl[row.url]);
    });
    var counts = { valid: 0, broken: 0, redirect: 0, unverified: 0, total: scan.rows.length };
    scan.rows.forEach(function (r) { counts[r.status] = (counts[r.status] || 0) + 1; });
    return {
      checkedElements: scan.scanned,
      urlsChecked: checked.length,
      truncated: capped,
      rowsTruncated: !!scan.rowsTruncated,
      counts: counts,
      rows: scan.rows
    };
  }

  // Verify URLs with a small concurrency pool (never 50 parallel requests). A
  // status of null means CORS/CSP blocked the probe and would block again, so
  // it is reported immediately as unverified. Only rate limits (429) and
  // timeouts are retried once, and never after the scan deadline.
  async function poolScan(urls) {
    var pool = Math.max(1, Math.min(6, urls.length));
    var results = new Array(urls.length);
    var next = 0;
    var deadline = Date.now() + 30000;
    return new Promise(function (resolve) {
      function worker() {
        var i = next++;
        if (i >= urls.length) { resolve(results); return; }
        var again = function (r2) { results[i] = r2; worker(); };
        checkBrokenLinkStatus(urls[i]).then(function (res) {
          if ((res.status === 429 || res.timedOut) && Date.now() < deadline) {
            checkBrokenLinkStatus(urls[i]).then(again, again);
          } else {
            again(res);
          }
        }, again);
      }
      for (var w = 0; w < pool; w++) worker();
    });
  }

  function cleanFont(family) {
    return String(family || "").replace(/['"]/g, "").trim();
  }

  function analyzeTypography() {
    var tags = ["h1", "h2", "h3", "h4", "h5", "h6", "p"];
    var groups = [];
    var SAMPLE_MAX = 200;
    for (var ti = 0; ti < tags.length; ti++) {
      var tag = tags[ti];
      var els = document.querySelectorAll(tag);
      var step = Math.max(1, Math.ceil(els.length / SAMPLE_MAX));
      var mode = Object.create(null);
      var dominant = null;
      var domCount = 0;
      for (var i = 0; i < els.length; i += step) {
        var cs;
        try { cs = window.getComputedStyle(els[i]); } catch (e) { continue; }
        var font = cleanFont(cs.fontFamily);
        var size = cs.fontSize;
        var lh = cs.lineHeight;
        var fw = cs.fontWeight;
        var fs = cs.fontStyle || "normal";
        var ls = cs.letterSpacing || "normal";
        var tt = cs.textTransform || "none";
        var ta = cs.textAlign || "start";
        var td = cs.textDecorationLine || "none";
        var col = cs.color || "";
        var bg = cs.backgroundColor || "";
        var key = [font, size, lh, fw, fs, ls, tt, ta, td, col, bg].join("|");
        mode[key] = (mode[key] || 0) + 1;
        if (mode[key] > domCount) {
          domCount = mode[key];
          dominant = { font: font, size: size, lh: lh, fw: fw, fs: fs, ls: ls, tt: tt, ta: ta, td: td, col: col, bg: bg };
        }
      }
      var variants = Object.create(null);
      var dKey = dominant ? [dominant.font, dominant.size, dominant.lh, dominant.fw, dominant.fs, dominant.ls, dominant.tt, dominant.ta, dominant.td, dominant.col, dominant.bg].join("|") : null;
      for (var key2 in mode) {
        if (!Object.prototype.hasOwnProperty.call(mode, key2)) continue;
        if (key2 === dKey) continue;
        var parts = key2.split("|");
        var vk = parts[0] + " " + parts[1];
        variants[vk] = (variants[vk] || 0) + mode[key2];
      }
      var variantList = Object.keys(variants).map(function (vk) {
        var sp = vk.lastIndexOf(" ");
        return { font: vk.slice(0, sp), size: vk.slice(sp + 1), count: variants[vk] };
      }).sort(function (a, b) { return b.count - a.count; }).slice(0, 3);
      groups.push({
        tag: tag.toUpperCase(),
        count: els.length,
        font: dominant ? dominant.font : null,
        size: dominant ? dominant.size : null,
        lineHeight: dominant ? dominant.lh : null,
        weight: dominant ? dominant.fw : null,
        style: dominant ? dominant.fs : null,
        letterSpacing: dominant ? dominant.ls : null,
        textTransform: dominant ? dominant.tt : null,
        textAlign: dominant ? dominant.ta : null,
        color: dominant ? dominant.col : null,
        background: dominant ? dominant.bg : null,
        dominantCount: domCount,
        variants: variantList,
        props: dominant ? [
          { prop: "font-family", value: dominant.font },
          { prop: "font-size", value: dominant.size },
          { prop: "font-weight", value: dominant.fw },
          { prop: "font-style", value: dominant.fs },
          { prop: "line-height", value: dominant.lh },
          { prop: "letter-spacing", value: dominant.ls },
          { prop: "text-transform", value: dominant.tt },
          { prop: "text-align", value: dominant.ta },
          { prop: "text-decoration-line", value: dominant.td },
          { prop: "color", value: dominant.col },
          { prop: "background-color", value: dominant.bg }
        ] : []
      });
    }
    return { groups: groups };
  }

  // =============================================
  // ELEMENTOR DOM INSPECTOR (on-demand)
  // =============================================
  // Ranks the Elementor sections / flex containers that contribute the most
  // DOM on the page, locates each one (page or Elementor editor), and gives
  // concrete suggestions for reducing the markup. No observers, no polling:
  // it runs exactly when the user asks and answers in the message response.
  function elementorEditorActive() {
    try {
      if (window.elementor) return true;
      var b = document.body;
      if (b && b.classList && b.classList.contains("elementor-editor-active")) return true;
      if (location.search && /[?&]elementor\b/.test(location.search)) return true;
    } catch (e) {}
    return false;
  }

  function analyzeElementorStructure() {
    var editor = elementorEditorActive();
    var previewIframe = false;
    try { previewIframe = !!document.querySelector("#elementor-preview-iframe"); } catch (e) {}

    var totalEls = 0;
    try { totalEls = document.querySelectorAll("*").length; } catch (e) {}

    // Top-level Elementor regions: classic sections and flex containers that
    // are not themselves nested inside another Elementor section/container.
    var possible = [];
    try {
      possible = document.querySelectorAll(".elementor-section, .e-con, .e-container");
    } catch (e) {}

    var ELE_ANCESTOR_RE = /(?:^|\s)(?:elementor-section|e-con|e-container)(?:\s|$)/;
    var CONTAINER_CLS_RE = /(?:^|\s)(?:e-con|e-container|elementor-container|elementor-column|elementor-widget-wrap)(?:\s|$)/;
    var WIDGET_CLS_RE = /(?:^|\s)elementor-widget(?:\s|$)/;
    var WRAP_CLS_RE = /(?:^|\s)elementor-widget-wrap(?:\s|$)/;
    var HIDDEN_CLS_RE = /(?:^|\s)elementor-hidden-(?:desktop|tablet|mobile)(?:\s|$)/;
    var WIDGET_TYPE_RE = /elementor-widget-([a-zA-Z0-9_-]+)(?:\s|$)/;
    var MAX_NODES = 4096;
    // Nesting only counts user-created Elementor layout containers, not the
    // auto-generated elementor-widget-wrap that Elementor inserts for every widget.
    var NESTING_CLS_RE = /(?:^|\s)(?:e-con|e-container|elementor-column)(?:\s|$)/;

    function clsOf(node) {
      return (node.className && typeof node.className === "string") ? node.className : "";
    }

    function roots() {
      var out = [];
      for (var i = 0; i < possible.length; i++) {
        var cand = possible[i];
        var p = cand.parentElement;
        var inside = false;
        while (p) {
          if (ELE_ANCESTOR_RE.test(clsOf(p))) { inside = true; break; }
          p = p.parentElement;
        }
        if (!inside) out.push(cand);
      }
      return out;
    }

    function measure(home) {
      var counted = 0;
      var widgets = 0, containers = 0, wraps = 0, spacers = 0, hidden = 0;
      var maxContainerDepth = 0;
      var widgetTypes = Object.create(null);
      var truncated = false;
      // stack entries: [element, depth, containerNesting]
      var homeNesting = /(?:^|\s)(?:e-con|e-container|elementor-column)(?:\s|$)/.test(clsOf(home)) ? 1 : 0;
      var st = [[home, 1, homeNesting]];
      while (st.length && !truncated) {
        var pair = st.pop();
        var node = pair[0];
        var depth = pair[1];
        var containerNesting = pair[2];
        counted++;
        if (counted >= MAX_NODES) truncated = true;
        var c = clsOf(node);
        if (WIDGET_CLS_RE.test(c)) {
          widgets++;
          var m = c.match(WIDGET_TYPE_RE);
          var type = m ? m[1] : "widget";
          if (type === "spacer") spacers++;
          widgetTypes[type] = (widgetTypes[type] || 0) + 1;
        }
        var isElem = CONTAINER_CLS_RE.test(c);
        if (isElem) containers++;
        if (NESTING_CLS_RE.test(c)) {
          if (containerNesting > maxContainerDepth) maxContainerDepth = containerNesting;
        }
        if (WRAP_CLS_RE.test(c)) wraps++;
        if (HIDDEN_CLS_RE.test(c)) hidden++;
        var kids = node.children;
        for (var k = kids.length - 1; k >= 0; k--) {
          var childNesting = NESTING_CLS_RE.test(clsOf(node)) ? containerNesting + 1 : containerNesting;
          st.push([kids[k], depth + 1, childNesting]);
        }
      }

      // Empty wrappers live under this section with no widget inside them.
      var emptyWraps = 0;
      try {
        var ws = home.querySelectorAll(".elementor-widget-wrap");
        for (var wi = 0; wi < ws.length && wi < 300; wi++) {
          if (!ws[wi].querySelector(".elementor-widget")) emptyWraps++;
        }
      } catch (e) {}

      var repeatedTypes = [];
      var repeatedTotal = 0;
      Object.keys(widgetTypes).forEach(function (t) {
        if (widgetTypes[t] >= 3) {
          repeatedTypes.push({ type: t, count: widgetTypes[t] });
          repeatedTotal += widgetTypes[t];
        }
      });
      repeatedTypes.sort(function (a, b) { return b.count - a.count; });

      var topTypes = Object.keys(widgetTypes).map(function (t) {
        return { type: t, count: widgetTypes[t] };
      }).sort(function (a, b) { return b.count - a.count; }).slice(0, 3);

      return {
        nodeCount: counted,
        truncated: truncated,
        widgets: widgets,
        containers: containers,
        wraps: wraps,
        spacers: spacers,
        hidden: hidden,
        emptyWraps: emptyWraps,
        maxContainerDepth: maxContainerDepth,
        directChildren: home.children.length,
        widgetTypes: topTypes,
        repeatedTypes: repeatedTypes.slice(0, 3),
        repeatedTotal: repeatedTotal,
        isContainer: /(?:^|\s)(?:e-con|e-container)(?:\s|$)/.test(clsOf(home))
      };
    }

    function suggestionsFor(m, share) {
      var out = [];
      var nodeLabel = m.nodeCount.toLocaleString() + " elements" + (m.truncated ? "+" : "");
      out.push(nodeLabel + " in this " + (m.isContainer ? "container" : "section") +
        (share != null ? " \u2014 " + share + "% of the page DOM" : "") + ".");
      if (m.maxContainerDepth >= 3) out.push("Nested Elementor containers " + m.maxContainerDepth + " levels deep \u2014 flatten them with Flexbox Containers (rows/columns) instead of wrapped markup.");
      if (m.repeatedTotal >= 6) out.push("Repeated widgets (" + m.repeatedTypes.map(function (r) { return r.type + " \u00D7 " + r.count; }).join(", ") + ") \u2014 rebuild once as a Global/loop widget or template instead of duplicating.");
      if (m.spacers >= 5) out.push(m.spacers + " spacer widgets \u2014 use Flexbox gap or margins; each spacer is an extra wrapper + widget node.");
      if (m.hidden >= 6) out.push(m.hidden + " hidden (desktop/tablet/mobile) element clones add duplicate markup \u2014 prefer responsive hiding over duplicating blocks.");
      if (m.emptyWraps >= 3) out.push(m.emptyWraps + " empty wrapper(s) with no widget inside \u2014 remove them or move the widget up.");
      if (out.length < 2 && m.wraps >= 6 && m.widgets > 0) out.push(m.wraps + " widget-wrap containers for " + m.widgets + " widgets \u2014 every widget-wrap + column adds ~3+ nodes; convert to a single flex container.");
      if (out.length < 2 && m.nodeCount >= 700) out.push("Largest DOM section on the page \u2014 split it into smaller containers and lazy-load below-the-fold widgets.");
      return out.slice(0, 4);
    }

    function tierFor(n) {
      if (n >= 700) return { label: "Very High", cls: "critical" };
      if (n >= 400) return { label: "High", cls: "warning" };
      return { label: "Moderate", cls: "good" };
    }

    var allRoots = roots();
    var sections = [];
    var totalWidgets = 0, totalContainers = 0, totalSpacers = 0, totalHidden = 0, totalEmpty = 0, totalRepeated = 0;

    allRoots.forEach(function (home) {
      var m = measure(home);
      totalWidgets += m.widgets;
      totalContainers += m.containers;
      totalSpacers += m.spacers;
      totalHidden += m.hidden;
      totalEmpty += m.emptyWraps;
      totalRepeated += m.repeatedTotal;
      var share = m.truncated ? null : Math.round((m.nodeCount / totalEls) * 100);
      var tier = tierFor(m.nodeCount);
      var dataId = "";
      try { dataId = home.getAttribute("data-id") || ""; } catch (e) {}
      var elementType = "";
      try { elementType = home.getAttribute("data-element_type") || ""; } catch (e) {}
      sections.push({
        label: devLabel(home),
        kind: m.isContainer ? "Container" : "Section",
        selector: devSelectorFor(home),
        id: home.id || "",
        dataId: dataId,
        elementType: elementType,
        nodeCount: m.nodeCount,
        truncated: m.truncated,
        directChildren: m.directChildren,
        share: share,
        tier: tier,
        widgets: m.widgets,
        containers: m.containers,
        spacerWidgets: m.spacers,
        hiddenElements: m.hidden,
        emptyWraps: m.emptyWraps,
        nesting: m.maxContainerDepth,
        widgetTypes: m.widgetTypes,
        repeatedTypes: m.repeatedTypes,
        suggestions: suggestionsFor(m, share)
      });
    });

    sections.sort(function (a, b) { return b.nodeCount - a.nodeCount; });

    return {
      detected: possible.length > 0 || editor || previewIframe,
      editor: editor,
      previewIframe: previewIframe,
      totalElements: totalEls,
      sections: sections.slice(0, 8),
      summary: {
        sectionsFound: sections.length,
        widgets: totalWidgets,
        containers: totalContainers,
        spacers: totalSpacers,
        hidden: totalHidden,
        emptyWraps: totalEmpty,
        repeated: totalRepeated
      }
    };
  }

  var SM_PROPS = ["display", "position", "width", "minWidth", "maxWidth", "height", "minHeight", "maxHeight",
    "top", "right", "bottom", "left", "float", "visibility",
    "boxSizing", "margin", "padding",
    "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
    "borderTopStyle", "borderRightStyle", "borderBottomStyle", "borderLeftStyle",
    "borderTopColor", "borderRightColor", "borderBottomColor", "borderLeftColor",
    "borderRadius", "backgroundImage", "backgroundColor", "boxShadow", "overflowX", "overflowY",
    "fontFamily", "fontSize", "fontWeight", "fontStyle", "lineHeight", "letterSpacing",
    "textTransform", "textDecorationLine", "textAlign", "color",
    "gap", "rowGap", "columnGap", "flexDirection", "alignItems", "alignContent", "justifyContent", "flexWrap", "flex",
    "flexGrow", "flexShrink", "flexBasis", "alignSelf",
    "gridTemplateColumns", "gridTemplateRows", "gridTemplateAreas", "gridAutoFlow", "gridColumn", "gridRow", "justifySelf", "order",
    "opacity", "zIndex", "cursor", "objectFit",
    "aspectRatio", "objectPosition", "transform", "transformOrigin", "backdropFilter", "accentColor", "appearance",
    "textOverflow", "whiteSpace", "wordBreak", "overflowWrap", "verticalAlign",
    "backgroundSize", "backgroundPosition", "backgroundRepeat"];

  var SM_SKIP = {
    display: function (v) { return v === "block" || v === "inline"; },
    position: function (v) { return v === "static"; },
    width: function (v) { return v === "auto"; },
    height: function (v) { return v === "auto"; },
    minWidth: function (v) { return v === "0px"; },
    minHeight: function (v) { return v === "0px"; },
    maxWidth: function (v) { return v === "none"; },
    maxHeight: function (v) { return v === "none"; },
    top: function (v) { return v === "auto"; },
    right: function (v) { return v === "auto"; },
    bottom: function (v) { return v === "auto"; },
    left: function (v) { return v === "auto"; },
    float: function (v) { return v === "none"; },
    visibility: function (v) { return v === "visible"; },
    boxSizing: function (v) { return v === "content-box"; },
    margin: function (v) { return v === "0px"; },
    padding: function (v) { return v === "0px"; },
    borderRadius: function (v) { return v === "0px"; },
    backgroundImage: function (v) { return v === "none"; },
    backgroundColor: function (v) { return v === "rgba(0, 0, 0, 0)"; },
    boxShadow: function (v) { return v === "none"; },
    overflowX: function (v) { return v === "visible"; },
    overflowY: function (v) { return v === "visible"; },
    fontWeight: function (v) { return v === "400" || v === "normal"; },
    fontStyle: function (v) { return v === "normal"; },
    fontFamily: function (v) { return v === "" || v === "Arial"; },
    gap: function (v) { return v === "normal"; },
    rowGap: function (v) { return v === "normal"; },
    columnGap: function (v) { return v === "normal"; },
    alignItems: function (v) { return v === "normal" || v === "stretch"; },
    alignContent: function (v) { return v === "normal" || v === "stretch"; },
    justifyContent: function (v) { return v === "normal"; },
    flexDirection: function (v) { return v === "row"; },
    flexWrap: function (v) { return v === "nowrap"; },
    flex: function (v) { return v === "0 1 auto" || v === "0 1 0%"; },
    flexGrow: function (v) { return v === "0"; },
    flexShrink: function (v) { return v === "1"; },
    flexBasis: function (v) { return v === "auto" || v === "0%"; },
    alignSelf: function (v) { return v === "auto"; },
    gridTemplateColumns: function (v) { return v === "none"; },
    gridTemplateRows: function (v) { return v === "none"; },
    gridTemplateAreas: function (v) { return v === "none"; },
    gridAutoFlow: function (v) { return v === "row"; },
    gridColumn: function (v) { return v === "auto"; },
    gridRow: function (v) { return v === "auto"; },
    justifySelf: function (v) { return v === "auto"; },
    order: function (v) { return v === "0"; },
    opacity: function (v) { return v === "1"; },
    zIndex: function (v) { return v === "auto"; },
    cursor: function (v) { return v === "auto"; },
    objectFit: function (v) { return v === "fill"; },
    borderTopWidth: function (v) { return v === "0px" || v === "medium"; },
    borderRightWidth: function (v) { return v === "0px" || v === "medium"; },
    borderBottomWidth: function (v) { return v === "0px" || v === "medium"; },
    borderLeftWidth: function (v) { return v === "0px" || v === "medium"; },
    borderTopStyle: function (v) { return v === "none"; },
    borderRightStyle: function (v) { return v === "none"; },
    borderBottomStyle: function (v) { return v === "none"; },
    borderLeftStyle: function (v) { return v === "none"; },
    borderTopColor: function (v) { return v === "rgb(0, 0, 0)"; },
    borderRightColor: function (v) { return v === "rgb(0, 0, 0)"; },
    borderBottomColor: function (v) { return v === "rgb(0, 0, 0)"; },
    borderLeftColor: function (v) { return v === "rgb(0, 0, 0)" || v === "rgba(0, 0, 0, 0)"; },
    aspectRatio: function (v) { return v === "auto"; },
    objectPosition: function (v) { return v === "50% 50%"; },
    transform: function (v) { return v === "none"; },
    transformOrigin: function (v) { return /^50% 50%/.test(v); },
    backdropFilter: function (v) { return v === "none"; },
    accentColor: function (v) { return v === "auto"; },
    appearance: function (v) { return v === "none" || v === "auto"; },
    textOverflow: function (v) { return v === "clip"; },
    whiteSpace: function (v) { return v === "normal"; },
    wordBreak: function (v) { return v === "normal"; },
    overflowWrap: function (v) { return v === "normal"; },
    verticalAlign: function (v) { return v === "baseline"; },
    backgroundSize: function (v) { return v === "auto" || v === "auto auto"; },
    backgroundPosition: function (v) { return v === "0% 0%"; },
    backgroundRepeat: function (v) { return v === "repeat"; }
  };

  function smSkip(prop, value, isRoot) {
    if (value === undefined || value === null || value === "") return true;
    var fn = SM_SKIP[prop];
    if (fn) return fn(value);
    return false;
  }

  var SM_CSS = [
    "html.wspc-sm-hovering, html.wspc-sm-hovering * { cursor: crosshair !important; }",
    "#wspc-sm-hover, #wspc-sm-select { position: fixed; pointer-events: none; z-index: 2147483646; box-sizing: border-box; }",
    "#wspc-sm-hover { border: 1px solid #818cf8; background: rgba(99, 102, 241, 0.10); outline: 1px dashed rgba(165, 180, 252, 0.40); }",
    "#wspc-sm-select { border: 2px solid #6366f1; background: rgba(99, 102, 241, 0.12); }",
    "#wspc-sm-toolbar, #wspc-sm-toolbar * { box-sizing: border-box; }",
    "#wspc-sm-toolbar { position: fixed; right: 14px; top: 14px; width: 320px; z-index: 2147483647; background: #1c1d22; color: #e1e3e8; border: 1px solid rgba(255, 255, 255, 0.07); border-radius: 8px; box-shadow: 0 10px 34px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.04); font: 12px/1.5 system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; }",
    "#wspc-sm-toolbar svg { display: block; }",
    "#wspc-sm-toolbar .wspc-sm-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 10px; }",
    "#wspc-sm-toolbar .wspc-sm-brand { display: flex; align-items: center; gap: 7px; min-width: 0; }",
    "#wspc-sm-toolbar .wspc-sm-mark { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 6px; background: #6366f1; color: #f2f2f7; flex: 0 0 auto; }",
    "#wspc-sm-toolbar .wspc-sm-mark svg { stroke-width: 1.75; }",
    "#wspc-sm-toolbar .wspc-sm-title { font-size: 12px; font-weight: 600; color: #e1e3e8; letter-spacing: 0; line-height: 1.25; }",
    "#wspc-sm-toolbar .wspc-sm-subtle { display: block; color: #8c92a0; font-size: 10px; font-weight: 400; letter-spacing: 0; }",
    "#wspc-sm-toolbar .wspc-sm-x { border: 1px solid rgba(255, 255, 255, 0.10); background: #25272e; color: #8c92a0; width: 24px; height: 24px; border-radius: 6px; cursor: pointer; font-size: 12px; line-height: 1; display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease; }",
    "#wspc-sm-toolbar .wspc-sm-x:hover { color: #e1e3e8; border-color: rgba(255, 255, 255, 0.18); background: #2a2d35; }",
    "#wspc-sm-toolbar .wspc-sm-status { padding: 8px 10px; border-bottom: 1px solid rgba(255, 255, 255, 0.06); word-break: break-word; }",
    "#wspc-sm-toolbar .wspc-sm-status b { color: #e1e3e8; font-weight: 600; }",
    "#wspc-sm-toolbar .wspc-sm-empty { color: #8c92a0; }",
    "#wspc-sm-toolbar .wspc-sm-note { color: #8c92a0; font-size: 11px; margin-top: 2px; }",
    "#wspc-sm-toolbar .wspc-sm-actions { display: flex; gap: 6px; padding: 8px 10px; }",
    "#wspc-sm-toolbar .wspc-sm-btn { flex: 1 1 auto; border: 1px solid rgba(99, 102, 241, 0.4); background: #6366f1; color: #f2f2f7; border-radius: 8px; padding: 6px 8px; font-size: 11px; font-weight: 600; font-family: system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; cursor: pointer; transition: background-color 0.15s ease, border-color 0.15s ease; }",
    "#wspc-sm-toolbar .wspc-sm-btn:hover { background: #4f46e5; border-color: #4f46e5; }",
    "#wspc-sm-toolbar .wspc-sm-btn:disabled { background: #25272e; border-color: rgba(255, 255, 255, 0.08); color: #6b7280; cursor: default; }",
    "#wspc-sm-toolbar .wspc-sm-btn:focus-visible { outline: 2px solid #818cf8; outline-offset: 2px; }"
  ].join("\n");

  var styleMarkOn = false;
  var styleMarkEl = null;
  var styleMarkData = null;

  function smPartLabel(el) {
    var t = el.tagName ? el.tagName.toLowerCase() : "element";
    var base = t;
    if (t === "header") base = "Header";
    else if (t === "footer") base = "Footer";
    else if (t === "nav") base = "Navigation";
    else if (t === "main") base = "Content";
    else if (t === "section") base = "Section";
    else if (t === "article") base = "Article";
    else if (t === "aside") base = "Aside";
    else if (t === "button") base = "Button";
    else if (t === "a") base = "Link";
    else if (t === "input") base = "Button";
    else if (t === "form") base = "Form";
    else if (t === "ul" || t === "ol") base = "List";
    else if (t === "li") base = "Item";
    else if (t === "img") base = "Image";
    else if (t === "table") base = "Table";
    if (el.id) base += "#" + el.id;
    else if (el.className && typeof el.className === "string") {
      var first = el.className.trim().split(/\s+/)[0];
      if (first && first !== "wspc-sm-hovering") base += "." + first;
    }
    return base;
  }

  function smShowSelection(el) {
    var sel = document.getElementById("wspc-sm-select");
    if (!sel) return;
    var r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) {
      sel.style.display = "none";
      return;
    }
    sel.style.display = "block";
    sel.style.left = r.left + "px";
    sel.style.top = r.top + "px";
    sel.style.width = r.width + "px";
    sel.style.height = r.height + "px";
  }

  function styleMarkToolbarHtml() {
    return '<div class="wspc-sm-head">'
      + '<div class="wspc-sm-brand">'
      + '<span class="wspc-sm-mark"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l5 5M7.5 16.5l9-9M5 19l-2 2c-1-4 1-7 4-10l10-10 4 4L11 15c-3 3-6 5-6 4z"/></svg></span>'
      + '<span class="wspc-sm-title">Design Inspector<span class="wspc-sm-subtle">Copy HTML \u00B7 CSS \u00B7 both</span></span>'
      + '</div>'
      + '<button type="button" class="wspc-sm-x" title="Exit inspector (Esc)">\u2715</button></div>'
      + '<div class="wspc-sm-status" id="wspc-sm-status"><span class="wspc-sm-empty">Hover any element, then click to select it \u2014 its HTML and CSS are ready to copy.</span></div>'
      + '<div class="wspc-sm-actions">'
      + '<button type="button" class="wspc-sm-btn" data-sm="html" disabled>Copy HTML</button>'
      + '<button type="button" class="wspc-sm-btn" data-sm="css" disabled>Copy CSS</button>'
      + '<button type="button" class="wspc-sm-btn" data-sm="both" disabled>Copy HTML + CSS</button>'
      + '</div>';
  }

  function styleMarkEnable() {
    if (styleMarkOn) return;
    styleMarkOn = true;
    styleMarkEl = null;
    styleMarkData = null;

    if (!wspcOwned("wspc-sm-style")) {
      var st = document.createElement("style");
      st.id = "wspc-sm-style";
      wspcTag(st);
      st.textContent = SM_CSS;
      (document.head || document.documentElement).appendChild(st);
    }
    document.documentElement.classList.add("wspc-sm-hovering");

    var hover = document.createElement("div");
    hover.id = "wspc-sm-hover";
    var sel = document.createElement("div");
    sel.id = "wspc-sm-select";
    wspcTag(hover);
    wspcTag(sel);
    document.body.appendChild(hover);
    document.body.appendChild(sel);

    var tb = document.createElement("div");
    tb.id = "wspc-sm-toolbar";
    wspcTag(tb);
    tb.innerHTML = styleMarkToolbarHtml();
    document.body.appendChild(tb);

    document.addEventListener("mousemove", smOnMove, true);
    document.addEventListener("click", smOnClick, true);
    document.addEventListener("keydown", smOnKey);
    tb.addEventListener("click", smToolbarClick);
    var xb = tb.querySelector(".wspc-sm-x");
    if (xb) xb.addEventListener("click", function () { styleMarkDisable(); });
  }

  function styleMarkDisable() {
    if (!styleMarkOn) return;
    styleMarkOn = false;
    styleMarkEl = null;
    styleMarkData = null;
    document.documentElement.classList.remove("wspc-sm-hovering");
    document.removeEventListener("mousemove", smOnMove, true);
    document.removeEventListener("click", smOnClick, true);
    document.removeEventListener("keydown", smOnKey);
    var tb = wspcOwned("wspc-sm-toolbar");
    if (tb) { tb.removeEventListener("click", smToolbarClick); tb.remove(); }
    var h = wspcOwned("wspc-sm-hover");
    if (h) h.remove();
    var s = wspcOwned("wspc-sm-select");
    if (s) s.remove();
    var st = wspcOwned("wspc-sm-style");
    if (st) st.remove();
  }

  function smOnMove(ev) {
    if (!styleMarkOn) return;
    var hover = document.getElementById("wspc-sm-hover");
    if (!hover) return;
    var t = ev.target;
    if (!t || !t.tagName || t.closest("#wspc-sm-toolbar") || t.closest("#wspc-sm-hover") || t.closest("#wspc-sm-select") || t === document.documentElement || t === document.body) {
      hover.style.display = "none";
      return;
    }
    var r = t.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) {
      hover.style.display = "none";
      return;
    }
    hover.style.display = "block";
    hover.style.left = r.left + "px";
    hover.style.top = r.top + "px";
    hover.style.width = r.width + "px";
    hover.style.height = r.height + "px";
  }

  function smOnClick(ev) {
    if (!styleMarkOn) return;
    var t = ev.target;
    if (!t || !t.tagName) return;
    if (typeof t.closest === "function" && t.closest("#wspc-sm-toolbar")) return;
    ev.preventDefault();
    ev.stopPropagation();
    smSelectElement(t);
  }

  var SM_CAPS = { nodes: 400, textNode: 300, textTotal: 60000, pseudoNodes: 8, cssBlockCap: 60, cssTotalCap: 20000 };

  function smKebab(prop) {
    return String(prop).replace(/[A-Z]/g, function (m) { return "-" + m.toLowerCase(); });
  }

  function smGetCS(el, pseudo) {
    try { return window.getComputedStyle(el, pseudo || null); } catch (e) { return {}; }
  }

  function smAbsolutizeUrl(val, base) {
    if (!val) return val;
    var s = String(val).trim();
    if (!s) return val;
    if (/^(?:https?:|data:|mailto:|tel:|javascript:|#)/i.test(s)) return val;
    try { return new URL(s, base).href; } catch (e) { return val; }
  }

  function smAbsolutizeSrcset(val, base) {
    if (!val) return val;
    return String(val).split(",").map(function (entry) {
      var parts = String(entry).trim().split(/\s+/);
      if (!parts.length || !parts[0]) return "";
      parts[0] = smAbsolutizeUrl(parts[0], base);
      return parts.join(" ");
    }).join(", ");
  }

  function smFixCloneUrls(clone, base) {
    if (!clone) return;
    var attrs = ["src", "href", "poster"];
    for (var i = 0; i < attrs.length; i++) {
      var name = attrs[i];
      if (clone.hasAttribute && clone.getAttribute && clone.hasAttribute(name)) {
        clone.setAttribute(name, smAbsolutizeUrl(clone.getAttribute(name), base));
      }
    }
    if (clone.hasAttribute && clone.getAttribute && clone.hasAttribute("srcset")) {
      clone.setAttribute("srcset", smAbsolutizeSrcset(clone.getAttribute("srcset"), base));
    }
    var kids = (clone && clone.children) ? clone.children : [];
    for (var j = 0; j < kids.length; j++) {
      try { smFixCloneUrls(kids[j], base); } catch (e) {}
    }
  }

  function smPseudoRule(real, sel, pseudo) {
    var cs;
    try { cs = window.getComputedStyle(real, pseudo); } catch (e) { return null; }
    if (!cs) return null;
    var block = [sel + pseudo + " {"];
    var hasMeaning = false;
    var contentPushed = false;
    var content = cs.content || "";
    if (content !== "none" && content !== "normal" && content !== "") {
      var contentVal = String(content);
      if (contentVal.length > 500) contentVal = contentVal.slice(0, 500);
      block.push("  content: " + contentVal + ";");
      contentPushed = true;
      hasMeaning = true;
    }
    var pProps = ["display", "position", "top", "right", "bottom", "left", "width", "height",
      "margin", "padding", "color", "backgroundColor", "backgroundImage",
      "backgroundSize", "backgroundRepeat", "backgroundPosition",
      "fontFamily", "fontSize", "fontWeight", "borderWidth", "borderStyle", "borderColor",
      "borderRadius", "boxShadow", "transform", "textAlign"];
    for (var i = 0; i < pProps.length; i++) {
      var v = cs[pProps[i]];
      if (v === undefined || v === null || v === "") continue;
      if (v === "auto" && /^(top|right|bottom|left|width|height|margin|padding)$/.test(pProps[i])) continue;
      if (v === "none" && /^(backgroundColor|backgroundImage|boxShadow|borderStyle|display|backgroundRepeat|backgroundPosition)$/.test(pProps[i])) continue;
      if (v === "1" && pProps[i] === "fontWeight") continue;
      if (v === "auto auto" && pProps[i] === "backgroundSize") continue;
      block.push("  " + smKebab(pProps[i]) + ": " + v + ";");
      hasMeaning = true;
    }
    if (!hasMeaning) return null;
    // Pseudo-elements only paint when they render a box; a background/icon
    // decoration with an empty content value needs an explicit content "".
    if (!contentPushed) block.splice(1, 0, '  content: "";');
    block.push("}");
    return block.join("\n");
  }

  function styleMarkCapture(root) {
    var caps = SM_CAPS;
    var realNodes = [];
    var clones = [];
    var totalText = 0;
    var truncated = false;
    var doc = document;

    function makeText(s) {
      if (totalText >= caps.textTotal) { truncated = true; return null; }
      var piece = String(s).slice(0, caps.textNode);
      if (String(s).length > caps.textNode) truncated = true;
      totalText += piece.length;
      if (doc && doc.createTextNode) {
        try { return doc.createTextNode(piece); } catch (e) { return null; }
      }
      return null;
    }

    // Clone the subtree up to the node cap while preserving nesting and text
    // content. Every element keeps its original attributes (class, id, style,
    // data-*) so the site's own stylesheet selectors still match the copy.
    function build(real) {
      var idx = realNodes.length;
      if (idx >= caps.nodes) { truncated = true; return null; }
      realNodes.push(real);
      var clone = null;
      try { clone = real.cloneNode(false); } catch (e) { clone = null; }
      clones[idx] = clone;
      if (!clone) return null;
      var cn = null;
      try { cn = real.childNodes; } catch (e) { cn = null; }
      var kids = (cn && cn.length !== undefined) ? cn : null;
      if (!kids) {
        kids = [];
        var els = real.children || [];
        for (var e2 = 0; e2 < els.length; e2++) kids.push(els[e2]);
      }
      for (var i = 0; i < kids.length; i++) {
        if (realNodes.length >= caps.nodes) { truncated = true; break; }
        var ch = kids[i];
        var t = ch.nodeType;
        var isText = t === 3 || (t === undefined && !ch.tagName && typeof ch.nodeValue === "string");
        var isElem = t === 1 || (t === undefined && ch && ch.tagName);
        if (isText) {
          var txt = (ch.nodeValue != null) ? ch.nodeValue : (ch.textContent || "");
          if (!txt) continue;
          var tn = makeText(txt);
          if (tn) clone.appendChild(tn);
          if (totalText >= caps.textTotal) { truncated = true; break; }
        } else if (isElem) {
          var cc = build(ch);
          if (cc) clone.appendChild(cc);
        }
      }
      return clone;
    }

    var rootClone = null;
    try { rootClone = build(root) || null; } catch (e) { truncated = true; rootClone = null; }

    var n = realNodes.length;
    if (n > 0 && clones[0]) clones[0].setAttribute("data-wsmcmp", "r");
    for (var mi = 1; mi < n; mi++) {
      if (clones[mi]) clones[mi].setAttribute("data-wsmcmp", String(mi));
    }

    var base = "";
    try { base = document.baseURI || location.href || window.location.href; } catch (e) { base = ""; }
    if (rootClone) {
      try { smFixCloneUrls(rootClone, base); } catch (e) {}
    }

    var html;
    if (rootClone) {
      try { html = rootClone.outerHTML; } catch (e) { html = "<" + root.tagName.toLowerCase() + "></" + root.tagName.toLowerCase() + ">"; }
    } else {
      html = "<" + root.tagName.toLowerCase() + "></" + root.tagName.toLowerCase() + ">";
    }

    var lines = [];
    var cssChars = 0;
    var csCache = Object.create(null);
    function getCs(idx) {
      if (csCache[idx]) return csCache[idx];
      csCache[idx] = smGetCS(realNodes[idx]);
      return csCache[idx];
    }
    for (var k = 0; k < n; k++) {
      var real = realNodes[k];
      var cs = getCs(k);
      var sel = k === 0 ? '[data-wsmcmp="r"]' : '[data-wsmcmp="r"] [data-wsmcmp="' + k + '"]';
      var parIdx = -1;
      if (k > 0) {
        var parEl = realNodes[k].parentElement;
        if (parEl) { var fi = realNodes.indexOf(parEl); if (fi >= 0) parIdx = fi; }
      }
      var block = [sel + " {"];
      for (var p = 0; p < SM_PROPS.length; p++) {
        var prop = SM_PROPS[p];
        var v = cs[prop];
        if (v === undefined || v === null || v === "") continue;
        if (smSkip(prop, String(v), k === 0)) continue;
        if (parIdx >= 0 && String(getCs(parIdx)[prop]) === String(v)) continue;
        block.push("  " + smKebab(prop) + ": " + v + ";");
      }
      block.push("}");
      if (block.length > 2) {
        var blockStr = block.join("\n");
        cssChars += blockStr.length + 2;
        if (cssChars > caps.cssTotalCap) { truncated = true; break; }
        lines.push(blockStr);
      }
      if (lines.length >= caps.cssBlockCap) { truncated = true; break; }
    }

    var pseudoLines = [];
    var maxPseudo = Math.min(n, caps.pseudoNodes);
    for (var pk = 0; pk < maxPseudo; pk++) {
      if (cssChars >= caps.cssTotalCap) { truncated = true; break; }
      var psel = pk === 0 ? '[data-wsmcmp="r"]' : '[data-wsmcmp="r"] [data-wsmcmp="' + pk + '"]';
      var pb = smPseudoRule(realNodes[pk], psel, "::before");
      if (pb) {
        pseudoLines.push(pb);
        cssChars += pb.length + 2;
      }
      var pa = smPseudoRule(realNodes[pk], psel, "::after");
      if (pa) {
        pseudoLines.push(pa);
        cssChars += pa.length + 2;
      }
    }

    var cssParts = [];
    if (lines.length) cssParts.push(lines.join("\n"));
    if (pseudoLines.length) cssParts.push(pseudoLines.join("\n"));
    if (n > 1) {
      cssParts.push("/* Keeps the copied section from overflowing its new container. */\n[data-wsmcmp=\"r\"] { max-width: 100%; }");
    }

    return { html: html, css: cssParts.join("\n\n"), nodeCount: n, truncated: truncated };
  }

  function styleMarkRefreshStatus() {
    smRenderStatus();
  }

  function smRenderStatus() {
    var tb = document.getElementById("wspc-sm-toolbar");
    if (!tb) return;
    var st = tb.querySelector("#wspc-sm-status");
    var btns = tb.querySelectorAll(".wspc-sm-btn");
    var has = !!(styleMarkData && styleMarkEl);
    for (var i = 0; i < btns.length; i++) btns[i].disabled = !has;
    if (!st) return;
    if (!styleMarkEl) {
      st.innerHTML = '<span class="wspc-sm-empty">Hover any element, then click to select it \u2014 its HTML and CSS are ready to copy.</span>';
      return;
    }
    st.innerHTML = "<b>" + devEsc(devLabel(styleMarkEl)) + "</b> <span class=\"wspc-sm-note\">\u2014 HTML and CSS captured \u00B7 pick a copy button \u00B7 Esc exits</span>";
  }

  function smSelectElement(el) {
    if (!styleMarkOn || !el) return;
    styleMarkEl = el;
    try {
      styleMarkData = styleMarkCapture(el);
    } catch (e) {
      styleMarkData = null;
    }
    smShowSelection(el);
    styleMarkRefreshStatus();
  }

  function smToolbarClick(ev) {
    if (!ev.target) return;
    var t = ev.target;
    var btn = t.closest ? t.closest(".wspc-sm-btn") : null;
    if (!btn || !styleMarkData || !styleMarkEl) return;
    var kind = btn.getAttribute("data-sm");
    var css = styleMarkData.css;
    var text;
    if (kind === "html") text = styleMarkData.html;
    else if (kind === "css") text = css;
    else text = styleMarkData.html + "\n\n<style>\n" + css + "\n</style>";
    var ok = false;
    try {
      ok = smWriteClipboard(text);
    } catch (e) {
      ok = false;
    }
    var prev = btn.textContent;
    btn.textContent = ok ? "Copied \u2713" : "Copy failed";
    setTimeout(function () { btn.textContent = prev; }, 1600);
  }

  function smWriteClipboard(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:0;left:-9999px;width:1px;height:1px;opacity:0;";
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    if (ok) return true;
    if (navigator && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      try {
        navigator.clipboard.writeText(text);
        return true;
      } catch (e) { /* noop */ }
    }
    return false;
  }

  // =============================================
  // MEDIA TRACKER — click-to-track assets
  // Hover highlights images, SVGs and CSS-
  // background icons; clicking adds only the
  // selected asset to the download list.
  // =============================================
  function mtBase() { try { return document.baseURI || location.href || window.location.href || ""; } catch (e) { return ""; } }
  function mtAbs(u) { return smAbsolutizeUrl(String(u || "").trim(), mtBase()); }
  function mtSize(v) { var n = parseFloat(v); return (n && n > 0) ? Math.round(n) : null; }
  function mtSel(el) {
    if (!el || !el.tagName) return "";
    var tag = el.tagName.toLowerCase();
    if (el.id) return tag + "#" + el.id;
    var c = (el.className && typeof el.className === "string") ? el.className.trim().split(/\s+/).slice(0, 2).join(".") : "";
    return tag + (c ? "." + c : "");
  }
  function mtIsMedia(el) {
    if (!el || !el.tagName) return false;
    var t = el.tagName.toLowerCase();
    return t === "img" || t === "picture" || t === "video" || t === "canvas" || t === "svg";
  }
  function mtItemFromEl(el) {
    var tag = el.tagName.toLowerCase();
    if (tag === "svg") {
      var markup = "";
      try { markup = el.outerHTML; } catch (e) { markup = ""; }
      if (markup.length > 120000) markup = markup.slice(0, 120000);
      return { type: "svg", url: null, inline: true, markup: markup, label: "Inline SVG #" + (mtItems.length + 1), source: mtSel(el), width: mtSize(el.getAttribute("width") || ""), height: mtSize(el.getAttribute("height") || "") };
    }
    if (tag === "img") {
      var src = el.currentSrc || el.getAttribute("src") || "";
      var u = mtAbs(src);
      if (!u || /^(data:|javascript:|#)/i.test(u)) return null;
      return { type: "image", url: u, source: mtSel(el), width: mtSize(el.naturalWidth), height: mtSize(el.naturalHeight) };
    }
    if (tag === "picture") { var im = el.querySelector("img"); return im ? mtItemFromEl(im) : null; }
    if (tag === "video") { var poster = el.getAttribute("poster"); if (poster) { var pu = mtAbs(poster); if (pu && !/^(data:|javascript:|#)/i.test(pu)) return { type: "image", url: pu, source: mtSel(el), width: null, height: null }; } return null; }
    if (tag === "canvas") return null;
    return null;
  }
  function mtItemFromBg(el) {
    if (!el) return null;
    var bg = "";
    try { bg = smGetCS(el).backgroundImage || ""; } catch (e) { bg = ""; }
    var m = String(bg).match(/url\(\s*['"]?([^'")]+)['"]?\s*\)/);
    if (!m) return null;
    var raw = m[1].trim();
    if (/^(data:|javascript:|#)/i.test(raw)) return null;
    var url = mtAbs(raw);
    if (!url) return null;
    return { type: "image", url: url, source: (el.id ? "#" + el.id : el.tagName.toLowerCase()) + " \u00B7 CSS background", width: null, height: null };
  }
  function mtShowRect(ov, el) {
    if (!ov || !el) return;
    var r = null;
    try { r = el.getBoundingClientRect(); } catch (e) { r = null; }
    if (!r) { ov.style.display = "none"; return; }
    ov.style.display = "block";
    ov.style.left = (r.left || 0) + "px";
    ov.style.top = (r.top || 0) + "px";
    ov.style.width = (r.width || 0) + "px";
    ov.style.height = (r.height || 0) + "px";
  }
  function mtHide(ov) { if (ov) ov.style.display = "none"; }

  var MT_ST_ID = "wspc-mt-style";
  var MT_CSS = "#wspc-mt-hover{position:fixed;pointer-events:none;z-index:2147483646;border:1px solid rgba(99,102,241,.45);background:rgba(99,102,241,.06);display:none;}"
    + "#wspc-mt-select{position:fixed;pointer-events:none;z-index:2147483646;border:2px solid #6366f1;background:rgba(99,102,241,.08);display:none;}";
  var mtOn = false, mtItems = [], mtRefs = [], mtHover = null, mtSelect = null;
  function mtInjectStyle() { if (wspcOwned(MT_ST_ID)) return; var st = document.createElement("style"); st.id = MT_ST_ID; wspcTag(st); st.textContent = MT_CSS; (document.head || document.documentElement).appendChild(st); }
  function mtEnsureOverlays() {
    mtHover = document.createElement("div"); mtHover.id = "wspc-mt-hover"; wspcTag(mtHover);
    mtSelect = document.createElement("div"); mtSelect.id = "wspc-mt-select"; wspcTag(mtSelect);
    document.body.appendChild(mtHover);
    document.body.appendChild(mtSelect);
  }
  function mtHitAt(x, y) {
    var els = [];
    try { els = (document.elementsFromPoint || function () { return []; })(x, y) || []; } catch (e) { els = []; }
    if (!els.length && document.elementFromPoint) { var e2 = document.elementFromPoint(x, y); els = e2 ? [e2] : []; }
    for (var i = 0; i < els.length; i++) {
      var t = els[i];
      if (t && t.id && t.id.indexOf("wspc-mt-") === 0) continue;
      if (mtIsMedia(t)) return { el: t };
    }
    var node = els[0] || (document.elementFromPoint ? document.elementFromPoint(x, y) : null);
    var depth = 0;
    while (node && depth < 10) {
      if (node.id && node.id.indexOf("wspc-mt-") === 0) return null;
      if (mtIsMedia(node)) return { el: node };
      node = node.parentElement || node.parentNode;
      depth++;
    }
    return null;
  }
  function mtOnMove(ev) {
    if (!mtOn) return;
    var hit = mtHitAt(ev.clientX, ev.clientY);
    if (hit) mtShowRect(mtHover, hit.el); else mtHide(mtHover);
  }
  function mtAdd(item, elRef) {
    if (!item) return;
    var exists = mtItems.some(function (it) { return (it.url && it.url === item.url) || (it.inline && it.markup && it.markup === item.markup); });
    if (!exists) { mtItems.push(item); mtRefs.push(elRef || null); }
  }
  function mtFlashItem(idx) {
    var ref = (idx >= 0 && idx < mtRefs.length) ? mtRefs[idx] : null;
    if (!ref || !ref.getBoundingClientRect) return false;
    var flash = document.createElement("div");
    flash.id = "wspc-mt-flash";
    wspcTag(flash);
    flash.style.cssText = "position:fixed;z-index:2147483646;pointer-events:none;border:3px solid rgba(239,68,68,.75);border-radius:4px;box-shadow:0 0 0 4px rgba(239,68,68,.18);background:rgba(239,68,68,.06);transition:opacity .4s ease;opacity:1;";
    var r = null;
    try { r = ref.getBoundingClientRect(); } catch (e) { r = null; }
    if (!r) return false;
    flash.style.left = (r.left || 0) + "px";
    flash.style.top = (r.top || 0) + "px";
    flash.style.width = Math.max(1, r.width || 0) + "px";
    flash.style.height = Math.max(1, r.height || 0) + "px";
    document.body.appendChild(flash);
    setTimeout(function () { flash.style.opacity = "0"; }, 300);
    setTimeout(function () { try { flash.remove(); } catch (e) {} }, 800);
    return true;
  }
  function mtFlash(el) {
    mtShowRect(mtSelect, el);
    setTimeout(function () { mtHide(mtSelect); }, 600);
  }
  function mtOnClick(ev) {
    if (!mtOn) return;
    var t = ev.target;
    if (t && t.id && t.id.indexOf("wspc-mt-") === 0) { ev.preventDefault(); ev.stopPropagation(); return; }
    var node = t, depth = 0;
    while (node && depth < 12) {
      if (node.id && node.id.indexOf("wspc-mt-") === 0) return;
      if (mtIsMedia(node)) {
        var item = mtItemFromEl(node);
        if (item) { ev.preventDefault(); ev.stopPropagation(); mtFlash(node); mtAdd(item, node); }
        return;
      }
      node = node.parentElement || node.parentNode;
      depth++;
    }
    var bgItem = mtItemFromBg(t);
    if (!bgItem) {
      var a = t;
      for (var i = 0; i < 3 && a && a.parentElement; i++) { a = a.parentElement; bgItem = mtItemFromBg(a); if (bgItem) break; }
    }
    if (bgItem) { ev.preventDefault(); ev.stopPropagation(); mtFlash(t); mtAdd(bgItem, t); }
  }
  function mtOnKey(ev) { if (ev.key === "Escape") mtDisable(); }
  function mtEnable() {
    if (mtOn) return;
    mtOn = true;
    mtInjectStyle();
    mtEnsureOverlays();
    document.addEventListener("mousemove", mtOnMove, true);
    document.addEventListener("click", mtOnClick, true);
    document.addEventListener("keydown", mtOnKey);
  }
  function mtDisable() {
    if (!mtOn) return;
    mtOn = false;
    document.removeEventListener("mousemove", mtOnMove, true);
    document.removeEventListener("click", mtOnClick, true);
    document.removeEventListener("keydown", mtOnKey);
    if (mtHover) { mtHover.remove(); mtHover = null; }
    if (mtSelect) { mtSelect.remove(); mtSelect = null; }
    var st = wspcOwned(MT_ST_ID); if (st) st.remove();
  }

  // =============================================
  // MEDIA SCANNER — full-page catalog (used by
  // the tracker for batch-capture and testing).
  // =============================================
  function scanMediaAssets() {
    var items = [];
    var seen = Object.create(null);
    var inlineSvg = 0;

    function push(type, url, source, w, h) {
      if (!url) return;
      var u = mtAbs(url);
      if (!u || /^(data:|javascript:|#)/i.test(u)) return;
      if (seen[u]) return;
      seen[u] = true;
      items.push({ type: type, url: u, source: source || "", width: w || null, height: h || null });
    }

    // <img> elements — the rendered src (currentSrc resolves srcset too).
    var imgs = [];
    try { imgs = document.querySelectorAll("img"); } catch (e) {}
    for (var i = 0; i < imgs.length; i++) {
      var img = imgs[i];
      var u = img.currentSrc || img.getAttribute("src") || "";
      push("image", u, mtSel(img), mtSize(img.naturalWidth), mtSize(img.naturalHeight));
    }

    // SVG sprite refs (<use href="sprite.svg#id">).
    var uses = [];
    try { uses = document.querySelectorAll("use"); } catch (e) {}
    for (var ui = 0; ui < uses.length; ui++) {
      var useHRef = uses[ui].getAttribute("href") || uses[ui].getAttribute("xlink:href") || "";
      if (/\.svg(#|$)/i.test(useHRef)) push("svg", useHRef, mtSel(uses[ui]));
    }

    // Inline <svg> elements — serialized so they can be downloaded as .svg files.
    var svgs = [];
    try { svgs = document.querySelectorAll("svg"); } catch (e) {}
    for (var si = 0; si < svgs.length; si++) {
      var svg = svgs[si];
      inlineSvg++;
      var markup = "";
      try { markup = svg.outerHTML; } catch (e) { markup = ""; }
      if (markup.length > 120000) markup = markup.slice(0, 120000);
      items.push({
        type: "svg",
        url: null,
        inline: true,
        markup: markup,
        label: "Inline SVG #" + inlineSvg,
        source: mtSel(svg),
        width: mtSize(svg.getAttribute("width") || ""),
        height: mtSize(svg.getAttribute("height") || "")
      });
    }

    // Favicons / app icons / social images declared in <head>.
    var icons = [];
    try {
      icons = document.querySelectorAll('link[rel~="icon"], link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"], link[rel="mask-icon"], link[rel="fluid-icon"], meta[property="og:image"]');
    } catch (e) {}
    for (var li = 0; li < icons.length; li++) {
      var lk = icons[li];
      var h = lk.tagName === "META" ? lk.getAttribute("content") : lk.getAttribute("href");
      if (!h) continue;
      var sizes = lk.getAttribute("sizes");
      push("icon", h, mtSel(lk) + (sizes ? " \u00B7 " + sizes : ""));
    }

    var counts = { image: 0, svg: 0, icon: 0 };
    items.forEach(function (it) { counts[it.type]++; });
    return { items: items, total: items.length, counts: counts };
  }

  function smOnKey(ev) {
    if (ev.key === "Escape") styleMarkDisable();
  }

  // =============================================
  // JS TRACKER — scan every <script> in the DOM,
  // report its source (inline/external), code,
  // tag id, class names, parent and container
  // labels, plus type/async/defer flags.
  // =============================================
  var jsTrackObserver = null;
  var jsTrackTarget = null;

  function jsContainerLabel(node) {
    var labels = [];
    var cur = node;
    var guard = 0;
    while (cur && cur !== document.documentElement && labels.length < 4 && guard < 30) {
      var t = cur.tagName ? cur.tagName.toLowerCase() : "";
      if (t !== "html" && t !== "body" && t !== "head") {
        var label = smPartLabel(cur);
        if (label && labels.indexOf(label) === -1) labels.push(label);
      }
      cur = cur.parentElement || null;
      guard++;
    }
    return labels;
  }

  function analyzeScripts() {
    var scripts = [];
    try { scripts = Array.prototype.slice.call(document.querySelectorAll("script")); } catch (e) {}
    var items = [];
    var totalChars = 0;
    var inlineCount = 0;
    var externalCount = 0;
    var inlineCharTotal = 0;
    var CAP = 4000;
    scripts.forEach(function (s, idx) {
      var src = s.getAttribute("src") || null;
      var isInline = !src;
      var rawCode = isInline ? (s.textContent || "") : "";
      totalChars += rawCode.length;
      if (isInline) { inlineCount++; inlineCharTotal += rawCode.length; } else { externalCount++; }
      var id = s.id || null;
      var classes = [];
      try {
        var cn = s.className;
        if (cn && typeof cn === "string" && cn.trim()) classes = cn.trim().split(/\s+/).filter(Boolean);
      } catch (e) {}
      var type = s.getAttribute("type") || "";
      var asyncAttr = !!s.hasAttribute("async");
      var deferAttr = !!s.hasAttribute("defer");
      var nomodule = !!s.hasAttribute("nomodule");
      var parentLabel = s.parentElement ? smPartLabel(s.parentElement) : null;
      var containers = s.parentElement ? jsContainerLabel(s.parentElement) : [];
      var displayCode = rawCode;
      var truncated = false;
      if (displayCode.length > CAP) {
        displayCode = displayCode.slice(0, CAP) + "\n/* \u2026 truncated \u2014 " + rawCode.length + " chars total */";
        truncated = true;
      }
      items.push({
        idx: idx,
        src: src,
        inline: isInline,
        code: displayCode,
        codeLength: rawCode.length,
        truncated: truncated,
        id: id,
        classes: classes,
        type: type,
        async: asyncAttr,
        defer: deferAttr,
        nomodule: nomodule,
        parent: parentLabel,
        containers: containers,
        selector: (function () { try { return devSelectorFor(s); } catch (e) { return "script"; } })()
      });
    });
    return {
      total: scripts.length,
      inlineCount: inlineCount,
      externalCount: externalCount,
      totalChars: totalChars,
      inlineChars: inlineCharTotal,
      items: items
    };
  }

  function jsTrackStart() {
    jsTrackStop();
    if (typeof MutationObserver !== "function") return;
    var root = document.documentElement || document.body;
    if (!root) return;
    jsTrackObserver = new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var n = muts[i];
        var added = n.addedNodes || [];
        var removed = n.removedNodes || [];
        for (var a = 0; a < added.length; a++) {
          if (added[a] && added[a].nodeName === "SCRIPT") {
            try { const p = chrome.runtime.sendMessage({ action: "scriptsChanged" }); if (p && typeof p.catch === "function") p.catch(function () {}); } catch (e) {}
            return;
          }
        }
        for (var r = 0; r < removed.length; r++) {
          if (removed[r] && removed[r].nodeName === "SCRIPT") {
            try { const p = chrome.runtime.sendMessage({ action: "scriptsChanged" }); if (p && typeof p.catch === "function") p.catch(function () {}); } catch (e) {}
            return;
          }
        }
      }
    });
    jsTrackObserver.observe(root, { childList: true, subtree: true });
  }

  function jsTrackStop() {
    if (jsTrackObserver) { try { jsTrackObserver.disconnect(); } catch (e) {} }
    jsTrackObserver = null;
    jsTrackTarget = null;
  }

  // =============================================
  // CSS TOOLS — list stylesheets, temporarily
  // disable individual sheets (or all of them),
  // and inject temporary CSS to preview changes.
  // Everything is restored simply by reloading,
  // or via the explicit Restore action below.
  // =============================================
  var cssToolsLiveId = "wspc-css-tools-live";

  function cssToolsList() {
    var sheets = [];
    try {
      for (var i = 0; i < document.styleSheets.length; i++) {
        var ss = document.styleSheets[i];
        var owner = ss.ownerNode || null;
        var owned = !!(owner && owner.getAttribute && owner.getAttribute("data-wspc-own") === "1");
        var rules = null;
        try { rules = ss.cssRules ? ss.cssRules.length : 0; } catch (e) { rules = null; }
        var href = ss.href || "";
        var title = (owner && owner.getAttribute && owner.getAttribute("title")) || "";
        var id = (owner && owner.id) || "";
        var media = "";
        try { media = (ss.media && ss.media.mediaText) || ""; } catch (e) { media = ""; }
        sheets.push({
          index: i,
          href: href,
          title: title || "",
          id: id,
          media: media,
          disabled: !!ss.disabled,
          rules: rules,
          owned: owned
        });
      }
    } catch (e) {}
    return { sheets: sheets, total: sheets.length };
  }

  function cssToolsToggle(index) {
    var ss = document.styleSheets[index];
    if (!ss) return { success: false, error: "Stylesheet not found" };
    ss.disabled = !ss.disabled;
    return { success: true, disabled: !!ss.disabled };
  }

  function cssToolsToggleAll(on) {
    var count = 0;
    for (var i = 0; i < document.styleSheets.length; i++) {
      var ss = document.styleSheets[i];
      ss.disabled = !!on;
      count++;
    }
    return { success: true, disabled: !!on, count: count };
  }

  function cssToolsApply(css) {
    var st = document.getElementById(cssToolsLiveId);
    if (st && !wspcOwned(cssToolsLiveId)) {
      return { success: false, error: "A page stylesheet uses the extension's internal id; refusing to touch it." };
    }
    if (!st) {
      st = document.createElement("style");
      st.id = cssToolsLiveId;
      wspcTag(st);
      (document.head || document.documentElement).appendChild(st);
    }
    st.textContent = String(css || "");
    return { success: true, chars: String(css || "").length };
  }

  function cssToolsClear() {
    var st = document.getElementById(cssToolsLiveId);
    if (st) {
      if (!wspcOwned(cssToolsLiveId)) return { success: false, error: "Refusing to remove a page-owned element." };
      st.remove();
    }
    return { success: true };
  }

  // =============================================
  // FORMS TOOLS — list every form, locate it,
  // toggle HTML5 validation temporarily (never
  // persistent), fill with visible test values and
  // reset. The form is NEVER submitted.
  // =============================================
  function formsList() {
    var forms = document.querySelectorAll("form");
    var out = [];
    for (var i = 0; i < forms.length; i++) {
      var f = forms[i];
      var label = f.getAttribute("aria-label") || f.getAttribute("title") || "";
      var name = f.getAttribute("name") || "";
      var action = f.getAttribute("action") || "";
      var method = (f.getAttribute("method") || "get").toUpperCase();
      var fields = [];
      var inputs = f.querySelectorAll("input, select, textarea");
      for (var k = 0; k < inputs.length; k++) {
        var el = inputs[k];
        var type = el.tagName.toLowerCase() === "input" ? (el.getAttribute("type") || "text").toLowerCase() : el.tagName.toLowerCase();
        if (type === "hidden" || type === "submit" || type === "button" || type === "reset" || type === "image") continue;
        fields.push({
          type: type,
          name: el.getAttribute("name") || el.getAttribute("id") || "",
          required: el.required || el.getAttribute("required") !== null,
          placeholder: el.getAttribute("placeholder") || "",
          maxlength: el.getAttribute("maxlength") || ""
        });
      }
      out.push({
        index: i,
        label: label || "",
        name: name || "",
        id: f.id || "",
        action: action || "",
        method: method,
        novalidate: f.noValidate || f.getAttribute("novalidate") !== null,
        fields: fields
      });
    }
    return { forms: out, total: out.length };
  }

  function formToggleValidate(index, on) {
    var forms = document.querySelectorAll("form");
    var f = forms[index];
    if (!f) return { success: false, error: "Form not found" };
    if (on) f.setAttribute("novalidate", "");
    else f.removeAttribute("novalidate");
    return { success: true, novalidate: f.noValidate || f.getAttribute("novalidate") !== null };
  }

  function formFillTest(index) {
    var forms = document.querySelectorAll("form");
    var f = forms[index];
    if (!f) return { success: false, error: "Form not found" };
    var filled = 0;
    var inputs = f.querySelectorAll("input, select, textarea");
    for (var k = 0; k < inputs.length; k++) {
      var el = inputs[k];
      var type = el.tagName.toLowerCase() === "input" ? (el.getAttribute("type") || "text").toLowerCase() : el.tagName.toLowerCase();
      if (type === "hidden" || type === "submit" || type === "button" || type === "reset" || type === "image") continue;
      if (el.disabled || el.readOnly) continue;
      if (type === "checkbox" || type === "radio") {
        if (!el.checked) { el.checked = true; filled++; }
        continue;
      }
      if (type === "select" || el.tagName.toLowerCase() === "select") {
        if (el.options && el.options.length) {
          var pick = Math.min(1, el.options.length - 1);
          el.selectedIndex = pick;
          filled++;
        }
        continue;
      }
      try {
        el.value = type === "email" ? "test@example.com"
          : type === "tel" ? "5551234567"
          : type === "url" ? "https://example.com"
          : type === "password" ? "TestPass123"
          : type === "number" ? "42"
          : type === "date" ? "2026-01-01"
          : "Test value";
        filled++;
      } catch (e) {}
    }
    return { success: true, filled: filled, note: "Sample values only \u2014 the form is never submitted." };
  }

  function formReset(index) {
    var forms = document.querySelectorAll("form");
    var f = forms[index];
    if (!f) return { success: false, error: "Form not found" };
    try { f.reset(); } catch (e) {}
    return { success: true };
  }

  // =============================================
  // IMAGE TOOLS — inspect <img> dimensions, alt
  // text, lazy-loading and broken status. Reuses
  // the media tracker's scanning helpers.
  // =============================================
  var imgToolsRefs = [];

  function imageToolsList() {
    var items = [];
    imgToolsRefs = [];
    var imgs = document.querySelectorAll("img");
    var seen = Object.create(null);
    for (var i = 0; i < imgs.length; i++) {
      var img = imgs[i];
      var srcRaw = img.currentSrc || img.getAttribute("src") || "";
      var url = mtAbs(srcRaw);
      var naturalW = 0;
      var naturalH = 0;
      try { naturalW = img.naturalWidth || 0; naturalH = img.naturalHeight || 0; } catch (e) {}
      var broken = !srcRaw || (naturalW === 0 && naturalH === 0);
      var alt = img.getAttribute("alt");
      items.push({
        url: url,
        source: mtSel(img),
        width: naturalW || null,
        height: naturalH || null,
        alt: alt,
        hasAlt: alt !== null,
        altEmpty: alt === "",
        loading: img.getAttribute("loading") || "",
        lazy: (img.getAttribute("loading") || "").toLowerCase() === "lazy",
        broken: broken,
        hidden: !!img.__wspcHidden
      });
      imgToolsRefs.push(img);
    }
    return { items: items, total: items.length };
  }

  function imageToolsFlash(index) {
    var ref = imgToolsRefs[index];
    if (!ref) return { success: false };
    smFlashLive(ref);
    return { success: true };
  }

  // Hide/show a single image for layout debugging. The change is applied as an
  // inline style on the image element itself and is fully reversible — a page
  // reload restores every image, and the tools never remove page DOM.
  function imageToolsToggle(index) {
    var ref = imgToolsRefs[index];
    if (!ref) return { success: false, error: "Image not found" };
    var cur = ref.__wspcHidden;
    var next = !cur;
    ref.__wspcHidden = next;
    try { ref.style.display = next ? "none" : ""; } catch (e) { ref.style.display = ""; }
    return { success: true, hidden: next, index: index };
  }

  // Hide or restore every <img> on the page at once. Fully reversible — a page
  // reload restores all images and nothing in the DOM is removed.
  function imageToolsSetAll(hide) {
    var imgs = document.querySelectorAll("img");
    var changed = 0;
    var hiddenNow = 0;
    for (var i = 0; i < imgs.length; i++) {
      var ref = imgs[i];
      var was = !!ref.__wspcHidden;
      var next = hide || false;
      if (was !== next) {
        ref.__wspcHidden = next;
        try { ref.style.display = next ? "none" : ""; } catch (e) { ref.style.display = ""; }
        changed++;
      }
      if (next) hiddenNow++;
    }
    return { success: true, hidden: hide, count: changed, total: imgs.length, hiddenNow: hiddenNow };
  }

  // Flash helper used by image tools (and reused elsewhere when a standalone
  // temporary highlight is enough).
  function smFlashLive(el) {
    if (!el || !el.getBoundingClientRect) return;
    var flash = document.createElement("div");
    flash.id = "wspc-sm-flash";
    wspcTag(flash);
    flash.style.cssText = "position:fixed;pointer-events:none;z-index:2147483647;border:3px solid #6366f1;background:rgba(99,102,241,.14);border-radius:4px;";
    var r;
    try { r = el.getBoundingClientRect(); } catch (e) { r = null; }
    if (!r) return;
    flash.style.left = (r.left || 0) + "px";
    flash.style.top = (r.top || 0) + "px";
    flash.style.width = Math.max(1, r.width || 0) + "px";
    flash.style.height = Math.max(1, r.height || 0) + "px";
    document.body.appendChild(flash);
    setTimeout(function () { flash.style.opacity = "0"; }, 240);
    setTimeout(function () {
      flash.style.transition = "opacity .2s ease";
      flash.style.opacity = "0";
    }, 240);
    setTimeout(function () { if (flash.remove) flash.remove(); }, 600);
  }

  // =============================================
  // DEBUG AUDIT (Debug tab — full programmatic audit)
  // =============================================
  // One dashboard that rescans the live page for accessibility gaps, common
  // WordPress/Elementor foot-guns, broken media, and responsive breakpoint
  // problems. Everything found maps back to a live element reference so the
  // popup can flash the exact node on the page.

  function debugContainerLabel(el) {
    let n = el && el.parentElement ? el.parentElement : null;
    let depth = 0;
    let landmark = null;
    while (n && n.tagName && depth < 6) {
      const tag = n.tagName.toLowerCase();
      if (tag === "html" || tag === "body") { landmark = landmark || tag; break; }
      const rawId = n.getAttribute ? (n.getAttribute("id") || "") : "";
      if (rawId && /^[A-Za-z_][A-Za-z0-9_\-:.]*$/.test(rawId)) return tag + "#" + rawId;
      const rawCls = n.getAttribute ? (n.getAttribute("class") || "") : "";
      if (typeof rawCls === "string") {
        const first = rawCls.split(/\s+/).filter(Boolean)[0] || "";
        if (first && /^[A-Za-z_][A-Za-z0-9_\-]*$/.test(first)) return tag + "." + first;
      }
      if (/^(section|header|footer|nav|main|article|aside|form|figure|table)$/.test(tag)) landmark = tag;
      n = n.parentElement;
      depth++;
    }
    return landmark || "body";
  }

  function debugElementLabel(el) {
    if (!el || !el.tagName) return "element";
    const tag = el.tagName.toLowerCase();
    let label = "<" + tag;
    const rawId = el.getAttribute ? (el.getAttribute("id") || "") : "";
    if (rawId) label += "#" + String(rawId).substring(0, 24);
    const nm = el.getAttribute ? (el.getAttribute("name") || "") : "";
    if (nm) label += ' name="' + String(nm).substring(0, 24) + '"';
    else {
      const ty = el.getAttribute ? (el.getAttribute("type") || "") : "";
      if (ty && tag === "input") label += ' type="' + String(ty) + '"';
    }
    label += ">";
    const txt = (el.textContent || "").replace(/\s+/g, " ").trim().substring(0, 30);
    if (txt) label += " \u201C" + txt + "\u201D";
    return label;
  }

  // Registers a live element reference (survives only inside the page world)
  // and pushes a catalog item. idx is -1 for non-node findings.
  function dbgPush(list, severity, title, fix, el, extra) {
    const item = { severity: severity, title: title, fix: fix, idx: -1 };
    if (el) {
      try { if (el.isConnected === false) el = null; } catch (e) {}
    }
    if (el) {
      item.idx = debugElements.length;
      debugElements.push(el);
      item.loc = debugElementLabel(el);
      item.section = debugContainerLabel(el);
    }
    if (extra) {
      Object.keys(extra).forEach(function (k) { if (extra[k] !== undefined) item[k] = extra[k]; });
    }
    list.push(item);
  }

  // -- Accessibility ------------------------------------------------------

  function buildLabelMap() {
    const map = Object.create(null);
    const labs = document.querySelectorAll("label");
    for (let i = 0; i < labs.length; i++) {
      const fr = labs[i].getAttribute ? (labs[i].getAttribute("for") || "") : "";
      if (fr && !(fr in map)) {
        const txt = (labs[i].textContent || "").replace(/\s+/g, " ").trim();
        if (txt) map[fr] = txt;
      }
    }
    return map;
  }

  function accessibleNameOf(el, labelMap) {
    const by = function (attr) {
      const others = (el.getAttribute(attr) || "").split(/\s+/).filter(Boolean);
      for (let i = 0; i < others.length; i++) {
        const ref = document.getElementById(others[i]);
        if (ref && (ref.textContent || "").replace(/\s+/g, " ").trim()) return ref.textContent.replace(/\s+/g, " ").trim();
      }
      return "";
    };
    let from = by("aria-labelledby");
    if (from) return from;
    const al = el.getAttribute("aria-label");
    if (al && String(al).trim()) return String(al).trim();
    const fid = el.id;
    if (fid && fid in labelMap) return labelMap[fid];
    if (el.closest) {
      const wrap = el.closest("label");
      if (wrap) {
        const wt = (wrap.textContent || "").replace(/\s+/g, " ").trim();
        if (wt) return wt;
      }
    }
    const ti = el.getAttribute("title");
    if (ti && String(ti).trim()) return String(ti).trim();
    return "";
  }

  function auditA11yControls(out) {
    const labelMap = buildLabelMap();
    const els = document.querySelectorAll("input, textarea, select");
    let checked = 0, flag = 0;
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      const tag = el.tagName.toLowerCase();
      const type = (el.getAttribute("type") || "").toLowerCase();
      if (tag === "input" && (type === "hidden" || type === "submit" || type === "button" ||
        type === "reset" || type === "image" || type === "checkbox" || type === "radio" || type === "file")) continue;
      if (el.disabled) continue;
      checked++;
      if (accessibleNameOf(el, labelMap)) continue;
      flag++;
      const ph = (el.getAttribute("placeholder") || "").replace(/\s+/g, " ").trim();
      const selfRef = String(el.getAttribute("name") || "") + " " + (el.className && typeof el.className === "string" ? el.className : "") + " " + String(el.getAttribute("id") || "");
      const isSearch = type === "search" || /search/i.test(selfRef) || (el.getAttribute("role") || "") === "searchbox";
      const kind = tag === "textarea" ? "Textarea" : (isSearch ? "Search field" : "Form field");
      dbgPush(out, isSearch ? "error" : "warning",
        kind + " has no accessible label" + (ph ? " \u2014 relies only on placeholder \u201C" + ph.substring(0, 28) + "\u201D" : ""),
        "Give the field an explicit <label for=\u2026> (preferred) or aria-label / aria-labelledby / title. Placeholders are not exposed to screen readers as a name.",
        el, { checked: true });
    }
    return { checked: checked, flag: flag };
  }

  function auditIconButtons(out) {
    const els = document.querySelectorAll("button, [role='button']");
    let checked = 0, flag = 0;
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      if (el.disabled) continue;
      checked++;
      let name = String(el.getAttribute("aria-label") || "").trim();
      if (!name) {
        const lb = String(el.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean);
        for (let j = 0; j < lb.length; j++) {
          const ref = document.getElementById(lb[j]);
          if (ref && (ref.textContent || "").trim()) { name = ref.textContent.trim(); break; }
        }
      }
      if (!name) {
        const text = (el.textContent || "").replace(/\s+/g, " ").trim();
        const title = String(el.getAttribute("title") || "").trim();
        if (text && /[A-Za-z0-9]/.test(text)) name = text;
        else if (title) name = title;
      }
      if (name && /[A-Za-z0-9]/.test(name)) continue;
      // Icon-only control with no accessible name (carousel arrows, toggles…) —
      // only flag those that actually contain an icon glyph.
      const inner = el.querySelector ? el.querySelector("svg, i, img, [class*='icon']") : null;
      if (!inner) continue;
      flag++;
      dbgPush(out, "warning", "Icon-only button has no accessible name",
        "Add aria-label (\u201CNext slide\u201D, \u201COpen menu\u201D\u2026) or a visually hidden <span class=\"sr-only\">. A bare icon without a name is invisible to screen readers and keyboard-focused users.",
        el, { checked: true });
    }
    return { checked: checked, flag: flag };
  }

  // -- WordPress & Elementor / DOM integrity ------------------------------

  function makeIdSet() {
    const set = Object.create(null);
    const nodes = document.querySelectorAll("[id]");
    for (let i = 0; i < nodes.length; i++) {
      const id = nodes[i].id || nodes[i].getAttribute("id") || "";
      if (id) set[id] = true;
    }
    return set;
  }

  // Hash links that are actually UI toggles (modals, accordions, popovers,
  // tabs) are not dead anchors even when no element matches the fragment.
  function isPopupToggle(a) {
    const raw = function (attr) {
      const v = a.getAttribute ? a.getAttribute(attr) : null;
      return String(v || "").trim().toLowerCase();
    };
    const toggle = raw("data-toggle") || raw("data-bs-toggle") || raw("data-modal") || raw("data-popup");
    if (toggle && /(modal|collapse|tab|popover|dropdown|drawer)/.test(toggle)) return true;
    const targetAttr = raw("data-target") || raw("data-bs-target");
    if (targetAttr) return true;
    const cls = a.className && typeof a.className === "string" ? a.className.toLowerCase() : "";
    if (/(^|[\s_-])(popup|modal|lightbox|fancybox|magnific|toggle|trigger|accordion|drawer|panel)([\s_-]|$)/.test(cls)) return true;
    const role = raw("role");
    if (role === "tab" || raw("aria-haspopup") === "true") return true;
    return false;
  }

  // Nearest named container for a failing fragment link ("section.site-footer",
  // "nav#main-menu", "div.sidebar" ...) so the report pinpoints the section.
  function anchorSectionLabel(el) {
    let n = el && el.parentElement ? el.parentElement : null;
    let depth = 0;
    while (n && n.tagName && depth < 6) {
      const tag = n.tagName.toLowerCase();
      if (tag === "html" || tag === "body") break;
      if (/^(section|header|footer|nav|main|article|aside)$/.test(tag) || tag === "div") {
        const rawId = n.getAttribute ? (n.getAttribute("id") || "") : "";
        const rawCls = (n.className && typeof n.className === "string" ? n.className : "")
          || (n.getAttribute ? (n.getAttribute("class") || "") : "");
        const cls = typeof rawCls === "string" ? rawCls.split(/\s+/).filter(Boolean) : [];
        const label = tag
          + (rawId ? "#" + String(rawId).substring(0, 24)
          : (cls.length ? "." + String(cls[0]).substring(0, 24) : ""));
        return label;
      }
      n = n.parentElement;
      depth++;
    }
    return "";
  }

  function auditBrokenAnchors(out) {
    const anchors = document.querySelectorAll("a[href]");
    let checked = 0, flag = 0;
    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i];
      const href = String(a.getAttribute("href") || "");
      if (href.charAt(0) !== "#") continue;
      checked++;
      if (href === "#" || href === "#!" || href === "#top" || href === "#bottom") {
        flag++;
        dbgPush(out, "error", "Placeholder link points nowhere" + (href === "#" ? " (href=\"#\")" : ""),
          "Replace href=\"#\" with a real destination (or an existing fragment). Link-like elements without targets confuse crawlers, and they jump the page for keyboard users instead of navigating.",
          a, { checked: true });
        continue;
      }
      // Simple hash toggles that drive popups/accordions are not dead anchors.
      if (isPopupToggle(a)) continue;
      const frag = href.substring(1);
      if (!document.getElementById(frag)) {
        flag++;
        const sectionName = anchorSectionLabel(a);
        dbgPush(out, "error", "Broken internal anchor \"#" + String(frag).substring(0, 24) + "\" has no matching element"
          + (sectionName ? " \u2014 found in " + sectionName : ""),
          "Point the link at an existing element with id=\"" + String(frag).substring(0, 24) + "\" or remove the fragment. Dead in-page anchors are a common Elementor/menu pattern after re-builds.",
          a, { checked: true, section: sectionName || "" });
      }
    }
    return { checked: checked, flag: flag };
  }

  function auditDuplicateIds(out) {
    const seen = Object.create(null);
    const first = Object.create(null);
    const nodes = document.querySelectorAll("[id]");
    for (let i = 0; i < nodes.length; i++) {
      const id = nodes[i].id || nodes[i].getAttribute("id") || "";
      if (!id) continue;
      if (id in seen) {
        seen[id] = (seen[id] || 1) + 1;
        if (!(id in first)) first[id] = nodes[i];
      } else {
        seen[id] = 1;
      }
    }
    let groups = 0;
    Object.keys(seen).forEach(function (id) {
      if (seen[id] < 2) return;
      groups++;
      dbgPush(out, "error", "Duplicate element id \"#" + id.substring(0, 28) + "\" used " + seen[id] + " times",
        "Make ids unique (best: regenerate the content in the builder). Duplicate ids break anchor jumps, label[for] associations, and CSS/JS id lookups.",
        first[id] || null, { count: seen[id] });
    });
    return { groups: groups };
  }

  function auditInlineCss(out) {
    const mb = function (len) { return (len / 1024).toFixed(1) + " KB"; };
    const styles = document.querySelectorAll("style");
    for (let i = 0; i < styles.length; i++) {
      const len = ((styles[i].textContent || "") || "").length;
      if (len > 20000) {
        dbgPush(out, "error", "Bloated inline <style> block (" + mb(len) + ")",
          "Move the CSS to an external stylesheet. In Elementor, enable \u201CExternal CSS\u201D (Elementor \u2192 Settings \u2192 Advanced \u2192 CSS print method) to slim page weight and cache it.",
          styles[i]);
      } else if (len > 8000) {
        dbgPush(out, "warning", "Large inline <style> block (" + mb(len) + ")",
          "Inline CSS bypasses browser caching. Move it to a stylesheet, or strip unused rules (Elementor region/kit CSS can often be trimmed with a cleanup plugin).",
          styles[i]);
      }
    }
    const inlineEls = document.querySelectorAll("[style]");
    if (inlineEls.length > 25) {
      dbgPush(out, "warning", "Heavy inline styling \u2014 " + inlineEls.length + " style attributes",
        "Move repeated inline styles into classes (or Elementor's Typography/Spacing panels). Inline styles fight media queries and can\u2019t be overridden cleanly.",
        inlineEls[0]);
    }
    return { blocks: styles.length, inline: inlineEls.length, flag: 0 };
  }

  function auditScriptDeps(out) {
    const scripts = document.querySelectorAll("script");
    let inlineText = "";
    for (let i = 0; i < scripts.length && inlineText.length < 200000; i++) {
      if (scripts[i].getAttribute && scripts[i].getAttribute("src")) continue;
      inlineText += (scripts[i].textContent || "") + "\n";
    }
    let flag = 0;
    if (/[\$]\(|jQuery\s*\(|\$\.ajax|\.ready\s*\(/.test(inlineText) && typeof window.jQuery === "undefined") {
      flag++;
      dbgPush(out, "error", "Inline script depends on jQuery but jQuery is not loaded",
        "Load jQuery before the inline script (WP: keep scripts\u2019 jQuery dependency, disable \u201CLoad jQuery from Google\u201D mismatches), or rewrite the <script> to plain JavaScript. Elementor widgets very often core on $.",
        null, { scope: "window" });
    }
    if (/\bwp\.(util|media|api|data|editor)\b/.test(inlineText) && typeof window.wp === "undefined") {
      flag++;
      dbgPush(out, "error", "Inline script uses WordPress utilities (wp.*) but wp is not loaded",
        "The fragment expects the WordPress JS runtime (wp.util/api/media). Load it in the footer or correct the enqueue order so the dependency resolves before the script runs.",
        null, { scope: "window" });
    }
    if (/(?:new\s+)?Swiper\s*\(/i.test(inlineText) && typeof window.Swiper === "undefined") {
      flag++;
      dbgPush(out, "warning", "Inline script expects Swiper but no Swiper library is loaded",
        "Enqueue the Swiper bundle (or a slider that bundles it) before the inline initializer, otherwise the carousel never mounts.",
        null, { scope: "window" });
    }
    return { inline: scripts.length, flag: flag };
  }

  function auditSvgA11y(out) {
    const svgs = document.querySelectorAll("svg");
    let checked = 0, flag = 0;
    for (let i = 0; i < svgs.length && checked < 80; i++) {
      const svg = svgs[i];
      checked++;
      const ah = String(svg.getAttribute("aria-hidden") || "").trim() === "true";
      const role = String(svg.getAttribute("role") || "").trim();
      const al = String(svg.getAttribute("aria-label") || "").trim();
      const alb = String(svg.getAttribute("aria-labelledby") || "").trim();
      let titleChild = "";
      const kids = svg.children || [];
      for (let j = 0; j < kids.length; j++) {
        const kc = kids[j].tagName ? kids[j].tagName.toLowerCase() : "";
        if (kc === "title" || kc === "desc") {
          const kt = (kids[j].textContent || "").replace(/\s+/g, " ").trim();
          if (kt) { titleChild = kt; break; }
        }
      }
      let name = al || alb || titleChild;
      if (role === "presentation" || ah) continue;
      if (!name) {
        flag++;
        dbgPush(out, "warning", "Icon SVG has no accessible name (no aria-label, title, or aria-hidden)",
          "If the icon is decorative, add aria-hidden=\"true\". If it is meaningful, add role=\"img\" + aria-label (or a <title>/<desc> child). Elementor icon widgets often reset these on copy.",
          svg);
      }
      const isDecorative = ah || (role === "img" && name);
      if (!isDecorative) {
        let paths = 0;
        const allKids = svg.querySelectorAll ? svg.querySelectorAll("path, circle, rect, polygon, line") : [];
        paths = allKids.length;
        if (paths > 60) {
          flag++;
          dbgPush(out, "info", "Unoptimized SVG icon \u2014 " + paths + " inline vector nodes",
            "Replace the hand-drawn path soup with a Sprite/Icomoon/SVG-sprite icon set, or run the file through an SVG optimizer (SVGO) and re-import it.",
            svg, { paths: paths });
        }
      }
    }
    return { checked: checked, flag: flag };
  }

  function auditBrokenImages(out) {
    const imgs = document.querySelectorAll("img");
    let checked = 0, flag = 0;
    const none = function (el, a) { const v = el.getAttribute ? el.getAttribute(a) : null; return !v || !String(v).trim(); };
    for (let i = 0; i < imgs.length; i++) {
      const img = imgs[i];
      checked++;
      const src = img.currentSrc || (img.getAttribute && (img.getAttribute("src") || ""));
      const dataSrc = img.getAttribute && (img.getAttribute("data-src") || img.getAttribute("data-lazy-src") || "");
      const sets = img.getAttribute && (img.getAttribute("srcset") || "");
      if (!src && !dataSrc && !sets) {
        flag++;
        dbgPush(out, "error", "Image element has no source at all",
          "Every <img> needs a src (or srcset). Add the file or the lazy-load data-src, and include width/height so the layout keeps a reserved box.",
          img);
        continue;
      }
      if (!src) continue;
      // Only trust raster state when the browser has really decoded it.
      let broke = false;
      try { broke = img.complete === true && typeof img.naturalWidth === "number" && img.naturalWidth === 0; } catch (e) { broke = false; }
      if (broke) {
        flag++;
        dbgPush(out, "error", "Broken image \u2014 the URL fails to render with no fallback",
          "Replace the src with a working file, or add an onerror fallback / <picture> sources. Preview images that 404 leave a broken-icon hole (and often a layout shift when they load).",
          img, { url: String(src).substring(0, 140) });
      }
    }
    return { checked: checked, flag: flag };
  }

  // -- Responsive & breakpoints ------------------------------------------

  function auditBreakpoints() {
    const out = { breakPoints: 0, minWidthRules: 0, desktopFirst: false, bounds: [], viewportMeta: false, viewportContent: "", width: 0 };
    const vp = document.querySelector("meta[name='viewport']");
    out.viewportMeta = !!vp;
    if (vp) out.viewportContent = (vp.getAttribute("content") || "").trim();
    out.width = window.innerWidth || document.documentElement.clientWidth || 0;
    const MAX_SHEETS = 40, MAX_RULES = 900;
    const boundsSet = Object.create(null);
    try {
      const addBound = function (n) {
        if (!isNaN(n) && n > 0 && !boundsSet[n]) { boundsSet[n] = true; out.bounds.push(n); }
      };
      const parseCond = function (cond) {
        if (!cond) return;
        const re = /(min|max)-width\s*:\s*([0-9.]+)px/gi;
        let m;
        while ((m = re.exec(cond)) !== null) {
          const v = Math.round(parseFloat(m[2]));
          out.minWidthRules += (m[1] === "min" && v > 320) ? 1 : 0;
          addBound(v);
        }
      };
      const walk = function (list, budget) {
        if (!list || budget.used >= budget.max) return;
        for (let j = 0; j < list.length && budget.used < budget.max; j++) {
          const rule = list[j];
          if (!rule) continue;
          budget.used++;
          const isMedia = rule.type === 4 || (rule.constructor && rule.constructor.name === "CSSMediaRule");
          if (isMedia) {
            out.breakPoints++;
            try { parseCond(rule.conditionText || (rule.media && rule.media.mediaText) || ""); } catch (e) {}
            walk(rule.cssRules, budget);
          }
        }
      };
      const sheetCount = Math.min(document.styleSheets.length, MAX_SHEETS);
      for (let s = 0; s < sheetCount; s++) {
        let rules;
        try { rules = document.styleSheets[s].cssRules; } catch (e) { continue; }
        walk(rules, { used: 0, max: MAX_RULES });
      }
    } catch (e) {}
    out.bounds = out.bounds.sort(function (a, b) { return a - b; });
    out.desktopFirst = out.minWidthRules > 3;
    return out;
  }

  const DBG_RESP_TAGS = "div, section, article, main, aside, ul, ol, nav, header, footer, figure, form, table";

  function dbgVisible(el) {
    if (el.getAttribute && (el.getAttribute("aria-hidden") === "true")) return false;
    const r = el.getBoundingClientRect();
    return r && r.width > 0 && r.height > 0 && r.width < 40000 && r.height < 60000;
  }

  function sameRect(a, b) {
    return a.left === b.left && a.top === b.top && a.right === b.right && a.bottom === b.bottom;
  }

  function auditResponsiveRuntime(out, bp) {
    const winW = bp.width || window.innerWidth || document.documentElement.clientWidth || 0;
    let maxContentWidth = 0;
    const scrollW = document.documentElement.scrollWidth || 0;

    if (scrollW > winW + 1) {
      dbgPush(out, "error", "Page is " + (scrollW - winW) + "px wider than the " + winW + "px viewport",
        "Find the widest offenders (listed below) and make them fluid: width/max-width in % (or max-width:100% with box-sizing:border-box), then remove any min-width floors.",
        null, { px: scrollW - winW, checked: true });
    } else {
      dbgPush(out, "info", "No horizontal overflow at " + winW + "px \u2014 content fits the viewport", "", null);
    }

    if (!bp.viewportMeta) {
      dbgPush(out, "error", "Viewport meta tag is missing",
        "Add <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"> so mobile browsers render at the device width instead of a desktop width.",
        null, { checked: true });
    } else if (bp.viewportContent && bp.viewportContent.indexOf("width=device-width") === -1) {
      dbgPush(out, "warning", "Viewport meta is incomplete \u2014 \u201C" + String(bp.viewportContent).substring(0, 40) + "\u201D",
        "Set content=\"width=device-width, initial-scale=1\" so the layout maps 1:1 to the device width.",
        null, { checked: true });
    } else if (bp.viewportMeta) {
      dbgPush(out, "info", "Viewport meta is configured correctly", "", null);
    }

    if (bp.breakPoints === 0) {
      dbgPush(out, "warning", "No @media queries detected in readable stylesheets",
        "Without media queries the layout never adapts. Add mobile-first breakpoints (\u2248 480px / 768px / 1024px) or check that the theme/Elementor responsive CSS is actually enqueued.",
        null, { checked: true });
    } else if (bp.desktopFirst) {
      dbgPush(out, "warning", "Desktop-first breakpoints \u2014 " + bp.minWidthRules + " min-width rules",
        "min-width rules lock a wide layout and are inherited by small screens. Prefer mobile-first max-width breakpoints so phones get a dedicated narrow layout.",
        null, { checked: true });
    } else {
      dbgPush(out, "info", bp.breakPoints + " @media block(s) detected", "", null);
    }

    // Wide fixed boxes + offscreen + flex overflow, sampled and capped.
    const candEls = document.querySelectorAll(DBG_RESP_TAGS);
    let fixedCount = 0, offscreenCount = 0, flexBroken = 0;
    const fixedSample = [], offSample = [], flexSample = [];
    const maxScan = Math.min(candEls.length, 600);
    for (let i = 0; i < maxScan; i++) {
      const el = candEls[i];
      if (!dbgVisible(el)) continue;
      const r = el.getBoundingClientRect();
      const w = r.width;
      if (w > maxContentWidth) maxContentWidth = w;
      if (r.left < -9 || r.right > winW + 2) {
        if (offscreenCount < 5) offSample.push(el);
        offscreenCount++;
        continue;
      }
      let cs = null;
      try { cs = window.getComputedStyle(el); } catch (e) { cs = null; }
      if (!cs) continue;
      const disp = cs.display || "";
      const wpx = (cs.width || "").match(/^([0-9.]+)px$/);
      if (wpx && parseFloat(wpx[1]) > winW + 1 && /^(div|section|article|main|aside|table|form|ul|ol|header|footer)$/.test(el.tagName.toLowerCase())) {
        if (fixedCount < 5) fixedSample.push(el);
        fixedCount++;
      }
      if ((disp === "flex" || disp === "inline-flex") && el.scrollWidth > el.clientWidth + 2) {
        if (flexBroken < 5) flexSample.push(el);
        flexBroken++;
      }
    }
    if (fixedCount) {
      dbgPush(out, "warning", fixedCount + " fixed-width box(es) wider than the viewport",
        "Convert the hard-coded pixel width to max-width:100% + box-sizing:border-box so the container can shrink at smaller breakpoints.",
        fixedSample[0], { count: fixedCount });
    }
    if (offscreenCount) {
      dbgPush(out, "warning", offscreenCount + " element(s) stick out past the right edge",
        "Remove negative right margins/translations and fixed min-widths pushing content off-canvas; let content wrap instead.",
        offSample[0], { count: offscreenCount });
    }
    if (flexBroken) {
      dbgPush(out, "warning", flexBroken + " flex container(s) overflow their children",
        "Broken flex \u2014 children overflow the track. Add min-width:0 on shrinking children, allow flex-wrap, or remove fixed min/max widths inside the flex row.",
        flexSample[0], { count: flexBroken });
    }

    // Text-overlap probe: same-parent text blocks that visibly collide.
    let textOverlap = 0;
    const containers = document.querySelectorAll(DBG_RESP_TAGS);
    const maxC = Math.min(containers.length, 60);
    let overSample = null;
    for (let c = 0; c < maxC && !overSample; c++) {
      const par = containers[c];
      const parRect = par.getBoundingClientRect();
      if (parRect.width === 0 || parRect.height === 0) continue;
      const kids = par.children || [];
      if (kids.length < 2 || kids.length > 14) continue;
      const leaves = [];
      for (let k = 0; k < kids.length; k++) {
        const kid = kids[k];
        const txt = (kid.textContent || "").replace(/\s+/g, " ").trim();
        if (!txt) continue;
        if (!kid.getBoundingClientRect) continue;
        const rr = kid.getBoundingClientRect();
        if (rr.width <= 0 || rr.height <= 0) continue;
        leaves.push({ el: kid, r: rr, txt: txt });
      }
      for (let a = 0; a < leaves.length && !overSample; a++) {
        for (let b = a + 1; b < leaves.length; b++) {
          const A = leaves[a], B = leaves[b];
          if (sameRect(A.r, B.r)) continue;
          const ix = Math.max(0, Math.min(A.r.right, B.r.right) - Math.max(A.r.left, B.r.left));
          const iy = Math.max(0, Math.min(A.r.bottom, B.r.bottom) - Math.max(A.r.top, B.r.top));
          const area = ix * iy;
          if (area <= 0) continue;
          const minArea = Math.min(A.r.width * A.r.height, B.r.width * B.r.height);
          if (minArea < 400 || area / minArea < 0.35) continue;
          textOverlap++;
          overSample = par;
          break;
        }
      }
    }
    if (textOverlap) {
      dbgPush(out, "warning", "Overlapping text blocks detected in a shared container",
        "Adjacent labels/lines collide \u2014 check the container\u2019s gaps, line-height, margins, and any negative z-index layering at this width. Re-test at 390px and 768px with the breakpoint buttons.",
        overSample, { count: textOverlap });
    } else {
      dbgPush(out, "info", "No overlapping text blocks in sampled containers", "", null);
    }

    dbgPush(out, "info", "Widest element \u2248 " + Math.round(maxContentWidth) + "px at " + winW + "px viewport", "", null);

    return { width: winW, maxContentWidth: Math.round(maxContentWidth), fixed: fixedCount, offscreen: offscreenCount, flex: flexBroken, overlap: textOverlap };
  }

  // -- Broken media URLs (network probe) -----------------------------------

  async function auditMedia404(out) {
    const candidates = [];
    const pushUrl = function (url, el) {
      if (!url || !String(url).trim()) return;
      const clean = String(url).trim();
      if (/^(data:|blob:|javascript:|mailto:|tel:|about:|chrome-|moz-)/i.test(clean)) return;
      let abs;
      try { abs = new URL(clean, document.baseURI || location.href).href; } catch (e) { return; }
      candidates.push({ url: abs, el: el });
    };
    const imgs = document.querySelectorAll("img");
    for (let i = 0; i < imgs.length; i++) {
      const g = function (n) { return imgs[i].getAttribute ? (imgs[i].getAttribute(n) || "") : ""; };
      if (g("src")) pushUrl(g("src"), imgs[i]);
      else if (g("data-src")) pushUrl(g("data-src"), imgs[i]);
      const set = g("srcset");
      if (set) {
        const parts = String(set).split(",");
        if (parts.length) pushUrl(parts[0].split(/\s+/)[0], imgs[i]);
      }
    }
    const mediaEls = document.querySelectorAll("video, audio, source");
    for (let i = 0; i < mediaEls.length; i++) {
      const s = mediaEls[i].getAttribute ? (mediaEls[i].getAttribute("src") || "") : "";
      if (s) pushUrl(s, mediaEls[i]);
    }
    const icons = document.querySelectorAll("link[rel='icon'], link[rel='apple-touch-icon']");
    for (let i = 0; i < icons.length; i++) {
      const s = icons[i].getAttribute ? (icons[i].getAttribute("href") || "") : "";
      if (s) pushUrl(s, icons[i]);
    }
    const seen = Object.create(null);
    const uniq = [];
    candidates.forEach(function (c) {
      if (seen[c.url] || uniq.length >= 24) return;
      seen[c.url] = true;
      uniq.push(c);
    });
    let checked = 0, flag = 0;
    if (uniq.length) {
      const pool = Math.max(1, Math.min(4, uniq.length));
      const results = new Array(uniq.length);
      let next = 0;
      await new Promise(function (res2) {
        let remaining = uniq.length;
        const work = function () {
          const i = next++;
          if (i >= uniq.length) return;
          checkBrokenLinkStatus(uniq[i].url).then(function (res) {
            results[i] = res;
            if (--remaining === 0) { res2(); return; }
            work();
          }, function () {
            results[i] = null;
            if (--remaining === 0) { res2(); return; }
            work();
          });
        };
        for (let k = 0; k < pool; k++) work();
      });
      uniq.forEach(function (c, i) {
        const res = results[i];
        checked++;
        if (res && (res.status === 404 || res.status === 410)) {
          flag++;
          dbgPush(out, "error", "Media URL returns HTTP " + res.status,
            "Fix or remove this media reference \u2014 the file is gone (renamed/moved/deleted). Re-upload and hard-refresh, and add width/height so a missing image keeps its layout box.",
            c.el, { url: String(c.url).substring(0, 160) });
        }
      });
    }
    return { checked: checked, flag: flag };
  }

  // -- Orchestrator --------------------------------------------------------

  async function runDebugAudit() {
    debugElements = [];
    const groups = { a11y: [], wp: [], resp: [], media: [] };
    const det = auditIconButtons(groups.a11y);
    const ctl = auditA11yControls(groups.a11y);
    const an = auditBrokenAnchors(groups.wp);
    const du = auditDuplicateIds(groups.wp);
    const css = auditInlineCss(groups.wp);
    const deps = auditScriptDeps(groups.wp);
    const svg = auditSvgA11y(groups.wp);
    const img = auditBrokenImages(groups.media);
    const bp = auditBreakpoints();
    const rt = auditResponsiveRuntime(groups.resp, bp);
    const media = await auditMedia404(groups.media);

    const count = function (arr, sev) { return arr.filter(function (x) { return x.severity === sev; }).length; };
    const allIn = groups.a11y.concat(groups.wp).concat(groups.resp).concat(groups.media);
    const errors = count(allIn, "error");
    const warnings = count(allIn, "warning");
    const infos = count(allIn, "info");
    let level = "good";
    if (errors >= 3) level = "critical";
    else if (errors > 0 || warnings >= 4) level = "warning";

    return {
      ok: true,
      ts: Date.now(),
      url: location.href || "",
      title: document.title || "",
      width: bp.width,
      level: level,
      totals: { errors: errors, warnings: warnings, infos: infos, total: allIn.length },
      stats: [
        { label: "Form controls checked", value: ctl.checked },
        { label: "Buttons checked", value: det.checked },
        { label: "In-page anchors", value: an.checked },
        { label: "Media URLs probed", value: media.checked }
      ],
      summary: {
        controlsFlagged: ctl.flag,
        iconButtons: det.flag,
        anchorsFlagged: an.flag,
        duplicateIdGroups: du.groups,
        scriptsFlagged: deps.flag,
        svgsFlagged: svg.flag,
        imagesFlagged: img.flag,
        media404: media.flag,
        breakPoints: bp.breakPoints,
        minWidthRules: bp.minWidthRules,
        viewportMeta: bp.viewportMeta
      },
      breakpoints: bp.bounds,
      viewport: { width: bp.width, viewportContent: bp.viewportContent, breakPoints: bp.breakPoints, minWidthRules: bp.minWidthRules, desktopFirst: bp.desktopFirst },
      responsive: rt,
      groups: {
        a11y: groups.a11y,
        wp: groups.wp,
        resp: groups.resp,
        media: groups.media
      }
    };
  }

  // =============================================
  // SITE CRAWLER (frontend structure + responsive)
  // =============================================
  // The child-page crawler audits every loaded page through this engine. Scope
  // is deliberately narrow: frontend structure and responsive layout only -
  // layout breakages, viewport issues, icons, CTAs, design, broken URLs,
  // missing images and missing structural tags. Everything returned is plain,
  // serializable data (labels + fix strings) so results across tabs can merge
  // into one site report file.

  var CRAWL_ASSET_EXT = /\.(png|jpe?g|gif|webp|svg|ico|css|js|m?js|json|woff2?|ttf|otf|eot|mp4|webm|ogv|mp3|wav|pdf|zip|gz|7z|docx?|xlsx?|pptx?|txt|rtf|xml)$/i;

  function faVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    if (el.getAttribute && el.getAttribute("aria-hidden") === "true") return false;
    try {
      const r = el.getBoundingClientRect();
      return r && r.width > 0 && r.height > 0 && r.width < 40000 && r.height < 60000;
    } catch (e) { return false; }
  }

  // Same shape as dbgPush but without registering live element indexes: crawl
  // results must survive the tab closing so they can be merged into a report.
  function faPush(list, severity, title, fix, el, extra) {
    const item = { severity: severity, title: title, fix: fix };
    if (el) {
      try { item.loc = debugElementLabel(el); } catch (e) {}
      try { item.section = debugContainerLabel(el); } catch (e) {}
    }
    if (extra) {
      Object.keys(extra).forEach(function (k) { if (extra[k] !== undefined) item[k] = extra[k]; });
    }
    list.push(item);
  }

  function auditFavicon(out) {
    let declared = false;
    const links = document.querySelectorAll("link[rel*='icon']");
    for (let i = 0; i < links.length; i++) {
      const href = links[i].getAttribute ? (links[i].getAttribute("href") || "") : "";
      if (href && String(href).trim()) { declared = true; break; }
    }
    if (!declared) {
      faPush(out, "warning", "No favicon declared",
        "Add <link rel=\"icon\" href=\"favicon.svg\"> (plus an apple-touch-icon for iOS). Tabs and bookmarks fall back to a generic globe icon without it.");
    }
    return { declared: declared };
  }

  function auditCtaButtons(out) {
    const SELL = /(^|[\s_-])(cta|btn|button|hero|buy|shop|order|checkout|subscribe|sign[- ]?up|sign[- ]?in|register|join|start|try|download|get[- ]?started|learn[- ]?more|read[- ]?more|explore)([\s_-]|$)/i;
    const cand = document.querySelectorAll('a[href], button, [role="button"], input[type="submit"], input[type="button"], input[type="image"]');
    const maxScan = Math.min(cand.length, 90);
    let checked = 0, noLabel = 0, placeholder = 0, tiny = 0;
    const nameOf = function (el, tag) {
      const aria = String(el.getAttribute && (el.getAttribute("aria-label") || el.getAttribute("aria-labelledby")) || "").trim();
      if (aria) return aria;
      if (tag === "input") return String(el.getAttribute && el.getAttribute("value") || "").trim();
      const text = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (text) return text;
      if (typeof el.querySelector === "function") {
        const imgAlt = el.querySelector("img[alt]");
        if (imgAlt) {
          const a = imgAlt.getAttribute("alt");
          if (a && String(a).trim()) return String(a).trim();
        }
      }
      return String(el.getAttribute && el.getAttribute("title") || "").trim();
    };
    for (let i = 0; i < maxScan; i++) {
      const el = cand[i];
      if (el.disabled) continue;
      if (!faVisible(el)) continue;
      const tag = el.tagName ? el.tagName.toLowerCase() : "";
      let cls = "";
      try { cls = (typeof el.className === "string" ? el.className : (el.getAttribute ? (el.getAttribute("class") || "") : "")) || ""; } catch (e) { cls = ""; }
      let disp = "";
      try { disp = window.getComputedStyle(el).display || ""; } catch (e) { disp = ""; }
      if (disp !== "none") disp = disp || "block";
      const isBtn = tag === "button" || tag === "input" || (el.getAttribute && el.getAttribute("role") === "button");
      const linkyText = /(apply|submit|continue|read more|learn more|get started|sign up|buy|shop|order|start|try|download)/i.test(el.textContent || "");
      // Only block-like, actionable controls count as CTAs; plain inline text
      // links are left out so we don't nag about every normal hyperlink.
      if (!isBtn && disp === "inline") {
        if (!SELL.test(" " + String(cls) + " ") || !linkyText) continue;
      }
      checked++;
      const name = nameOf(el, tag);
      if (!name) {
        noLabel++;
        if (noLabel <= 5) {
          faPush(out, "warning", "CTA control has no readable label",
            "Give the button or primary link visible text (or aria-label). Unlabelled CTAs confuse screen readers and visitors - nobody can tell what the action does.",
            el);
        }
      }
      const href = el.getAttribute ? (el.getAttribute("href") || "") : "";
      if (href === "#" || /^javascript:/i.test(href)) {
        placeholder++;
        if (placeholder <= 3) {
          faPush(out, "error", "CTA points at a placeholder URL" + (href === "#" ? " (href=\"#\")" : " (javascript: URL)"),
            "Wire the call-to-action to a real destination page; a placeholder goes nowhere when a visitor clicks it.",
            el);
        }
      }
      if (disp !== "inline") {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && (r.height < 40 || r.width < 40)) {
          tiny++;
          if (tiny <= 5) {
            faPush(out, "warning", "Small tap target \u2014 " + Math.round(r.width) + "\u00D7" + Math.round(r.height) + "px CTA",
              "Aim for at least 44\u00D744px (comfortable for touch and pointer accuracy). Add padding, min-height/min-width, or a larger font size.",
              el);
          }
        }
      }
    }
    return { checked: checked, noLabel: noLabel, placeholder: placeholder, tiny: tiny };
  }

  function parseCssColor(str, fallback) {
    str = String(str || "").trim();
    if (!str || str === "transparent") return fallback || null;
    let m = str.match(/rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)/i);
    if (m) return [Math.max(0, Math.min(255, parseFloat(m[1]))), Math.max(0, Math.min(255, parseFloat(m[2]))), Math.max(0, Math.min(255, parseFloat(m[3])))];
    m = str.match(/#([0-9a-f]{6})/i);
    if (m) { const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
    m = str.match(/#([0-9a-f]{3})/i);
    if (m) { const n = parseInt(m[1] + m[1] + m[2] + m[2] + m[3] + m[3], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
    return fallback || null;
  }

  function faLuminance(rgb) {
    const a = rgb.map(function (v) {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
  }

  function faContrast(fg, bg) {
    const l1 = faLuminance(fg), l2 = faLuminance(bg);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }

  function faEffectiveBg(el) {
    let n = el;
    while (n && n.tagName) {
      let c = null;
      try { c = parseCssColor(window.getComputedStyle(n).backgroundColor, null); } catch (e) { c = null; }
      if (c) return c;
      if (n === document.documentElement) break;
      n = n.parentElement;
    }
    return [255, 255, 255];
  }

  function auditDesign(out) {
    const res = { bodyFont: "", lowContrast: 0, imgsNoDims: 0 };
    try {
      const cs = window.getComputedStyle(document.body);
      const px = parseFloat(cs.fontSize);
      if (isFinite(px) && px > 0) {
        res.bodyFont = px;
        if (px < 14) {
          faPush(out, px < 12 ? "error" : "warning", "Body text is small \u2014 " + px + "px",
            "Increase the base font size to 16px (or at least 14px). Sub-14px body text is hard to read, especially on phones.");
        }
      }
    } catch (e) {}
    const textSel = "h1, h2, h3, h4, h5, h6, p, a, li, button, span, label, td, blockquote, strong";
    const els = document.querySelectorAll(textSel);
    const maxScan = Math.min(els.length || 0, 70);
    let flagged = 0;
    for (let i = 0; i < maxScan; i++) {
      const el = els[i];
      if (flagged >= 4) break;
      if (!faVisible(el)) continue;
      const txt = (el.textContent || "").replace(/\s+/g, "").trim();
      if (!txt || !/[A-Za-z0-9\u00C0-\u024F]/.test(txt)) continue;
      let st = null;
      try { st = window.getComputedStyle(el); } catch (e) { continue; }
      const fg = parseCssColor(st.color, null);
      if (!fg) continue;
      const fs = parseFloat(st.fontSize) || 16;
      const bold = parseInt(st.fontWeight, 10) >= 700;
      const large = fs >= 24 || (fs >= 18.66 && bold);
      const need = large ? 3.0 : 4.5;
      const ratio = faContrast(fg, faEffectiveBg(el));
      if (ratio < need) {
        flagged++;
        faPush(out, "warning", "Low text contrast \u2014 " + ratio.toFixed(2) + ":1" + (large ? " (large text)" : ""),
          "Increase the contrast between this text and its background to at least " + need + ":1 (WCAG AA) so content stays legible.",
          el, { ratio: Math.round(ratio * 100) / 100 });
      }
    }
    res.lowContrast = flagged;
    const imgs = document.querySelectorAll("img");
    const hasAttr = function (img, a) { const v = img.getAttribute ? img.getAttribute(a) : null; return v !== null && String(v).trim() !== ""; };
    let noDims = 0, sampleDims = null;
    for (let i = 0; i < imgs.length; i++) {
      const img = imgs[i];
      if (!hasAttr(img, "src") && !hasAttr(img, "data-src")) continue;
      if (hasAttr(img, "width") && hasAttr(img, "height")) continue;
      try { if (!img.complete) continue; } catch (e) {}
      noDims++;
      if (!sampleDims) sampleDims = img;
    }
    res.imgsNoDims = noDims;
    if (noDims) {
      faPush(out, "info", noDims + " image(s) lack width/height layout attributes",
        "Add width=\"\" height=\"\" (or CSS aspect-ratio) so the browser reserves the box and the layout does not shift while images load.",
        sampleDims, { count: noDims });
    }
    return res;
  }

  function auditStructureLandmarks(out) {
    const res = { h1: 0, emptyH1: 0, sections: 0, emptySections: 0, unlabeledSections: 0 };
    const has = function (sel) { try { return !!document.querySelector(sel); } catch (e) { return false; } };
    const ttl = (document.title || "").replace(/\s+/g, " ").trim();
    if (!ttl || !document.querySelector("title")) {
      faPush(out, "warning", "Page has no <title>",
        "Add a descriptive <title>. Every page needs one for tabs, bookmarks, search results and screen-reader context.");
    }
    const lang = document.documentElement.getAttribute ? (document.documentElement.getAttribute("lang") || "") : "";
    if (!lang) {
      faPush(out, "warning", "<html> has no lang attribute",
        "Add lang=\"en\" (or your language code) so screen readers, translators and spell checkers work correctly.");
    }
    const LANDMARKS = { header: "page header", main: "primary content region", footer: "page footer", nav: "navigation landmark" };
    Object.keys(LANDMARKS).forEach(function (tag) {
      if (has(tag)) return;
      faPush(out, "warning", "Missing <" + tag + "> structural tag",
        "Expose a <" + tag + "> landmark for the " + LANDMARKS[tag] + " - assistive technology, scanners and browser reader mode all rely on semantic structure.");
    });
    const h1s = document.querySelectorAll("h1");
    res.h1 = h1s.length;
    if (!h1s.length) {
      faPush(out, "warning", "Missing H1 heading",
        "Give the page exactly one <h1> describing its main subject; it anchors the document outline for readers and search tools.");
    } else if (h1s.length > 1) {
      faPush(out, "warning", h1s.length + " H1 headings on one page",
        "Keep a single <h1> and demote the extra ones to <h2> so the heading hierarchy stays logical.",
        h1s[1]);
    }
    for (let i = 0; i < h1s.length; i++) {
      const txt = (h1s[i].textContent || "").replace(/\s+/g, " ").trim();
      if (txt) continue;
      res.emptyH1++;
      faPush(out, "info", "Empty H1 heading",
        "Fill the H1 with readable text - an empty heading adds no meaning to the page outline.",
        h1s[i]);
    }
    const sections = document.querySelectorAll("section");
    res.sections = sections.length;
    for (let i = 0; i < sections.length; i++) {
      const sec = sections[i];
      if (!faVisible(sec)) continue;
      const innerH = typeof sec.querySelector === "function" ? sec.querySelector("h1,h2,h3,h4,h5,h6") : null;
      const aria = String(sec.getAttribute && (sec.getAttribute("aria-label") || sec.getAttribute("aria-labelledby")) || "").trim();
      if (!innerH && !aria) {
        res.unlabeledSections++;
        if (res.unlabeledSections <= 5) {
          faPush(out, "info", "Section has no heading or label",
            "Add a heading (or aria-label) to each <section> so its purpose is announced and the outline stays navigable.",
            sec);
        }
      }
      const secText = (sec.textContent || "").replace(/\s+/g, " ").trim();
      if (!secText) {
        res.emptySections++;
        if (res.emptySections <= 5) {
          faPush(out, "info", "Empty <section> with no content",
            "Remove the empty section or fill it with real content - bare shells add DOM weight without meaning.",
            sec);
        }
      }
    }
    return res;
  }

  function crawlLooksPageAsset(url) {
    try {
      const u = typeof url === "string" ? new URL(url) : url;
      if (CRAWL_ASSET_EXT.test(u.pathname.toLowerCase())) return true;
      if (/^\/(feed|wp-json|xmlrpc\.php|robots\.txt|sitemap(_index)?\.xml)/.test(u.pathname)) return true;
      return false;
    } catch (e) { return true; }
  }

  // Internal links for the crawler to visit next. Strips hash/tracking params
  // so ?ref= / utm_* copies never produce duplicate child pages.
  function crawlCollectLinks() {
    let origin = (location.origin || "").toLowerCase();
    if (!origin && location.href) {
      try { origin = new URL(location.href).origin.toLowerCase(); } catch (e) {}
    }
    const out = [];
    const seen = Object.create(null);
    const anchors = document.querySelectorAll("a[href]");
    for (let i = 0; i < anchors.length; i++) {
      const raw = anchors[i].getAttribute ? anchors[i].getAttribute("href") : null;
      if (!raw || !String(raw).trim()) continue;
      let u;
      try { u = new URL(String(raw).trim(), location.href); } catch (e) { continue; }
      if ((u.origin || "").toLowerCase() !== origin) continue;
      if (crawlLooksPageAsset(u.href)) continue;
      u.hash = "";
      if (u.searchParams) {
        ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid", "ref", "source", "mc_cid", "mc_eid"].forEach(function (k) {
          try { u.searchParams.delete(k); } catch (e) {}
        });
      }
      const href = u.href;
      if (seen[href]) continue;
      seen[href] = true;
      out.push({
        href: href,
        text: String((anchors[i].textContent || "").replace(/\s+/g, " ").trim()).substring(0, 90)
      });
    }
    return { origin: origin, total: out.length, links: out.slice(0, 200) };
  }

  // One focused pass over the current page: layout + responsive + icons +
  // CTAs + design + structure + URLs + images. Reuses the debug-audit probes
  // where they already do the right thing, and returns serializable data.
  function frontendAudit() {
    const groups = {
      layout: [], responsive: [], icons: [], cta: [], design: [],
      structure: [], urls: [], images: []
    };
    const bp = auditBreakpoints();
    auditResponsiveRuntime(groups.responsive, bp);
    auditIconButtons(groups.icons);
    auditSvgA11y(groups.icons);
    auditFavicon(groups.icons);
    auditCtaButtons(groups.cta);
    auditDesign(groups.design);
    auditInlineCss(groups.design);
    auditStructureLandmarks(groups.structure);
    auditDuplicateIds(groups.structure);
    auditBrokenImages(groups.images);
    auditBrokenAnchors(groups.urls);

    const sevCount = function (arr, sev) { return arr.filter(function (x) { return x.severity === sev; }).length; };
    const stats = {};
    const ordered = Object.keys(groups);
    const caps = { layout: 20, responsive: 20, icons: 20, cta: 20, design: 20, structure: 20, urls: 20, images: 20 };
    ordered.forEach(function (k) {
      const arr = groups[k];
      stats[k] = { total: arr.length, errors: sevCount(arr, "error"), warnings: sevCount(arr, "warning"), infos: sevCount(arr, "info") };
      if (arr.length > caps[k]) {
        stats[k].more = arr.length - caps[k];
        groups[k] = arr.slice(0, caps[k]);
      }
    });
    const allIn = [];
    ordered.forEach(function (k) { allIn.push.apply(allIn, groups[k]); });
    const errors = sevCount(allIn, "error");
    const warnings = sevCount(allIn, "warning");
    const infos = sevCount(allIn, "info");

    // Absolute URLs for the background worker to HTTP-probe (host permission
    // lets the worker verify them without CORS limits).
    const linksOut = [], imagesOut = [];
    const seenL = Object.create(null), seenI = Object.create(null);
    const pushAbs = function (raw, list, seen) {
      if (!raw || !String(raw).trim()) return;
      if (/^(data:|blob:|javascript:|mailto:|tel:|sms:|about:|chrome-|moz-)/i.test(String(raw))) return;
      if (/^#/.test(String(raw))) return;
      let abs;
      try { abs = new URL(String(raw), document.baseURI || location.href).href; } catch (e) { return; }
      if (!/^https?:/i.test(abs)) return;
      if (seen[abs]) return;
      seen[abs] = true;
      list.push(abs);
    };
    const anchors = document.querySelectorAll("a[href]");
    for (let i = 0; i < anchors.length && linksOut.length < 160; i++) {
      pushAbs(anchors[i].getAttribute ? anchors[i].getAttribute("href") : "", linksOut, seenL);
    }
    const mediaSel = "img, video, audio, source, link[rel*='icon'], input[type='image']";
    const mediaEls = document.querySelectorAll(mediaSel);
    for (let i = 0; i < mediaEls.length && imagesOut.length < 160; i++) {
      const el = mediaEls[i];
      const g = function (n) { return el.getAttribute ? (el.getAttribute(n) || "") : ""; };
      if (g("src")) pushAbs(g("src"), imagesOut, seenI);
      else if (g("data-src")) pushAbs(g("data-src"), imagesOut, seenI);
      const set = g("srcset");
      if (set) {
        const first = String(set).split(",")[0].split(/\s+/)[0];
        if (first) pushAbs(first, imagesOut, seenI);
      }
    }

    return {
      ok: true,
      ts: Date.now(),
      url: location.href || "",
      title: (document.title || "").replace(/\s+/g, " ").trim(),
      width: bp.width,
      viewport: { meta: bp.viewportMeta, content: bp.viewportContent, breakPoints: bp.breakPoints, minWidthRules: bp.minWidthRules, desktopFirst: bp.desktopFirst },
      totals: { errors: errors, warnings: warnings, infos: infos, total: allIn.length },
      stats: stats,
      breakpoints: bp.bounds,
      categories: {
        layout: groups.layout,
        responsive: groups.responsive,
        icons: groups.icons,
        cta: groups.cta,
        design: groups.design,
        structure: groups.structure,
        urls: groups.urls,
        images: groups.images
      },
      internalLinks: crawlCollectLinks(),
      urlCandidates: { links: linksOut, images: imagesOut }
    };
  }

  // Listen for messages from background script / popup
  const OWNED_ACTIONS = {
    debugaudit: 1, debugLocate: 1, analyze: 1, highlight: 1, trackSection: 1,
    untrackSection: 1, inPageDeviceCheck: 1, consoleReport: 1,
    analyzebrokenlinks: 1, analyzeelementor: 1, locateLink: 1, analyzetypo: 1,
    mediatrack: 1, mediatracked: 1, mediatrackremove: 1, mediatrackclear: 1,
    mediatrackflash: 1, csstoolslist: 1, csstoolsToggle: 1, csstoolsToggleAll: 1,
    csstoolsApply: 1, csstoolsClear: 1, formstoolsList: 1, formToggleValidate: 1,
    formFillTest: 1, formReset: 1, imagetoolsList: 1, imagetoolsFlash: 1,
    imagetoolsToggle: 1, imagetoolsHideAll: 1, imagetoolsShowAll: 1,
    analyzescripts: 1, scripttrack: 1, locatescript: 1, frontendaudit: 1,
    crawlcollectlinks: 1, stylemark: 1
  };
  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (sender && sender.id !== chrome.runtime.id) return;
    // This bridge owns page-local tooling only. Every other action (analyzeTab,
    // crawlSite, openDevicePreview, deviceCapture, hostBlob, ...) belongs to the
    // service worker; by not answering those at all, the background response
    // (which lands first to the caller) is never hijacked here.
    if (!OWNED_ACTIONS[message.action]) return;

    if (message.action === "debugaudit") {
      runDebugAudit().then(function (data) {
        sendResponse({ success: true, data: data });
      }, function (err) {
        sendResponse({ success: false, error: (err && err.message) || "Debug audit failed." });
      });
      return true;
    } else if (message.action === "debugLocate") {
      try {
        const el = debugElements[message.index || 0];
        if (!el) {
          sendResponse({ success: false, error: "Element reference expired. Run the Debug audit again (the page often re-renders)." });
          return true;
        }
        flashElement(el);
        sendResponse({ success: true, located: true });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    } else if (message.action === "analyze") {
      try {
        const results = analyze(message.globals || {});
        currentResults = results;
        sendResponse({ success: true, data: results });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    } else if (message.action === "highlight") {
      try {
        clearTracking();
        const el = hotspotElements[message.index || 0];
        if (!el) {
          sendResponse({ success: false, error: "Hotspot element not found. Run an analysis first." });
          return true;
        }
        flashElement(el);
        sendResponse({ success: true });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    } else if (message.action === "trackSection") {
      try {
        const el = hotspotElements[message.index || 0];
        if (!el) {
          sendResponse({ success: false, error: "Section not found. Run an analysis first." });
          return true;
        }
        const h = (currentResults && currentResults.dom && currentResults.dom.hotspots[message.index || 0]) || null;
        const detail = message.data && message.data.label ? message.data : h;
        const title = detail ? detail.label : "DOM hotspot: section " + ((message.index || 0) + 1);
        const lines = [];
        if (detail) {
          let meta = (detail.nodes || detail.count || 0) + " DOM nodes";
          if (detail.count) meta += " \u00B7 " + detail.count + " elements";
          if (detail.depth !== undefined && detail.depth !== null) meta += " \u00B7 " + detail.depth + " levels deep";
          lines.push(meta);
          if (detail.childCount) lines.push(detail.childCount + " direct children");
          if (detail.elementorContainers) lines.push(detail.elementorContainers + " Elementor containers inside");
          if (detail.cause) lines.push(detail.cause);
        }
        startTracking(el, { title: title, lines: lines });
        sendResponse({ success: true, tracked: true });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    } else if (message.action === "untrackSection") {
      try {
        clearTracking();
        sendResponse({ success: true });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    } else if (message.action === "inPageDeviceCheck") {
      try {
        const width = parseInt(message.width, 10);
        if (!width || width < 240 || width > 5120) {
          sendResponse({ success: false, error: "Invalid preview width." });
          return true;
        }
        const data = scanResponsiveAt(width);
        const height = parseInt(message.height, 10);
        if (height && height >= 320) data.height = height;
        showDevicePill(data);
        sendResponse({ success: true, data: { width: data.width, currentWidth: data.currentWidth, checks: data.checks.length } });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    } else if (message.action === "consoleReport") {
      try {
        logConsoleReport();
        sendResponse({ success: true });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    } else if (message.action === "analyzebrokenlinks") {
      try {
        analyzeBrokenLinks().then(function (data) {
          sendResponse({ success: true, data: data });
        }, function (err) {
          sendResponse({ success: false, error: (err && err.message) || "Link scan failed." });
        });
      } catch (err) {
        sendResponse({ success: false, error: (err && err.message) || "Link scan failed." });
      }
      return true;
    } else if (message.action === "analyzeelementor") {
      try {
        sendResponse({ success: true, data: analyzeElementorStructure() });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    } else if (message.action === "locateLink") {
      try {
        var target = null;
        if (message.selector) {
          // Only accept selectors generated by the extension (tag#id paths and
          // simple tag:nth-of-type() chains) - never a raw arbitrary selector.
          var SAFE_SEL = /^[a-zA-Z0-9.#,\[\]="':()> _\-\\]+$/;
          if (SAFE_SEL.test(message.selector) && message.selector.length <= 400) {
            try { target = document.querySelector(message.selector); } catch (e) { target = null; }
          } else {
            target = null;
          }
        }
        if (!target) {
          sendResponse({ success: false, error: "Element not found on the page." });
          return true;
        }
        flashElement(target);
        sendResponse({ success: true, selector: message.selector });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    } else if (message.action === "analyzetypo") {
      try {
        sendResponse({ success: true, data: analyzeTypography() });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    } else if (message.action === "mediatrack") {
      try {
        if (message.enable) mtEnable(); else mtDisable();
        sendResponse({ success: true, enabled: !!mtOn, items: mtItems.length });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    } else if (message.action === "mediatracked") {
      try {
        sendResponse({ success: true, data: { enabled: mtOn, items: mtItems.slice() } });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    } else if (message.action === "mediatrackremove") {
      try {
        var idx = parseInt(message.index, 10);
        if (idx >= 0 && idx < mtItems.length) { mtItems.splice(idx, 1); if (idx < mtRefs.length) mtRefs.splice(idx, 1); }
        sendResponse({ success: true, data: { items: mtItems.slice() } });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    } else if (message.action === "mediatrackclear") {
      try {
        mtItems.length = 0;
        mtRefs.length = 0;
        sendResponse({ success: true, data: { items: [] } });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    } else if (message.action === "mediatrackflash") {
      try {
        var fidx = parseInt(message.index, 10);
        var fok = mtFlashItem(fidx);
        sendResponse({ success: true, data: { found: fok } });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    } else if (message.action === "csstoolslist") {
      try { sendResponse({ success: true, data: cssToolsList() }); }
      catch (err) { sendResponse({ success: false, error: err.message }); }
    } else if (message.action === "csstoolsToggle") {
      try { sendResponse(cssToolsToggle(parseInt(message.index, 10))); }
      catch (err) { sendResponse({ success: false, error: err.message }); }
    } else if (message.action === "csstoolsToggleAll") {
      try { sendResponse(cssToolsToggleAll(!!message.on)); }
      catch (err) { sendResponse({ success: false, error: err.message }); }
    } else if (message.action === "csstoolsApply") {
      try { sendResponse(cssToolsApply(message.css || "")); }
      catch (err) { sendResponse({ success: false, error: err.message }); }
    } else if (message.action === "csstoolsClear") {
      try { sendResponse(cssToolsClear()); }
      catch (err) { sendResponse({ success: false, error: err.message }); }
    } else if (message.action === "formstoolsList") {
      try { sendResponse({ success: true, data: formsList() }); }
      catch (err) { sendResponse({ success: false, error: err.message }); }
    } else if (message.action === "formToggleValidate") {
      try { sendResponse(formToggleValidate(parseInt(message.index, 10), !!message.on)); }
      catch (err) { sendResponse({ success: false, error: err.message }); }
    } else if (message.action === "formFillTest") {
      try { sendResponse(formFillTest(parseInt(message.index, 10))); }
      catch (err) { sendResponse({ success: false, error: err.message }); }
    } else if (message.action === "formReset") {
      try { sendResponse(formReset(parseInt(message.index, 10))); }
      catch (err) { sendResponse({ success: false, error: err.message }); }
    } else if (message.action === "imagetoolsList") {
      try { sendResponse({ success: true, data: imageToolsList() }); }
      catch (err) { sendResponse({ success: false, error: err.message }); }
    } else if (message.action === "imagetoolsFlash") {
      try { sendResponse(imageToolsFlash(parseInt(message.index, 10))); }
      catch (err) { sendResponse({ success: false, error: err.message }); }
    } else if (message.action === "imagetoolsToggle") {
      try { sendResponse(imageToolsToggle(parseInt(message.index, 10))); }
      catch (err) { sendResponse({ success: false, error: err.message }); }
    } else if (message.action === "imagetoolsHideAll") {
      try { sendResponse(imageToolsSetAll(true)); }
      catch (err) { sendResponse({ success: false, error: err.message }); }
    } else if (message.action === "imagetoolsShowAll") {
      try { sendResponse(imageToolsSetAll(false)); }
      catch (err) { sendResponse({ success: false, error: err.message }); }
    } else if (message.action === "analyzescripts") {
      try { sendResponse({ success: true, data: analyzeScripts() }); }
      catch (err) { sendResponse({ success: false, error: err.message }); }
    } else if (message.action === "scripttrack") {
      try {
        if (message.enable) jsTrackStart();
        else jsTrackStop();
        sendResponse({ success: true, tracking: !!jsTrackObserver });
      } catch (err) { sendResponse({ success: false, error: err.message }); }
    } else if (message.action === "locatescript") {
      try {
        var scripts = [];
        try { scripts = Array.prototype.slice.call(document.querySelectorAll("script")); } catch (e) {}
        var target = scripts[message.idx];
        if (target) {
          target.setAttribute("data-flash-label", "Script #" + message.idx);
          flashElement(target);
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: "No script at index " + message.idx });
        }
      } catch (err) { sendResponse({ success: false, error: err.message }); }
    } else if (message.action === "frontendaudit") {
      try {
        sendResponse({ success: true, data: frontendAudit() });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    } else if (message.action === "crawlcollectlinks") {
      try {
        sendResponse({ success: true, data: crawlCollectLinks() });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    } else if (message.action === "stylemark") {
      try {
        if (message.enable) styleMarkEnable();
        else styleMarkDisable();
        sendResponse({ success: true, enabled: !!styleMarkOn, selected: styleMarkEl ? devLabel(styleMarkEl) : null });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    } else {
      sendResponse({ success: false, error: "Unknown action: " + (message && message.action) });
    }
    return true;
  });
})();
