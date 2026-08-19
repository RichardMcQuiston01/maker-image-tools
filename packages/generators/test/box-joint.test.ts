import { boundingBoxOfPath } from "@maker/core-vector";
import { describe, expect, it } from "vitest";
import { generateFingerJointBox } from "../src/box-joint.js";

describe("generateFingerJointBox", () => {
  it("returns 6 labeled panels when includeLid is true", () => {
    const result = generateFingerJointBox({
      width: 100,
      depth: 60,
      height: 40,
      materialThickness: 3,
      includeLid: true,
    });
    expect(result.panels).toHaveLength(6);
    expect(result.panelLabels).toEqual(["bottom", "front", "back", "left", "right", "top"]);
  });

  it("returns 5 panels with no top label when includeLid is false", () => {
    const result = generateFingerJointBox({
      width: 100,
      depth: 60,
      height: 40,
      materialThickness: 3,
      includeLid: false,
    });
    expect(result.panels).toHaveLength(5);
    expect(result.panelLabels).not.toContain("top");
  });

  it("produces closed paths for every panel", () => {
    const result = generateFingerJointBox({
      width: 80,
      depth: 50,
      height: 30,
      materialThickness: 3,
    });
    for (const panel of result.panels) {
      const last = panel.commands.at(-1);
      expect(last?.type).toBe("Z");
    }
  });

  it("lays out panels side by side without X overlap", () => {
    const result = generateFingerJointBox({
      width: 80,
      depth: 50,
      height: 30,
      materialThickness: 3,
    });
    let previousRightEdge = -Infinity;
    for (const panel of result.panels) {
      const bbox = boundingBoxOfPath(panel);
      expect(bbox.x).toBeGreaterThanOrEqual(previousRightEdge);
      previousRightEdge = bbox.x + bbox.width;
    }
  });

  it("adjusts finger width so a whole number of fingers tiles the edge exactly", () => {
    // width 100 / fingerWidth 12 is not a whole number (100/12 = 8.33), so the actual finger
    // width must be adjusted so 8 fingers exactly tile the 100mm top edge of the bottom panel.
    // materialThickness is set to 0 here so the tiling math (X spacing) can be isolated from the
    // Z-offset tab depth: with no perpendicular excursion, only the top edge's vertices sit at
    // y === 0, which cleanly separates them from the right/left edges' vertices (y > 0).
    const result = generateFingerJointBox({
      width: 100,
      depth: 60,
      height: 40,
      materialThickness: 0,
      fingerWidth: 12,
    });
    const bottomPanel = result.panels[0];
    expect(bottomPanel).toBeDefined();
    if (!bottomPanel) return;

    const points = bottomPanel.commands.flatMap((c) => (c.type === "Z" ? [] : [c.point]));
    const topEdgeXs = Array.from(
      new Set(points.filter((p) => Math.abs(p.y) < 1e-9).map((p) => Math.round(p.x * 1000) / 1000)),
    ).sort((a, b) => a - b);

    const expectedFingerCount = 8;
    const expectedFingerWidth = 100 / expectedFingerCount;
    // Verify consecutive distinct X values along the top edge are spaced in multiples of the
    // expected finger width (the zigzag inserts extra X values at the same finger-width step).
    for (let i = 1; i < topEdgeXs.length; i++) {
      const a = topEdgeXs[i - 1];
      const b = topEdgeXs[i];
      expect(a).toBeDefined();
      expect(b).toBeDefined();
      if (a === undefined || b === undefined) continue;
      const diff = b - a;
      const stepsOfFingerWidth = diff / expectedFingerWidth;
      expect(stepsOfFingerWidth).toBeCloseTo(Math.round(stepsOfFingerWidth), 5);
    }
    expect(topEdgeXs[topEdgeXs.length - 1]).toBeCloseTo(100, 5);
    expect(topEdgeXs[0]).toBeCloseTo(0, 5);
  });

  it("handles a degenerate case where materialThickness is close to width without throwing", () => {
    const result = generateFingerJointBox({
      width: 10,
      depth: 10,
      height: 10,
      materialThickness: 9,
    });
    expect(result.panels.length).toBeGreaterThan(0);
    for (const panel of result.panels) {
      const last = panel.commands.at(-1);
      expect(last?.type).toBe("Z");
      expect(panel.commands.length).toBeGreaterThan(1);
    }
  });
});
