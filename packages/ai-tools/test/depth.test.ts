import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { depthInputSize, loadDepthModel, normalizeDepth, resampleDepth } from "../src/depth.js";

const MODEL_PATH = join(process.cwd(), "models", "depth-anything-v2-small.onnx");

describe("depthInputSize", () => {
  it("scales the longer side to the target, both sides multiples of 14", () => {
    expect(depthInputSize(1000, 500)).toEqual({ width: 518, height: 266 });
    expect(depthInputSize(500, 1000)).toEqual({ width: 266, height: 518 });
    const odd = depthInputSize(2048, 1362);
    expect(odd.width).toBe(518);
    expect(odd.height % 14).toBe(0);
    expect(Math.abs(odd.width / odd.height - 2048 / 1362)).toBeLessThan(0.05);
  });

  it("clamps the target and never returns a side under one patch", () => {
    expect(depthInputSize(100, 100, 10)).toEqual({ width: 112, height: 112 });
    expect(depthInputSize(100, 100, 5000)).toEqual({ width: 1022, height: 1022 });
    expect(depthInputSize(4000, 2).height).toBe(14);
  });

  it("names a size that cannot be used", () => {
    expect(() => depthInputSize(0, 10)).toThrow(/0 x 10/);
  });
});

describe("normalizeDepth", () => {
  it("stretches to 0..1", () => {
    expect(Array.from(normalizeDepth(new Float32Array([2, 4, 6])))).toEqual([0, 0.5, 1]);
  });

  it("a flat map comes back all zero rather than NaN", () => {
    expect(Array.from(normalizeDepth(new Float32Array([3, 3, 3])))).toEqual([0, 0, 0]);
  });
});

describe("resampleDepth", () => {
  it("returns a copy at the same size", () => {
    const source = new Float32Array([0, 1, 1, 0]);
    const copy = resampleDepth(source, 2, 2, 2, 2);
    expect(Array.from(copy)).toEqual([0, 1, 1, 0]);
    expect(copy).not.toBe(source);
  });

  it("interpolates between samples and keeps float precision", () => {
    const up = resampleDepth(new Float32Array([0, 1]), 2, 1, 4, 1);
    expect(up[0]).toBeCloseTo(0, 5);
    expect(up[3]).toBeCloseTo(1, 5);
    expect(up[1]!).toBeGreaterThan(0);
    expect(up[1]!).toBeLessThan(up[2]!);
  });

  it("downsamples without leaving the source range", () => {
    const source = Float32Array.from({ length: 64 }, (_, i) => (i % 8) / 7);
    const down = resampleDepth(source, 8, 8, 3, 3);
    for (const value of down) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});

describe("loadDepthModel with the vendored model", () => {
  it("returns a [0, 1] map the size of the source, whatever its proportions", async () => {
    const bytes = readFileSync(MODEL_PATH);
    const model = await loadDepthModel(new Uint8Array(bytes), { inputSize: 154 });

    const width = 90;
    const height = 60;
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const shade = 40 + Math.round((y / height) * 180);
        pixels.set([shade, shade, shade, 255], (y * width + x) * 4);
      }
    }
    const depth = await model.estimateDepth(new ImageData(pixels, width, height));

    expect(depth.width).toBe(width);
    expect(depth.height).toBe(height);
    expect(depth.values.length).toBe(width * height);
    let min = Infinity;
    let max = -Infinity;
    for (const value of depth.values) {
      expect(Number.isFinite(value)).toBe(true);
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThanOrEqual(1);
    // Min-max normalised at the model's size, so the range is spread, not flat.
    expect(max - min).toBeGreaterThan(0.5);
  });
});
