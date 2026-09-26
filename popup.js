(function () {
  var btnAnalyze = document.getElementById("btnAnalyze");
  var btnAnalyzeInitial = document.getElementById("btnAnalyzeInitial");
  var initialState = document.getElementById("initialState");
  var loadingState = document.getElementById("loadingState");
  var errorState = document.getElementById("errorState");
  var errorMessage = document.getElementById("errorMessage");
  var resultsContainer = document.getElementById("resultsContainer");
  var siteDomain = document.getElementById("siteDomain");
  var tabNav = document.getElementById("tabNav");
  var currentData = null;
  var running = false;
  var debugAuditRan = false;

  // ---- Tabs: switch instantly; the panel stays at its own top ----
  var tabBtns = document.querySelectorAll(".tab-btn");
  var tabContent = document.querySelector(".tab-content");
  function activateTab(btn) {
    tabBtns.forEach(function (b) {
      b.classList.remove("active");
      b.setAttribute("aria-selected", "false");
    });
    document.querySelectorAll(".tab-panel").forEach(function (p) { p.classList.remove("active"); });
    btn.classList.add("active");
    btn.setAttribute("aria-selected", "true");
    var panel = document.getElementById("panel-" + btn.getAttribute("data-tab"));
    if (panel) panel.classList.add("active");
    // Never carry the previous tab's scroll offset into the new one.
    if (tabContent) tabContent.scrollTop = 0;
    // Auto-run debug audit on first visit to the Debug tab
    if (btn.getAttribute("data-tab") === "debug" && currentData && !debugAuditRan) {
      runDebugAudit();
    }
    // Load the version list the first time the Version tab is opened.
    if (btn.getAttribute("data-tab") === "version") {
      initVersionPanel();
    }
    // Active-tab proximity: keep the active tab fully visible in the rail.
    revealTabInNav(btn);
  }

  // Clicking a tab centers it inside the rail, pulling adjacent tabs into view.
  // Near either edge the browser clamps the scroll so the active tab still
  // lands fully visible. The fade masks are resynced once the motion settles.
  function revealTabInNav(btn) {
    if (!tabNav || !btn || typeof btn.scrollIntoView !== "function") return;
    syncTabRailFades();
    try {
      btn.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    } catch (e) {
      try { btn.scrollIntoView(true); } catch (e2) {}
    }
    window.setTimeout(syncTabRailFades, 350);
  }

  // Keeps the rail's edge-fade masks honest: at the very start the left fade
  // disappears, at the far end the right fade disappears, and when every tab
  // fits the row shows no fade at all.
  function syncTabRailFades() {
    if (!tabNav || !tabNav.classList) return;
    var maxScroll = Math.max(0, tabNav.scrollWidth - tabNav.clientWidth);
    var left = tabNav.scrollLeft || 0;
    var fits = maxScroll <= 0;
    tabNav.classList.toggle("no-fade", fits);
    tabNav.classList.toggle("at-start", !fits && left <= 0);
    tabNav.classList.toggle("at-end", !fits && left >= maxScroll - 2);
  }
  tabBtns.forEach(function (btn) {
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", btn.classList.contains("active") ? "true" : "false");
    var tab = btn.getAttribute("data-tab");
    if (tab) {
      btn.id = btn.id || ("tabBtn-" + tab);
      btn.setAttribute("aria-controls", "panel-" + tab);
      var p = document.getElementById("panel-" + tab);
      if (p) {
        p.setAttribute("role", "tabpanel");
        p.setAttribute("aria-labelledby", btn.id);
      }
    }
    btn.addEventListener("click", function () { activateTab(btn); });
  });
  if (tabNav) {
    tabNav.setAttribute("role", "tablist");
    tabNav.setAttribute("aria-label", "Analysis categories");
    tabNav.addEventListener("keydown", function (e) {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") return;
      var idx = Array.prototype.indexOf.call(tabBtns, document.activeElement);
      if (idx === -1) return;
      e.preventDefault();
      var next = idx;
      if (e.key === "ArrowRight") next = (idx + 1) % tabBtns.length;
      else if (e.key === "ArrowLeft") next = (idx - 1 + tabBtns.length) % tabBtns.length;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = tabBtns.length - 1;
      tabBtns[next].focus();
      activateTab(tabBtns[next]);
    });
    // Live-sync the edge fades while the user drags the rail, and settle the
    // initial state on open.
    tabNav.addEventListener("scroll", syncTabRailFades, { passive: true });
    window.setTimeout(syncTabRailFades, 0);
  }

  // ---- Version Manager + update banner ----
  var WD_REPO = { owner: "Nabinkdk7", repo: "web-health-doctor" };
  var versionPanelLoaded = false;
  var versionCurrent = "";
  var versionActive = "";

  function wdNormTag(t) { return String(t || "").replace(/^v/i, "").trim(); }

  function wdSendGit(payload, cb) {
    chrome.runtime.sendMessage(payload, function (res) {
      if (chrome.runtime.lastError) { if (cb) cb(null); return; }
      if (cb) cb(res);
    });
  }

  function wdZipUrl(tag) {
    return "https://github.com/" + WD_REPO.owner + "/" + WD_REPO.repo + "/archive/refs/tags/" + encodeURIComponent(tag) + ".zip";
  }

  function setVersionStatus(text) {
    var el = document.getElementById("versionStatus");
    if (!el) return;
    if (!text) { el.classList.add("hidden"); el.textContent = ""; return; }
    el.textContent = text;
    el.classList.remove("hidden");
  }

  function renderVersionList(items) {
    var list = document.getElementById("versionList");
    if (!list) return;
    var pill = document.getElementById("versionCurrent");
    if (pill) pill.textContent = versionCurrent ? "Installed: v" + versionCurrent : "Installed: --";
    list.innerHTML = "";
    (items || []).forEach(function (v) {
      var row = document.createElement("div");
      row.className = "version-item";
      var main = document.createElement("div");
      main.className = "version-item-main";
      var tagEl = document.createElement("div");
      tagEl.className = "version-tag";
      tagEl.textContent = v.tag;
      main.appendChild(tagEl);
      var label = document.createElement("div");
      label.className = "version-label";
      label.textContent = v.label || "Release " + v.tag;
      main.appendChild(label);
      row.appendChild(main);
      var cur = wdNormTag(versionCurrent), act = wdNormTag(versionActive), tagNorm = wdNormTag(v.tag);
      var badges = document.createElement("div");
      badges.className = "version-badges";
      if (cur && tagNorm === cur) {
        var inst = document.createElement("span");
        inst.className = "version-badge version-badge-installed";
        inst.textContent = "Installed";
        badges.appendChild(inst);
      }
      if (act && tagNorm === act) {
        var actB = document.createElement("span");
        actB.className = "version-badge version-badge-active";
        actB.textContent = "Active";
        badges.appendChild(actB);
      }
      row.appendChild(badges);
      var actions = document.createElement("div");
      actions.className = "version-actions";
      var sw = document.createElement("button");
      sw.type = "button";
      sw.className = "btn-ghost version-switch";
      sw.setAttribute("data-tag", v.tag);
      if (act && tagNorm === act) { sw.textContent = "Active"; sw.disabled = true; }
      else if (cur && tagNorm === cur) { sw.textContent = "Installed"; sw.disabled = true; }
      else { sw.textContent = "Switch"; }
      actions.appendChild(sw);
      var dl = document.createElement("button");
      dl.type = "button";
      dl.className = "btn-ghost version-dl";
      dl.setAttribute("data-tag", v.tag);
      dl.title = "Download " + v.tag + " package (.zip)";
      dl.textContent = ".zip";
      actions.appendChild(dl);
      row.appendChild(actions);
      list.appendChild(row);
    });
  }

  function initVersionPanel() {
    if (versionPanelLoaded) return;
    versionPanelLoaded = true;
    var list = document.getElementById("versionList");
    if (list) list.innerHTML = '<div class="version-loading">Checking GitHub\u2026</div>';
    setVersionStatus("");
    wdSendGit({ action: "getVersions" }, function (res) {
      if (!res || !res.ok) {
        if (list) list.innerHTML = "";
        setVersionStatus((res && res.error) || "Could not fetch versions. Check your connection and try Refresh.");
        return;
      }
      versionCurrent = res.current || "";
      versionActive = res.active || "";
      renderVersionList(res.versions || []);
    });
  }

  var btnVersionRefresh = document.getElementById("btnVersionRefresh");
  if (btnVersionRefresh) btnVersionRefresh.addEventListener("click", initVersionPanel);
  var btnVersionCheckUpdate = document.getElementById("btnVersionCheckUpdate");
  if (btnVersionCheckUpdate) btnVersionCheckUpdate.addEventListener("click", function () {
    setVersionStatus("Checking GitHub for a newer version\u2026");
    wdSendGit({ action: "checkUpdate", force: true }, function (res) {
      if (!res) { setVersionStatus("Could not reach GitHub."); return; }
      if (res.update && res.latest) setVersionStatus("New version " + res.latest + " is available \u2014 notification shown.");
      else if (!res.ok) setVersionStatus(res.error || "Update check failed.");
      else setVersionStatus("You are on the latest version (" + (res.current || "?") + ").");
    });
  });
  var versionListEl = document.getElementById("versionList");
  if (versionListEl) versionListEl.addEventListener("click", function (e) {
    var t = e.target;
    if (!t || !t.getAttribute || typeof t.getAttribute !== "function") return;
    var btn = (t.classList && t.classList.contains("version-switch")) || (t.classList && t.classList.contains("version-dl"))
      ? t
      : (t.parentElement && ((t.parentElement.classList && t.parentElement.classList.contains("version-switch")) || (t.parentElement.classList && t.parentElement.classList.contains("version-dl")))
        ? t.parentElement : null);
    if (!btn) return;
    var tag = btn.getAttribute("data-tag");
    if (!tag) return;
    if (btn.classList.contains("version-switch")) {
      wdSendGit({ action: "setActiveVersion", tag: tag }, function (res) {
        if (!res || !res.ok) { setVersionStatus("Could not switch to " + tag + "."); return; }
        versionActive = tag;
        initVersionPanel();
        setVersionStatus("Active version set to " + tag + ". Downloading its package\u2026");
      });
    }
    if (typeof chrome.downloads === "undefined" || !chrome.downloads.download) {
      setVersionStatus("Downloads are unavailable in this browser.");
      return;
    }
    chrome.downloads.download({ url: wdZipUrl(tag), filename: "web-health-doctor-" + wdNormTag(tag) + ".zip", conflictAction: "uniquify" }, function () {
      if (chrome.runtime.lastError) setVersionStatus("Download could not start \u2014 the tag may not exist on GitHub yet.");
    });
  });

  var updateBanner = document.getElementById("updateBanner");
  function wdShowUpdate(latest) {
    if (!updateBanner || !latest) return;
    var txt = document.getElementById("updateBannerText");
    if (txt) txt.textContent = "Web Doctor " + latest + " is available";
    updateBanner.classList.remove("hidden");
  }
  function wdCheckOnOpen() {
    wdSendGit({ action: "checkUpdate", force: false }, function (res) {
      if (res && res.ok && res.update && res.latest) wdShowUpdate(res.latest);
    });
  }
  var btnUpdateView = document.getElementById("btnUpdateView");
  if (btnUpdateView) btnUpdateView.addEventListener("click", function () {
    chrome.tabs.create({ url: "https://github.com/" + WD_REPO.owner + "/" + WD_REPO.repo + "/tags" }, function () { void chrome.runtime.lastError; });
  });
  var btnUpdateDismiss = document.getElementById("btnUpdateDismiss");
  if (btnUpdateDismiss) btnUpdateDismiss.addEventListener("click", function () {
    if (updateBanner) updateBanner.classList.add("hidden");
  });
  wdCheckOnOpen();

  // ---- Run scan toggles the initial / loading / error / results states ----
  var trackedIndex = -1;
  var lastHotspots = [];

  function runScan() {
    if (running) return;
    running = true;
    trackedIndex = -1;
    setTrackedState(-1, false);
    resetDevMod();
    var st = document.getElementById("hotspotStatus");
    if (st) { st.classList.add("hidden"); st.textContent = ""; }
    initialState.classList.add("hidden");
    loadingState.classList.remove("hidden");
    errorState.classList.add("hidden");
    resultsContainer.classList.add("hidden");
    siteDomain.classList.add("hidden");
    btnAnalyze.disabled = true;
    if (btnAnalyzeInitial) btnAnalyzeInitial.disabled = true;
    msgTab({ action: "untrackSection" });

    chrome.runtime.sendMessage({ action: "analyzeTab" }, function (response) {
      running = false;
      if (!response || !response.success) {
        loadingState.classList.add("hidden");
        errorState.classList.remove("hidden");
        resultsContainer.classList.add("hidden");
        errorMessage.textContent = response ? response.error : "No response from extension. Try reloading.";
        btnAnalyze.disabled = false;
        if (btnAnalyzeInitial) btnAnalyzeInitial.disabled = false;
        return;
      }
      currentData = response.data;
      try {
        renderResults(currentData);
      } catch (err) {
        loadingState.classList.add("hidden");
        errorState.classList.remove("hidden");
        resultsContainer.classList.add("hidden");
        errorMessage.textContent = "Could not render the analysis: " + (err && err.message ? err.message : "unexpected error");
        btnAnalyze.disabled = false;
        if (btnAnalyzeInitial) btnAnalyzeInitial.disabled = false;
        return;
      }
      if (currentData.page && currentData.page.host) {
        siteDomain.classList.remove("hidden");
        document.getElementById("siteDomainText").textContent = currentData.page.title + " \u00B7 " + currentData.page.host;
        var fi = document.getElementById("siteFavicon");
        fi.onerror = function () { fi.style.display = "none"; };
        fi.onload = function () { fi.style.display = ""; };
        fi.src = "https://" + currentData.page.host + "/favicon.ico";
      } else {
        siteDomain.classList.add("hidden");
      }
      loadingState.classList.add("hidden");
      errorState.classList.add("hidden");
      resultsContainer.classList.remove("hidden");
      try {
        var health = assessScanHealth(currentData);
        showHealthVerdict(health.state, health.title, health.msg);
      } catch (e) {}
      btnAnalyze.disabled = false;
      if (btnAnalyzeInitial) btnAnalyzeInitial.disabled = false;
    });
  }

  btnAnalyze.addEventListener("click", runScan);
  if (btnAnalyzeInitial) btnAnalyzeInitial.addEventListener("click", runScan);

  var btnDebugAudit = document.getElementById("btnDebugAudit");
  if (btnDebugAudit) btnDebugAudit.addEventListener("click", runDebugAudit);

  // Auto-scan the moment the popup opens on a real page.
  window.setTimeout(runScan, 80);

  // ============================================
  // HEALTH VERDICT NOTIFICATION (toast + sound)
  // ============================================
  var healthToastTimer = null;

  function assessScanHealth(data) {
    var issues = collectIssues(data);
    var critical = 0;
    var warnings = 0;
    var broken = 0;
    issues.forEach(function (it) {
      if (it.level === "critical") critical++;
      else if (it.level === "warning") warnings++;
      if (it.title === "Broken link targets") broken++;
    });
    var overall = data && data.scores && typeof data.scores.overall === "number" ? data.scores.overall : null;
    if (critical > 0 || broken > 0 || (overall !== null && overall < 50)) {
      var reasons = [];
      if (critical) reasons.push(critical + " critical issue" + (critical === 1 ? "" : "s"));
      if (broken) reasons.push(broken + " broken link" + (broken === 1 ? "" : "s"));
      if (overall !== null && overall < 50) reasons.push("overall score " + overall);
      return {
        state: "danger",
        title: "Heads up \u2014 this page needs work",
        msg: reasons.join(" \u00B7 ") + ". Check the issues list / Debug tab."
      };
    }
    if (warnings > 0) {
      return {
        state: "good",
        title: "Website is good",
        msg: "Only " + warnings + " minor note" + (warnings === 1 ? "" : "s") + (overall !== null ? " \u00B7 score " + overall : "") + "."
      };
    }
    return {
      state: "good",
      title: "Website is good",
      msg: "No issues found" + (overall !== null ? " \u00B7 score " + overall : "") + "."
    };
  }

  function assessDebugHealth(audit) {
    var level = "good";
    if (audit) {
      level = audit.level || (audit.verdict && audit.verdict.level) || "good";
    }
    var totals = audit ? (audit.totals || {}) : {};
    var errors = totals.errors || 0;
    var warnings = totals.warnings || 0;
    if (level === "critical" || level === "bad" || errors > 0) {
      return {
        state: "danger",
        title: "Audit found problems",
        msg: errors + " critical" + (errors === 1 ? "" : "s") + " \u00B7 " + warnings + " warning" + (warnings === 1 ? "" : "s") + ". Review the Debug report."
      };
    }
    if (level === "warning" || level === "warn" || warnings > 0) {
      return {
        state: "good",
        title: "Website is good",
        msg: "Deep audit passed with " + warnings + " minor warning" + (warnings === 1 ? "" : "s") + "."
      };
    }
    return { state: "good", title: "Website is good", msg: "Deep audit passed \u2014 every check is green." };
  }

  function showHealthVerdict(state, title, msg) {
    var toast = document.getElementById("healthToast");
    if (!toast) return;
    if (healthToastTimer) { window.clearTimeout(healthToastTimer); healthToastTimer = null; }
    var good = state !== "danger";
    toast.className = "health-toast " + (good ? "good" : "danger");
    var icon = document.getElementById("healthIcon");
    if (icon) {
      icon.innerHTML = good
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
    }
    var titleEl = document.getElementById("healthTitle");
    if (titleEl) titleEl.textContent = title;
    var msgEl = document.getElementById("healthMsg");
    if (msgEl) msgEl.textContent = msg;
    var closeBtn = document.getElementById("healthClose");
    if (closeBtn) closeBtn.hidden = false;
    toast.hidden = false;
    playHealthSound(state);
    healthToastTimer = window.setTimeout(hideHealthToast, good ? 6000 : 9000);
  }

  function hideHealthToast() {
    var toast = document.getElementById("healthToast");
    if (!toast) return;
    if (healthToastTimer) { window.clearTimeout(healthToastTimer); healthToastTimer = null; }
    toast.hidden = true;
  }

  var healthCloseBtn = document.getElementById("healthClose");
  if (healthCloseBtn) healthCloseBtn.addEventListener("click", hideHealthToast);

  // ---- Web Audio: synthesized verdict sounds (no audio files, works offline) ----
  var _audioCtx = null;

  function primeAudio() {
    if (!_audioCtx) {
      try { _audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { _audioCtx = null; }
    }
    if (_audioCtx && _audioCtx.state === "suspended") {
      try { _audioCtx.resume(); } catch (e) {}
    }
    return _audioCtx;
  }

  // Popups open from a toolbar click (a user gesture), so creating and
  // resuming the context right away lets Chrome start audio immediately.
  primeAudio();

  // The last verdict that could not play yet because of the autoplay policy.
  // Once audio is running (on a gesture) it is replayed, so no sound is lost.
  var pendingHealthSound = null;

  // Keep the context unblocked for the whole popup lifetime: retry the resume
  // on every interaction, and flush any verdict sound that was waiting.
  function resumeAudioOnGesture() {
    var c = primeAudio();
    if (!c) return;
    if (c.state === "running") {
      if (pendingHealthSound) playHealthSoundNow(c, pendingHealthSound);
      return;
    }
    try {
      var r = c.resume();
      if (r && typeof r.then === "function") {
        r.then(function () { if (pendingHealthSound) playHealthSoundNow(c, pendingHealthSound); }, function () {});
      } else if (pendingHealthSound) {
        playHealthSoundNow(c, pendingHealthSound);
      }
    } catch (e) {}
  }
  window.addEventListener("pointerdown", resumeAudioOnGesture);
  window.addEventListener("pointerup", resumeAudioOnGesture);
  window.addEventListener("keydown", resumeAudioOnGesture);
  window.addEventListener("touchend", resumeAudioOnGesture);

  function playHealthSound(state) {
    pendingHealthSound = state;
    var ctx = primeAudio();
    if (!ctx) return;
    if (ctx.state === "running") {
      playHealthSoundNow(ctx, state);
      return;
    }
    try {
      var r = ctx.resume();
      if (r && typeof r.then === "function") r.catch(function () {});
    } catch (e) {}
    // If the resume succeeds, the flush below plays the pending sound; if it
    // is still blocked, the next gesture's resumeAudioOnGesture replays it.
    if (r && typeof r.then === "function") {
      r.then(function () { if (pendingHealthSound) playHealthSoundNow(ctx, pendingHealthSound); }, function () {});
    }
  }

  function playHealthSoundNow(ctx, state) {
    if (pendingHealthSound === state) pendingHealthSound = null;
    try {
      if (state === "danger") playDangerPop(ctx);
      else playGoodChime(ctx);
    } catch (e) { /* sound is a bonus; never break the UI */ }
  }

  // Pleasant cinematic "all clear": a soft bloom, a rising C-major arpeggio,
  // and a sparkle on top.
  function playGoodChime(ctx) {
    var t = ctx.currentTime;
    function pluck(freq, at, dur, gain, type, endFreq) {
      var osc = ctx.createOscillator();
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + at);
      g.gain.exponentialRampToValueAtTime(gain, t + at + 0.018);
      g.gain.exponentialRampToValueAtTime(0.0001, t + at + dur);
      osc.type = type || "triangle";
      osc.frequency.setValueAtTime(freq, t + at);
      if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, t + at + dur);
      osc.connect(g); g.connect(ctx.destination);
      osc.start(t + at); osc.stop(t + at + dur + 0.05);
    }
    pluck(130.81, 0, 0.5, 0.14, "sine", 65.41);
    pluck(523.25, 0.02, 0.55, 0.18, "triangle");
    pluck(659.25, 0.14, 0.6, 0.16, "triangle");
    pluck(783.99, 0.26, 0.72, 0.14, "triangle");
    pluck(1046.5, 0.38, 0.85, 0.11, "sine");
    pluck(2093.0, 0.44, 0.5, 0.03, "sine");
  }

  // Futuristic sci-fi UI tone: a single clean "warp ping" like a starship
  // console alert — a sine that sweeps swiftly upward and settles, with a
  // lower follower, a beating metallic shimmer pair, and a soft sub thump
  // underneath. Dry, gated, and full-volume through a soft limiter.
  function playDangerPop(ctx) {
    var t = ctx.currentTime;
    var master = ctx.createGain();
    master.gain.value = 0.9;
    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.knee.value = 6;
    comp.ratio.value = 8;
    comp.attack.value = 0.002;
    comp.release.value = 0.06;
    master.connect(comp);
    comp.connect(ctx.destination);

    // A clean sine tone with optional frequency ramps and a fast gate.
    function tone(freq, at, dur, gain, ramps) {
      var osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, t + at);
      if (ramps) {
        for (var i = 0; i < ramps.length; i++) {
          osc.frequency.exponentialRampToValueAtTime(ramps[i][0], t + at + ramps[i][1]);
        }
      }
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + at);
      g.gain.exponentialRampToValueAtTime(gain, t + at + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + at + dur);
      osc.connect(g);
      g.connect(master);
      osc.start(t + at);
      osc.stop(t + at + dur + 0.02);
    }

    // A micro highpassed click so each ping lands crisply.
    function click(at, vol) {
      var len = Math.floor(ctx.sampleRate * 0.005);
      var buf = ctx.createBuffer(1, len, ctx.sampleRate);
      var dd = buf.getChannelData(0);
      var k;
      for (k = 0; k < len; k++) dd[k] = Math.random() * 2 - 1;
      var c = ctx.createBufferSource();
      c.buffer = buf;
      var hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 3500;
      var cgn = ctx.createGain();
      cgn.gain.setValueAtTime(0.0001, t + at);
      cgn.gain.exponentialRampToValueAtTime(vol, t + at + 0.001);
      cgn.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.005);
      c.connect(hp);
      hp.connect(cgn);
      cgn.connect(master);
      c.start(t + at);
      c.stop(t + at + 0.006);
    }

    tone(62, 0, 0.3, 0.45, [[45, 0.24]]);                    // soft sub thump
    tone(560, 0, 0.36, 0.5, [[1560, 0.16], [1100, 0.36]]);   // warp ping (leader)
    tone(420, 0.09, 0.36, 0.42, [[1170, 0.24], [830, 0.44]]); // lower follower
    tone(2200, 0.01, 0.18, 0.12);                            // metallic tablet
    tone(2206, 0.01, 0.18, 0.08);                            // detuned pair (beating)
    tone(3300, 0.1, 0.16, 0.07);                             // upper shimmer
    click(0, 0.18);
    click(0.09, 0.14);
  }

  function resetDevMod() {
    ["devmodLinksResults", "devmodTypoResults", "eleInspectorResults", "devmodCssResults", "devmodFormsResults", "devmodImagesResults", "devmodMediaResults", "devmodJsResults"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.innerHTML = "";
    });
    var sum = document.getElementById("devmodLinksSummary");
    if (sum) { sum.innerHTML = ""; sum.className = "devmod-summary hidden"; }
    ["devmodLinksStatus", "devmodTypoStatus", "devmodSmStatus", "eleInspectorStatus", "devmodCssStatus", "devmodFormsStatus", "devmodImagesStatus", "devmodMediaStatus", "devmodJsStatus"].forEach(function (id) {
      var st = document.getElementById(id);
      if (st) { st.className = "devmod-status hidden"; st.textContent = ""; }
    });
    lastLinkResults = null;
    linkFilter = "all";
    resetDebugPanel();
  }

  // Console report button (logs findings + fix commands into the page DevTools console)
  var btnConsoleLog = document.getElementById("btnConsoleLog");
  if (btnConsoleLog) {
    btnConsoleLog.addEventListener("click", function () {
      btnConsoleLog.disabled = true;
      devModMsg({ action: "consoleReport" }, function (res, err) {
        btnConsoleLog.disabled = false;
        var original = "Log Detail to Page Console";
        if (err || !res || !res.success) {
          btnConsoleLog.textContent = "Log failed \u2014 cannot reach this page, run a scan first";
          setTimeout(function () { btnConsoleLog.textContent = original; }, 3000);
          return;
        }
        btnConsoleLog.textContent = "Logged \u2713  (open the page DevTools Console)";
        setTimeout(function () { btnConsoleLog.textContent = original; }, 3000);
      });
    });
  }

  // ============================================
  // RENDER RESULTS
  // ============================================
  function renderResults(data) {
    renderOverview(data);
    renderDOM(data.dom);
    renderPerformance(data.performance);
    renderSEO(data.seo, data.headings, data.scores.seo);
    renderStructure(data.structure, data.forms, data.links, data.images);
    renderTechnology(data.technology);
    renderAccessibility(data.accessibility);
    resetDebugPanel();
    renderDevices(data);
    renderIssues(data);
    wireTrackButtons(document);
  }

  // ============================================
  // OVERVIEW
  // ============================================
  function renderOverview(data) {
    var scores = data.scores;

    renderPageSnapshot(data);

    // Overall score
    var overallEl = document.getElementById("overallScore");
    overallEl.textContent = scores.overall;

    // Score ring
    var ring = document.getElementById("scoreRingFill");
    var circumference = 2 * Math.PI * 52;
    var offset = circumference - (scores.overall / 100) * circumference;
    ring.style.strokeDashoffset = offset;
    ring.style.stroke = getScoreColor(scores.overall);

    // Mini metrics
    document.getElementById("miniDom").textContent = data.dom.totalElements.toLocaleString();
    document.getElementById("miniLoad").textContent = data.performance.loadTime !== null ? (data.performance.loadTime / 1000).toFixed(1) + "s" : "N/A";
    document.getElementById("miniSeo").textContent = scores.seo;
    document.getElementById("miniAccess").textContent = scores.accessibility;
    document.getElementById("miniStruct").textContent = scores.structure;

    // Top DOM contributor strip
    var strip = document.getElementById("topSectionStrip");
    var top = data.dom.topSection;
    if (top) {
      strip.classList.remove("hidden");
      document.getElementById("topSectionName").textContent = top.label;
      var meta = top.count.toLocaleString() + " elements \u00B7 " + top.share + "% of the page \u00B7 depth " + top.depth;
      if (top.nodes) meta += " \u00B7 " + top.nodes.toLocaleString() + " nodes";
      if (top.elementor) meta += " \u00B7 Elementor-heavy";
      document.getElementById("topSectionMeta").textContent = meta;
      document.getElementById("btnTopTrack").setAttribute("data-index", "0");
      document.getElementById("btnTopLocate").setAttribute("data-index", "0");
    } else {
      strip.classList.add("hidden");
    }

    // "View" flashes the top contributor like the DOM tab's Locate buttons.
    var viewBtn = document.getElementById("btnTopLocate");
    if (viewBtn && !viewBtn.getAttribute("data-bound")) {
      viewBtn.setAttribute("data-bound", "1");
      viewBtn.addEventListener("click", function () {
        msgTab({ action: "highlight", index: parseInt(viewBtn.getAttribute("data-index"), 10) || 0 }, function (err) {
          var el = viewBtn;
          var original = "View";
          if (err) {
            el.textContent = "Not found";
            setTimeout(function () { el.textContent = original; }, 1800);
            return;
          }
          el.textContent = "Located";
          setTimeout(function () { el.textContent = original; }, 1800);
        });
      });
    }
  }

  // ============================================
  // ISSUES
  // ============================================
  function collectIssues(data) {
    var issues = [];

    // DOM issues
    if (data.dom.totalElements > 1500) {
      issues.push({
        level: data.dom.totalElements > 3000 ? "critical" : "warning",
        title: "Excessive DOM size",
        desc: data.dom.totalElements.toLocaleString() + " DOM elements detected.",
        rec: "Reduce unnecessary wrapper containers and duplicated elements."
      });
    }
    if (data.dom.maxDepth > 15) {
      issues.push({
        level: data.dom.maxDepth > 20 ? "critical" : "warning",
        title: "Deep DOM nesting",
        desc: "Maximum nesting depth: " + data.dom.maxDepth + ".",
        rec: "Flatten deeply nested structures to improve rendering performance."
      });
    }
    if (data.dom.duplicateIds.length > 0) {
      issues.push({
        level: "critical",
        title: "Duplicate IDs",
        desc: data.dom.duplicateIds.length + " duplicate ID(s) found.",
        rec: "Each ID must be unique. Duplicate IDs break accessibility and JavaScript."
      });
    }
    if (data.dom.excessiveNestingCount > 5) {
      issues.push({
        level: "warning",
        title: "Excessive nesting",
        desc: data.dom.excessiveNestingCount + " elements with excessive nesting depth.",
        rec: "Simplify the DOM structure by removing unnecessary parent containers."
      });
    }
    if (data.dom.emptyElements > 30) {
      issues.push({
        level: "warning",
        title: "Many empty elements",
        desc: data.dom.emptyElements + " empty elements found.",
        rec: "Remove empty elements that serve no purpose."
      });
    }
    if (data.dom.maxContainerNesting >= 8 || data.dom.nestedContainerCount > 300) {
      issues.push({
        level: "warning",
        title: "Deeply nested layout containers",
        desc: "Containers nest up to " + data.dom.maxContainerNesting +
          " levels deep (" + data.dom.nestedContainerCount.toLocaleString() + " nested containers).",
        rec: "Flatten nested wrappers \u2014 every level adds markup that the browser must render and style."
      });
    }
    if (data.dom.elementor && data.dom.elementor.detected &&
        data.dom.elementor.excessive && data.dom.elementor.excessive.level !== "good") {
      issues.push({
        level: data.dom.elementor.excessive.level === "critical" ? "critical" : "warning",
        title: "Excessive Elementor container usage",
        desc: data.dom.elementor.excessive.message,
        rec: "Flatten redundant Elementor containers, reuse templates, and replace deep inner sections/columns with lightweight wrappers."
      });
    }
    if ((data.dom.inlineStyleCount || 0) > 150) {
      issues.push({
        level: data.dom.inlineStyleCount > 400 ? "critical" : "warning",
        title: "Heavy inline style usage",
        desc: data.dom.inlineStyleCount.toLocaleString() + " elements use inline style attributes.",
        rec: "Move inline styles into CSS classes or a stylesheet for better maintainability and cacheability."
      });
    }
    var brokenLinkCount = (data.brokenLinks && data.brokenLinks.counts && data.brokenLinks.counts.broken) || 0;
    if (brokenLinkCount > 0) {
      issues.push({
        level: brokenLinkCount > 5 ? "critical" : "warning",
        title: "Broken link targets",
        desc: brokenLinkCount + " link(s) point to a \u201C#\u201D or javascript: placeholder, or to a fragment with no matching element on this page.",
        rec: "Replace placeholder hrefs with real destinations and point fragment links at ids that exist."
      });
    }

    // Performance issues
    if (data.performance.loadTime !== null && data.performance.loadTime > 3000) {
      issues.push({
        level: data.performance.loadTime > 5000 ? "critical" : "warning",
        title: "Slow page load",
        desc: "Load time: " + (data.performance.loadTime / 1000).toFixed(1) + "s.",
        rec: "Optimize resources, reduce server response time, and leverage caching."
      });
    }
    if (data.performance.firstContentfulPaint !== null && data.performance.firstContentfulPaint > 1800) {
      issues.push({
        level: data.performance.firstContentfulPaint > 3000 ? "critical" : "warning",
        title: "Slow First Contentful Paint",
        desc: "FCP: " + (data.performance.firstContentfulPaint / 1000).toFixed(1) + "s.",
        rec: "Reduce render-blocking resources and optimize critical rendering path."
      });
    }
    if (data.performance.thirdPartyCount > 15) {
      issues.push({
        level: "warning",
        title: "Many third-party resources",
        desc: data.performance.thirdPartyCount + " third-party resources detected.",
        rec: "Audit third-party scripts and remove those not essential."
      });
    }
    if (data.performance.largeResources.length > 0) {
      issues.push({
        level: "warning",
        title: "Large resources",
        desc: data.performance.largeResources.length + " resource(s) over 200KB.",
        rec: "Compress and optimize large resources."
      });
    }
    if ((data.performance.inlineScriptBytes || 0) > 40 * 1024) {
      issues.push({
        level: "warning",
        title: "Large inline script payload",
        desc: "Inline <script> blocks total around " + Math.round((data.performance.inlineScriptBytes || 0) / 1024) + "KB of source.",
        rec: "Move reusable inline scripts into external, cacheable files and defer what the page does not need for first paint."
      });
    }
    if ((data.performance.scriptTagCount || 0) > 40) {
      issues.push({
        level: "warning",
        title: "Many script tags",
        desc: (data.performance.scriptTagCount || 0) + " <script> tags on the page (" + (data.performance.externalScriptCount || 0) + " external).",
        rec: "Bundle and defer scripts to cut parsing cost and render blocking."
      });
    }

    // SEO issues
    if (!data.seo.hasTitle) {
      issues.push({ level: "critical", title: "Missing page title", desc: "No <title> tag found.", rec: "Add a descriptive title between 30-60 characters." });
    } else if (!data.seo.titleOk) {
      issues.push({ level: "warning", title: "Title length issue", desc: "Title is " + data.seo.titleLength + " characters.", rec: "Optimal title length is 30-60 characters." });
    }
    if (!data.seo.hasDescription) {
      issues.push({ level: "critical", title: "Missing meta description", desc: "No meta description found.", rec: "Add a meta description between 120-160 characters." });
    } else if (!data.seo.descriptionOk) {
      issues.push({ level: "warning", title: "Meta description length issue", desc: "Description is " + data.seo.descriptionLength + " characters.", rec: "Optimal length is 120-160 characters." });
    }
    if (!data.seo.hasCanonical) {
      issues.push({ level: "warning", title: "Missing canonical tag", desc: "No canonical URL specified.", rec: "Add a canonical link to prevent duplicate content issues." });
    }
    if (data.seo.multipleCanonicals) {
      issues.push({ level: "warning", title: "Multiple canonical tags", desc: "More than one canonical URL is declared.", rec: "Keep exactly one canonical URL per page so search engines follow the intended one." });
    }
    if (data.seo.hasNoindex) {
      issues.push({ level: "warning", title: "Page blocked from search (noindex)", desc: "The meta robots tag includes noindex.", rec: "Remove noindex unless you intend this page to stay out of search results." });
    }
    if ((data.seo.hasTitle || data.seo.hasDescription) && (!data.seo.hasOgTitle || !data.seo.hasOgImage)) {
      issues.push({
        level: "warning",
        title: "Incomplete social metadata",
        desc: (data.seo.hasOgTitle ? "og:title is set but " : "og:title and/or ") + (data.seo.hasOgImage ? "" : "og:image is ") + "missing for link-sharing previews.",
        rec: "Add og:title and og:image so shared links render a proper labeled preview."
      });
    }
    if (!data.headings.hasH1) {
      issues.push({ level: "critical", title: "Missing H1 heading", desc: "No H1 heading found on the page.", rec: "Every page should have exactly one H1 heading." });
    } else if (!data.headings.singleH1) {
      issues.push({ level: "warning", title: "Multiple H1 headings", desc: data.headings.counts.h1 + " H1 headings found.", rec: "Best practice is to use a single H1 per page for clear document outline." });
    }
    var emptyHeadingCount = 0;
    if (data.headings.headings) {
      data.headings.headings.forEach(function (h) { if (h.empty) emptyHeadingCount++; });
    }
    if (emptyHeadingCount > 0) {
      issues.push({ level: "warning", title: "Empty headings", desc: emptyHeadingCount + " heading(s) have no readable text.", rec: "Give every heading meaningful text, or remove it if it is purely decorative." });
    }
    if (data.headings.skippedLevels) {
      issues.push({ level: "warning", title: "Skipped heading levels", desc: "Heading levels jump somewhere in the outline (e.g. H2 to H4).", rec: "Keep heading levels sequential so the document outline stays logical." });
    }

    // Accessibility issues
    if (data.accessibility.imagesMissingAlt > 0) {
      issues.push({
        level: "critical",
        title: "Missing image ALT text",
        desc: data.accessibility.imagesMissingAlt + " image(s) missing alt attributes.",
        rec: "Add descriptive alt text to all meaningful images."
      });
    }
    if (data.accessibility.inputsNoLabel > 0) {
      issues.push({
        level: "warning",
        title: "Form inputs without labels",
        desc: data.accessibility.inputsNoLabel + " input(s) without associated labels.",
        rec: "Associate labels with inputs using for/id or aria-label."
      });
    }
    if ((data.accessibility.buttonsNoName || 0) > 0) {
      issues.push({
        level: "warning",
        title: "Buttons without accessible names",
        desc: data.accessibility.buttonsNoName + " button(s) have no visible text, aria-label, or title.",
        rec: "Add visible text or an aria-label to every button so its purpose can be announced."
      });
    }
    if ((data.accessibility.linksNoText || 0) > 0) {
      issues.push({
        level: "warning",
        title: "Links without accessible text",
        desc: data.accessibility.linksNoText + " link(s) have no text, aria-label, or image alt.",
        rec: "Give every link a meaningful accessible name for screen readers and keyboard users."
      });
    }
    if ((data.accessibility.iframesNoTitle || 0) > 0) {
      issues.push({
        level: "warning",
        title: "Iframes without titles",
        desc: data.accessibility.iframesNoTitle + " iframe(s) are missing a title attribute.",
        rec: "Add a title to each iframe that describes its content."
      });
    }
    if ((data.accessibility.navsNoName || 0) > 0) {
      issues.push({
        level: "warning",
        title: "Navigation without accessible name",
        desc: data.accessibility.navsNoName + " <nav> element(s) lack an aria-label or aria-labelledby.",
        rec: "Name each navigation region so assistive technology can distinguish them."
      });
    }

    // Structure issues
    if (!data.structure.hasMain) {
      issues.push({ level: "warning", title: "Missing main landmark", desc: "No <main> element found.", rec: "Use <main> to identify the primary content of the page." });
    }
    if (!data.structure.hasHeader) {
      issues.push({ level: "warning", title: "Missing header", desc: "No <header> element found.", rec: "Add a <header> element for better semantic structure." });
    }
    if (!data.structure.hasFooter) {
      issues.push({ level: "warning", title: "Missing footer", desc: "No <footer> element found.", rec: "Add a <footer> element for better semantic structure." });
    }
    var htmlLang = (data.structure && data.structure.htmlLang) || "";
    if (!htmlLang) {
      issues.push({
        level: "warning",
        title: "Missing document language",
        desc: "No lang attribute on the <html> element.",
        rec: "Add lang=\"...\" to <html> so screen readers, translators, and spell checkers pick the right language."
      });
    }

    // Good items
    if (data.seo.hasTitle && data.seo.titleOk) {
      issues.push({ level: "good", title: "SEO title", desc: "Title is present and within a reasonable length (" + data.seo.titleLength + " chars).", rec: "" });
    }
    if (data.seo.hasDescription && data.seo.descriptionOk) {
      issues.push({ level: "good", title: "Meta description", desc: "Description is present and well-sized (" + data.seo.descriptionLength + " chars).", rec: "" });
    }
    if (data.seo.hasCanonical) {
      issues.push({ level: "good", title: "Canonical tag", desc: "Canonical URL is set.", rec: "" });
    }
    if (data.headings.hasH1 && data.headings.singleH1 && !data.headings.skippedLevels) {
      issues.push({ level: "good", title: "Heading hierarchy", desc: "Single H1 with proper heading hierarchy.", rec: "" });
    }
    if (data.structure.hasMain && data.structure.hasHeader && data.structure.hasFooter) {
      issues.push({ level: "good", title: "Semantic landmarks", desc: "Header, main, and footer landmarks present.", rec: "" });
    }
    if (htmlLang) {
      issues.push({ level: "good", title: "Document language", desc: "The page declares its language (lang=\"" + htmlLang + "\").", rec: "" });
    }
    if ((data.dom.inlineStyleCount || 0) > 0 && data.dom.inlineStyleCount <= 20) {
      issues.push({ level: "good", title: "Inline styles contained", desc: "Only " + data.dom.inlineStyleCount + " element(s) carry inline style attributes.", rec: "" });
    }
    var imageTotal = (data.images && data.images.total) || 0;
    var imageWithAlt = (data.images && data.images.withAlt) || 0;
    if (imageTotal > 0 && (data.accessibility && data.accessibility.imagesMissingAlt || 0) === 0) {
      issues.push({ level: "good", title: "Image alt coverage", desc: "All " + imageTotal + " image(s) carry alt text.", rec: "" });
    }
    if ((data.performance.jsBytes || 0) > 0 && data.performance.jsBytes < 200 * 1024) {
      issues.push({ level: "good", title: "JavaScript weight", desc: "JS payload is light at about " + Math.round(data.performance.jsBytes / 1024) + "KB.", rec: "" });
    }
    if (data.dom.elementor && data.dom.elementor.detected &&
        data.dom.elementor.excessive && data.dom.elementor.excessive.level === "good") {
      issues.push({ level: "good", title: "Elementor container usage", desc: "Container nesting and count are within healthy limits.", rec: "" });
    }

    // Sort: critical first, then warning, then good
    var order = { critical: 0, warning: 1, good: 2 };
    issues.sort(function (a, b) { return order[a.level] - order[b.level]; });
    return issues;
  }

  function renderIssues(data) {
    var list = document.getElementById("issuesList");
    var html = "";
    var issues = collectIssues(data);
    issues.forEach(function (issue) {
      var iconClass = issue.level === "critical" ? "red" : issue.level === "warning" ? "yellow" : "green";
      var iconLetter = issue.level === "critical" ? "!" : issue.level === "warning" ? "!" : "\u2713";
      html += '<div class="issue-item ' + issue.level + '">';
      html += '<div class="issue-icon ' + iconClass + '">' + iconLetter + '</div>';
      html += '<div class="issue-content">';
      html += '<div class="issue-title">' + escapeHtml(issue.title) + '</div>';
      html += '<div class="issue-desc">' + escapeHtml(issue.desc) + '</div>';
      if (issue.rec) {
        html += '<div class="issue-recommendation">Recommendation: ' + escapeHtml(issue.rec) + '</div>';
      }
      html += '</div></div>';
    });

    list.innerHTML = html;
  }

  // ============================================
  // AUDIT FILE TAB
  // ============================================
  var auditBlobUrl = null;
  var auditDoc = null;
  var auditData = null;
  var auditDocsDoc = null;

  function buildAuditReport(data, word) {
    word = !!word;
    var issues = collectIssues(data);
    var critical = issues.filter(function (i) { return i.level === "critical"; });
    var warning = issues.filter(function (i) { return i.level === "warning"; });
    var good = issues.filter(function (i) { return i.level === "good"; });
    var scores = (data && data.scores) || {};
    var page = (data && data.page) || {};
    var dom = (data && data.dom) || {};
    var perf = (data && data.performance) || {};
    var seo = (data && data.seo) || {};
    var a11y = (data && data.accessibility) || {};
    var formsData = (data && data.forms) || {};
    var imagesData = (data && data.images) || {};
    var linksData = (data && data.links) || {};
    var brokenLinksData = (data && data.brokenLinks) || {};
    var responsive = (data && data.responsive) || {};
    var techData = (data && data.technology) || {};
    var hintCount = (responsive.layoutHints && responsive.layoutHints.length) || 0;
    var techTotal = 0;
    var techGroups = techData.groups || {};
    Object.keys(techGroups).forEach(function (k) { techTotal += (techGroups[k] || []).length; });
    var now = new Date();
    var dateStr = now.toDateString() + " \u00B7 " + now.toLocaleTimeString();

    function esc(s) { return String(s === undefined || s === null ? "" : s); }
    function num(v) { return (v === undefined || v === null) ? "n/a" : Number(v).toLocaleString(); }
    function row(label, value) {
      if (word) return '<tr><td style="width:38%;padding:3pt 6pt;border-bottom:1px solid #d9d9d9;vertical-align:top;font-size:9pt;font-weight:bold;color:#444;">' + esc(label) + '</td><td style="padding:3pt 6pt;border-bottom:1px solid #d9d9d9;vertical-align:top;font-size:9pt;">' + esc(value) + '</td></tr>';
      return "<tr><td>" + esc(label) + "</td><td>" + esc(value) + "</td></tr>";
    }

    // Snapshot rows for the categories the scan actually measured
    // (per-category scores are covered by the dedicated Scores section above).
    var rows = [
      row("Analyzed URL", page.url || "n/a"),
      row("Host", page.host || "n/a"),
      row("Page title", page.title || "n/a"),
      row("Total elements", num(dom.totalElements)),
      row("Total nodes", num(dom.totalNodes)),
      row("Max nesting depth", num(dom.maxDepth)),
      row("Duplicate IDs", dom.duplicateIds ? dom.duplicateIds.length : "n/a"),
      row("Empty elements", num(dom.emptyElements)),
      row("Load time", (perf.loadTime !== null && perf.loadTime !== undefined) ? (perf.loadTime / 1000).toFixed(1) + "s" : "n/a"),
      row("First Contentful Paint", (perf.firstContentfulPaint !== null && perf.firstContentfulPaint !== undefined) ? (perf.firstContentfulPaint / 1000).toFixed(1) + "s" : "n/a"),
      row("Resources", num(perf.resourceCount)),
      row("Third-party resources", num(perf.thirdPartyCount)),
      row("Images missing alt", num(a11y.imagesMissingAlt)),
      row("Inputs without labels", num(a11y.inputsNoLabel)),
      row("Title length", seo.titleLength !== undefined && seo.titleLength !== null ? seo.titleLength + " chars" : "n/a"),
      row("Meta description length", seo.descriptionLength !== undefined && seo.descriptionLength !== null ? seo.descriptionLength + " chars" : "n/a"),
      row("Forms", num(formsData.formCount) + (formsData.inputCount != null ? " \u00B7 " + formsData.inputCount + " inputs" : "")),
      row("Form fields without labels", num(formsData.missingLabels)),
      row("Images", num(imagesData.total) + (imagesData.svgCount ? " \u00B7 " + imagesData.svgCount + " SVG" : "")),
      row("Images missing alt", num(imagesData.missingAlt) + (imagesData.lazyLoaded != null ? " \u00B7 " + imagesData.lazyLoaded + " lazy" : "")),
      row("Alt coverage", (imagesData.total > 0 && imagesData.withAlt != null) ? Math.round((imagesData.withAlt / imagesData.total) * 100) + "%" : (imagesData.total ? "n/a" : "no images")),
      row("Inline styles", num(dom.inlineStyleCount) + (dom.inlineStyleBytes ? " \u00B7 " + formatBytes(dom.inlineStyleBytes) : "")),
      row("Scripts", num(perf.jsCount) + " external \u00B7 " + num(perf.inlineScriptCount) + " inline" + (perf.jsBytes ? " \u00B7 " + formatBytes(perf.jsBytes) : "")),
      row("Working links", num(linksData.total) + (linksData.external != null ? " \u00B7 " + linksData.external + " external" : "")),
      row("Broken links", brokenLinksData && brokenLinksData.counts ? num(brokenLinksData.counts.broken) : "n/a"),
      row("Missing accessible names", num((a11y.buttonsNoName || 0) + (a11y.linksNoText || 0) + (a11y.inputsNoLabel || 0) + (a11y.iframesNoTitle || 0) + (a11y.navsNoName || 0))),
      row("Responsive issues", num(hintCount)),
      row("Elementor structures", (dom.elementor && dom.elementor.detected) ? num(dom.elementor.containers) + (dom.elementor.maxNesting ? " \u00B7 max nesting " + num(dom.elementor.maxNesting) : "") : "not detected"),
      row("Technologies detected", num(techTotal))
    ];

    // One plain two-column "score sheet": every measured category shares the
    // same simple label/value row as the rest of the document.
    var scorePairs = [
      ["Overall score", scores.overall],
      ["DOM", scores.dom],
      ["Performance", scores.performance],
      ["SEO", scores.seo],
      ["Accessibility", scores.accessibility],
      ["Structure", scores.structure]
    ];
    ["technology", "forms", "links", "images", "responsive"].forEach(function (k) {
      if (scores[k] !== undefined && scores[k] !== null && scorePairs.length < 14) {
        scorePairs.push([k.charAt(0).toUpperCase() + k.slice(1), scores[k]]);
      }
    });
    var scoreHtml = scorePairs.map(function (p) {
      var v = (p[1] === undefined || p[1] === null) ? "n/a" : p[1] + "/100";
      return row(p[0], v);
    }).join("\n");

    function sec(label, bodyHtml) {
      if (word) return '<p style="margin:12pt 0 4pt;font-size:10.5pt;font-weight:bold;color:#111;border-bottom:1px solid #999;padding-bottom:2pt;">' + esc(label).toUpperCase() + '</p>\n' + bodyHtml + "\n";
      return '<h2>' + esc(label) + '</h2>\n' + bodyHtml + "\n";
    }

    function wIssueTable(rowsHtml) {
      return '<table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">' + rowsHtml + "</table>";
    }

    function issueRows(list, cls, chip) {
      if (!list.length) {
        if (word) return '<p style="margin:4pt 0;font-size:9pt;color:#777;font-style:italic;">Nothing found in this category \u2014 result is clean.</p>';
        return '<p class="empty">Nothing found in this category \u2014 result is clean.</p>';
      }
      if (word) {
        var wColor = cls === "critical" ? "#b91c1c" : cls === "warning" ? "#b45309" : "#15803d";
        var wBg = cls === "critical" ? "#fdf8f8" : cls === "warning" ? "#fbf7f0" : "#f6fbf8";
        return wIssueTable(list.map(function (i) {
          return '<tr><td style="border-left:3pt solid ' + wColor + ';background:' + wBg + ';padding:5pt 8pt;font-size:9pt;">'
            + '<b>' + esc(chip) + '</b> \u2014 <b>' + escapeHtml(i.title) + '</b>'
            + '<div style="margin-top:2pt;color:#333;">' + escapeHtml(i.desc) + '</div>'
            + (i.rec ? '<div style="margin-top:3pt;color:#555;font-style:italic;"><b>Recommendation:</b> ' + escapeHtml(i.rec) + '</div>' : '')
            + '</td></tr>';
        }).join(""));
      }
      return list.map(function (i) {
        return '<div class="issue ' + cls + '"><span class="tag">' + esc(chip) + '</span>'
          + '<b>' + escapeHtml(i.title) + '</b>'
          + '<p>' + escapeHtml(i.desc) + '</p>'
          + (i.rec ? '<p class="rec"><b>Recommendation:</b> ' + escapeHtml(i.rec) + '</p>' : '')
          + '</div>';
      }).join("\n");
    }

    function hintRows() {
      var list = responsive.layoutHints || [];
      if (!list.length) {
        if (word) return '<p style="margin:4pt 0;font-size:9pt;color:#777;font-style:italic;">No responsiveness problems detected at the current viewport width.</p>';
        return '<p class="empty">No responsiveness problems detected at the current viewport width.</p>';
      }
      var sums = {
        critical: 0, high: 0, medium: 0, low: 0
      };
      list.forEach(function (h) { if (sums[h.priority] !== undefined) sums[h.priority]++; });
      if (word) {
        var priColor = { critical: "#b91c1c", high: "#b45309", medium: "#b45309", low: "#15803d" };
        var priBg = { critical: "#fdf8f8", high: "#fbf7f0", medium: "#fbf7f0", low: "#f6fbf8" };
        return wIssueTable(list.slice(0, 40).map(function (h) {
          var p = h.priority || "low";
          var color = priColor[p] || "#666";
          var chip = p === "critical" ? "Critical" : (p === "high" ? "Warning" : "Cue");
          return '<tr><td style="border-left:3pt solid ' + color + ';background:' + (priBg[p] || "#fafafa") + ';padding:5pt 8pt;font-size:9pt;">'
            + '<b>' + esc(chip) + '</b> \u2014 <b>' + escapeHtml(h.title) + '</b>'
            + '<div style="margin-top:2pt;color:#333;">' + escapeHtml(h.message || "") + '</div>'
            + (h.kind ? '<div style="margin-top:3pt;color:#555;font-style:italic;"><b>Signal:</b> ' + escapeHtml(h.kind) + '</div>' : '')
            + '</td></tr>';
        }).join(""));
      }
      return list.slice(0, 40).map(function (h) {
        var cls = h.priority === "critical" ? "critical" : (h.priority === "high" ? "warning" : "good");
        var chip = h.priority === "critical" ? "Critical" : (h.priority === "high" ? "Warning" : "Cue");
        return '<div class="issue ' + cls + '"><span class="tag">' + chip + '</span>'
          + '<b>' + escapeHtml(h.title) + '</b>'
          + '<p>' + escapeHtml(h.message || "") + '</p>'
          + (h.kind ? '<p class="rec"><b>Signal:</b> ' + escapeHtml(h.kind) + '</p>' : '')
          + '</div>';
      }).join("\n");
    }

    function techRows() {
      var order = ["cms", "ecommerce", "pageBuilders", "builders", "editors", "frameworks", "cssFrameworks", "libraries", "fonts", "analytics", "marketing", "forms", "performance", "seo", "privacy", "security", "cdns", "platforms"];
      var names = { cms: "CMS", ecommerce: "E-commerce", pageBuilders: "Page builder", builders: "Site builder", editors: "Editor", frameworks: "JavaScript framework", cssFrameworks: "CSS framework", libraries: "Libraries", fonts: "Fonts", analytics: "Analytics", marketing: "Marketing", forms: "Form", performance: "Performance", seo: "SEO", privacy: "Privacy", security: "Security", cdns: "CDN", platforms: "Platform" };
      var out = [];
      order.forEach(function (k) {
        var arr = techGroups[k] || [];
        if (!arr.length) return;
        var label = names[k] || k;
        var items = arr.slice(0, 12).map(function (t) {
          return t.name + (t.confidence ? " (" + t.confidence + ")" : "");
        }).join(", ");
        out.push(row(label, items));
      });
      if (!out.length) out.push(row("Technology", "No recognized technology stack detected on this page."));
      return out.join("\n");
    }

    var techHtml = techRows();
    var tableWrap = function (inner, emptyText) {
      if (word) return inner ? '<table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">' + inner + "\n</table>" : '<p class="empty">' + emptyText + '</p>';
      return inner ? '<table>\n' + inner + "\n</table>" : '<p class="empty">' + emptyText + '</p>';
    };
    var issuesWrap = function (inner) { return word ? inner : '<div class="issues">' + inner + '</div>'; };
    var respSumm = hintCount
      ? (word
          ? '<p style="margin:4pt 0 6pt;font-size:9pt;color:#333;">' + hintCount + ' responsiveness cue' + (hintCount === 1 ? "" : "s") + " detected at the current viewport: " + esc(num(responsive.breakPoints)) + " breakpoints, " + esc(num(responsive.fixedWidthCount)) + " fixed-width element" + ((responsive.fixedWidthCount || 0) === 1 ? "" : "s") + ", " + esc(num(responsive.overflowNow)) + " overflow, " + esc(num(responsive.textOverflowCount)) + " clipped, " + esc(num(responsive.offscreenCount)) + " off-screen.</p>\n"
          : '<p class="summ">' + hintCount + ' responsiveness cue' + (hintCount === 1 ? "" : "s") + " detected at the current viewport: " + esc(num(responsive.breakPoints)) + " breakpoints, " + esc(num(responsive.fixedWidthCount)) + " fixed-width element" + ((responsive.fixedWidthCount || 0) === 1 ? "" : "s") + ", " + esc(num(responsive.overflowNow)) + " overflow, " + esc(num(responsive.textOverflowCount)) + " clipped, " + esc(num(responsive.offscreenCount)) + " off-screen.</p>\n")
      : "";
    var critCount = critical.length;
    var warnCount = warning.length;
    var passCount = good.length;
    var verdictLevel = (critCount === 0 && warnCount === 0) ? "good"
      : critCount === 0 ? "fair"
      : critCount <= 3 ? "warn" : "critical";
    var verdictLabel = (critCount === 0 && warnCount === 0) ? "Excellent \u2014 no issues found"
      : critCount === 0 ? "Good \u2014 " + warnCount + " warning" + (warnCount === 1 ? "" : "s") + " to address"
      : critCount + " critical fix" + (critCount === 1 ? "" : "es") + " required";

    // "Health at a Glance": the three audit categories as direct statistics —
    // passing checks, warnings to address, and critical fixes required.
    function glanceBlock() {
      if (word) {
        var gBg = verdictLevel === "good" ? "#f0fdf4" : verdictLevel === "fair" ? "#f7f8fb" : verdictLevel === "warn" ? "#fff7ed" : "#fef2f2";
        return '<table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin-bottom:10pt;">'
          + '<tr><td colspan="3" style="padding:6pt 8pt;background:' + gBg + ';border-bottom:1pt solid #d1d5db;font-size:10.5pt;color:#111;"><b>' + esc(verdictLabel) + '</b></td></tr>'
          + '<tr>'
          + '<td style="width:33%;padding:6pt 8pt;text-align:center;border-right:1pt solid #e5e7eb;"><div style="font-size:15pt;font-weight:bold;color:#b91c1c;">' + critCount + '</div><div style="font-size:8pt;color:#555;text-transform:uppercase;letter-spacing:0.5pt;">Critical fixes required</div></td>'
          + '<td style="width:34%;padding:6pt 8pt;text-align:center;border-right:1pt solid #e5e7eb;"><div style="font-size:15pt;font-weight:bold;color:#b45309;">' + warnCount + '</div><div style="font-size:8pt;color:#555;text-transform:uppercase;letter-spacing:0.5pt;">Warnings to address</div></td>'
          + '<td style="width:33%;padding:6pt 8pt;text-align:center;"><div style="font-size:15pt;font-weight:bold;color:#15803d;">' + passCount + '</div><div style="font-size:8pt;color:#555;text-transform:uppercase;letter-spacing:0.5pt;">Passing checks</div></td>'
          + '</tr>'
          + '</table>';
      }
      return '<div class="glance">'
        + '<div class="glance-verdict ' + verdictLevel + '">' + esc(verdictLabel) + '</div>'
        + '<div class="glance-row">'
        + '<div class="glance-stat critical"><b>' + critCount + '</b><span>Critical fixes required</span></div>'
        + '<div class="glance-stat warning"><b>' + warnCount + '</b><span>Warnings to address</span></div>'
        + '<div class="glance-stat good"><b>' + passCount + '</b><span>Passing checks</span></div>'
        + '</div></div>';
    }

    var body = sec("Health at a Glance", glanceBlock())
      + sec("Scores", tableWrap(scoreHtml, ""))
      + sec("1. Page snapshot", tableWrap(rows.join("\n"), ""))
      + sec("2. Critical issues", issuesWrap(issueRows(critical, "critical", "Critical")))
      + sec("3. Warnings", issuesWrap(issueRows(warning, "warning", "Warning")))
      + sec("4. Good results", issuesWrap(issueRows(good, "good", "Pass")))
      + sec("5. Technology stack", tableWrap(techHtml, "Nothing to list."))
      + sec("6. Responsive signals", respSumm + issuesWrap(hintRows()));

    if (word) {
      return "<html xmlns:o=\"urn:schemas-microsoft-com:office:office\" xmlns:w=\"urn:schemas-microsoft-com:office:word\" xmlns=\"http://www.w3.org/TR/REC-html40\">\n"
        + "<head>\n<meta charset=\"utf-8\">\n"
        + "<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->\n"
        + "<style>@page WordSection1{size:8.5in 11.0in;margin:0.9in 0.8in;}div.WordSection1{page:WordSection1;}</style>\n"
        + "</head>\n<body>\n<div class=\"WordSection1\">\n"
        + '<p style="font-size:8pt;letter-spacing:2pt;color:#666;">Web Doctor \u00B7 QA Report</p>\n'
        + '<p style="font-size:16pt;font-weight:bold;margin:8pt 0 2pt;">Website Audit</p>\n'
        + '<p style="font-size:9pt;color:#333;margin:2pt 0 6pt;">'
        + "<b>Page:</b> " + esc(page.title || "Untitled page") + '<br/>'
        + "<b>URL:</b> " + esc(page.url || "n/a") + '<br/>'
        + "<b>Generated:</b> " + esc(dateStr) + "</p>\n"
        + body
        + '<p style="margin-top:18pt;font-size:8pt;color:#888;">Prepared by the Web Doctor extension \u2014 Page 1 of 1</p>\n'
        + "</div>\n</body>\n</html>";
    }

    return "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n"
      + '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
      + '<title>Website Audit \u2014 ' + esc(page.title || "") + '</title>\n'
      + "<style>\n"
      + "@page { size: Letter; margin: 0.9in 0.8in; }\n"
      + "* { box-sizing: border-box; }\n"
      + "html { background: #fff; }\n"
      + "body { font-family: Georgia, 'Times New Roman', serif; color: #1b1b1b; margin: 0; line-height: 1.6; }\n"
      + ".doc { max-width: 720px; margin: 0 auto; padding: 44px 28px 70px; }\n"
      + ".doc-brand { font-size: 10.5px; letter-spacing: 3px; text-transform: uppercase; color: #71717a; border-bottom: 2px solid #111; padding-bottom: 10px; }\n"
      + ".doc-brand b { color: #111; }\n"
      + "h1 { font-size: 26px; font-weight: 700; margin: 24px 0 4px; letter-spacing: .2px; }\n"
      + ".doc-meta { font-size: 11.5px; color: #555; margin: 10px 0 0; }\n"
      + ".doc-meta div { margin: 2px 0; overflow-wrap: anywhere; }\n"
      + ".doc-meta b { color: #222; font-weight: 600; }\n"
      + "hr.doc-rule { border: 0; border-top: 1px solid #d6d6d6; margin: 26px 0 6px; }\n"
      + "h2 { font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 12.5px; text-transform: uppercase; letter-spacing: 1.5px; color: #111; border-bottom: 1px solid #cfcfcf; padding-bottom: 6px; margin: 28px 0 14px; }\n"
      + "table { width: 100%; border-collapse: collapse; font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 12.5px; }\n"
      + "td { padding: 6px 10px; border-bottom: 1px solid #ececec; vertical-align: top; font-size: 12.5px; }\n"
      + "td:first-child { width: 38%; color: #555; font-weight: 500; }\n"
      + ".issues .issue { font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 12.5px; padding: 8px 12px; margin: 0 0 9px; border-left: 3px solid #d4d4d4; background: #fafafa; }\n"
      + ".issues .issue.critical { border-left-color: #b91c1c; background: #fdf8f8; }\n"
      + ".issues .issue.warning { border-left-color: #b45309; background: #fbf7f0; }\n"
      + ".issues .issue.good { border-left-color: #15803d; background: #f6fbf8; }\n"
      + ".issues .tag { display: inline-block; font-size: 9px; letter-spacing: 1px; font-weight: 700; text-transform: uppercase; padding: 1px 6px; border: 1px solid currentColor; border-radius: 2px; margin: 0 8px 0 0; vertical-align: 1px; font-family: Georgia, serif; }\n"
      + ".issues .critical .tag { color: #b91c1c; }\n"
      + ".issues .warning .tag { color: #b45309; }\n"
      + ".issues .good .tag { color: #15803d; }\n"
      + ".issues b { font-size: 12.5px; }\n"
      + ".issues p { margin: 3px 0 0; color: #333; font-size: 12.5px; }\n"
      + ".issues .rec { margin-top: 6px; color: #555; font-size: 12px; font-style: italic; }\n"
      + ".empty { color: #888; font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 12.5px; font-style: italic; }\n"
      + ".summ { font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 12.5px; color: #333; margin: 0 0 10px; }\n"
      + ".foot { margin-top: 36px; padding-top: 10px; border-top: 1px solid #d6d6d6; font-size: 10.5px; color: #999; display: flex; justify-content: space-between; flex-wrap: wrap; gap: 6px; font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }\n"
      + ".glance { margin-bottom: 20px; font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }\n"
      + ".glance-verdict { padding: 10px 14px; font-size: 13px; font-weight: 600; border-radius: 6px; margin-bottom: 12px; }\n"
      + ".glance-verdict.good { background: #f0fdf4; color: #15803d; }\n"
      + ".glance-verdict.fair { background: #f7f8fb; color: #555; }\n"
      + ".glance-verdict.warn { background: #fff7ed; color: #b45309; }\n"
      + ".glance-verdict.critical { background: #fef2f2; color: #b91c1c; }\n"
      + ".glance-row { display: flex; gap: 12px; }\n"
      + ".glance-stat { flex: 1; text-align: center; padding: 10px 6px; border-radius: 6px; border: 1px solid #e5e7eb; }\n"
      + ".glance-stat b { display: block; font-size: 22px; margin-bottom: 2px; }\n"
      + ".glance-stat span { display: block; font-size: 11px; color: #555; text-transform: uppercase; letter-spacing: 0.5px; }\n"
      + ".glance-stat.critical b { color: #b91c1c; }\n"
      + ".glance-stat.warning b { color: #b45309; }\n"
      + ".glance-stat.good b { color: #15803d; }\n"
      + "</style>\n</head>\n<body>\n<div class=\"doc\">\n"
      + '<div class="doc-brand">Web Doctor <b>\u00B7 QA Report</b></div>\n'
      + '<h1>Website Audit</h1>\n'
      + '<div class="doc-meta">\n'
      + '<div><b>Page:</b> ' + esc(page.title || "Untitled page") + '</div>\n'
      + '<div><b>URL:</b> ' + esc(page.url || "n/a") + '</div>\n'
      + '<div><b>Generated:</b> ' + esc(dateStr) + '</div>\n'
      + '</div>\n'
      + '<hr class="doc-rule">\n'
      + body
      + '<div class="foot"><span>Prepared by the Web Doctor extension</span><span>Page 1 of 1</span></div>\n'
      + "</div>\n</body>\n</html>";
  }

  function makeAuditFile() {
    var btn = document.getElementById("btnCreateReport");
    var status = document.getElementById("auditStatus");
    var preview = document.getElementById("auditPreview");
    var frame = document.getElementById("auditPreviewFrame");
    var label = document.getElementById("auditPreviewLabel");
    var hint = document.getElementById("auditDownloadHint");
    var btnDocs = document.getElementById("btnConvertDocs");
    var btnDlDocs = document.getElementById("btnDownloadDocs");
    var btnDl = document.getElementById("btnDownloadReport");
    if (btn) btn.disabled = true;
    if (status) { status.className = "audit-status visible"; status.textContent = "Building the report\u2026"; }
    var finish = function (doc) {
      auditDoc = doc;
      auditData = currentData;
      auditDocsDoc = null;
      if (preview) preview.classList.remove("hidden");
      if (frame) frame.srcdoc = doc;
      if (label) label.textContent = "Full report ready \u2014 review it here, convert it, or download it.";
      if (btnDocs) btnDocs.disabled = false;
      if (btnDlDocs) btnDlDocs.disabled = true;
      if (btnDl) btnDl.disabled = false;
      if (auditBlobUrl) {
        try { URL.revokeObjectURL(auditBlobUrl); } catch (e) {}
        auditBlobUrl = null;
      }
      hostBlob("audit-report.html", doc, "text/html", function (url) {
        auditBlobUrl = url;
        if (!url) {
          if (status) status.textContent = "Report shown inline (could not open a new tab).";
          if (hint) hint.textContent = "Full details are inline above. Use Convert to Docs File to export for Word.";
          return;
        }
        chrome.tabs.create({ url: url }, function () {
          if (chrome.runtime.lastError) {
            if (status) status.textContent = "Report shown inline (could not open the new tab: " + chrome.runtime.lastError.message + ").";
            return;
          }
          if (status) status.textContent = "Report shown above and opened in a new tab.";
          if (hint) hint.textContent = "Full details are inline above. Use Convert to Docs File to export for Word.";
        });
      });
    };
    var fail = function (msg) {
      if (status) { status.className = "audit-status visible"; status.textContent = msg; }
      if (preview) preview.classList.add("hidden");
      if (btnDocs) btnDocs.disabled = true;
      if (btnDlDocs) btnDlDocs.disabled = true;
      if (btnDl) btnDl.disabled = true;
    };
    var afterScan = function () {
      try {
        if (!currentData) throw new Error("no scan data");
        finish(buildAuditReport(currentData));
      } catch (err) {
        var msg = "No scan data yet \u2014 run an analysis first, then Audit Report.";
        if (err && err.message !== "no scan data") msg = "Could not build the report: " + err.message;
        fail(msg);
      } finally {
        if (btn) btn.disabled = false;
      }
    };
    if (currentData) {
      afterScan();
      return;
    }
    // Audit is self-sufficient: with no scan data on hand, run a fresh scan of
    // the active tab first, then build the report from that result.
    if (status) { status.className = "audit-status visible"; status.textContent = "Analyzing the page first \u2014 the report needs a fresh scan\u2026"; }
    chrome.runtime.sendMessage({ action: "analyzeTab" }, function (response) {
      if (!response || !response.success) {
        fail(response ? ("Could not analyze the page: " + response.error) : "No response from extension. Try reloading the popup.");
        if (btn) btn.disabled = false;
        return;
      }
      currentData = response.data;
      afterScan();
    });
  }

  function openAuditReportTab() {
    if (!auditBlobUrl) {
      var btn = document.getElementById("btnCreateReport");
      if (btn) btn.click();
      return;
    }
    chrome.tabs.create({ url: auditBlobUrl }, function () {
      var status = document.getElementById("auditStatus");
      if (chrome.runtime.lastError) {
        if (status) status.textContent = "Could not open the report tab: " + chrome.runtime.lastError.message;
        return;
      }
      if (status) status.textContent = "Report opened in a new tab.";
    });
  }

  // Domain-derived file name so exports are easy to tell apart.
  function auditExportName(ext) {
    var host = (auditData && auditData.page && auditData.page.host) || "";
    var base = String(host).replace(/[^a-zA-Z0-9.-]/g, "-").replace(/^-+|-+$/g, "") || "web-doctor";
    return base + "-audit-report." + ext;
  }

  // Clean HTML-to-BLOB export: wrap the content in a Blob with the requested
  // MIME type, hand it to a temporary anchor, click it, and revoke the object
  // URL right away so no Blob URL leaks accumulate in the document.
  function downloadBlob(name, content, mime, status, doneMsg) {
    var statusBase = status && status.className.indexOf("devmod-status") !== -1 ? "devmod-status" : "audit-status";
    var url;
    try {
      url = URL.createObjectURL(new Blob([content], { type: mime }));
    } catch (err) {
      if (status) { status.className = statusBase + " visible"; status.textContent = "Could not build the download: " + err.message; }
      return;
    }
    var a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    if (a.parentNode) a.parentNode.removeChild(a);
    try { URL.revokeObjectURL(url); } catch (e) {}
    if (status) { status.className = statusBase + " visible"; status.textContent = "Download " + doneMsg + " (" + name + ")."; }
  }

  // Reports opened in a new tab must outlive this popup, so hand the HTML to
  // the service worker and open its URL (a popup-created Blob URL dies the
  // moment the popup closes). Falls back to a local Blob URL if the host
  // cannot be reached.
  function hostBlob(name, content, mime, cb) {
    if (chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ action: "hostBlob", name: name, html: content, mime: mime || "text/html" }, function (res) {
        if (chrome.runtime.lastError || !res || !res.success) {
          var fallback = null;
          try { fallback = URL.createObjectURL(new Blob([content], { type: mime || "text/html" })); } catch (e) { fallback = null; }
          if (cb) cb(fallback);
          return;
        }
        if (cb) cb(res.url);
      });
      return;
    }
    if (cb) cb(null);
  }

  function downloadAuditFile() {
    var status = document.getElementById("auditStatus");
    if (!auditDoc) {
      if (status) status.textContent = "Create the audit report first, then download it.";
      return;
    }
    downloadBlob(auditExportName("html"), auditDoc, "text/html", status, "of the report started");
  }

  function downloadAuditDocsFile() {
    var status = document.getElementById("auditStatus");
    if (!auditDocsDoc && auditData) {
      try { auditDocsDoc = buildAuditReport(auditData, true); } catch (err) { auditDocsDoc = null; }
    }
    if (!auditDocsDoc) {
      if (status) status.textContent = "Convert the report to a Docs file first, then download it.";
      return;
    }
    downloadBlob(auditExportName("doc"), auditDocsDoc, "application/msword", status, "of the Docs file started");
  }

  function convertToDocsFile() {
    var status = document.getElementById("auditStatus");
    var btnDocs = document.getElementById("btnConvertDocs");
    var btnDlDocs = document.getElementById("btnDownloadDocs");
    var hint = document.getElementById("auditDownloadHint");
    if (!auditDoc || !auditData) {
      if (status) status.textContent = !auditDoc ? "Create the report first, then convert it." : "Report data is no longer available \u2014 run Audit Report again.";
      return;
    }
    if (btnDocs) btnDocs.disabled = true;
    if (status) status.textContent = "Converting to a Docs file\u2026";
    try {
      auditDocsDoc = buildAuditReport(auditData, true);
    } catch (err) {
      if (status) { status.className = "audit-status visible"; status.textContent = "Could not convert: " + err.message; }
      if (btnDocs) btnDocs.disabled = false;
      return;
    }
    if (btnDlDocs) btnDlDocs.disabled = false;
    if (hint) hint.textContent = "The .doc file is Word- and Google Docs-compatible (simple tables and inline styles, no scripts).";
    downloadAuditDocsFile();
  }

  // ============================================
  // SITE CRAWLER (Audit tab)
  // ============================================
  // Crawls child pages through the background worker, shows live progress,
  // renders a per-site summary, and builds ONE self-contained site report file
  // (HTML) containing every finding across all visited pages.
  var crawlState = { active: false, data: null, blobUrl: null, doc: null };
  var crawlToken = 0;

  function crawlStatus(text, kind) {
    var st = document.getElementById("crawlStatus");
    if (!st) return;
    st.className = "audit-status" + (kind ? " visible" : " hidden");
    st.textContent = text;
  }

  function crawlProgressLabel() {
    var label = document.getElementById("auditPreviewLabel");
    if (label && crawlState.data) label.textContent = "Site crawl of " + (crawlState.data.meta ? crawlState.data.meta.root : "") + " \u2014 " + crawlState.data.pages.length + " page(s) scanned.";
  }

  function startCrawl() {
    if (crawlState.active) return;
    var btnStart = document.getElementById("btnStartCrawl");
    var btnStop = document.getElementById("btnStopCrawl");
    var btnView = document.getElementById("btnViewCrawlReport");
    var btnDl = document.getElementById("btnDownloadCrawlReport");
    var maxInput = document.getElementById("crawlMaxPages");
    var maxPages = Math.max(1, Math.min(parseInt(maxInput && maxInput.value, 10) || 8, 25));
    if (!currentData || !currentData.page || !currentData.page.url) {
      crawlStatus("Run an analysis first so the crawler knows which site to scan.");
      return;
    }
    var siteUrl = currentData.page.url;
    var testUrl = null;
    try { testUrl = new URL(siteUrl); } catch (e) { testUrl = null; }
    if (!testUrl || !/^https?:$/.test(testUrl.protocol)) {
      crawlStatus("Only http(s) sites can be crawled.");
      return;
    }
    // Each run gets a fresh token so a stale response (e.g. from a run this
    // UI already replaced) can never overwrite newer crawl results. Previous
    // docs/blob URLs are cleared too, so a second run never reopens the old
    // report after a stop.
    var token = ++crawlToken;
    crawlState.data = null;
    crawlState.doc = null;
    crawlState.blobUrl = null;
    crawlState.active = true;
    if (btnStart) btnStart.disabled = true;
    if (btnStop) btnStop.disabled = false;
    if (btnView) btnView.disabled = true;
    if (btnDl) btnDl.disabled = true;
    crawlStatus("Scanning \u2014 requesting site access and loading the first page\u2026", "visible");
    var runCrawl = function () {
      chrome.runtime.sendMessage({ action: "crawlSite", url: siteUrl, maxPages: maxPages }, function (response) {
        var isCurrent = crawlToken === token;
        crawlState.active = false;
        if (btnStop) btnStop.disabled = true;
        if (btnStart) btnStart.disabled = false;
        if (!isCurrent) return;
        if (chrome.runtime.lastError || !response || !response.success) {
          crawlStatus((chrome.runtime.lastError ? chrome.runtime.lastError.message + " " : "") + ((response && response.error) || "Could not scan the site."));
          return;
        }
        crawlState.data = response;
        renderCrawlSummary(response);
      });
    };
    if (chrome.permissions && chrome.permissions.contains) {
      // Ask for host access from the popup (it runs inside the user gesture);
      // the background worker can no longer collect this permission reliably.
      var originPattern = testUrl.origin + "/*";
      chrome.permissions.contains({ origins: [originPattern] }, function (hasSite) {
        if (hasSite) { runCrawl(); return; }
        if (!chrome.permissions.request) { runCrawl(); return; }
        chrome.permissions.request({ origins: [originPattern] }, function (granted) {
          if (granted) { runCrawl(); return; }
          crawlState.active = false;
          if (btnStop) btnStop.disabled = true;
          if (btnStart) btnStart.disabled = false;
          crawlStatus("Site access not granted for " + testUrl.host + " \u2014 the crawler needs it to load child pages. Grant access to this site and try again.");
        });
      });
    } else {
      runCrawl();
    }
  }

  function stopCrawl() {
    if (!crawlState.active) return;
    chrome.runtime.sendMessage({ action: "crawlStop" }, function () {});
    crawlStatus("Stopping after the current page\u2026");
  }

  function renderCrawlSummary(resp) {
    var host = document.getElementById("crawlSummary");
    var hintEl = document.getElementById("crawlHint");
    var btnView = document.getElementById("btnViewCrawlReport");
    var btnDl = document.getElementById("btnDownloadCrawlReport");
    if (!resp || !resp.pages) return;
    var pages = resp.pages;
    var totals = { errors: 0, warnings: 0, infos: 0 };
    var perPage = [];
    var topIssues = [];
    pages.forEach(function (p) {
      var data = p.data;
      var stats = (data && data.stats) || {};
      var pageStats = { errors: 0, warnings: 0, infos: 0 };
      Object.keys(stats).forEach(function (k) {
        pageStats.errors += stats[k].errors || 0;
        pageStats.warnings += stats[k].warnings || 0;
        pageStats.infos += stats[k].infos || 0;
      });
      totals.errors += pageStats.errors;
      totals.warnings += pageStats.warnings;
      totals.infos += pageStats.infos;
      perPage.push(pageStats);
      if (data && data.categories) {
        Object.keys(data.categories).forEach(function (cat) {
          (data.categories[cat] || []).forEach(function (f) {
            if ((f.severity === "error" || f.severity === "warning") && topIssues.length < 12) {
              topIssues.push({ severity: f.severity, title: f.title, loc: f.loc || "", page: p.title || p.url, fix: f.fix });
            }
          });
        });
      }
    });
    var meta = resp.meta || {};
    var chips = '<span class="crawl-chip c-error"><b>' + totals.errors + "</b> critical</span>"
      + '<span class="crawl-chip c-warning"><b>' + totals.warnings + "</b> warnings</span>"
      + '<span class="crawl-chip c-info"><b>' + totals.infos + "</b> cues</span>"
      + '<span class="crawl-chip"><b>' + pages.length + "</b> pages scanned</span>"
      + '<span class="crawl-chip"><b>' + (meta.failed || 0) + "</b> unreachable</span>";
    var list = topIssues.map(function (t) {
      return '<div class="crawl-item ' + (t.severity === "error" ? "c-error" : "c-warning") + '"><b>' + escapeHtml(t.title) + "</b>"
        + (t.loc ? '<span class="crawl-loc"> \u00B7 ' + escapeHtml(t.loc) + "</span>" : "")
        + (t.fix ? '<span class="crawl-fix">Fix: ' + escapeHtml(t.fix) + "</span>" : "")
        + '<span class="crawl-page">' + escapeHtml(t.page) + "</span></div>";
    }).join("");
    host.classList.remove("hidden");
    host.innerHTML = '<div class="crawl-head">Site scan complete</div>'
      + '<div class="crawl-meta">Found ' + totals.errors + " critical issue" + (totals.errors === 1 ? "" : "s") + " and "
      + totals.warnings + " warning" + (totals.warnings === 1 ? "" : "s") + " across " + pages.length + " page"
      + (pages.length === 1 ? "" : "s") + '. The full findings are in the site report below.</div>'
      + '<div class="crawl-chips">' + chips + "</div>"
      + (topIssues.length ? '<div class="crawl-list">' + list + "</div>" : "");
    if (btnView) btnView.disabled = false;
    if (btnDl) btnDl.disabled = false;
    if (hintEl) hintEl.textContent = "View or download the single site report file with every page's findings (layout, responsive, icons, CTAs, design, broken URLs, missing images, structural tags).";
  }

  // ---- Site report generator: ONE self-contained HTML file ----
  function buildCrawlReport(resp) {
    var pages = (resp && resp.pages) || [];
    var meta = (resp && resp.meta) || {};
    var probes = (resp && resp.probes) || {};
    var now = new Date();
    var dateStr = now.toDateString() + " \u00B7 " + now.toLocaleTimeString();
    var host = "";
    try { host = new URL(meta.root || "https://x.invalid").host; } catch (e) { host = ""; }

    function esc(s) { return escapeHtml(String(s === undefined || s === null ? "" : s)); }
    function num(v) { return (v === undefined || v === null) ? "n/a" : Number(v).toLocaleString(); }

    var totals = { errors: 0, warnings: 0, infos: 0, findings: 0 };
    var categoryTotals = {
      layout: 0, responsive: 0, icons: 0, cta: 0, design: 0, structure: 0, urls: 0, images: 0
    };
    var CATEGORY_NAMES = {
      layout: "Layout breakages", responsive: "Responsive / viewport", icons: "Icon issues",
      cta: "CTA buttons", design: "Design", structure: "Structural tags", urls: "Broken URLs", images: "Missing images"
    };
    var allFindings = [];
    pages.forEach(function (p) {
      var data = p.data;
      if (!data || !data.categories) return;
      Object.keys(data.categories).forEach(function (cat) {
        (data.categories[cat] || []).forEach(function (f) {
          allFindings.push({ page: p.title || p.url, url: p.url, cat: cat, severity: f.severity || "info", title: f.title || "", fix: f.fix || "", loc: f.loc || "", section: f.section || "" });
          categoryTotals[cat] = (categoryTotals[cat] || 0) + 1;
        });
      });
    });
    allFindings.forEach(function (f) {
      if (f.severity === "error") totals.errors++;
      else if (f.severity === "warning") totals.warnings++;
      else totals.infos++;
      totals.findings++;
    });

    function row(label, value) {
      return "<td>" + esc(label) + "</td><td>" + esc(value) + "</td>";
    }

    // Per-page summary table
    var pageRows = pages.map(function (p) {
      var stats = (p.data && p.data.stats) || {};
      var e = 0, w = 0, i = 0;
      Object.keys(stats).forEach(function (k) { e += stats[k].errors || 0; w += stats[k].warnings || 0; i += stats[k].infos || 0; });
      return "<tr>" + row(p.title || p.url, (p.error ? p.error : e + " critical \u00B7 " + w + " warnings \u00B7 " + i + " cues")) + "</tr>";
    }).join("\n");

    // Category table (critical/warning only for the headline, all counts listed)
    var catRows = Object.keys(categoryTotals).map(function (k) {
      var n = categoryTotals[k];
      return "<tr>" + row(CATEGORY_NAMES[k] || k, n) + "</tr>";
    }).join("\n");

    // Network section
    function urlTable(list, emptyMsg) {
      if (!list.length) return '<p class="empty">' + esc(emptyMsg) + "</p>";
      return list.map(function (b) {
        return '<div class="issue critical"><span class="tag">Critical</span><b>' + esc(b.reason) + "</b>"
          + '<p>' + esc(b.url) + (b.foundOn ? '<span class="small">Found on: ' + esc(b.foundOn) + "</span>" : "") + "</p>"
          + (b.reason ? '</div>' : '</div>');
      }).join("\n");
    }

    // Findings grouped per category, severity-sorted, capped per category
    var GROUP_ORDER = ["layout", "responsive", "icons", "cta", "design", "structure", "urls", "images"];
    var sevRank = { error: 0, warning: 1, info: 2 };
    function findingBlocks(cat) {
      var items = allFindings.filter(function (f) { return f.cat === cat; })
        .sort(function (a, b) { return (sevRank[a.severity] || 3) - (sevRank[b.severity] || 3); });
      if (!items.length) return '<p class="empty">Nothing found in this category \u2014 clean.</p>';
      var shown = items.slice(0, 40);
      return shown.map(function (f) {
        var cls = f.severity === "error" ? "critical" : f.severity === "warning" ? "warning" : "good";
        var chip = f.severity === "error" ? "Critical" : f.severity === "warning" ? "Warning" : "Cue";
        return '<div class="issue ' + cls + '"><span class="tag">' + chip + "</span><b>" + esc(f.title) + "</b>"
          + (f.loc ? '<span class="small">' + esc(f.loc) + (f.section ? " \u2014 " + esc(f.section) : "") + "</span>" : "")
          + '<p>' + esc(f.fix) + "</p>"
          + '<span class="small page-ref">' + esc(f.page) + "</span></div>";
      }).join("\n");
    }

    var catSecs = GROUP_ORDER.map(function (cat) {
      return '<h2>' + esc(CATEGORY_NAMES[cat] || cat) + "</h2>\n" + findingBlocks(cat);
    }).join("\n");

    var verdict = (totals.errors === 0 && totals.warnings === 0) ? "Excellent \u2014 no issues found across the site"
      : totals.errors === 0 ? "Good \u2014 " + totals.warnings + " warning" + (totals.warnings === 1 ? "" : "s") + " to address"
      : totals.errors + " critical fix" + (totals.errors === 1 ? "" : "es") + " required";

    var html = "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n"
      + '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
      + "<title>Website Frontend Audit \u2014 " + esc(host) + "</title>\n"
      + "<style>\n"
      + "@page { size: Letter; margin: 0.9in 0.8in; }\n"
      + "* { box-sizing: border-box; }\n"
      + "html { background: #fff; }\n"
      + "body { font-family: Georgia, 'Times New Roman', serif; color: #1b1b1b; margin: 0; line-height: 1.6; }\n"
      + ".doc { max-width: 760px; margin: 0 auto; padding: 44px 28px 70px; }\n"
      + ".doc-brand { font-size: 10.5px; letter-spacing: 3px; text-transform: uppercase; color: #71717a; border-bottom: 2px solid #111; padding-bottom: 10px; }\n"
      + ".doc-brand b { color: #111; }\n"
      + "h1 { font-size: 26px; font-weight: 700; margin: 24px 0 4px; letter-spacing: .2px; }\n"
      + ".doc-meta { font-size: 11.5px; color: #555; margin: 10px 0 0; }\n"
      + ".doc-meta div { margin: 2px 0; overflow-wrap: anywhere; }\n"
      + ".doc-meta b { color: #222; font-weight: 600; }\n"
      + "hr.doc-rule { border: 0; border-top: 1px solid #d6d6d6; margin: 26px 0 6px; }\n"
      + "h2 { font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 12.5px; text-transform: uppercase; letter-spacing: 1.5px; color: #111; border-bottom: 1px solid #cfcfcf; padding-bottom: 6px; margin: 28px 0 14px; }\n"
      + "table { width: 100%; border-collapse: collapse; font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 12.5px; margin-bottom: 8px; }\n"
      + "td { padding: 6px 10px; border-bottom: 1px solid #ececec; vertical-align: top; font-size: 12.5px; }\n"
      + "td:first-child { width: 42%; color: #555; font-weight: 500; }\n"
      + ".issues .issue { font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 12.5px; padding: 8px 12px; margin: 0 0 9px; border-left: 3px solid #d4d4d4; background: #fafafa; }\n"
      + ".issues .issue.critical { border-left-color: #b91c1c; background: #fdf8f8; }\n"
      + ".issues .issue.warning { border-left-color: #b45309; background: #fbf7f0; }\n"
      + ".issues .issue.good { border-left-color: #15803d; background: #f6fbf8; }\n"
      + ".issues .tag { display: inline-block; font-size: 9px; letter-spacing: 1px; font-weight: 700; text-transform: uppercase; padding: 1px 6px; border: 1px solid currentColor; border-radius: 2px; margin: 0 8px 0 0; vertical-align: 1px; font-family: Georgia, serif; }\n"
      + ".issues .critical .tag { color: #b91c1c; } .issues .warning .tag { color: #b45309; } .issues .good .tag { color: #15803d; }\n"
      + ".issues b { font-size: 12.5px; }\n"
      + ".issues p { margin: 3px 0 0; color: #333; font-size: 12.5px; }\n"
      + ".issues .small { display: block; margin-top: 3px; color: #777; font-size: 11px; }\n"
      + ".issues .small.page-ref { font-style: italic; color: #999; }\n"
      + ".empty { color: #888; font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 12.5px; font-style: italic; }\n"
      + ".glance { margin: 18px 0; font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }\n"
      + ".glance-row { display: flex; gap: 12px; }\n"
      + ".glance-stat { flex: 1; text-align: center; padding: 10px 6px; border-radius: 6px; border: 1px solid #e5e7eb; }\n"
      + ".glance-stat b { display: block; font-size: 22px; margin-bottom: 2px; }\n"
      + ".glance-stat span { display: block; font-size: 11px; color: #555; text-transform: uppercase; letter-spacing: 0.5px; }\n"
      + ".glance-stat.critical b { color: #b91c1c; } .glance-stat.warning b { color: #b45309; } .glance-stat.good b { color: #15803d; }\n"
      + ".foot { margin-top: 36px; padding-top: 10px; border-top: 1px solid #d6d6d6; font-size: 10.5px; color: #999; font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }\n"
      + "</style>\n</head>\n<body>\n<div class=\"doc\">\n"
      + '<div class="doc-brand">Web Doctor <b>\u00B7 QA Report</b></div>\n'
      + "<h1>Website Frontend Audit</h1>\n"
      + '<div class="doc-meta">\n'
      + "<div><b>Site:</b> " + esc(meta.root || "") + "</div>\n"
      + (host ? "<div><b>Host:</b> " + esc(host) + "</div>\n" : "")
      + "<div><b>Pages scanned:</b> " + num(pages.length) + (meta.failed ? " (" + meta.failed + " unreachable)" : "") + "</div>\n"
      + "<div><b>Generated:</b> " + esc(dateStr) + "</div>\n"
      + "</div>\n"
      + '<hr class="doc-rule">\n'
      + "<h2>Health at a Glance</h2>\n"
      + '<div class="glance"><div class="glance-row">'
      + '<div class="glance-stat critical"><b>' + totals.errors + "</b><span>Critical fixes required</span></div>"
      + '<div class="glance-stat warning"><b>' + totals.warnings + "</b><span>Warnings to address</span></div>"
      + '<div class="glance-stat good"><b>' + totals.infos + "</b><span>Improvement cues</span></div>"
      + "</div></div>\n"
      + '<div class="doc-meta"><div><b>Verdict:</b> ' + esc(verdict) + "</div></div>\n"
      + "<h2>Pages Scanned</h2>\n<table>\n" + pageRows + "\n</table>\n"
      + "<h2>Findings by Category</h2>\n<table>\n" + catRows + "\n</table>\n"
      + "<h2>Broken URLs</h2>\n<div class=\"issues\">\n" + urlTable(probes.brokenLinks || [], "No broken child-page URLs found \u2014 every collected link is reachable.") + "\n</div>\n"
      + "<h2>Missing Images</h2>\n<div class=\"issues\">\n" + urlTable(probes.brokenImages || [], "No missing image URLs found \u2014 every collected media file loads.") + "\n</div>\n"
      + "<h2>Detailed Findings</h2>\n"
      + catSecs
      + '<div class="foot"><span>Prepared by the Web Doctor extension</span><span>' + num(pages.length) + " page(s) \u00B7 " + totals.findings + " finding" + (totals.findings === 1 ? "" : "s") + "</span></div>\n"
      + "</div>\n</body>\n</html>";
    return html;
  }

  function crawlExportName() {
    var host = "web-doctor";
    try {
      if (crawlState.data && crawlState.data.meta && crawlState.data.meta.root) {
        host = String(new URL(crawlState.data.meta.root).host).replace(/[^a-zA-Z0-9.-]/g, "-").replace(/^-+|-+$/g, "") || "web-doctor";
      }
    } catch (e) {}
    return host + "-site-report.html";
  }

  function viewCrawlReport() {
    if (!crawlState.data) return;
    if (!crawlState.doc) crawlState.doc = buildCrawlReport(crawlState.data);
    hostBlob("site-report.html", crawlState.doc, "text/html", function (url) {
      if (!url) {
        var st0 = document.getElementById("crawlStatus");
        if (st0) st0.textContent = "Could not open the report tab.";
        return;
      }
      crawlState.blobUrl = url;
      chrome.tabs.create({ url: url }, function () {
        var st = document.getElementById("crawlStatus");
        if (chrome.runtime.lastError && st) st.textContent = "Could not open the report tab: " + chrome.runtime.lastError.message;
      });
    });
  }

  function downloadCrawlReport() {
    var st = document.getElementById("crawlStatus");
    if (!crawlState.data) {
      if (st) st.textContent = "Scan the site first, then download the report.";
      return;
    }
    if (!crawlState.doc) crawlState.doc = buildCrawlReport(crawlState.data);
    downloadBlob(crawlExportName(), crawlState.doc, "text/html", st, "of the site report started");
  }

  var btnStartCrawl = document.getElementById("btnStartCrawl");
  if (btnStartCrawl) btnStartCrawl.addEventListener("click", startCrawl);
  var btnStopCrawl = document.getElementById("btnStopCrawl");
  if (btnStopCrawl) btnStopCrawl.addEventListener("click", stopCrawl);
  var btnViewCrawlReport = document.getElementById("btnViewCrawlReport");
  if (btnViewCrawlReport) btnViewCrawlReport.addEventListener("click", viewCrawlReport);
  var btnDownloadCrawlReport = document.getElementById("btnDownloadCrawlReport");
  if (btnDownloadCrawlReport) btnDownloadCrawlReport.addEventListener("click", downloadCrawlReport);

  var btnCreateReport = document.getElementById("btnCreateReport");
  if (btnCreateReport) btnCreateReport.addEventListener("click", makeAuditFile);
  var btnConvertDocs = document.getElementById("btnConvertDocs");
  if (btnConvertDocs) btnConvertDocs.addEventListener("click", convertToDocsFile);
  var btnOpenReportTab = document.getElementById("btnOpenReportTab");
  if (btnOpenReportTab) btnOpenReportTab.addEventListener("click", openAuditReportTab);
  var btnDownloadDocs = document.getElementById("btnDownloadDocs");
  if (btnDownloadDocs) btnDownloadDocs.addEventListener("click", downloadAuditDocsFile);
  var btnDownloadReport = document.getElementById("btnDownloadReport");
  if (btnDownloadReport) btnDownloadReport.addEventListener("click", downloadAuditFile);

  // ============================================
  // DOM TAB
  // ============================================
  // DOM-tab health banner: one glance at how bad (or fine) the DOM really is,
  // words the issue in plain language, and pins the single most useful fix.
  function domHealthBanner(dom) {
    var level = dom.verdict === "critical" ? "critical" : dom.verdict === "warn" ? "warn" : "good";
    var icon = level === "critical" ? "\u26D4" : level === "warn" ? "\u26A0\uFE0F" : "\u2705";
    var title = level === "critical" ? "DOM is oversized" : level === "warn" ? "DOM needs attention" : "DOM is healthy";
    var note = dom.totalElements.toLocaleString() + " elements \u00B7 " +
      (dom.totalNodes ? dom.totalNodes.toLocaleString() + " nodes \u00B7 " : "") +
      "max depth " + dom.maxDepth;
    if (dom.hotspots && dom.hotspots.length && dom.coverage) {
      note += " \u00B7 " + dom.hotspots.length + " sections hold " + dom.coverage + "% of the DOM";
    }
    return '<div class="dom-banner ' + level + '">'
      + '<span class="dom-banner-icon">' + icon + '</span>'
      + '<div class="dom-banner-body">'
      + '<div class="dom-banner-title">' + title + '</div>'
      + '<div class="dom-banner-line">' + escapeHtml(note) + '</div>'
      + '<div class="dom-banner-rec"><b>Recommendation:</b> ' + escapeHtml(domRec(dom)) + '</div>'
      + '</div></div>';
  }

  function domRec(dom) {
    var recs = [];
    if (dom.totalElements > 1500) recs.push("cut empty wrappers and duplicated blocks to get under ~1500 elements");
    if (dom.topSection && dom.topSection.recommendation) recs.push(dom.topSection.recommendation);
    if (dom.maxDepth > 20) recs.push("flatten deeply nested wrappers and let CSS Grid or Flexbox express the layout");
    if (dom.elementor && dom.elementor.detected && dom.elementor.excessive && dom.elementor.excessive.level !== "good") {
      recs.push("reduce Elementor container nesting \u2014 see the Elementor card below");
    }
    if (recs.length) return recs[0];
    return "keep markup lean: avoid wrapper elements that exist only for styling.";
  }

  function renderDOM(dom) {
    // Compact size reference lives here; the full summary is on Overview.
    var banner = document.getElementById("domBanner");
    if (banner) banner.innerHTML = domHealthBanner(dom);

    var statsHtml = "";
    statsHtml += statItem("Total Elements", dom.totalElements.toLocaleString(), getSeverityClassInv(dom.totalElements, 800, 1500, 3000));
    statsHtml += statItem("Total Nodes", dom.totalNodes.toLocaleString(), getSeverityClassInv(dom.totalNodes, 1500, 3000, 5000));
    statsHtml += statItem("Max Depth", dom.maxDepth, getSeverityClassInv(dom.maxDepth, 10, 15, 20));
    statsHtml += statItem("Max Children", dom.maxChildren, getSeverityClassInv(dom.maxChildren, 30, 50, 100));
    statsHtml += statItem("Layout Containers", dom.containerCount.toLocaleString(), getSeverityClassInv(dom.containerCount, 200, 400, 800));
    statsHtml += statItem("Nested Containers", dom.nestedContainerCount.toLocaleString(), getSeverityClassInv(dom.nestedContainerCount, 80, 160, 300));
    statsHtml += statItem("Max Container Nesting", dom.maxContainerNesting + " levels", getSeverityClassInv(dom.maxContainerNesting, 4, 8, 12));
    statsHtml += statItem("Sections", dom.sectionCount, "");
    statsHtml += statItem("Major Structural", dom.majorStructuralElements, "");
    statsHtml += statItem("Hidden Elements", (dom.hiddenElementsSampled ? "~" : "") + dom.hiddenElements + (dom.hiddenElementsSampled ? " (sampled)" : ""), "");
    statsHtml += statItem("Empty Elements", dom.emptyElements, dom.emptyElements > 30 ? "yellow" : "");
    statsHtml += statItem("Duplicate IDs", dom.duplicateIds.length, dom.duplicateIds.length > 0 ? "red" : "green");
    statsHtml += statItem("Excessive Nesting", dom.excessiveNestingCount, dom.excessiveNestingCount > 5 ? "yellow" : "green");
    statsHtml += statItem("Deepest Element", "<" + dom.deepestElement + ">", "");
    statsHtml += statItem("Largest Parent", "<" + dom.largestParent + ">", "");
    statsHtml += statItem("Most Repeated", "<" + dom.mostRepeatedElement + ">", "");
    document.getElementById("domStats").innerHTML = statsHtml;

    renderElementor(dom.elementor);

    // DOM Tree
    var treeHtml = "";
    dom.domTree.forEach(function (node) {
      var indent = "";
      for (var i = 0; i < node.depth; i++) indent += '<span class="dom-tree-indent">\u2502  </span>';
      var prefix = node.depth > 0 ? '\u251C\u2500\u2500 ' : '';
      treeHtml += indent + prefix + '<span class="dom-tree-tag">&lt;' + node.tag + '&gt;</span>\n';
    });
    document.getElementById("domTree").innerHTML = treeHtml || '<span class="empty-state">No structural elements detected</span>';

    // Element counts
    var elemHtml = "";
    elemHtml += statItem("div", dom.divCount, "");
    elemHtml += statItem("section", dom.sectionCount, "");
    elemHtml += statItem("article", dom.articleCount, "");
    elemHtml += statItem("header", dom.headerCount, "");
    elemHtml += statItem("footer", dom.footerCount, "");
    elemHtml += statItem("main", dom.mainCount, "");
    elemHtml += statItem("nav", dom.navCount, "");
    elemHtml += statItem("form", dom.formCount, "");
    elemHtml += statItem("input fields", dom.inputCount, "");
    elemHtml += statItem("buttons", dom.buttonCount, "");
    elemHtml += statItem("links", dom.linkCount, "");
    elemHtml += statItem("images", dom.imageCount, "");
    elemHtml += statItem("iframes", dom.iframeCount, "");
    elemHtml += statItem("scripts", dom.scriptCount, "");
    elemHtml += statItem("stylesheets", dom.styleCount, "");
    document.getElementById("domElements").innerHTML = elemHtml;

    renderHotspots(dom.hotspots);
    renderConsoleGuide();
  }

  // Page snapshot on the Overview dashboard: exact DOM size plus key
  // page-weight facts. No estimates — anything unavailable shows as n/a.
  function renderPageSnapshot(data) {
    var box = document.getElementById("pageSnapshot");
    if (!box) return;
    var dom = data.dom || {};
    var perf = data.performance || {};
    var scores = data.scores || {};

    var nodeStatus = getSeverityClassInv(dom.totalNodes || 0, 1500, 3000, 5000);
    var elStatus = getSeverityClassInv(dom.totalElements || 0, 800, 1500, 3000);

    function tile(value, label, cls) {
      return '<div class="snapshot-tile"><span class="snapshot-value ' + (cls || "") + '">' + (value === null || value === undefined ? "\u2014" : escapeHtml(String(value))) + '</span><span class="snapshot-label">' + escapeHtml(label) + '</span></div>';
    }

    var html = tile(dom.totalElements ? dom.totalElements.toLocaleString() : "\u2014", "DOM elements", elStatus);
    html += tile(dom.totalNodes ? dom.totalNodes.toLocaleString() : "\u2014", "DOM nodes", nodeStatus);
    html += tile(perf.totalTransferred ? perf.totalTransferred : "\u2014", "Page weight");
    html += tile(perf.resourceCount != null ? perf.resourceCount.toLocaleString() : "\u2014", "Requests");
    html += tile(perf.loadTime != null ? (perf.loadTime / 1000).toFixed(1) + "s" : "\u2014", "Load time");
    html += tile(scores.performance != null ? scores.performance : "\u2014", "Perf score", getScoreColorClass(scores.performance));
    box.innerHTML = html;

    // Breakdown line + top contributor sit under the grid.
    var strip = document.getElementById("pageSnapshotFoot");
    if (strip) {
      var chipHtml = '<span class="dom-size-chip">' + (dom.totalElements || 0).toLocaleString() + ' element nodes</span>'
        + '<span class="dom-size-chip">' + (dom.textNodes || 0).toLocaleString() + ' text nodes</span>'
        + '<span class="dom-size-chip">' + (dom.commentNodes || 0).toLocaleString() + ' comments</span>'
        + '<span class="dom-size-chip">' + nodeStatusLabel(nodeStatus) + '</span>';
      strip.innerHTML = chipHtml;
    }
  }

  function getScoreColorClass(score) {
    if (score >= 80) return "green";
    if (score >= 50) return "yellow";
    return "red";
  }

  function nodeStatusLabel(status) {
    if (status === "green") return "Lean DOM";
    if (status === "yellow") return "Heavy DOM";
    return "Very large DOM";
  }

  // ============================================
  // ELEMENTOR (WordPress page builder) ANALYSIS
  // ============================================
  function renderElementor(el) {
    var card = document.getElementById("elementorCard");
    var box = document.getElementById("elementorBox");
    var cardShown = el && el.detected;
    if (card) card.classList.toggle("hidden", !cardShown);
    if (!cardShown || !box) return;

    var level = el.excessive && el.excessive.level ? el.excessive.level : "good";
    var icons = { critical: "\u26A0\uFE0F", warn: "\u26A0\uFE0F", good: "\u2705" };
    var levelTitles = { critical: "Excessive Elementor markup", warn: "Heavy Elementor markup", good: "Healthy Elementor markup" };

    var html = '<div class="elementor-banner ' + level + '">'
      + '<span class="elementor-banner-icon">' + (icons[level] || "") + '</span>'
      + '<div class="elementor-banner-body">'
      + '<div class="elementor-banner-title">' + levelTitles[level] + '</div>'
      + '<div class="elementor-banner-text">' + escapeHtml(el.excessive ? el.excessive.message : "") + '</div>'
      + '</div></div>';

    html += '<div class="stat-grid">';
    html += statItem("Total Elementor containers", el.containers.toLocaleString(), getSeverityClassInv(el.containers, 100, 180, 400));
    html += statItem("Nested containers", el.nestedContainers.toLocaleString(), getSeverityClassInv(el.nestedContainers, 60, 120, 250));
    html += statItem("Max container nesting", el.maxNesting + " levels", getSeverityClassInv(el.maxNesting, 4, 8, 12));
    html += statItem("Deeply nested (\u2265 8)", el.deepContainers.toLocaleString(), el.deepContainers > 0 ? "yellow" : "green");
    html += statItem("% of page DOM", "~" + el.share + "%", getSeverityClassInv(el.share, 20, 50, 70));
    html += statItem("Markup type", el.signal, "");
    html += statItem("Flexbox containers (.e-con)", el.flexContainers.toLocaleString(), "");
    html += statItem("Legacy sections", el.legacySections.toLocaleString(), "");
    html += statItem("Top section is Elementor", el.topSectionIsElementor ? "Yes" : "No", el.topSectionIsElementor ? "yellow" : "green");
    html += '</div>';

    if (el.heaviest && el.heaviest.length) {
      html += '<div class="elementor-heavy"><div class="el-heavy-label">Heaviest Elementor containers</div>';
      el.heaviest.forEach(function (x) {
        html += '<div class="el-heavy-item">'
          + '<span class="el-heavy-name">' + escapeHtml(x.label) + '</span>'
          + '<span class="el-heavy-meta">' + x.elements.toLocaleString() + ' elements \u00B7 ' + x.children + ' children \u00B7 ' + (x.nesting > 0 ? x.nesting + " container-nesting" : "top-level") + '</span>'
          + '</div>';
      });
      html += '</div>';
    }
    if (el.deepNestingTop && el.deepNestingTop.length) {
      html += '<div class="elementor-heavy"><div class="el-heavy-label">Most deeply nested containers</div>';
      el.deepNestingTop.forEach(function (name) {
        html += '<div class="el-heavy-item"><span class="el-heavy-name">' + escapeHtml(name) + '</span><span class="el-heavy-meta">nesting \u2265 8</span></div>';
      });
      html += '</div>';
    }
    box.innerHTML = html;
  }

  // ============================================
  // DOM HOTSPOTS (largest sections + track/locate)
  // ============================================
  function renderHotspots(hotspots) {
    lastHotspots = hotspots || [];
    var box = document.getElementById("domHotspots");
    if (!hotspots || hotspots.length === 0) {
      hideTrackDetail();
      box.innerHTML = '<div class="empty-state">Page has a fairly balanced DOM \u2014 no oversized sections found.</div>';
      return;
    }
    var html = "";
    hotspots.forEach(function (h, i) {
      var meta = (h.nodes ? h.nodes.toLocaleString() + " DOM nodes" : h.count.toLocaleString() + " elements")
        + " \u00B7 " + h.share + "% of page \u00B7 " + h.count.toLocaleString() + " elements";
      if (h.childCount != null) meta += " \u00B7 " + h.childCount + " direct children";
      if (h.depth != null) meta += " \u00B7 depth " + h.depth;
      if (h.elementorContainers) meta += " \u00B7 " + h.elementorContainers + " Elementor containers";

      // Tag mix: what the subtree is actually made of.
      var mix = "";
      if (h.topTags && h.topTags.length) {
        mix = '<div class="hs-chips">';
        h.topTags.forEach(function (t) {
          mix += '<span class="hs-chip">' + escapeHtml(t.tag) + ' \u00D7 ' + t.count.toLocaleString() + '</span>';
        });
        if (h.repeated) {
          mix += '<span class="hs-chip chip-rep" title="Most repeated direct-child markup">' + escapeHtml(h.repeated.pattern) + ' \u00D7 ' + h.repeated.count + '</span>';
        }
        if (h.elementorContainers) {
          mix += '<span class="hs-chip chip-ele">Elementor \u00D7 ' + h.elementorContainers + '</span>';
        }
        mix += '</div>';
      }

      var badge = (h.excessive && h.excessive !== "good")
        ? '<span class="hotspot-badge ' + h.excessive + '">' + (h.excessive === "critical" ? "\u26A0\uFE0F Excessive DOM" : "Large DOM") + '</span>'
        : "";

      html += '<div class="hotspot-item' + (h.elementor ? " hotspot-elementor" : "")
        + (h.excessive && h.excessive !== "good" ? " hotspot-" + h.excessive : "") + '">'
        + '<span class="hotspot-rank">' + (i + 1) + '</span>'
        + '<div class="hotspot-info">'
        + '<div class="hotspot-label">' + escapeHtml(h.label) + badge + '</div>'
        + '<div class="hotspot-meta">' + escapeHtml(meta) + '</div>'
        + '<div class="share-bar"><div class="share-bar-fill ' + shareColor(h.share) + '" style="width:' + Math.min(100, h.share) + '%"></div></div>'
        + (h.cause ? '<div class="hotspot-cause">' + escapeHtml(h.cause) + '</div>' : '')
        + (mix ? mix : '')
        + (h.recommendation ? '<div class="hotspot-rec" title="How to reduce DOM in this section">\u2192 ' + escapeHtml(h.recommendation) + '</div>' : '')
        + '</div>'
        + '<div class="hotspot-actions">'
        + '<button class="btn-track' + (trackedIndex === i ? ' tracked' : '') + '" data-index="' + i + '" title="Pin an outline + details on this section">' + (trackedIndex === i ? 'Untrack' : 'Track') + '</button>'
        + '<button class="btn-locate" data-index="' + i + '" title="Flash this section on the page">Locate</button>'
        + '</div></div>';
    });
    box.innerHTML = html;

    box.querySelectorAll(".btn-locate").forEach(function (btn) {
      btn.addEventListener("click", function () {
        msgTab({ action: "highlight", index: parseInt(btn.getAttribute("data-index"), 10) });
      });
    });
  }

  function shareColor(share) {
    if (share >= 30) return "fill-red";
    if (share >= 15) return "fill-yellow";
    return "fill-green";
  }

  // ---- Track / untrack section pinpointing ----
  // Sends a message to the active page's content script. If the script is not
  // present it is injected once and the send is retried, so commands like
  // "Track" / "Log console report" never silently no-op on a fresh reload.
  function msgTab(payload, cb) {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (!tabs.length) {
        if (cb) cb(new Error("No active tab available."));
        return;
      }
      var tabId = tabs[0].id;
      var injectedOnce = false;
      var attempt = function () {
        chrome.tabs.sendMessage(tabId, payload, function () {
          if (chrome.runtime.lastError) {
            if (!injectedOnce) {
              injectedOnce = true;
              chrome.scripting.executeScript({ target: { tabId: tabId }, files: ["content.js"] }, function () {
                if (chrome.runtime.lastError) {
                  if (cb) cb(new Error("Cannot reach this page. Run an analysis first."));
                  return;
                }
                setTimeout(function () {
                  chrome.tabs.sendMessage(tabId, payload, function () {
                    if (chrome.runtime.lastError) {
                      if (cb) cb(new Error("Cannot reach this page. Run an analysis first."));
                      return;
                    }
                    if (cb) cb();
                  });
                }, 80);
              });
            } else {
              if (cb) cb(new Error("Cannot reach this page. Run an analysis first."));
            }
            return;
          }
          if (cb) cb();
        });
      };
      attempt();
    });
  }

  function setTrackedState(index, on) {
    trackedIndex = on ? index : -1;
    document.querySelectorAll(".btn-track").forEach(function (b) {
      var idx = parseInt(b.getAttribute("data-index"), 10);
      if (idx === index) {
        b.classList.toggle("tracked", on);
        b.textContent = on ? "Untrack" : "Track";
        b.setAttribute("aria-pressed", on ? "true" : "false");
      } else {
        b.classList.remove("tracked");
        b.textContent = "Track";
        b.setAttribute("aria-pressed", "false");
      }
    });
  }

  function hideTrackDetail() {
    var st = document.getElementById("hotspotStatus");
    if (st) { st.classList.add("hidden"); st.innerHTML = ""; }
  }

  function showTrackDetail(entry) {
    var st = document.getElementById("hotspotStatus");
    if (!st) return;
    if (!entry) { hideTrackDetail(); return; }
    var rows = '<div class="hs-row"><span>DOM nodes</span><b>' + (entry.nodes || entry.count || 0).toLocaleString() + '</b></div>'
      + '<div class="hs-row"><span>Elements</span><b>' + (entry.count || 0).toLocaleString() + '</b></div>'
      + '<div class="hs-row"><span>Page share</span><b>' + (entry.share != null ? entry.share + "%" : "\u2014") + '</b></div>'
      + '<div class="hs-row"><span>Nesting depth</span><b>' + (entry.depth != null ? entry.depth : 0) + ' levels</b></div>'
      + '<div class="hs-row"><span>Direct children</span><b>' + (entry.childCount != null ? entry.childCount : 0) + '</b></div>';
    if (entry.elementorContainers) {
      rows += '<div class="hs-row"><span>Elementor containers</span><b>' + entry.elementorContainers + '</b></div>';
    }
    if (entry.repeated) {
      rows += '<div class="hs-row"><span>Repeating markup</span><b>&lt;' + escapeHtml(entry.repeated.pattern) + '&gt; \u00D7 ' + entry.repeated.count + '</b></div>';
    }
    st.className = "hotspot-status";
    st.innerHTML = '<div class="hs-head"><span class="hs-eye">\uD83D\uDD2E</span><span class="hs-name">' + escapeHtml(entry.label) + '</span><span class="hs-tag">TRACKED</span></div>'
      + '<div class="hs-rows">' + rows + '</div>'
      + (entry.cause ? '<div class="hs-cause">' + escapeHtml(entry.cause) + '</div>' : '')
      + (entry.recommendation ? '<div class="hs-rec">\u2014 ' + escapeHtml(entry.recommendation) + '</div>' : '')
      + '<button type="button" class="btn-ghost" id="hsUntrack">Stop tracking</button>';
    var ub = document.getElementById("hsUntrack");
    if (ub) ub.addEventListener("click", stopTrackingUi);
  }

  function stopTrackingUi() {
    var idx = trackedIndex;
    if (idx >= 0) {
      msgTab({ action: "untrackSection" }, function (err) {
        if (!err) return;
        var st = document.getElementById("hotspotStatus");
        if (st) { st.className = "hotspot-status"; st.textContent = "Could not untrack this section: " + err.message; }
      });
    }
    setTrackedState(idx, false);
    hideTrackDetail();
  }

  function wireTrackButtons(root) {
    root.querySelectorAll(".btn-track").forEach(function (btn) {
      // Static buttons persist across rescans — bind once so Track doesn't
      // toggle twice. Injected hotspot buttons are fresh nodes each render.
      if (btn.getAttribute("data-bound")) return;
      btn.setAttribute("data-bound", "1");
      btn.addEventListener("click", function () {
        var index = parseInt(btn.getAttribute("data-index"), 10);
        var on = btn.classList.contains("tracked");
        if (on) {
          stopTrackingUi();
          return;
        }
        var entry = lastHotspots[index] || null;
        msgTab({ action: "trackSection", index: index, data: entry }, function (err) {
          if (err) {
            var st = document.getElementById("hotspotStatus");
            if (st) { st.className = "hotspot-status"; st.textContent = "Could not track this section: " + err.message; }
            return;
          }
          setTrackedState(index, true);
          showTrackDetail(entry);
        });
      });
    });
  }

  // ============================================
  // CONSOLE FIX GUIDE
  // ============================================
  function renderConsoleGuide() {
    var box = document.getElementById("consoleGuide");
    var snippets = [
      {
        title: "Find the 10 largest DOM subtrees",
        code: "[...document.querySelectorAll('*')]\n  .map(el => ({ count: el.querySelectorAll('*').length, tag: el.tagName.toLowerCase(), id: el.id }))\n  .sort((a, b) => b.count - a.count)\n  .slice(0, 10);"
      },
      {
        title: "Find duplicate IDs",
        code: "[...document.querySelectorAll('[id]')]\n  .reduce((m, el) => (m[el.id] = (m[el.id] || 0) + 1, m), {});"
      },
      {
        title: "Count elements nested deeper than 20 levels",
        code: "[...document.querySelectorAll('*')]\n  .filter(el => { let d = 0, n = el; while (n.parentElement) { d++; n = n.parentElement; } return d > 20; }).length;"
      },
      {
        title: "Remove empty wrappers (review before running)",
        code: "[...document.querySelectorAll('div, section, span')]\n  .filter(el => !el.textContent.trim() && !el.querySelectorAll('*').length\n    && !el.querySelector('img, svg, canvas, iframe, input'))\n  .forEach(el => el.remove());"
      },
      {
        title: "Audit images missing ALT text",
        code: "[...document.querySelectorAll('img')]\n  .filter(img => !img.alt)\n  .map(img => img.src.split('/').pop());"
      }
    ];

    var html = "";
    snippets.forEach(function (s) {
      html += '<div class="snip">'
        + '<div class="snip-head"><span class="snip-title">' + escapeHtml(s.title) + '</span>'
        + '<button class="btn-copy">Copy</button></div>'
        + '<pre class="snip-code">' + escapeHtml(s.code) + '</pre>'
        + '</div>';
    });
    box.innerHTML = html;

    box.querySelectorAll(".btn-copy").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var code = btn.parentElement.parentElement.querySelector(".snip-code").textContent;
        copyText(code, btn);
      });
    });
  }

  function copyText(text, btn) {
    var done = function (ok) {
      if (btn) {
        var old = btn.textContent;
        btn.textContent = ok ? "Copied \u2713" : "Copy failed";
        btn.classList.add(ok ? "copied" : "copy-failed");
        setTimeout(function () { btn.textContent = old; btn.classList.remove("copied", "copy-failed"); }, 1500);
      }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }).catch(function () { done(fallbackCopy(text)); });
    } else {
      done(fallbackCopy(text));
    }
  }

  function fallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }

  // ============================================
  // PERFORMANCE TAB
  // ============================================
  function renderPerformance(perf) {
    // ---- Core Web Vitals tiles ----
    var cwv = [
      { key: "lcp", label: "LCP", full: "Largest Contentful Paint", value: perf.largestContentfulPaint, unit: "s", cls_: null, good: 2500, bad: 4000, fmt: function (v) { return (v / 1000).toFixed(2); } },
      { key: "inp", label: "INP", full: "Interaction to Next Paint", value: perf.interactionToNextPaint, unit: "ms", cls_: null, good: 200, bad: 500, fmt: function (v) { return String(v); } },
      { key: "cls", label: "CLS", full: "Cumulative Layout Shift", value: perf.cumulativeLayoutShift, unit: "", cls_: null, good: 0.1, bad: 0.25, fmt: function (v) { return Number(v).toFixed(3); } }
    ];
    var cwvHtml = "";
    cwv.forEach(function (m) {
      var ok = m.value !== null && m.value !== undefined;
      var cls = ok ? (m.value <= m.good ? "green" : m.value <= m.bad ? "yellow" : "red") : "na";
      cwvHtml += '<div class="cwv-tile ' + (ok ? m.key : "") + '">'
        + '<div class="cwv-label"><b>' + m.label + '</b><span title="' + m.full + '">' + m.full + '</span></div>'
        + '<div class="cwv-value ' + cls + '">' + (ok ? m.fmt(m.value) : "\u2014") + (ok && m.unit ? '<small>' + m.unit + '</small>' : '') + '</div>'
        + '<div class="cwv-verdict' + (ok ? "" : " na-text") + '">' + cwvVerdict(m, ok) + '</div>'
        + '</div>';
    });
    cwvHtml += '<div class="cwv-note">Measured from the live page at scan time. ' + naNote(perf) + '</div>';
    document.getElementById("perfCWV").innerHTML = cwvHtml;

    // ---- Timing ----
    var timingHtml = "";
    timingHtml += perfRow("Server response (TTFB)", perf.ttfb, "ms", getPerfStatus(perf.ttfb, 800, 1800));
    timingHtml += perfRow("First Contentful Paint", perf.firstContentfulPaint, "s", getPerfStatus(perf.firstContentfulPaint, 1800, 3000));
    timingHtml += perfRow("DOMContentLoaded", perf.domContentLoaded, "s", getPerfStatus(perf.domContentLoaded, 1500, 3000));
    timingHtml += perfRow("Page load time", perf.loadTime, "s", getPerfStatus(perf.loadTime, 1500, 3000));
    timingHtml += perfRow("First Paint", perf.firstPaint, "s", getPerfStatus(perf.firstPaint, 1500, 2500));
    document.getElementById("perfTiming").innerHTML = timingHtml;

    // ---- Network ----
    var netHtml = "";
    netHtml += perfRow("Requests", perf.resourceCount, "", perf.resourceCount > 100 ? "red" : perf.resourceCount > 60 ? "yellow" : "green");
    netHtml += statRow("Total transferred", perf.totalTransferred, "");
    netHtml += statRow("Document (HTML)", perf.documentBytes > 0 ? formatBytes(perf.documentBytes) : "n/a", "");
    netHtml += statRow("All resources", perf.resourceBytes > 0 ? formatBytes(perf.resourceBytes) : "n/a", "");
    netHtml += perfRow("Third-party requests", perf.thirdPartyCount, "", perf.thirdPartyCount > 20 ? "yellow" : perf.thirdPartyCount > 10 ? "green" : "green");
    document.getElementById("perfNetwork").innerHTML = netHtml;

    // ---- Resource payloads by type ----
    var resHtml = "";
    resHtml += resRow("JavaScript", perf.jsCount, perf.jsBytes, perByteStatus(perf.jsBytes, 600 * 1024, 1024 * 1024));
    resHtml += resRow("CSS", perf.cssCount, perf.cssBytes, resStatus(perf.cssBytes, 300 * 1024, 600 * 1024));
    resHtml += resRow("Images", perf.imageCount, perf.imageBytes, resStatus(perf.imageBytes, 2 * 1024 * 1024, 4 * 1024 * 1024));
    resHtml += resRow("Fonts", perf.fontCount, perf.fontBytes, resStatus(perf.fontBytes, 400 * 1024, 800 * 1024));
    resHtml += resRow("Media", perf.mediaCount, perf.mediaBytes, "");
    resHtml += resRow("Iframes", perf.iframeCount, null, "");
    resHtml += resRow("XHR / Fetch", perf.xhrCount, perf.xhrBytes, "");
    resHtml += resRow("Other", perf.otherCount, perf.otherBytes, "");
    document.getElementById("perfResources").innerHTML = resHtml;

    // ---- Issues ----
    var issueBox = document.getElementById("perfIssues");
    if (perf.issues && perf.issues.length > 0) {
      var issHtml = "";
      perf.issues.forEach(function (issue) {
        var iconClass = issue.level === "critical" ? "red" : "yellow";
        issHtml += '<div class="issue-item ' + issue.level + '">'
          + '<div class="issue-icon ' + iconClass + '">!</div>'
          + '<div class="issue-content">'
          + '<div class="issue-title">' + escapeHtml(issue.title) + '</div>'
          + '<div class="issue-desc">' + escapeHtml(issue.desc) + '</div>'
          + (issue.rec ? '<div class="issue-recommendation">Recommendation: ' + escapeHtml(issue.rec) + '</div>' : '')
          + '</div></div>';
      });
      issueBox.innerHTML = issHtml;
    } else {
      issueBox.innerHTML = '<div class="empty-state">No major performance issues detected so far.</div>';
    }

    // ---- Largest resources ----
    var largeEl = document.getElementById("perfLarge");
    if (perf.largeResources && perf.largeResources.length > 0) {
      var largeHtml = "";
      perf.largeResources.forEach(function (res) {
        largeHtml += '<div class="lr-item">'
          + '<span class="lr-name">' + escapeHtml(res.name) + '</span>'
          + '<span class="lr-meta">' + formatBytes(res.bytes) + ' transferred \u00B7 ' + escapeHtml(res.type) + '</span>'
          + '</div>';
      });
      largeEl.innerHTML = '<div class="perf-large-note">Resources over 200KB transferred.</div>' + largeHtml;
    } else {
      largeEl.innerHTML = '<div class="empty-state">No resources over 200KB transferred.</div>';
    }
  }

  function cwvVerdict(m, ok) {
    if (!ok) return "not available";
    if (m.value <= m.good) return "good";
    if (m.value <= m.bad) return "needs work";
    return "poor";
  }

  function naNote(perf) {
    var missing = [];
    if (perf.largestContentfulPaint === null) missing.push("LCP");
    if (perf.interactionToNextPaint === null) missing.push("INP");
    if (perf.cumulativeLayoutShift === null) missing.push("CLS");
    if (missing.length === 0) return "All three Core Web Vitals were measured.";
    return "Could not read " + missing.join(", ") + " \u2014 the page cleared or never reported those entries before this scan.";
  }

  function perfRow(label, val, unit, statusClass) {
    if (val === null || val === undefined) {
      return statRow(label, "Not available", "gray");
    }
    var display = unit === "s" ? (val / 1000).toFixed(2) + "s"
      : unit === "ms" ? val + "ms"
      : String(val);
    return statRow(label, display, statusClass || "");
  }

  function resRow(label, count, bytes, statusClass) {
    return statRow(label,
      count.toLocaleString() + (bytes ? " \u00B7 " + formatBytes(bytes) : ""),
      statusClass || "");
  }

  function resStatus(bytes, warn, bad) {
    if (bytes === null || bytes === undefined || !bytes) return "";
    if (bytes > bad) return "yellow";
    if (bytes > warn) return "yellow";
    return "green";
  }

  function perByteStatus(bytes, warn, bad) {
    if (!bytes) return "green";
    if (bytes > bad) return "red";
    if (bytes > warn) return "yellow";
    return "green";
  }

  // ============================================
  // SEO TAB
  // ============================================
  function renderSEO(seo, headings, seoScore) {
    // SEO Score
    seoScore = seoScore === undefined ? 0 : seoScore;

    document.getElementById("seoScore").innerHTML =
      '<div class="seo-score-value">' + seoScore + '</div>' +
      '<div><div class="seo-score-label">out of 100</div>' +
      '<div class="badge ' + (seoScore >= 80 ? 'badge-green' : seoScore >= 50 ? 'badge-yellow' : 'badge-red') + '">' +
      (seoScore >= 80 ? 'Good' : seoScore >= 50 ? 'Needs Work' : 'Poor') + '</div></div>';

    // Title & Meta
    var metaHtml = "";
    metaHtml += statRow("Title", seo.hasTitle ? seo.title + " (" + seo.titleLength + " chars)" : "Missing", seo.hasTitle ? (seo.titleOk ? "green" : "yellow") : "red");
    metaHtml += statRow("Meta Description", seo.hasDescription ? seo.description.substring(0, 80) + (seo.description.length > 80 ? "..." : "") + " (" + seo.descriptionLength + " chars)" : "Missing", seo.hasDescription ? (seo.descriptionOk ? "green" : "yellow") : "red");
    metaHtml += statRow("Canonical", seo.hasCanonical ? seo.canonical : "Missing", seo.hasCanonical ? "green" : "yellow");
    metaHtml += statRow("Multiple Canonicals", seo.multipleCanonicals ? "Yes (problem)" : "No", seo.multipleCanonicals ? "red" : "green");
    document.getElementById("seoMeta").innerHTML = metaHtml;

    // Open Graph
    var ogHtml = "";
    ogHtml += statRow("og:title", seo.hasOgTitle ? seo.ogTitle : "Missing", seo.hasOgTitle ? "green" : "yellow");
    ogHtml += statRow("og:description", seo.hasOgDescription ? (seo.ogDescription || "").substring(0, 60) : "Missing", seo.hasOgDescription ? "green" : "yellow");
    ogHtml += statRow("og:image", seo.hasOgImage ? "Present" : "Missing", seo.hasOgImage ? "green" : "yellow");
    ogHtml += statRow("og:url", seo.hasOgUrl ? "Present" : "Missing", seo.hasOgUrl ? "green" : "yellow");
    document.getElementById("seoOg").innerHTML = ogHtml;

    // Technical
    var techHtml = "";
    techHtml += statRow("Meta Robots", seo.robotsContent || "Not set", seo.hasNoindex ? "red" : "green");
    techHtml += statRow("noindex", seo.hasNoindex ? "Yes" : "No", seo.hasNoindex ? "red" : "green");
    techHtml += statRow("nofollow", seo.hasNofollow ? "Yes" : "No", seo.hasNofollow ? "yellow" : "green");
    techHtml += statRow("JSON-LD", seo.jsonLdCount > 0 ? seo.jsonLdCount + " block(s)" : "None", seo.jsonLdCount > 0 ? "green" : "gray");
    techHtml += statRow("Microdata", seo.microdataCount > 0 ? seo.microdataCount + " block(s)" : "None", seo.microdataCount > 0 ? "green" : "gray");
    document.getElementById("seoTechnical").innerHTML = techHtml;

    // Heading Hierarchy
    var headHtml = "";
    if (headings.headings.length === 0) {
      headHtml = '<div class="empty-state">No headings found on this page</div>';
    } else {
      headHtml += '<div style="margin-bottom: 8px;">';
      if (headings.issues.length > 0) {
        headings.issues.forEach(function (issue) {
          headHtml += '<div class="issue-item warning" style="margin-bottom: 4px;"><div class="issue-icon yellow">!</div><div class="issue-content"><div class="issue-desc">' + escapeHtml(issue) + '</div></div></div>';
        });
      } else {
        headHtml += '<div class="issue-item good"><div class="issue-icon green">\u2713</div><div class="issue-content"><div class="issue-title">Heading Hierarchy</div><div class="issue-desc">Proper heading structure detected</div></div></div>';
      }
      headHtml += '</div>';

      // Tree
      headHtml += '<div class="heading-tree">';
      headHtml += renderHeadingNode(headings.tree, 0);
      headHtml += '</div>';
    }
    document.getElementById("seoHeadings").innerHTML = headHtml;
  }

  function renderHeadingNode(nodes, indent) {
    var html = "";
    indent = indent || "";
    nodes.forEach(function (node, i) {
      var isLast = i === nodes.length - 1;
      var prefix = indent.length > 0 ? (isLast ? '\u2514\u2500\u2500 ' : '\u251C\u2500\u2500 ') : "";
      var childIndent = indent + (isLast ? '   ' : '\u2502  ');

      html += prefix + '<span class="heading-level">H' + node.level + '</span>';
      if (node.text) {
        html += ' <span class="heading-text">' + escapeHtml(node.text.substring(0, 60)) + '</span>';
      }
      html += '<br>';

      if (node.children && node.children.length > 0) {
        html += renderHeadingNode(node.children, childIndent);
      }
    });
    return html;
  }

  // ============================================
  // STRUCTURE TAB
  // ============================================
  function renderStructure(struct, forms, links, images) {
    // Landmarks
    var landHtml = "";
    landHtml += structItem("Header", struct.hasHeader);
    landHtml += structItem("Navigation", struct.hasNav);
    landHtml += structItem("Main", struct.hasMain);
    landHtml += structItem("Footer", struct.hasFooter);
    landHtml += structItem("Aside", struct.hasAside);
    landHtml += structItem("Sections (" + struct.hasSections + ")", struct.hasSections > 0);
    landHtml += structItem("Articles (" + struct.hasArticles + ")", struct.hasArticles > 0);
    landHtml += structItem("Search", struct.hasSearch);
    landHtml += structItem("Breadcrumbs", struct.hasBreadcrumbs);
    landHtml += structItem("Tables (" + struct.hasTables + ")", struct.hasTables > 0);
    landHtml += structItem("Lists (" + struct.hasLists + ")", struct.hasLists > 0);
    landHtml += structItem("Forms (" + (forms && forms.formCount ? forms.formCount : (struct.hasForms ? 1 : 0)) + ")", (forms && forms.formCount ? forms.formCount : (struct.hasForms ? 1 : 0)) > 0);
    landHtml += structItem("Videos", struct.hasVideos);
    landHtml += structItem("Iframes", struct.hasIframes);
    landHtml += structItem("Language: " + (struct.htmlLang || "Not set"), !!struct.htmlLang);
    document.getElementById("structLandmarks").innerHTML = landHtml;

    // Forms
    var formsHtml = "";
    formsHtml += statItem("Forms", forms.formCount, "");
    formsHtml += statItem("Inputs", forms.inputCount, "");
    formsHtml += statItem("Text Fields", forms.textFields, "");
    formsHtml += statItem("Email Fields", forms.emailFields, "");
    formsHtml += statItem("Password Fields", forms.passwordFields, "");
    formsHtml += statItem("Checkboxes", forms.checkboxes, "");
    formsHtml += statItem("Radio Buttons", forms.radioButtons, "");
    formsHtml += statItem("Selects", forms.selects, "");
    formsHtml += statItem("Textareas", forms.textareas, "");
    formsHtml += statItem("Submit Buttons", forms.submitButtons, "");
    formsHtml += statItem("Missing Labels", forms.missingLabels, forms.missingLabels > 0 ? "red" : "green");
    formsHtml += statItem("Required Fields", forms.requiredFields, "");
    document.getElementById("structForms").innerHTML = formsHtml;

    // Links
    var linksHtml = "";
    linksHtml += statItem("Total Links", links.total, "");
    linksHtml += statItem("Internal", links.internal, "");
    linksHtml += statItem("External", links.external, "");
    linksHtml += statItem("Empty Links", links.empty, links.empty > 0 ? "red" : "green");
    linksHtml += statItem("No Accessible Text", links.noAccessibleText, links.noAccessibleText > 0 ? "yellow" : "green");
    linksHtml += statItem('target="_blank"', links.targetBlank, "");
    linksHtml += statItem("nofollow", links.nofollow, "");
    linksHtml += statItem("sponsored", links.sponsored, "");
    linksHtml += statItem("ugc", links.ugc, "");
    document.getElementById("structLinks").innerHTML = linksHtml;

    // Images
    var imgHtml = "";
    imgHtml += statItem("Total Images", images.total, "");
    imgHtml += statItem("With Alt Text", images.withAlt, "green");
    imgHtml += statItem("Missing Alt", images.missingAlt, images.missingAlt > 0 ? "red" : "green");
    imgHtml += statItem("Empty Alt", images.emptyAlt, "");
    imgHtml += statItem("Lazy Loaded", images.lazyLoaded, "green");
    imgHtml += statItem("No Dimensions", images.noDimensions, images.noDimensions > 0 ? "yellow" : "");
    imgHtml += statItem("SVG", images.svgCount, "");
    imgHtml += statItem("Large (>2000px)", images.largeImages, images.largeImages > 0 ? "yellow" : "green");
    imgHtml += statItem("BG Images (sample)", images.bgImageSample, "");
    document.getElementById("structImages").innerHTML = imgHtml;
  }

  // ============================================
  // TECHNOLOGY TAB
  // ============================================
  // Group order for the categorized stack display (Wappalyzer-style tabs).
  var TECH_GROUP_ORDER = [
    ["cms", "CMS"],
    ["builders", "Website builders"],
    ["ecommerce", "E-commerce"],
    ["pageBuilders", "Page builders"],
    ["editors", "Editors"],
    ["frameworks", "JavaScript frameworks"],
    ["cssFrameworks", "CSS frameworks"],
    ["libraries", "Libraries"],
    ["fonts", "Fonts & icons"],
    ["seo", "SEO tools"],
    ["forms", "Forms"],
    ["performance", "Performance & caching"],
    ["analytics", "Analytics"],
    ["marketing", "Marketing & chat"],
    ["privacy", "Privacy & consent"],
    ["security", "Security"],
    ["cdns", "CDNs"],
    ["platforms", "Hosting & platforms"]
  ];

  function renderTechnology(tech) {
    var heroBox = document.getElementById("techDetected");
    var hero = tech.primary;

    if (hero) {
      var confClass = hero.confidence === "High" ? "badge-green" : hero.confidence === "Medium" ? "badge-yellow" : "badge-gray";
      var heroHtml = '<div class="tech-hero">'
        + '<div class="tech-hero-icon">' + escapeHtml(hero.name.charAt(0).toUpperCase()) + '</div>'
        + '<div class="tech-hero-main">'
        + '<div class="tech-hero-name">' + escapeHtml(hero.name) + '</div>'
        + '<div class="tech-hero-sub"><span class="tech-hero-cat">' + escapeHtml(hero.category || "Platform") + '</span>'
        + '<span class="badge ' + confClass + '">' + escapeHtml(hero.confidence) + ' confidence</span></div>';
      if (hero.evidence) heroHtml += '<div class="tech-hero-evidence">Detected via \u2014 ' + escapeHtml(hero.evidence) + '</div>';
      heroHtml += '</div></div>';
      heroBox.innerHTML = heroHtml;
    } else {
      heroBox.innerHTML = '<div class="tech-unavailable">No reliable platform detected \u2014 this site may use a custom or uncommon stack.</div>';
    }

    var box = document.getElementById("techStack");
    var groups = tech.groups || null;
    var html = "";

    if (groups) {
      // Grouped view: render each non-empty category with a Wappalyzer-style tab.
      TECH_GROUP_ORDER.forEach(function (pair) {
        var key = pair[0], label = pair[1];
        var items = (groups[key] || []).filter(function (t) { return !hero || t.name !== hero.name; });
        if (!items.length) return;
        html += '<div class="chip-group-label">' + escapeHtml(label) + '</div><div class="chip-row">';
        items.forEach(function (t) { html += techChip(t); });
        html += '</div>';
      });
      // Anything backbone's categorize missed.
      var leftover = tech.all.filter(function (t) { return !hero || t.name !== hero.name; }).filter(function (t) {
        return !groups.cms.some(function (o) { return o.name === t.name; })
          && !groups.builders.some(function (o) { return o.name === t.name; })
          && !groups.ecommerce.some(function (o) { return o.name === t.name; })
          && !groups.pageBuilders.some(function (o) { return o.name === t.name; })
          && !groups.editors.some(function (o) { return o.name === t.name; })
          && !groups.frameworks.some(function (o) { return o.name === t.name; })
          && !groups.cssFrameworks.some(function (o) { return o.name === t.name; })
          && !groups.libraries.some(function (o) { return o.name === t.name; })
          && !groups.fonts.some(function (o) { return o.name === t.name; })
          && !groups.seo.some(function (o) { return o.name === t.name; })
          && !groups.forms.some(function (o) { return o.name === t.name; })
          && !groups.performance.some(function (o) { return o.name === t.name; })
          && !groups.analytics.some(function (o) { return o.name === t.name; })
          && !groups.marketing.some(function (o) { return o.name === t.name; })
          && !groups.privacy.some(function (o) { return o.name === t.name; })
          && !groups.security.some(function (o) { return o.name === t.name; })
          && !groups.cdns.some(function (o) { return o.name === t.name; })
          && !groups.platforms.some(function (o) { return o.name === t.name; });
      });
      if (leftover.length) {
        html += '<div class="chip-group-label">Other</div><div class="chip-row">';
        leftover.forEach(function (t) { html += techChip(t); });
        html += '</div>';
      }
    } else {
      // Legacy fallback when the extension injects an older shape.
      var stack = [];
      var infra = [];
      tech.all.forEach(function (t) {
        if (hero && t.name === hero.name) return;
        if (t.confidence === "Low") return;
        if (t.category === "Analytics" || t.category === "CDN" || t.category === "Library") infra.push(t);
        else stack.push(t);
      });
      if (stack.length > 0) {
        html += '<div class="chip-group-label">Build</div><div class="chip-row">';
        stack.forEach(function (t) { html += techChip(t); });
        html += '</div>';
      }
      if (infra.length > 0) {
        html += '<div class="chip-group-label">Infrastructure & analytics</div><div class="chip-row">';
        infra.forEach(function (t) { html += techChip(t); });
        html += '</div>';
      }
    }

    if (!html) html = '<div class="empty-state">No additional technologies detected.</div>';
    box.innerHTML = html;
  }

  function techChip(t) {
    var cls = t.confidence === "High" ? "chip-high" : t.confidence === "Medium" ? "chip-med" : "chip-low";
    return '<span class="chip ' + cls + '" title="' + escapeHtml(t.category) + ' \u00B7 ' + escapeHtml(t.confidence) + ' confidence"><span class="chip-conf"></span>' + escapeHtml(t.name) + '<i class="chip-sub">' + escapeHtml(t.category) + '</i></span>';
  }

  // ============================================
  // ACCESSIBILITY TAB
  // ============================================
  function renderAccessibility(acc) {
    var statusEl = document.getElementById("accessStatus");
    var statusClass = acc.level === "good" ? "good" : acc.level === "warning" ? "warning" : "critical";
    var statusIcon = acc.level === "good" ? "\u2705" : acc.level === "warning" ? "\u26A0\uFE0F" : "\u274C";
    var statusText = acc.level === "good" ? "Good" : acc.level === "warning" ? "Needs Attention" : "Critical Issues";
    statusEl.className = "access-status " + statusClass;
    statusEl.innerHTML = '<div class="access-status-icon">' + statusIcon + '</div><div class="access-status-text">' + statusText + '</div>';

    var issuesHtml = "";
    if (acc.issues.length === 0) {
      issuesHtml = '<div class="empty-state">No accessibility issues detected in this quick scan</div>';
    } else {
      acc.issues.forEach(function (issue) {
        issuesHtml += '<div class="access-issue">';
        issuesHtml += '<div class="access-issue-type ' + issue.type + '"></div>';
        issuesHtml += '<div>' + escapeHtml(issue.message) + '</div>';
        issuesHtml += '</div>';
      });
    }
    document.getElementById("accessIssues").innerHTML = issuesHtml;

    var statsHtml = "";
    statsHtml += statItem("Images Missing Alt", acc.imagesMissingAlt, acc.imagesMissingAlt > 0 ? "red" : "green");
    statsHtml += statItem("Images Empty Alt", acc.imagesEmptyAlt, "");
    statsHtml += statItem("Buttons No Name", acc.buttonsNoName, acc.buttonsNoName > 0 ? "red" : "green");
    statsHtml += statItem("Links No Text", acc.linksNoText, acc.linksNoText > 0 ? "yellow" : "green");
    statsHtml += statItem("Inputs No Label", acc.inputsNoLabel, acc.inputsNoLabel > 0 ? "yellow" : "green");
    statsHtml += statItem("Iframes No Title", acc.iframesNoTitle, acc.iframesNoTitle > 0 ? "yellow" : "green");
    document.getElementById("accessStats").innerHTML = statsHtml;
  }

  // ============================================
  // DEBUG TAB
  // ============================================
  var DBG_MAX_RENDER = 40;
  var debugAuditRunning = false;

  function resetDebugPanel() {
    debugAuditRan = false;
    debugAuditRunning = false;
    var statusEl = document.getElementById("dbgStatus");
    var verdictEl = document.getElementById("dbgVerdict");
    var statsEl  = document.getElementById("dbgStats");
    var groupsEl = document.getElementById("dbgGroups");
    if (statusEl) statusEl.innerHTML = '<span class="dbg-idle">Click Run Audit to scan the live page.</span>';
    if (verdictEl) { verdictEl.className = "dbg-verdict"; verdictEl.innerHTML = ""; }
    if (statsEl)  statsEl.innerHTML = "";
    if (groupsEl) groupsEl.innerHTML = "";
  }

  function runDebugAudit() {
    if (debugAuditRunning) return;
    debugAuditRunning = true;
    var statusEl = document.getElementById("dbgStatus");
    if (statusEl) statusEl.innerHTML = '<span class="dbg-running">Scanning\u2026</span>';
    var btnEl = document.getElementById("btnDebugAudit");
    if (btnEl) { btnEl.disabled = true; btnEl.textContent = "Scanning\u2026"; }

    devModMsg({ action: "debugaudit" }, function (res, err) {
      debugAuditRunning = false;
      if (btnEl) { btnEl.disabled = false; btnEl.textContent = "Run Audit"; }
      if (err || !res) {
        showDbgError(err || "Could not reach the page. Run an analysis first.");
        return;
      }
      if (!res.success || res.error) {
        showDbgError(res.error || "Debug audit failed.");
        return;
      }
      debugAuditRan = true;
      renderDebugDashboard(res.data);
    });
  }

  function showDbgError(msg) {
    var statusEl = document.getElementById("dbgStatus");
    if (statusEl) statusEl.innerHTML = '<span class="dbg-error">' + escapeHtml(msg) + '</span>';
    var verdictEl = document.getElementById("dbgVerdict");
    if (verdictEl) { verdictEl.className = "dbg-verdict"; verdictEl.innerHTML = ""; }
    var statsEl  = document.getElementById("dbgStats");
    var groupsEl = document.getElementById("dbgGroups");
    if (statsEl)  statsEl.innerHTML = "";
    if (groupsEl) groupsEl.innerHTML = "";
  }

  function renderDebugDashboard(data) {
    var groups = data.groups || {};
    var dataLevel = data.level || "good";
    var totals = data.totals || {};
    // The page-side audit reports {level, totals}; keep renderDebugDashboard
    // working whether the payload carries the newer shape or the legacy
    // {verdict:{level,title,subtitle,critical,warnings,passed}} shape.
    var verdict = data.verdict && typeof data.verdict === "object" ? data.verdict : {
      level: dataLevel === "critical" ? "bad" : dataLevel === "warning" ? "warn" : "good",
      title: dataLevel === "critical" ? "Critical issues found" : dataLevel === "warning" ? "Attention needed" : "All clear",
      subtitle: (totals.errors ? totals.errors + " critical" : "No critical issues") + " \u00B7 " + (totals.warnings ? totals.warnings + " warning" + (totals.warnings === 1 ? "" : "s") : "no warnings") + " \u00B7 " + (totals.infos || 0) + " cues",
      critical: totals.errors || 0,
      warnings: totals.warnings || 0,
      passed: totals.infos || 0
    };
    var statusEl = document.getElementById("dbgStatus");
    var verdictEl = document.getElementById("dbgVerdict");
    var statsEl  = document.getElementById("dbgStats");
    var groupsEl = document.getElementById("dbgGroups");

    // Status line
    if (statusEl) {
      var ts = data.ts ? new Date(data.ts).toLocaleTimeString() : "";
      statusEl.innerHTML = '<span class="dbg-done">Scan complete</span>'
        + (ts ? '<span class="dbg-ts">' + ts + '</span>' : '');
    }

    // Verdict
    if (verdictEl) {
      var level = verdict.level || "good";
      var icons = { bad: "\uD83D\uDD34", warn: "\uD83D\uDFE1", good: "\uD83D\uDFE2" };
      verdictEl.className = "dbg-verdict dbg-v-" + level;
      verdictEl.innerHTML = '<span class="dbg-v-icon">' + (icons[level] || "") + '</span>'
        + '<div class="dbg-v-body">'
        + '<div class="dbg-v-title">' + escapeHtml(verdict.title || "Audit complete") + '</div>'
        + '<div class="dbg-v-sub">' + escapeHtml(verdict.subtitle || "") + '</div>'
        + '</div>';
    }

    // Stats strip
    if (statsEl) {
      var critical = verdict.critical || 0;
      var warnings = verdict.warnings || 0;
      var passed   = verdict.passed   || 0;
      statsEl.innerHTML = '<span class="dbg-stat dbg-stat-red">' + critical + ' critical</span>'
        + '<span class="dbg-stat dbg-stat-yellow">' + warnings + ' warnings</span>'
        + '<span class="dbg-stat dbg-stat-green">' + passed + ' passed</span>';
    }

    // Groups
    if (groupsEl) {
      var html = "";
      var GROUP_META = {
        a11y:   { title: "Accessibility",           icon: "\uD83C\uDFAF" },
        wp:     { title: "WordPress / Elementor",    icon: "\uD83C\uDFDB\uFE0F" },
        resp:   { title: "Responsive & Overflow",    icon: "\u2194\uFE0F" },
        media:  { title: "Media & Broken Assets",    icon: "\uD83D\uDDBC\uFE0F" }
      };
      var ORDER = ["a11y", "wp", "resp", "media"];
      ORDER.forEach(function (key) {
        var items = groups[key] || [];
        var meta = GROUP_META[key] || { title: key, icon: "" };
        html += '<div class="dbg-group">'
          + '<div class="dbg-group-head">'
          + '<span class="dbg-group-icon">' + meta.icon + '</span>'
          + '<span class="dbg-group-title">' + meta.title + '</span>'
          + '<span class="dbg-group-count">' + items.length + '</span>'
          + '</div>'
          + '<div class="dbg-group-body">';
        if (!items.length) {
          html += '<div class="dbg-item dbg-item-ok"><span class="dbg-item-icon">\u2705</span><span class="dbg-item-msg">No issues</span></div>';
        } else {
          var shown = items.slice(0, DBG_MAX_RENDER);
          shown.forEach(function (it, idx) {
            var sev = it.severity || "info";
            html += '<div class="dbg-item dbg-item-' + sev + '">'
              + '<span class="dbg-item-icon">' + sevIcon(sev) + '</span>'
              + '<span class="dbg-item-msg">' + escapeHtml(it.title || it.message || "") + '</span>'
              + (it.fix || it.note ? '<span class="dbg-item-note">' + escapeHtml(it.fix || it.note) + '</span>' : '')
              + '<button class="dbg-locate" data-idx="' + (typeof it.idx === "number" && it.idx >= 0 ? it.idx : -1) + '" title="Flash on page">\u25CE</button>'
              + '</div>';
          });
          if (items.length > DBG_MAX_RENDER) {
            html += '<div class="dbg-item dbg-item-more">+ ' + (items.length - DBG_MAX_RENDER) + ' more</div>';
          }
        }
        html += '</div></div>';
      });
      groupsEl.innerHTML = html;
      wireDebugLocate();
    }

    try {
      var dh = assessDebugHealth(data);
      showHealthVerdict(dh.state, dh.title, dh.msg);
    } catch (e) {}
  }

  function sevIcon(sev) {
    if (sev === "critical" || sev === "red")   return "\u26D4";
    if (sev === "warning"  || sev === "yellow") return "\u26A0\uFE0F";
    if (sev === "good"     || sev === "green")  return "\u2705";
    return "\u2139\uFE0F";
  }

  function wireDebugLocate() {
    var groupsEl = document.getElementById("dbgGroups");
    if (!groupsEl) return;
    if (groupsEl.getAttribute("data-wired")) return;
    groupsEl.setAttribute("data-wired", "1");
    groupsEl.addEventListener("click", function (e) {
      var btn = e.target.closest(".dbg-locate");
      if (!btn) return;
      var idx = parseInt(btn.getAttribute("data-idx"), 10);
      if (isNaN(idx) || idx < 0) return;
      devModMsg({ action: "debugLocate", index: idx }, function () {});
    });
  }

  // ============================================
  // DEVICES TAB (test on a device in a new tab)
  // ============================================
  var DEVICE_ICONS = {
    Desktop: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="13" rx="2"/><path d="M8 21h8M12 16v5"/></svg>',
    Laptop: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="11" rx="2"/><path d="M2 19h20"/></svg>',
    Tablet: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M11 18h2"/></svg>',
    Mobile: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/></svg>'
  };

  var DEVICE_GROUPS = [
    { cat: "Desktop", items: [
      { name: "Desktop", w: 1920, h: 1080 },
      { name: "Desktop", w: 1440, h: 900 },
      { name: "Desktop", w: 1366, h: 768 }
    ] },
    { cat: "Laptop", items: [
      { name: "Laptop", w: 1280, h: 800 },
      { name: "Laptop", w: 1366, h: 768 }
    ] },
    { cat: "Tablet", items: [
      { name: "Tablet", w: 1024, h: 1366 },
      { name: "Tablet", w: 768, h: 1024 }
    ] },
    { cat: "Mobile", items: [
      { name: "Mobile", w: 430, h: 932 },
      { name: "Mobile", w: 390, h: 844 },
      { name: "Mobile", w: 375, h: 812 }
    ] }
  ];

  function renderDevices(data) {
    var host = document.getElementById("deviceList");
    if (!host) return;
    var html = "";
    DEVICE_GROUPS.forEach(function (g) {
      html += '<div class="dev-cat"><span class="dev-cat-label">' + escapeHtml(g.cat) + '</span><div class="dev-options">';
      g.items.forEach(function (d) {
        html += '<button type="button" class="dev-option" data-w="' + d.w + '" data-h="' + d.h + '" data-name="' + escapeHtml(d.name) + '" title="Open ' + escapeHtml(d.name) + ' at ' + d.w + ' \u00D7 ' + d.h + ' in an Incognito tab">'
          + '<span class="dev-option-icon">' + DEVICE_ICONS[g.cat] + '</span>'
          + '<span class="dev-option-name">' + escapeHtml(d.name) + '</span>'
          + '<span class="dev-option-size">' + d.w + ' \u00D7 ' + d.h + '</span>'
          + '<span class="dev-option-open" aria-hidden="true">&#8599;</span></button>';
      });
      html += '</div></div>';
    });
    host.innerHTML = html;
    wireDevices();
  }

  function wireDevices() {
    var host = document.getElementById("deviceList");
    if (!host || host.getAttribute("data-wired") === "1") return;
    host.setAttribute("data-wired", "1");
    host.addEventListener("click", function (e) {
      var b = e.target && e.target.closest ? e.target.closest("button.dev-option") : null;
      if (!b) return;
      openDeviceInTab(
        parseInt(b.getAttribute("data-w"), 10),
        parseInt(b.getAttribute("data-h"), 10),
        b.getAttribute("data-name") || "Custom"
      );
    });
  }

  function deviceStatusMsg(msg) {
    var st = document.getElementById("deviceStatus");
    if (!st) return;
    if (msg) {
      st.textContent = msg;
      st.classList.remove("hidden");
    } else {
      st.classList.add("hidden");
      st.textContent = "";
    }
  }

  function deviceCategory(w) {
    if (w >= 1200) return "desktop";
    if (w >= 960) return "laptop";
    if (w >= 600) return "tablet";
    return "phone";
  }

  // Practical, size-aware things to check instead of a generic "is responsive?".
  function responsiveTips(w) {
    if (w <= 430) return [
      "Check the collapsed menu: does the hamburger open, and do fixed headers overlap content?",
      "Layouts should stack to one column, with grids and images going full width (max-width: 100%).",
      "Tap targets need to be at least 44 \u00D7 44 px with real spacing between them.",
      "Anything wider than " + w + "px on this page will force horizontal scroll \u2014 hunt for it."
    ];
    if (w <= 768) return [
      "This is where two-column grids usually start stacking \u2014 confirm the sidebar drops below the content.",
      "Test both portrait and landscape: nav should wrap or switch to a hamburger at " + w + "px, not overlap.",
      "Wide tables and row-style forms overflow at this width \u2014 wrap them in a scroll container.",
      "Check tap targets still pass and text stays readable without the user needing to zoom."
    ];
    if (w <= 1024) return [
      "Mid-range breakpoint: verify 3-column grids resize gracefully and gutters stay even down to " + w + "px.",
      "Make sure the layout adapts smoothly between " + w + "px and 1280px with no gaps, overlaps, or jumps.",
      "Watch sticky headers and footers \u2014 at this width scrollbars can shift the layout sideways."
    ];
    return [
      "Desktop: confirm the page uses a max-width container with even horizontal padding on large screens.",
      "Check nothing stretches awkwardly above 1440px \u2014 backgrounds vs. actual content width.",
      "Verify hover states and keyboard navigation; on ultra-wide screens keep content centered."
    ];
  }

  function renderDeviceTips(w, h, label, note) {
    var host = document.getElementById("deviceTips");
    if (!host) return;
    var html = "";
    if (label) {
      html += '<div class="dev-tips-title"><span class="dev-tips-chip">' + escapeHtml(deviceCategory(w)) + "</span> Practical checks for "
        + escapeHtml(String(label)) + " " + w + " \u00D7 " + h + "</div>";
    }
    if (note) {
      html += '<p class="dev-tips-note">' + escapeHtml(note) + "</p>";
    } else {
      html += '<ul class="dev-tips-list">';
      responsiveTips(w).forEach(function (t) { html += "<li>" + t + "</li>"; });
      html += "</ul>";
      html += '<p class="dev-tips-hint">The preview above is the live page scaled to a ' + w + "px viewport \u2014 the grey checkerboard sits beyond your current window, so that part of the device screen is simulated. A true-width test runs in the Incognito window.</p>";
    }
    host.innerHTML = html;
  }

  var MAX_DEVICE_PREVIEW_W = 520;
  var MAX_DEVICE_PREVIEW_H = 360;
  var MAX_DEVICE_PREVIEW_W_MAX = 760;
  var MAX_DEVICE_PREVIEW_H_MAX = 640;

  function showDevicePreview(w, h, label) {
    var stage = document.getElementById("devicePreview");
    var img = document.getElementById("devicePreviewImg");
    if (!stage || !img) return;
    if (!currentData || !currentData.page || !currentData.page.url) {
      stage.classList.add("hidden");
      renderDeviceTips(w, h, label, "Run a full analysis of the current page first \u2014 the live preview captures this tab.");
      return;
    }
    var frame = document.getElementById("devicePreviewFrame");
    if (frame) frame.className = "dev-preview-frame dev-pf-" + deviceCategory(w);
    stage.setAttribute("data-w", w);
    stage.setAttribute("data-h", h);
    stage.classList.remove("maximized");
    var maxBtn = document.getElementById("btnDevicePreviewMax");
    if (maxBtn) {
      maxBtn.classList.remove("hidden");
      maxBtn.setAttribute("aria-pressed", "false");
    }
    var cap = document.getElementById("devicePreviewCap");
    if (cap) cap.textContent = "Live preview \u2014 " + (label || "Custom") + " " + w + " \u00D7 " + h + " (scaled from the real page)";
    var loading = document.getElementById("devicePreviewLoading");
    if (loading) loading.classList.remove("hidden");
  }

  // Captures the DEVICE window (never the user's active tab) once its page has
  // finished loading, then paints the scaled preview into the stage.
  function captureDevicePreview(windowId, w, h, label) {
    var stage = document.getElementById("devicePreview");
    var img = document.getElementById("devicePreviewImg");
    var loading = document.getElementById("devicePreviewLoading");
    var fail = function (msg) {
      if (loading) loading.classList.add("hidden");
      if (stage) stage.classList.add("hidden");
      renderDeviceTips(w, h, label, "Live preview unavailable: " + msg);
    };
    if (!windowId) { fail("the device window could not be captured."); return; }
    if (!chrome.runtime || !chrome.runtime.sendMessage) { fail("could not contact the extension."); return; }
    chrome.runtime.sendMessage({ action: "deviceCapture", windowId: windowId, width: w, height: h }, function (res) {
      if (chrome.runtime.lastError || !res || !res.success || !res.image) {
        fail((chrome.runtime.lastError && chrome.runtime.lastError.message) || (res && res.error) || "could not capture the window yet.");
        return;
      }
      if (loading) loading.classList.add("hidden");
      img.src = res.image;
      var screen = document.getElementById("devicePreviewScreen");
      if (screen) {
        var scale = Math.min(MAX_DEVICE_PREVIEW_W / w, MAX_DEVICE_PREVIEW_H / h, 1);
        screen.style.width = Math.round(w * scale) + "px";
        screen.style.height = Math.round(h * scale) + "px";
        screen.style.aspectRatio = w + " / " + h;
      }
      stage.classList.remove("hidden");
      renderDeviceTips(w, h, label, null);
    });
  }

  function toggleDevicePreviewMax() {
    var stage = document.getElementById("devicePreview");
    var btn = document.getElementById("btnDevicePreviewMax");
    if (!stage) return;
    var maxed = stage.classList.toggle("maximized");
    var screen = document.getElementById("devicePreviewScreen");
    if (screen) {
      var w = parseInt(stage.getAttribute("data-w"), 10);
      var h = parseInt(stage.getAttribute("data-h"), 10);
      if (w > 0 && h > 0) {
        var maxW = maxed ? MAX_DEVICE_PREVIEW_W_MAX : MAX_DEVICE_PREVIEW_W;
        var maxH = maxed ? MAX_DEVICE_PREVIEW_H_MAX : MAX_DEVICE_PREVIEW_H;
        var scale = Math.min(maxW / w, maxH / h, 1);
        screen.style.width = Math.round(w * scale) + "px";
        screen.style.height = Math.round(h * scale) + "px";
      }
    }
    if (btn) {
      btn.setAttribute("aria-pressed", maxed ? "true" : "false");
      btn.title = maxed ? "Restore preview size" : "Maximize preview";
    }
  }

  // Opens device previews with a cache-busting query so the test never runs
  // against stale cached assets. Inserts ?nocache=true cleanly, before any #hash.
  function cacheBustUrl(url) {
    var stripped = String(url).replace(/#.*$/, "");
    var sep = stripped.indexOf("?") === -1 ? "?" : "&";
    return stripped + sep + "nocache=true";
  }

  function openDeviceInTab(w, h, label) {
    if (!currentData || !currentData.page || !currentData.page.url) {
      deviceStatusMsg("Run a page analysis first.");
      return;
    }
    var url = cacheBustUrl(currentData.page.url);
    var m = url.match(/^(https?):\/\/([^/]+)/i);
    if (!m) {
      deviceStatusMsg("Only webpages (http/https) can open in a device test window.");
      return;
    }
    var deviceLabel = (label || "Custom") + " " + w + " \u00D7 " + h;
    showDevicePreview(w, h, label || "Custom");
    var sendOpen = function (runCheck) {
      chrome.runtime.sendMessage({ action: "openDevicePreview", url: url, width: w, height: h, runCheck: runCheck }, function (res) {
        if (chrome.runtime.lastError) { deviceStatusMsg("Could not open the device test window."); return; }
        if (res && res.success === false) {
          deviceStatusMsg(res.error || "The device test window failed to open.");
        } else if (res && res.success) {
          deviceStatusMsg(runCheck
            ? "Testing " + deviceLabel + " \u2014 the responsive check is running in the new Incognito tab."
            : "Opened " + deviceLabel + " in a new Incognito tab.");
          if (typeof res.windowId === "number") captureDevicePreview(res.windowId, w, h, label || "Custom");
        }
      });
    };
    // Scoped permission: instead of one standing "all websites" grant, ask for
    // host access to the single site being tested. contains() also returns true
    // for users who already granted the old all-sites pattern, so nothing breaks.
    deviceStatusMsg("Opening " + deviceLabel + " in an Incognito tab\u2026");
    var testUrl = null;
    try { testUrl = new URL(url); } catch (e) { testUrl = null; }
    if (!testUrl) {
      deviceStatusMsg("Only webpages (http/https) can open in a device test window.");
      return;
    }
    var originPattern = testUrl.origin + "/*";
    chrome.permissions.contains({ origins: [originPattern] }, function (hasSite) {
      if (hasSite) { sendOpen(true); return; }
      chrome.permissions.request({ origins: [originPattern] }, function (granted) {
        if (granted) sendOpen(true);
        else {
          deviceStatusMsg("Site access not granted for " + testUrl.host + " \u2014 the Incognito tab opens, but the responsive check can't run there. Grant access to this site to allow the check.");
          sendOpen(false);
        }
      });
    });
  }

  // Surface background failures (e.g. extension not enabled for Incognito)
  // directly into the Devices tab status line.
  chrome.runtime.onMessage.addListener(function (msg, sender) {
    if (sender && sender.id !== chrome.runtime.id) return;
    if (msg && msg.action === "deviceCheckStatus") {
      if (msg.ok) {
        deviceStatusMsg("Responsive check completed in the Incognito tab.");
      } else {
        deviceStatusMsg((msg.error ? msg.error + " " : "") + "Open the Extensions page and enable \u201CAllow in Incognito\u201D for this extension, then run the test again.");
      }
    }
    if (msg && msg.action === "scriptsChanged" && scriptLive && scriptLive.on) {
      var srcTab = sender && sender.tab ? sender.tab.id : null;
      devModMsg({ action: "analyzescripts" }, function (res) {
        if (!res || !res.success) return;
        scriptLive.data = res.data;
        renderScriptResults(res.data);
      }, srcTab);
    }
    if (msg && msg.action === "crawlProgress") {
      var cst = document.getElementById("crawlStatus");
      if (!cst) return;
      var phase = msg.phase;
      if (phase === "page") {
        var p = (msg.done || 0) + 1;
        cst.className = "audit-status visible";
        cst.textContent = "Scanning page " + p + " of " + (msg.total || "?") + " \u2014 " + (msg.currentTitle || msg.currentUrl || "Loading\u2026") + (msg.failed ? " (" + msg.failed + " unreachable)" : "");
      } else if (phase === "probe") {
        cst.className = "audit-status visible";
        cst.textContent = "Verifying " + ((msg.extra && msg.extra.links) || 0) + " links and " + ((msg.extra && msg.extra.images) || 0) + " media URLs\u2026";
      } else if (phase === "done") {
        cst.className = "audit-status visible";
        cst.textContent = "Scan complete \u2014 building the report\u2026";
      } else if (phase === "status" && msg.text) {
        cst.className = "audit-status visible";
        cst.textContent = msg.text;
      } else if (phase === "start") {
        cst.className = "audit-status visible";
        cst.textContent = "Scan started \u2014 loading the site\u2026";
      }
    }
  });

  // ---- Custom size wiring (idempotent) ----
  var btnDeviceApply = document.getElementById("btnDeviceApply");
  if (btnDeviceApply && !btnDeviceApply.getAttribute("data-wired")) {
    btnDeviceApply.setAttribute("data-wired", "1");
    var applyCustom = function () {
      var w = parseInt(document.getElementById("deviceW").value, 10);
      var h = parseInt(document.getElementById("deviceH").value, 10);
      if (!w || !h || w < 240 || h < 320 || w > 5120 || h > 4096) {
        deviceStatusMsg("Custom size must be 240\u20135120 \u00D7 320\u20134096 px.");
        return;
      }
      openDeviceInTab(w, h, "Custom");
    };
    btnDeviceApply.addEventListener("click", applyCustom);
    ["deviceW", "deviceH"].forEach(function (id) {
      var inp = document.getElementById(id);
      if (inp) inp.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); applyCustom(); }
      });
    });
  }

  // ---- Device preview maximize / restore ----
  var btnDeviceMax = document.getElementById("btnDevicePreviewMax");
  if (btnDeviceMax && !btnDeviceMax.getAttribute("data-wired")) {
    btnDeviceMax.setAttribute("data-wired", "1");
    btnDeviceMax.addEventListener("click", toggleDevicePreviewMax);
  }

  // ============================================
  // HELPERS
  // ============================================
  function formatBytes(bytes) {
    if (bytes === null || bytes === undefined || !isFinite(bytes) || bytes <= 0) return "0 B";
    var units = ["B", "KB", "MB", "GB"];
    var i = 0;
    var v = bytes;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    var decimals = v >= 100 ? 0 : v >= 10 ? 1 : 2;
    return v.toFixed(decimals) + " " + units[i];
  }

  function statItem(label, value, colorClass) {
    return '<div class="stat-item"><span class="stat-label">' + escapeHtml(String(label)) + '</span><span class="stat-value ' + (colorClass || '') + '">' + escapeHtml(String(value)) + '</span></div>';
  }

  function statRow(label, value, colorClass) {
    return '<div class="stat-row"><span class="stat-row-label">' + escapeHtml(String(label)) + '</span><span class="stat-row-value ' + (colorClass || '') + '">' + escapeHtml(String(value)) + '</span></div>';
  }

  function structItem(label, present) {
    return '<div class="struct-item"><span class="struct-icon">' + (present ? "\u2705" : "\u274C") + '</span><span class="struct-label">' + escapeHtml(label) + '</span></div>';
  }

  function getScoreColor(score) {
    if (score >= 80) return "#059669";
    if (score >= 50) return "#d97706";
    return "#dc2626";
  }

  function getSeverityClassInv(val, good, warn, bad) {
    if (val >= bad) return "red";
    if (val >= warn) return "yellow";
    return "green";
  }

  function getPerfStatus(val, goodThreshold, badThreshold) {
    if (val === null) return "";
    if (val <= goodThreshold) return "green";
    if (val <= badThreshold) return "yellow";
    return "red";
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  // ============================================
  // DEV-MOD: link checker, typography, style mark
  // ============================================

  function locateOnActiveTab(selector, cb) {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (!tabs.length) {
        if (cb) cb(null, "No active tab available.");
        return;
      }
      var locateFn = function (sel) {
        var el = null;
        try { el = document.querySelector(sel); } catch (e) { el = null; }
        if (!el) return { success: false, error: "Element not found on the page." };
        try { el.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (e) {}
        setTimeout(function () {
          var r;
          try { r = el.getBoundingClientRect(); } catch (e) { return; }
          var ov = document.createElement("div");
          ov.style.cssText = "position:fixed;z-index:2147483647;pointer-events:none;border:3px solid #ef4444;background:rgba(239,68,68,0.08);border-radius:4px;transition:opacity .6s ease;";
          ov.style.left = r.left + "px";
          ov.style.top = r.top + "px";
          ov.style.width = r.width + "px";
          ov.style.height = r.height + "px";
          document.body.appendChild(ov);
          setTimeout(function () { ov.style.opacity = "0"; }, 2200);
          setTimeout(function () { if (ov.parentNode) { ov.parentNode.removeChild(ov); } }, 3000);
        }, 140);
        return { success: true };
      };
      chrome.scripting.executeScript({ target: { tabId: tabs[0].id }, func: locateFn, args: [selector] }, function (results) {
        if (chrome.runtime.lastError) {
          devModMsg({ action: "locateLink", selector: selector }, cb);
          return;
        }
        if (cb) cb(results && results[0] && results[0].result, null);
      });
    });
  }

  function devModMsg(payload, cb, tabIdOverride) {
    var sendTo = function (tabId) {
      var injectedOnce = false;
      var attempt = function () {
        chrome.tabs.sendMessage(tabId, payload, function (res) {
          if (chrome.runtime.lastError) {
            if (!injectedOnce) {
              injectedOnce = true;
              chrome.scripting.executeScript({ target: { tabId: tabId }, files: ["content.js"] }, function () {
                if (chrome.runtime.lastError) {
                  if (cb) cb(null, chrome.runtime.lastError.message || "Cannot reach this page. Run an analysis first.");
                  return;
                }
                setTimeout(function () {
                  chrome.tabs.sendMessage(tabId, payload, function (res2) {
                    if (chrome.runtime.lastError) {
                      if (cb) cb(null, "Cannot reach this page. Run an analysis first.");
                      return;
                    }
                    if (cb) cb(res2, null);
                  });
                }, 80);
              });
            } else {
              if (cb) cb(null, "Cannot reach this page. Run an analysis first.");
            }
            return;
          }
          if (cb) cb(res, null);
        });
      };
      attempt();
    };
    if (tabIdOverride) { sendTo(tabIdOverride); return; }
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (!tabs.length) {
        if (cb) cb(null, "No active tab available.");
        return;
      }
      sendTo(tabs[0].id);
    });
  }

  function devmodStatus(id, msg, kind) {
    var st = document.getElementById(id);
    if (!st) return;
    if (msg) {
      st.textContent = msg;
      st.className = "devmod-status" + (kind ? " " + kind : "");
    } else {
      st.className = "devmod-status hidden";
      st.textContent = "";
    }
  }

  var LINK_FILTERS = [
    { id: "all", label: "All" },
    { id: "valid", label: "Valid" },
    { id: "broken", label: "Broken" },
    { id: "redirect", label: "Redirects" },
    { id: "unverified", label: "Unable to verify" }
  ];

  var LINK_STATUS_META = {
    valid: { label: "Valid", cls: "ok" },
    broken: { label: "Broken", cls: "bad" },
    redirect: { label: "Redirect", cls: "warn" },
    unverified: { label: "Unable to verify", cls: "grey" }
  };

  function isWebUrl(url) {
    return /^https?:\/\//i.test(String(url || ""));
  }

  // Only ever open http/https URLs. Link-finder data comes from arbitrary web
  // pages, so javascript:/data:/mailto: hrefs must never reach chrome.tabs.create.
  function openUrlInNewTab(url) {
    var u = String(url || "");
    if (!isWebUrl(u)) return;
    try {
      chrome.tabs.create({ url: u });
    } catch (e) { /* noop */ }
  }

  function popupCopy(text, cb) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:0;left:-9999px;opacity:0;width:1px;height:1px;";
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    if (cb) cb(ok);
  }

  var lastLinkResults = null;
  var linkFilter = "all";

  function locateLinkRow(item, statusId) {
    var sel = item.getAttribute("data-selector");
    if (!sel) return;
    devmodStatus(statusId, "Locating element\u2026", "busy");
    item.classList.add("locating");
    locateOnActiveTab(sel, function (res, err) {
      item.classList.remove("locating");
      if (err || !res || !res.success) {
        devmodStatus(statusId, (err || (res && res.error)) || "Could not locate the element.", "error");
        return;
      }
      devmodStatus(statusId, "Located on the page \u2014 highlighted.", "ok");
    });
  }

// The Broken URL Checker surfaces ONLY genuine failures: a link whose href is
// a single "#" (a placeholder that can open nothing), or a URL whose fetch
// actually returns HTTP 404/410. Everything else — fragments that resolve to a
// real element, fragments that could be SPA hash routing, JS-wired popup/modal/
// accordion triggers, empty hrefs, javascript: links, buttons wired by JS,
// tracking/affiliate URLs, redirects, other HTTP errors (403/500/503/429) and
// rows that could not be verified — is deliberately hidden, so the section
// stays clean until something is really broken. Every failure is marked URGENT
// because it directly impacts technical SEO.
  function renderLinkResults(data) {
    var box = document.getElementById("devmodLinksResults");
    if (!box) return;
    var counts = data.counts || {};
    var rows = data.rows || [];
    var brokenRows = rows.filter(function (r) { return r.status === "broken"; });
    // Filter model for the summary chips. "All" shows only genuine failures
    // (404/410 and "#" placeholders); the other chips surface each category.
    var filterMatches = function (r, f) {
      if (!f || f === "all") return r.status === "broken";
      if (f === "valid") return r.status === "valid" || r.status === "ok";
      return r.status === f;
    };
    var filterLabel = function (f) {
      for (var i = 0; i < LINK_FILTERS.length; i++) if (LINK_FILTERS[i].id === f) return LINK_FILTERS[i].label;
      return f;
    };
    var viewRows = (linkFilter === "all" || linkFilter === "broken") ? brokenRows : rows.filter(function (r) { return filterMatches(r, linkFilter); });

    var summary = document.getElementById("devmodLinksSummary");
    if (summary) {
      var stats = '<span class="devmod-sum-ell">' + (data.checkedElements || 0) + ' elements checked</span>'
        + '<span class="devmod-sum-ell">' + (data.urlsChecked || 0) + ' URLs requested</span>'
        + '<span class="devmod-sum-ell">' + (counts.total || 0) + ' links &amp; buttons</span>'
        + (data.truncated ? '<span class="devmod-sum-note">capped at 50 unique URLs</span>' : '');
      var chipsBlock = rows.length ? '<div class="devmod-chips">' + LINK_FILTERS.map(function (f) {
        var n = rows.filter(function (r) { return filterMatches(r, f.id); }).length;
        return '<button type="button" class="devmod-chips-chip' + (linkFilter === f.id ? " active" : "") + '" data-filter="' + f.id + '">'
          + f.label + ' <b>' + n + '</b></button>';
      }).join("") + '</div>' : '';
      if (brokenRows.length > 0) {
        summary.innerHTML = '<div class="devmod-urgent">'
          + '<div class="devmod-urgent-icon">!</div>'
          + '<div class="devmod-urgent-body">'
          + '<div class="devmod-urgent-title">' + brokenRows.length + ' broken link' + (brokenRows.length === 1 ? "" : "s") + ' or button' + (brokenRows.length === 1 ? "" : "s") + ' \u2014 URGENT</div>'
          + '<div class="devmod-urgent-sub">Links that are a single "#" placeholder, or links to an actual HTTP 404/410 page. Everything else \u2014 SPA hash routes, JS-wired triggers and other HTTP errors \u2014 is intentionally not flagged. Fixing these helps technical SEO.</div>'
          + '</div></div>'
          + '<div>' + stats + '</div>'
          + chipsBlock;
      } else {
        summary.innerHTML = '<div>' + stats + '</div>' + chipsBlock;
      }
      summary.className = "devmod-summary";
    }

    if (!rows.length) {
      box.innerHTML = '<div class="empty-state">No links or buttons found on this page.</div>';
      return;
    }

    if (viewRows.length === 0) {
      var unverified = rows.filter(function (r) { return r.status === "unverified"; });
      var cleanSub = "No " + (linkFilter === "valid" ? "verified valid links in this group" : linkFilter === "redirect" ? "redirects" : linkFilter === "unverified" ? "unverifiable URLs" : "single-# placeholders or real 404/410 pages") + " \u2014 nothing to fix here.";
      if (linkFilter === "all" || linkFilter === "broken") {
        cleanSub += " JS-wired popup/modal triggers, SPA hash routes, valid in-page anchors, tracking links and unverifiable URLs are intentionally not reported.";
      }
      if (unverified.length > 0 && linkFilter === "all") {
        cleanSub += '<br>External URLs that could not be confirmed are not broken \u2014 if you expected more, grant site access when prompted and re-scan.';
      }
      box.innerHTML = '<div class="devmod-clean">'
        + '<div class="devmod-clean-check">\u2713</div>'
        + '<div class="devmod-clean-body">'
        + '<div class="devmod-clean-title">Nothing to fix under "' + escapeHtml(filterLabel(linkFilter)) + '"</div>'
        + '<div class="devmod-clean-sub">' + cleanSub + '</div>'
        + '</div></div>';
      return;
    }

    var html = '<div class="issue-list devmod-issue-list">';
    viewRows.forEach(function (row) {
      var urlFull = row.url || "";
      var urlDisplay = urlFull.length > 120 ? urlFull.slice(0, 110) + "\u2026" : urlFull;
      var st = row.status || "broken";
      var pillCls = "devmod-pill-bad";
      var pillTxt = "URGENT";
      var itemCls = " devmod-link-urgent";
      if (st === "unverified") { pillCls = "devmod-pill-grey"; pillTxt = "UNVERIFIED"; itemCls = ""; }
      else if (st === "redirect") { pillCls = "devmod-pill-warn"; pillTxt = "REDIRECT"; itemCls = ""; }
      else if (st === "valid" || st === "ok") { pillCls = "devmod-pill-ok"; pillTxt = "VALID"; itemCls = ""; }
      html += '<div class="issue-item devmod-link-item' + itemCls + '" data-selector="' + escapeHtml(row.selector || "") + '" role="button" tabindex="0" title="Click to locate this element on the page">'
        + '<div class="issue-icon devmod-pill ' + pillCls + '">' + pillTxt + '</div>'
        + '<div class="issue-content">'
        + '<div class="issue-title">' + escapeHtml(row.label || "Element")
        + (row.code ? '<span class="devmod-code">' + escapeHtml(row.code) + '</span>' : '')
        + (row.type ? '<span class="devmod-type">' + escapeHtml(row.type) + '</span>' : '')
        + '</div>'
        + '<div class="issue-path">' + escapeHtml(row.path || "") + '</div>'
        + '<div class="issue-desc devmod-url" title="' + escapeHtml(urlFull) + '">' + escapeHtml(urlDisplay) + '</div>'
        + (row.reason ? '<div class="devmod-reason">' + escapeHtml(row.reason) + '</div>' : '')
        + '<div class="devmod-actions">'
        + (isWebUrl(row.url) ? '<button type="button" class="devmod-act" data-action="open" title="Open this URL in a new tab">Open</button>' : '')
        + '<button type="button" class="devmod-act" data-action="copy-url" title="Copy the URL">Copy URL</button>'
        + '<button type="button" class="devmod-act" data-action="copy-sel" data-copytarget="' + escapeHtml(row.selector || "") + '" title="Copy the CSS selector">Copy selector</button>'
        + '<button type="button" class="devmod-act" data-action="locate" title="Flash and scroll to this element">Locate</button>'
        + '</div>'
        + '</div></div>';
    });
    html += '</div>';
    box.innerHTML = html;
  }

  function renderTypoVariants(variants) {
    if (!variants || !variants.length) return "";
    var html = '<div class="typo-variants">';
    variants.forEach(function (v) {
      html += '<span class="chip">' + escapeHtml(v.font) + ' ' + escapeHtml(v.size) + ' &#215;' + v.count + '</span>';
    });
    html += '</div>';
    return html;
  }

  function renderTypoResults(data) {
    var box = document.getElementById("devmodTypoResults");
    if (!box) return;
    var html = "";
    (data.groups || []).forEach(function (g) {
      html += '<div class="typo-row">'
        + '<div class="typo-tag">' + escapeHtml(g.tag) + '</div>'
        + '<div class="typo-info">';
      if (g.font) {
        html += '<div class="typo-font">' + escapeHtml(g.font) + '</div>'
          + '<div class="typo-size">' + escapeHtml(g.size) + ' \u00B7 line-height ' + escapeHtml(g.lineHeight) + ' \u00B7 weight ' + escapeHtml(g.weight) + ' \u00B7 used ' + g.dominantCount + ' of ' + g.count + '</div>';
        var props = g.props || [];
        if (props.length) {
          html += '<div class="typo-props">';
          props.forEach(function (p) {
            var swatch = /color/.test(p.prop) && /^(rgb|rgba|hsl|hsla|#)/i.test(String(p.value)) ? '<span class="typo-swatch" style="background:' + p.value + '"></span>' : "";
            html += '<span class="typo-prop" data-copy="' + escapeHtml(String(p.value)) + '" title="Click to copy ' + escapeHtml(p.prop) + '">'
              + '<span class="typo-propname">' + escapeHtml(p.prop) + '</span>'
              + swatch
              + '<span class="typo-propvalue">' + escapeHtml(String(p.value)) + '</span>'
              + '</span>';
          });
          html += '<button type="button" class="typo-copyall" data-typo-copyall="' + escapeHtml(g.tag) + '">Copy all</button>';
          html += '</div>';
        }
      } else {
        html += '<div class="typo-font empty-state">No ' + escapeHtml(g.tag) + ' elements on this page</div>';
      }
      html += renderTypoVariants(g.variants)
        + '</div></div>';
    });
    html += '<div class="devmod-sum-row">Values are the live computed styles from this page. Click any value to copy it.</div>';
    box.innerHTML = html;

    box.querySelectorAll("[data-copy]").forEach(function (row) {
      row.addEventListener("click", function () {
        var value = row.getAttribute("data-copy");
        if (!value) return;
        popupCopy(value, function (ok) {
          if (!ok) return;
          row.classList.add("typo-copied");
          setTimeout(function () { row.classList.remove("typo-copied"); }, 900);
        });
      });
    });
    box.querySelectorAll("[data-typo-copyall]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var tag = btn.getAttribute("data-typo-copyall").toLowerCase();
        var group = (data.groups || []).filter(function (g) { return g.tag.toLowerCase() === tag; })[0];
        if (!group || !group.props) return;
        var text = (group.props || []).map(function (p) { return p.prop + ": " + p.value + ";"; }).join("\n");
        popupCopy(text, function (ok) {
          if (!ok) return;
          var prev = btn.textContent;
          btn.textContent = "Copied \u2713";
          setTimeout(function () { btn.textContent = prev; }, 1400);
        });
      });
    });
  }

  // ============================================
  // CSS TOOLS (DEV-MOD tool)
  // ============================================
  var cssResultsCache = null;

  function renderCssResults(data) {
    var box = document.getElementById("devmodCssResults");
    if (!box) return;
    var html = "";
    var sheets = data.sheets || [];
    if (!sheets.length) {
      html = '<div class="empty-state">No stylesheets on this page.</div>';
    } else {
      html += '<div class="devmod-summary"><span>Stylesheets: <b>' + sheets.length + '</b></span>'
        + '<span class="devmod-sum-note">Click a row to toggle it on/off (temporary).</span></div>';
      sheets.forEach(function (s) {
        var name = s.title && s.title !== "" ? s.title : (s.href ? s.href.split("/").pop() || s.href : "Inline stylesheet");
        var src = s.href ? s.href : (s.id ? "#" + s.id : "<style> block");
        html += '<div class="css-sheet' + (s.disabled ? " css-sheet-off" : "") + (s.owned ? " css-sheet-owned" : "") + '" data-index="' + s.index + '" role="button" tabindex="0" title="' + (s.disabled ? "Disabled \u2014 click to enable (temporary)" : "Active \u2014 click to disable (temporary)") + '">'
          + '<span class="css-sheet-state">' + (s.disabled ? "OFF" : "ON") + '</span>'
          + '<div class="css-sheet-body">'
          + '<div class="css-sheet-name">' + escapeHtml(name) + '</div>'
          + '<div class="css-sheet-meta">' + escapeHtml(src)
          + (s.rules === null ? ' \u00B7 <span class="devmod-code">cross-origin \u00B7 rules hidden</span>' : ' \u00B7 ' + s.rules + ' rule' + (s.rules === 1 ? "" : "s"))
          + (s.media ? ' \u00B7 media "' + escapeHtml(s.media) + '"' : "")
          + (s.owned ? ' \u00B7 <span class="devmod-code">extension injected</span>' : "")
          + '</div></div></div>';
      });
    }
    box.innerHTML = html;
    box.querySelectorAll(".css-sheet").forEach(function (row) {
      row.addEventListener("click", function () {
        var idx = parseInt(row.getAttribute("data-index"), 10);
        devModMsg({ action: "csstoolsToggle", index: idx }, function (res, err) {
          if (err || !res || !res.success) {
            devmodStatus("devmodCssStatus", (err || (res && res.error)) || "Could not toggle the stylesheet.", "error");
            return;
          }
          devmodStatus("devmodCssStatus", res.disabled ? "Stylesheet disabled (temporary)." : "Stylesheet enabled.", "ok");
          if (cssResultsCache) {
            cssResultsCache.sheets.forEach(function (s) { if (s.index === idx) s.disabled = res.disabled; });
            renderCssResults(cssResultsCache);
          }
        });
      });
    });
    box.querySelectorAll(".css-sheet").forEach(function (row) {
      row.addEventListener("keydown", function (ev) {
        if (ev.key !== "Enter" && ev.key !== " ") return;
        ev.preventDefault();
        row.click();
      });
    });
  }

  // ============================================
  // FORMS TOOLS (DEV-MOD tool)
  // ============================================
  function renderFormsResults(data) {
    var box = document.getElementById("devmodFormsResults");
    if (!box) return;
    var forms = data.forms || [];
    var html = "";
    if (!forms.length) {
      html = '<div class="empty-state">No forms on this page.</div>';
    } else {
      html += '<div class="devmod-summary"><span>Forms: <b>' + forms.length + '</b></span>'
        + '<span class="devmod-sum-note">Testing never submits a form.</span></div>';
      forms.forEach(function (f) {
        var title = f.label || f.name || f.id || ("Form #" + (f.index + 1));
        html += '<div class="form-row">'
          + '<div class="form-head">'
          + '<div class="form-title">' + escapeHtml(title) + '</div>'
          + '<span class="devmod-code">' + escapeHtml(f.method || "") + '</span>'
          + '<span class="form-chip' + (f.novalidate ? " form-chip-off" : "") + '">' + (f.novalidate ? "validation OFF" : "validation ON") + '</span>'
          + '</div>'
          + '<div class="form-meta">' + escapeHtml(f.action || "(action not set)") + ' \u00B7 ' + f.fields.length + ' field' + (f.fields.length === 1 ? "" : "s")
          + (f.id ? ' \u00B7 #' + escapeHtml(f.id) : "") + '</div>'
          + (f.fields.length ? '<div class="form-fields">' + f.fields.map(function (fd) {
            return '<span class="chip">' + escapeHtml(fd.type) + (fd.name ? " \u00B7 " + escapeHtml(fd.name) : "") + (fd.required ? " <b>\u2605</b>" : "") + '</span>';
          }).join("") + '</div>' : "")
          + '<div class="devmod-actions">'
          + '<button type="button" class="devmod-act" data-act="locate" data-index="' + f.index + '">Locate</button>'
          + '<button type="button" class="devmod-act" data-act="toggle" data-index="' + f.index + '" data-novalidate="' + (f.novalidate ? "1" : "0") + '">' + (f.novalidate ? "Enable validation" : "Disable validation") + '</button>'
          + '<button type="button" class="devmod-act" data-act="fill" data-index="' + f.index + '">Fill sample values</button>'
          + '<button type="button" class="devmod-act" data-act="reset" data-index="' + f.index + '">Reset</button>'
          + '</div></div>';
      });
    }
    box.innerHTML = html;
    box.querySelectorAll(".devmod-act").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var idx = parseInt(btn.getAttribute("data-index"), 10);
        var act = btn.getAttribute("data-act");
        if (act === "locate") {
          var fdata = (data.forms || [])[idx];
          var selector = null;
          if (fdata && fdata.id && /^[a-zA-Z][\w:.-]*$/.test(fdata.id)) selector = "#" + fdata.id;
          if (!selector) selector = "form:nth-of-type(" + (idx + 1) + ")";
          devModMsg({ action: "locateLink", selector: selector }, function (res, err) {
            if (err || !res || !res.success) {
              devmodStatus("devmodFormsStatus", (err || (res && res.error)) || "Could not locate the form.", "error");
              return;
            }
            devmodStatus("devmodFormsStatus", "Located form #" + (idx + 1) + " \u2014 highlighted on the page.", "ok");
          });
          return;
        }
        if (act === "toggle") {
          var target = btn.getAttribute("data-novalidate") === "1" ? false : true;
          devModMsg({ action: "formToggleValidate", index: idx, on: target }, function (res, err) {
            if (err || !res || !res.success) {
              devmodStatus("devmodFormsStatus", (err || (res && res.error)) || "Could not toggle validation.", "error");
              return;
            }
            devmodStatus("devmodFormsStatus", "Validation turned " + (res.novalidate ? "OFF (temporary)." : "ON."), "ok");
            devModMsg({ action: "formstoolsList" }, function (r2, e2) {
              if (!e2 && r2 && r2.success) renderFormsResults(r2.data);
            });
          });
          return;
        }
        if (act === "fill") {
          devModMsg({ action: "formFillTest", index: idx }, function (res, err) {
            if (err || !res || !res.success) {
              devmodStatus("devmodFormsStatus", (err || (res && res.error)) || "Could not fill the form.", "error");
              return;
            }
            devmodStatus("devmodFormsStatus", "Filled " + res.filled + " field(s) with sample values \u2014 " + res.note, "ok");
          });
          return;
        }
        if (act === "reset") {
          devModMsg({ action: "formReset", index: idx }, function (res, err) {
            if (err || !res || !res.success) {
              devmodStatus("devmodFormsStatus", (err || (res && res.error)) || "Could not reset the form.", "error");
              return;
            }
            devmodStatus("devmodFormsStatus", "Form reset to its defaults.", "ok");
          });
        }
      });
    });
  }

  // ============================================
  // IMAGE TOOLS (DEV-MOD tool)
  // ============================================
  function renderImageResults(data) {
    var box = document.getElementById("devmodImagesResults");
    if (!box) return;
    var items = data.items || [];
    var html = "";
    if (!items.length) {
      html = '<div class="empty-state">No images on this page.</div>';
    } else {
      var broken = items.filter(function (i) { return i.broken; }).length;
      var noAlt = items.filter(function (i) { return !i.hasAlt || i.altEmpty; }).length;
      html += '<div class="devmod-summary"><span>Images: <b>' + items.length + '</b></span>'
        + (broken ? '<span class="devmod-chip devmod-pill-bad">' + broken + ' broken</span>' : '<span class="devmod-chip devmod-pill-ok">no broken</span>')
        + (noAlt ? '<span class="devmod-chip devmod-pill-warn">' + noAlt + ' no alt</span>' : '<span class="devmod-chip devmod-pill-ok">all have alt</span>')
        + '</div>';
      items.forEach(function (item, i) {
        var cls = item.broken ? "img-row-bad" : (item.altEmpty ? "img-row-warn" : "");
        var dims = (item.width && item.height) ? item.width + "\u00D7" + item.height + "px" : "no size";
        var hiddenState = item.hidden ? ' <span class="devmod-code" data-hidden="1">hidden</span>' : '';
        html += '<div class="img-row ' + cls + '" data-index="' + i + '" role="button" tabindex="0" title="Click to locate this image on the page">'
          + '<div class="img-pill">' + (item.broken ? "BROKEN" : (item.width && item.height ? "OK" : "NO SIZE")) + '</div>'
          + '<div class="img-body">'
          + '<div class="img-name">' + escapeHtml(item.source || item.url) + '</div>'
          + '<div class="img-meta">' + escapeHtml(dims)
          + (item.lazy ? ' \u00B7 <span class="devmod-code">lazy</span>' : '')
          + ' \u00B7 ' + (item.hasAlt ? (item.altEmpty ? '<span class="devmod-code">empty alt</span>' : "alt: \"" + escapeHtml(String(item.alt).slice(0, 40)) + (String(item.alt).length > 40 ? "\u2026\"" : "\"")) + '</span>' : '<span class="devmod-code">no alt</span>')
          + hiddenState
          + '</div></div>'
          + '<button type="button" class="img-toggle" data-index="' + i + '" aria-pressed="' + (item.hidden ? "true" : "false") + '">'
          + (item.hidden ? "Show" : "Hide") + '</button>'
          + '</div>';
      });
    }
    box.innerHTML = html;

    function locate(index) {
      devModMsg({ action: "imagetoolsFlash", index: index }, function (res, err) {
        if (err || !res || !res.success) {
          devmodStatus("devmodImagesStatus", (err || (res && res.error)) || "Could not locate the image.", "error");
          return;
        }
        devmodStatus("devmodImagesStatus", "Image located \u2014 highlighted on the page.", "ok");
      });
    }
    function toggleImage(index, btn) {
      devModMsg({ action: "imagetoolsToggle", index: index }, function (res, err) {
        if (err || !res || !res.success) {
          devmodStatus("devmodImagesStatus", (err || (res && res.error)) || "Could not toggle the image.", "error");
          return;
        }
        devmodStatus("devmodImagesStatus", res.hidden ? "Image hidden on the page \u2014 reload restores it." : "Image shown again on the page.", "ok");
        if (btn) {
          btn.setAttribute("aria-pressed", res.hidden ? "true" : "false");
          btn.textContent = res.hidden ? "Show" : "Hide";
        }
        var meta = box.querySelectorAll(".img-meta");
        if (meta[index]) {
          var tag = meta[index].querySelector(".devmod-code[data-hidden]");
          if (res.hidden) {
            if (!tag) {
              var s = document.createElement("span");
              s.className = "devmod-code";
              s.setAttribute("data-hidden", "1");
              s.textContent = " hidden";
              meta[index].appendChild(s);
            }
          } else if (tag) {
            tag.remove();
          }
        }
      });
    }
    box.querySelectorAll(".img-row").forEach(function (row) {
      row.addEventListener("click", function () {
        locate(parseInt(row.getAttribute("data-index"), 10));
      });
      row.addEventListener("keydown", function (ev) {
        if (ev.key !== "Enter" && ev.key !== " ") return;
        ev.preventDefault();
        row.click();
      });
    });
    box.querySelectorAll(".img-toggle").forEach(function (btn) {
      btn.addEventListener("click", function (ev) {
        ev.stopPropagation();
        toggleImage(parseInt(btn.getAttribute("data-index"), 10), btn);
      });
    });
  }

  // ============================================
  // MEDIA & ICON DOWNLOADS (DEV-MOD tool)
  // ============================================
  function assetFileName(item, index) {
    var i = index + 1;
    var padded = (i < 10 ? "0" + i : "" + i);
    if (item.inline) return "inline-svg-" + padded + ".svg";
    var base = "asset";
    try {
      base = String(item.url).split(/[?#]/)[0].split("/").pop();
    } catch (e) { base = "asset"; }
    if (!/\.(png|jpe?g|gif|webp|avif|svg|ico|bmp|tiff?)$/i.test(base)) base = base + ".bin";
    return base;
  }

  function downloadAsset(item, index) {
    var status = document.getElementById("devmodMediaStatus");
    var name = assetFileName(item, index);
    devModMsg({ action: "mediatrackflash", index: index }, function () {});
    if (item.inline) {
      downloadBlob(name, item.markup || "", "image/svg+xml", status, "of " + name + " started");
      return;
    }
    if (item.url && chrome.downloads) {
      chrome.downloads.download({ url: item.url, filename: name, saveAs: false }, function () {
        if (chrome.runtime.lastError) {
          if (status) { status.className = "devmod-status visible"; status.textContent = "Could not download \u2014 " + chrome.runtime.lastError.message; }
          return;
        }
        if (status) { status.className = "devmod-status visible"; status.textContent = "Downloading " + name + "\u2026"; }
      });
      return;
    }
    if (status) { status.className = "devmod-status visible"; status.textContent = "Nothing to download for this asset."; }
  }

  var mediaTrackOn = false;
  var mediaPollTimer = null;

  function mediaPollStop() { if (mediaPollTimer) { clearInterval(mediaPollTimer); mediaPollTimer = null; } }
  function mediaPollTick() {
    devModMsg({ action: "mediatracked" }, function (res, err) {
      if (!err && res && res.success && res.data) renderTrackedMedia(res.data.items || []);
    });
  }
  function mediaPollStart() { mediaPollStop(); mediaPollTimer = setInterval(mediaPollTick, 600); }

  function renderTrackedMedia(items) {
    var box = document.getElementById("devmodMediaResults");
    if (!box) return;
    items = items || [];
    if (!items.length) {
      box.innerHTML = '<div class="empty-state">Nothing tracked yet. Click an icon, image or SVG on the page and it will appear here ready for download.</div>';
      return;
    }
    var html = '<div class="devmod-summary">'
      + '<span>Tracked: <b>' + items.length + '</b></span>'
      + '<span class="devmod-sum-note">Only what you clicked is listed.</span>'
      + '</div>';
    html += '<div class="media-list">';
    items.forEach(function (item, i) {
      var kind = item.type === "icon" ? "Ico" : item.type === "svg" ? "SVG" : "Img";
      var name = item.inline ? (item.label || ("Inline SVG #" + (i + 1))) : item.url;
      var dims = (item.width || item.height) ? ((item.width || "?") + "\u00D7" + (item.height || "?") + " px") : "";
      html += '<div class="media-item">'
        + '<span class="media-kind">' + kind + '</span>'
        + '<div class="media-info">'
        + '<div class="media-name" title="' + escapeHtml(item.url || name) + '">' + escapeHtml(name) + '</div>'
        + '<div class="media-meta">' + escapeHtml(item.source || "") + (dims ? " \u00B7 " + dims : "") + '</div>'
        + '</div>'
        + '<button class="btn-download media-dl" data-index="' + i + '" type="button">Download</button>'
        + '<button class="btn-remove media-rm" data-index="' + i + '" title="Remove" type="button">&times;</button>'
        + '</div>';
    });
    html += '</div>';
    html += '<div style="margin-top:6px"><button type="button" id="mediaClearAll" class="btn-ghost">Clear all</button></div>';
    box.innerHTML = html;

    box.querySelectorAll(".media-dl").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var idx = parseInt(btn.getAttribute("data-index"), 10);
        var item = items[idx];
        if (!item) return;
        var lbl = btn.textContent;
        btn.disabled = true;
        btn.textContent = "Downloading\u2026";
        downloadAsset(item, idx);
        setTimeout(function () { btn.disabled = false; btn.textContent = lbl; }, 3000);
      });
    });
    box.querySelectorAll(".media-rm").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var idx = parseInt(btn.getAttribute("data-index"), 10);
        devModMsg({ action: "mediatrackremove", index: idx }, function (res, err) {
          if (!err && res && res.success) renderTrackedMedia(res.data ? res.data.items : []);
        });
      });
    });
    var clearBtn = box.querySelector("#mediaClearAll");
    if (clearBtn) {
      clearBtn.addEventListener("click", function () {
        devModMsg({ action: "mediatrackclear" }, function (res, err) {
          if (!err && res && res.success) renderTrackedMedia([]);
        });
      });
    }
  }

  // ============================================
  // ELEMENTOR DOM INSPECTOR (DEV-MOD tool)
  // ============================================
  function renderElementorInspector(data) {
    var box = document.getElementById("eleInspectorResults");
    if (!box) return;
    if (!data || !data.detected) {
      box.innerHTML = '<div class="empty-state">No Elementor markup detected on this page.</div>';
      return;
    }
    if (data.editor && data.sections.length === 0) {
      box.innerHTML = '<div class="devmod-hint">Elementor editor detected \u2014 the sections live inside the editor\u2019s preview iframe, so their full DOM is not visible here. Open the published page (\u201cView Page\u201d in Elementor) and run this again for accurate counts.</div>';
      return;
    }
    var html = '<div class="devmod-summary">'
      + '<span>Sections: <b>' + data.summary.sectionsFound + '</b></span>'
      + '<span>Widgets: <b>' + data.summary.widgets + '</b></span>'
      + '<span>Containers: <b>' + data.summary.containers + '</b></span>'
      + (data.summary.spacers ? '<span>Spacers: <b>' + data.summary.spacers + '</b></span>' : '')
      + (data.summary.hidden ? '<span>Hidden dupes: <b>' + data.summary.hidden + '</b></span>' : '')
      + (data.summary.emptyWraps ? '<span>Empty wrappers: <b>' + data.summary.emptyWraps + '</b></span>' : '')
      + (data.summary.repeated ? '<span>Repeated widgets: <b>' + data.summary.repeated + '</b></span>' : '')
      + (data.editor ? '<span class="devmod-sum-note">Editor mode</span>' : '')
      + '</div>';

    html += '<div class="ele-list">';
    data.sections.forEach(function (s, i) {
      var meta = s.nodeCount.toLocaleString() + (s.truncated ? "+" : "") + " elements"
        + (s.share != null ? " \u00B7 " + s.share + "% of page" : "")
        + " \u00B7 depth " + s.nesting
        + " \u00B7 " + s.widgets + " widget" + (s.widgets === 1 ? "" : "s");
      var idBadge = s.dataId ? '<span class="ele-id" title="Element ID \u2014 find it in the Elementor editor panel">' + escapeHtml(s.dataId) + '</span>' : "";
      html += '<div class="ele-item ' + s.tier.cls + '">'
        + '<div class="ele-head">'
        + '<span class="ele-rank">' + (i + 1) + '</span>'
        + '<div class="ele-info">'
        + '<div class="ele-label">' + escapeHtml(s.label) + idBadge
        + '<span class="ele-badge ' + s.tier.cls + '">' + escapeHtml(s.tier.label) + '</span>'
        + '<span class="ele-kind">' + escapeHtml(s.kind) + '</span>'
        + '</div>'
        + '<div class="ele-meta">' + escapeHtml(meta) + '</div>'
        + (s.share != null ? '<div class="share-bar"><div class="share-bar-fill fill-' + shareColor(s.share) + '" style="width:' + Math.min(100, s.share) + '%"></div></div>' : '')
        + '</div>'
        + '<div class="ele-actions">'
        + '<button class="btn-locate" data-index="' + i + '" title="Flash this section on the page">Locate</button>'
        + '</div>'
        + '</div>';
      if (s.widgetTypes && s.widgetTypes.length) {
        html += '<div class="ele-widgets">' + s.widgetTypes.map(function (w) {
          return '<span class="hs-chip">' + escapeHtml(w.type) + ' \u00D7 ' + w.count + '</span>';
        }).join("") + '</div>';
      }
      html += '<ul class="ele-sug">' + s.suggestions.map(function (sg) {
        return '<li>' + escapeHtml(sg) + '</li>';
      }).join("") + '</ul>';
      if (data.editor) {
        html += '<div class="ele-editor-note">In the Elementor editor, click this section/container and match its ID shown above to find it on the canvas.</div>';
      }
      html += '</div>';
    });
    html += '</div>';
    html += '<div class="devmod-sum-row">Sections ranked by element count. Uses hidden, empty, spacer &amp; repeated-widget signals to suggest cuts.</div>';
    box.innerHTML = html;

    box.querySelectorAll(".btn-locate").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var sec = data.sections[parseInt(btn.getAttribute("data-index"), 10)];
        if (!sec || !sec.selector) return;
        devmodStatus("eleInspectorStatus", "Locating " + escapeHtml(sec.label) + "\u2026", "busy");
        locateOnActiveTab(sec.selector, function (res, err) {
          if (err || !res || !res.success) {
            devmodStatus("eleInspectorStatus", (err || (res && res.error)) || "Could not locate the element.", "error");
            return;
          }
          devmodStatus("eleInspectorStatus", "Located on the page \u2014 highlighted.", "ok");
        });
      });
    });
  }

  function wireElementorInspector() {
    var btn = document.getElementById("eleInspectorBtn");
    if (!btn || btn.getAttribute("data-wired")) return;
    btn.setAttribute("data-wired", "1");
    btn.addEventListener("click", function () {
      devmodStatus("eleInspectorStatus", "Reading Elementor sections\u2026", "busy");
      btn.disabled = true;
      devModMsg({ action: "analyzeelementor" }, function (res, err) {
        btn.disabled = false;
        if (err || !res || !res.success) {
          devmodStatus("eleInspectorStatus", (err || (res && res.error)) || "Could not inspect Elementor markup.", "error");
          return;
        }
        devmodStatus("eleInspectorStatus", "Done.", "ok");
        renderElementorInspector(res.data);
      });
    });
  }

  function ensureLinkProbePermission(cb) {
    try {
      if (!chrome || !chrome.permissions) { cb(true); return; }
      chrome.permissions.contains({ origins: ["http://*/*", "https://*/*"] }, function (already) {
        if (already) { cb(true); return; }
        chrome.permissions.request({ origins: ["http://*/*", "https://*/*"] }, function (granted) { cb(!!granted); });
      });
    } catch (e) { cb(true); }
  }

  // ---- JS Tracker: state, scan, render, live toggle ----
  var scriptLive = { on: false, timer: null, data: null };

  function scanScripts(quiet) {
    devModMsg({ action: "analyzescripts" }, function (res, err) {
      if (err || !res || !res.success) {
        if (!quiet) devmodStatus("devmodJsStatus", (err || (res && res.error)) || "Could not scan scripts.", "error");
        return;
      }
      scriptLive.data = res.data;
      renderScriptResults(res.data);
      if (!quiet) devmodStatus("devmodJsStatus", "Scanned " + res.data.total + " script tag(s).", "ok");
    });
  }

  function renderScriptResults(data) {
    var host = document.getElementById("devmodJsResults");
    if (!host) return;
    if (!data || !data.total) {
      host.innerHTML = '<div class="devmod-empty">No &lt;script&gt; tags found on this page.</div>';
      return;
    }
    var html = '<div class="script-stats">'
      + '<span class="script-stat">' + data.total + ' script' + (data.total === 1 ? "" : "s") + '</span>'
      + '<span class="script-stat">' + data.externalCount + ' external</span>'
      + '<span class="script-stat">' + data.inlineCount + ' inline</span>'
      + '<span class="script-stat">' + formatBytes(data.inlineChars) + ' inline code</span>'
      + '</div>';
    data.items.forEach(function (it) {
      var badges = it.inline
        ? '<span class="script-badge script-badge-inline">INLINE</span>'
        : '<span class="script-badge script-badge-external">EXTERNAL</span>';
      if (it.async) badges += '<span class="script-badge script-badge-flag">async</span>';
      if (it.defer) badges += '<span class="script-badge script-badge-flag">defer</span>';
      if (it.nomodule) badges += '<span class="script-badge script-badge-flag">nomodule</span>';
      if (it.type) badges += '<span class="script-badge script-badge-type">' + escapeHtml(it.type) + '</span>';
      if (it.id) badges += '<span class="script-chip">#' + escapeHtml(it.id) + '</span>';
      it.classes.forEach(function (c) { badges += '<span class="script-chip">.' + escapeHtml(c) + '</span>'; });
      var url;
      if (it.inline) {
        url = '<span class="script-src script-src-inline">Inline script \u2014 executes in this document</span>';
      } else {
        url = '<span class="script-src" title="' + escapeHtml(it.src) + '">' + escapeHtml(it.src) + '</span>';
        if (it.codeLength) url += ' <span class="script-size">(' + formatBytes(it.codeLength) + ')</span>';
      }
      var loc = it.parent || "At page root";
      if (it.containers && it.containers.length) {
        loc += ' \u2192 ' + it.containers.map(function (c) { return escapeHtml(c); }).join(' \u203A ');
      }
      var codeText = it.inline
        ? (it.code ? it.code : "  (empty inline script \u2014 runs nothing)")
        : "  (external script \u2014 source loaded from " + it.src + ")";
      html += '<div class="script-item">'
        + '<div class="script-head">'
        + '<span class="script-summary">' + url + '</span>'
        + '<span class="script-badges">' + badges + '</span>'
        + '</div>'
        + '<div class="script-loc">' + escapeHtml(loc) + '</div>'
        + '<details class="script-code-wrap"><summary>' + (it.inline ? ('Raw code' + (it.truncated ? ' (truncated \u2014 ' + it.codeLength + ' chars total)' : '')) : 'Inspect script tag') + '</summary>'
        + '<pre class="script-code">' + escapeHtml(codeText) + '</pre>'
        + '</details>'
        + '<div class="script-actions">'
        + '<button type="button" class="script-locate" data-js-idx="' + it.idx + '">Locate</button>'
        + '<button type="button" class="script-copy" data-js-idx="' + it.idx + '"' + (it.inline ? "" : ' disabled title="External scripts have no inline code to copy"') + '>Copy code</button>'
        + '</div>'
        + '</div>';
    });
    host.innerHTML = html;

    host.querySelectorAll("[data-js-idx]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var idx = parseInt(btn.getAttribute("data-js-idx"), 10);
        if (btn.className.indexOf("script-locate") !== -1) {
          devModMsg({ action: "locatescript", idx: idx }, function (res, err) {
            if (!err && res && res.success) devmodStatus("devmodJsStatus", "Script #" + idx + " highlighted on the page.", "ok");
            else devmodStatus("devmodJsStatus", (err || (res && res.error)) || "Could not locate the script.", "error");
          });
        } else {
          var item = scriptLive.data && scriptLive.data.items[idx];
          if (item) copyText(item.code, btn);
        }
      });
    });
  }

  function toggleScriptLive(btnScan, labelBtn) {
    if (scriptLive.on) {
      scriptLive.on = false;
      if (scriptLive.timer) { clearInterval(scriptLive.timer); scriptLive.timer = null; }
      devModMsg({ action: "scripttrack", enable: false }, function () {});
      if (btnScan) btnScan.disabled = false;
      if (labelBtn) { labelBtn.textContent = "Live tracking: Off"; labelBtn.classList.remove("live-on"); labelBtn.disabled = false; }
      devmodStatus("devmodJsStatus", "Live tracking stopped.", "ok");
      return;
    }
    scriptLive.on = true;
    if (btnScan) btnScan.disabled = true;
    devModMsg({ action: "scripttrack", enable: true }, function (res) {
      if (labelBtn) { labelBtn.textContent = "Live tracking: On"; labelBtn.classList.add("live-on"); labelBtn.disabled = false; }
      if (res && res.success) {
        devmodStatus("devmodJsStatus", "Live tracking is on \u2014 new or removed script tags refresh this list instantly.", "ok");
      }
    });
    scanScripts(true);
    scriptLive.timer = setInterval(function () {
      if (!scriptLive.on) return;
      devModMsg({ action: "analyzescripts" }, function (res) {
        if (!res || !res.success) return;
        scriptLive.data = res.data;
        renderScriptResults(res.data);
      });
    }, 1500);
  }

  function wireDevMod() {
    var btnLinks = document.getElementById("devmodBtnLinks");
    if (btnLinks && !btnLinks.getAttribute("data-wired")) {
      btnLinks.setAttribute("data-wired", "1");
      btnLinks.addEventListener("click", function () {
        devmodStatus("devmodLinksStatus", "Requesting access\u2026", "busy");
        btnLinks.disabled = true;
        ensureLinkProbePermission(function (ok) {
          if (!ok) {
            devmodStatus("devmodLinksStatus", "Site access denied \u2014 external URLs cannot be checked.", "warn");
          }
          devmodStatus("devmodLinksStatus", "Scanning links\u2026", "busy");
          devModMsg({ action: "analyzebrokenlinks" }, function (res, err) {
            btnLinks.disabled = false;
            if (err || !res || !res.success) {
              devmodStatus("devmodLinksStatus", (err || (res && res.error)) || "Could not scan links.", "error");
              return;
            }
            devmodStatus("devmodLinksStatus", "Done \u2014 " + ((res.data.counts && res.data.counts.total) || 0) + " link(s) found.");
            lastLinkResults = res.data;
            linkFilter = "all";
            renderLinkResults(res.data);
          });
        });
      });
    }

    var btnTypo = document.getElementById("devmodBtnTypo");
    if (btnTypo && !btnTypo.getAttribute("data-wired")) {
      btnTypo.setAttribute("data-wired", "1");
      btnTypo.addEventListener("click", function () {
        devmodStatus("devmodTypoStatus", "Reading computed styles\u2026", "busy");
        btnTypo.disabled = true;
        devModMsg({ action: "analyzetypo" }, function (res, err) {
          btnTypo.disabled = false;
          if (err || !res || !res.success) {
            devmodStatus("devmodTypoStatus", (err || (res && res.error)) || "Could not read typography.", "error");
            return;
          }
          devmodStatus("devmodTypoStatus", "Done.");
          renderTypoResults(res.data);
        });
      });
    }

    var btnMedia = document.getElementById("devmodBtnMedia");
    if (btnMedia && !btnMedia.getAttribute("data-wired")) {
      btnMedia.setAttribute("data-wired", "1");
      btnMedia.addEventListener("click", function () {
        mediaTrackOn = !mediaTrackOn;
        if (mediaTrackOn) {
          btnMedia.textContent = "Stop";
          btnMedia.classList.add("btn-stop");
          devmodStatus("devmodMediaStatus", "Tracking is active \u2014 click any image, icon or SVG on the page.", "ok");
          mediaPollStart();
          mediaPollTick();
        } else {
          btnMedia.textContent = "Track";
          btnMedia.classList.remove("btn-stop");
          devmodStatus("devmodMediaStatus", "Tracking stopped.");
          mediaPollStop();
        }
        devModMsg({ action: "mediatrack", enable: mediaTrackOn }, function () {});
      });
      devModMsg({ action: "mediatracked" }, function (res, err) {
        if (!err && res && res.success && res.data) {
          if (res.data.enabled) {
            mediaTrackOn = true;
            btnMedia.textContent = "Stop";
            btnMedia.classList.add("btn-stop");
            devmodStatus("devmodMediaStatus", "Tracking is active \u2014 click any image, icon or SVG on the page.", "ok");
            mediaPollStart();
            renderTrackedMedia(res.data.items || []);
          }
        }
      });
    }

    var btnCss = document.getElementById("devmodBtnCss");
    var btnCssDisableAll = document.getElementById("devmodBtnCssDisableAll");
    var btnCssRestore = document.getElementById("devmodBtnCssRestore");
    if (btnCss && !btnCss.getAttribute("data-wired")) {
      btnCss.setAttribute("data-wired", "1");
      btnCss.addEventListener("click", function () {
        devmodStatus("devmodCssStatus", "Reading stylesheets\u2026", "busy");
        btnCss.disabled = true;
        devModMsg({ action: "csstoolslist" }, function (res, err) {
          btnCss.disabled = false;
          if (err || !res || !res.success) {
            devmodStatus("devmodCssStatus", (err || (res && res.error)) || "Could not read stylesheets.", "error");
            return;
          }
          devmodStatus("devmodCssStatus", "Done \u2014 " + res.data.total + " stylesheet(s) found. Click one to toggle it (temporary).", "ok");
          cssResultsCache = res.data;
          renderCssResults(res.data);
          if (btnCssDisableAll) btnCssDisableAll.disabled = false;
          if (btnCssRestore) btnCssRestore.disabled = false;
        });
      });
      if (btnCssDisableAll) btnCssDisableAll.addEventListener("click", function () {
        devModMsg({ action: "csstoolsToggleAll", on: true }, function (res, err) {
          if (err || !res || !res.success) {
            devmodStatus("devmodCssStatus", (err || (res && res.error)) || "Could not disable stylesheets.", "error");
            return;
          }
          devmodStatus("devmodCssStatus", "All stylesheets disabled (temporary).", "ok");
          if (cssResultsCache) {
            cssResultsCache.sheets.forEach(function (s) { s.disabled = true; });
            renderCssResults(cssResultsCache);
          }
        });
      });
      if (btnCssRestore) btnCssRestore.addEventListener("click", function () {
        devModMsg({ action: "csstoolsToggleAll", on: false }, function (res, err) {
          if (err || !res || !res.success) {
            devmodStatus("devmodCssStatus", (err || (res && res.error)) || "Could not restore stylesheets.", "error");
            return;
          }
          devmodStatus("devmodCssStatus", "All stylesheets restored to their original state.", "ok");
          if (cssResultsCache) {
            cssResultsCache.sheets.forEach(function (s) { s.disabled = false; });
            renderCssResults(cssResultsCache);
          }
        });
      });
      var btnCssApply = document.getElementById("devmodBtnCssApply");
      var btnCssClear = document.getElementById("devmodBtnCssClear");
      var cssInject = document.getElementById("devmodCssInject");
      if (cssInject) cssInject.addEventListener("input", function () {
        var has = !!(cssInject.value && cssInject.value.trim());
        if (btnCssApply) btnCssApply.disabled = !has;
        if (btnCssClear) btnCssClear.disabled = !has;
      });
      if (btnCssApply) btnCssApply.addEventListener("click", function () {
        var css = cssInject ? (cssInject.value || "") : "";
        if (!css.trim()) { devmodStatus("devmodCssStatus", "Type some CSS first.", "warn"); return; }
        devModMsg({ action: "csstoolsApply", css: css }, function (res, err) {
          if (err || !res || !res.success) {
            devmodStatus("devmodCssStatus", (err || (res && res.error)) || "Could not apply the CSS.", "error");
            return;
          }
          devmodStatus("devmodCssStatus", "Temporary CSS applied (" + res.chars + " chars) \u2014 reload the page to restore.", "ok");
        });
      });
      if (btnCssClear) btnCssClear.addEventListener("click", function () {
        devModMsg({ action: "csstoolsClear" }, function (res, err) {
          if (err || !res || !res.success) {
            devmodStatus("devmodCssStatus", (err || (res && res.error)) || "Could not clear the CSS.", "error");
            return;
          }
          if (cssInject) cssInject.value = "";
          if (btnCssApply) btnCssApply.disabled = true;
          if (btnCssClear) btnCssClear.disabled = true;
          devmodStatus("devmodCssStatus", "Temporary CSS removed.", "ok");
        });
      });
      if (btnCssApply) btnCssApply.disabled = true;
      if (btnCssClear) btnCssClear.disabled = true;
    }

    var btnForms = document.getElementById("devmodBtnForms");
    if (btnForms && !btnForms.getAttribute("data-wired")) {
      btnForms.setAttribute("data-wired", "1");
      btnForms.addEventListener("click", function () {
        devmodStatus("devmodFormsStatus", "Reading forms\u2026", "busy");
        btnForms.disabled = true;
        devModMsg({ action: "formstoolsList" }, function (res, err) {
          btnForms.disabled = false;
          if (err || !res || !res.success) {
            devmodStatus("devmodFormsStatus", (err || (res && res.error)) || "Could not read forms.", "error");
            return;
          }
          devmodStatus("devmodFormsStatus", "Done \u2014 " + res.data.total + " form(s) found. Testing never submits.", "ok");
          renderFormsResults(res.data);
        });
      });
    }

    var btnImages = document.getElementById("devmodBtnImages");
    if (btnImages && !btnImages.getAttribute("data-wired")) {
      btnImages.setAttribute("data-wired", "1");
      btnImages.addEventListener("click", function () {
        devmodStatus("devmodImagesStatus", "Scanning images\u2026", "busy");
        btnImages.disabled = true;
        devModMsg({ action: "imagetoolsList" }, function (res, err) {
          btnImages.disabled = false;
          if (err || !res || !res.success) {
            devmodStatus("devmodImagesStatus", (err || (res && res.error)) || "Could not scan images.", "error");
            return;
          }
          devmodStatus("devmodImagesStatus", "Done \u2014 " + res.data.total + " image(s) found. Click a row to locate it.", "ok");
          renderImageResults(res.data);
        });
      });
    }

    var btnImgHideAll = document.getElementById("devmodBtnImgHideAll");
    var btnImgShowAll = document.getElementById("devmodBtnImgShowAll");
    function imgAllAction(action, busy, okMsg) {
      devmodStatus("devmodImagesStatus", busy, "busy");
      devModMsg({ action: action }, function (res, err) {
        if (err || !res || !res.success) {
          devmodStatus("devmodImagesStatus", (err || (res && res.error)) || "Could not update images.", "error");
          return;
        }
        devmodStatus("devmodImagesStatus", okMsg.replace("{n}", res.count || res.total || 0), "ok");
        devModMsg({ action: "imagetoolsList" }, function (r2) {
          if (r2 && r2.success) renderImageResults(r2.data);
        });
      });
    }
    if (btnImgHideAll && !btnImgHideAll.getAttribute("data-wired")) {
      btnImgHideAll.setAttribute("data-wired", "1");
      btnImgHideAll.addEventListener("click", function () {
        imgAllAction("imagetoolsHideAll", "Hiding all images\u2026", "Hidden {n} image(s) on the page \u2014 reload restores them.");
      });
    }
    if (btnImgShowAll && !btnImgShowAll.getAttribute("data-wired")) {
      btnImgShowAll.setAttribute("data-wired", "1");
      btnImgShowAll.addEventListener("click", function () {
        imgAllAction("imagetoolsShowAll", "Showing all images\u2026", "Shown {n} image(s) again on the page.");
      });
    }

    var btnOn = document.getElementById("devmodBtnSmOn");
    var btnOff = document.getElementById("devmodBtnSmOff");
    if (btnOn && !btnOn.getAttribute("data-wired")) {
      btnOn.setAttribute("data-wired", "1");
      btnOn.addEventListener("click", function () {
        devModMsg({ action: "stylemark", enable: true }, function (res, err) {
          if (err || !res || !res.success) {
            devmodStatus("devmodSmStatus", (err || (res && res.error)) || "Could not enable Style Mark.", "error");
            return;
          }
          btnOn.disabled = true;
          if (btnOff) btnOff.disabled = false;
          devmodStatus("devmodSmStatus", "Inspector is active on the page. Click any element there to inspect it.");
        });
      });
      if (btnOff) {
        btnOff.addEventListener("click", function () {
          devModMsg({ action: "stylemark", enable: false }, function (res, err) {
            btnOn.disabled = false;
            btnOff.disabled = true;
            if (err || !res || !res.success) {
              devmodStatus("devmodSmStatus", (err || (res && res.error)) || "Could not disable Style Mark.", "error");
              return;
            }
            devmodStatus("devmodSmStatus", "Style Mark exited.");
          });
        });
      }
    }

    var btnJsScan = document.getElementById("devmodBtnJs");
    var btnJsLive = document.getElementById("devmodBtnJsLive");
    if (btnJsScan && !btnJsScan.getAttribute("data-wired")) {
      btnJsScan.setAttribute("data-wired", "1");
      btnJsScan.addEventListener("click", function () {
        devmodStatus("devmodJsStatus", "Scanning script tags\u2026", "busy");
        scanScripts(false);
        if (btnJsLive) btnJsLive.disabled = false;
      });
    }
    if (btnJsLive && !btnJsLive.getAttribute("data-wired")) {
      btnJsLive.setAttribute("data-wired", "1");
      btnJsLive.addEventListener("click", function () {
        toggleScriptLive(btnJsScan, btnJsLive);
      });
    }

    var summaryBox = document.getElementById("devmodLinksSummary");
    if (summaryBox && !summaryBox.getAttribute("data-wired")) {
      summaryBox.setAttribute("data-wired", "1");
      summaryBox.addEventListener("click", function (ev) {
        var chip = ev.target && ev.target.closest ? ev.target.closest(".devmod-chips-chip") : null;
        if (!chip || !lastLinkResults) return;
        linkFilter = chip.getAttribute("data-filter") || "all";
        summaryBox.querySelectorAll(".devmod-chips-chip").forEach(function (c) { c.classList.remove("active"); });
        chip.classList.add("active");
        renderLinkResults(lastLinkResults);
      });
    }

    var resultsBox = document.getElementById("devmodLinksResults");
    if (resultsBox && !resultsBox.getAttribute("data-wired")) {
      resultsBox.setAttribute("data-wired", "1");
      resultsBox.addEventListener("click", function (ev) {
        var item = ev.target && ev.target.closest ? ev.target.closest(".devmod-link-item") : null;
        if (!item) return;
        var act = ev.target.closest ? ev.target.closest(".devmod-act") : null;
        var sel = item.getAttribute("data-selector") || "";
        if (act) {
          var action = act.getAttribute("data-action");
          if (action === "open") {
            var urlEl = item.querySelector(".devmod-url");
            var url = (urlEl && urlEl.getAttribute("title")) || (urlEl ? urlEl.textContent : "") || "";
            if (url) openUrlInNewTab(url);
            return;
          }
          if (action === "copy-url") {
            var urlEl2 = item.querySelector(".devmod-url");
            var url2 = (urlEl2 && urlEl2.getAttribute("title")) || (urlEl2 ? urlEl2.textContent : "") || "";
            if (url2) {
              popupCopy(url2, function (ok) {
                act.textContent = ok ? "Copied \u2713" : "Copy failed";
                setTimeout(function () { act.textContent = "Copy URL"; }, 1400);
              });
            }
            return;
          }
          if (action === "copy-sel") {
            if (sel) {
              popupCopy(sel, function (ok) {
                act.textContent = ok ? "Copied \u2713" : "Copy failed";
                setTimeout(function () { act.textContent = "Copy selector"; }, 1400);
              });
            }
            return;
          }
          if (action === "locate") {
            locateLinkRow(item, "devmodLinksStatus");
            return;
          }
          return;
        }
        locateLinkRow(item, "devmodLinksStatus");
      });
      resultsBox.addEventListener("keydown", function (ev) {
        if (ev.key !== "Enter" && ev.key !== " ") return;
        var targetTag = ev.target && ev.target.tagName;
        if (targetTag === "BUTTON") return;
        var item = ev.target && ev.target.closest ? ev.target.closest(".devmod-link-item") : null;
        if (!item) return;
        ev.preventDefault();
        item.click();
      });
    }
  }

  wireDevMod();
  wireElementorInspector();
  window.addEventListener("unload", function () {
    if (mediaTrackOn) devModMsg({ action: "mediatrack", enable: false }, function () {});
    mediaPollStop();
  });
})();
