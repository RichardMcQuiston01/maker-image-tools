import { describe, expect, it } from "vitest";
import { generateDpiTestGrid, generateMaterialTestGrid } from "../src/filters/testgrid.js";
import { getPixel } from "../src/pixel.js";

describe("generateDpiTestGrid", () => {
  it("defaults to a 400x400 opaque grid", () => {
    const image = generateDpiTestGrid();

    expect(image.width).toBe(400);
    expect(image.height).toBe(400);
    for (let i = 3; i < image.data.length; i += 4) {
      expect(image.data[i]).toBe(255);
    }
  });

  it("respects custom dimensions", () => {
    const image = generateDpiTestGrid({ widthPx: 50, heightPx: 30, lineSpacingPx: 5 });

    expect(image.width).toBe(50);
    expect(image.height).toBe(30);
  });

  it("draws black lines at the expected spacing and white elsewhere", () => {
    const image = generateDpiTestGrid({ widthPx: 20, heightPx: 20, lineSpacingPx: 5 });

    // Lines at x/y = 0, 5, 10, 15. Index 0 (the 0th, a multiple of 10) is
    // 2px wide (columns/rows 0 and 1); the rest are 1px wide.
    expect(getPixel(image, 0, 2)).toEqual([0, 0, 0, 255]); // vertical line, thick
    expect(getPixel(image, 1, 2)).toEqual([0, 0, 0, 255]); // vertical line, thick
    expect(getPixel(image, 5, 2)).toEqual([0, 0, 0, 255]); // vertical line, thin
    expect(getPixel(image, 10, 2)).toEqual([0, 0, 0, 255]);
    expect(getPixel(image, 15, 2)).toEqual([0, 0, 0, 255]);

    expect(getPixel(image, 2, 0)).toEqual([0, 0, 0, 255]); // horizontal line, thick
    expect(getPixel(image, 2, 1)).toEqual([0, 0, 0, 255]); // horizontal line, thick
    expect(getPixel(image, 2, 5)).toEqual([0, 0, 0, 255]); // horizontal line, thin

    // Off any line: should be white.
    expect(getPixel(image, 2, 2)).toEqual([255, 255, 255, 255]);
    expect(getPixel(image, 17, 17)).toEqual([255, 255, 255, 255]);
    expect(getPixel(image, 8, 8)).toEqual([255, 255, 255, 255]);
  });

  it("never hangs on a non-positive lineSpacingPx (clamped to 1)", () => {
    const image = generateDpiTestGrid({ widthPx: 10, heightPx: 10, lineSpacingPx: 0 });

    expect(image.width).toBe(10);
    expect(image.height).toBe(10);
  });

  it("clamps non-positive widthPx/heightPx to a valid minimum", () => {
    const image = generateDpiTestGrid({ widthPx: 0, heightPx: -5 });

    expect(image.width).toBeGreaterThanOrEqual(1);
    expect(image.height).toBeGreaterThanOrEqual(1);
  });
});

describe("generateMaterialTestGrid", () => {
  it("defaults to a 5x5 grid sized from the default cell/gap sizes", () => {
    const image = generateMaterialTestGrid();

    // columns=5, rows=5, cellSizePx=60, gapPx=4
    const expectedWidth = 5 * 60 + 6 * 4;
    const expectedHeight = 5 * 60 + 6 * 4;
    expect(image.width).toBe(expectedWidth);
    expect(image.height).toBe(expectedHeight);
  });

  it("computes canvas dimensions from a custom 2x2 speeds/powers grid", () => {
    const image = generateMaterialTestGrid({
      speeds: [100, 200],
      powers: [50, 100],
      cellSizePx: 10,
      gapPx: 2,
    });

    // columns = speeds.length = 2, rows = powers.length = 2
    expect(image.width).toBe(2 * 10 + 3 * 2);
    expect(image.height).toBe(2 * 10 + 3 * 2);
  });

  it("fills each row with a gray value proportional to that row's power", () => {
    const image = generateMaterialTestGrid({
      speeds: [100, 200],
      powers: [50, 100],
      cellSizePx: 10,
      gapPx: 2,
    });

    // Row 0 (power 50, half of max power 100) -> darkness 0.5 -> gray 128.
    const row0Pixel = getPixel(image, 2 + 5, 2 + 5);
    expect(row0Pixel).toEqual([128, 128, 128, 255]);

    // Row 1 (power 100, max power) -> darkness 1 -> gray 0 (fully dark).
    const row1Y = 2 + 10 + 2 + 5;
    const row1Pixel = getPixel(image, 2 + 5, row1Y);
    expect(row1Pixel).toEqual([0, 0, 0, 255]);

    // Gap between cells stays white.
    expect(getPixel(image, 0, 0)).toEqual([255, 255, 255, 255]);
  });

  it("is opaque white in the background/gap regions", () => {
    const image = generateMaterialTestGrid({
      speeds: [10],
      powers: [10],
      cellSizePx: 4,
      gapPx: 3,
    });

    expect(getPixel(image, 0, 0)).toEqual([255, 255, 255, 255]);
    expect(getPixel(image, image.width - 1, image.height - 1)).toEqual([255, 255, 255, 255]);
  });

  it("clamps a non-positive cellSizePx and negative gapPx to a valid minimum", () => {
    const image = generateMaterialTestGrid({ speeds: [1], powers: [1], cellSizePx: 0, gapPx: -3 });

    expect(image.width).toBeGreaterThanOrEqual(1);
    expect(image.height).toBeGreaterThanOrEqual(1);
  });
});
