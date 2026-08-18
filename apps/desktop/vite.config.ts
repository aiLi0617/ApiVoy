import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

const monacoFindController = path.resolve(__dirname, "../../node_modules/monaco-editor/esm/vs/editor/contrib/find/browser/findController.js");

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "monaco-editor/esm/vs/editor/contrib/find/browser/findController": monacoFindController } },
  clearScreen: false,
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
      ignored: ["**/src-tauri/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: !process.env.TAURI_ENV_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    rollupOptions: {
      output: {
        manualChunks: {
          monaco: ["monaco-editor", "@monaco-editor/react"],
        },
      },
    },
  },
});
