function formatRemaining(endAt) {
  if (!endAt || endAt <= Date.now()) return "Off";
  const total = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")} left`;
}

function discordLabel(discord, settings) {
  if (!settings?.discordEnabled) return "Disabled";
  if (!settings?.hasBridgeToken && !settings?.bridgeToken) return "Needs bridge token";
  if (discord?.connected) return discord.error ? `Bridge: ${discord.error}` : "Connected";
  return discord?.error || "Bridge not running";
}

function renderRecent(items) {
  const list = document.getElementById("recent-list");
  if (!items?.length) {
    list.innerHTML = `<li class="empty">Nothing yet</li>`;
    return;
  }
  list.innerHTML = items
    .slice(0, 8)
    .map((item) => {
      const title = escapeHtml(item.title || "Untitled");
      const artist = escapeHtml(item.artist || "");
      const url = item.url ? escapeAttr(item.url) : "";
      const label = artist ? `${title}<span class="meta">${artist}</span>` : title;
      if (url) {
        return `<li><a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a></li>`;
      }
      return `<li><span>${label}</span></li>`;
    })
    .join("");
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, "&#39;");
}

async function refresh() {
  const [settingsRes, timerRes, recentRes] = await Promise.all([
    chrome.runtime.sendMessage({ type: "GET_SETTINGS" }),
    chrome.runtime.sendMessage({ type: "GET_SLEEP_TIMER" }),
    chrome.runtime.sendMessage({ type: "GET_RECENT" }),
  ]);

  document.getElementById("timer-status").textContent = formatRemaining(timerRes?.endAt);
  document.getElementById("discord-status").textContent = discordLabel(
    settingsRes?.discord,
    settingsRes?.settings
  );
  renderRecent(recentRes?.recentTracks || []);
}

document.getElementById("reconnect").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "DISCORD_RECONNECT" });
  await refresh();
});

document.getElementById("options").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

refresh();
setInterval(refresh, 1500);
