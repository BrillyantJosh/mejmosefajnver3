import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

// VERSION: 2.3 - Fix service worker navigation fallback for /api/ paths
const APP_VERSION = '2.3.0';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(APP_VERSION),
  },
  build: {
    rollupOptions: {
      output: {
        entryFileNames: `assets/[name]-[hash]-${Date.now()}.js`,
        chunkFileNames: `assets/[name]-[hash]-${Date.now()}.js`,
        assetFileNames: `assets/[name]-[hash]-${Date.now()}.[ext]`,
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
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
