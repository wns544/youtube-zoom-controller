const STORAGE_KEY = "fullscreenZoomSettings";
const DEFAULT_SETTINGS = {
  enabled: true,
  zoomPercent: 100,
  offsetX: 0,
  offsetY: 0
};
const STYLE_ID = "yt-fullscreen-zoom-style";
const BUTTON_STYLE_ID = "yt-fullscreen-zoom-button-style";
const BUTTON_CLASS = "ytp-button yt-zoom-button";
const BUTTON_TITLE = "전체화면 배율 조절";
const ZOOM_STEPS = [65, 75, 80, 90, 100, 110, 120, 130];
const MOVE_STEP = 20;
const PAGE_HOOK_ID = "yt-fullscreen-zoom-page-hook";
const SHORTCUT_EVENT = "yt-fullscreen-zoom-shortcut";

function clampZoom(value) {
  return Math.min(150, Math.max(50, Number(value) || DEFAULT_SETTINGS.zoomPercent));
}

function clampOffset(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

async function readSettings() {
  const stored = await chrome.storage.sync.get(STORAGE_KEY);
  return {
    ...DEFAULT_SETTINGS,
    ...(stored[STORAGE_KEY] || {}),
    zoomPercent: clampZoom(stored[STORAGE_KEY]?.zoomPercent),
    offsetX: clampOffset(stored[STORAGE_KEY]?.offsetX),
    offsetY: clampOffset(stored[STORAGE_KEY]?.offsetY)
  };
}

function ensureStyleElement() {
  let style = document.getElementById(STYLE_ID);

  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    document.documentElement.appendChild(style);
  }

  return style;
}

function ensureButtonStyle() {
  let style = document.getElementById(BUTTON_STYLE_ID);

  if (!style) {
    style = document.createElement("style");
    style.id = BUTTON_STYLE_ID;
    style.textContent = `
      .ytp-button.yt-zoom-button {
        width: auto !important;
        min-width: 48px;
        padding: 0 10px !important;
        font-size: 12px !important;
        font-weight: 700 !important;
        letter-spacing: -0.02em;
      }

      .ytp-button.yt-zoom-button .yt-zoom-label {
        display: inline-block;
        line-height: 36px;
      }
    `;
    document.documentElement.appendChild(style);
  }

  return style;
}

function injectPageShortcutHook() {
  if (document.getElementById(PAGE_HOOK_ID)) {
    return;
  }

  const script = document.createElement("script");
  script.id = PAGE_HOOK_ID;
  script.src = chrome.runtime.getURL("pageHook.js");
  script.dataset.shortcutEvent = SHORTCUT_EVENT;

  (document.documentElement || document.head || document.body).appendChild(script);
}

function applySettings(settings) {
  const style = ensureStyleElement();
  const offsetX = clampOffset(settings.offsetX);
  const offsetY = clampOffset(settings.offsetY);

  if (!settings.enabled || (settings.zoomPercent === 100 && offsetX === 0 && offsetY === 0)) {
    style.textContent = "";
    return;
  }

  const scale = (settings.zoomPercent / 100).toFixed(2);

  style.textContent = `
    #movie_player video.html5-main-video,
    .html5-video-player video.html5-main-video,
    ytd-app video:-webkit-full-screen,
    ytd-app video:fullscreen,
    #movie_player.ytp-fullscreen video,
    .html5-video-player.ytp-fullscreen video {
      transform: translate(${offsetX}px, ${offsetY}px) scale(${scale}) !important;
      transform-origin: center center !important;
    }
  `;
}

async function saveSettings(nextSettings) {
  const settings = {
    enabled: Boolean(nextSettings.enabled),
    zoomPercent: clampZoom(nextSettings.zoomPercent),
    offsetX: clampOffset(nextSettings.offsetX),
    offsetY: clampOffset(nextSettings.offsetY)
  };

  await chrome.storage.sync.set({
    [STORAGE_KEY]: settings
  });
}

function getNextZoom(currentZoom) {
  const currentIndex = ZOOM_STEPS.indexOf(currentZoom);

  if (currentIndex === -1 || currentIndex === ZOOM_STEPS.length - 1) {
    return ZOOM_STEPS[0];
  }

  return ZOOM_STEPS[currentIndex + 1];
}

function getPreviousZoom(currentZoom) {
  const currentIndex = ZOOM_STEPS.indexOf(currentZoom);

  if (currentIndex <= 0) {
    return ZOOM_STEPS[ZOOM_STEPS.length - 1];
  }

  return ZOOM_STEPS[currentIndex - 1];
}

function updateButtonLabel(button, zoomPercent) {
  const label = button.querySelector(".yt-zoom-label");

  if (label) {
    label.textContent = `${zoomPercent}%`;
  }

  button.setAttribute("aria-label", `${BUTTON_TITLE}: ${zoomPercent}%`);
  button.title = `${BUTTON_TITLE}: ${zoomPercent}%`;
}

async function handleZoomButtonClick(event) {
  event.preventDefault();
  event.stopPropagation();

  const settings = await readSettings();
  const nextZoom = getNextZoom(settings.zoomPercent);
  const nextSettings = {
    ...settings,
    enabled: true,
    zoomPercent: nextZoom
  };

  await saveSettings(nextSettings);
  applySettings(nextSettings);

  document.querySelectorAll(".yt-zoom-button").forEach((button) => {
    updateButtonLabel(button, nextZoom);
  });
}

function isEditableTarget(target) {
  if (!target) {
    return false;
  }

  const tagName = target.tagName?.toLowerCase();
  return target.isContentEditable || tagName === "input" || tagName === "textarea";
}

function isFullscreenPlayerActive() {
  const player = document.getElementById("movie_player");
  return Boolean(document.fullscreenElement) && Boolean(player?.classList.contains("ytp-fullscreen"));
}

function isPlayerActive() {
  const player = document.getElementById("movie_player");
  const video = player?.querySelector("video.html5-main-video");
  return Boolean(player && video);
}

async function moveVideoBy(deltaX, deltaY) {
  const settings = await readSettings();
  const nextSettings = {
    ...settings,
    enabled: true,
    offsetX: settings.offsetX + deltaX,
    offsetY: settings.offsetY + deltaY
  };

  await saveSettings(nextSettings);
  applySettings(nextSettings);
}

async function resetVideoPosition() {
  const settings = await readSettings();
  const nextSettings = {
    ...settings,
    offsetX: 0,
    offsetY: 0
  };

  await saveSettings(nextSettings);
  applySettings(nextSettings);
}

async function resetVideoZoom() {
  const settings = await readSettings();
  const nextSettings = {
    ...settings,
    zoomPercent: 100
  };

  await saveSettings(nextSettings);
  applySettings(nextSettings);

  document.querySelectorAll(".yt-zoom-button").forEach((button) => {
    updateButtonLabel(button, nextSettings.zoomPercent);
  });
}

async function increaseVideoZoom() {
  const settings = await readSettings();
  const nextSettings = {
    ...settings,
    enabled: true,
    zoomPercent: getNextZoom(settings.zoomPercent)
  };

  await saveSettings(nextSettings);
  applySettings(nextSettings);
  document.querySelectorAll(".yt-zoom-button").forEach((button) => {
    updateButtonLabel(button, nextSettings.zoomPercent);
  });
}

async function decreaseVideoZoom() {
  const settings = await readSettings();
  const nextSettings = {
    ...settings,
    enabled: true,
    zoomPercent: getPreviousZoom(settings.zoomPercent)
  };

  await saveSettings(nextSettings);
  applySettings(nextSettings);
  document.querySelectorAll(".yt-zoom-button").forEach((button) => {
    updateButtonLabel(button, nextSettings.zoomPercent);
  });
}

function handleShortcutAction(action) {
  const moveByKey = {
    ArrowUp: { x: 0, y: -MOVE_STEP },
    ArrowDown: { x: 0, y: MOVE_STEP },
    ArrowLeft: { x: -MOVE_STEP, y: 0 },
    ArrowRight: { x: MOVE_STEP, y: 0 }
  };

  if (action === "Backspace") {
    resetVideoZoom().catch(() => {});
    return;
  }

  if (action === "Delete") {
    resetVideoPosition().catch(() => {});
    return;
  }

  if (action === "ZoomIn") {
    increaseVideoZoom().catch(() => {});
    return;
  }

  if (action === "ZoomOut") {
    decreaseVideoZoom().catch(() => {});
    return;
  }

  const move = moveByKey[action];
  if (!move) {
    return;
  }

  moveVideoBy(move.x, move.y).catch(() => {});
}

function handleDirectKeyboardShortcut(event) {
  const isMoveShortcut =
    event.shiftKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.metaKey &&
    event.key.startsWith("Arrow");

  const isResetShortcut =
    event.shiftKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.metaKey &&
    (event.key === "Backspace" || event.key === "Delete");

  const isZoomInShortcut =
    event.shiftKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.metaKey &&
    (event.code === "Equal" || event.code === "NumpadAdd");

  const isZoomOutShortcut =
    event.shiftKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.metaKey &&
    (event.code === "Minus" || event.code === "NumpadSubtract");

  if (!isMoveShortcut && !isResetShortcut && !isZoomInShortcut && !isZoomOutShortcut) {
    return;
  }

  if (isEditableTarget(event.target)) {
    return;
  }

  if ((isMoveShortcut || isZoomInShortcut || isZoomOutShortcut || isResetShortcut) && !isPlayerActive()) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  if (isZoomInShortcut) {
    handleShortcutAction("ZoomIn");
    return;
  }

  if (isZoomOutShortcut) {
    handleShortcutAction("ZoomOut");
    return;
  }

  handleShortcutAction(event.key);
}

function handleInjectedShortcut(event) {
  if (event.detail?.type !== "keydown") {
    return;
  }

  handleShortcutAction(event.detail.action || event.detail.key);
}

function createZoomButton(zoomPercent) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = BUTTON_CLASS;
  button.dataset.zoomButton = "true";
  button.innerHTML = `<span class="yt-zoom-label">${zoomPercent}%</span>`;
  button.addEventListener("click", handleZoomButtonClick);
  updateButtonLabel(button, zoomPercent);
  return button;
}

async function syncButtons() {
  const settings = await readSettings();
  document.querySelectorAll(".yt-zoom-button").forEach((button) => {
    updateButtonLabel(button, settings.zoomPercent);
  });
}

function mountZoomButton() {
  ensureButtonStyle();

  const player = document.getElementById("movie_player");
  const rightControls = player?.querySelector(".ytp-right-controls");

  if (!rightControls) {
    return false;
  }

  if (rightControls.querySelector(".yt-zoom-button")) {
    return true;
  }

  const button = createZoomButton(DEFAULT_SETTINGS.zoomPercent);

  const firstChild = rightControls.firstElementChild;

  if (firstChild && firstChild.parentNode === rightControls) {
    rightControls.insertBefore(button, firstChild);
  } else {
    rightControls.appendChild(button);
  }

  syncButtons().catch(() => {});
  return true;
}

function observePlayerControls() {
  const observer = new MutationObserver(() => {
    mountZoomButton();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
}

async function refresh() {
  const settings = await readSettings();
  applySettings(settings);
  mountZoomButton();

  const button = document.querySelector(".yt-zoom-button");
  if (button) {
    updateButtonLabel(button, settings.zoomPercent);
  }
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync" || !changes[STORAGE_KEY]) {
    return;
  }

  const nextValue = {
    ...DEFAULT_SETTINGS,
    ...changes[STORAGE_KEY].newValue,
    zoomPercent: clampZoom(changes[STORAGE_KEY].newValue?.zoomPercent),
    offsetX: clampOffset(changes[STORAGE_KEY].newValue?.offsetX),
    offsetY: clampOffset(changes[STORAGE_KEY].newValue?.offsetY)
  };

  applySettings(nextValue);
  syncButtons().catch(() => {});
});

document.addEventListener("fullscreenchange", () => {
  refresh().catch(() => {});
});
document.addEventListener("keydown", handleDirectKeyboardShortcut, true);
window.addEventListener("keydown", handleDirectKeyboardShortcut, true);
window.addEventListener(SHORTCUT_EVENT, handleInjectedShortcut);

injectPageShortcutHook();
observePlayerControls();
refresh().catch(() => {});
