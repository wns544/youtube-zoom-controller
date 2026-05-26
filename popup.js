const STORAGE_KEY = "fullscreenZoomSettings";
const DEFAULT_SETTINGS = {
  enabled: true,
  zoomPercent: 100,
  offsetX: 0,
  offsetY: 0,
  logoutGuardEnabled: false
};

const zoomRange = document.getElementById("zoomRange");
const zoomValue = document.getElementById("zoomValue");
const enableToggle = document.getElementById("enableToggle");
const logoutGuardToggle = document.getElementById("logoutGuardToggle");
const resetButton = document.getElementById("resetButton");
const status = document.getElementById("status");

function clampZoom(value) {
  return Math.min(150, Math.max(50, Number(value) || DEFAULT_SETTINGS.zoomPercent));
}

function render(settings) {
  zoomRange.value = String(settings.zoomPercent);
  zoomValue.textContent = `${settings.zoomPercent}%`;
  enableToggle.checked = settings.enabled;
  logoutGuardToggle.checked = Boolean(settings.logoutGuardEnabled);
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
    zoomPercent: clampZoom(stored[STORAGE_KEY]?.zoomPercent),
    logoutGuardEnabled: Boolean(stored[STORAGE_KEY]?.logoutGuardEnabled)
  };
}

async function saveSettings(nextSettings) {
  const currentSettings = await loadSettings();
  const settings = {
    ...currentSettings,
    ...nextSettings,
    enabled: Boolean(nextSettings.enabled),
    zoomPercent: clampZoom(nextSettings.zoomPercent),
    logoutGuardEnabled: Boolean(
      nextSettings.logoutGuardEnabled ?? currentSettings.logoutGuardEnabled
    )
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
      zoomPercent: event.target.value,
      logoutGuardEnabled: logoutGuardToggle.checked
    });
  });

  enableToggle.addEventListener("change", async () => {
    await saveSettings({
      enabled: enableToggle.checked,
      zoomPercent: zoomRange.value,
      logoutGuardEnabled: logoutGuardToggle.checked
    });
  });

  logoutGuardToggle.addEventListener("change", async () => {
    await saveSettings({
      enabled: enableToggle.checked,
      zoomPercent: zoomRange.value,
      logoutGuardEnabled: logoutGuardToggle.checked
    });
  });

  resetButton.addEventListener("click", async () => {
    await saveSettings(DEFAULT_SETTINGS);
  });

  document.querySelectorAll("[data-zoom]").forEach((button) => {
    button.addEventListener("click", async () => {
      await saveSettings({
        enabled: enableToggle.checked,
        zoomPercent: button.dataset.zoom,
        logoutGuardEnabled: logoutGuardToggle.checked
      });
    });
  });
}

init().catch((error) => {
  status.textContent = `오류: ${error.message}`;
});
