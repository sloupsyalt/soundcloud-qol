const els = {
  locale: document.getElementById("locale"),
  defaultPlaybackRate: document.getElementById("defaultPlaybackRate"),
  timerEndBehavior: document.getElementById("timerEndBehavior"),
  discordEnabled: document.getElementById("discordEnabled"),
  bridgeToken: document.getElementById("bridgeToken"),
  discordClientId: document.getElementById("discordClientId"),
  density: document.getElementById("density"),
  reducedMotion: document.getElementById("reducedMotion"),
  recentHistoryEnabled: document.getElementById("recentHistoryEnabled"),
  status: document.getElementById("status"),
  saveStatus: document.getElementById("save-status"),
  discordStatus: document.getElementById("discord-status"),
};

function discordLabel(discord, settings) {
  if (!settings?.discordEnabled) return "Disabled";
  if (!settings?.hasBridgeToken && !els.bridgeToken.value.trim()) return "Needs bridge token";
  if (discord?.connected) return discord.error ? `Bridge: ${discord.error}` : "Connected";
  return discord?.error || "Bridge not running";
}

function setActiveNav() {
  const links = [...document.querySelectorAll(".nav-link")];
  const sections = links.map((a) => document.querySelector(a.getAttribute("href"))).filter(Boolean);
  const y = window.scrollY + 80;
  let current = sections[0];
  for (const section of sections) {
    if (section.offsetTop <= y) current = section;
  }
  links.forEach((a) => {
    a.classList.toggle("is-active", a.getAttribute("href") === `#${current.id}`);
  });
}

async function load() {
  const local = await chrome.storage.local.get({
    bridgeToken: "",
    discordClientId: "",
    discordEnabled: null,
  });
  const res = await chrome.runtime.sendMessage({ type: "GET_SETTINGS" });
  const s = res?.settings || {};

  els.locale.value = s.locale === "fr" ? "fr" : "en";
  els.defaultPlaybackRate.value = String(s.defaultPlaybackRate || 1);
  els.timerEndBehavior.value = s.timerEndBehavior || "pause";
  els.discordEnabled.checked = Boolean(s.discordEnabled);
  els.bridgeToken.value = local.bridgeToken || "";
  els.discordClientId.value = local.discordClientId || s.discordClientId || "";
  els.density.value = s.density === "comfortable" ? "comfortable" : "compact";
  els.reducedMotion.checked = Boolean(s.reducedMotion);
  els.recentHistoryEnabled.checked = s.recentHistoryEnabled !== false;

  document.getElementById("about-version").textContent = `v${chrome.runtime.getManifest().version}`;
  els.discordStatus.textContent = discordLabel(res?.discord, {
    ...s,
    hasBridgeToken: Boolean(els.bridgeToken.value.trim()),
  });

  if (!els.bridgeToken.value.trim()) {
    els.status.textContent = "Paste the bridge authToken from bridge/config.json.";
  } else if (res?.discord?.connected) {
    els.status.textContent = "Bridge connected.";
  } else {
    els.status.textContent = res?.discord?.error || "Bridge not running.";
  }
}

document.getElementById("save").addEventListener("click", async () => {
  const bridgeToken = els.bridgeToken.value.trim();
  const syncPayload = {
    locale: els.locale.value === "fr" ? "fr" : "en",
    defaultPlaybackRate: Number(els.defaultPlaybackRate.value) || 1,
    timerEndBehavior: els.timerEndBehavior.value || "pause",
    discordEnabled: els.discordEnabled.checked,
    density: els.density.value === "comfortable" ? "comfortable" : "compact",
    reducedMotion: els.reducedMotion.checked,
    recentHistoryEnabled: els.recentHistoryEnabled.checked,
  };

  await chrome.storage.local.set({
    discordEnabled: syncPayload.discordEnabled,
    discordClientId: els.discordClientId.value.trim(),
    bridgeToken,
    playbackRate: syncPayload.defaultPlaybackRate,
  });
  await chrome.storage.sync.set({
    ...syncPayload,
    discordClientId: "",
  });

  els.saveStatus.textContent = "Saved. Checking bridge…";
  const res = await chrome.runtime.sendMessage({ type: "DISCORD_RECONNECT" });
  els.discordStatus.textContent = discordLabel(res?.discord, {
    discordEnabled: syncPayload.discordEnabled,
    hasBridgeToken: Boolean(bridgeToken),
  });

  if (res?.discord?.connected) {
    els.saveStatus.textContent = "Saved. Bridge connected.";
    els.status.textContent = "Bridge connected. Play a track on SoundCloud.";
  } else if (!syncPayload.discordEnabled) {
    els.saveStatus.textContent = "Saved.";
    els.status.textContent = "Discord presence is disabled.";
  } else if (!bridgeToken) {
    els.saveStatus.textContent = "Saved — token still missing.";
    els.status.textContent = "Paste the bridge authToken.";
  } else {
    els.saveStatus.textContent = "Saved.";
    els.status.textContent = res?.discord?.error || "Bridge not reachable.";
  }
});

document.getElementById("reconnect").addEventListener("click", async () => {
  const res = await chrome.runtime.sendMessage({ type: "DISCORD_RECONNECT" });
  els.discordStatus.textContent = discordLabel(res?.discord, {
    discordEnabled: els.discordEnabled.checked,
    hasBridgeToken: Boolean(els.bridgeToken.value.trim()),
  });
  els.status.textContent = res?.discord?.connected
    ? "Bridge connected."
    : res?.discord?.error || "Bridge not reachable.";
});

document.getElementById("clear-recent").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "CLEAR_RECENT" });
  els.saveStatus.textContent = "Recent history cleared.";
});

document.getElementById("clear-local").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "CLEAR_LOCAL_DATA" });
  els.saveStatus.textContent = "Local listening data cleared.";
});

window.addEventListener("scroll", setActiveNav, { passive: true });
load();
setActiveNav();
