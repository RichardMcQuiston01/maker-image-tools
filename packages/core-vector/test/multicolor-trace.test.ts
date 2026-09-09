import { describe, expect, it } from "vitest";
import { traceImageColors } from "../src/multicolor-trace.js";

function makeSideBySideImage(width: number, height: number, splitAt: number) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const [r, g, b] = x < splitAt ? [200, 30, 30] : [30, 30, 200];
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return { width, height, data } as ImageData;
}

describe("traceImageColors", () => {
  it("produces one layer per solid-color region, each with a non-empty path", () => {
    const image = makeSideBySideImage(40, 20, 20);
    const layers = traceImageColors(image, { colorCount: 2 });

    expect(layers.length).toBe(2);
    for (const layer of layers) {
      expect(layer.paths.length).toBeGreaterThan(0);
      expect(layer.color).toHaveLength(3);
    }

    const colors = layers.map((l) => l.color.join(","));
    expect(colors).toContain("200,30,30");
    expect(colors).toContain("30,30,200");
  });

  it("omits layers that end up with no traceable paths (e.g. specks below minRegionSize)", () => {
    // A single stray pixel of a third color, well under the default minRegionSize.
    const image = makeSideBySideImage(40, 20, 20);
    image.data[0] = 0;
    image.data[1] = 255;
    image.data[2] = 0;

    const layers = traceImageColors(image, { colorCount: 3 });
    // The stray green pixel forms its own 1-pixel region and is discarded by minRegionSize,
    // so it shouldn't produce a visible third layer even though quantization may still
    // allocate it a palette slot.
    for (const layer of layers) {
      expect(layer.paths.length).toBeGreaterThan(0);
    }
  });

  it("respects a custom colorCount", () => {
    const image = makeSideBySideImage(60, 10, 20);
    // A gradient-free 2-color image quantized to a higher colorCount still yields at most 2
    // non-empty layers, since there are only 2 real colors to separate.
    const layers = traceImageColors(image, { colorCount: 6 });
    expect(layers.length).toBeLessThanOrEqual(2);
  });

  it("traces against an explicit palette instead of deriving one via quantization", () => {
    const image = makeSideBySideImage(40, 20, 20);
    // Slightly off from the image's true colors — assignColorLabels should still snap each
    // pixel to its nearest entry, and the layer's reported color is the palette entry itself,
    // not the image's original color.
    const layers = traceImageColors(image, {
      palette: [
        [210, 20, 20],
        [20, 20, 210],
      ],
    });

    expect(layers.length).toBe(2);
    const colors = layers.map((l) => l.color.join(","));
    expect(colors).toContain("210,20,20");
    expect(colors).toContain("20,20,210");
    for (const layer of layers) {
      expect(layer.paths.length).toBeGreaterThan(0);
    }
  });

  it("ignores colorCount when an explicit palette is given", () => {
    const image = makeSideBySideImage(40, 20, 20);
    const layers = traceImageColors(image, {
      colorCount: 6,
      palette: [
        [200, 30, 30],
        [30, 30, 200],
      ],
    });
    expect(layers.length).toBe(2);
  });
});
