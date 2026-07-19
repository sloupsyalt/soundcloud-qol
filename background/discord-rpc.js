const BRIDGE_BASE = "http://127.0.0.1:19234";

let clientId = "";
let bridgeToken = "";
let lastActivity = null;
let lastSentSig = "";
let status = { connected: false, port: 19234, error: null };
let clearTimer = null;
let bridgeReady = false;

function getStatus() {
  return { ...status };
}

function setBridgeToken(token) {
  bridgeToken = String(token || "").trim();
}

function authHeaders() {
  const headers = { "Content-Type": "application/json" };
  if (bridgeToken) {
    headers.Authorization = `Bearer ${bridgeToken}`;
  }
  return headers;
}

function missingTokenError() {
  return "Bridge token missing — paste it from bridge/config.json into Settings";
}

async function bridgeFetch(path, payload) {
  if (!bridgeToken) {
    status = { connected: false, port: 19234, error: missingTokenError() };
    bridgeReady = false;
    throw new Error(missingTokenError());
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch(`${BRIDGE_BASE}${path}`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(payload || {}),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      throw new Error("Bridge rejected token — check Settings");
    }
    if (!res.ok) {
      throw new Error(data.error || `Bridge HTTP ${res.status}`);
    }
    status = { connected: true, port: 19234, error: null };
    bridgeReady = true;
    return data;
  } catch (err) {
    bridgeReady = false;
    if (String(err?.message || "").includes("token") || String(err?.message || "").includes("Settings")) {
      status = { connected: false, port: 19234, error: err.message };
      throw err;
    }
    const message =
      err?.name === "AbortError"
        ? "Bridge timeout — is the bridge running?"
        : "Bridge not running — start bridge/start.command";
    status = { connected: false, port: 19234, error: message };
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function ping() {
  if (!bridgeToken) {
    bridgeReady = false;
    status = { connected: false, port: 19234, error: missingTokenError() };
    return null;
  }
  try {
    const res = await fetch(`${BRIDGE_BASE}/health`, {
      method: "GET",
      headers: { Authorization: `Bearer ${bridgeToken}` },
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      throw new Error("Bridge rejected token — check Settings");
    }
    if (!res.ok) throw new Error("bad health");
    status = { connected: true, port: 19234, error: null };
    bridgeReady = true;
    return data;
  } catch (err) {
    bridgeReady = false;
    const msg = String(err?.message || "");
    status = {
      connected: false,
      port: 19234,
      error: msg.includes("token") || msg.includes("Settings")
        ? msg
        : "Bridge not running — start bridge/start.command",
    };
    return null;
  }
}

function trackIsPlaying(track) {
  return Boolean(track?.title && track.isPlaying === true);
}

function activitySig(track) {
  if (!track) return "";
  const seek = Math.floor((track.currentSeconds || 0) / 3);
  return `${track.identity || track.title}|${track.isPlaying}|${seek}|${Math.floor(track.durationSeconds || 0)}`;
}

async function setActivity(track) {
  if (clearTimer) {
    clearTimeout(clearTimer);
    clearTimer = null;
  }

  if (!trackIsPlaying(track)) {
    lastActivity = track || null;
    lastSentSig = "";
    return clearActivity();
  }

  const sig = activitySig(track);
  const reason = track.reason || "";
  const force = reason === "play" || reason === "seek" || reason === "track";
  if (!force && sig === lastSentSig) return true;

  lastActivity = track;
  try {
    if (!bridgeReady) await ping();
    await bridgeFetch("/activity", {
      clientId: clientId || undefined,
      track: {
        title: track.title,
        artist: track.artist,
        artworkUrl: track.artworkUrl,
        trackUrl: track.trackUrl,
        artistUrl: track.artistUrl,
        currentSeconds: track.currentSeconds,
        durationSeconds: track.durationSeconds,
        isPlaying: track.isPlaying === true,
      },
    });
    lastSentSig = sig;
    return true;
  } catch {
    return false;
  }
}

async function clearActivity() {
  if (clearTimer) {
    clearTimeout(clearTimer);
    clearTimer = null;
  }
  lastActivity = null;
  lastSentSig = "";
  try {
    if (!bridgeReady) await ping();
    await bridgeFetch("/clear", {});
    return true;
  } catch {
    return false;
  }
}

async function connect(id, token) {
  if (token != null) setBridgeToken(token);
  const nextId = String(id || "").trim();
  if (nextId) clientId = nextId;

  const health = await ping();
  if (!status.connected) return status;

  if (trackIsPlaying(lastActivity)) {
    lastSentSig = "";
    await setActivity(lastActivity);
  }
  // health no longer returns clientId — keep local/override only
  void health;
  return status;
}

async function disconnect() {
  await clearActivity();
  status = { connected: false, port: 19234, error: null };
  return status;
}

async function reconnect() {
  if (!bridgeToken) {
    status = { connected: false, port: 19234, error: missingTokenError() };
    return status;
  }
  try {
    await bridgeFetch("/reconnect", {});
    return connect(clientId, bridgeToken);
  } catch {
    return status;
  }
}

export {
  connect,
  disconnect,
  setActivity,
  clearActivity,
  getStatus,
  ping,
  setBridgeToken,
  reconnect,
};
