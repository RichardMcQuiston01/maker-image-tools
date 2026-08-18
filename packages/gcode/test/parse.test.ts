import { describe, expect, it } from "vitest";
import { computeGcodeBounds, parseGcode } from "../src/parse.js";

describe("parseGcode", () => {
  it("parses a simple G0/G1 program into moves", () => {
    const moves = parseGcode(["G0 X10 Y0", "G1 X10 Y10", "G0 X0 Y0"].join("\n"));

    expect(moves).toHaveLength(3);

    expect(moves[0]).toMatchObject({
      type: "rapid",
      from: { x: 0, y: 0 },
      to: { x: 10, y: 0 },
    });
    expect(moves[1]).toMatchObject({
      type: "cut",
      from: { x: 10, y: 0 },
      to: { x: 10, y: 10 },
    });
    expect(moves[2]).toMatchObject({
      type: "rapid",
      from: { x: 10, y: 10 },
      to: { x: 0, y: 0 },
    });
  });

  it("handles CRLF line endings the same as LF", () => {
    const moves = parseGcode("G0 X5 Y0\r\nG1 X5 Y5\r\n");
    expect(moves).toHaveLength(2);
    expect(moves[1]?.to).toEqual({ x: 5, y: 5 });
  });

  it("applies modal F/S values stickily across subsequent moves", () => {
    const moves = parseGcode(
      ["G1 X10 Y0 F1000 S500", "G1 X20 Y0", "G1 X30 Y0", "G1 X40 Y0 F2000"].join("\n"),
    );

    expect(moves).toHaveLength(4);
    expect(moves[0]).toMatchObject({ feedRate: 1000, power: 500 });
    expect(moves[1]).toMatchObject({ feedRate: 1000, power: 500 });
    expect(moves[2]).toMatchObject({ feedRate: 1000, power: 500 });
    expect(moves[3]).toMatchObject({ feedRate: 2000, power: 500 });
  });

  it("omits feedRate/power entirely when never set", () => {
    const moves = parseGcode("G1 X10 Y10");
    expect(moves).toHaveLength(1);
    expect(moves[0]).not.toHaveProperty("feedRate");
    expect(moves[0]).not.toHaveProperty("power");
  });

  it("tracks laserOn via M3/M4/M5 across moves", () => {
    const moves = parseGcode(
      ["G1 X10 Y0", "M3", "G1 X20 Y0", "M5", "G1 X30 Y0", "M4", "G1 X40 Y0"].join("\n"),
    );

    expect(moves).toHaveLength(4);
    expect(moves[0]?.laserOn).toBe(false);
    expect(moves[1]?.laserOn).toBe(true);
    expect(moves[2]?.laserOn).toBe(false);
    expect(moves[3]?.laserOn).toBe(true);
  });

  it("turns the laser on from an M3 combined with a move on the same line", () => {
    const moves = parseGcode("G1 X10 Y0 M3");
    expect(moves[0]?.laserOn).toBe(true);
  });

  it("strips ; line comments and (...) parenthetical comments", () => {
    const moves = parseGcode(
      [
        "; full line comment, ignored",
        "G1 X10 (move right) Y20 ; done",
        "(pure parenthetical comment line)",
        "G1 X30 (a) Y30 (b)",
      ].join("\n"),
    );

    expect(moves).toHaveLength(2);
    expect(moves[0]?.to).toEqual({ x: 10, y: 20 });
    expect(moves[1]?.to).toEqual({ x: 30, y: 30 });
  });

  it("does not emit a move when the target position is unchanged", () => {
    const moves = parseGcode(["G1 X10 Y10", "G1 X10 Y10", "G1 X15 Y10"].join("\n"));
    expect(moves).toHaveLength(2);
    expect(moves[0]?.to).toEqual({ x: 10, y: 10 });
    expect(moves[1]?.to).toEqual({ x: 15, y: 10 });
  });

  it("still updates modal state from a no-op move line", () => {
    const moves = parseGcode(["G1 X10 Y10 F500", "G1 X10 Y10 F900", "G1 X20 Y10"].join("\n"));
    expect(moves).toHaveLength(2);
    expect(moves[1]?.feedRate).toBe(900);
  });

  it("treats G2/G3 as a straight chord to the target, ignoring I/J/R", () => {
    const moves = parseGcode("G2 X10 Y10 I5 J0 R7");
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({
      type: "cut",
      from: { x: 0, y: 0 },
      to: { x: 10, y: 10 },
    });

    const moves2 = parseGcode("G3 X-5 Y5");
    expect(moves2[0]).toMatchObject({ type: "cut", to: { x: -5, y: 5 } });
  });

  it("skips lines with no G0-G3 word, only updating modal state", () => {
    const moves = parseGcode(["M5", "F1000", "S250", "G1 X5 Y5"].join("\n"));
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ feedRate: 1000, power: 250, laserOn: false });
  });

  it("never throws on malformed or unexpected input, skipping it", () => {
    expect(() =>
      parseGcode(
        [
          "this is not gcode at all",
          "G1 XX10 YY20",
          "%%%",
          "G1 X10 Y10",
          "G7 X99 Y99",
          "",
          "   ",
        ].join("\n"),
      ),
    ).not.toThrow();

    const moves = parseGcode(
      ["this is not gcode at all", "G1 XX10 YY20", "%%%", "G1 X10 Y10", "G7 X99 Y99"].join("\n"),
    );
    expect(moves).toHaveLength(1);
    expect(moves[0]?.to).toEqual({ x: 10, y: 10 });
  });

  it("returns an empty array for empty or whitespace-only input", () => {
    expect(parseGcode("")).toEqual([]);
    expect(parseGcode("\n\n   \n")).toEqual([]);
  });
});

describe("computeGcodeBounds", () => {
  it("returns a zero bbox for an empty moves array", () => {
    expect(computeGcodeBounds([])).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it("computes the bbox spanning all move endpoints", () => {
    const moves = parseGcode(["G0 X0 Y0", "G1 X10 Y0", "G1 X10 Y5", "G1 X-2 Y5"].join("\n"));
    expect(computeGcodeBounds(moves)).toEqual({ x: -2, y: 0, width: 12, height: 5 });
  });
});
