import { describe, expect, it } from "vitest";
import { assignColorLabels, quantizeColors } from "../src/color-quantize.js";

function makeImage(
  width: number,
  height: number,
  colorAt: (x: number, y: number) => [number, number, number],
) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = colorAt(x, y);
      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return { width, height, data } as ImageData;
}

describe("quantizeColors", () => {
  it("recovers exactly 3 known solid colors from a 3-color image", () => {
    // Left third red, middle third green, right third blue.
    const image = makeImage(30, 10, (x) => {
      if (x < 10) return [255, 0, 0];
      if (x < 20) return [0, 255, 0];
      return [0, 0, 255];
    });
    const { labels, palette } = quantizeColors(image, { colorCount: 3 });

    expect(palette.length).toBe(3);
    const paletteSet = new Set(palette.map((c) => c.join(",")));
    expect(paletteSet.has("255,0,0")).toBe(true);
    expect(paletteSet.has("0,255,0")).toBe(true);
    expect(paletteSet.has("0,0,255")).toBe(true);

    // Every pixel's label maps back to its true color.
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        const p = y * image.width + x;
        const label = labels[p] as number;
        const color = palette[label] as [number, number, number];
        const expected = x < 10 ? [255, 0, 0] : x < 20 ? [0, 255, 0] : [0, 0, 255];
        expect(color).toEqual(expected);
      }
    }
  });

  it("returns a single-entry palette for a solid-color image regardless of requested count", () => {
    const image = makeImage(4, 4, () => [10, 20, 30]);
    const { labels, palette } = quantizeColors(image, { colorCount: 8 });
    expect(palette.length).toBe(1);
    expect(palette[0]).toEqual([10, 20, 30]);
    expect(Array.from(labels).every((l) => l === 0)).toBe(true);
  });

  it("defaults to 6 colors when no colorCount is given", () => {
    // A smooth gradient has plenty of color variety to actually reach the default count.
    const image = makeImage(64, 1, (x) => [Math.round((x / 63) * 255), 0, 0]);
    const { palette } = quantizeColors(image);
    expect(palette.length).toBe(6);
  });

  it("clamps an absurdly large colorCount request", () => {
    const image = makeImage(8, 8, (x, y) => [x * 10, y * 10, 0]);
    const { palette } = quantizeColors(image, { colorCount: 1_000_000 });
    expect(palette.length).toBeLessThanOrEqual(64);
  });
});

describe("assignColorLabels", () => {
  it("labels each pixel to its exact match in an explicit palette", () => {
    const image = makeImage(30, 10, (x) => {
      if (x < 10) return [255, 0, 0];
      if (x < 20) return [0, 255, 0];
      return [0, 0, 255];
    });
    const palette: Array<[number, number, number]> = [
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
    ];
    const labels = assignColorLabels(image, palette);

    for (let x = 0; x < image.width; x++) {
      const expected = x < 10 ? 0 : x < 20 ? 1 : 2;
      expect(labels[x]).toBe(expected);
    }
  });

  it("assigns each pixel to its nearest palette color when there's no exact match", () => {
    const image = makeImage(2, 1, (x) => (x === 0 ? [10, 10, 10] : [240, 240, 240]));
    const palette: Array<[number, number, number]> = [
      [0, 0, 0],
      [255, 255, 255],
    ];
    const labels = assignColorLabels(image, palette);
    expect(labels[0]).toBe(0);
    expect(labels[1]).toBe(1);
  });

  it("returns an all-zero label array for an empty palette", () => {
    const image = makeImage(2, 2, () => [1, 2, 3]);
    const labels = assignColorLabels(image, []);
    expect(Array.from(labels)).toEqual([0, 0, 0, 0]);
  });
});
