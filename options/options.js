const enabledEl = document.getElementById("discordEnabled");
const clientIdEl = document.getElementById("discordClientId");
const bridgeTokenEl = document.getElementById("bridgeToken");
const localeEl = document.getElementById("locale");
const statusEl = document.getElementById("status");

async function load() {
  const local = await chrome.storage.local.get({ bridgeToken: "" });
  const res = await chrome.runtime.sendMessage({ type: "GET_SETTINGS" });
  const settings = res?.settings || {};
  enabledEl.checked = Boolean(settings.discordEnabled);
  clientIdEl.value = settings.discordClientId || "";
  bridgeTokenEl.value = local.bridgeToken || settings.bridgeToken || "";
  localeEl.value = settings.locale === "fr" ? "fr" : "en";

  if (!bridgeTokenEl.value.trim()) {
    statusEl.textContent = "Paste the bridge authToken from bridge/config.json.";
  } else if (res?.discord?.connected) {
    statusEl.textContent = "Bridge connected.";
  } else {
    statusEl.textContent = res?.discord?.error || "Bridge not running.";
  }
}

document.getElementById("save").addEventListener("click", async () => {
  const bridgeToken = bridgeTokenEl.value.trim();
  const payload = {
    discordEnabled: enabledEl.checked,
    discordClientId: clientIdEl.value.trim(),
    locale: localeEl.value === "fr" ? "fr" : "en",
  };
  // Token stays in local storage only — never sync
  await chrome.storage.local.set({
    discordEnabled: payload.discordEnabled,
    discordClientId: payload.discordClientId,
    bridgeToken,
  });
  await chrome.storage.sync.set(payload);
  statusEl.textContent = "Saved. Checking bridge…";
  const res = await chrome.runtime.sendMessage({ type: "DISCORD_RECONNECT" });
  if (res?.discord?.connected) {
    statusEl.textContent = "Bridge connected. Play a track on SoundCloud.";
  } else if (!enabledEl.checked) {
    statusEl.textContent = "Saved. Discord presence is disabled.";
  } else if (!bridgeToken) {
    statusEl.textContent = "Saved, but bridge token is still missing.";
  } else {
    statusEl.textContent = res?.discord?.error || "Saved, but bridge is not reachable.";
  }
});

load();
