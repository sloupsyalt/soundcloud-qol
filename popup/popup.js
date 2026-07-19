function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, "&#39;");
}

function formatClock(totalSeconds) {
  const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function formatRemaining(endAt) {
  if (!endAt || endAt <= Date.now()) return null;
  const total = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function relativeTime(at) {
  const diff = Math.max(0, Date.now() - (Number(at) || 0));
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/** Preserved Discord RPC status labels (unchanged behavior) */
function discordLabel(discord, settings) {
  if (!settings?.discordEnabled) return "Disabled";
  if (!settings?.hasBridgeToken && !settings?.bridgeToken) return "Needs bridge token";
  if (discord?.connected) return discord.error ? `Bridge: ${discord.error}` : "Connected";
  return discord?.error || "Bridge not running";
}

function cmd(action, payload = {}) {
  return chrome.runtime.sendMessage({ type: "POPUP_COMMAND", action, payload });
}

function renderNow(track) {
  const empty = document.getElementById("now-empty");
  const active = document.getElementById("now-active");
  const fresh = track && Date.now() - (track.updatedAt || 0) < 15000;

  if (!track?.title) {
    empty.hidden = false;
    active.hidden = true;
    document.getElementById("live-dot").classList.remove("on");
    document.getElementById("ext-status").textContent = "Waiting for SoundCloud";
    return;
  }

  empty.hidden = true;
  active.hidden = false;
  document.getElementById("now-title").textContent = track.title;
  document.getElementById("now-artist").textContent = track.artist || "Unknown artist";
  document.getElementById("now-current").textContent = formatClock(track.currentSeconds);
  document.getElementById("now-duration").textContent = formatClock(track.durationSeconds);
  const pct =
    track.durationSeconds > 0
      ? Math.min(100, (100 * (track.currentSeconds || 0)) / track.durationSeconds)
      : 0;
  document.getElementById("now-progress").style.width = `${pct}%`;
  document.getElementById("now-progress-wrap").setAttribute("aria-valuenow", String(Math.round(pct)));
  const art = document.getElementById("now-art");
  art.style.backgroundImage = track.artworkUrl ? `url("${escapeAttr(track.artworkUrl)}")` : "";
  document.getElementById("live-dot").classList.toggle("on", Boolean(fresh || track.isPlaying));
  document.getElementById("ext-status").textContent = track.isPlaying ? "Playing" : "Paused";
}

function renderTimer(timer) {
  const active = document.getElementById("timer-active");
  const label = document.getElementById("timer-label");
  const remaining = formatRemaining(timer?.endAt);

  document.querySelectorAll("#timer-presets .chip").forEach((el) => el.classList.remove("is-active"));

  if (timer?.stopAfter) {
    active.hidden = true;
    label.textContent = "End of track";
    label.classList.add("active");
    document.querySelector('[data-stop-after="1"]')?.classList.add("is-active");
    return;
  }

  if (remaining) {
    active.hidden = false;
    label.textContent = "Active";
    label.classList.add("active");
    document.getElementById("timer-remaining").textContent = remaining;
    const duration = Number(timer.durationMs) || 0;
    const started = Number(timer.startedAt) || Date.now();
    const elapsed = Date.now() - started;
    const pct = duration > 0 ? Math.min(100, Math.max(0, 100 - (100 * (timer.endAt - Date.now())) / duration)) : 0;
    document.getElementById("timer-progress").style.width = `${pct}%`;
    void elapsed;
  } else {
    active.hidden = true;
    label.textContent = "Off";
    label.classList.remove("active");
  }
}

function renderSpeed(rate) {
  const r = Number(rate) || 1;
  document.querySelectorAll("#speed-presets .seg-btn").forEach((btn) => {
    btn.classList.toggle("is-active", Number(btn.dataset.rate) === r);
  });
}

function renderFocus(on) {
  const btn = document.getElementById("toggle-focus");
  btn.setAttribute("aria-pressed", on ? "true" : "false");
}

function renderRecent(items) {
  const list = document.getElementById("recent-list");
  if (!items?.length) {
    list.innerHTML = `<li class="empty">Nothing yet</li>`;
    return;
  }
  list.innerHTML = items
    .slice(0, 5)
    .map((item) => {
      const title = escapeHtml(item.title || "Untitled");
      const artist = escapeHtml(item.artist || "");
      const when = escapeHtml(relativeTime(item.at));
      const url = item.url ? escapeAttr(item.url) : "";
      const art = item.artworkUrl
        ? `style="background-image:url('${escapeAttr(item.artworkUrl)}')"`
        : "";
      const body = `
        <span class="recent-art" ${art} aria-hidden="true"></span>
        <span class="recent-meta">
          <span class="recent-title">${title}</span>
          <span class="recent-sub">${artist}${artist ? " · " : ""}${when}</span>
        </span>`;
      if (url) {
        return `<li><a href="${url}" target="_blank" rel="noopener noreferrer">${body}</a></li>`;
      }
      return `<li><div class="row">${body}</div></li>`;
    })
    .join("");
}

function showCopyFeedback(text) {
  const el = document.getElementById("copy-feedback");
  el.hidden = false;
  el.textContent = text;
  clearTimeout(showCopyFeedback._t);
  showCopyFeedback._t = setTimeout(() => {
    el.hidden = true;
  }, 1800);
}

async function refresh() {
  const state = await chrome.runtime.sendMessage({ type: "GET_POPUP_STATE" });
  if (!state?.ok) return;

  const version = state.version || chrome.runtime.getManifest().version;
  document.getElementById("version").textContent = `v${version}`;
  document.getElementById("footer-version").textContent = `v${version}`;

  if (state.settings?.density === "comfortable") {
    document.body.classList.add("density-comfortable");
  } else {
    document.body.classList.remove("density-comfortable");
  }

  renderNow(state.track);
  renderTimer(state.timer || {});
  renderSpeed(state.settings?.playbackRate);
  renderFocus(Boolean(state.settings?.focusMode));
  renderRecent(state.recentTracks || []);

  document.getElementById("discord-status").textContent = discordLabel(
    state.discord,
    state.settings
  );
}

async function setTimerMinutes(minutes) {
  if (!minutes || minutes <= 0) {
    await chrome.runtime.sendMessage({ type: "SET_SLEEP_TIMER", endAt: null });
  } else {
    const endAt = Date.now() + minutes * 60 * 1000;
    await chrome.runtime.sendMessage({ type: "SET_SLEEP_TIMER", endAt });
  }
  await cmd("syncTimer");
  await refresh();
}

document.getElementById("timer-presets").addEventListener("click", async (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  if (btn.id === "timer-custom") {
    const row = document.getElementById("custom-row");
    row.hidden = !row.hidden;
    if (!row.hidden) document.getElementById("custom-minutes").focus();
    return;
  }
  if (btn.dataset.stopAfter) {
    await chrome.runtime.sendMessage({ type: "SET_STOP_AFTER" });
    await cmd("stopAfter");
    await refresh();
    return;
  }
  const minutes = Number(btn.dataset.minutes);
  if (minutes) await setTimerMinutes(minutes);
});

document.getElementById("custom-set").addEventListener("click", async () => {
  const minutes = Number(document.getElementById("custom-minutes").value);
  if (!minutes || minutes < 1) return;
  document.getElementById("custom-row").hidden = true;
  await setTimerMinutes(minutes);
});

document.getElementById("timer-cancel").addEventListener("click", async () => {
  await setTimerMinutes(0);
  await cmd("clearTimer");
});

document.getElementById("speed-presets").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-rate]");
  if (!btn) return;
  const rate = Number(btn.dataset.rate);
  await chrome.storage.local.set({ playbackRate: rate });
  await cmd("setSpeed", { rate });
  renderSpeed(rate);
});

document.getElementById("toggle-focus").addEventListener("click", async () => {
  const btn = document.getElementById("toggle-focus");
  const next = btn.getAttribute("aria-pressed") !== "true";
  await chrome.storage.local.set({ focusMode: next });
  await cmd("setFocus", { on: next });
  renderFocus(next);
});

document.getElementById("copy-stamp").addEventListener("click", async () => {
  const res = await cmd("copyTimestamp");
  const stamp = res?.stamp || "copied";
  showCopyFeedback(`Copied ${stamp}`);
});

document.getElementById("show-shortcuts").addEventListener("click", () => {
  document.getElementById("shortcuts-sheet").showModal();
});

document.getElementById("close-shortcuts").addEventListener("click", () => {
  document.getElementById("shortcuts-sheet").close();
});

function openSettings() {
  chrome.runtime.openOptionsPage();
}

document.getElementById("open-settings").addEventListener("click", openSettings);
document.getElementById("open-settings-2").addEventListener("click", openSettings);

document.getElementById("reconnect").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "DISCORD_RECONNECT" });
  await refresh();
});

document.getElementById("clear-recent").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "CLEAR_RECENT" });
  await refresh();
});

refresh();
setInterval(refresh, 1000);
