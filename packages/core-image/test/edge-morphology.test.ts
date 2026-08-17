import { describe, expect, it } from "vitest";
import { createImageData, getPixel, setPixel } from "../src/pixel.js";
import {
  cannyEdgeDetect,
  dilate,
  erode,
  halftone,
  morphClose,
  morphOpen,
  sobelEdgeDetect,
} from "../src/filters/edge-morphology.js";

function makeVerticalEdgeImage(width: number, height: number): ImageData {
  const image = createImageData(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = x < width / 2 ? 0 : 255;
      setPixel(image, x, y, [v, v, v, 255]);
    }
  }
  return image;
}

describe("erode", () => {
  it("removes an isolated foreground pixel", () => {
    const image = createImageData(5, 5, [255, 255, 255, 255]);
    setPixel(image, 2, 2, [0, 0, 0, 255]);

    const output = erode(image, { radius: 1 });

    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        expect(getPixel(output, x, y)[0]).toBe(255);
      }
    }
  });

  it("keeps a foreground pixel whose full neighborhood is foreground", () => {
    const image = createImageData(5, 5, [0, 0, 0, 255]);

    const output = erode(image, { radius: 1 });

    expect(getPixel(output, 2, 2)).toEqual([0, 0, 0, 255]);
  });

  it("defaults radius to 1 when options is empty", () => {
    const image = createImageData(5, 5, [255, 255, 255, 255]);
    setPixel(image, 2, 2, [0, 0, 0, 255]);

    const output = erode(image, {});

    expect(getPixel(output, 2, 2)[0]).toBe(255);
  });
});

describe("dilate", () => {
  it("fills an isolated background pixel", () => {
    const image = createImageData(5, 5, [0, 0, 0, 255]);
    setPixel(image, 2, 2, [255, 255, 255, 255]);

    const output = dilate(image, { radius: 1 });

    expect(getPixel(output, 2, 2)).toEqual([0, 0, 0, 255]);
  });

  it("leaves background alone when no foreground is nearby", () => {
    const image = createImageData(5, 5, [255, 255, 255, 255]);

    const output = dilate(image, { radius: 1 });

    expect(getPixel(output, 2, 2)[0]).toBe(255);
  });
});

describe("morphOpen / morphClose", () => {
  it("morphOpen removes a small isolated foreground speck", () => {
    const image = createImageData(5, 5, [255, 255, 255, 255]);
    setPixel(image, 2, 2, [0, 0, 0, 255]);

    const output = morphOpen(image, { radius: 1 });

    expect(getPixel(output, 2, 2)[0]).toBe(255);
  });

  it("morphClose fills a small isolated background gap", () => {
    const image = createImageData(5, 5, [0, 0, 0, 255]);
    setPixel(image, 2, 2, [255, 255, 255, 255]);

    const output = morphClose(image, { radius: 1 });

    expect(getPixel(output, 2, 2)[0]).toBe(0);
  });
});

describe("sobelEdgeDetect", () => {
  it("shows a strong response near a hard vertical edge and none far from it", () => {
    const image = makeVerticalEdgeImage(8, 8);

    const output = sobelEdgeDetect(image, {});

    const boundaryMagnitude = getPixel(output, 4, 4)[0];
    const flatMagnitude = getPixel(output, 0, 4)[0];

    expect(boundaryMagnitude).toBeGreaterThan(100);
    expect(flatMagnitude).toBeLessThan(10);
    expect(boundaryMagnitude).toBeGreaterThan(flatMagnitude);
  });

  it("produces a pure black/white output when threshold is given", () => {
    const image = makeVerticalEdgeImage(8, 8);

    const output = sobelEdgeDetect(image, { threshold: 50 });

    for (let i = 0; i < output.data.length; i += 4) {
      const v = output.data[i];
      expect(v === 0 || v === 255).toBe(true);
    }
    // The boundary column should be flagged as an edge.
    expect(getPixel(output, 4, 4)[0]).toBe(255);
  });

  it("preserves input alpha", () => {
    const image = createImageData(2, 2, [0, 0, 0, 137]);

    const output = sobelEdgeDetect(image, {});

    expect(getPixel(output, 0, 0)[3]).toBe(137);
  });
});

describe("cannyEdgeDetect", () => {
  it("runs without throwing and produces a pure black/white output", () => {
    const image = makeVerticalEdgeImage(12, 12);

    let output: ImageData | undefined;
    expect(() => {
      output = cannyEdgeDetect(image, {});
    }).not.toThrow();

    expect(output).toBeDefined();
    const data = output!.data;
    for (let i = 0; i < data.length; i += 4) {
      const v = data[i];
      expect(v === 0 || v === 255).toBe(true);
    }
  });

  it("flags the vertical edge boundary as an edge somewhere in the image", () => {
    const image = makeVerticalEdgeImage(12, 12);

    const output = cannyEdgeDetect(image, { lowThreshold: 20, highThreshold: 40 });

    let foundEdge = false;
    for (let i = 0; i < output.data.length; i += 4) {
      if (output.data[i] === 255) {
        foundEdge = true;
        break;
      }
    }
    expect(foundEdge).toBe(true);
  });

  it("respects custom options without throwing", () => {
    const image = makeVerticalEdgeImage(10, 10);

    expect(() =>
      cannyEdgeDetect(image, { gaussianSigma: 0.8, lowThreshold: 30, highThreshold: 90 }),
    ).not.toThrow();
  });

  it("thresholds on the same 0-255 magnitude scale sobelEdgeDetect uses", () => {
    // The raw (unclamped) Sobel gradient magnitude for an 8-bit hard edge can
    // reach ~1442, well above the documented 0-255 scale. A threshold above
    // 255 must therefore suppress every edge, the same way it would for
    // sobelEdgeDetect's clamped magnitude map.
    const image = makeVerticalEdgeImage(12, 12);

    const output = cannyEdgeDetect(image, { lowThreshold: 1000, highThreshold: 1000 });

    for (let i = 0; i < output.data.length; i += 4) {
      expect(output.data[i]).toBe(0);
    }
  });
});

describe("halftone", () => {
  it("produces an all-white output for an all-white input", () => {
    const image = createImageData(16, 16, [255, 255, 255, 255]);

    const output = halftone(image, { cellSize: 8 });

    for (let i = 0; i < output.data.length; i += 4) {
      expect(output.data[i]).toBe(255);
    }
  });

  it("produces a mostly-black output with visible dot structure for an all-black input", () => {
    const image = createImageData(16, 16, [0, 0, 0, 255]);

    const output = halftone(image, { cellSize: 8 });

    let blackCount = 0;
    for (let i = 0; i < output.data.length; i += 4) {
      if (output.data[i] === 0) blackCount++;
    }
    const totalPixels = 16 * 16;

    // Max darkness produces a circle inscribed in the cell square, so most
    // but not literally all of the area is covered.
    expect(blackCount).toBeGreaterThan(totalPixels * 0.6);
    expect(blackCount).toBeLessThan(totalPixels);

    // Cell center is well inside the dot.
    expect(getPixel(output, 4, 4)[0]).toBe(0);
    // Cell corner sits outside the inscribed circle.
    expect(getPixel(output, 0, 0)[0]).toBe(255);
  });

  it("defaults to sensible options when called with {}", () => {
    const image = createImageData(20, 20, [128, 128, 128, 255]);

    expect(() => halftone(image, {})).not.toThrow();
    const output = halftone(image, {});
    expect(output.width).toBe(20);
    expect(output.height).toBe(20);
  });

  it("guards a non-positive cellSize instead of dividing by zero", () => {
    const image = createImageData(10, 10, [128, 128, 128, 255]);

    expect(() => halftone(image, { cellSize: 0 })).not.toThrow();
    expect(() => halftone(image, { cellSize: -4 })).not.toThrow();
    for (const px of halftone(image, { cellSize: 0 }).data) {
      expect(Number.isFinite(px)).toBe(true);
    }
  });

  it("supports the line shape", () => {
    const image = createImageData(16, 16, [0, 0, 0, 255]);

    const output = halftone(image, { cellSize: 8, shape: "line" });

    // Somewhere in the image a black band should exist for full darkness.
    let blackCount = 0;
    for (let i = 0; i < output.data.length; i += 4) {
      if (output.data[i] === 0) blackCount++;
    }
    expect(blackCount).toBeGreaterThan(0);
  });

  it("does not mutate the input image", () => {
    const image = createImageData(16, 16, [0, 0, 0, 255]);
    const originalCopy = Uint8ClampedArray.from(image.data);

    halftone(image, { cellSize: 8 });

    expect(Array.from(image.data)).toEqual(Array.from(originalCopy));
  });
});
