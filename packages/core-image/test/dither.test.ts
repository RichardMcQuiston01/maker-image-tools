import { describe, expect, it } from "vitest";
import { createImageData, setPixel } from "../src/pixel.js";
import {
  ditherAtkinson,
  ditherBayer,
  ditherBlueNoise,
  ditherBurkes,
  ditherFloydSteinberg,
  ditherJarvisJudiceNinke,
  ditherSierra,
  ditherStucki,
} from "../src/filters/dither.js";
import type { Filter, FilterOptions } from "../src/types.js";

const errorDiffusionFilters: Array<[string, Filter<FilterOptions>]> = [
  ["ditherFloydSteinberg", ditherFloydSteinberg],
  ["ditherAtkinson", ditherAtkinson],
  ["ditherJarvisJudiceNinke", ditherJarvisJudiceNinke],
  ["ditherStucki", ditherStucki],
  ["ditherSierra", ditherSierra],
  ["ditherBurkes", ditherBurkes],
];

const allFilters: Array<[string, Filter<FilterOptions>]> = [
  ...errorDiffusionFilters,
  ["ditherBayer", ditherBayer],
  ["ditherBlueNoise", ditherBlueNoise],
];

/** Builds a non-uniform grayscale test image (a diagonal gradient) so error diffusion
 * and ordered dithering actually have varied input to work with. */
function gradientImage(width: number, height: number, alpha = 255): ImageData {
  const image = createImageData(width, height, [0, 0, 0, alpha]);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = Math.round(((x + y) / (width + height - 2)) * 255);
      setPixel(image, x, y, [v, v, v, alpha]);
    }
  }
  return image;
}

function expectBinaryImage(output: ImageData, expectedAlpha: number): void {
  for (let i = 0; i < output.data.length; i += 4) {
    const r = output.data[i];
    const g = output.data[i + 1];
    const b = output.data[i + 2];
    const a = output.data[i + 3];
    expect(r).toBe(g);
    expect(g).toBe(b);
    expect(r === 0 || r === 255).toBe(true);
    expect(a).toBe(expectedAlpha);
  }
}

describe("dithering filters", () => {
  describe.each(allFilters)("%s", (_name, filter) => {
    it("produces a pure black/white image with alpha preserved", () => {
      const input = gradientImage(9, 7, 200);
      const output = filter(input, {});
      expect(output.width).toBe(9);
      expect(output.height).toBe(7);
      expectBinaryImage(output, 200);
    });

    it("does not mutate the input image", () => {
      const input = gradientImage(5, 5, 255);
      const before = Array.from(input.data);
      filter(input, {});
      expect(Array.from(input.data)).toEqual(before);
    });

    it("produces an all-white image for a solid white input", () => {
      const input = createImageData(6, 6, [255, 255, 255, 255]);
      const output = filter(input, {});
      for (let i = 0; i < output.data.length; i += 4) {
        expect([
          output.data[i],
          output.data[i + 1],
          output.data[i + 2],
          output.data[i + 3],
        ]).toEqual([255, 255, 255, 255]);
      }
    });

    it("produces an all-black image for a solid black input", () => {
      const input = createImageData(6, 6, [0, 0, 0, 255]);
      const output = filter(input, {});
      for (let i = 0; i < output.data.length; i += 4) {
        expect([
          output.data[i],
          output.data[i + 1],
          output.data[i + 2],
          output.data[i + 3],
        ]).toEqual([0, 0, 0, 255]);
      }
    });
  });

  describe("ditherFloydSteinberg threshold option", () => {
    it("respects a custom threshold", () => {
      const input = createImageData(1, 1, [100, 100, 100, 255]);
      expect(ditherFloydSteinberg(input, { threshold: 128 }).data[0]).toBe(0);
      expect(ditherFloydSteinberg(input, { threshold: 50 }).data[0]).toBe(255);
    });
  });

  describe("ditherBayer", () => {
    it("works with matrixSize 2", () => {
      const input = gradientImage(4, 4, 255);
      const output = ditherBayer(input, { matrixSize: 2 });
      expectBinaryImage(output, 255);
    });

    it("works with matrixSize 4 (default)", () => {
      const input = gradientImage(4, 4, 255);
      const output = ditherBayer(input, {});
      expectBinaryImage(output, 255);
    });

    it("works with matrixSize 8", () => {
      const input = gradientImage(8, 8, 255);
      const output = ditherBayer(input, { matrixSize: 8 });
      expectBinaryImage(output, 255);
    });

    // Spot-checks the recursive Bayer matrix construction itself:
    // M(2) = [[0,2],[3,1]]; M(4) built blockwise from M(2) should give
    // M(4)[0][0] = 0 and M(4)[1][1] = 4, i.e. thresholds of
    // (0+0.5)/16*255 = 7.968... and (4+0.5)/16*255 = 71.719... respectively.
    it("constructs the 4x4 Bayer matrix correctly at [0][0] (expected value 0)", () => {
      const justBelow = createImageData(1, 1, [7, 7, 7, 255]);
      const justAbove = createImageData(1, 1, [8, 8, 8, 255]);
      expect(ditherBayer(justBelow, { matrixSize: 4 }).data[0]).toBe(0);
      expect(ditherBayer(justAbove, { matrixSize: 4 }).data[0]).toBe(255);
    });

    it("constructs the 4x4 Bayer matrix correctly at [1][1] (expected value 4)", () => {
      const below = createImageData(2, 2, [0, 0, 0, 255]);
      setPixel(below, 1, 1, [71, 71, 71, 255]);
      const above = createImageData(2, 2, [0, 0, 0, 255]);
      setPixel(above, 1, 1, [72, 72, 72, 255]);

      const belowOutput = ditherBayer(below, { matrixSize: 4 });
      const aboveOutput = ditherBayer(above, { matrixSize: 4 });

      const idx = (1 * 2 + 1) * 4;
      expect(belowOutput.data[idx]).toBe(0);
      expect(aboveOutput.data[idx]).toBe(255);
    });
  });

  describe("ditherBlueNoise", () => {
    it("uses per-pixel IGN thresholds rather than a single global threshold", () => {
      // Same mid-gray value across a small image should still produce both
      // black and white pixels, since the threshold varies per pixel.
      const input = createImageData(6, 6, [128, 128, 128, 255]);
      const output = ditherBlueNoise(input, {});
      const values = new Set<number>();
      for (let i = 0; i < output.data.length; i += 4) {
        values.add(output.data[i] as number);
      }
      expect(values.has(0)).toBe(true);
      expect(values.has(255)).toBe(true);
    });
  });
});
