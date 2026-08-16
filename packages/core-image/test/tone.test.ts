import { describe, expect, it } from "vitest";
import { createImageData, setPixel } from "../src/pixel.js";
import {
  adjustGamma,
  brightnessContrast,
  curves,
  grayscale,
  levels,
} from "../src/filters/tone.js";

function imageFromPixels(pixels: [number, number, number, number][]): ImageData {
  const image = createImageData(pixels.length, 1);
  pixels.forEach((rgba, x) => setPixel(image, x, 0, rgba));
  return image;
}

describe("grayscale", () => {
  it("defaults to the luminance (Rec. 601) method", () => {
    const image = createImageData(1, 1, [10, 20, 90, 255]);
    const output = grayscale(image, {});
    // 10*0.299 + 20*0.587 + 90*0.114 = 24.99 -> rounds to 25
    expect(Array.from(output.data)).toEqual([25, 25, 25, 255]);
  });

  it("supports the average method", () => {
    const image = createImageData(1, 1, [10, 20, 90, 255]);
    const output = grayscale(image, { method: "average" });
    expect(Array.from(output.data)).toEqual([40, 40, 40, 255]);
  });

  it("supports the lightness method", () => {
    const image = createImageData(1, 1, [10, 20, 90, 255]);
    const output = grayscale(image, { method: "lightness" });
    expect(Array.from(output.data)).toEqual([50, 50, 50, 255]);
  });

  it("does not mutate the input image", () => {
    const image = createImageData(1, 1, [10, 20, 90, 255]);
    grayscale(image, {});
    expect(Array.from(image.data)).toEqual([10, 20, 90, 255]);
  });
});

describe("levels", () => {
  it("is a no-op with default options", () => {
    const image = createImageData(1, 1, [0, 128, 255, 200]);
    const output = levels(image, {});
    expect(Array.from(output.data)).toEqual([0, 128, 255, 200]);
  });

  it("applies inputBlack/inputWhite/outputBlack/outputWhite per channel", () => {
    const image = createImageData(1, 1, [125, 125, 125, 255]);
    const output = levels(image, {
      inputBlack: 50,
      inputWhite: 200,
      outputBlack: 10,
      outputWhite: 244,
    });
    // normalized = (125-50)/150 = 0.5, result = 10 + 0.5*234 = 127
    expect(Array.from(output.data)).toEqual([127, 127, 127, 255]);
  });

  it("guards against inputWhite === inputBlack instead of dividing by zero", () => {
    const image = imageFromPixels([
      [100, 100, 100, 255],
      [200, 200, 200, 255],
    ]);
    const output = levels(image, { inputBlack: 100, inputWhite: 100 });
    // inputWhite is treated as inputBlack + 1 = 101, so 100 maps to outputBlack (0)
    // and anything >= 101 clamps to outputWhite (255).
    expect(Array.from(output.data)).toEqual([0, 0, 0, 255, 255, 255, 255, 255]);
  });
});

describe("curves", () => {
  it("is a no-op with default (identity) points", () => {
    const image = createImageData(1, 1, [0, 77, 255, 128]);
    const output = curves(image, {});
    expect(Array.from(output.data)).toEqual([0, 77, 255, 128]);
  });

  it("is a no-op when fewer than 2 points are given", () => {
    const image = createImageData(1, 1, [0, 77, 255, 128]);
    const output = curves(image, { points: [{ x: 100, y: 50 }] });
    expect(Array.from(output.data)).toEqual([0, 77, 255, 128]);
  });

  it("interpolates piecewise-linearly between points", () => {
    const image = createImageData(1, 1, [128, 128, 128, 255]);
    const output = curves(image, {
      points: [
        { x: 0, y: 0 },
        { x: 255, y: 200 },
      ],
    });
    // 128/255 * 200 = 100.39 -> rounds to 100
    expect(Array.from(output.data)).toEqual([100, 100, 100, 255]);
  });

  it("clamps to the first/last point's y outside the given x range", () => {
    const image = imageFromPixels([
      [0, 0, 0, 255],
      [125, 125, 125, 255],
      [255, 255, 255, 255],
    ]);
    const output = curves(image, {
      points: [
        { x: 50, y: 80 },
        { x: 200, y: 180 },
      ],
    });
    expect(Array.from(output.data)).toEqual([
      80, 80, 80, 255, 130, 130, 130, 255, 180, 180, 180, 255,
    ]);
  });
});

describe("brightnessContrast", () => {
  it("is a no-op with default options", () => {
    const image = createImageData(1, 1, [10, 128, 240, 255]);
    const output = brightnessContrast(image, {});
    expect(Array.from(output.data)).toEqual([10, 128, 240, 255]);
  });

  it("applies brightness as a flat offset and clamps at 255", () => {
    const image = imageFromPixels([
      [100, 100, 100, 255],
      [230, 230, 230, 255],
    ]);
    const output = brightnessContrast(image, { brightness: 50 });
    expect(Array.from(output.data)).toEqual([150, 150, 150, 255, 255, 255, 255, 255]);
  });

  it("minimum contrast (-255) flattens every value to mid-gray (128)", () => {
    const image = imageFromPixels([
      [10, 10, 10, 255],
      [200, 200, 200, 255],
    ]);
    const output = brightnessContrast(image, { contrast: -255 });
    expect(Array.from(output.data)).toEqual([128, 128, 128, 255, 128, 128, 128, 255]);
  });
});

describe("adjustGamma", () => {
  it("is a no-op with the default gamma of 1", () => {
    const image = createImageData(1, 1, [0, 77, 255, 255]);
    const output = adjustGamma(image, {});
    expect(Array.from(output.data)).toEqual([0, 77, 255, 255]);
  });

  it("brightens midtones for gamma > 1", () => {
    const image = createImageData(1, 1, [64, 64, 64, 255]);
    const output = adjustGamma(image, { gamma: 2 });
    // 255 * (64/255)^0.5 = 127.75 -> rounds to 128
    expect(Array.from(output.data)).toEqual([128, 128, 128, 255]);
  });

  it("preserves the endpoints 0 and 255", () => {
    const image = imageFromPixels([
      [0, 0, 0, 255],
      [255, 255, 255, 255],
    ]);
    const output = adjustGamma(image, { gamma: 2 });
    expect(Array.from(output.data)).toEqual([0, 0, 0, 255, 255, 255, 255, 255]);
  });

  it("treats gamma <= 0 as a no-op (gamma = 1)", () => {
    const image = createImageData(1, 1, [77, 77, 77, 255]);
    expect(Array.from(adjustGamma(image, { gamma: 0 }).data)).toEqual([77, 77, 77, 255]);
    expect(Array.from(adjustGamma(image, { gamma: -5 }).data)).toEqual([77, 77, 77, 255]);
  });
});
