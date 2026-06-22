import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App.tsx";
import "./index.css";

// Guard against the "NotFoundError: Failed to execute 'removeChild' on 'Node'"
// crash that hits users with the browser's auto-translation on (Google Translate
// wraps/moves text nodes, then React's reconciler removes/inserts a node that is
// no longer where it expects). Make removeChild/insertBefore no-throw when the
// node has already been detached/moved — React then re-syncs harmlessly instead
// of white-screening. Battle-tested fix used by many React apps.
if (typeof Node === "function" && Node.prototype) {
  const originalRemoveChild = Node.prototype.removeChild;
  Node.prototype.removeChild = function <T extends Node>(this: Node, child: T): T {
    if (child.parentNode !== this) {
      if (typeof console !== "undefined") console.warn("removeChild: node is not a child of this node", child, this);
      return child;
    }
    // eslint-disable-next-line prefer-rest-params
    return originalRemoveChild.apply(this, arguments as never) as T;
  };
  const originalInsertBefore = Node.prototype.insertBefore;
  Node.prototype.insertBefore = function <T extends Node>(this: Node, newNode: T, referenceNode: Node | null): T {
    if (referenceNode && referenceNode.parentNode !== this) {
      if (typeof console !== "undefined") console.warn("insertBefore: reference node is not a child of this node", referenceNode, this);
      return newNode;
    }
    // eslint-disable-next-line prefer-rest-params
    return originalInsertBefore.apply(this, arguments as never) as T;
  };
}

// Register service worker with automatic update
const updateSW = registerSW({
  onNeedRefresh() {
    // When new version is available, immediately update
    console.log("[PWA] New version available, updating...");
    updateSW(true);
  },
  onOfflineReady() {
    console.log("[PWA] App ready to work offline");
  },
  onRegistered(registration) {
    console.log("[PWA] Service worker registered:", registration);
    // Periodically check for SW updates (every 60 seconds)
    // This ensures users get new deploys without manual hard refresh
    if (registration) {
      setInterval(() => {
        registration.update();
      }, 60 * 1000);
    }
  },
  onRegisterError(error) {
    console.error("[PWA] Service worker registration error:", error);
  },
});

// Recover from stale lazy chunks after a deploy: when a code-split chunk fails to
// load (its hashed filename no longer exists on the server), Vite fires
// `vite:preloadError`. Reload once to fetch the fresh build instead of showing a
// blank page. A sessionStorage guard prevents reload loops if it's a real outage.
window.addEventListener("vite:preloadError", (event) => {
  event.preventDefault();
  if (!sessionStorage.getItem("chunk-reload")) {
    sessionStorage.setItem("chunk-reload", String(Date.now()));
    window.location.reload();
  }
});
// Clear the guard once the app has loaded successfully.
window.addEventListener("load", () => {
  setTimeout(() => sessionStorage.removeItem("chunk-reload"), 5000);
});

createRoot(document.getElementById("root")!).render(<App />);
