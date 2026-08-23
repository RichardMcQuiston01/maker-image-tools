import { describe, expect, it } from "vitest";
import {
  decodeDepthMap,
  decodeRgbaImage,
  encodeDepthMap,
  encodeRgbaImage,
} from "../src/wire-image.js";

describe("wire-image", () => {
  it("round-trips an RGBA image through encode/decode", () => {
    const data = new Uint8ClampedArray([1, 2, 3, 4, 5, 6, 7, 8]);
    const encoded = encodeRgbaImage({ width: 2, height: 1, data });
    const decoded = decodeRgbaImage(encoded);
    expect(decoded.width).toBe(2);
    expect(decoded.height).toBe(1);
    expect(Array.from(decoded.data)).toEqual(Array.from(data));
  });

  it("round-trips a depth map through encode/decode", () => {
    const values = new Float32Array([0, 0.25, 0.5, 0.75, 1]);
    const encoded = encodeDepthMap({ width: 5, height: 1, values });
    const decoded = decodeDepthMap(encoded);
    expect(decoded.width).toBe(5);
    expect(decoded.height).toBe(1);
    expect(Array.from(decoded.values)).toEqual(Array.from(values));
  });

  it("rejects a payload whose length doesn't match its header", () => {
    const bad = new Uint8Array(8 + 3); // header claims 0x0 but body has bytes
    expect(() => decodeRgbaImage(bad)).toThrow(/does not match/);
  });

  it("rejects a payload shorter than the header", () => {
    expect(() => decodeRgbaImage(new Uint8Array(4))).toThrow(/too short/);
  });
});
