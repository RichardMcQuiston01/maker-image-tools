import { describe, expect, it } from "vitest";
import {
  flattenPath,
  insertPointAfter,
  moveControlPoint,
  movePoint,
  removePoint,
} from "../src/editor.js";
import type { VectorPath } from "../src/types.js";

function samplePath(): VectorPath {
  return {
    id: "p1",
    commands: [
      { type: "M", point: { x: 0, y: 0 } },
      { type: "L", point: { x: 10, y: 0 } },
      { type: "L", point: { x: 10, y: 10 } },
      { type: "Z" },
    ],
  };
}

describe("insertPointAfter", () => {
  it("inserts a new L command after the given index without mutating the input", () => {
    const path = samplePath();
    const frozenCommands = path.commands.map((c) => ({ ...c }));
    const result = insertPointAfter(path, 1, { x: 5, y: 5 });

    expect(result.commands).toEqual([
      { type: "M", point: { x: 0, y: 0 } },
      { type: "L", point: { x: 10, y: 0 } },
      { type: "L", point: { x: 5, y: 5 } },
      { type: "L", point: { x: 10, y: 10 } },
      { type: "Z" },
    ]);
    expect(path.commands).toEqual(frozenCommands);
    expect(result).not.toBe(path);
    expect(result.commands).not.toBe(path.commands);
  });

  it("clamps an out-of-range index", () => {
    const path = samplePath();
    const result = insertPointAfter(path, 999, { x: 1, y: 1 });
    expect(result.commands[result.commands.length - 1]).toEqual({ type: "L", point: { x: 1, y: 1 } });
  });
});

describe("removePoint", () => {
  it("removes the command at the given index without mutating the input", () => {
    const path = samplePath();
    const frozenCommands = path.commands.map((c) => ({ ...c }));
    const result = removePoint(path, 1);

    expect(result.commands).toEqual([
      { type: "M", point: { x: 0, y: 0 } },
      { type: "L", point: { x: 10, y: 10 } },
      { type: "Z" },
    ]);
    expect(path.commands).toEqual(frozenCommands);
  });

  it("is a no-op when removal would leave fewer than 2 commands", () => {
    const path: VectorPath = {
      id: "p2",
      commands: [
        { type: "M", point: { x: 0, y: 0 } },
        { type: "L", point: { x: 1, y: 1 } },
      ],
    };
    const result = removePoint(path, 0);
    expect(result).toBe(path);
  });

  it("is a no-op for an out-of-range index", () => {
    const path = samplePath();
    const result = removePoint(path, 42);
    expect(result).toBe(path);
  });
});

describe("movePoint", () => {
  it("replaces the point of an M/L/C/Q command without mutating the input", () => {
    const path = samplePath();
    const frozenCommands = path.commands.map((c) => ({ ...c }));
    const result = movePoint(path, 2, { x: 99, y: 99 });

    expect(result.commands[2]).toEqual({ type: "L", point: { x: 99, y: 99 } });
    expect(path.commands).toEqual(frozenCommands);
  });

  it("is a no-op for a Z command", () => {
    const path = samplePath();
    const result = movePoint(path, 3, { x: 1, y: 1 });
    expect(result).toBe(path);
  });

  it("is a no-op for an invalid index", () => {
    const path = samplePath();
    expect(movePoint(path, -1, { x: 0, y: 0 })).toBe(path);
    expect(movePoint(path, 100, { x: 0, y: 0 })).toBe(path);
  });
});

describe("moveControlPoint", () => {
  function curvedPath(): VectorPath {
    return {
      id: "p3",
      commands: [
        { type: "M", point: { x: 0, y: 0 } },
        {
          type: "C",
          control1: { x: 1, y: 1 },
          control2: { x: 2, y: 2 },
          point: { x: 3, y: 3 },
        },
        { type: "Q", control: { x: 4, y: 4 }, point: { x: 5, y: 5 } },
      ],
    };
  }

  it("moves control1/control2 of a C command without mutating the input", () => {
    const path = curvedPath();
    const frozenCommands = path.commands.map((c) => ({ ...c }));

    const r1 = moveControlPoint(path, 1, "control1", { x: 10, y: 10 });
    expect(r1.commands[1]).toEqual({
      type: "C",
      control1: { x: 10, y: 10 },
      control2: { x: 2, y: 2 },
      point: { x: 3, y: 3 },
    });

    const r2 = moveControlPoint(path, 1, "control2", { x: 20, y: 20 });
    expect(r2.commands[1]).toEqual({
      type: "C",
      control1: { x: 1, y: 1 },
      control2: { x: 20, y: 20 },
      point: { x: 3, y: 3 },
    });

    expect(path.commands).toEqual(frozenCommands);
  });

  it("moves the control point of a Q command", () => {
    const path = curvedPath();
    const result = moveControlPoint(path, 2, "control", { x: 40, y: 40 });
    expect(result.commands[2]).toEqual({ type: "Q", control: { x: 40, y: 40 }, point: { x: 5, y: 5 } });
  });

  it("is a no-op when the command type doesn't have the requested control point", () => {
    const path = curvedPath();
    expect(moveControlPoint(path, 1, "control", { x: 0, y: 0 })).toBe(path);
    expect(moveControlPoint(path, 2, "control1", { x: 0, y: 0 })).toBe(path);
    expect(moveControlPoint(path, 0, "control1", { x: 0, y: 0 })).toBe(path);
  });
});

describe("flattenPath", () => {
  it("returns the same points for a straight-line-only path", () => {
    const path = samplePath();
    const points = flattenPath(path);
    expect(points).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 0 },
    ]);
  });

  it("closes a Z back to the subpath start point", () => {
    const path: VectorPath = {
      id: "p4",
      commands: [
        { type: "M", point: { x: 2, y: 2 } },
        { type: "L", point: { x: 8, y: 2 } },
        { type: "Z" },
      ],
    };
    const points = flattenPath(path);
    expect(points[points.length - 1]).toEqual({ x: 2, y: 2 });
  });

  it("does not duplicate the closing point if already at the start", () => {
    const path: VectorPath = {
      id: "p5",
      commands: [
        { type: "M", point: { x: 0, y: 0 } },
        { type: "L", point: { x: 0, y: 0 } },
        { type: "Z" },
      ],
    };
    const points = flattenPath(path);
    expect(points).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ]);
  });

  it("adaptively subdivides a C curve, more points at tighter tolerance", () => {
    const path: VectorPath = {
      id: "p6",
      commands: [
        { type: "M", point: { x: 0, y: 0 } },
        {
          type: "C",
          control1: { x: 0, y: 50 },
          control2: { x: 100, y: 50 },
          point: { x: 100, y: 0 },
        },
      ],
    };
    const loose = flattenPath(path, 5);
    const tight = flattenPath(path, 0.1);
    expect(loose.length).toBeGreaterThan(1);
    expect(tight.length).toBeGreaterThan(loose.length);
    // Endpoint always present.
    expect(tight[tight.length - 1]).toEqual({ x: 100, y: 0 });
  });

  it("adaptively subdivides a Q curve, more points at tighter tolerance", () => {
    const path: VectorPath = {
      id: "p7",
      commands: [
        { type: "M", point: { x: 0, y: 0 } },
        { type: "Q", control: { x: 50, y: 100 }, point: { x: 100, y: 0 } },
      ],
    };
    const loose = flattenPath(path, 5);
    const tight = flattenPath(path, 0.1);
    expect(tight.length).toBeGreaterThan(loose.length);
    expect(tight[tight.length - 1]).toEqual({ x: 100, y: 0 });
  });
});
