const fs = require("fs");
const path = require("path");
const vm = require("vm");

const observers = [];

class EventTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatchEvent(event) {
    event.target ||= this;
    const listeners = this.listeners.get(event.type) || [];
    for (const listener of listeners) {
      listener.call(this, event);
    }
  }
}

class Element extends EventTarget {
  constructor(tagName = "div") {
    super();
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.dataset = {};
    this.style = {};
    this.className = "";
    this.classList = {
      contains: (className) => this.className.split(/\s+/).includes(className)
    };
    this.textContent = "";
    this.hidden = false;
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    notifyChildAdded(child);
    return child;
  }

  setAttribute(name, value) {
    this.attributes.set(String(name), String(value));
    notifyAttribute(this, String(name));
  }

  getAttribute(name) {
    return this.attributes.get(String(name)) || "";
  }

  removeAttribute(name) {
    this.attributes.delete(String(name));
    notifyAttribute(this, String(name));
  }

  toggleAttribute(name, force) {
    const shouldSet = force === undefined ? !this.hasAttribute(name) : Boolean(force);
    if (shouldSet) {
      this.setAttribute(name, "");
    } else {
      this.removeAttribute(name);
    }
    return shouldSet;
  }

  hasAttribute(name) {
    return this.attributes.has(String(name));
  }

  querySelectorAll(selector) {
    const matches = [];
    const dataMatch = selector.match(/^\[data-([a-z-]+)='([^']+)'\]$/);
    const walk = (node) => {
      for (const child of node.children || []) {
        if (selector === "video" && child instanceof HTMLVideoElement) {
          matches.push(child);
        }
        if (selector.startsWith(".") && child.className.split(/\s+/).includes(selector.slice(1))) {
          matches.push(child);
        }
        if (dataMatch) {
          const [, key, value] = dataMatch;
          const dataKey = key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
          if (child.dataset[dataKey] === value) {
            matches.push(child);
          }
        }
        walk(child);
      }
    };
    walk(this);
    return matches;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  closest(selector) {
    const selectors = selector.split(",").map((value) => value.trim());
    let node = this;
    while (node) {
      if (selectors.some((candidate) => {
        if (candidate.startsWith(".")) {
          return node.className.split(/\s+/).includes(candidate.slice(1));
        }

        return node.tagName.toLowerCase() === candidate.toLowerCase();
      })) {
        return node;
      }
      node = node.parentNode;
    }
    return null;
  }
}

class HTMLMediaElement extends Element {
  constructor(tagName = "video") {
    super(tagName);
    this._muted = false;
    this._defaultMuted = false;
    this._volume = 1;
  }

  get muted() {
    return this._muted;
  }

  set muted(value) {
    this._muted = Boolean(value);
  }

  get defaultMuted() {
    return this._defaultMuted;
  }

  set defaultMuted(value) {
    this._defaultMuted = Boolean(value);
  }

  get volume() {
    return this._volume;
  }

  set volume(value) {
    this._volume = Number(value);
  }
}

class HTMLVideoElement extends HTMLMediaElement {}

class Document extends EventTarget {
  constructor() {
    super();
    this.documentElement = new Element("html");
  }

  createElement(tagName) {
    if (tagName === "video") {
      return new HTMLVideoElement();
    }
    return new Element(tagName);
  }

  querySelectorAll(selector) {
    return this.documentElement.querySelectorAll(selector);
  }

  getElementById(id) {
    return findById(this.documentElement, id);
  }
}

class MutationObserver {
  constructor(callback) {
    this.callback = callback;
  }

  observe(target, options) {
    observers.push({ target, options, callback: this.callback });
  }
}

class CustomEvent {
  constructor(type, options = {}) {
    this.type = type;
    this.detail = options.detail;
  }
}

function findById(node, id) {
  if (node.id === id) {
    return node;
  }
  for (const child of node.children || []) {
    const found = findById(child, id);
    if (found) {
      return found;
    }
  }
  return null;
}

function isDescendant(target, node) {
  let current = node;
  while (current) {
    if (current === target) {
      return true;
    }
    current = current.parentNode;
  }
  return false;
}

function notifyChildAdded(node) {
  for (const observer of observers) {
    if (observer.options.childList && observer.options.subtree && isDescendant(observer.target, node.parentNode)) {
      observer.callback([{ addedNodes: [node] }]);
    }
  }
}

function notifyAttribute(target, attributeName) {
  for (const observer of observers) {
    if (observer.target === target && observer.options.attributes) {
      observer.callback([{ attributeName }]);
    }
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const document = new Document();
const window = new EventTarget();
window.Date = Date;
window.setTimeout = setTimeout;
window.clearTimeout = clearTimeout;
window.HTMLMediaElement = HTMLMediaElement;
window.HTMLVideoElement = HTMLVideoElement;
window.Element = Element;
window.MutationObserver = MutationObserver;
window.CustomEvent = CustomEvent;

const sandbox = {
  window,
  document,
  Date,
  setTimeout,
  clearTimeout,
  HTMLMediaElement,
  HTMLVideoElement,
  Element,
  MutationObserver,
  CustomEvent
};
sandbox.globalThis = sandbox.window;

vm.createContext(sandbox);
vm.runInContext(
  fs.readFileSync(path.join(__dirname, "yt-mute-auto-watch.js"), "utf8"),
  sandbox,
  { filename: "yt-mute-auto-watch.js" }
);

const video = document.createElement("video");
video.className = "html5-main-video";
document.documentElement.appendChild(video);

video.volume = 0.6;
video.volume = 0;
assert(video.volume === 0.6, "automatic volume=0 should restore the previous audible volume");

video.muted = true;
assert(video.muted === false, "automatic muted=true should be blocked");

video.defaultMuted = true;
assert(video.defaultMuted === false, "automatic defaultMuted=true should be blocked");

video.setAttribute("muted", "");
assert(!video.hasAttribute("muted"), "automatic setAttribute muted should be blocked");

video.toggleAttribute("muted", true);
assert(!video.hasAttribute("muted"), "automatic toggleAttribute muted should be blocked");

Element.prototype.setAttribute.call(video, "muted", "");
assert(!video.hasAttribute("muted"), "MutationObserver should remove delayed muted attribute");

document.dispatchEvent({
  type: "keydown",
  code: "KeyM",
  ctrlKey: false,
  altKey: false,
  metaKey: false
});
video.volume = 0;
assert(video.volume === 0, "m key user intent should allow volume=0");

video.volume = 0.7;
video.volume = 0;
assert(video.volume === 0.7, "after volume is raised again, automatic volume=0 should be blocked");

const muteButton = new Element("button");
muteButton.className = "ytp-mute-button";
document.documentElement.appendChild(muteButton);
document.dispatchEvent({ type: "click", target: muteButton });
video.setAttribute("muted", "");
assert(video.hasAttribute("muted"), "YouTube mute button user intent should allow muted attribute");

const previewVideo = document.createElement("video");
document.documentElement.appendChild(previewVideo);
previewVideo.muted = true;
assert(previewVideo.muted === true, "thumbnail preview videos should not be blocked by main playback mute guard");
previewVideo.muted = false;
assert(previewVideo.muted === true, "thumbnail preview videos should stay muted when YouTube tries to unmute them");
previewVideo.volume = 1;
assert(previewVideo.volume === 1, "thumbnail preview mute should not block preview playback volume setup");
window.dispatchEvent(new CustomEvent("yt-mute-auto-watch-settings", {
  detail: {
    previewMute: false
  }
}));
previewVideo.muted = false;
previewVideo.volume = 1;
assert(previewVideo.muted === false, "preview mute toggle off should allow preview videos to unmute");
assert(previewVideo.volume === 1, "preview mute toggle off should allow preview videos to raise volume");

video.removeAttribute("muted");
video.volume = 0.8;
const thumbnailMuteButton = new Element("button");
thumbnailMuteButton.setAttribute("aria-label", "preview mute");
document.documentElement.appendChild(thumbnailMuteButton);
document.dispatchEvent({ type: "pointerdown", target: thumbnailMuteButton });
video.muted = true;
assert(video.muted === true, "thumbnail preview mute button should be treated as user mute intent");

const status = window.__ytMuteAutoWatcher.status();
assert(status.autoUnmute === true, "status should report autoUnmute enabled");
assert(status["muted setter watching"] === true, "status should report muted setter watching");

console.log("auto-unmute test passed");
