import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

const monacoFindController = path.resolve(__dirname, "../../node_modules/monaco-editor/esm/vs/editor/contrib/find/browser/findController.js");

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "monaco-editor/esm/vs/editor/contrib/find/browser/findController": monacoFindController } },
  server: {
    port: 5180,
    strictPort: true,
  },
  clearScreen: false,
  build: {
    rollupOptions: {
      output: {
        manualChunks: { monaco: ["monaco-editor", "@monaco-editor/react"] },
      },
    },
  },
});
