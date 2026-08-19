import { describe, expect, it } from "vitest";
import { commandsToPathData, pathDataToCommands, pathsToSvg, svgToPaths } from "../src/svg-io.js";

describe("pathDataToCommands / commandsToPathData round-trip", () => {
  it("round-trips a simple absolute path", () => {
    const d = "M0 0 L10 0 L10 10 Z";
    const commands = pathDataToCommands(d);
    expect(commands).toEqual([
      { type: "M", point: { x: 0, y: 0 } },
      { type: "L", point: { x: 10, y: 0 } },
      { type: "L", point: { x: 10, y: 10 } },
      { type: "Z" },
    ]);
    expect(commandsToPathData(commands)).toBe("M 0,0 L 10,0 L 10,10 Z");
  });

  it("resolves relative m/l commands against a moving current point", () => {
    const commands = pathDataToCommands("m10 10 l5 0 l0 5 z");
    expect(commands).toEqual([
      { type: "M", point: { x: 10, y: 10 } },
      { type: "L", point: { x: 15, y: 10 } },
      { type: "L", point: { x: 15, y: 15 } },
      { type: "Z" },
    ]);
  });

  it("supports implicit repeated command arguments", () => {
    const commands = pathDataToCommands("M 0 0 10 10 20 20");
    expect(commands).toEqual([
      { type: "M", point: { x: 0, y: 0 } },
      { type: "L", point: { x: 10, y: 10 } },
      { type: "L", point: { x: 20, y: 20 } },
    ]);
  });

  it("expands absolute H and V into full L commands", () => {
    const commands = pathDataToCommands("M0 0 H10 V10");
    expect(commands).toEqual([
      { type: "M", point: { x: 0, y: 0 } },
      { type: "L", point: { x: 10, y: 0 } },
      { type: "L", point: { x: 10, y: 10 } },
    ]);
  });

  it("expands relative h and v into full L commands", () => {
    const commands = pathDataToCommands("M5 5 h5 v5");
    expect(commands).toEqual([
      { type: "M", point: { x: 5, y: 5 } },
      { type: "L", point: { x: 10, y: 5 } },
      { type: "L", point: { x: 10, y: 10 } },
    ]);
  });

  it("parses absolute C and Q curve commands", () => {
    const commands = pathDataToCommands("M0 0 C1,1 2,2 3,3 Q4,4 5,5");
    expect(commands).toEqual([
      { type: "M", point: { x: 0, y: 0 } },
      {
        type: "C",
        control1: { x: 1, y: 1 },
        control2: { x: 2, y: 2 },
        point: { x: 3, y: 3 },
      },
      { type: "Q", control: { x: 4, y: 4 }, point: { x: 5, y: 5 } },
    ]);
  });

  it("resolves relative c and q curve commands", () => {
    const commands = pathDataToCommands("M10 10 c1,1 2,2 3,3 q1,1 2,2");
    expect(commands).toEqual([
      { type: "M", point: { x: 10, y: 10 } },
      {
        type: "C",
        control1: { x: 11, y: 11 },
        control2: { x: 12, y: 12 },
        point: { x: 13, y: 13 },
      },
      { type: "Q", control: { x: 14, y: 14 }, point: { x: 15, y: 15 } },
    ]);
  });

  it("does not crash on an arc command and advances past its 7 arguments", () => {
    expect(() => pathDataToCommands("M0 0 A5 5 0 0 1 10 10 L20 20")).not.toThrow();
    const commands = pathDataToCommands("M0 0 A5 5 0 0 1 10 10 L20 20");
    // Arc is approximated with line segments; the final L command must still parse.
    const last = commands[commands.length - 1];
    expect(last).toEqual({ type: "L", point: { x: 20, y: 20 } });
    // The arc's endpoint should be reachable via the approximation (within float tolerance).
    expect(
      commands.some(
        (c) => c.type === "L" && Math.abs(c.point.x - 10) < 1e-6 && Math.abs(c.point.y - 10) < 1e-6,
      ),
    ).toBe(true);
  });
});

describe("svgToPaths", () => {
  it("parses a <rect> into a closed 4-point path", () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="10" height="5"/></svg>';
    const paths = svgToPaths(svg);
    expect(paths).toHaveLength(1);
    const commands = paths[0]?.commands ?? [];
    expect(commands).toHaveLength(5);
    expect(commands[0]).toEqual({ type: "M", point: { x: 0, y: 0 } });
    expect(commands[commands.length - 1]).toEqual({ type: "Z" });
  });

  it("parses a <circle> into a closed 4-bezier path", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="5" r="5"/></svg>';
    const paths = svgToPaths(svg);
    expect(paths).toHaveLength(1);
    const commands = paths[0]?.commands ?? [];
    expect(commands[0]?.type).toBe("M");
    expect(commands.filter((c) => c.type === "C")).toHaveLength(4);
    expect(commands[commands.length - 1]).toEqual({ type: "Z" });
  });

  it("parses a <line> into an open 2-point path", () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg"><line x1="0" y1="0" x2="10" y2="10"/></svg>';
    const paths = svgToPaths(svg);
    expect(paths).toHaveLength(1);
    const commands = paths[0]?.commands ?? [];
    expect(commands).toEqual([
      { type: "M", point: { x: 0, y: 0 } },
      { type: "L", point: { x: 10, y: 10 } },
    ]);
  });

  it("parses a <polygon> into a closed path", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><polygon points="0,0 10,0 10,10"/></svg>';
    const paths = svgToPaths(svg);
    expect(paths).toHaveLength(1);
    const commands = paths[0]?.commands ?? [];
    expect(commands).toEqual([
      { type: "M", point: { x: 0, y: 0 } },
      { type: "L", point: { x: 10, y: 0 } },
      { type: "L", point: { x: 10, y: 10 } },
      { type: "Z" },
    ]);
  });

  it("skips unrecognized elements without throwing", () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g"/></defs><rect width="5" height="5"/></svg>';
    expect(() => svgToPaths(svg)).not.toThrow();
    expect(svgToPaths(svg)).toHaveLength(1);
  });
});

describe("pathsToSvg / svgToPaths round-trip", () => {
  it("preserves geometry through a round-trip", () => {
    const original = pathDataToCommands("M0 0 L10 0 L10 10 Z");
    const svg = pathsToSvg([{ id: "p1", commands: original }]);
    const reparsed = svgToPaths(svg);
    expect(reparsed).toHaveLength(1);
    const commands = reparsed[0]?.commands ?? [];
    expect(commands).toHaveLength(original.length);
    for (let i = 0; i < original.length; i++) {
      const a = original[i];
      const b = commands[i];
      expect(b?.type).toBe(a?.type);
      if (a && b && a.type !== "Z" && b.type !== "Z" && "point" in a && "point" in b) {
        expect(b.point.x).toBeCloseTo(a.point.x);
        expect(b.point.y).toBeCloseTo(a.point.y);
      }
    }
  });

  it("respects explicit width/height options", () => {
    const svg = pathsToSvg([], { width: 123, height: 45 });
    expect(svg).toContain('width="123"');
    expect(svg).toContain('height="45"');
  });
});
