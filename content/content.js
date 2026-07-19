(() => {
  // Shut down any previous inject (extension reload / reinject)
  window.dispatchEvent(new Event("scqol:shutdown"));

  const PRESETS = [15, 30, 45, 60, 90, 120];
  const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];
  const STRINGS = {
    en: {
      sleepTimer: "Sleep timer",
      sleepHint: "Pause SoundCloud when the timer ends.",
      customMinutes: "Custom minutes",
      set: "Set",
      clear: "Clear",
      close: "Close",
      stopAfter: "Stop after this track",
      stopAfterOn: "Will stop after this track",
      stopAfterOff: "Stop after track cleared",
      timerSet: (m) => `Sleep timer set for ${m} min`,
      timerCleared: "Sleep timer cleared",
      timerFired: "Sleep timer — playback paused",
      timerRunning: "Sleep timer running — click to change",
      speed: "Speed",
      speedHint: "Change playback rate for the current track.",
      focusOn: "Focus mode on",
      focusOff: "Focus mode off",
      loopOn: "Loop on",
      loopOff: "Loop off",
      muteOn: "Muted",
      muteOff: "Unmuted",
      copied: "Track copied",
      copiedStamp: "Link with timestamp copied",
      copyFail: "Could not copy",
      shortcutsTitle: "Shortcuts",
      shortcuts: [
        ["T", "Sleep timer"],
        ["E", "Stop after track"],
        ["F", "Focus mode"],
        ["L", "Loop track"],
        ["M", "Mute"],
        ["C", "Copy track"],
        ["⇧C", "Copy with timestamp"],
        ["[ ]", "Seek ±10s"],
        ["- =", "Speed"],
        ["?", "Help"],
      ],
    },
    fr: {
      sleepTimer: "Minuteur",
      sleepHint: "Met la lecture en pause à la fin du minuteur.",
      customMinutes: "Minutes",
      set: "OK",
      clear: "Effacer",
      close: "Fermer",
      stopAfter: "Stop après ce titre",
      stopAfterOn: "Stop après ce titre activé",
      stopAfterOff: "Stop après titre désactivé",
      timerSet: (m) => `Minuteur : ${m} min`,
      timerCleared: "Minuteur effacé",
      timerFired: "Minuteur — lecture en pause",
      timerRunning: "Minuteur actif — cliquer pour changer",
      speed: "Vitesse",
      speedHint: "Change la vitesse de lecture.",
      focusOn: "Mode focus activé",
      focusOff: "Mode focus désactivé",
      loopOn: "Boucle activée",
      loopOff: "Boucle désactivée",
      muteOn: "Muet",
      muteOff: "Son réactivé",
      copied: "Titre copié",
      copiedStamp: "Lien avec timestamp copié",
      copyFail: "Copie impossible",
      shortcutsTitle: "Raccourcis",
      shortcuts: [
        ["T", "Minuteur"],
        ["E", "Stop après titre"],
        ["F", "Mode focus"],
        ["L", "Boucle"],
        ["M", "Muet"],
        ["C", "Copier le titre"],
        ["⇧C", "Copier avec timestamp"],
        ["[ ]", "Seek ±10s"],
        ["- =", "Vitesse"],
        ["?", "Aide"],
      ],
    },
  };

  const ICONS = {
    timer: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.8"/><path d="M12 8v4.5l2.5 1.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M9 3.5h6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
    focus: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    loop: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M17 3l3 3-3 3M7 21l-3-3 3-3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 6H9a5 5 0 000 10h1M4 18h11a5 5 0 000-10h-1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    mute: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 10v4h3l4 3V7L7 10H4z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
    unmute: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 10v4h3l4 3V7L7 10H4z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M16 8.5a4.5 4.5 0 010 7M18.5 6a8 8 0 010 12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  };

  let locale = "en";
  let t = STRINGS.en;
  let timerEndAt = null;
  let stopAfterTrack = false;
  let stopAfterKey = "";
  let focusMode = false;
  let loopMode = false;
  let muted = false;
  let playbackRate = 1;
  let tickInterval = null;
  let publishInterval = null;
  let lastTrackKey = "";
  let lastIdentity = "";
  let lastPublishedSig = "";
  let trackStartedAt = Date.now();
  let dead = false;
  let observer = null;
  let mediaBound = null;
  let publishTimer = null;

  function extensionOk() {
    try {
      return Boolean(chrome.runtime?.id);
    } catch {
      return false;
    }
  }

  function teardown() {
    if (dead) return;
    dead = true;
    if (tickInterval) clearInterval(tickInterval);
    if (publishInterval) clearInterval(publishInterval);
    if (publishTimer) clearTimeout(publishTimer);
    if (controlsTimer) clearTimeout(controlsTimer);
    tickInterval = null;
    publishInterval = null;
    publishTimer = null;
    controlsTimer = null;
    try {
      observer?.disconnect();
    } catch {
      // ignore
    }
  }

  window.addEventListener("scqol:shutdown", teardown, { once: true });

  function send(type, payload = {}) {
    if (dead || !extensionOk()) {
      teardown();
      return Promise.resolve(null);
    }
    try {
      return chrome.runtime.sendMessage({ type, ...payload }).catch((err) => {
        if (String(err?.message || err).includes("Extension context invalidated")) teardown();
        return null;
      });
    } catch {
      teardown();
      return Promise.resolve(null);
    }
  }

  function storageSet(values) {
    if (dead || !extensionOk()) {
      teardown();
      return;
    }
    try {
      chrome.storage.local.set(values);
    } catch {
      teardown();
    }
  }

  function applyLocale(code) {
    locale = code === "fr" ? "fr" : "en";
    t = STRINGS[locale];
  }

  function parseTime(text) {
    if (!text) return 0;
    const parts = text.trim().split(":").map(Number);
    if (parts.some((n) => Number.isNaN(n))) return 0;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return parts[0] || 0;
  }

  function getAudio() {
    return document.querySelector("audio, video");
  }

  function optimizeArtworkUrl(url) {
    if (!url) return "";
    let out = url.trim();
    // Prefer a crisp square for Discord / media session
    out = out.replace(/-t\d+x\d+\./, "-t500x500.");
    out = out.replace(/\/\d+x\d+\//, "/500x500/");
    out = out.replace(/(\D)\d+x\d+(\.|$)/, "$1500x500$2");
    out = out.replace("-large.", "-t500x500.");
    out = out.replace("-badge.", "-t500x500.");
    out = out.replace(/^http:\/\//i, "https://");
    return out;
  }

  function readTrack() {
    const playControls = document.querySelector(".playControls, .playbackSoundBadge");
    const titleEl = document.querySelector(
      ".playbackSoundBadge__titleLink, .playControls__soundBadge .playbackSoundBadge__titleLink, a.playbackSoundBadge__titleLink"
    );
    const artistEl = document.querySelector(
      ".playbackSoundBadge__lightLink, .playControls__soundBadge .playbackSoundBadge__lightLink, a.playbackSoundBadge__lightLink"
    );
    if (!titleEl || !artistEl) return null;

    const media = getAudio();
    const playBtn = document.querySelector(".playControls__play, .playControl");
    const titleAttr = (
      playBtn?.getAttribute("title") ||
      playBtn?.getAttribute("aria-label") ||
      ""
    ).toLowerCase();

    let isPlaying = false;
    if (media && Number.isFinite(media.currentTime)) {
      isPlaying = !media.paused && !media.ended;
    } else if (titleAttr.includes("pause")) {
      isPlaying = true;
    } else if (titleAttr.includes("play")) {
      isPlaying = false;
    } else {
      isPlaying = Boolean(
        document.querySelector(".playControls.m-playing") || playBtn?.classList.contains("playing")
      );
    }

    const title = (titleEl.getAttribute("title") || titleEl.textContent || "").trim();
    const artist = (artistEl.getAttribute("title") || artistEl.textContent || "").trim();
    if (!title) return null;

    const artworkRoot = document.querySelector(".playbackSoundBadge__avatar");
    let artworkUrl = "";
    const artworkSpan = artworkRoot?.querySelector(".image__lightOutline span, span[style*='background']");
    if (artworkSpan?.style?.backgroundImage) {
      const match = artworkSpan.style.backgroundImage.match(/url\(["']?(.*?)["']?\)/);
      artworkUrl = match?.[1] || "";
    }
    if (!artworkUrl) {
      artworkUrl = artworkRoot?.querySelector("img")?.src || "";
    }
    artworkUrl = optimizeArtworkUrl(artworkUrl);

    const currentTimeText =
      document.querySelector(".playbackTimeline__timePassed span:last-child")?.textContent || "0:00";
    const durationText =
      document.querySelector(".playbackTimeline__duration span:last-child")?.textContent || "0:00";

    let currentSeconds = parseTime(currentTimeText);
    let durationSeconds = parseTime(durationText);
    if (media && Number.isFinite(media.currentTime)) {
      currentSeconds = media.currentTime;
    }
    if (media && Number.isFinite(media.duration) && media.duration > 0) {
      durationSeconds = media.duration;
    }

    return {
      title,
      artist,
      artworkUrl,
      trackUrl: titleEl.href || location.href,
      artistUrl: artistEl.href || "",
      currentTime: currentTimeText,
      duration: durationText,
      currentSeconds,
      durationSeconds,
      isPlaying,
      identity: `${title}|${artist}`,
    };
  }

  function pausePlayback() {
    const playButton = document.querySelector(".playControls__play");
    if (document.querySelector(".playControls.m-playing") && playButton) playButton.click();
  }

  function toast(message) {
    let el = document.querySelector(".scqol-toast");
    if (!el) {
      el = document.createElement("div");
      el.className = "scqol-toast";
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(el._hide);
    el._hide = setTimeout(() => el.classList.remove("show"), 2200);
  }

  function formatRemaining(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function applyPlaybackRate() {
    const media = getAudio();
    if (media && media.playbackRate !== playbackRate) {
      media.playbackRate = playbackRate;
    }
    const btn = document.querySelector(".scqol-speed-btn");
    if (btn) {
      btn.textContent = `${playbackRate}x`;
      btn.classList.toggle("is-active", playbackRate !== 1);
      btn.title = `${t.speed}: ${playbackRate}x`;
    }
  }

  function applyMediaFlags() {
    const media = getAudio();
    if (!media) return;
    if (media.loop !== loopMode) media.loop = loopMode;
    if (media.muted !== muted) media.muted = muted;
    if (media.playbackRate !== playbackRate) media.playbackRate = playbackRate;
  }

  function setPlaybackRate(rate) {
    playbackRate = rate;
    applyPlaybackRate();
    storageSet({ playbackRate });
    toast(`${t.speed}: ${rate}x`);
  }

  function cycleSpeed(dir) {
    const idx = SPEEDS.indexOf(playbackRate);
    const next = SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, (idx === -1 ? 1 : idx) + dir))];
    setPlaybackRate(next);
  }

  function seekBy(seconds) {
    const media = getAudio();
    if (!media || !Number.isFinite(media.currentTime)) return;
    media.currentTime = Math.max(0, Math.min((media.duration || 1e9) - 0.25, media.currentTime + seconds));
  }

  function setFocusMode(on, silent = false) {
    focusMode = Boolean(on);
    document.documentElement.classList.toggle("scqol-focus", focusMode);
    document.querySelector(".scqol-focus-btn")?.classList.toggle("is-active", focusMode);
    storageSet({ focusMode });
    if (!silent) toast(focusMode ? t.focusOn : t.focusOff);
  }

  function setLoopMode(on, silent = false) {
    loopMode = Boolean(on);
    const media = getAudio();
    if (media) media.loop = loopMode;
    document.querySelector(".scqol-loop-btn")?.classList.toggle("is-active", loopMode);
    storageSet({ loopMode });
    if (!silent) toast(loopMode ? t.loopOn : t.loopOff);
  }

  function setMuted(on, silent = false) {
    muted = Boolean(on);
    const media = getAudio();
    if (media) media.muted = muted;
    const btn = document.querySelector(".scqol-mute-btn");
    if (btn) {
      btn.classList.toggle("is-active", muted);
      btn.innerHTML = muted ? ICONS.mute : ICONS.unmute;
      btn.title = muted ? t.muteOn : t.muteOff;
    }
    storageSet({ muted });
    if (!silent) toast(muted ? t.muteOn : t.muteOff);
  }

  function rememberTrack(track) {
    if (!track?.title) return;
    send("RECENT_TRACK", {
      item: {
        title: track.title,
        artist: track.artist,
        url: track.trackUrl,
        at: Date.now(),
      },
    });
  }

  function updateTimerButton() {
    const btn = document.querySelector(".scqol-timer-btn");
    if (!btn) return;
    if (stopAfterTrack) {
      btn.classList.add("is-active");
      btn.innerHTML = `<span class="scqol-btn-label">1▶</span>`;
      btn.title = t.stopAfterOn;
      return;
    }
    if (timerEndAt && timerEndAt > Date.now()) {
      btn.classList.add("is-active");
      btn.innerHTML = `<span class="scqol-btn-label">${formatRemaining(timerEndAt - Date.now())}</span>`;
      btn.title = t.timerRunning;
      return;
    }
    btn.classList.remove("is-active");
    btn.innerHTML = ICONS.timer;
    btn.title = t.sleepTimer;
  }

  function mountOverlay(panel) {
    closeOverlay();
    const overlay = document.createElement("div");
    overlay.className = "scqol-overlay";
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeOverlay();
    });
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    return overlay;
  }

  function panelShell(title, hint) {
    const panel = document.createElement("div");
    panel.className = "scqol-panel";
    panel.innerHTML = `
      <div class="scqol-grabber" aria-hidden="true"></div>
      <div class="scqol-panel-head">
        <div>
          <h2>${title}</h2>
          ${hint ? `<p>${hint}</p>` : ""}
        </div>
        <button type="button" class="scqol-x close" aria-label="${t.close}">×</button>
      </div>
      <div class="scqol-panel-body"></div>
    `;
    panel.querySelector(".close").addEventListener("click", closeOverlay);
    return panel;
  }

  function startTick() {
    if (tickInterval || dead) return;
    tickInterval = setInterval(() => {
      if (!extensionOk()) {
        teardown();
        return;
      }
      if (timerEndAt && timerEndAt <= Date.now()) {
        timerEndAt = null;
        pausePlayback();
        toast(t.timerFired);
        send("SET_SLEEP_TIMER", { endAt: null });
      }
      applyMediaFlags();
      applyPlaybackRate();
      updateTimerButton();
    }, 1000);
  }

  async function setTimerMinutes(minutes) {
    stopAfterTrack = false;
    stopAfterKey = "";
    if (!minutes || minutes <= 0) {
      timerEndAt = null;
      await send("SET_SLEEP_TIMER", { endAt: null });
      updateTimerButton();
      toast(t.timerCleared);
      return;
    }
    timerEndAt = Date.now() + minutes * 60 * 1000;
    await send("SET_SLEEP_TIMER", { endAt: timerEndAt });
    updateTimerButton();
    startTick();
    toast(t.timerSet(minutes));
  }

  async function enableStopAfterTrack() {
    const track = readTrack();
    timerEndAt = null;
    await send("SET_SLEEP_TIMER", { endAt: null });
    stopAfterTrack = true;
    stopAfterKey = track?.identity || "";
    updateTimerButton();
    toast(t.stopAfterOn);
    closeOverlay();
  }

  function closeOverlay() {
    document.querySelector(".scqol-overlay")?.remove();
  }

  function openTimerPanel() {
    const panel = panelShell(t.sleepTimer, t.sleepHint);
    const body = panel.querySelector(".scqol-panel-body");
    body.innerHTML = `
      <div class="scqol-grid"></div>
      <div class="scqol-custom">
        <input type="number" min="1" max="600" placeholder="${t.customMinutes}" />
        <button type="button" class="primary set-custom">${t.set}</button>
      </div>
      <div class="scqol-divider"></div>
      <div class="scqol-actions">
        <button type="button" class="stop-after">${t.stopAfter}</button>
      </div>
      <div class="scqol-actions">
        <button type="button" class="danger clear">${t.clear}</button>
        <button type="button" class="ghost close-secondary">${t.close}</button>
      </div>
    `;

    const grid = body.querySelector(".scqol-grid");
    for (const minutes of PRESETS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = minutes >= 60 ? `${minutes / 60}h` : `${minutes}m`;
      if (minutes === 30) btn.classList.add("primary");
      btn.addEventListener("click", async () => {
        await setTimerMinutes(minutes);
        closeOverlay();
      });
      grid.appendChild(btn);
    }

    body.querySelector(".set-custom").addEventListener("click", async () => {
      const value = Number(body.querySelector("input").value);
      if (!value || value < 1) return;
      await setTimerMinutes(value);
      closeOverlay();
    });
    body.querySelector(".stop-after").addEventListener("click", () => enableStopAfterTrack());
    body.querySelector(".clear").addEventListener("click", async () => {
      stopAfterTrack = false;
      stopAfterKey = "";
      await setTimerMinutes(0);
      closeOverlay();
    });
    body.querySelector(".close-secondary").addEventListener("click", closeOverlay);

    mountOverlay(panel);
  }

  function openSpeedPanel() {
    const panel = panelShell(t.speed, t.speedHint);
    const body = panel.querySelector(".scqol-panel-body");
    body.innerHTML = `<div class="scqol-grid"></div>`;
    const grid = body.querySelector(".scqol-grid");
    for (const rate of SPEEDS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = `${rate}x`;
      if (rate === playbackRate) btn.classList.add("primary");
      btn.addEventListener("click", () => {
        setPlaybackRate(rate);
        closeOverlay();
      });
      grid.appendChild(btn);
    }
    mountOverlay(panel);
  }

  function openHelp() {
    const panel = panelShell(t.shortcutsTitle, "");
    const body = panel.querySelector(".scqol-panel-body");
    const list = document.createElement("div");
    list.className = "scqol-shortcuts";
    for (const [key, label] of t.shortcuts) {
      const row = document.createElement("div");
      row.className = "scqol-shortcut";
      row.innerHTML = `<span>${label}</span><kbd>${key}</kbd>`;
      list.appendChild(row);
    }
    body.appendChild(list);
    const actions = document.createElement("div");
    actions.className = "scqol-actions";
    actions.innerHTML = `<button type="button" class="ghost close-secondary">${t.close}</button>`;
    actions.querySelector("button").addEventListener("click", closeOverlay);
    body.appendChild(actions);
    mountOverlay(panel);
  }

  async function copyTrack(withTimestamp = false) {
    const track = readTrack();
    if (!track) return;
    let url = track.trackUrl || location.href;
    if (withTimestamp && track.currentSeconds > 0) {
      url = `${url.split("#")[0]}#t=${Math.floor(track.currentSeconds)}`;
    }
    const text = `${track.title} — ${track.artist}\n${url}`;
    try {
      await navigator.clipboard.writeText(text);
      toast(withTimestamp ? t.copiedStamp : t.copied);
    } catch {
      toast(t.copyFail);
    }
  }

  function ensureControls() {
    const host = document.querySelector(".playControls__elements");
    if (!host) return;

    let group = host.querySelector(".scqol-controls");
    if (!group) {
      group = document.createElement("div");
      group.className = "scqol-controls";
      host.appendChild(group);
    }

    if (!group.querySelector(".scqol-timer-btn")) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "scqol-timer-btn";
      btn.innerHTML = ICONS.timer;
      btn.title = t.sleepTimer;
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        openTimerPanel();
      });
      group.appendChild(btn);
    }

    if (!group.querySelector(".scqol-speed-btn")) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "scqol-speed-btn";
      btn.textContent = `${playbackRate}x`;
      btn.title = t.speed;
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        openSpeedPanel();
      });
      group.appendChild(btn);
    }

    if (!group.querySelector(".scqol-focus-btn")) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "scqol-focus-btn";
      btn.innerHTML = ICONS.focus;
      btn.title = "Focus";
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        setFocusMode(!focusMode);
      });
      group.appendChild(btn);
    }

    if (!group.querySelector(".scqol-loop-btn")) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "scqol-loop-btn";
      btn.innerHTML = ICONS.loop;
      btn.title = "Loop";
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        setLoopMode(!loopMode);
      });
      group.appendChild(btn);
    }

    if (!group.querySelector(".scqol-mute-btn")) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "scqol-mute-btn";
      btn.innerHTML = muted ? ICONS.mute : ICONS.unmute;
      btn.title = muted ? t.muteOn : t.muteOff;
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        setMuted(!muted);
      });
      group.appendChild(btn);
    }

    updateTimerButton();
    applyPlaybackRate();
    document.querySelector(".scqol-focus-btn")?.classList.toggle("is-active", focusMode);
    document.querySelector(".scqol-loop-btn")?.classList.toggle("is-active", loopMode);
    document.querySelector(".scqol-mute-btn")?.classList.toggle("is-active", muted);
  }

  function updateMediaSession(track) {
    if (!("mediaSession" in navigator) || !track) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: track.artist,
        album: "SoundCloud",
        artwork: track.artworkUrl
          ? [{ src: track.artworkUrl, sizes: "500x500", type: "image/jpeg" }]
          : [],
      });
      navigator.mediaSession.playbackState = track.isPlaying ? "playing" : "paused";
    } catch {
      // ignore
    }
  }

  function publishTrack(reason = "poll") {
    if (dead || !extensionOk()) {
      teardown();
      return;
    }
    bindMediaEvents();
    const track = readTrack();
    if (!track) return;

    if (stopAfterTrack && stopAfterKey && track.identity !== stopAfterKey) {
      stopAfterTrack = false;
      stopAfterKey = "";
      pausePlayback();
      updateTimerButton();
      toast(t.timerFired);
    }

    if (track.identity !== lastIdentity) {
      trackStartedAt = Date.now() - track.currentSeconds * 1000;
      lastIdentity = track.identity;
      if (stopAfterTrack && !stopAfterKey) stopAfterKey = track.identity;
      rememberTrack(track);
    } else if (reason === "seek" || reason === "play") {
      trackStartedAt = Date.now() - track.currentSeconds * 1000;
    }

    const key = `${track.identity}|${track.isPlaying}`;
    lastTrackKey = key;

    // Signature for dedupe: play-state / track / coarse seek (5s buckets)
    const seekBucket = Math.floor((track.currentSeconds || 0) / 5);
    const sig = `${key}|${seekBucket}|${Math.floor(track.durationSeconds || 0)}`;
    const important = reason === "play" || reason === "pause" || reason === "seek" || reason === "ended" || reason === "track";
    if (!important && sig === lastPublishedSig) return;
    lastPublishedSig = sig;

    applyMediaFlags();
    applyPlaybackRate();
    const payload = { ...track, startedAt: trackStartedAt, reason };
    updateMediaSession(payload);
    send("TRACK_UPDATE", { track: payload });
  }

  function schedulePublish(reason) {
    if (publishTimer) clearTimeout(publishTimer);
    // Pause/ended = immediate; others micro-debounce DOM churn
    const delay = reason === "pause" || reason === "ended" ? 0 : 80;
    publishTimer = setTimeout(() => publishTrack(reason), delay);
  }

  function bindMediaEvents() {
    const media = getAudio();
    if (!media || media === mediaBound) {
      applyMediaFlags();
      return;
    }
    mediaBound = media;
    applyMediaFlags();
    const bump = (reason) => () => schedulePublish(reason);
    media.addEventListener("play", bump("play"));
    media.addEventListener("playing", bump("play"));
    media.addEventListener("pause", bump("pause"));
    media.addEventListener("ended", bump("ended"));
    media.addEventListener("seeked", bump("seek"));
    media.addEventListener("loadedmetadata", bump("track"));
  }

  function isTypingTarget(el) {
    if (!el) return false;
    const tag = el.tagName;
    return (
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      tag === "SELECT" ||
      el.isContentEditable
    );
  }

  document.addEventListener("keydown", (e) => {
    if (dead || !extensionOk()) {
      teardown();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (isTypingTarget(e.target)) return;

    switch (e.key) {
      case "t":
      case "T":
        e.preventDefault();
        openTimerPanel();
        break;
      case "e":
      case "E":
        e.preventDefault();
        if (stopAfterTrack) {
          stopAfterTrack = false;
          stopAfterKey = "";
          updateTimerButton();
          toast(t.stopAfterOff);
        } else {
          enableStopAfterTrack();
        }
        break;
      case "f":
      case "F":
        e.preventDefault();
        setFocusMode(!focusMode);
        break;
      case "l":
      case "L":
        e.preventDefault();
        setLoopMode(!loopMode);
        break;
      case "m":
      case "M":
        e.preventDefault();
        setMuted(!muted);
        break;
      case "c":
      case "C":
        e.preventDefault();
        copyTrack(e.shiftKey);
        break;
      case "[":
        e.preventDefault();
        seekBy(-10);
        break;
      case "]":
        e.preventDefault();
        seekBy(10);
        break;
      case "-":
      case "_":
        e.preventDefault();
        cycleSpeed(-1);
        break;
      case "=":
      case "+":
        e.preventDefault();
        cycleSpeed(1);
        break;
      case "?":
        e.preventDefault();
        openHelp();
        break;
      default:
        break;
    }
  });

  try {
    chrome.runtime.onMessage.addListener((message) => {
      if (dead || !extensionOk()) {
        teardown();
        return;
      }
      if (message?.type === "SLEEP_TIMER_CHANGED") {
        timerEndAt = message.endAt;
        if (timerEndAt) stopAfterTrack = false;
        updateTimerButton();
        if (timerEndAt) startTick();
      }
      if (message?.type === "SLEEP_TIMER_FIRE") {
        timerEndAt = null;
        pausePlayback();
        updateTimerButton();
        toast(t.timerFired);
      }
      if (message?.type === "SETTINGS_CHANGED" && message.settings) {
        if (message.settings.locale) applyLocale(message.settings.locale);
        updateTimerButton();
      }
    });
  } catch {
    teardown();
  }

  Promise.all([
    send("GET_SLEEP_TIMER"),
    send("GET_SETTINGS"),
    extensionOk()
      ? chrome.storage.local
          .get({ focusMode: false, loopMode: false, muted: false, playbackRate: 1 })
          .catch(() => ({}))
      : Promise.resolve({}),
  ])
    .then(([timerRes, settingsRes, local]) => {
      if (dead || !extensionOk()) {
        teardown();
        return;
      }
      applyLocale(settingsRes?.settings?.locale || "en");
      focusMode = Boolean(local?.focusMode);
      loopMode = Boolean(local?.loopMode);
      muted = Boolean(local?.muted);
      playbackRate = Number(local?.playbackRate) || 1;
      setFocusMode(focusMode, true);
      setLoopMode(loopMode, true);
      setMuted(muted, true);
      applyMediaFlags();
      applyPlaybackRate();
      ensureControls();

      if (timerRes?.endAt) {
        timerEndAt = timerRes.endAt;
        if (timerEndAt > Date.now()) startTick();
        else timerEndAt = null;
      }
      updateTimerButton();
    })
    .catch(() => teardown());

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (dead || !extensionOk()) {
        teardown();
        return;
      }
      if (area === "sync" && changes.locale) {
        applyLocale(changes.locale.newValue || "en");
        updateTimerButton();
      }
    });
  } catch {
    teardown();
  }

  let controlsTimer = null;

  function scheduleEnsureControls() {
    if (controlsTimer) return;
    controlsTimer = setTimeout(() => {
      controlsTimer = null;
      if (dead || !extensionOk()) {
        teardown();
        return;
      }
      ensureControls();
      bindMediaEvents();
    }, 400);
  }

  // Lightweight observer: only watch for player chrome appearing — NOT every class flip
  // (attribute + subtree observation pegged SoundCloud.app / Chrome at ~100% CPU)
  observer = new MutationObserver(() => {
    if (dead || !extensionOk()) {
      teardown();
      return;
    }
    scheduleEnsureControls();
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  ensureControls();
  bindMediaEvents();
  startTick();
  // Poll play-state / track changes; media events handle instant pause/play
  publishInterval = setInterval(() => publishTrack("poll"), 2000);
  publishTrack("track");
})();
