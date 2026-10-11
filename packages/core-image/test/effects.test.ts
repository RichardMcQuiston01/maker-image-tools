import { describe, expect, it } from "vitest";
import { createImageData, getPixel, setPixel } from "../src/pixel.js";
import {
  alphaThreshold,
  crossProcess,
  duotone,
  gaussianBlur,
  highPass,
  pixelate,
  sepia,
} from "../src/filters/effects.js";
import { BUILT_IN_FILTERS, registerBuiltInFilters } from "../src/filters/index.js";
import { createFilterRegistry } from "../src/registry.js";

const fillOf = (image: ImageData): number[] => Array.from(image.data);

describe("gaussianBlur", () => {
  it("leaves a flat image unchanged", () => {
    const image = createImageData(6, 6, [80, 120, 200, 255]);
    expect(fillOf(gaussianBlur(image, { sigma: 2 }))).toEqual(fillOf(image));
  });

  it("spreads a single bright pixel into its neighbours and conserves brightness", () => {
    const image = createImageData(9, 9, [0, 0, 0, 255]);
    setPixel(image, 4, 4, [255, 255, 255, 255]);
    const output = gaussianBlur(image, { sigma: 1 });
    expect(getPixel(output, 4, 4)[0]).toBeLessThan(255);
    expect(getPixel(output, 5, 4)[0]).toBeGreaterThan(0);
    let total = 0;
    for (let i = 0; i < output.data.length; i += 4) total += output.data[i] ?? 0;
    expect(total).toBeGreaterThan(255 * 0.9);
    expect(total).toBeLessThan(255 * 1.1);
  });

  it("does not bleed the colour of transparent pixels into opaque ones", () => {
    const image = createImageData(5, 1, [0, 0, 0, 0]);
    setPixel(image, 2, 0, [200, 50, 50, 255]);
    const output = gaussianBlur(image, { sigma: 1 });
    const [r, g, b] = getPixel(output, 2, 0);
    expect([r, g, b]).toEqual([200, 50, 50]);
  });

  it("returns an unchanged copy for sigma 0 and never mutates the input", () => {
    const image = createImageData(3, 3, [10, 20, 30, 255]);
    setPixel(image, 1, 1, [255, 0, 0, 255]);
    const before = fillOf(image);
    const output = gaussianBlur(image, { sigma: 0 });
    expect(fillOf(output)).toEqual(before);
    expect(output).not.toBe(image);
    gaussianBlur(image, {});
    expect(fillOf(image)).toEqual(before);
  });
});

describe("highPass", () => {
  it("turns a flat image mid-grey and keeps alpha", () => {
    const output = highPass(createImageData(5, 5, [30, 90, 200, 180]), {});
    expect(getPixel(output, 2, 2)).toEqual([128, 128, 128, 180]);
  });

  it("keeps an edge: the bright side goes above grey and the dark side below", () => {
    const image = createImageData(8, 1, [0, 0, 0, 255]);
    for (let x = 4; x < 8; x++) setPixel(image, x, 0, [255, 255, 255, 255]);
    const output = highPass(image, { sigma: 1 });
    expect(getPixel(output, 4, 0)[0]).toBeGreaterThan(128);
    expect(getPixel(output, 3, 0)[0]).toBeLessThan(128);
  });

  it("a larger amount exaggerates the detail", () => {
    const image = createImageData(8, 1, [0, 0, 0, 255]);
    for (let x = 4; x < 8; x++) setPixel(image, x, 0, [255, 255, 255, 255]);
    const soft = getPixel(highPass(image, { sigma: 1, amount: 0.5 }), 4, 0)[0];
    const hard = getPixel(highPass(image, { sigma: 1, amount: 1 }), 4, 0)[0];
    expect(hard).toBeGreaterThan(soft);
  });
});

describe("sepia", () => {
  it("applies the classic matrix at full strength", () => {
    const output = sepia(createImageData(1, 1, [100, 100, 100, 255]), {});
    expect(getPixel(output, 0, 0)).toEqual([135, 120, 94, 255]);
  });

  it("amount 0 changes nothing and amount 0.5 is halfway", () => {
    const image = createImageData(1, 1, [100, 100, 100, 255]);
    expect(getPixel(sepia(image, { amount: 0 }), 0, 0)).toEqual([100, 100, 100, 255]);
    expect(getPixel(sepia(image, { amount: 0.5 }), 0, 0)[0]).toBe(118);
  });
});

describe("alphaThreshold", () => {
  it("snaps alpha to 0 or 255 and leaves colour", () => {
    const image = createImageData(3, 1, [9, 8, 7, 0]);
    setPixel(image, 0, 0, [9, 8, 7, 127]);
    setPixel(image, 1, 0, [9, 8, 7, 128]);
    setPixel(image, 2, 0, [9, 8, 7, 255]);
    const output = alphaThreshold(image, {});
    expect([0, 1, 2].map((x) => getPixel(output, x, 0)[3])).toEqual([0, 255, 255]);
    expect(getPixel(output, 1, 0).slice(0, 3)).toEqual([9, 8, 7]);
  });

  it("honours a custom threshold", () => {
    const image = createImageData(1, 1, [1, 2, 3, 100]);
    expect(getPixel(alphaThreshold(image, { threshold: 50 }), 0, 0)[3]).toBe(255);
    expect(getPixel(alphaThreshold(image, { threshold: 200 }), 0, 0)[3]).toBe(0);
  });
});

describe("pixelate", () => {
  it("averages each block into a flat colour", () => {
    const image = createImageData(4, 2, [0, 0, 0, 255]);
    setPixel(image, 0, 0, [100, 0, 0, 255]);
    setPixel(image, 1, 0, [200, 0, 0, 255]);
    const output = pixelate(image, { blockSize: 2 });
    const expected = getPixel(output, 0, 0);
    expect(expected[0]).toBe(75);
    expect(getPixel(output, 1, 1)).toEqual(expected);
    expect(getPixel(output, 2, 0)[0]).toBe(0);
  });

  it("handles blocks that run off the edge", () => {
    const image = createImageData(5, 5, [10, 10, 10, 255]);
    const output = pixelate(image, { blockSize: 4 });
    expect(getPixel(output, 4, 4)).toEqual([10, 10, 10, 255]);
  });

  it("block size 1 is a copy", () => {
    const image = createImageData(3, 3, [1, 2, 3, 255]);
    setPixel(image, 1, 1, [9, 9, 9, 255]);
    expect(fillOf(pixelate(image, { blockSize: 1 }))).toEqual(fillOf(image));
  });
});

describe("duotone", () => {
  it("maps black to the shadow colour and white to the highlight colour", () => {
    const options = {
      shadow: [10, 20, 30] as [number, number, number],
      highlight: [200, 210, 220] as [number, number, number],
    };
    expect(getPixel(duotone(createImageData(1, 1, [0, 0, 0, 255]), options), 0, 0)).toEqual([
      10, 20, 30, 255,
    ]);
    expect(getPixel(duotone(createImageData(1, 1, [255, 255, 255, 255]), options), 0, 0)).toEqual([
      200, 210, 220, 255,
    ]);
  });

  it("works with default colours", () => {
    const output = duotone(createImageData(1, 1, [128, 128, 128, 255]), {});
    expect(getPixel(output, 0, 0)[3]).toBe(255);
  });
});

describe("crossProcess", () => {
  it("strength 0 changes nothing", () => {
    const image = createImageData(1, 1, [40, 120, 220, 255]);
    expect(getPixel(crossProcess(image, { strength: 0 }), 0, 0)).toEqual([40, 120, 220, 255]);
  });

  it("lifts blue shadows, holds back blue highlights and adds red contrast", () => {
    const dark = getPixel(crossProcess(createImageData(1, 1, [0, 0, 0, 255]), {}), 0, 0);
    const light = getPixel(crossProcess(createImageData(1, 1, [255, 255, 255, 255]), {}), 0, 0);
    expect(dark[2]).toBeGreaterThan(30);
    expect(light[2]).toBeLessThan(230);
    const midDark = getPixel(crossProcess(createImageData(1, 1, [64, 64, 64, 255]), {}), 0, 0);
    expect(midDark[0]).toBeLessThan(64);
  });
});

describe("registry", () => {
  it("registers the effects under the Effects group and each runs with {}", () => {
    const names = [
      "gaussian-blur",
      "high-pass",
      "sepia",
      "alpha-threshold",
      "pixelate",
      "duotone",
      "cross-process",
    ];
    const registry = createFilterRegistry();
    registerBuiltInFilters(registry);
    const image = createImageData(4, 4, [90, 140, 60, 200]);
    for (const name of names) {
      expect(registry.has(name)).toBe(true);
      expect(BUILT_IN_FILTERS.find((entry) => entry.name === name)?.group).toBe("Effects");
      expect(registry.apply(name, image, {}).width).toBe(4);
    }
  });
});
