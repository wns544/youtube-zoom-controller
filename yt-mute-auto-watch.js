(() => {
  "use strict";

  if (window.__ytMuteAutoWatcher?.version) {
    return;
  }

  const VERSION = "1.0.0";
  const USER_INTENT_WINDOW_MS = 1800;
  const PANEL_ID = "yt-mute-auto-watch-panel";
  const PANEL_STYLE_ID = "yt-mute-auto-watch-style";
  const SETTINGS_EVENT = "yt-mute-auto-watch-settings";
  const LOG_EVENT = "yt-mute-auto-watch-log";
  const MAX_LOGS = 80;

  const descriptors = {
    muted: Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "muted"),
    defaultMuted: Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "defaultMuted"),
    volume: Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "volume")
  };

  const nativeSetAttribute = Element.prototype.setAttribute;
  const nativeToggleAttribute = Element.prototype.toggleAttribute;
  const nativeRemoveAttribute = Element.prototype.removeAttribute;

  let autoUnmute = true;
  let lastUserIntentAt = 0;
  let restoringDepth = 0;
  let panelHidden = true;

  const logs = [];
  const userMutedVideos = new WeakSet();
  const lastAudibleVolumes = new WeakMap();
  const observedVideos = new WeakSet();

  const isVideo = (value) => value instanceof HTMLVideoElement;

  const isProtectedPlaybackVideo = (video) => {
    if (!isVideo(video)) {
      return false;
    }

    return (
      video.classList?.contains("html5-main-video") ||
      Boolean(video.closest?.("#movie_player"))
    );
  };

  const now = () => Date.now();

  const hasRecentUserIntent = () => now() - lastUserIntentAt <= USER_INTENT_WINDOW_MS;

  const getVideos = () => Array.from(document.querySelectorAll("video"));

  const pushLog = (message) => {
    const entry = `${new Date().toLocaleTimeString()} ${message}`;
    logs.unshift(entry);
    logs.length = Math.min(logs.length, MAX_LOGS);
    window.dispatchEvent(new CustomEvent(LOG_EVENT, {
      detail: {
        entry,
        message,
        timestamp: now(),
        autoUnmute
      }
    }));

    if (!panelHidden) {
      renderPanel();
    }
  };

  const markUserIntent = (source) => {
    lastUserIntentAt = now();
    pushLog(`USER ${source}`);
  };

  const getElementText = (element) => {
    if (!element) {
      return "";
    }

    return [
      element.getAttribute?.("aria-label"),
      element.getAttribute?.("title"),
      element.textContent
    ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim().toLowerCase();
  };

  const isMuteControl = (target) => {
    const button = target?.closest?.(
      ".ytp-mute-button, button, tp-yt-paper-button, ytd-toggle-button-renderer, yt-icon-button"
    );

    if (!button) {
      return false;
    }

    const text = getElementText(button);
    return (
      button.classList?.contains("ytp-mute-button") ||
      text.includes("mute") ||
      text.includes("unmute") ||
      text.includes("음소거") ||
      text.includes("소리")
    );
  };

  const rememberAudibleVolume = (video) => {
    const volume = Number(video.volume);
    if (!Number.isNaN(volume) && volume > 0) {
      lastAudibleVolumes.set(video, volume);
    }
  };

  const isUserMutedVideo = (video) => userMutedVideos.has(video);

  const shouldBlockMute = (prop, value, video) => {
    if (!autoUnmute || restoringDepth > 0 || !isProtectedPlaybackVideo(video)) {
      return false;
    }

    if (hasRecentUserIntent()) {
      return false;
    }

    if (isUserMutedVideo(video)) {
      return false;
    }

    return (
      (prop === "muted" && value === true) ||
      (prop === "defaultMuted" && value === true) ||
      (prop === "volume" && Number(value) === 0)
    );
  };

  const shouldBlockMutedAttribute = (video) => {
    if (!autoUnmute || restoringDepth > 0 || !isProtectedPlaybackVideo(video)) {
      return false;
    }

    if (hasRecentUserIntent() || isUserMutedVideo(video)) {
      return false;
    }

    return true;
  };

  const withRestore = (callback) => {
    restoringDepth += 1;
    try {
      return callback();
    } finally {
      restoringDepth -= 1;
    }
  };

  const restoreVideoIfBlocked = (video, source) => {
    if (!autoUnmute || !isProtectedPlaybackVideo(video) || hasRecentUserIntent() || isUserMutedVideo(video)) {
      return false;
    }

    let changed = false;

    withRestore(() => {
      if (video.defaultMuted) {
        descriptors.defaultMuted?.set?.call(video, false);
        changed = true;
      }

      if (video.muted) {
        descriptors.muted?.set?.call(video, false);
        changed = true;
      }

      if (video.hasAttribute("muted")) {
        nativeRemoveAttribute.call(video, "muted");
        changed = true;
      }

      if (Number(video.volume) === 0) {
        const volume = lastAudibleVolumes.get(video) || 1;
        descriptors.volume?.set?.call(video, volume);
        changed = true;
      }
    });

    if (changed) {
      pushLog(`BLOCKED ${source}`);
    }

    return changed;
  };

  const patchMediaProperty = (prop) => {
    const descriptor = descriptors[prop];
    if (!descriptor?.get || !descriptor?.set || descriptor.set.__ytMuteAutoWatchPatched) {
      return;
    }

    const patchedSet = function patchedMediaSetter(value) {
      if (prop === "volume" && isVideo(this) && Number(value) > 0) {
        rememberAudibleVolume(this);
      }

      if (shouldBlockMute(prop, value, this)) {
        pushLog(`BLOCKED ${prop}=${String(value)}`);
        restoreVideoIfBlocked(this, prop);
        return;
      }

      descriptor.set.call(this, value);

      if (isProtectedPlaybackVideo(this)) {
        if (prop === "volume" && Number(value) > 0) {
          rememberAudibleVolume(this);
          userMutedVideos.delete(this);
          lastUserIntentAt = 0;
        }

        if (hasRecentUserIntent() && ((prop === "muted" && value === true) || (prop === "volume" && Number(value) === 0))) {
          userMutedVideos.add(this);
        }
      }
    };

    Object.defineProperty(patchedSet, "__ytMuteAutoWatchPatched", {
      value: true
    });

    Object.defineProperty(HTMLMediaElement.prototype, prop, {
      configurable: true,
      enumerable: descriptor.enumerable,
      get: descriptor.get,
      set: patchedSet
    });
  };

  const patchMutedAttributes = () => {
    Element.prototype.setAttribute = function patchedSetAttribute(name, value) {
      if (String(name).toLowerCase() === "muted" && shouldBlockMutedAttribute(this)) {
        pushLog("BLOCKED setAttribute(muted)");
        restoreVideoIfBlocked(this, "setAttribute");
        return undefined;
      }

      return nativeSetAttribute.call(this, name, value);
    };

    Element.prototype.toggleAttribute = function patchedToggleAttribute(name, force) {
      if (String(name).toLowerCase() === "muted" && force !== false && shouldBlockMutedAttribute(this)) {
        pushLog("BLOCKED toggleAttribute(muted)");
        restoreVideoIfBlocked(this, "toggleAttribute");
        return false;
      }

      return nativeToggleAttribute.call(this, name, force);
    };
  };

  const observeVideo = (video) => {
    if (!isVideo(video) || observedVideos.has(video)) {
      return;
    }

    observedVideos.add(video);
    rememberAudibleVolume(video);

    new MutationObserver((mutations) => {
      if (mutations.some((mutation) => mutation.attributeName === "muted")) {
        restoreVideoIfBlocked(video, "MutationObserver");
      }
    }).observe(video, {
      attributes: true,
      attributeFilter: ["muted"]
    });
  };

  const observeDocument = () => {
    getVideos().forEach(observeVideo);

    new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (isVideo(node)) {
            observeVideo(node);
          } else if (node?.querySelectorAll) {
            node.querySelectorAll("video").forEach(observeVideo);
          }
        }
      }
    }).observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  };

  const handlePossibleUserIntent = (event) => {
    if (event.type === "keydown" && event.code === "KeyM" && !event.ctrlKey && !event.altKey && !event.metaKey) {
      markUserIntent("KeyM");
      return;
    }

    if (isMuteControl(event.target)) {
      markUserIntent("mute button");
      getVideos().forEach((video) => {
        if (video.muted || Number(video.volume) === 0) {
          userMutedVideos.add(video);
        }
      });
    }
  };

  const ensurePanelStyle = () => {
    if (document.getElementById(PANEL_STYLE_ID)) {
      return;
    }

    const style = document.createElement("style");
    style.id = PANEL_STYLE_ID;
    style.textContent = `
      #${PANEL_ID} {
        position: fixed;
        right: 14px;
        bottom: 14px;
        z-index: 2147483647;
        width: 320px;
        max-height: 280px;
        box-sizing: border-box;
        padding: 10px;
        border: 1px solid rgba(255, 255, 255, 0.24);
        border-radius: 6px;
        background: rgba(0, 0, 0, 0.86);
        color: #f5f5f5;
        font: 12px/1.35 Arial, sans-serif;
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
      }

      #${PANEL_ID}[hidden] {
        display: none !important;
      }

      #${PANEL_ID} .ytmaw-title {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        font-weight: 700;
        margin-bottom: 6px;
      }

      #${PANEL_ID} .ytmaw-meta {
        color: #b6ffcc;
        margin-bottom: 8px;
      }

      #${PANEL_ID} .ytmaw-actions {
        display: flex;
        gap: 6px;
        margin-bottom: 8px;
      }

      #${PANEL_ID} button {
        border: 1px solid rgba(255, 255, 255, 0.28);
        border-radius: 4px;
        background: rgba(255, 255, 255, 0.12);
        color: #fff;
        cursor: pointer;
        font: inherit;
        padding: 4px 7px;
      }

      #${PANEL_ID} .ytmaw-log {
        max-height: 145px;
        overflow: auto;
        white-space: pre-wrap;
        color: #d9d9d9;
      }
    `;
    document.documentElement.appendChild(style);
  };

  function renderPanel() {
    if (!document.documentElement) {
      return;
    }

    ensurePanelStyle();

    let panel = document.getElementById(PANEL_ID);
    if (!panel) {
      panel = document.createElement("div");
      panel.id = PANEL_ID;

      const title = document.createElement("div");
      title.className = "ytmaw-title";

      const titleText = document.createElement("span");
      titleText.dataset.field = "title";

      const versionText = document.createElement("span");
      versionText.dataset.field = "version";

      const meta = document.createElement("div");
      meta.className = "ytmaw-meta";
      meta.dataset.field = "meta";

      const actions = document.createElement("div");
      actions.className = "ytmaw-actions";

      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.dataset.action = "toggle";

      const clear = document.createElement("button");
      clear.type = "button";
      clear.dataset.action = "clear";
      clear.textContent = "Clear";

      const hide = document.createElement("button");
      hide.type = "button";
      hide.dataset.action = "hide";
      hide.textContent = "Hide";

      const log = document.createElement("div");
      log.className = "ytmaw-log";
      log.dataset.field = "log";

      title.appendChild(titleText);
      title.appendChild(versionText);
      actions.appendChild(toggle);
      actions.appendChild(clear);
      actions.appendChild(hide);
      panel.appendChild(title);
      panel.appendChild(meta);
      panel.appendChild(actions);
      panel.appendChild(log);

      panel.addEventListener("click", (event) => {
        const action = event.target?.dataset?.action;
        if (action === "toggle") {
          autoUnmute = !autoUnmute;
          pushLog(`AUTO ${autoUnmute ? "ON" : "OFF"}`);
        } else if (action === "clear") {
          logs.length = 0;
          renderPanel();
        } else if (action === "hide") {
          panelHidden = true;
          renderPanel();
        }
      });
      document.documentElement.appendChild(panel);
    }

    panel.hidden = panelHidden;
    panel.querySelector("[data-field='title']").textContent = `YT Mute logs (${logs.length})`;
    panel.querySelector("[data-field='version']").textContent = VERSION;
    panel.querySelector("[data-field='meta']").textContent = `Auto unmute ${autoUnmute ? "ON" : "OFF"} / user intent window ${USER_INTENT_WINDOW_MS}ms`;
    panel.querySelector("[data-action='toggle']").textContent = `Auto ${autoUnmute ? "ON" : "OFF"}`;
    panel.querySelector("[data-field='log']").textContent = logs.slice(0, 24).join("\n");
  }

  patchMediaProperty("muted");
  patchMediaProperty("defaultMuted");
  patchMediaProperty("volume");
  patchMutedAttributes();

  document.addEventListener("keydown", handlePossibleUserIntent, true);
  document.addEventListener("click", handlePossibleUserIntent, true);
  document.addEventListener("pointerdown", handlePossibleUserIntent, true);
  window.addEventListener(SETTINGS_EVENT, (event) => {
    if (typeof event.detail?.autoUnmute === "boolean") {
      autoUnmute = event.detail.autoUnmute;
      pushLog(`AUTO ${autoUnmute ? "ON" : "OFF"} from popup`);
    }
  });

  if (document.documentElement) {
    observeDocument();
    if (!panelHidden) {
      renderPanel();
    }
  } else {
    document.addEventListener("DOMContentLoaded", () => {
      observeDocument();
      if (!panelHidden) {
        renderPanel();
      }
    }, { once: true });
  }

  window.__ytMuteAutoWatcher = {
    version: VERSION,
    status() {
      return {
        autoUnmute,
        "muted setter watching": true,
        userIntentWindowMs: USER_INTENT_WINDOW_MS,
        lastUserIntentAgoMs: lastUserIntentAt ? now() - lastUserIntentAt : null,
        currentVideos: getVideos().map((video) => ({
          muted: video.muted,
          defaultMuted: video.defaultMuted,
          volume: video.volume,
          hasMutedAttribute: video.hasAttribute("muted"),
          userMuted: userMutedVideos.has(video),
          lastAudibleVolume: lastAudibleVolumes.get(video) || null
        })),
        logs: logs.slice()
      };
    },
    setAutoUnmute(value) {
      autoUnmute = Boolean(value);
      pushLog(`AUTO ${autoUnmute ? "ON" : "OFF"}`);
      return this.status();
    },
    showPanel() {
      panelHidden = false;
      renderPanel();
    },
    clearLogs() {
      logs.length = 0;
      if (!panelHidden) {
        renderPanel();
      }
    },
    hidePanel() {
      panelHidden = true;
      const panel = document.getElementById(PANEL_ID);
      if (panel) {
        panel.hidden = true;
      }
    },
    restoreAll() {
      getVideos().forEach((video) => restoreVideoIfBlocked(video, "manual restoreAll"));
      return this.status();
    }
  };

  pushLog("READY");
})();
