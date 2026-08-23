import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // onnxruntime-web resolves its own .wasm runtime files relative to
    // import.meta.url at request time; Vite's dev-server dependency
    // pre-bundler doesn't understand that and serves the SPA fallback
    // index.html for the .wasm request instead (wrong MIME type, breaks
    // WebAssembly.instantiate). Excluding it from pre-bundling lets the
    // browser load it directly from node_modules via native ESM, matching
    // how the production build (which bundles it as a real asset) works.
    exclude: ["onnxruntime-web"],
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
  },
});
