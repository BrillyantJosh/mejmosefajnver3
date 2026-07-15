import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";
import fs from "fs";

// VERSION: 2.4 - reliable auto-update (version.json self-heal + foreground check)
const APP_VERSION = '2.4.1';
// Unique per build — baked into the client AND written to dist/version.json (NOT
// service-worker-cached), so a stale client can detect a new deploy and hard-refresh.
const BUILD_ID = String(Date.now());

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(APP_VERSION),
    'import.meta.env.VITE_BUILD_ID': JSON.stringify(BUILD_ID),
  },
  build: {
    rollupOptions: {
      output: {
        entryFileNames: `assets/[name]-[hash]-${BUILD_ID}.js`,
        chunkFileNames: `assets/[name]-[hash]-${BUILD_ID}.js`,
        assetFileNames: `assets/[name]-[hash]-${BUILD_ID}.[ext]`,
        // Only split React-independent heavy libs into their own chunks.
        // We deliberately do NOT manually split React / @radix-ui / lucide etc.:
        // forcing @radix-ui into a separate chunk from React broke the module
        // evaluation order ("Cannot read properties of undefined (reading
        // 'forwardRef')") on desktop. Let rollup auto-chunk everything React-coupled
        // so its load order stays correct; routes are still split via React.lazy.
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("nostr-tools") || id.includes("@noble") || id.includes("@scure") || id.includes("elliptic")) return "nostr";
          if (id.includes("recharts") || id.includes("d3-")) return "charts";
          return undefined;
        },
      },
    },
  },
  server: {
    host: "::",
    port: 8080,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.png", "icon-192.png", "icon-512.png", "custom-sw.js"],
      manifest: false, // Using external manifest.json
      injectRegister: 'auto',
      workbox: {
        // Force immediate takeover of new service worker
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        // Don't intercept navigation requests to /api/ paths (images, storage, etc.)
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//],
        // Only precache essential files, not large module images
        globPatterns: ["**/*.{js,css,html,ico,svg,woff2}"],
        // Exclude large images from precaching
        globIgnores: ["**/assets/*-module*.png", "**/assets/*-hero*.png", "**/assets/*-bg*.png", "**/assets/*-icon*.png"],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5MB limit
        // Import custom service worker for push notifications
        importScripts: ['/custom-sw.js'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\/storage\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "supabase-storage-cache",
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24 * 7, // 7 days
              },
            },
          },
          {
            // Cache large images at runtime instead of precaching
            urlPattern: /\.(?:png|jpg|jpeg|gif|webp)$/i,
            handler: "CacheFirst",
            options: {
              cacheName: "image-cache",
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
              },
            },
          },
        ],
      },
    }),
    {
      // Emit dist/version.json (NOT precached by the SW → always fetched fresh).
      // The client compares its baked-in BUILD_ID against this to detect a new deploy.
      name: "emit-version-json",
      writeBundle() {
        try {
          fs.writeFileSync(
            path.resolve(__dirname, "dist/version.json"),
            JSON.stringify({ version: APP_VERSION, build: BUILD_ID })
          );
        } catch (e) {
          console.warn("emit-version-json failed:", e);
        }
      },
    },
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
