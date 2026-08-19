import { describe, expect, it } from "vitest";
import { dxfToPaths, pathsToDxf } from "../src/dxf.js";
import type { VectorPath } from "../src/types.js";

function approxEqual(a: number, b: number, tolerance = 1e-6) {
  expect(Math.abs(a - b)).toBeLessThan(tolerance);
}

describe("pathsToDxf", () => {
  it("emits a minimal valid SECTION/ENTITIES/ENDSEC wrapper containing a POLYLINE", () => {
    const rect: VectorPath = {
      id: "rect",
      commands: [
        { type: "M", point: { x: 0, y: 0 } },
        { type: "L", point: { x: 10, y: 0 } },
        { type: "L", point: { x: 10, y: 10 } },
        { type: "L", point: { x: 0, y: 10 } },
        { type: "Z" },
      ],
    };

    const dxf = pathsToDxf([rect]);
    expect(dxf).toContain("SECTION");
    expect(dxf).toContain("ENTITIES");
    expect(dxf).toContain("POLYLINE");
    expect(dxf).toContain("ENDSEC");
    expect(dxf).toContain("EOF");
  });
});

describe("round-trip", () => {
  it("preserves a closed rectangle's points and closedness through pathsToDxf -> dxfToPaths", () => {
    const rect: VectorPath = {
      id: "rect",
      commands: [
        { type: "M", point: { x: 0, y: 0 } },
        { type: "L", point: { x: 10, y: 0 } },
        { type: "L", point: { x: 10, y: 5 } },
        { type: "L", point: { x: 0, y: 5 } },
        { type: "Z" },
      ],
    };

    const dxf = pathsToDxf([rect]);
    const [parsed] = dxfToPaths(dxf);
    expect(parsed).toBeDefined();
    if (!parsed) return;

    const expectedPoints = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
      { x: 0, y: 5 },
    ];

    const nonZCommands = parsed.commands.filter((c) => c.type !== "Z");
    expect(nonZCommands).toHaveLength(expectedPoints.length);
    nonZCommands.forEach((command, i) => {
      if (command.type === "Z") return;
      const expected = expectedPoints[i];
      if (!expected) return;
      approxEqual(command.point.x, expected.x);
      approxEqual(command.point.y, expected.y);
    });

    expect(parsed.commands[0]?.type).toBe("M");
    expect(parsed.commands[parsed.commands.length - 1]?.type).toBe("Z");
  });

  it("flattens curves into multiple line vertices without throwing", () => {
    const curvy: VectorPath = {
      id: "curvy",
      commands: [
        { type: "M", point: { x: 0, y: 0 } },
        {
          type: "C",
          control1: { x: 0, y: 10 },
          control2: { x: 10, y: 10 },
          point: { x: 10, y: 0 },
        },
      ],
    };

    const dxf = pathsToDxf([curvy]);
    const parsed = dxfToPaths(dxf);
    expect(parsed).toHaveLength(1);

    const commands = parsed[0]?.commands ?? [];
    // Flattened curve should produce more than the 2 original endpoints, and only M/L commands.
    expect(commands.length).toBeGreaterThan(2);
    for (const command of commands) {
      expect(["M", "L"]).toContain(command.type);
    }
    expect(commands[0]?.type).toBe("M");
  });
});

describe("dxfToPaths", () => {
  it("parses a hand-written LINE entity into a 2-point open path", () => {
    const dxf = [
      "0",
      "SECTION",
      "2",
      "ENTITIES",
      "0",
      "LINE",
      "8",
      "0",
      "10",
      "1.5",
      "20",
      "2.5",
      "30",
      "0.0",
      "11",
      "8.0",
      "21",
      "9.0",
      "31",
      "0.0",
      "0",
      "ENDSEC",
      "0",
      "EOF",
    ].join("\n");

    const paths = dxfToPaths(dxf);
    expect(paths).toHaveLength(1);
    const commands = paths[0]?.commands ?? [];
    expect(commands).toHaveLength(2);
    expect(commands[0]).toEqual({ type: "M", point: { x: 1.5, y: 2.5 } });
    expect(commands[1]).toEqual({ type: "L", point: { x: 8, y: 9 } });
  });

  it("parses a hand-written open LWPOLYLINE entity", () => {
    const dxf = [
      "0",
      "SECTION",
      "2",
      "ENTITIES",
      "0",
      "LWPOLYLINE",
      "90",
      "3",
      "70",
      "0",
      "10",
      "0.0",
      "20",
      "0.0",
      "10",
      "5.0",
      "20",
      "0.0",
      "10",
      "5.0",
      "20",
      "5.0",
      "0",
      "ENDSEC",
      "0",
      "EOF",
    ].join("\n");

    const paths = dxfToPaths(dxf);
    expect(paths).toHaveLength(1);
    const commands = paths[0]?.commands ?? [];
    expect(commands.map((c) => c.type)).toEqual(["M", "L", "L"]);
    expect(commands.some((c) => c.type === "Z")).toBe(false);
  });

  it("parses a hand-written closed LWPOLYLINE entity", () => {
    const dxf = [
      "0",
      "SECTION",
      "2",
      "ENTITIES",
      "0",
      "LWPOLYLINE",
      "90",
      "3",
      "70",
      "1",
      "10",
      "0.0",
      "20",
      "0.0",
      "10",
      "5.0",
      "20",
      "0.0",
      "10",
      "5.0",
      "20",
      "5.0",
      "0",
      "ENDSEC",
      "0",
      "EOF",
    ].join("\n");

    const paths = dxfToPaths(dxf);
    expect(paths).toHaveLength(1);
    const commands = paths[0]?.commands ?? [];
    expect(commands.map((c) => c.type)).toEqual(["M", "L", "L", "Z"]);
  });

  it("parses a hand-written CIRCLE entity into a closed path approximating the circle", () => {
    const cx = 3;
    const cy = 4;
    const radius = 2;
    const dxf = [
      "0",
      "SECTION",
      "2",
      "ENTITIES",
      "0",
      "CIRCLE",
      "8",
      "0",
      "10",
      String(cx),
      "20",
      String(cy),
      "30",
      "0.0",
      "40",
      String(radius),
      "0",
      "ENDSEC",
      "0",
      "EOF",
    ].join("\n");

    const paths = dxfToPaths(dxf);
    expect(paths).toHaveLength(1);
    const commands = paths[0]?.commands ?? [];
    expect(commands.length).toBeGreaterThan(8);
    expect(commands[commands.length - 1]?.type).toBe("Z");

    for (const command of commands) {
      if (command.type === "Z") continue;
      const dist = Math.hypot(command.point.x - cx, command.point.y - cy);
      approxEqual(dist, radius, 1e-6);
    }
  });

  it("returns an empty array for malformed or empty input without throwing", () => {
    expect(dxfToPaths("")).toEqual([]);
    expect(dxfToPaths("not a dxf file\nat all")).toEqual([]);
    expect(dxfToPaths("0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF")).toEqual([]);
  });
});
