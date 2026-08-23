import { existsSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadUpscaleModel } from "../src/upscale.js";

/**
 * The `upscaler` package's browser build only knows how to fetch its model
 * over HTTP (falling back to jsdelivr/unpkg CDN mirrors if no explicit
 * `modelUrl` is given) — it has no filesystem-reading code path. To test the
 * real browser-facing code against the real, already-vendored model weights
 * with no network access, this spins up a throwaway local static file server
 * over the installed `@upscalerjs/esrgan-slim` package's `models/` directory
 * and points `loadUpscaleModel` at it via `modelUrl`.
 */
const MODELS_ROOT = join(process.cwd(), "node_modules", "@upscalerjs", "esrgan-slim", "models");

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const filePath = join(MODELS_ROOT, decodeURIComponent(url.pathname));
    if (!existsSync(filePath)) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200).end(readFileSync(filePath));
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Failed to determine test server port");
  }
  baseUrl = `http://localhost:${address.port}`;
});

afterAll(() => {
  server.close();
});

function buildTestImage(width: number, height: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data[i] = (x * 255) / width;
      data[i + 1] = (y * 255) / height;
      data[i + 2] = 128;
      data[i + 3] = x < width / 2 ? 255 : 128;
    }
  }
  return new ImageData(data, width, height);
}

describe("loadUpscaleModel", () => {
  it("runs real 2x inference against the vendored esrgan-slim model", async () => {
    const model = await loadUpscaleModel(2, { modelUrl: `${baseUrl}/x2/model.json` });
    expect(model.scaleFactor).toBe(2);

    const input = buildTestImage(20, 16);
    const output = await model.upscale(input);

    expect(output.width).toBe(40);
    expect(output.height).toBe(32);
    expect(output.data.length).toBe(40 * 32 * 4);

    for (let i = 0; i < output.data.length; i += 4) {
      for (let channel = 0; channel < 4; channel++) {
        const value = output.data[i + channel]!;
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(255);
      }
    }

    // The right half of the source image had lower alpha than the left half —
    // that contrast should survive (roughly) into the upsampled alpha channel.
    const leftAlpha = output.data[3]!;
    const rightAlpha = output.data[(40 * 16 + 39) * 4 + 3]!;
    expect(leftAlpha).toBeGreaterThan(rightAlpha);
  });

  it("runs real 4x inference against the vendored esrgan-slim model", async () => {
    const model = await loadUpscaleModel(4, { modelUrl: `${baseUrl}/x4/model.json` });
    expect(model.scaleFactor).toBe(4);

    const input = buildTestImage(12, 10);
    const output = await model.upscale(input);

    expect(output.width).toBe(48);
    expect(output.height).toBe(40);
  });
});
