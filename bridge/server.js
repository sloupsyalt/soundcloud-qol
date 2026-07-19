#!/usr/bin/env node
/**
 * Local bridge: Chrome extension ↔ Discord desktop (IPC).
 * Binds to 127.0.0.1 only. Requires a per-install auth token on every request.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const http = require("http");
const DiscordRPC = require("discord-rpc");

const PORT = 19234;
const HOST = "127.0.0.1";
const MAX_BODY_BYTES = 64 * 1024;
const CONFIG_PATH = path.join(__dirname, "config.json");
const EXAMPLE_PATH = path.join(__dirname, "config.example.json");
const EXT_ORIGIN_RE = /^chrome-extension:\/\/[a-p]{32}$/i;

let rpc = null;
let rpcClientId = "";
let rpcReady = false;
let connecting = null;
let lastPayload = null;
let requestCount = 0;
let configCache = null;

function loadExample() {
  try {
    return JSON.parse(fs.readFileSync(EXAMPLE_PATH, "utf8"));
  } catch {
    return {};
  }
}

function loadConfigRaw() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return null;
  }
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(CONFIG_PATH, 0o600);
  } catch {
    // ignore (Windows)
  }
  configCache = config;
}

function ensureConfig() {
  if (configCache?.authToken) return configCache;

  const existing = loadConfigRaw();
  const base = { ...loadExample(), ...(existing || {}) };
  let generated = false;

  if (!base.authToken || typeof base.authToken !== "string" || base.authToken.length < 32) {
    base.authToken = crypto.randomBytes(32).toString("hex");
    generated = true;
  }

  saveConfig(base);
  if (generated || !existing) {
    console.log("[bridge] Auth token saved to config.json (paste into extension Settings).");
    console.log(`[bridge] Token: ${base.authToken}`);
  }
  return base;
}

function loadConfig() {
  return ensureConfig();
}

function truncate(value, max) {
  const s = String(value || "");
  if (!s) return "";
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function clampNumber(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a || ""), "utf8");
  const bb = Buffer.from(String(b || ""), "utf8");
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function getRequestToken(req) {
  const auth = String(req.headers.authorization || "");
  const bearer = /^Bearer\s+(.+)$/i.exec(auth);
  if (bearer) return bearer[1].trim();
  return String(req.headers["x-soundcloud-qol-token"] || "").trim();
}

function isAuthorized(req) {
  const expected = loadConfig().authToken;
  const got = getRequestToken(req);
  return Boolean(expected && got && safeEqual(got, expected));
}

/** @returns {string|null|false} allowed Origin, null if none, false if forbidden */
function resolveCorsOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return null;
  if (EXT_ORIGIN_RE.test(origin)) return origin;
  return false;
}

function sendJson(res, statusCode, data, req) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-SoundCloud-QoL-Token",
    "Access-Control-Max-Age": "600",
  };
  const origin = resolveCorsOrigin(req);
  if (origin) headers["Access-Control-Allow-Origin"] = origin;

  const body = statusCode === 204 ? "" : JSON.stringify(data);
  res.writeHead(statusCode, headers);
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;

    const fail = (err, statusCode) => {
      if (settled) return;
      settled = true;
      err.statusCode = statusCode || err.statusCode || 400;
      reject(err);
      try {
        req.destroy();
      } catch {
        // ignore
      }
    };

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        fail(new Error("Payload too large"), 413);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          fail(new Error("JSON body must be an object"), 400);
          return;
        }
        resolve(parsed);
      } catch {
        fail(new Error("Invalid JSON"), 400);
      }
    });
    req.on("error", (err) => fail(err, 400));
  });
}

function discordImageKey(url) {
  if (!url || typeof url !== "string") return null;
  const cleaned = url.trim().replace(/^http:\/\//i, "https://");
  if (!/^https:\/\//i.test(cleaned) || cleaned.length > 512) return null;
  return cleaned;
}

function normalizeSoundCloudUrl(url) {
  if (!url || typeof url !== "string") return "";
  let out = url.trim().split("?")[0].split("#")[0];
  out = out.replace(/^http:\/\//i, "https://");
  out = out.replace(/^https:\/\/m\.soundcloud\.com/i, "https://soundcloud.com");
  out = out.replace(/^https:\/\/www\.soundcloud\.com/i, "https://soundcloud.com");
  if (!/^https:\/\/soundcloud\.com\/.+/i.test(out) || out.length > 512) return "";
  return out;
}

function sanitizeTrack(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

  const title = truncate(raw.title, 128);
  if (!title) return null;

  return {
    title,
    artist: truncate(raw.artist, 128) || "Unknown artist",
    artworkUrl: typeof raw.artworkUrl === "string" ? raw.artworkUrl.trim().slice(0, 512) : "",
    trackUrl: typeof raw.trackUrl === "string" ? raw.trackUrl.trim().slice(0, 512) : "",
    artistUrl: typeof raw.artistUrl === "string" ? raw.artistUrl.trim().slice(0, 512) : "",
    currentSeconds: clampNumber(raw.currentSeconds, 0, 86400),
    durationSeconds: clampNumber(raw.durationSeconds, 0, 86400),
    isPlaying: raw.isPlaying === true,
  };
}

function resolveClientId(fromRequest) {
  const config = loadConfig();
  const fromReq = typeof fromRequest === "string" ? fromRequest.trim() : "";
  if (fromReq && /^\d{5,32}$/.test(fromReq)) return fromReq;
  return String(config.clientId || "").trim();
}

async function ensureRpc(clientId) {
  const id = resolveClientId(clientId);
  if (!id) throw new Error("Missing Discord Application ID (set bridge/config.json clientId)");

  if (rpc && rpcReady && rpcClientId === id) return rpc;
  if (connecting) return connecting;

  connecting = (async () => {
    if (rpc) {
      try {
        rpc.destroy();
      } catch {
        // ignore
      }
      rpc = null;
      rpcReady = false;
    }

    rpcClientId = id;
    DiscordRPC.register(id);
    rpc = new DiscordRPC.Client({ transport: "ipc" });

    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Discord IPC timeout — is Discord desktop open?")),
        8000
      );
      rpc.once("ready", () => {
        clearTimeout(timer);
        rpcReady = true;
        console.log("[bridge] Discord IPC ready");
        resolve();
      });
      rpc.login({ clientId: id }).catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    rpc.on("disconnected", () => {
      console.log("[bridge] Discord IPC disconnected");
      rpcReady = false;
    });

    return rpc;
  })();

  try {
    return await connecting;
  } finally {
    connecting = null;
  }
}

function formatClock(totalSeconds) {
  const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function buildPresence(track) {
  const title = track.title;
  const artist = track.artist;
  const current = track.currentSeconds;
  const duration = track.durationSeconds;

  const startTimestamp = Math.round(Date.now() - current * 1000);
  const endTimestamp = duration > 0 ? Math.round(startTimestamp + duration * 1000) : undefined;
  const timeLine =
    duration > 0 ? `${formatClock(current)} / ${formatClock(duration)}` : formatClock(current);

  const config = loadConfig();
  const largeImage = discordImageKey(track.artworkUrl) || config.largeImageFallback || null;
  const smallImage = String(config.smallImageKey || "soundcloud").trim() || null;

  const activity = {
    type: 2,
    details: title,
    state: truncate(`by ${artist}  ·  ${timeLine}`, 128),
    timestamps: { start: startTimestamp },
    assets: {
      large_text: truncate(`${title} — ${artist}`, 128),
      small_text: "SoundCloud",
    },
    buttons: [],
    instance: false,
  };

  if (endTimestamp && endTimestamp > startTimestamp) {
    activity.timestamps.end = endTimestamp;
  }
  if (largeImage) activity.assets.large_image = largeImage;
  if (smallImage) activity.assets.small_image = smallImage;

  const trackUrl = normalizeSoundCloudUrl(track.trackUrl);
  const artistUrl = normalizeSoundCloudUrl(track.artistUrl);

  if (trackUrl) {
    activity.buttons.push({ label: "Play on SoundCloud", url: trackUrl });
  }
  if (artistUrl && artistUrl !== trackUrl && activity.buttons.length < 2) {
    activity.buttons.push({ label: "View artist", url: artistUrl });
  }
  if (!activity.buttons.length) delete activity.buttons;

  return activity;
}

async function setActivity(clientId, trackRaw) {
  await ensureRpc(clientId);

  const track = sanitizeTrack(trackRaw);
  const playing = Boolean(track?.isPlaying && track?.title);

  if (!track || !playing) {
    await rpc.clearActivity();
    lastPayload = null;
    console.log("[bridge] cleared activity");
    return { ok: true, cleared: true };
  }

  const activity = buildPresence(track);
  await rpc.request("SET_ACTIVITY", {
    pid: process.pid,
    activity,
  });

  lastPayload = {
    title: track.title,
    artist: track.artist,
    at: Date.now(),
  };
  console.log(`[bridge] activity → ${track.artist} — ${track.title}`);
  return { ok: true };
}

async function clearActivity() {
  if (!rpc || !rpcReady) {
    lastPayload = null;
    return { ok: true, cleared: true };
  }
  await rpc.clearActivity();
  lastPayload = null;
  console.log("[bridge] cleared activity");
  return { ok: true, cleared: true };
}

function requireLocalBrowserOrTool(req, res) {
  const origin = resolveCorsOrigin(req);
  if (origin === false) {
    sendJson(res, 403, { ok: false, error: "Origin not allowed" }, req);
    return false;
  }
  return true;
}

function requireAuth(req, res) {
  if (!isAuthorized(req)) {
    sendJson(res, 401, { ok: false, error: "Unauthorized" }, req);
    return false;
  }
  return true;
}

const server = http.createServer(async (req, res) => {
  if (!requireLocalBrowserOrTool(req, res)) return;

  if (req.method === "OPTIONS") {
    // Preflight: only for allowed extension origins
    if (resolveCorsOrigin(req) === false) {
      sendJson(res, 403, { ok: false, error: "Origin not allowed" }, req);
      return;
    }
    sendJson(res, 204, {}, req);
    return;
  }

  try {
    if (req.method === "GET" && (req.url === "/" || req.url?.startsWith("/health"))) {
      if (!requireAuth(req, res)) return;
      sendJson(
        res,
        200,
        {
          ok: true,
          service: "soundcloud-qol-bridge",
          rpcReady: Boolean(rpcReady),
        },
        req
      );
      return;
    }

    if (req.method === "POST" && req.url === "/activity") {
      if (!requireAuth(req, res)) return;
      requestCount += 1;
      const body = await readBody(req);
      console.log(
        `[bridge] POST /activity #${requestCount}`,
        body?.track?.title ? "(track)" : "(no title)",
        "playing=",
        body?.track?.isPlaying === true
      );
      const result = await setActivity(body.clientId, body.track);
      sendJson(res, 200, result, req);
      return;
    }

    if (req.method === "POST" && req.url === "/reconnect") {
      if (!requireAuth(req, res)) return;
      console.log("[bridge] reconnect requested");
      if (rpc) {
        try {
          await rpc.clearActivity();
        } catch {
          // ignore
        }
        try {
          rpc.destroy();
        } catch {
          // ignore
        }
        rpc = null;
        rpcReady = false;
        rpcClientId = "";
      }
      const id = resolveClientId();
      if (id) await ensureRpc(id);
      sendJson(res, 200, { ok: true, rpcReady: Boolean(rpcReady) }, req);
      return;
    }

    if (req.method === "POST" && req.url === "/clear") {
      if (!requireAuth(req, res)) return;
      requestCount += 1;
      console.log(`[bridge] POST /clear #${requestCount}`);
      const result = await clearActivity();
      sendJson(res, 200, result, req);
      return;
    }

    sendJson(res, 404, { ok: false, error: "Not found" }, req);
  } catch (err) {
    const status = err.statusCode || 500;
    console.error("[bridge]", err.message || err);
    sendJson(res, status, { ok: false, error: String(err.message || err) }, req);
  }
});

if (require.main === module) {
  ensureConfig();
  server.listen(PORT, HOST, () => {
    console.log(`[bridge] HTTP http://${HOST}:${PORT} (auth required)`);
    console.log("[bridge] Keep Discord desktop open while using presence.");
  });

  process.on("SIGINT", () => {
    try {
      rpc?.destroy();
    } catch {
      // ignore
    }
    process.exit(0);
  });
}

module.exports = { sanitizeTrack, normalizeSoundCloudUrl, discordImageKey };
