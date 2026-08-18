import { describe, expect, it } from "vitest";
import { applyHomography, computeHomography, type PointCorrespondence } from "../src/homography.js";
import type { Point } from "@maker/core-vector";

// Known simple transform: target = 2*source + (10, 5). This is affine, and
// every affine transform is realizable as a homography.
function knownTransform(p: Point): Point {
  return { x: 2 * p.x + 10, y: 2 * p.y + 5 };
}

const squareCorners: Point[] = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

function correspondencesFor(points: Point[]): PointCorrespondence[] {
  return points.map((source) => ({ source, target: knownTransform(source) }));
}

describe("computeHomography", () => {
  it("throws when given fewer than 4 correspondences", () => {
    const correspondences = correspondencesFor(squareCorners.slice(0, 3));
    expect(() => computeHomography(correspondences)).toThrow(
      /at least 4 point correspondences/,
    );
  });

  it("recovers a known scale+translate transform from its 4 corner correspondences", () => {
    const correspondences = correspondencesFor(squareCorners);
    const matrix = computeHomography(correspondences);

    for (const { source, target } of correspondences) {
      const result = applyHomography(matrix, source);
      expect(result.x).toBeCloseTo(target.x, 6);
      expect(result.y).toBeCloseTo(target.y, 6);
    }
  });

  it("correctly maps a point outside the original correspondence set (the square's center)", () => {
    const correspondences = correspondencesFor(squareCorners);
    const matrix = computeHomography(correspondences);

    const center: Point = { x: 5, y: 5 };
    const expected = knownTransform(center);
    const result = applyHomography(matrix, center);

    expect(result.x).toBeCloseTo(expected.x, 6);
    expect(result.y).toBeCloseTo(expected.y, 6);
  });

  it("still works with exactly 5 correspondences (one more than the minimum)", () => {
    const points = [...squareCorners, { x: 5, y: 5 }];
    const correspondences = correspondencesFor(points);
    const matrix = computeHomography(correspondences);

    for (const { source, target } of correspondences) {
      const result = applyHomography(matrix, source);
      expect(result.x).toBeCloseTo(target.x, 6);
      expect(result.y).toBeCloseTo(target.y, 6);
    }
  });
});

describe("applyHomography", () => {
  it("applies a simple identity-like matrix correctly", () => {
    const identity = { m: [1, 0, 0, 0, 1, 0, 0, 0, 1] };
    const result = applyHomography(identity, { x: 3, y: 7 });
    expect(result).toEqual({ x: 3, y: 7 });
  });
});
