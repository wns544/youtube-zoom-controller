const STORAGE_KEY = "fullscreenZoomSettings";
const DEFAULT_SETTINGS = {
  enabled: true,
  zoomPercent: 100,
  offsetX: 0,
  offsetY: 0
};

const zoomRange = document.getElementById("zoomRange");
const zoomValue = document.getElementById("zoomValue");
const enableToggle = document.getElementById("enableToggle");
const resetButton = document.getElementById("resetButton");
const status = document.getElementById("status");

function clampZoom(value) {
  return Math.min(150, Math.max(50, Number(value) || DEFAULT_SETTINGS.zoomPercent));
}

function render(settings) {
  zoomRange.value = String(settings.zoomPercent);
  zoomValue.textContent = `${settings.zoomPercent}%`;
  enableToggle.checked = settings.enabled;
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
  return {
    ...DEFAULT_SETTINGS,
    ...(stored[STORAGE_KEY] || {}),
    zoomPercent: clampZoom(stored[STORAGE_KEY]?.zoomPercent)
  };
}

async function saveSettings(nextSettings) {
  const currentSettings = await loadSettings();
  const settings = {
    ...currentSettings,
    ...nextSettings,
    enabled: Boolean(nextSettings.enabled),
    zoomPercent: clampZoom(nextSettings.zoomPercent)
  };

  await chrome.storage.sync.set({
    [STORAGE_KEY]: settings
  });

  render(settings);
  showStatus("저장되었습니다.");
}

async function init() {
  const settings = await loadSettings();
  render(settings);

  zoomRange.addEventListener("input", async (event) => {
    await saveSettings({
      enabled: enableToggle.checked,
      zoomPercent: event.target.value
    });
  });

  enableToggle.addEventListener("change", async () => {
    await saveSettings({
      enabled: enableToggle.checked,
      zoomPercent: zoomRange.value
    });
  });

  resetButton.addEventListener("click", async () => {
    await saveSettings(DEFAULT_SETTINGS);
  });

  document.querySelectorAll("[data-zoom]").forEach((button) => {
    button.addEventListener("click", async () => {
      await saveSettings({
        enabled: enableToggle.checked,
        zoomPercent: button.dataset.zoom
      });
    });
  });
}

init().catch((error) => {
  status.textContent = `오류: ${error.message}`;
});
