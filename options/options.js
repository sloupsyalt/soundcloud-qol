const enabledEl = document.getElementById("discordEnabled");
const clientIdEl = document.getElementById("discordClientId");
const localeEl = document.getElementById("locale");
const statusEl = document.getElementById("status");

async function load() {
  const res = await chrome.runtime.sendMessage({ type: "GET_SETTINGS" });
  const settings = res?.settings || {};
  enabledEl.checked = Boolean(settings.discordEnabled);
  clientIdEl.value = settings.discordClientId || "";
  localeEl.value = settings.locale === "fr" ? "fr" : "en";

  if (!settings.discordClientId) {
    statusEl.textContent = "Add an Application ID to enable Discord presence.";
  } else if (res?.discord?.connected) {
    statusEl.textContent = "Bridge connected.";
  } else {
    statusEl.textContent = res?.discord?.error || "Bridge not running.";
  }
}

document.getElementById("save").addEventListener("click", async () => {
  const payload = {
    discordEnabled: enabledEl.checked,
    discordClientId: clientIdEl.value.trim(),
    locale: localeEl.value === "fr" ? "fr" : "en",
  };
  // Write both: local is what the service worker prefers
  await chrome.storage.local.set({
    discordEnabled: payload.discordEnabled,
    discordClientId: payload.discordClientId,
  });
  await chrome.storage.sync.set(payload);
  statusEl.textContent = "Saved. Checking bridge…";
  const res = await chrome.runtime.sendMessage({ type: "DISCORD_RECONNECT" });
  if (res?.discord?.connected) {
    statusEl.textContent = "Bridge connected. Play a track on SoundCloud.";
  } else if (!enabledEl.checked) {
    statusEl.textContent = "Saved. Discord presence is disabled.";
  } else {
    statusEl.textContent = res?.discord?.error || "Saved, but bridge is not reachable.";
  }
});

load();
