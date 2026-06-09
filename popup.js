const STORAGE_KEY = "fullscreenZoomSettings";
const MUTE_LOG_STORAGE_KEY = "ytMuteAutoWatchLogs";
const NEXT_QUEUE_STORAGE_KEY = "ytNextPlayQueue";
const DEFAULT_SETTINGS = {
  enabled: true,
  zoomPercent: 100,
  offsetX: 0,
  offsetY: 0,
  logoutGuardEnabled: false,
  muteGuardEnabled: true,
  pauseGuardEnabled: true,
  nextQueueEnabled: true,
  previewMuteEnabled: true
};

const zoomRange = document.getElementById("zoomRange");
const zoomValue = document.getElementById("zoomValue");
const enableToggle = document.getElementById("enableToggle");
const logoutGuardToggle = document.getElementById("logoutGuardToggle");
const muteGuardToggle = document.getElementById("muteGuardToggle");
const previewMuteToggle = document.getElementById("previewMuteToggle");
const pauseGuardToggle = document.getElementById("pauseGuardToggle");
const nextQueueToggle = document.getElementById("nextQueueToggle");
const muteLogList = document.getElementById("muteLogList");
const nextQueueList = document.getElementById("nextQueueList");
const clearMuteLogsButton = document.getElementById("clearMuteLogsButton");
const clearNextQueueButton = document.getElementById("clearNextQueueButton");
const resetButton = document.getElementById("resetButton");
const status = document.getElementById("status");

function clampZoom(value) {
  return Math.min(150, Math.max(50, Number(value) || DEFAULT_SETTINGS.zoomPercent));
}

function normalizeSettings(rawSettings = {}) {
  return {
    ...DEFAULT_SETTINGS,
    ...rawSettings,
    enabled: rawSettings.enabled !== false,
    zoomPercent: clampZoom(rawSettings.zoomPercent),
    offsetX: Number.isFinite(Number(rawSettings.offsetX)) ? Number(rawSettings.offsetX) : 0,
    offsetY: Number.isFinite(Number(rawSettings.offsetY)) ? Number(rawSettings.offsetY) : 0,
    logoutGuardEnabled: Boolean(rawSettings.logoutGuardEnabled),
    muteGuardEnabled: rawSettings.muteGuardEnabled !== false,
    pauseGuardEnabled: rawSettings.pauseGuardEnabled !== false,
    nextQueueEnabled: rawSettings.nextQueueEnabled !== false,
    previewMuteEnabled: rawSettings.previewMuteEnabled !== false
  };
}

function render(settings) {
  zoomRange.value = String(settings.zoomPercent);
  zoomValue.textContent = `${settings.zoomPercent}%`;
  enableToggle.checked = settings.enabled;
  logoutGuardToggle.checked = Boolean(settings.logoutGuardEnabled);
  muteGuardToggle.checked = settings.muteGuardEnabled !== false;
  previewMuteToggle.checked = settings.previewMuteEnabled !== false;
  pauseGuardToggle.checked = settings.pauseGuardEnabled !== false;
  nextQueueToggle.checked = settings.nextQueueEnabled !== false;
}

function showStatus(message) {
  status.textContent = message;
  window.clearTimeout(showStatus.timeoutId);
  showStatus.timeoutId = window.setTimeout(() => {
    status.textContent = "";
  }, 1400);
}

async function loadSettings() {
  const stored = await chrome.storage.sync.get(STORAGE_KEY);
  return normalizeSettings(stored[STORAGE_KEY] || {});
}

async function saveSettings(nextSettings) {
  const currentSettings = await loadSettings();
  const settings = normalizeSettings({
    ...currentSettings,
    ...nextSettings
  });

  await chrome.storage.sync.set({
    [STORAGE_KEY]: settings
  });

  render(settings);
  showStatus("저장되었습니다.");
}

function getCurrentControlSettings(overrides = {}) {
  return {
    enabled: enableToggle.checked,
    zoomPercent: zoomRange.value,
    logoutGuardEnabled: logoutGuardToggle.checked,
    muteGuardEnabled: muteGuardToggle.checked,
    previewMuteEnabled: previewMuteToggle.checked,
    pauseGuardEnabled: pauseGuardToggle.checked,
    nextQueueEnabled: nextQueueToggle.checked,
    ...overrides
  };
}

function formatLog(log) {
  if (!log.timestamp) {
    return log.entry || "";
  }

  const time = new Date(log.timestamp).toLocaleTimeString();
  const message = log.message || log.entry || "";
  return `${time} ${message}`;
}

async function renderMuteLogs() {
  const stored = await chrome.storage.local.get(MUTE_LOG_STORAGE_KEY);
  const logs = Array.isArray(stored[MUTE_LOG_STORAGE_KEY]) ? stored[MUTE_LOG_STORAGE_KEY] : [];
  muteLogList.textContent = "";

  if (logs.length === 0) {
    const item = document.createElement("li");
    item.className = "empty";
    item.textContent = "아직 차단 기록이 없습니다.";
    muteLogList.appendChild(item);
    return;
  }

  logs.slice(0, 8).forEach((log) => {
    const item = document.createElement("li");
    item.textContent = formatLog(log);
    muteLogList.appendChild(item);
  });
}

async function renderNextQueue() {
  const stored = await chrome.storage.local.get(NEXT_QUEUE_STORAGE_KEY);
  const queue = Array.isArray(stored[NEXT_QUEUE_STORAGE_KEY]) ? stored[NEXT_QUEUE_STORAGE_KEY] : [];
  nextQueueList.textContent = "";

  if (queue.length === 0) {
    const item = document.createElement("li");
    item.className = "empty";
    item.textContent = "대기 중인 영상이 없습니다.";
    nextQueueList.appendChild(item);
    return;
  }

  queue.slice(0, 8).forEach((queuedVideo, index) => {
    const item = document.createElement("li");
    item.textContent = `${index + 1}. ${queuedVideo.title || queuedVideo.url || "YouTube video"}`;
    nextQueueList.appendChild(item);
  });
}

async function init() {
  const settings = await loadSettings();
  render(settings);
  await renderMuteLogs();
  await renderNextQueue();

  zoomRange.addEventListener("input", async (event) => {
    await saveSettings(getCurrentControlSettings({ zoomPercent: event.target.value }));
  });

  enableToggle.addEventListener("change", async () => {
    await saveSettings(getCurrentControlSettings());
  });

  logoutGuardToggle.addEventListener("change", async () => {
    await saveSettings(getCurrentControlSettings());
  });

  muteGuardToggle.addEventListener("change", async () => {
    await saveSettings(getCurrentControlSettings());
  });

  previewMuteToggle.addEventListener("change", async () => {
    await saveSettings(getCurrentControlSettings());
  });

  pauseGuardToggle.addEventListener("change", async () => {
    await saveSettings(getCurrentControlSettings());
  });

  nextQueueToggle.addEventListener("change", async () => {
    await saveSettings(getCurrentControlSettings());
  });

  clearMuteLogsButton.addEventListener("click", async () => {
    await chrome.storage.local.set({
      [MUTE_LOG_STORAGE_KEY]: []
    });
    await renderMuteLogs();
    showStatus("차단 기록을 지웠습니다.");
  });

  clearNextQueueButton.addEventListener("click", async () => {
    await chrome.storage.local.set({
      [NEXT_QUEUE_STORAGE_KEY]: []
    });
    await renderNextQueue();
    showStatus("다음 재생 큐를 비웠습니다.");
  });

  resetButton.addEventListener("click", async () => {
    await saveSettings(DEFAULT_SETTINGS);
  });

  document.querySelectorAll("[data-zoom]").forEach((button) => {
    button.addEventListener("click", async () => {
      await saveSettings(getCurrentControlSettings({ zoomPercent: button.dataset.zoom }));
    });
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes[MUTE_LOG_STORAGE_KEY]) {
      renderMuteLogs().catch(() => {});
    }

    if (areaName === "local" && changes[NEXT_QUEUE_STORAGE_KEY]) {
      renderNextQueue().catch(() => {});
    }
  });
}

init().catch((error) => {
  status.textContent = `오류: ${error.message}`;
});
