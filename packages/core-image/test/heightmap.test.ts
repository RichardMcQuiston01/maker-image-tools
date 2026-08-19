import { describe, expect, it } from "vitest";
import { createImageData, setPixel } from "../src/pixel.js";
import { computeHeightGrid, imageToHeightmapStl } from "../src/heightmap.js";

function imageFromGrid(pixels: [number, number, number, number][][]): ImageData {
  const height = pixels.length;
  const width = pixels[0]?.length ?? 0;
  const image = createImageData(width, height);
  pixels.forEach((row, y) => {
    row.forEach((rgba, x) => setPixel(image, x, y, rgba));
  });
  return image;
}

function countFacets(stl: string): number {
  return (stl.match(/facet normal/g) ?? []).length;
}

// Hand-computed 2x2 image mixing black/white/gray/red so luminance differs per pixel.
// Luminance (0.2126*R + 0.7152*G + 0.0722*B):
//   (0,0) black          -> 0
//   (1,0) white          -> 255
//   (0,1) mid gray (128) -> 128
//   (1,1) red (255,0,0)  -> 54.213
const MIXED_IMAGE = imageFromGrid([
  [
    [0, 0, 0, 255],
    [255, 255, 255, 255],
  ],
  [
    [128, 128, 128, 255],
    [255, 0, 0, 255],
  ],
]);

describe("computeHeightGrid", () => {
  it("applies default maxHeight=5, baseHeight=1, pixelSize=0.5, invert=false when options are omitted", () => {
    const grid = computeHeightGrid(MIXED_IMAGE);
    expect(grid.width).toBe(2);
    expect(grid.height).toBe(2);
    // value = baseHeight + (luminance/255) * maxHeight
    expect(grid.values[0]).toBeCloseTo(1 + (0 / 255) * 5); // (0,0) -> 1
    expect(grid.values[1]).toBeCloseTo(1 + (255 / 255) * 5); // (1,0) -> 6
    expect(grid.values[2]).toBeCloseTo(1 + (128 / 255) * 5); // (0,1) -> 3.5098...
    expect(grid.values[3]).toBeCloseTo(1 + (54.213 / 255) * 5); // (1,1) -> 2.063
  });

  it("respects explicit maxHeight/baseHeight/pixelSize", () => {
    const grid = computeHeightGrid(MIXED_IMAGE, { maxHeight: 10, baseHeight: 2 });
    expect(grid.values[0]).toBeCloseTo(2 + (0 / 255) * 10); // 2
    expect(grid.values[1]).toBeCloseTo(2 + (255 / 255) * 10); // 12
  });

  it("invert: true makes the darkest pixel the tallest", () => {
    const grid = computeHeightGrid(MIXED_IMAGE, { invert: true, maxHeight: 5, baseHeight: 1 });
    // black (0,0) was luminance 0 -> now tallest (baseHeight + maxHeight = 6)
    expect(grid.values[0]).toBeCloseTo(6);
    // white (1,0) was luminance 255 -> now shortest (baseHeight = 1)
    expect(grid.values[1]).toBeCloseTo(1);
  });

  it("baseHeight: 0 offsets the top surface to start at 0", () => {
    const grid = computeHeightGrid(MIXED_IMAGE, { baseHeight: 0, maxHeight: 5 });
    expect(grid.values[0]).toBeCloseTo(0);
    expect(grid.values[1]).toBeCloseTo(5);
  });

  it("downsamples by averaging luminance over NxN blocks", () => {
    // 4x4 image split into 2x2 blocks; top-left block is uniform black, others uniform white.
    const rows: [number, number, number, number][][] = [];
    for (let y = 0; y < 4; y++) {
      const row: [number, number, number, number][] = [];
      for (let x = 0; x < 4; x++) {
        const black = x < 2 && y < 2;
        row.push(black ? [0, 0, 0, 255] : [255, 255, 255, 255]);
      }
      rows.push(row);
    }
    const image = imageFromGrid(rows);
    const grid = computeHeightGrid(image, { downsample: 2, maxHeight: 5, baseHeight: 1 });
    expect(grid.width).toBe(2);
    expect(grid.height).toBe(2);
    expect(grid.values[0]).toBeCloseTo(1); // top-left block: all black -> baseHeight
    expect(grid.values[1]).toBeCloseTo(6); // top-right block: all white -> baseHeight+maxHeight
    expect(grid.values[2]).toBeCloseTo(6); // bottom-left block: all white
    expect(grid.values[3]).toBeCloseTo(6); // bottom-right block: all white
  });

  it("clamps block reads at the image edge when dimensions aren't evenly divisible by downsample", () => {
    // 3x1 image, downsample 2: first block averages 2 pixels, second block only 1 (clamped).
    const image = imageFromGrid([
      [
        [0, 0, 0, 255],
        [0, 0, 0, 255],
        [255, 255, 255, 255],
      ],
    ]);
    const grid = computeHeightGrid(image, { downsample: 2, maxHeight: 5, baseHeight: 0 });
    expect(grid.width).toBe(2);
    expect(grid.values[0]).toBeCloseTo(0); // both pixels black
    expect(grid.values[1]).toBeCloseTo(5); // single white pixel, not diluted by out-of-bounds reads
  });

  it("downsample larger than the image dimensions still produces a single averaged block", () => {
    const grid = computeHeightGrid(MIXED_IMAGE, { downsample: 100, maxHeight: 5, baseHeight: 1 });
    expect(grid.width).toBe(1);
    expect(grid.height).toBe(1);
    const avgLuminance = (0 + 255 + 128 + 54.213) / 4;
    expect(grid.values[0]).toBeCloseTo(1 + (avgLuminance / 255) * 5, 1);
  });

  it("a uniform all-white image produces a flat grid at baseHeight + maxHeight", () => {
    const image = imageFromGrid([
      [
        [255, 255, 255, 255],
        [255, 255, 255, 255],
      ],
      [
        [255, 255, 255, 255],
        [255, 255, 255, 255],
      ],
    ]);
    const grid = computeHeightGrid(image, { maxHeight: 5, baseHeight: 1 });
    for (const value of grid.values) {
      expect(value).toBeCloseTo(6);
    }
  });

  it("a uniform all-black image produces a flat grid at baseHeight", () => {
    const image = imageFromGrid([
      [
        [0, 0, 0, 255],
        [0, 0, 0, 255],
      ],
      [
        [0, 0, 0, 255],
        [0, 0, 0, 255],
      ],
    ]);
    const grid = computeHeightGrid(image, { maxHeight: 5, baseHeight: 1 });
    for (const value of grid.values) {
      expect(value).toBeCloseTo(1);
    }
  });

  it("handles a 1x1 image without NaN", () => {
    const image = createImageData(1, 1, [100, 150, 200, 255]);
    const grid = computeHeightGrid(image);
    expect(grid.width).toBe(1);
    expect(grid.height).toBe(1);
    expect(grid.values.length).toBe(1);
    expect(Number.isNaN(grid.values[0])).toBe(false);
  });
});

describe("imageToHeightmapStl", () => {
  it("produces well-formed ASCII STL bracketed by solid/endsolid", () => {
    const stl = imageToHeightmapStl(MIXED_IMAGE);
    expect(stl.startsWith("solid heightmap")).toBe(true);
    expect(stl.trimEnd().endsWith("endsolid heightmap")).toBe(true);
  });

  it("emits the expected facet count for a 2x2 grid with baseHeight > 0 (top + bottom + 4 walls)", () => {
    const stl = imageToHeightmapStl(MIXED_IMAGE, { baseHeight: 1 });
    // top: 2*(2-1)*(2-1) = 2, bottom: 2, sides: 4*(2-1) + 4*(2-1) = 8 -> total 12
    expect(countFacets(stl)).toBe(12);
  });

  it("baseHeight: 0 produces an open-bottomed shell (top surface only, no bottom/side walls)", () => {
    const stl = imageToHeightmapStl(MIXED_IMAGE, { baseHeight: 0 });
    // top only: 2*(2-1)*(2-1) = 2
    expect(countFacets(stl)).toBe(2);
  });

  it("scales X/Y coordinates by pixelSize (and by downsample when set)", () => {
    const stl = imageToHeightmapStl(MIXED_IMAGE, { pixelSize: 2, baseHeight: 0 });
    // grid is 2x2 -> far corner should be at x=1*2=2, y=1*2=2
    expect(stl).toContain("vertex 2 2 ");
  });

  it("does not throw or produce NaN for a 1x1 image", () => {
    const image = createImageData(1, 1, [100, 150, 200, 255]);
    const stl = imageToHeightmapStl(image);
    expect(stl.startsWith("solid")).toBe(true);
    expect(stl.trimEnd().endsWith("endsolid heightmap")).toBe(true);
    expect(stl).not.toContain("NaN");
  });

  it("invert: true makes the darkest pixel the tallest point in the mesh", () => {
    const stl = imageToHeightmapStl(MIXED_IMAGE, { invert: true, maxHeight: 5, baseHeight: 1 });
    expect(stl).not.toContain("NaN");
    // black pixel (0,0) is invert-tallest: baseHeight + maxHeight = 6
    expect(stl).toContain("vertex 0 0 6");
  });

  it("downsample larger than image dimensions still produces a valid single-cell mesh", () => {
    const stl = imageToHeightmapStl(MIXED_IMAGE, { downsample: 100 });
    expect(stl.startsWith("solid")).toBe(true);
    expect(stl.trimEnd().endsWith("endsolid heightmap")).toBe(true);
    expect(stl).not.toContain("NaN");
  });

  it("a uniform image produces a flat top surface (all top Z equal, non-NaN)", () => {
    const image = imageFromGrid([
      [
        [255, 255, 255, 255],
        [255, 255, 255, 255],
      ],
      [
        [255, 255, 255, 255],
        [255, 255, 255, 255],
      ],
    ]);
    const stl = imageToHeightmapStl(image, { maxHeight: 5, baseHeight: 0 });
    expect(stl).not.toContain("NaN");
    // all-white, baseHeight 0 -> every top vertex sits at Z = maxHeight = 5
    const topVertexZs = [...stl.matchAll(/vertex \S+ \S+ (\S+)/g)].map((m) => m[1]);
    expect(topVertexZs.every((z) => z === "5")).toBe(true);
  });
});
