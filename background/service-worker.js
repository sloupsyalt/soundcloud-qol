import {
  clearActivity,
  connect,
  disconnect,
  getStatus,
  setActivity,
} from "./discord-rpc.js";

const DEFAULTS = {
  discordEnabled: true,
  discordClientId: "",
  locale: "en",
};

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.sync.get(DEFAULTS);
  await chrome.storage.sync.set({ ...DEFAULTS, ...current });
  await reinjectContentScripts();
});

chrome.runtime.onStartup.addListener(() => {
  reinjectContentScripts();
});

async function reinjectContentScripts() {
  try {
    const tabs = await chrome.tabs.query({
      url: ["https://soundcloud.com/*", "https://*.soundcloud.com/*"],
    });
    for (const tab of tabs) {
      if (tab.id == null) continue;
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["content/content.js"],
        });
        await chrome.scripting.insertCSS({
          target: { tabId: tab.id },
          files: ["content/content.css"],
        });
      } catch {
        // tab may not allow injection yet
      }
    }
  } catch {
    // ignore
  }
}

async function getDiscordSettings() {
  const local = await chrome.storage.local.get({
    discordEnabled: null,
    discordClientId: null,
  });
  const sync = await chrome.storage.sync.get(DEFAULTS);
  const enabled =
    local.discordEnabled == null ? Boolean(sync.discordEnabled) : Boolean(local.discordEnabled);
  const clientId = String(
    local.discordClientId != null && local.discordClientId !== ""
      ? local.discordClientId
      : sync.discordClientId || ""
  ).trim();
  return {
    enabled,
    clientId,
    locale: sync.locale === "fr" ? "fr" : "en",
    raw: { ...sync, discordEnabled: enabled, discordClientId: clientId },
  };
}

async function syncDiscordConnection() {
  const { enabled, clientId } = await getDiscordSettings();
  if (!enabled) {
    await disconnect();
    return getStatus();
  }
  // clientId optional — bridge/config.json can supply it
  return connect(clientId);
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync" && area !== "local") return;
  if (changes.discordEnabled || changes.discordClientId) {
    syncDiscordConnection();
  }
  if (area === "sync" && (changes.locale || changes.discordEnabled || changes.discordClientId)) {
    getDiscordSettings().then((settings) => {
      broadcast({ type: "SETTINGS_CHANGED", settings: settings.raw });
    });
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case "TRACK_UPDATE": {
        const { enabled, clientId } = await getDiscordSettings();
        if (enabled) {
          await connect(clientId);
          const ok = await setActivity(message.track);
          sendResponse({ ok, discord: getStatus(), track: message.track?.title || null });
        } else {
          await clearActivity();
          sendResponse({ ok: true, discord: getStatus() });
        }
        break;
      }
      case "TRACK_CLEAR": {
        const { enabled } = await getDiscordSettings();
        if (enabled) await clearActivity();
        sendResponse({ ok: true, discord: getStatus() });
        break;
      }
      case "DISCORD_STATUS": {
        await syncDiscordConnection();
        sendResponse({ ok: true, discord: getStatus() });
        break;
      }
      case "DISCORD_RECONNECT": {
        await reinjectContentScripts();
        const status = await syncDiscordConnection();
        sendResponse({ ok: true, discord: status });
        break;
      }
      case "GET_SETTINGS": {
        const settings = (await getDiscordSettings()).raw;
        if (settings.discordEnabled) {
          await connect(String(settings.discordClientId || "").trim());
        }
        sendResponse({ ok: true, settings, discord: getStatus() });
        break;
      }
      case "SET_SLEEP_TIMER": {
        const endAt = message.endAt ?? null;
        await chrome.storage.local.set({ sleepTimerEndAt: endAt });
        if (endAt) {
          const delay = Math.max(0, endAt - Date.now());
          chrome.alarms.create("sleep-timer", { when: Date.now() + delay });
        } else {
          chrome.alarms.clear("sleep-timer");
        }
        broadcast({ type: "SLEEP_TIMER_CHANGED", endAt });
        sendResponse({ ok: true, endAt });
        break;
      }
      case "GET_SLEEP_TIMER": {
        const { sleepTimerEndAt } = await chrome.storage.local.get({ sleepTimerEndAt: null });
        sendResponse({ ok: true, endAt: sleepTimerEndAt });
        break;
      }
      case "RECENT_TRACK": {
        const item = message.item;
        if (!item?.title) {
          sendResponse({ ok: false });
          break;
        }
        const { recentTracks = [] } = await chrome.storage.local.get({ recentTracks: [] });
        const next = [
          {
            title: String(item.title).slice(0, 200),
            artist: String(item.artist || "").slice(0, 200),
            url: String(item.url || "").slice(0, 500),
            at: Number(item.at) || Date.now(),
          },
          ...recentTracks.filter(
            (r) => !(r.title === item.title && r.artist === item.artist)
          ),
        ].slice(0, 12);
        await chrome.storage.local.set({ recentTracks: next });
        sendResponse({ ok: true, recentTracks: next });
        break;
      }
      case "GET_RECENT": {
        const { recentTracks = [] } = await chrome.storage.local.get({ recentTracks: [] });
        sendResponse({ ok: true, recentTracks });
        break;
      }
      default:
        sendResponse({ ok: false, error: "Unknown message" });
    }
  })().catch((err) => {
    sendResponse({ ok: false, error: String(err?.message || err) });
  });
  return true;
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "sleep-timer") return;
  await chrome.storage.local.set({ sleepTimerEndAt: null });
  broadcast({ type: "SLEEP_TIMER_FIRE" });
});

function broadcast(message) {
  chrome.tabs.query({ url: ["https://soundcloud.com/*", "https://*.soundcloud.com/*"] }, (tabs) => {
    for (const tab of tabs) {
      if (tab.id != null) {
        Promise.resolve(chrome.tabs.sendMessage(tab.id, message)).catch(() => {});
      }
    }
  });
}

syncDiscordConnection();
reinjectContentScripts();
