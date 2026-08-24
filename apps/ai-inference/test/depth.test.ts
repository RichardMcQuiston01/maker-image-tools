import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadDepthModel } from "../src/depth.js";

const MODEL_PATH = join(process.cwd(), "models", "midas-v21-small.onnx");

function makeGradientImage(width: number, height: number) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const value = Math.round((x / (width - 1)) * 255);
      data[i] = value;
      data[i + 1] = value;
      data[i + 2] = value;
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

describe("loadDepthModel", () => {
  it("runs real inference against the vendored MiDaS small model and returns a valid depth map", async () => {
    const model = await loadDepthModel(MODEL_PATH);
    const image = makeGradientImage(64, 48);
    const depth = await model.estimateDepth(image);

    expect(depth.width).toBe(64);
    expect(depth.height).toBe(48);
    expect(depth.values.length).toBe(64 * 48);

    let min = Infinity;
    let max = -Infinity;
    const distinct = new Set<number>();
    for (const v of depth.values) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      if (v < min) min = v;
      if (v > max) max = v;
      distinct.add(Math.round(v * 100));
    }
    // Real inference on a non-uniform input should produce more than one
    // distinct depth value (proves the model actually ran, not a stub).
    expect(distinct.size).toBeGreaterThan(1);
    expect(max).toBeGreaterThan(min);
  }, 60000);

  it("rejects a nonexistent model path", async () => {
    await expect(
      loadDepthModel(join(process.cwd(), "models", "does-not-exist.onnx")),
    ).rejects.toThrow();
  });
});
