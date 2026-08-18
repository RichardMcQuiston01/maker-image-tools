import { describe, expect, it } from "vitest";
import { kerfCompensate, offsetPath } from "../src/offset.js";
import { boundingBoxOfPath } from "../src/geometry.js";
import type { VectorPath } from "../src/types.js";

function squarePath(size: number): VectorPath {
  return {
    id: "square",
    commands: [
      { type: "M", point: { x: 0, y: 0 } },
      { type: "L", point: { x: size, y: 0 } },
      { type: "L", point: { x: size, y: size } },
      { type: "L", point: { x: 0, y: size } },
      { type: "Z" },
    ],
  };
}

describe("offsetPath", () => {
  it("grows a square outward by roughly the given distance", () => {
    const path = squarePath(10);
    const [result] = offsetPath(path, 2);
    expect(result).toBeDefined();

    const bbox = boundingBoxOfPath(result!);
    // Original bbox is [0,10]x[0,10]; offsetting outward by 2 with miter
    // joins on a square should produce almost exactly [-2,12]x[-2,12].
    expect(bbox.x).toBeCloseTo(-2, 1);
    expect(bbox.y).toBeCloseTo(-2, 1);
    expect(bbox.width).toBeCloseTo(14, 1);
    expect(bbox.height).toBeCloseTo(14, 1);
  });

  it("shrinks a square inward for a negative distance", () => {
    const path = squarePath(10);
    const [result] = offsetPath(path, -2);
    expect(result).toBeDefined();

    const bbox = boundingBoxOfPath(result!);
    expect(bbox.x).toBeCloseTo(2, 1);
    expect(bbox.y).toBeCloseTo(2, 1);
    expect(bbox.width).toBeCloseTo(6, 1);
    expect(bbox.height).toBeCloseTo(6, 1);
  });

  it("returns closed paths ending with a Z command", () => {
    const path = squarePath(10);
    const results = offsetPath(path, 3);
    for (const result of results) {
      expect(result.commands[result.commands.length - 1]).toEqual({ type: "Z" });
      expect(result.commands[0]!.type).toBe("M");
    }
  });

  it("produces distinct ids from the input path", () => {
    const path = squarePath(10);
    const [result] = offsetPath(path, 1);
    expect(result!.id).not.toBe(path.id);
  });
});

describe("kerfCompensate", () => {
  it("outset matches offsetPath with +kerfWidth/2", () => {
    const path = squarePath(10);
    const kerfWidth = 4;

    const viaWrapper = kerfCompensate(path, kerfWidth, { side: "outset" });
    const viaDirect = offsetPath(path, kerfWidth / 2);

    expect(viaWrapper.length).toBe(viaDirect.length);
    for (let i = 0; i < viaWrapper.length; i++) {
      expect(viaWrapper[i]!.commands).toEqual(viaDirect[i]!.commands);
    }
  });

  it("inset matches offsetPath with -kerfWidth/2", () => {
    const path = squarePath(10);
    const kerfWidth = 4;

    const viaWrapper = kerfCompensate(path, kerfWidth, { side: "inset" });
    const viaDirect = offsetPath(path, -kerfWidth / 2);

    expect(viaWrapper.length).toBe(viaDirect.length);
    for (let i = 0; i < viaWrapper.length; i++) {
      expect(viaWrapper[i]!.commands).toEqual(viaDirect[i]!.commands);
    }
  });

  it("defaults to outset when side is omitted", () => {
    const path = squarePath(10);
    const kerfWidth = 4;

    const viaWrapper = kerfCompensate(path, kerfWidth);
    const viaDirect = offsetPath(path, kerfWidth / 2);

    expect(viaWrapper.length).toBe(viaDirect.length);
    for (let i = 0; i < viaWrapper.length; i++) {
      expect(viaWrapper[i]!.commands).toEqual(viaDirect[i]!.commands);
    }
  });

  it("forwards joinType to offsetPath", () => {
    const path = squarePath(10);
    const kerfWidth = 4;

    const viaWrapper = kerfCompensate(path, kerfWidth, { side: "outset", joinType: "round" });
    const viaDirect = offsetPath(path, kerfWidth / 2, { joinType: "round" });

    expect(viaWrapper.length).toBe(viaDirect.length);
    for (let i = 0; i < viaWrapper.length; i++) {
      expect(viaWrapper[i]!.commands).toEqual(viaDirect[i]!.commands);
    }
  });
});
