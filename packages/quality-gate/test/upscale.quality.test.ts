import { existsSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resize } from "@maker/core-image";
import { loadUpscaleModel } from "@maker/ai-tools";
import { createDetailFixture, sharpness } from "../src/index.js";

/**
 * Same "spin up a local static file server over the vendored esrgan-slim
 * model" trick packages/ai-tools's own upscale test uses, since the
 * `upscaler` library only knows how to fetch its model over HTTP.
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

// Calibrated against this repo's own vendored model: it consistently scores
// 19x-38x the naive baseline's sharpness across several ring periods, so a
// 2x margin catches a real regression (e.g. the model silently falling back
// to passing the input through unchanged) without being flaky about
// run-to-run variation.
const MIN_SHARPNESS_RATIO_OVER_NAIVE = 2;

describe("upscale quality gate", () => {
  it("adds meaningfully more high-frequency detail than naive bilinear upsampling", async () => {
    const groundTruth = createDetailFixture(64, 64);
    const downsampled = resize(groundTruth, { width: 32, height: 32, method: "bilinear" });
    const naiveUpsampled = resize(downsampled, { width: 64, height: 64, method: "bilinear" });

    const model = await loadUpscaleModel(2, { modelUrl: `${baseUrl}/x2/model.json` });
    const modelUpsampled = await model.upscale(downsampled);

    expect(modelUpsampled.width).toBe(64);
    expect(modelUpsampled.height).toBe(64);

    const naiveSharpness = sharpness(naiveUpsampled);
    const modelSharpness = sharpness(modelUpsampled);

    expect(modelSharpness).toBeGreaterThanOrEqual(naiveSharpness * MIN_SHARPNESS_RATIO_OVER_NAIVE);
  });
});
