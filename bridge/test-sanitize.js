#!/usr/bin/env node
/** Smoke tests for bridge track sanitization. */
const assert = require("assert");
const { sanitizeTrack, normalizeSoundCloudUrl, discordImageKey } = require("./server.js");

assert.strictEqual(sanitizeTrack(null), null);
assert.strictEqual(sanitizeTrack({}), null);
assert.strictEqual(sanitizeTrack({ title: "" }), null);

const ok = sanitizeTrack({
  title: "A".repeat(200),
  artist: "B".repeat(200),
  artworkUrl: "https://i1.sndcdn.com/art.jpg",
  trackUrl: "https://soundcloud.com/artist/track?foo=1#t=12",
  artistUrl: "https://www.soundcloud.com/artist",
  currentSeconds: -5,
  durationSeconds: 999999,
  isPlaying: "yes",
});

assert.ok(ok.title.length <= 128);
assert.ok(ok.artist.length <= 128);
assert.strictEqual(ok.isPlaying, false);
assert.strictEqual(ok.currentSeconds, 0);
assert.strictEqual(ok.durationSeconds, 86400);
assert.strictEqual(normalizeSoundCloudUrl(ok.trackUrl), "https://soundcloud.com/artist/track");
assert.strictEqual(normalizeSoundCloudUrl(ok.artistUrl), "https://soundcloud.com/artist");
assert.strictEqual(discordImageKey("http://cdn.example/x.png"), "https://cdn.example/x.png");
assert.strictEqual(discordImageKey("javascript:alert(1)"), null);

console.log("bridge sanitize tests ok");
process.exit(0);
