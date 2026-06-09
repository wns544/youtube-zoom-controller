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
  nextQueueEnabled: true
};
const STYLE_ID = "yt-fullscreen-zoom-style";
const BUTTON_STYLE_ID = "yt-fullscreen-zoom-button-style";
const LOGOUT_STYLE_ID = "yt-logout-guard-style";
const NEXT_QUEUE_STYLE_ID = "yt-next-play-queue-style";
const NEXT_QUEUE_BUTTON_CLASS = "yt-next-play-queue-button";
const BUTTON_CLASS = "ytp-button yt-zoom-button";
const BUTTON_TITLE = "영상 배율 조절";
const ZOOM_STEPS = [65, 75, 80, 90, 100, 110, 120, 130];
const MOVE_STEP = 20;
const PAGE_HOOK_ID = "yt-fullscreen-zoom-page-hook";
const SHORTCUT_EVENT = "yt-fullscreen-zoom-shortcut";
const MUTE_SETTINGS_EVENT = "yt-mute-auto-watch-settings";
const MUTE_LOG_EVENT = "yt-mute-auto-watch-log";
const LOGOUT_BLOCK_MESSAGE =
  "확장프로그램(YouTube Fullscreen Zoom Controller)에 의해 로그아웃이 막혔습니다. 필요하면 설정에서 해제해 주세요.";
let isApplyingLogoutGuard = false;
let logoutGuardRefreshTimer = 0;
let pauseGuardRefreshTimer = 0;
let lastPausePromptClickAt = 0;
let pauseGuardRetryTimer = 0;
let queueButtonRefreshTimer = 0;
let currentVideoWithQueueHandler = null;

function clampZoom(value) {
  return Math.min(150, Math.max(50, Number(value) || DEFAULT_SETTINGS.zoomPercent));
}

function clampOffset(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function normalizeSettings(rawSettings = {}) {
  return {
    ...DEFAULT_SETTINGS,
    ...rawSettings,
    zoomPercent: clampZoom(rawSettings.zoomPercent),
    offsetX: clampOffset(rawSettings.offsetX),
    offsetY: clampOffset(rawSettings.offsetY),
    logoutGuardEnabled: Boolean(rawSettings.logoutGuardEnabled),
    muteGuardEnabled: rawSettings.muteGuardEnabled !== false,
    pauseGuardEnabled: rawSettings.pauseGuardEnabled !== false,
    nextQueueEnabled: rawSettings.nextQueueEnabled !== false
  };
}

async function readSettings() {
  const stored = await chrome.storage.sync.get(STORAGE_KEY);
  return normalizeSettings(stored[STORAGE_KEY] || {});
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

function ensureLogoutGuardStyle() {
  let style = document.getElementById(LOGOUT_STYLE_ID);

  if (!style) {
    style = document.createElement("style");
    style.id = LOGOUT_STYLE_ID;
    style.textContent = `
      .yt-logout-guarded {
        opacity: 0.52 !important;
        cursor: not-allowed !important;
      }

      .yt-logout-guarded * {
        cursor: not-allowed !important;
      }

      .yt-logout-guard-note {
        margin: 4px 16px 10px 56px;
        padding: 8px 10px;
        border-radius: 10px;
        background: rgba(204, 75, 25, 0.12);
        color: #8b3411;
        font-size: 12px;
        line-height: 1.4;
      }
    `;
    document.documentElement.appendChild(style);
  }

  return style;
}

function ensureNextQueueStyle() {
  let style = document.getElementById(NEXT_QUEUE_STYLE_ID);

  if (!style) {
    style = document.createElement("style");
    style.id = NEXT_QUEUE_STYLE_ID;
    style.textContent = `
      .${NEXT_QUEUE_BUTTON_CLASS} {
        position: absolute;
        right: 6px;
        bottom: 6px;
        z-index: 20;
        min-width: 42px;
        height: 26px;
        padding: 0 8px;
        border: 1px solid rgba(255, 255, 255, 0.35);
        border-radius: 5px;
        background: rgba(0, 0, 0, 0.82);
        color: #fff;
        cursor: pointer;
        font: 700 12px/24px "Segoe UI", Arial, sans-serif;
        text-align: center;
      }

      .${NEXT_QUEUE_BUTTON_CLASS}:hover {
        background: rgba(204, 75, 25, 0.95);
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

function syncMuteGuardSettings(settings) {
  window.dispatchEvent(new CustomEvent(MUTE_SETTINGS_EVENT, {
    detail: {
      autoUnmute: settings.muteGuardEnabled !== false
    }
  }));
}

async function recordMuteGuardLog(event) {
  const detail = event.detail || {};
  if (!detail.entry) {
    return;
  }

  const stored = await chrome.storage.local.get(MUTE_LOG_STORAGE_KEY);
  const logs = Array.isArray(stored[MUTE_LOG_STORAGE_KEY]) ? stored[MUTE_LOG_STORAGE_KEY] : [];
  logs.unshift({
    entry: String(detail.entry),
    message: String(detail.message || ""),
    timestamp: Number(detail.timestamp) || Date.now(),
    autoUnmute: detail.autoUnmute !== false,
    url: location.href
  });
  logs.length = Math.min(logs.length, 40);

  await chrome.storage.local.set({
    [MUTE_LOG_STORAGE_KEY]: logs
  });
}

async function saveSettings(nextSettings) {
  const settings = normalizeSettings(nextSettings);

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

function isLogoutLabel(text) {
  const normalized = text.replace(/\s+/g, " ").trim().toLowerCase();
  return normalized === "로그아웃" || normalized === "sign out";
}

function findLogoutMenuItems() {
  const candidates = document.querySelectorAll(
    "tp-yt-paper-item, ytd-compact-link-renderer, ytd-compact-service-item-renderer, ytd-menu-service-item-renderer"
  );

  const items = new Set();

  Array.from(candidates)
    .filter((element) => isLogoutLabel(element.textContent || ""))
    .forEach((element) => {
      const renderer =
        element.closest("ytd-compact-link-renderer") ||
        element.closest("ytd-compact-service-item-renderer") ||
        element.closest("ytd-menu-service-item-renderer") ||
        element.closest("tp-yt-paper-item") ||
        element;

      items.add(renderer);
    });

  return Array.from(items);
}

function clearLogoutGuardUI() {
  document.querySelectorAll(".yt-logout-guard-note").forEach((note) => note.remove());
  document.querySelectorAll("[data-logout-guard-note='true']").forEach((note) => note.remove());
  document.querySelectorAll(".yt-logout-guarded").forEach((item) => {
    item.classList.remove("yt-logout-guarded");
    item.removeAttribute("aria-disabled");
    item.removeAttribute("data-logout-guarded");
  });
}

function applyLogoutGuard(settings) {
  isApplyingLogoutGuard = true;
  ensureLogoutGuardStyle();
  clearLogoutGuardUI();

  try {
    if (!settings.logoutGuardEnabled) {
      return;
    }

    findLogoutMenuItems().forEach((item) => {
      const nextElement = item.nextElementSibling;
      if (nextElement?.dataset.logoutGuardNote === "true") {
        nextElement.remove();
      }

      item.classList.add("yt-logout-guarded");
      item.setAttribute("aria-disabled", "true");
      item.dataset.logoutGuarded = "true";

      const note = document.createElement("div");
      note.className = "yt-logout-guard-note";
      note.dataset.logoutGuardNote = "true";
      note.textContent = LOGOUT_BLOCK_MESSAGE;
      item.insertAdjacentElement("afterend", note);
    });
  } finally {
    window.setTimeout(() => {
      isApplyingLogoutGuard = false;
    }, 0);
  }
}

function handleLogoutGuardClick(event) {
  const blockedItem = event.target.closest("[data-logout-guarded='true']");
  if (!blockedItem) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
}

function scheduleLogoutGuardRefresh() {
  if (isApplyingLogoutGuard) {
    return;
  }

  window.clearTimeout(logoutGuardRefreshTimer);
  logoutGuardRefreshTimer = window.setTimeout(() => {
    readSettings()
      .then((settings) => {
        applyLogoutGuard(settings);
      })
      .catch(() => {});
  }, 80);
}

function matchesContinueWatchingPrompt(text) {
  const normalized = text.replace(/\s+/g, " ").trim().toLowerCase();
  return (
    normalized.includes("동영상이 일시중지") ||
    normalized.includes("이어서 시청") ||
    normalized.includes("video paused") ||
    normalized.includes("continue watching")
  );
}

function isContinueButton(element) {
  const text = (element.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
  const ariaLabel = (element.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim().toLowerCase();
  return (
    text === "예" ||
    text === "확인" ||
    text === "yes" ||
    text === "ok" ||
    text.includes("계속") ||
    text.includes("이어서") ||
    text.includes("시청") ||
    text.includes("continue") ||
    ariaLabel.includes("확인") ||
    ariaLabel.includes("continue") ||
    ariaLabel.includes("이어서")
  );
}

function findContinueWatchingDialog() {
  const candidates = document.querySelectorAll(
    "yt-confirm-dialog-renderer, tp-yt-paper-dialog, ytd-popup-container, ytd-popup-container *, [role='dialog']"
  );

  return Array.from(candidates).find((element) => {
    const text = element.textContent || "";
    return matchesContinueWatchingPrompt(text);
  });
}

function findContinueWatchingButton(dialog) {
  const preferredSelectors = [
    "#confirm-button button",
    "#confirm-button",
    "yt-button-shape button",
    "ytd-button-renderer button",
    "tp-yt-paper-button",
    "button"
  ];

  for (const selector of preferredSelectors) {
    const candidates = Array.from(dialog.querySelectorAll(selector));
    const match = candidates.find(isContinueButton);
    if (match) {
      return match;
    }
  }

  return Array.from(document.querySelectorAll("button, tp-yt-paper-button, yt-button-shape button, ytd-button-renderer button"))
    .find((element) => isContinueButton(element) && matchesContinueWatchingPrompt(element.closest("[role='dialog'], yt-confirm-dialog-renderer, tp-yt-paper-dialog, ytd-popup-container")?.textContent || dialog.textContent || ""));
}

function dispatchRealClick(element) {
  const eventOptions = {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window
  };

  element.focus?.();

  ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach((type) => {
    const EventConstructor = type.startsWith("pointer") && window.PointerEvent ? PointerEvent : MouseEvent;
    element.dispatchEvent(new EventConstructor(type, eventOptions));
  });

  element.click?.();
}

function resumeVisibleVideos() {
  document.querySelectorAll("video").forEach((video) => {
    if (!video.paused) {
      return;
    }

    video.play?.().catch(() => {});
  });
}

function clickContinueWatchingPrompt(settings) {
  if (!settings.pauseGuardEnabled) {
    return false;
  }

  const now = Date.now();
  if (now - lastPausePromptClickAt < 1200) {
    return false;
  }

  const dialog = findContinueWatchingDialog();
  if (!dialog) {
    return false;
  }

  const button = findContinueWatchingButton(dialog);

  if (!button) {
    return false;
  }

  lastPausePromptClickAt = now;
  dispatchRealClick(button);
  resumeVisibleVideos();
  window.clearTimeout(pauseGuardRetryTimer);
  pauseGuardRetryTimer = window.setTimeout(() => {
    resumeVisibleVideos();
    readSettings()
      .then((nextSettings) => {
        if (nextSettings.pauseGuardEnabled) {
          const nextDialog = findContinueWatchingDialog();
          const nextButton = nextDialog ? findContinueWatchingButton(nextDialog) : null;
          if (nextButton) {
            dispatchRealClick(nextButton);
            resumeVisibleVideos();
          }
        }
      })
      .catch(() => {});
  }, 500);
  return true;
}

function schedulePauseGuardRefresh() {
  window.clearTimeout(pauseGuardRefreshTimer);
  pauseGuardRefreshTimer = window.setTimeout(() => {
    readSettings()
      .then((settings) => {
        clickContinueWatchingPrompt(settings);
      })
      .catch(() => {});
  }, 120);
}

function getVideoIdFromUrl(rawUrl) {
  try {
    const url = new URL(rawUrl, location.origin);
    if (!url.hostname.includes("youtube.com")) {
      return "";
    }

    return url.searchParams.get("v") || "";
  } catch {
    return "";
  }
}

function normalizeWatchUrl(rawUrl) {
  const videoId = getVideoIdFromUrl(rawUrl);
  if (!videoId) {
    return "";
  }

  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

function getCurrentVideoId() {
  return getVideoIdFromUrl(location.href);
}

async function readNextQueue() {
  const stored = await chrome.storage.local.get(NEXT_QUEUE_STORAGE_KEY);
  return Array.isArray(stored[NEXT_QUEUE_STORAGE_KEY]) ? stored[NEXT_QUEUE_STORAGE_KEY] : [];
}

async function writeNextQueue(queue) {
  await chrome.storage.local.set({
    [NEXT_QUEUE_STORAGE_KEY]: queue.slice(0, 50)
  });
}

function getVideoTitleFromAnchor(anchor) {
  const card = anchor.closest(
    "ytd-compact-video-renderer, ytd-video-renderer, ytd-rich-item-renderer, ytd-grid-video-renderer, ytd-playlist-panel-video-renderer"
  );
  const titleElement = card?.querySelector("#video-title, yt-formatted-string#video-title, a#video-title");
  return (
    titleElement?.textContent?.replace(/\s+/g, " ").trim() ||
    anchor.getAttribute("title") ||
    anchor.getAttribute("aria-label") ||
    "YouTube video"
  );
}

async function addVideoToNextQueue(anchor, button) {
  const url = normalizeWatchUrl(anchor.href);
  const id = getVideoIdFromUrl(url);

  if (!url || !id || id === getCurrentVideoId()) {
    return;
  }

  const queue = await readNextQueue();
  queue.push({
    id,
    url,
    title: getVideoTitleFromAnchor(anchor),
    addedAt: Date.now()
  });

  await writeNextQueue(queue);

  if (button) {
    button.textContent = "추가됨";
    window.setTimeout(() => {
      button.textContent = "큐+";
    }, 900);
  }
}

function findThumbnailHost(anchor) {
  return (
    anchor.closest("#thumbnail") ||
    anchor.closest("ytd-thumbnail") ||
    anchor.parentElement
  );
}

function mountNextQueueButton(anchor, settings) {
  if (!settings.nextQueueEnabled || anchor.dataset.nextQueueMounted === "true") {
    return;
  }

  if (anchor.closest("ytd-playlist-panel-renderer, ytd-playlist-panel-video-renderer")) {
    return;
  }

  const url = normalizeWatchUrl(anchor.href);
  const id = getVideoIdFromUrl(url);
  if (!url || !id || id === getCurrentVideoId()) {
    return;
  }

  const host = findThumbnailHost(anchor);
  if (!host || host.querySelector(`.${NEXT_QUEUE_BUTTON_CLASS}`)) {
    return;
  }

  const hostStyle = window.getComputedStyle(host);
  if (hostStyle.position === "static") {
    host.style.position = "relative";
  }

  const button = document.createElement("button");
  button.type = "button";
  button.className = NEXT_QUEUE_BUTTON_CLASS;
  button.textContent = "큐+";
  button.title = "확장 큐에 다음 재생으로 추가";
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    addVideoToNextQueue(anchor, button).catch(() => {});
  }, true);

  host.appendChild(button);
  anchor.dataset.nextQueueMounted = "true";
}

function clearNextQueueButtons() {
  document.querySelectorAll(`.${NEXT_QUEUE_BUTTON_CLASS}`).forEach((button) => button.remove());
  document.querySelectorAll("[data-next-queue-mounted='true']").forEach((anchor) => {
    delete anchor.dataset.nextQueueMounted;
  });
}

function mountNextQueueButtons(settings) {
  ensureNextQueueStyle();

  if (!settings.nextQueueEnabled) {
    clearNextQueueButtons();
    return;
  }

  const anchors = document.querySelectorAll(
    "a#thumbnail[href*='/watch'], a.yt-simple-endpoint[href*='/watch?v='], ytd-thumbnail a[href*='/watch?v=']"
  );

  anchors.forEach((anchor) => {
    mountNextQueueButton(anchor, settings);
  });
}

function scheduleNextQueueButtonRefresh() {
  window.clearTimeout(queueButtonRefreshTimer);
  queueButtonRefreshTimer = window.setTimeout(() => {
    readSettings()
      .then((settings) => {
        mountNextQueueButtons(settings);
        attachNextQueuePlaybackHandler();
      })
      .catch(() => {});
  }, 180);
}

async function playNextQueuedVideo() {
  const queue = await readNextQueue();
  const nextItem = queue.shift();

  if (!nextItem?.url) {
    return false;
  }

  await writeNextQueue(queue);
  location.assign(nextItem.url);
  return true;
}

function attachNextQueuePlaybackHandler() {
  const video = document.querySelector("video.html5-main-video") || document.querySelector("video");
  if (!video || video === currentVideoWithQueueHandler) {
    return;
  }

  if (currentVideoWithQueueHandler) {
    currentVideoWithQueueHandler.removeEventListener("ended", handleVideoEndedForNextQueue);
  }

  currentVideoWithQueueHandler = video;
  video.addEventListener("ended", handleVideoEndedForNextQueue);
}

function handleVideoEndedForNextQueue() {
  readSettings()
    .then((settings) => {
      if (settings.nextQueueEnabled) {
        return playNextQueuedVideo();
      }

      return false;
    })
    .catch(() => {});
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
    scheduleLogoutGuardRefresh();
    schedulePauseGuardRefresh();
    scheduleNextQueueButtonRefresh();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
}

async function refresh() {
  const settings = await readSettings();
  applySettings(settings);
  applyLogoutGuard(settings);
  mountNextQueueButtons(settings);
  attachNextQueuePlaybackHandler();
  mountZoomButton();

  const button = document.querySelector(".yt-zoom-button");
  if (button) {
    updateButtonLabel(button, settings.zoomPercent);
  }

  return settings;
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync" || !changes[STORAGE_KEY]) {
    return;
  }

  const nextValue = normalizeSettings(changes[STORAGE_KEY].newValue || {});

  applySettings(nextValue);
  syncMuteGuardSettings(nextValue);
  applyLogoutGuard(nextValue);
  clickContinueWatchingPrompt(nextValue);
  mountNextQueueButtons(nextValue);
  attachNextQueuePlaybackHandler();
  syncButtons().catch(() => {});
});

document.addEventListener("fullscreenchange", () => {
  refresh().catch(() => {});
});
document.addEventListener("keydown", handleDirectKeyboardShortcut, true);
document.addEventListener("click", handleLogoutGuardClick, true);
document.addEventListener("mouseup", handleLogoutGuardClick, true);
window.addEventListener("keydown", handleDirectKeyboardShortcut, true);
window.addEventListener(SHORTCUT_EVENT, handleInjectedShortcut);
window.addEventListener(MUTE_LOG_EVENT, (event) => {
  recordMuteGuardLog(event).catch(() => {});
});

injectPageShortcutHook();
observePlayerControls();
refresh()
  .then((settings) => {
    syncMuteGuardSettings(settings);
    clickContinueWatchingPrompt(settings);
    mountNextQueueButtons(settings);
    attachNextQueuePlaybackHandler();
  })
  .catch(() => {});

window.setInterval(() => {
  schedulePauseGuardRefresh();
  scheduleNextQueueButtonRefresh();
}, 5000);
