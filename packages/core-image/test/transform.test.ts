import { describe, expect, it } from "vitest";
import { crop, resize, rotate } from "../src/filters/transform.js";
import { createImageData, getPixel, setPixel } from "../src/pixel.js";

describe("crop", () => {
  it("defaults to a full-image no-op copy", () => {
    const input = createImageData(3, 2, [10, 20, 30, 255]);
    setPixel(input, 1, 1, [1, 2, 3, 4]);

    const output = crop(input, {});

    expect(output.width).toBe(3);
    expect(output.height).toBe(2);
    expect(getPixel(output, 1, 1)).toEqual([1, 2, 3, 4]);
    expect(getPixel(output, 0, 0)).toEqual([10, 20, 30, 255]);
  });

  it("does not mutate the input image", () => {
    const input = createImageData(2, 2, [5, 5, 5, 255]);
    const output = crop(input, {});
    setPixel(output, 0, 0, [0, 0, 0, 0]);

    expect(getPixel(input, 0, 0)).toEqual([5, 5, 5, 255]);
  });

  it("extracts the requested rectangle", () => {
    const input = createImageData(4, 4);
    setPixel(input, 2, 1, [9, 9, 9, 255]);

    const output = crop(input, { x: 2, y: 1, width: 1, height: 1 });

    expect(output.width).toBe(1);
    expect(output.height).toBe(1);
    expect(getPixel(output, 0, 0)).toEqual([9, 9, 9, 255]);
  });

  it("clamps negative x/y to 0", () => {
    const input = createImageData(4, 4, [7, 7, 7, 255]);

    const output = crop(input, { x: -5, y: -3, width: 2, height: 2 });

    expect(output.width).toBe(2);
    expect(output.height).toBe(2);
  });

  it("clamps an out-of-range rectangle to the image bounds", () => {
    const input = createImageData(4, 4);

    const output = crop(input, { x: 2, y: 2, width: 10, height: 10 });

    expect(output.width).toBe(2);
    expect(output.height).toBe(2);
  });
});

describe("resize", () => {
  it("defaults to 50% scale of the input's own dimensions", () => {
    const input = createImageData(6, 4);
    const output = resize(input, {});

    expect(output.width).toBe(3);
    expect(output.height).toBe(2);
  });

  it("nearest samples the nearest source pixel", () => {
    const input = createImageData(2, 2);
    setPixel(input, 0, 0, [1, 0, 0, 255]);
    setPixel(input, 1, 0, [2, 0, 0, 255]);
    setPixel(input, 0, 1, [3, 0, 0, 255]);
    setPixel(input, 1, 1, [4, 0, 0, 255]);

    const output = resize(input, { width: 1, height: 1, method: "nearest" });

    expect(output.width).toBe(1);
    expect(output.height).toBe(1);
    // (0.5,0.5) dst -> (1,1) src scaled up 2x -> bottom-right source pixel.
    expect(getPixel(output, 0, 0)).toEqual([4, 0, 0, 255]);
  });

  it("bilinear reproduces exact corner pixels when upsampling", () => {
    const input = createImageData(2, 2);
    setPixel(input, 0, 0, [10, 0, 0, 255]);
    setPixel(input, 1, 0, [20, 0, 0, 255]);
    setPixel(input, 0, 1, [30, 0, 0, 255]);
    setPixel(input, 1, 1, [40, 0, 0, 255]);

    const output = resize(input, { width: 4, height: 4, method: "bilinear" });

    expect(output.width).toBe(4);
    expect(output.height).toBe(4);
    expect(getPixel(output, 0, 0)).toEqual([10, 0, 0, 255]);
    expect(getPixel(output, 3, 0)).toEqual([20, 0, 0, 255]);
    expect(getPixel(output, 0, 3)).toEqual([30, 0, 0, 255]);
    expect(getPixel(output, 3, 3)).toEqual([40, 0, 0, 255]);
  });

  it("bilinear does not fade to black at the edges", () => {
    const input = createImageData(2, 1, [200, 200, 200, 255]);
    const output = resize(input, { width: 5, height: 1, method: "bilinear" });

    for (let x = 0; x < 5; x++) {
      const [r, g, b, a] = getPixel(output, x, 0);
      expect(r).toBeGreaterThan(190);
      expect(g).toBeGreaterThan(190);
      expect(b).toBeGreaterThan(190);
      expect(a).toBe(255);
    }
  });
});

describe("rotate", () => {
  it("defaults to a 90 degree rotation with a white background", () => {
    const input = createImageData(2, 1, [1, 2, 3, 255]);
    const output = rotate(input, {});

    expect(output.width).toBe(1);
    expect(output.height).toBe(2);
  });

  it("rotates a 2x1 image 90 degrees into a 1x2 column", () => {
    const input = createImageData(2, 1);
    setPixel(input, 0, 0, [1, 0, 0, 255]); // A (left)
    setPixel(input, 1, 0, [2, 0, 0, 255]); // B (right)

    const output = rotate(input, { degrees: 90 });

    expect(output.width).toBe(1);
    expect(output.height).toBe(2);
    expect(getPixel(output, 0, 0)).toEqual([1, 0, 0, 255]); // A ends up on top
    expect(getPixel(output, 0, 1)).toEqual([2, 0, 0, 255]); // B ends up on bottom
  });

  it("rotates the 4 corners of a 2x2 image 90 degrees", () => {
    const input = createImageData(2, 2);
    setPixel(input, 0, 0, [1, 0, 0, 255]); // TL
    setPixel(input, 1, 0, [2, 0, 0, 255]); // TR
    setPixel(input, 0, 1, [3, 0, 0, 255]); // BL
    setPixel(input, 1, 1, [4, 0, 0, 255]); // BR

    const output = rotate(input, { degrees: 90 });

    expect(output.width).toBe(2);
    expect(output.height).toBe(2);
    expect(getPixel(output, 0, 0)).toEqual([3, 0, 0, 255]); // BL -> top-left
    expect(getPixel(output, 1, 0)).toEqual([1, 0, 0, 255]); // TL -> top-right
    expect(getPixel(output, 0, 1)).toEqual([4, 0, 0, 255]); // BR -> bottom-left
    expect(getPixel(output, 1, 1)).toEqual([2, 0, 0, 255]); // TR -> bottom-right
  });

  it("rotates a 2x2 image 180 degrees by reflecting through the center", () => {
    const input = createImageData(2, 2);
    setPixel(input, 0, 0, [1, 0, 0, 255]); // TL
    setPixel(input, 1, 0, [2, 0, 0, 255]); // TR
    setPixel(input, 0, 1, [3, 0, 0, 255]); // BL
    setPixel(input, 1, 1, [4, 0, 0, 255]); // BR

    const output = rotate(input, { degrees: 180 });

    expect(output.width).toBe(2);
    expect(output.height).toBe(2);
    expect(getPixel(output, 0, 0)).toEqual([4, 0, 0, 255]); // BR -> top-left
    expect(getPixel(output, 1, 0)).toEqual([3, 0, 0, 255]); // BL -> top-right
    expect(getPixel(output, 0, 1)).toEqual([2, 0, 0, 255]); // TR -> bottom-left
    expect(getPixel(output, 1, 1)).toEqual([1, 0, 0, 255]); // TL -> bottom-right
  });

  it("fills pixels outside the source with backgroundColor", () => {
    const input = createImageData(2, 2, [0, 0, 0, 255]);
    const output = rotate(input, { degrees: 45, backgroundColor: [1, 2, 3, 4] });

    // The corners of the (larger) bounding box fall outside the rotated
    // source square, so they should be the background color.
    expect(getPixel(output, 0, 0)).toEqual([1, 2, 3, 4]);
  });

  it("grows the canvas bounding box for a 45 degree rotation", () => {
    const input = createImageData(10, 10);
    const output = rotate(input, { degrees: 45 });

    const expectedSize = Math.round(10 * Math.SQRT2);
    expect(output.width).toBe(expectedSize);
    expect(output.height).toBe(expectedSize);
    expect(output.width).toBeGreaterThan(input.width);
    expect(output.height).toBeGreaterThan(input.height);
  });
});
