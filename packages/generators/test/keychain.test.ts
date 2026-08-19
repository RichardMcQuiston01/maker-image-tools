import { boundingBoxOfPath } from "@maker/core-vector";
import { describe, expect, it } from "vitest";
import { generateEarringPair, generateKeychainBlank } from "../src/keychain.js";

describe("generateKeychainBlank", () => {
  it("returns exactly 2 closed paths with default options", () => {
    const paths = generateKeychainBlank();
    expect(paths).toHaveLength(2);
    for (const path of paths) {
      expect(path.commands.at(-1)?.type).toBe("Z");
    }
  });

  it("rounded-rect: outer path bbox roughly matches requested width/height", () => {
    const [outer] = generateKeychainBlank({ shape: "rounded-rect", width: 50, height: 30 });
    expect(outer).toBeDefined();
    if (!outer) return;
    const bbox = boundingBoxOfPath(outer);
    expect(bbox.width).toBeCloseTo(50, 0);
    expect(bbox.height).toBeCloseTo(30, 0);
  });

  it("circle: outer path bbox roughly matches requested diameter", () => {
    const [outer] = generateKeychainBlank({ shape: "circle", width: 40 });
    expect(outer).toBeDefined();
    if (!outer) return;
    const bbox = boundingBoxOfPath(outer);
    expect(bbox.width).toBeCloseTo(40, 0);
    expect(bbox.height).toBeCloseTo(40, 0);
  });

  it("hexagon: outer path bbox width roughly matches requested flat-to-flat width", () => {
    const [outer] = generateKeychainBlank({ shape: "hexagon", width: 40 });
    expect(outer).toBeDefined();
    if (!outer) return;
    const bbox = boundingBoxOfPath(outer);
    // Circumradius-based hexagon: width (flat-to-flat, x-axis here) should be close to 40,
    // within a few percent tolerance for the polygon approximation / orientation.
    expect(bbox.width).toBeGreaterThan(35);
    expect(bbox.width).toBeLessThan(48);
  });

  it("hole path bbox is close to holeDiameter", () => {
    const [, hole] = generateKeychainBlank({ holeDiameter: 5 });
    expect(hole).toBeDefined();
    if (!hole) return;
    const bbox = boundingBoxOfPath(hole);
    expect(bbox.width).toBeCloseTo(5, 0);
    expect(bbox.height).toBeCloseTo(5, 0);
  });
});

describe("generateEarringPair", () => {
  it("returns 4 paths", () => {
    const paths = generateEarringPair();
    expect(paths).toHaveLength(4);
  });

  it("offsets the second blank's outer path by roughly width + gap", () => {
    const width = 40;
    const gap = 20;
    const paths = generateEarringPair({ width, gap, shape: "circle" });
    const [leftOuter, , rightOuter] = paths;
    expect(leftOuter).toBeDefined();
    expect(rightOuter).toBeDefined();
    if (!leftOuter || !rightOuter) return;

    const leftBBox = boundingBoxOfPath(leftOuter);
    const rightBBox = boundingBoxOfPath(rightOuter);

    expect(rightBBox.x - leftBBox.x).toBeCloseTo(width + gap, 0);
  });
});
