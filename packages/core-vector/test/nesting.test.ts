import { describe, expect, it } from "vitest";
import { nestParts } from "../src/nesting.js";
import type { VectorPath } from "../src/types.js";

function rectPath(id: string, width: number, height: number): VectorPath {
  return {
    id,
    commands: [
      { type: "M", point: { x: 0, y: 0 } },
      { type: "L", point: { x: width, y: 0 } },
      { type: "L", point: { x: width, y: height } },
      { type: "L", point: { x: 0, y: height } },
      { type: "Z" },
    ],
  };
}

function rotatedBBox(
  width: number,
  height: number,
  rotationDeg: number,
): { width: number; height: number } {
  // Rectangle rotated about its own center; for multiples of 90 degrees
  // the bbox just swaps width/height (or stays the same).
  const normalized = ((rotationDeg % 360) + 360) % 360;
  if (normalized === 90 || normalized === 270) {
    return { width: height, height: width };
  }
  return { width, height };
}

function placementRect(
  placement: { path: VectorPath; x: number; y: number; rotation: number },
  originalWidth: number,
  originalHeight: number,
): { x: number; y: number; width: number; height: number } {
  const { width, height } = rotatedBBox(originalWidth, originalHeight, placement.rotation);
  return { x: placement.x, y: placement.y, width, height };
}

function overlaps(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

describe("nestParts", () => {
  it("returns one placement per part, in input order", () => {
    const parts = [rectPath("a", 10, 10), rectPath("b", 20, 5), rectPath("c", 5, 5)];
    const result = nestParts(parts, { binWidth: 100, binHeight: 100 });

    expect(result.placements.length).toBe(parts.length);
    expect(result.placements.map((p) => p.path.id)).toEqual(["a", "b", "c"]);
  });

  it("applies default spacing and rotations when omitted", () => {
    const parts = [rectPath("a", 10, 10)];
    const result = nestParts(parts, { binWidth: 100, binHeight: 100 });
    const placement = result.placements[0];
    expect(placement).toBeDefined();
    // Default spacing (2) means the first part is not placed flush at (0,0).
    expect(placement!.x).toBe(2);
    expect(placement!.y).toBe(2);
    expect([0, 90, 180, 270]).toContain(placement!.rotation);
  });

  it("places non-overlapping rectangles with no overlaps, all on one bin when they fit", () => {
    const dims: Array<[number, number]> = [
      [20, 20],
      [15, 30],
      [10, 10],
      [25, 5],
      [8, 8],
    ];
    const parts = dims.map(([w, h], i) => rectPath(`p${i}`, w!, h!));
    const result = nestParts(parts, { binWidth: 100, binHeight: 100, spacing: 2 });

    expect(result.placements.length).toBe(parts.length);

    const rects = result.placements.map((placement, i) => {
      const [w, h] = dims[i]!;
      return { binIndex: placement.binIndex, rect: placementRect(placement, w, h) };
    });

    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i]!;
        const b = rects[j]!;
        if (a.binIndex !== b.binIndex) continue;
        expect(overlaps(a.rect, b.rect)).toBe(false);
      }
    }
  });

  it("spills parts that don't fit into a second bin", () => {
    // Each part is nearly as big as the whole bin, so only one fits per bin.
    const parts = [rectPath("a", 90, 90), rectPath("b", 90, 90), rectPath("c", 90, 90)];
    const result = nestParts(parts, { binWidth: 100, binHeight: 100, spacing: 2 });

    const binIndices = result.placements.map((p) => p.binIndex);
    expect(new Set(binIndices).size).toBeGreaterThan(1);
    expect(result.binCount).toBe(Math.max(...binIndices) + 1);
    // First part always lands in bin 0.
    expect(binIndices[0]).toBe(0);
  });

  it("keeps the original, unmodified path on each placement", () => {
    const part = rectPath("x", 10, 10);
    const result = nestParts([part], { binWidth: 50, binHeight: 50 });
    expect(result.placements[0]!.path).toBe(part);
  });

  it("honors a custom rotations list", () => {
    const parts = [rectPath("a", 10, 30)];
    const result = nestParts(parts, { binWidth: 100, binHeight: 100, rotations: [0] });
    expect(result.placements[0]!.rotation).toBe(0);
  });
});
