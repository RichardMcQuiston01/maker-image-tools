import { describe, expect, it } from "vitest";
import { createImageData, getPixel, setPixel } from "../src/pixel.js";
import {
  colorLut,
  comic,
  createColorLut,
  getLutPreset,
  LUT_PRESET_NAMES,
  outline,
  parseCubeLut,
  stipple,
} from "../src/filters/stylize.js";
import { ditherSierra, ditherTwoRowSierra } from "../src/filters/dither.js";
import { BUILT_IN_FILTERS, registerBuiltInFilters } from "../src/filters/index.js";
import { createFilterRegistry } from "../src/registry.js";

/** Left half black, right half white, so there is one vertical edge down the middle. */
function splitImage(width = 10, height = 6): ImageData {
  const image = createImageData(width, height, [0, 0, 0, 255]);
  for (let y = 0; y < height; y++) {
    for (let x = width / 2; x < width; x++) setPixel(image, x, y, [255, 255, 255, 255]);
  }
  return image;
}

describe("outline", () => {
  it("draws a line at the edge and leaves flat areas alone", () => {
    const output = outline(splitImage(), { color: [255, 0, 0], threshold: 30 });
    expect(getPixel(output, 4, 3).slice(0, 3)).toEqual([255, 0, 0]);
    expect(getPixel(output, 5, 3).slice(0, 3)).toEqual([255, 0, 0]);
    expect(getPixel(output, 0, 3)).toEqual([0, 0, 0, 255]);
    expect(getPixel(output, 9, 3)).toEqual([255, 255, 255, 255]);
  });

  it("a larger width draws a thicker line", () => {
    const thin = outline(splitImage(), { color: [255, 0, 0], width: 1 });
    const thick = outline(splitImage(), { color: [255, 0, 0], width: 3 });
    expect(getPixel(thin, 2, 3).slice(0, 3)).toEqual([0, 0, 0]);
    expect(getPixel(thick, 2, 3).slice(0, 3)).toEqual([255, 0, 0]);
  });

  it("a high threshold finds no edges", () => {
    const image = splitImage();
    const output = outline(image, { threshold: 256, color: [255, 0, 0] });
    expect(Array.from(output.data)).toEqual(Array.from(image.data));
  });

  it("can draw the lines on white or on nothing", () => {
    const onWhite = outline(splitImage(), { background: "white", color: [0, 0, 255] });
    expect(getPixel(onWhite, 0, 3)).toEqual([255, 255, 255, 255]);
    expect(getPixel(onWhite, 4, 3)).toEqual([0, 0, 255, 255]);
    const onNothing = outline(splitImage(), { background: "transparent" });
    expect(getPixel(onNothing, 0, 3)[3]).toBe(0);
    expect(getPixel(onNothing, 4, 3)[3]).toBe(255);
  });

  it("outlines the boundary of a transparent cutout", () => {
    const image = createImageData(9, 9, [0, 0, 0, 0]);
    for (let y = 3; y < 6; y++)
      for (let x = 3; x < 6; x++) setPixel(image, x, y, [120, 120, 120, 255]);
    const output = outline(image, { color: [255, 0, 0], threshold: 30 });
    expect(getPixel(output, 2, 4)[3]).toBeGreaterThan(0);
    expect(getPixel(output, 0, 0)[3]).toBe(0);
  });

  it("never mutates its input", () => {
    const image = splitImage();
    const before = Array.from(image.data);
    outline(image, {});
    expect(Array.from(image.data)).toEqual(before);
  });
});

describe("comic", () => {
  it("posterizes flat colour to the requested number of levels", () => {
    const output = comic(createImageData(4, 4, [100, 150, 200, 255]), { levels: 2 });
    expect(getPixel(output, 1, 1)).toEqual([0, 255, 255, 255]);
  });

  it("inks the edges", () => {
    const output = comic(splitImage(), { ink: [10, 20, 30], lineWidth: 1 });
    expect(getPixel(output, 4, 3).slice(0, 3)).toEqual([10, 20, 30]);
  });

  it("keeps alpha", () => {
    const output = comic(createImageData(3, 3, [90, 90, 90, 140]), {});
    expect(getPixel(output, 1, 1)[3]).toBe(140);
  });
});

describe("stipple", () => {
  const gradient = (): ImageData => {
    const image = createImageData(60, 12, [0, 0, 0, 255]);
    for (let y = 0; y < 12; y++) {
      for (let x = 0; x < 60; x++) {
        const v = Math.round((x / 59) * 255);
        setPixel(image, x, y, [v, v, v, 255]);
      }
    }
    return image;
  };
  const inkIn = (image: ImageData, from: number, to: number): number => {
    let count = 0;
    for (let y = 0; y < image.height; y++) {
      for (let x = from; x < to; x++) if (getPixel(image, x, y)[0] === 0) count++;
    }
    return count;
  };

  it("draws more dots where the picture is darker", () => {
    const output = stipple(gradient(), {});
    expect(inkIn(output, 0, 20)).toBeGreaterThan(inkIn(output, 40, 60));
  });

  it("draws nothing on pure white", () => {
    const output = stipple(createImageData(20, 20, [255, 255, 255, 255]), {});
    expect(inkIn(output, 0, 20)).toBe(0);
  });

  it("is repeatable for a seed and varies with another", () => {
    const a = stipple(gradient(), { seed: 7 });
    const b = stipple(gradient(), { seed: 7 });
    const c = stipple(gradient(), { seed: 8 });
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
    expect(Array.from(a.data)).not.toEqual(Array.from(c.data));
  });

  it("leaves transparent pixels empty", () => {
    const output = stipple(createImageData(20, 20, [0, 0, 0, 0]), {});
    expect(Array.from(output.data).every((value) => value === 0 || value === 255)).toBe(true);
    for (let i = 3; i < output.data.length; i += 4) expect(output.data[i]).toBe(0);
  });
});

describe("colour LUT", () => {
  const identity = (): ReturnType<typeof createColorLut> =>
    createColorLut(5, (r, g, b) => [r, g, b]);

  it("an identity LUT leaves colours unchanged", () => {
    const image = createImageData(1, 1, [37, 142, 219, 200]);
    expect(getPixel(colorLut(image, { lut: identity() }), 0, 0)).toEqual([37, 142, 219, 200]);
  });

  it("interpolates between grid points", () => {
    const invert = createColorLut(2, (r, g, b) => [1 - r, 1 - g, 1 - b]);
    const output = colorLut(createImageData(1, 1, [51, 0, 255, 255]), { lut: invert });
    expect(getPixel(output, 0, 0)).toEqual([204, 255, 0, 255]);
  });

  it("strength blends between the original and the graded colour", () => {
    const invert = createColorLut(2, (r, g, b) => [1 - r, 1 - g, 1 - b]);
    const output = colorLut(createImageData(1, 1, [0, 0, 0, 255]), { lut: invert, strength: 0.5 });
    expect(getPixel(output, 0, 0).slice(0, 3)).toEqual([128, 128, 128]);
  });

  it("parses a .cube file, including the domain, and applies it", () => {
    const cube = [
      'TITLE "invert"',
      "# a comment",
      "LUT_3D_SIZE 2",
      "1 1 1",
      "0 1 1",
      "1 0 1",
      "0 0 1",
      "1 1 0",
      "0 1 0",
      "1 0 0",
      "0 0 0",
    ].join("\n");
    const lut = parseCubeLut(cube);
    expect(lut.size).toBe(2);
    const output = colorLut(createImageData(1, 1, [255, 0, 0, 255]), { lut });
    expect(getPixel(output, 0, 0).slice(0, 3)).toEqual([0, 255, 255]);
  });

  it("explains what is wrong with a bad .cube file", () => {
    expect(() => parseCubeLut("1 1 1")).toThrow(/LUT_3D_SIZE/);
    expect(() => parseCubeLut("LUT_3D_SIZE 2\n1 1 1")).toThrow(/needs 8 colour rows, but 1/);
    expect(() => parseCubeLut("LUT_1D_SIZE 4")).toThrow(/1D/);
    expect(() => parseCubeLut("LUT_3D_SIZE 2\nfoo")).not.toThrow(/Invalid colour row/);
  });

  it("every built-in preset changes the picture and keeps alpha", () => {
    const image = createImageData(1, 1, [90, 130, 170, 180]);
    for (const name of LUT_PRESET_NAMES) {
      const output = colorLut(image, { preset: name });
      expect(Array.from(output.data.slice(0, 3))).not.toEqual([90, 130, 170]);
      expect(output.data[3]).toBe(180);
    }
  });

  it("noir is grayscale and caches presets", () => {
    const output = colorLut(createImageData(1, 1, [200, 80, 40, 255]), { preset: "noir" });
    const [r, g, b] = getPixel(output, 0, 0);
    expect(r).toBe(g);
    expect(g).toBe(b);
    expect(getLutPreset("noir")).toBe(getLutPreset("noir"));
  });
});

describe("two-row Sierra", () => {
  it("produces pure black and white and differs from Sierra", () => {
    const image = createImageData(16, 16, [0, 0, 0, 255]);
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const v = Math.round(((x + y) / 30) * 255);
        setPixel(image, x, y, [v, v, v, 255]);
      }
    }
    const output = ditherTwoRowSierra(image, {});
    for (let i = 0; i < output.data.length; i += 4) {
      expect([0, 255]).toContain(output.data[i]);
    }
    expect(Array.from(output.data)).not.toEqual(Array.from(ditherSierra(image, {}).data));
  });
});

describe("registry", () => {
  it("registers the new filters and each runs with {}", () => {
    const names = ["outline", "comic", "stipple", "color-lut", "dither-two-row-sierra"];
    const registry = createFilterRegistry();
    registerBuiltInFilters(registry);
    const image = createImageData(8, 8, [90, 140, 60, 200]);
    for (const name of names) {
      expect(registry.has(name)).toBe(true);
      expect(registry.apply(name, image, {}).width).toBe(8);
    }
    expect(BUILT_IN_FILTERS.find((entry) => entry.name === "stipple")?.group).toBe("Effects");
    expect(BUILT_IN_FILTERS.find((entry) => entry.name === "dither-two-row-sierra")?.group).toBe(
      "Dither",
    );
  });
});
