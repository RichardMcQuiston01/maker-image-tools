import { describe, expect, it } from "vitest";
import { cloneImageData, createImageData, getPixel, setPixel } from "../src/pixel.js";

describe("pixel helpers", () => {
  it("createImageData fills every pixel with the given RGBA", () => {
    const image = createImageData(2, 2, [1, 2, 3, 4]);
    expect(image.width).toBe(2);
    expect(image.height).toBe(2);
    expect(Array.from(image.data)).toEqual([1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4]);
  });

  it("createImageData defaults to transparent black", () => {
    const image = createImageData(1, 1);
    expect(Array.from(image.data)).toEqual([0, 0, 0, 0]);
  });

  it("cloneImageData produces an independent copy", () => {
    const original = createImageData(1, 1, [10, 20, 30, 255]);
    const clone = cloneImageData(original);

    setPixel(clone, 0, 0, [0, 0, 0, 0]);

    expect(getPixel(original, 0, 0)).toEqual([10, 20, 30, 255]);
    expect(getPixel(clone, 0, 0)).toEqual([0, 0, 0, 0]);
  });

  it("getPixel/setPixel address pixels by x,y", () => {
    const image = createImageData(2, 1);
    setPixel(image, 1, 0, [9, 8, 7, 6]);

    expect(getPixel(image, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(getPixel(image, 1, 0)).toEqual([9, 8, 7, 6]);
  });
});
