import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;
// @ts-expect-error process is a nodejs global
const isTauriDev = !!process.env.TAURI_DEV_HOST || !!process.env.TAURI_ENV_TARGET_TRIPLE;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: {
          epub: ["epubjs"],
          vendor: ["react", "react-dom", "framer-motion", "zustand"],
          ui: ["react-resizable-panels", "lucide-react"],
        },
      },
    },
  },

  // Tauri-specific dev server options — only applied when running under Tauri.
  // Web/PWA dev uses the CLI flags from the web:dev script instead.
  ...(isTauriDev
    ? {
        clearScreen: false,
        server: {
          port: 1420,
          strictPort: true,
          host: host || false,
          hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
          watch: { ignored: ["**/src-tauri/**"] },
        },
      }
    : {
        // Web/PWA mode: allow any port and bind to all interfaces by default
        // (overridden by CLI flags in the web:dev npm script)
        server: {
          watch: { ignored: ["**/src-tauri/**"] },
        },
      }),
}));
