const fs = require("fs");
const path = require("path");
const vm = require("vm");

class EventTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    this.listeners.set(type, listeners.filter((candidate) => candidate !== listener));
  }

  dispatchEvent(event) {
    event.target ||= this;
    for (const listener of this.listeners.get(event.type) || []) {
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
    this.textContent = "";
    this.id = "";
    this.href = "";
    this.type = "";
    this.title = "";
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  remove() {
    if (!this.parentNode) {
      return;
    }

    this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    this.parentNode = null;
  }

  setAttribute(name, value) {
    this.attributes.set(String(name), String(value));
    if (name === "id") {
      this.id = String(value);
    }
  }

  getAttribute(name) {
    return this.attributes.get(String(name)) || "";
  }

  removeAttribute(name) {
    this.attributes.delete(String(name));
  }

  hasAttribute(name) {
    return this.attributes.has(String(name));
  }

  matches(selector) {
    if (selector === "video" && this.tagName === "VIDEO") {
      return true;
    }

    if (selector.startsWith(".")) {
      return this.className.split(/\s+/).includes(selector.slice(1));
    }

    if (selector === "#thumbnail") {
      return this.id === "thumbnail";
    }

    if (/^[a-z0-9-]+$/i.test(selector)) {
      return this.tagName.toLowerCase() === selector.toLowerCase();
    }

    return false;
  }

  closest(selector) {
    const selectors = selector.split(",").map((value) => value.trim());
    let node = this;
    while (node) {
      if (selectors.some((candidate) => node.matches(candidate))) {
        return node;
      }
      node = node.parentNode;
    }
    return null;
  }

  querySelectorAll(selector) {
    const matches = [];
    const selectors = selector.split(",").map((value) => value.trim());

    const isMatch = (node, candidate) => {
      if (candidate.includes(`.${NEXT_QUEUE_BUTTON_CLASS}`)) {
        return node.className.split(/\s+/).includes(NEXT_QUEUE_BUTTON_CLASS);
      }

      if (candidate.includes("a#thumbnail") || candidate.includes("a.yt-simple-endpoint") || candidate.includes("ytd-thumbnail a")) {
        return node.tagName === "A" && node.href.includes("/watch");
      }

      if (candidate === "video" || candidate === "video.html5-main-video") {
        return node.tagName === "VIDEO";
      }

      if (candidate === "button") {
        return node.tagName === "BUTTON";
      }

      return false;
    };

    const walk = (node) => {
      for (const child of node.children || []) {
        if (selectors.some((candidate) => isMatch(child, candidate))) {
          matches.push(child);
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
}

class HTMLVideoElement extends Element {
  constructor() {
    super("video");
    this.paused = false;
  }

  play() {
    this.paused = false;
    return Promise.resolve();
  }
}

class Document extends EventTarget {
  constructor() {
    super();
    this.documentElement = new Element("html");
    this.head = new Element("head");
    this.body = new Element("body");
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
  }

  createElement(tagName) {
    if (tagName === "video") {
      return new HTMLVideoElement();
    }
    return new Element(tagName);
  }

  getElementById(id) {
    const all = [];
    const walk = (node) => {
      all.push(node);
      for (const child of node.children || []) {
        walk(child);
      }
    };
    walk(this.documentElement);
    return all.find((node) => node.id === id) || null;
  }

  querySelectorAll(selector) {
    return this.documentElement.querySelectorAll(selector);
  }

  querySelector(selector) {
    return this.documentElement.querySelector(selector);
  }
}

class MutationObserver {
  constructor() {}
  observe() {}
}

class CustomEvent {
  constructor(type, options = {}) {
    this.type = type;
    this.detail = options.detail;
  }
}

class MouseEvent {
  constructor(type, options = {}) {
    this.type = type;
    Object.assign(this, options);
  }
}

const NEXT_QUEUE_BUTTON_CLASS = "yt-next-play-queue-button";
const localStorageData = {};
const syncStorageData = {
  fullscreenZoomSettings: {
    nextQueueEnabled: true
  }
};
let assignedUrl = "";

const document = new Document();
const location = {
  href: "https://www.youtube.com/watch?v=current123",
  origin: "https://www.youtube.com",
  assign(url) {
    assignedUrl = url;
    this.href = url;
  }
};

const window = new EventTarget();
Object.assign(window, {
  document,
  location,
  getComputedStyle: () => ({ position: "static" }),
  setTimeout,
  clearTimeout,
  setInterval: () => 0,
  CustomEvent,
  MouseEvent,
  PointerEvent: MouseEvent
});

const chrome = {
  runtime: {
    getURL: (file) => file
  },
  storage: {
    sync: {
      get: async (key) => ({ [key]: syncStorageData[key] }),
      set: async (values) => Object.assign(syncStorageData, values)
    },
    local: {
      get: async (key) => ({ [key]: localStorageData[key] }),
      set: async (values) => Object.assign(localStorageData, values)
    },
    onChanged: {
      addListener() {}
    }
  }
};

const sandbox = {
  window,
  document,
  location,
  chrome,
  MutationObserver,
  CustomEvent,
  MouseEvent,
  PointerEvent: MouseEvent,
  URL,
  Date,
  setTimeout,
  clearTimeout,
  setInterval: () => 0
};
sandbox.globalThis = sandbox;

vm.createContext(sandbox);
vm.runInContext(
  fs.readFileSync(path.join(__dirname, "content.js"), "utf8"),
  sandbox,
  { filename: "content.js" }
);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

(async () => {
  assert(
    sandbox.normalizeWatchUrl("https://www.youtube.com/watch?v=next123&list=abc") === "https://www.youtube.com/watch?v=next123",
    "watch URLs should be normalized to a direct watch URL"
  );

  const host = document.createElement("div");
  host.id = "thumbnail";
  const anchor = document.createElement("a");
  anchor.href = "https://www.youtube.com/watch?v=next123&list=abc";
  anchor.textContent = "Queued video";
  host.appendChild(anchor);
  document.body.appendChild(host);

  sandbox.mountNextQueueButtons({ nextQueueEnabled: true });
  const mountedButton = host.querySelector(`.${NEXT_QUEUE_BUTTON_CLASS}`);
  assert(mountedButton?.textContent === "큐+", "enabled next queue should mount an extension queue button on video thumbnails");

  const nativePlaylistHost = document.createElement("ytd-playlist-panel-video-renderer");
  const nativePlaylistAnchor = document.createElement("a");
  nativePlaylistAnchor.href = "https://www.youtube.com/watch?v=native123";
  nativePlaylistHost.appendChild(nativePlaylistAnchor);
  document.body.appendChild(nativePlaylistHost);
  sandbox.mountNextQueueButtons({ nextQueueEnabled: true });
  assert(
    !nativePlaylistHost.querySelector(`.${NEXT_QUEUE_BUTTON_CLASS}`),
    "extension queue button should not mount inside YouTube's native playlist panel"
  );

  await sandbox.addVideoToNextQueue(anchor);
  assert(localStorageData.ytNextPlayQueue.length === 1, "adding a video should persist one queued item");
  assert(localStorageData.ytNextPlayQueue[0].id === "next123", "queued item should keep the target video id");

  await sandbox.playNextQueuedVideo();
  assert(assignedUrl === "https://www.youtube.com/watch?v=next123", "playing the queue should navigate to the first queued video");
  assert(localStorageData.ytNextPlayQueue.length === 0, "playing the queue should remove the consumed item");

  await sandbox.writeNextQueue([{ id: "disabled", url: "https://www.youtube.com/watch?v=disabled" }]);
  syncStorageData.fullscreenZoomSettings.nextQueueEnabled = false;
  assignedUrl = "";
  sandbox.handleVideoEndedForNextQueue();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert(assignedUrl === "", "disabled next queue should not navigate on video end");

  console.log("next-queue test passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
