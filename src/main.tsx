import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App.tsx";
import "./index.css";

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
  },
  onRegisterError(error) {
    console.error("[PWA] Service worker registration error:", error);
  },
});

createRoot(document.getElementById("root")!).render(<App />);
