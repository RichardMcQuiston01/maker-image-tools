import { describe, expect, it } from "vitest";
import { computeCropRegion } from "../src/auto-crop.js";
import type { SaliencyMask } from "../src/background-removal.js";

function makeMask(
  width: number,
  height: number,
  fill: (x: number, y: number) => number,
): SaliencyMask {
  const values = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      values[y * width + x] = fill(x, y);
    }
  }
  return { values, width, height };
}

describe("computeCropRegion", () => {
  it("finds the tight bounding box of a rectangular subject", () => {
    const mask = makeMask(10, 10, (x, y) => (x >= 3 && x <= 6 && y >= 2 && y <= 5 ? 1 : 0));
    const region = computeCropRegion(mask);
    expect(region).toEqual({ x: 3, y: 2, width: 4, height: 4 });
  });

  it("respects a custom threshold", () => {
    const mask = makeMask(5, 5, (x, y) => (x === 2 && y === 2 ? 0.9 : 0.4));
    const strict = computeCropRegion(mask, { threshold: 0.5 });
    expect(strict).toEqual({ x: 2, y: 2, width: 1, height: 1 });

    const lenient = computeCropRegion(mask, { threshold: 0.3 });
    expect(lenient).toEqual({ x: 0, y: 0, width: 5, height: 5 });
  });

  it("expands by margin and clamps to mask bounds", () => {
    const mask = makeMask(10, 10, (x, y) => (x >= 4 && x <= 5 && y >= 4 && y <= 5 ? 1 : 0));
    const region = computeCropRegion(mask, { margin: 3 });
    expect(region).toEqual({ x: 1, y: 1, width: 8, height: 8 });
  });

  it("clamps margin at the mask edges without going out of bounds", () => {
    const mask = makeMask(6, 6, (x, y) => (x === 0 && y === 0 ? 1 : 0));
    const region = computeCropRegion(mask, { margin: 5 });
    expect(region.x).toBe(0);
    expect(region.y).toBe(0);
    expect(region.width).toBeLessThanOrEqual(6);
    expect(region.height).toBeLessThanOrEqual(6);
  });

  it("falls back to the full extent when nothing clears the threshold", () => {
    const mask = makeMask(4, 4, () => 0);
    const region = computeCropRegion(mask);
    expect(region).toEqual({ x: 0, y: 0, width: 4, height: 4 });
  });
});
