import { describe, expect, it } from "vitest";
import { booleanOp, intersect, subtract, union, xor } from "../src/boolean-ops.js";
import { boundingBoxOfPath, mergeBBox } from "../src/geometry.js";
import type { BBox, VectorPath } from "../src/types.js";

function square(id: string, x: number, y: number, size: number): VectorPath {
  return {
    id,
    commands: [
      { type: "M", point: { x, y } },
      { type: "L", point: { x: x + size, y } },
      { type: "L", point: { x: x + size, y: y + size } },
      { type: "L", point: { x, y: y + size } },
      { type: "Z" },
    ],
  };
}

function bboxOfPaths(paths: VectorPath[]): BBox | null {
  if (paths.length === 0) return null;
  const first = paths[0];
  if (!first) return null;
  let bbox = boundingBoxOfPath(first);
  for (let i = 1; i < paths.length; i++) {
    const p = paths[i];
    if (p) bbox = mergeBBox(bbox, boundingBoxOfPath(p));
  }
  return bbox;
}

// A: 0,0 -> 10,10 ; B: 5,5 -> 15,15 ; overlap: 5,5 -> 10,10
const a = square("a", 0, 0, 10);
const b = square("b", 5, 5, 10);

describe("boolean ops on overlapping squares", () => {
  it("intersect's bounding box matches the geometric overlap region within raster tolerance", () => {
    const result = booleanOp("intersect", a, b, { pixelsPerUnit: 8 });
    expect(result.length).toBeGreaterThan(0);
    const bbox = bboxOfPaths(result);
    expect(bbox).not.toBeNull();
    if (!bbox) return;
    expect(Math.abs(bbox.x - 5)).toBeLessThan(1);
    expect(Math.abs(bbox.y - 5)).toBeLessThan(1);
    expect(Math.abs(bbox.x + bbox.width - 10)).toBeLessThan(1);
    expect(Math.abs(bbox.y + bbox.height - 10)).toBeLessThan(1);
  });

  it("union's bounding box covers both squares", () => {
    const result = union(a, b);
    const bbox = bboxOfPaths(result);
    expect(bbox).not.toBeNull();
    if (!bbox) return;
    expect(Math.abs(bbox.x - 0)).toBeLessThan(1);
    expect(Math.abs(bbox.y - 0)).toBeLessThan(1);
    expect(Math.abs(bbox.x + bbox.width - 15)).toBeLessThan(1);
    expect(Math.abs(bbox.y + bbox.height - 15)).toBeLessThan(1);
  });

  it("subtract(a, b) is non-empty when a extends beyond b", () => {
    const result = subtract(a, b);
    expect(result.length).toBeGreaterThan(0);
    const bbox = bboxOfPaths(result);
    expect(bbox).not.toBeNull();
    // The remaining L-shaped region still touches a's top-left corner.
    if (bbox) {
      expect(Math.abs(bbox.x - 0)).toBeLessThan(1);
      expect(Math.abs(bbox.y - 0)).toBeLessThan(1);
    }
  });

  it("subtract(b, a) is non-empty when b extends beyond a", () => {
    const result = subtract(b, a);
    expect(result.length).toBeGreaterThan(0);
  });

  it("xor of two identical squares returns an empty or negligible-area result", () => {
    const result = xor(a, a);
    if (result.length === 0) {
      expect(result).toEqual([]);
    } else {
      for (const p of result) {
        const bbox = boundingBoxOfPath(p);
        expect(bbox.width * bbox.height).toBeLessThan(1);
      }
    }
  });
});

describe("boolean ops on non-overlapping squares", () => {
  const c = square("c", 100, 100, 10);

  it("intersect returns an empty array", () => {
    expect(intersect(a, c)).toEqual([]);
  });

  it("union covers both disjoint squares as separate components", () => {
    const result = union(a, c);
    expect(result.length).toBeGreaterThanOrEqual(1);
    const bbox = bboxOfPaths(result);
    expect(bbox).not.toBeNull();
    if (bbox) {
      expect(Math.abs(bbox.x + bbox.width - 110)).toBeLessThan(1);
    }
  });

  it("subtract returns a unchanged (within raster tolerance) since b doesn't overlap", () => {
    const result = subtract(a, c);
    const bbox = bboxOfPaths(result);
    expect(bbox).not.toBeNull();
    if (bbox) {
      expect(Math.abs(bbox.width - 10)).toBeLessThan(1);
      expect(Math.abs(bbox.height - 10)).toBeLessThan(1);
    }
  });
});
