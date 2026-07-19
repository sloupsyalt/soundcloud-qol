import {
  clearActivity,
  connect,
  disconnect,
  getStatus,
  reconnect,
  setActivity,
  setBridgeToken,
} from "./discord-rpc.js";

const SYNC_DEFAULTS = {
  discordEnabled: true,
  discordClientId: "",
  locale: "en",
  defaultPlaybackRate: 1,
  timerPresets: [15, 30, 45, 60],
  timerEndBehavior: "pause",
  recentHistoryEnabled: true,
  density: "compact",
  reducedMotion: false,
};

const LOCAL_DEFAULTS = {
  focusMode: false,
  playbackRate: 1,
  loopMode: false,
  muted: false,
  stopAfterTrack: false,
  sleepTimerEndAt: null,
  sleepTimerStartedAt: null,
  sleepTimerDurationMs: null,
  nowPlaying: null,
  recentTracks: [],
  bridgeToken: "",
};

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.sync.get(SYNC_DEFAULTS);
  await chrome.storage.sync.set({ ...SYNC_DEFAULTS, ...current });
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
    bridgeToken: "",
  });
  const sync = await chrome.storage.sync.get(SYNC_DEFAULTS);
  const enabled =
    local.discordEnabled == null ? Boolean(sync.discordEnabled) : Boolean(local.discordEnabled);
  const clientId = String(
    local.discordClientId != null && local.discordClientId !== ""
      ? local.discordClientId
      : sync.discordClientId || ""
  ).trim();
  const bridgeToken = String(local.bridgeToken || "").trim();
  setBridgeToken(bridgeToken);
  return {
    enabled,
    clientId,
    bridgeToken,
    locale: sync.locale === "fr" ? "fr" : "en",
    raw: {
      ...sync,
      discordEnabled: enabled,
      discordClientId: clientId,
      bridgeToken,
      hasBridgeToken: Boolean(bridgeToken),
    },
  };
}

async function getLocalPrefs() {
  return chrome.storage.local.get(LOCAL_DEFAULTS);
}

async function syncDiscordConnection() {
  const { enabled, clientId, bridgeToken } = await getDiscordSettings();
  if (!enabled) {
    await disconnect();
    return getStatus();
  }
  return connect(clientId, bridgeToken);
}

async function setSleepTimer(endAt, meta = {}) {
  const startedAt = endAt ? Date.now() : null;
  const durationMs = endAt ? Math.max(0, endAt - Date.now()) : null;
  await chrome.storage.local.set({
    sleepTimerEndAt: endAt ?? null,
    sleepTimerStartedAt: meta.startedAt ?? startedAt,
    sleepTimerDurationMs: meta.durationMs ?? durationMs,
    stopAfterTrack: Boolean(meta.stopAfter),
  });
  if (endAt) {
    chrome.alarms.create("sleep-timer", { when: Date.now() + Math.max(0, endAt - Date.now()) });
  } else {
    chrome.alarms.clear("sleep-timer");
  }
  broadcast({
    type: "SLEEP_TIMER_CHANGED",
    endAt: endAt ?? null,
    stopAfter: Boolean(meta.stopAfter),
  });
  return { endAt: endAt ?? null, stopAfter: Boolean(meta.stopAfter) };
}

async function sendToActiveSoundCloud(message) {
  const tabs = await chrome.tabs.query({
    url: ["https://soundcloud.com/*", "https://*.soundcloud.com/*"],
    active: true,
    currentWindow: true,
  });
  let tab = tabs[0];
  if (!tab) {
    const all = await chrome.tabs.query({
      url: ["https://soundcloud.com/*", "https://*.soundcloud.com/*"],
    });
    tab = all[0];
  }
  if (!tab?.id) return { ok: false, error: "No SoundCloud tab" };
  try {
    const res = await chrome.tabs.sendMessage(tab.id, message);
    return res || { ok: true };
  } catch {
    return { ok: false, error: "SoundCloud tab not ready" };
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync" && area !== "local") return;
  if (changes.discordEnabled || changes.discordClientId || changes.bridgeToken) {
    syncDiscordConnection();
  }
  if (
    area === "sync" &&
    (changes.locale ||
      changes.discordEnabled ||
      changes.discordClientId ||
      changes.defaultPlaybackRate ||
      changes.density ||
      changes.reducedMotion)
  ) {
    getDiscordSettings().then((settings) => {
      broadcast({ type: "SETTINGS_CHANGED", settings: settings.raw });
    });
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case "TRACK_UPDATE": {
        const track = message.track || null;
        await chrome.storage.local.set({
          nowPlaying: track
            ? {
                title: track.title,
                artist: track.artist,
                artworkUrl: track.artworkUrl || "",
                trackUrl: track.trackUrl || "",
                currentSeconds: track.currentSeconds || 0,
                durationSeconds: track.durationSeconds || 0,
                isPlaying: track.isPlaying === true,
                updatedAt: Date.now(),
              }
            : null,
        });
        const { enabled, clientId, bridgeToken } = await getDiscordSettings();
        if (enabled) {
          await connect(clientId, bridgeToken);
          const ok = await setActivity(message.track);
          sendResponse({ ok, discord: getStatus(), track: track?.title || null });
        } else {
          await clearActivity();
          sendResponse({ ok: true, discord: getStatus() });
        }
        break;
      }
      case "TRACK_CLEAR": {
        await chrome.storage.local.set({ nowPlaying: null });
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
        const { enabled, clientId, bridgeToken } = await getDiscordSettings();
        let status;
        if (!enabled) {
          status = await disconnect();
        } else {
          status = await reconnect();
          if (!status.connected) status = await connect(clientId, bridgeToken);
        }
        sendResponse({ ok: true, discord: status });
        break;
      }
      case "GET_SETTINGS": {
        const settings = (await getDiscordSettings()).raw;
        const local = await getLocalPrefs();
        if (settings.discordEnabled) {
          await connect(String(settings.discordClientId || "").trim(), settings.bridgeToken);
        }
        sendResponse({
          ok: true,
          settings: {
            ...settings,
            focusMode: Boolean(local.focusMode),
            playbackRate: Number(local.playbackRate) || settings.defaultPlaybackRate || 1,
          },
          discord: getStatus(),
        });
        break;
      }
      case "GET_POPUP_STATE": {
        const settings = (await getDiscordSettings()).raw;
        const local = await getLocalPrefs();
        if (settings.discordEnabled && settings.hasBridgeToken) {
          await connect(String(settings.discordClientId || "").trim(), settings.bridgeToken);
        }
        sendResponse({
          ok: true,
          track: local.nowPlaying,
          timer: {
            endAt: local.sleepTimerEndAt,
            startedAt: local.sleepTimerStartedAt,
            durationMs: local.sleepTimerDurationMs,
            stopAfter: Boolean(local.stopAfterTrack),
          },
          recentTracks: settings.recentHistoryEnabled === false ? [] : local.recentTracks || [],
          settings: {
            ...settings,
            focusMode: Boolean(local.focusMode),
            playbackRate: Number(local.playbackRate) || settings.defaultPlaybackRate || 1,
            recentHistoryEnabled: settings.recentHistoryEnabled !== false,
          },
          discord: getStatus(),
          version: chrome.runtime.getManifest().version,
        });
        break;
      }
      case "SET_SLEEP_TIMER": {
        const endAt = message.endAt ?? null;
        const result = await setSleepTimer(endAt, {
          stopAfter: false,
          durationMs: endAt ? Math.max(0, endAt - Date.now()) : null,
        });
        sendResponse({ ok: true, ...result });
        break;
      }
      case "SET_STOP_AFTER": {
        await setSleepTimer(null, { stopAfter: true });
        broadcast({ type: "STOP_AFTER_ENABLED" });
        sendResponse({ ok: true, stopAfter: true });
        break;
      }
      case "GET_SLEEP_TIMER": {
        const local = await getLocalPrefs();
        sendResponse({
          ok: true,
          endAt: local.sleepTimerEndAt,
          stopAfter: Boolean(local.stopAfterTrack),
          startedAt: local.sleepTimerStartedAt,
          durationMs: local.sleepTimerDurationMs,
        });
        break;
      }
      case "POPUP_COMMAND": {
        const res = await sendToActiveSoundCloud({
          type: "POPUP_COMMAND",
          action: message.action,
          payload: message.payload || {},
        });
        sendResponse(res);
        break;
      }
      case "RECENT_TRACK": {
        const sync = await chrome.storage.sync.get(SYNC_DEFAULTS);
        if (sync.recentHistoryEnabled === false) {
          sendResponse({ ok: true, recentTracks: [] });
          break;
        }
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
            artworkUrl: String(item.artworkUrl || "").slice(0, 500),
            at: Number(item.at) || Date.now(),
          },
          ...recentTracks.filter((r) => !(r.title === item.title && r.artist === item.artist)),
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
      case "CLEAR_RECENT": {
        await chrome.storage.local.set({ recentTracks: [] });
        sendResponse({ ok: true, recentTracks: [] });
        break;
      }
      case "CLEAR_LOCAL_DATA": {
        await chrome.storage.local.set({
          recentTracks: [],
          nowPlaying: null,
          sleepTimerEndAt: null,
          sleepTimerStartedAt: null,
          sleepTimerDurationMs: null,
          stopAfterTrack: false,
        });
        chrome.alarms.clear("sleep-timer");
        sendResponse({ ok: true });
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
  await chrome.storage.local.set({
    sleepTimerEndAt: null,
    sleepTimerStartedAt: null,
    sleepTimerDurationMs: null,
  });
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
