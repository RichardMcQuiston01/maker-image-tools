import { Font, Glyph, Path } from "opentype.js";
import { describe, expect, it } from "vitest";
import { measureText, textToPaths } from "../src/text.js";

function makeTestFont(): Font {
  const notdefPath = new Path();
  const notdefGlyph = new Glyph({
    name: ".notdef",
    unicode: 0,
    advanceWidth: 300,
    path: notdefPath,
  });

  // A simple glyph shaped like a square, for predictable path-command assertions.
  // opentype.js only emits an explicit "Z" command for stroked paths (see
  // Glyph.prototype.getPath), so a stroke is set here purely to exercise the
  // "Z" mapping in textToPaths.
  const squarePath = new Path();
  squarePath.stroke = "#000000";
  squarePath.strokeWidth = 1;
  squarePath.moveTo(0, 0);
  squarePath.lineTo(300, 0);
  squarePath.lineTo(300, 300);
  squarePath.lineTo(0, 300);
  squarePath.close();
  const aGlyph = new Glyph({
    name: "A",
    unicode: "A".charCodeAt(0),
    advanceWidth: 300,
    path: squarePath,
  });

  return new Font({
    familyName: "Test",
    styleName: "Regular",
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    glyphs: [notdefGlyph, aGlyph],
  });
}

describe("textToPaths", () => {
  it("returns one VectorPath per glyph contour with mapped commands", () => {
    const font = makeTestFont();
    const paths = textToPaths(font, "A", { fontSize: 1000 });

    expect(paths).toHaveLength(1);
    const [path] = paths;
    expect(path.commands.map((c) => c.type)).toEqual(["M", "L", "L", "L", "Z"]);
    expect(path.id).toBeTruthy();

    // fontSize 1000 == unitsPerEm 1000, so scale factor is 1; x/y default to 0.
    // opentype.js's Font#getPath negates each glyph's (upward-positive) font-unit
    // Y before returning, so e.g. glyph-space (0, 300) comes back as (0, -300).
    const m = path.commands[0];
    if (m.type !== "M") throw new Error("expected M");
    expect(m.point.x).toBeCloseTo(0);
    expect(m.point.y).toBeCloseTo(0);

    const l1 = path.commands[1];
    if (l1.type !== "L") throw new Error("expected L");
    expect(l1.point.x).toBeCloseTo(300);
    expect(l1.point.y).toBeCloseTo(0);

    const l2 = path.commands[2];
    if (l2.type !== "L") throw new Error("expected L");
    expect(l2.point.x).toBeCloseTo(300);
    expect(l2.point.y).toBeCloseTo(-300);

    const l3 = path.commands[3];
    if (l3.type !== "L") throw new Error("expected L");
    expect(l3.point.x).toBeCloseTo(0);
    expect(l3.point.y).toBeCloseTo(-300);
  });

  it("offsets glyph coordinates by the given x/y", () => {
    const font = makeTestFont();
    const paths = textToPaths(font, "A", { fontSize: 1000, x: 50, y: 10 });
    const m = paths[0].commands[0];
    if (m.type !== "M") throw new Error("expected M");
    expect(m.point.x).toBeCloseTo(50);
    expect(m.point.y).toBeCloseTo(10);
  });

  it("returns an empty array for empty string input", () => {
    const font = makeTestFont();
    expect(textToPaths(font, "")).toEqual([]);
  });
});

describe("measureText", () => {
  it("returns the advance width scaled by fontSize / unitsPerEm", () => {
    const font = makeTestFont();
    const { width } = measureText(font, "A", 1000);
    // unitsPerEm 1000, fontSize 1000 -> scale 1, advanceWidth 300.
    expect(width).toBeCloseTo(300);
  });

  it("scales with fontSize relative to unitsPerEm", () => {
    const font = makeTestFont();
    const { width } = measureText(font, "A", 500);
    expect(width).toBeCloseTo(150);
  });

  it("defaults fontSize to 72 when omitted", () => {
    const font = makeTestFont();
    const { width } = measureText(font, "A");
    expect(width).toBeCloseTo((300 * 72) / 1000);
  });
});
