import { createRequire } from "node:module";
import { dirname } from "node:path";
import type { Plugin as EsbuildPlugin } from "esbuild";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const require = createRequire(import.meta.url);

/**
 * @richardmcquiston01/house-number-generator@0.1.0's built output does
 * `import opentype from "opentype.js"` (a default import), but opentype.js
 * 2.x's ESM build (its package.json "module" entry, which both Rollup and
 * esbuild prefer) only has named exports - no default - so that import
 * fails to bind, in both the production (Rollup) build and the dev
 * server's esbuild dependency pre-bundling. Force just this one nested
 * import to resolve against opentype.js's CJS/UMD build instead, where the
 * default export is synthesized as usual. Scoped to this specific importer
 * so it doesn't affect apps/web's own (unrelated, v1.x) opentype.js usage.
 * Drop this once a house-number-generator release fixes the import
 * upstream (github.com/RichardMcQuiston01/makertool-house-number-generator).
 */
function resolveOpentypeCjsBuild(importer: string): string {
  return require.resolve("opentype.js/dist/opentype.js", { paths: [dirname(importer)] });
}

function houseNumberGeneratorOpentypeCjsWorkaroundRollupPlugin(): Plugin {
  return {
    name: "house-number-generator-opentype-cjs-workaround",
    enforce: "pre",
    async resolveId(source, importer) {
      if (source === "opentype.js" && importer?.includes("house-number-generator")) {
        return this.resolve(resolveOpentypeCjsBuild(importer), importer, { skipSelf: true });
      }
      return null;
    },
  };
}

function houseNumberGeneratorOpentypeCjsWorkaroundEsbuildPlugin(): EsbuildPlugin {
  return {
    name: "house-number-generator-opentype-cjs-workaround",
    setup(build) {
      build.onResolve({ filter: /^opentype\.js$/ }, (args) => {
        if (!args.importer.includes("house-number-generator")) return undefined;
        return { path: resolveOpentypeCjsBuild(args.importer) };
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), houseNumberGeneratorOpentypeCjsWorkaroundRollupPlugin()],
  optimizeDeps: {
    // onnxruntime-web resolves its own .wasm runtime files relative to
    // import.meta.url at request time; Vite's dev-server dependency
    // pre-bundler doesn't understand that and serves the SPA fallback
    // index.html for the .wasm request instead (wrong MIME type, breaks
    // WebAssembly.instantiate). Excluding it from pre-bundling lets the
    // browser load it directly from node_modules via native ESM, matching
    // how the production build (which bundles it as a real asset) works.
    exclude: ["onnxruntime-web"],
    esbuildOptions: {
      plugins: [houseNumberGeneratorOpentypeCjsWorkaroundEsbuildPlugin()],
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
  },
});
