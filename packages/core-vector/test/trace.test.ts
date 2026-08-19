import { describe, expect, it } from "vitest";
import { boundingBoxOfPath } from "../src/geometry.js";
import { traceImage } from "../src/trace.js";
import type { VectorPath } from "../src/types.js";

// jsdom (unlike a real browser) doesn't implement the ImageData constructor. This is a
// test-environment-only polyfill so trace.ts's real, standard `ImageData` usage can be
// unit tested here without a full Canvas 2D stack.
if (typeof globalThis.ImageData === "undefined") {
  class ImageDataPolyfill {
    data: Uint8ClampedArray;
    width: number;
    height: number;

    constructor(dataOrWidth: Uint8ClampedArray | number, widthOrHeight: number, height?: number) {
      if (dataOrWidth instanceof Uint8ClampedArray) {
        this.data = dataOrWidth;
        this.width = widthOrHeight;
        this.height = height ?? 0;
      } else {
        this.width = dataOrWidth;
        this.height = widthOrHeight;
        this.data = new Uint8ClampedArray(this.width * this.height * 4);
      }
    }
  }

  globalThis.ImageData = ImageDataPolyfill as unknown as typeof ImageData;
}

/** Builds an ImageData filled white, with `isForeground` pixels painted black. */
function makeImage(
  width: number,
  height: number,
  isForeground: (x: number, y: number) => boolean,
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const value = isForeground(x, y) ? 0 : 255;
      data[i] = value;
      data[i + 1] = value;
      data[i + 2] = value;
      data[i + 3] = 255;
    }
  }
  return new ImageData(data, width, height);
}

function inRect(x: number, y: number, rx: number, ry: number, rw: number, rh: number): boolean {
  return x >= rx && x < rx + rw && y >= ry && y < ry + rh;
}

describe("traceImage", () => {
  it("traces a single filled square to one VectorPath with a matching bounding box", () => {
    const image = makeImage(20, 20, (x, y) => inRect(x, y, 5, 5, 8, 8));

    const paths = traceImage(image);

    expect(paths.length).toBe(1);
    const bbox = boundingBoxOfPath(paths[0] as VectorPath);
    expect(bbox.x).toBeGreaterThanOrEqual(4);
    expect(bbox.x).toBeLessThanOrEqual(6);
    expect(bbox.y).toBeGreaterThanOrEqual(4);
    expect(bbox.y).toBeLessThanOrEqual(6);
    expect(bbox.width).toBeGreaterThanOrEqual(7);
    expect(bbox.width).toBeLessThanOrEqual(9);
    expect(bbox.height).toBeGreaterThanOrEqual(7);
    expect(bbox.height).toBeLessThanOrEqual(9);
  });

  it("traces two separate squares into two separate VectorPaths", () => {
    const image = makeImage(
      30,
      20,
      (x, y) => inRect(x, y, 2, 2, 8, 8) || inRect(x, y, 20, 2, 8, 8),
    );

    const paths = traceImage(image);

    expect(paths.length).toBe(2);
    const bboxes = paths.map((p) => boundingBoxOfPath(p)).sort((a, b) => a.x - b.x);
    expect(bboxes[0]?.x).toBeLessThan(10);
    expect(bboxes[1]?.x).toBeGreaterThan(15);
  });

  it("discards a component smaller than minRegionSize (default 2)", () => {
    const image = makeImage(16, 16, (x, y) => x === 8 && y === 8);

    const paths = traceImage(image);

    expect(paths).toEqual([]);
  });

  it("simplifies a large rectangle's boundary to far fewer points than its pixel perimeter", () => {
    const width = 40;
    const height = 30;
    const image = makeImage(width, height, (x, y) => inRect(x, y, 3, 3, 34, 24));

    const paths = traceImage(image);

    expect(paths.length).toBe(1);
    const commands = (paths[0] as VectorPath).commands;
    // An unsimplified Moore trace of this rectangle would visit roughly 2*(w+h) boundary
    // pixels; Douglas-Peucker at the default tolerance should collapse it to a small handful
    // of corner points (M + a few L + Z).
    const unsimplifiedPixelPerimeter = 2 * (34 + 24);
    expect(commands.length).toBeLessThan(unsimplifiedPixelPerimeter / 4);
    expect(commands.length).toBeGreaterThanOrEqual(4);
  });

  it("returns an empty array for an all-white image", () => {
    const image = makeImage(10, 10, () => false);

    expect(traceImage(image)).toEqual([]);
  });

  it("returns paths whose commands always start with M and end with Z", () => {
    const image = makeImage(
      30,
      20,
      (x, y) => inRect(x, y, 2, 2, 8, 8) || inRect(x, y, 20, 2, 8, 8),
    );

    const paths = traceImage(image);

    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(path.commands[0]?.type).toBe("M");
      expect(path.commands[path.commands.length - 1]?.type).toBe("Z");
    }
  });
});
