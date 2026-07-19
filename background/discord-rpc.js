const BRIDGE_BASE = "http://127.0.0.1:19234";

let clientId = "";
let lastActivity = null;
let lastSentSig = "";
let status = { connected: false, port: 19234, error: null };
let clearTimer = null;
let bridgeReady = false;

function getStatus() {
  return { ...status };
}

async function bridgeFetch(path, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch(`${BRIDGE_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Bridge HTTP ${res.status}`);
    }
    status = { connected: true, port: 19234, error: null };
    bridgeReady = true;
    return data;
  } catch (err) {
    bridgeReady = false;
    const message =
      err?.name === "AbortError"
        ? "Bridge timeout — is bridge/start.command running?"
        : "Bridge not running — start bridge/start.command";
    status = { connected: false, port: 19234, error: message };
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function ping() {
  try {
    const res = await fetch(`${BRIDGE_BASE}/health`, { method: "GET" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error("bad health");
    status = { connected: true, port: 19234, error: null };
    bridgeReady = true;
    if (!clientId && data.rpcClientId) clientId = String(data.rpcClientId);
    return data;
  } catch {
    bridgeReady = false;
    status = {
      connected: false,
      port: 19234,
      error: "Bridge not running — start bridge/start.command",
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

  // Pause / stop → clear immediately so Discord's progress bar stops
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
      track,
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

async function connect(id) {
  const nextId = String(id || "").trim();
  if (nextId) clientId = nextId;

  const health = await ping();
  if (!clientId && health?.rpcClientId) clientId = String(health.rpcClientId);

  if (!status.connected) return status;

  if (trackIsPlaying(lastActivity)) {
    lastSentSig = "";
    await setActivity(lastActivity);
  }
  return status;
}

async function disconnect() {
  await clearActivity();
  status = { connected: false, port: 19234, error: null };
  return status;
}

export { connect, disconnect, setActivity, clearActivity, getStatus, ping };
