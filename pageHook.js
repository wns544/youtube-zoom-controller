(() => {
  const currentScript = document.currentScript;
  const shortcutEvent = currentScript?.dataset.shortcutEvent || "yt-fullscreen-zoom-shortcut";
  const handledKeys = new Set([
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "Backspace",
    "Delete",
    "ZoomIn",
    "ZoomOut"
  ]);

  const isEditableTarget = (target) => {
    if (!target) {
      return false;
    }

    const tagName = target.tagName ? target.tagName.toLowerCase() : "";
    return target.isContentEditable || tagName === "input" || tagName === "textarea";
  };

  const isFullscreenPlayerActive = () => {
    const player = document.getElementById("movie_player");
    return Boolean(document.fullscreenElement) && Boolean(player && player.classList.contains("ytp-fullscreen"));
  };

  const isPlayerActive = () => {
    const player = document.getElementById("movie_player");
    const video = player ? player.querySelector("video.html5-main-video") : null;
    return Boolean(player && video);
  };

  const relay = (event) => {
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

    const action = isZoomInShortcut
      ? "ZoomIn"
      : isZoomOutShortcut
        ? "ZoomOut"
        : event.key;

    if (!handledKeys.has(action) || isEditableTarget(event.target)) {
      return;
    }

    if ((isMoveShortcut || isResetShortcut || isZoomInShortcut || isZoomOutShortcut) && !isPlayerActive()) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    window.dispatchEvent(new CustomEvent(shortcutEvent, {
      detail: {
        key: event.key,
        action,
        type: event.type
      }
    }));
  };

  window.addEventListener("keydown", relay, true);
  window.addEventListener("keyup", relay, true);
  document.addEventListener("keydown", relay, true);
  document.addEventListener("keyup", relay, true);
})();
