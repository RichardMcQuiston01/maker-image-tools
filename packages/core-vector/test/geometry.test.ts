import { describe, expect, it } from "vitest";
import { boundingBoxOfPath, boundingBoxOfPoints, distance, mergeBBox } from "../src/geometry.js";
import type { VectorPath } from "../src/types.js";

describe("distance", () => {
  it("computes euclidean distance between two points", () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
});

describe("boundingBoxOfPoints", () => {
  it("returns a zero bbox for an empty list", () => {
    expect(boundingBoxOfPoints([])).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it("computes the bbox spanning all points", () => {
    const bbox = boundingBoxOfPoints([
      { x: 1, y: 5 },
      { x: 4, y: 1 },
      { x: -2, y: 3 },
    ]);
    expect(bbox).toEqual({ x: -2, y: 1, width: 6, height: 4 });
  });
});

describe("boundingBoxOfPath", () => {
  it("uses endpoint (not control) points", () => {
    const path: VectorPath = {
      id: "p1",
      commands: [
        { type: "M", point: { x: 0, y: 0 } },
        {
          type: "C",
          control1: { x: -100, y: -100 },
          control2: { x: 100, y: 100 },
          point: { x: 10, y: 10 },
        },
        { type: "Z" },
      ],
    };
    expect(boundingBoxOfPath(path)).toEqual({ x: 0, y: 0, width: 10, height: 10 });
  });
});

describe("mergeBBox", () => {
  it("returns the union of two bounding boxes", () => {
    const a = { x: 0, y: 0, width: 2, height: 2 };
    const b = { x: 1, y: 1, width: 4, height: 1 };
    expect(mergeBBox(a, b)).toEqual({ x: 0, y: 0, width: 5, height: 2 });
  });
});
