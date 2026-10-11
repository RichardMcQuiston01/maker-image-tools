// @vitest-environment node
// (esbuild refuses to run under jsdom, whose TextEncoder is not the real one.)
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";

const packageRoot = process.cwd();
const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
  exports: Record<string, string>;
};

/** Packages that are heavy to ship: the point of the subpath exports is to keep each in its own entry. */
const HEAVY = ["onnxruntime-web", "@tensorflow/tfjs", "upscaler", "@upscalerjs/esrgan-slim"];

/** Which heavy packages an entry point imports once it is bundled (dependencies left external). */
async function heavyImports(entry: string): Promise<string[]> {
  const result = await build({
    entryPoints: [join(packageRoot, entry)],
    bundle: true,
    write: false,
    metafile: true,
    format: "esm",
    platform: "browser",
    logLevel: "silent",
    external: [...HEAVY, ...HEAVY.map((name) => `${name}/*`), "@richardmcquiston01/ai-providers"],
  });
  const found = new Set<string>();
  for (const output of Object.values(result.metafile.outputs)) {
    for (const imported of output.imports) {
      if (!imported.external) continue;
      const name = HEAVY.find(
        (heavy) => imported.path === heavy || imported.path.startsWith(`${heavy}/`),
      );
      if (name) found.add(name);
    }
  }
  return [...found].sort();
}

describe("package exports", () => {
  it("point at files that exist", () => {
    for (const [subpath, target] of Object.entries(manifest.exports)) {
      if (subpath.endsWith("/*")) {
        expect(existsSync(join(packageRoot, target.replace("*", "u2netp.onnx"))), subpath).toBe(
          true,
        );
      } else {
        expect(existsSync(join(packageRoot, target)), `${subpath} -> ${target}`).toBe(true);
      }
    }
  });

  it("export the background-removal model file", () => {
    expect(manifest.exports["./models/*"]).toBe("./models/*");
  });
});

describe("entry points keep their heavy dependencies apart", () => {
  it("auto-crop needs none", async () => {
    expect(await heavyImports("src/auto-crop.ts")).toEqual([]);
  });

  it("background-removal needs only ONNX Runtime", async () => {
    expect(await heavyImports("src/background-removal.ts")).toEqual(["onnxruntime-web"]);
  });

  it("upscale needs only TensorFlow.js and the upscaler", async () => {
    expect(await heavyImports("src/upscale.ts")).toEqual([
      "@tensorflow/tfjs",
      "@upscalerjs/esrgan-slim",
      "upscaler",
    ]);
  });

  it("the main entry still brings everything", async () => {
    expect(await heavyImports("src/index.ts")).toEqual([
      "@tensorflow/tfjs",
      "@upscalerjs/esrgan-slim",
      "onnxruntime-web",
      "upscaler",
    ]);
  });
});
