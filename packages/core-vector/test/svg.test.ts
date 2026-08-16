import { describe, expect, it } from "vitest";
import { createSvgRoot, parseSvg, serializeSvg, SvgParseError } from "../src/svg.js";

describe("parseSvg", () => {
  it("parses a well-formed SVG document into its root element", () => {
    const root = parseSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>',
    );
    expect(root.tagName.toLowerCase()).toBe("svg");
    expect(root.getAttribute("width")).toBe("10");
    expect(root.querySelector("rect")).not.toBeNull();
  });

  it("throws SvgParseError on malformed XML", () => {
    expect(() => parseSvg("<svg><unclosed></svg>")).toThrow(SvgParseError);
  });

  it("throws SvgParseError when the root element isn't <svg>", () => {
    expect(() => parseSvg('<not-svg xmlns="http://www.w3.org/2000/svg"/>')).toThrow(SvgParseError);
  });
});

describe("createSvgRoot / serializeSvg round-trip", () => {
  it("creates a root with the given viewport and serializes it back", () => {
    const root = createSvgRoot(100, 50);
    expect(root.getAttribute("width")).toBe("100");
    expect(root.getAttribute("height")).toBe("50");
    expect(root.getAttribute("viewBox")).toBe("0 0 100 50");

    const serialized = serializeSvg(root);
    const reparsed = parseSvg(serialized);
    expect(reparsed.getAttribute("width")).toBe("100");
    expect(reparsed.getAttribute("height")).toBe("50");
  });
});
