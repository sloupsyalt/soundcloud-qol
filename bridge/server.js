#!/usr/bin/env node
/**
 * Local bridge: Chrome extension <-> Discord desktop (IPC).
 * HTTP API so MV3 service workers stay reliable.
 */
const fs = require("fs");
const path = require("path");
const http = require("http");
const DiscordRPC = require("discord-rpc");

const PORT = 19234;
const HOST = "127.0.0.1";
const CONFIG_PATH = path.join(__dirname, "config.json");

let rpc = null;
let rpcClientId = "";
let rpcReady = false;
let connecting = null;
let lastPayload = null;
let requestCount = 0;

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return {};
  }
}

function truncate(value, max) {
  if (!value) return "";
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function discordImageKey(url) {
  if (!url || typeof url !== "string") return null;
  const cleaned = url.trim().replace(/^http:\/\//i, "https://");
  if (!/^https:\/\//i.test(cleaned) || cleaned.length > 512) return null;
  return cleaned;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(body);
}

function resolveClientId(fromRequest) {
  const config = loadConfig();
  return String(fromRequest || config.clientId || "").trim();
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
        console.log(`[bridge] Discord IPC ready (app ${id})`);
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
  const title = truncate(track.title || "Unknown track", 128);
  const artist = truncate(track.artist || "Unknown artist", 128);
  const current = Number(track.currentSeconds) || 0;
  const duration = Number(track.durationSeconds) || 0;

  const startTimestamp = Math.round(Date.now() - current * 1000);
  const endTimestamp = duration > 0 ? Math.round(startTimestamp + duration * 1000) : undefined;

  const timeLine =
    duration > 0 ? `${formatClock(current)} / ${formatClock(duration)}` : formatClock(current);

  const config = loadConfig();
  const largeImage = discordImageKey(track.artworkUrl) || config.largeImageFallback || null;
  // Uploaded Rich Presence asset name (Developer Portal → Rich Presence → Art Assets)
  const smallImage = String(config.smallImageKey || "soundcloud").trim() || null;

  const activity = {
    // 2 = LISTENING → shows “Listening to …” instead of “Playing …”
    type: 2,
    details: title,
    state: truncate(`by ${artist}  ·  ${timeLine}`, 128),
    timestamps: {
      start: startTimestamp,
    },
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

  if (largeImage) {
    activity.assets.large_image = largeImage;
  }
  if (smallImage) {
    activity.assets.small_image = smallImage;
  }

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

function normalizeSoundCloudUrl(url) {
  if (!url) return "";
  let out = String(url).trim().split("?")[0].split("#")[0];
  out = out.replace(/^http:\/\//i, "https://");
  out = out.replace(/^https:\/\/m\.soundcloud\.com/i, "https://soundcloud.com");
  out = out.replace(/^https:\/\/www\.soundcloud\.com/i, "https://soundcloud.com");
  if (!/^https:\/\/soundcloud\.com\/.+/i.test(out)) return "";
  return out;
}

async function setActivity(clientId, track) {
  await ensureRpc(clientId);

  const playing = track?.isPlaying === true && Boolean(track?.title);

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
    buttons: activity.buttons?.map((b) => b.label) || [],
    trackUrl: activity.buttons?.[0]?.url || null,
    fancy: true,
  };
  console.log(
    `[bridge] activity → ${track.artist} — ${track.title}`,
    lastPayload.buttons.length ? `buttons=[${lastPayload.buttons.join(", ")}]` : "(no buttons — missing track url)"
  );
  return { ok: true, activity: lastPayload };
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

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }

  try {
    if (req.method === "GET" && (req.url === "/" || req.url?.startsWith("/health"))) {
      sendJson(res, 200, {
        ok: true,
        service: "soundcloud-qol-bridge",
        rpcReady,
        rpcClientId: rpcClientId || resolveClientId() || null,
        lastPayload,
        requestCount,
      });
      return;
    }

    if (req.method === "POST" && req.url === "/activity") {
      requestCount += 1;
      const body = await readBody(req);
      console.log(
        `[bridge] POST /activity #${requestCount}`,
        body?.track?.title || "(no title)",
        "playing=",
        body?.track?.isPlaying
      );
      const result = await setActivity(body.clientId, body.track);
      sendJson(res, 200, result);
      return;
    }

    if (req.method === "POST" && req.url === "/reconnect") {
      console.log("[bridge] reconnect requested (refresh app name / IPC)");
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
      sendJson(res, 200, { ok: true, rpcReady, rpcClientId });
      return;
    }

    if (req.method === "POST" && req.url === "/clear") {
      requestCount += 1;
      console.log(`[bridge] POST /clear #${requestCount}`);
      const result = await clearActivity();
      sendJson(res, 200, result);
      return;
    }

    sendJson(res, 404, { ok: false, error: "Not found" });
  } catch (err) {
    console.error("[bridge]", err.message || err);
    sendJson(res, 500, { ok: false, error: String(err.message || err) });
  }
});

server.listen(PORT, HOST, () => {
  const id = resolveClientId();
  console.log(`[bridge] HTTP http://${HOST}:${PORT}`);
  console.log(`[bridge] config clientId: ${id || "(none — set bridge/config.json)"}`);
  console.log("[bridge] Keep this terminal open while using Discord presence.");
});

process.on("SIGINT", () => {
  try {
    rpc?.destroy();
  } catch {
    // ignore
  }
  process.exit(0);
});
