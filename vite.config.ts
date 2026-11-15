/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// @ts-expect-error type error without @types/node package
import process from "node:process";
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react()],

  // "@/" is src, for imports across features; "/src" is read from the project's root on every system
  resolve: {
    alias: { "@": "/src" },
  },

  // Four pages, each a window of its own: the app, the quick chat bar, the area selection for a screen capture and the
  // marks Nyra draws over the screen
  build: {
    rollupOptions: {
      input: { main: "index.html", quick: "quick.html", capture: "capture.html", marks: "marks.html" },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },

  // The tests check the interface's texts in Spanish, whatever the computer running them is set to
  test: {
    setupFiles: ["./src/shared/i18n/testSetup.ts"],
  },
}));
