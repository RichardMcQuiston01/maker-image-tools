import { describe, expect, it } from "vitest";
import { generateImage, InvalidDimensionError } from "../src/generate-image.js";

describe("generateImage", () => {
  it("returns a placeholder image at the requested size and discloses stub mode", async () => {
    const result = await generateImage("a mountain landscape at sunset", {
      width: 16,
      height: 12,
    });
    expect(result.width).toBe(16);
    expect(result.height).toBe(12);
    expect(result.data.length).toBe(16 * 12 * 4);
    expect(result.notes).toMatch(/stub|placeholder/i);
  });

  it("defaults to a 512x512 image when no size is given", async () => {
    const result = await generateImage("anything");
    expect(result.width).toBe(512);
    expect(result.height).toBe(512);
    expect(result.data.length).toBe(512 * 512 * 4);
  });

  it("is deterministic: the same prompt produces the same pixels", async () => {
    const a = await generateImage("a red bicycle", { width: 8, height: 8 });
    const b = await generateImage("a red bicycle", { width: 8, height: 8 });
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
  });

  it("varies output for different prompts", async () => {
    const a = await generateImage("a red bicycle", { width: 8, height: 8 });
    const b = await generateImage("a blue whale", { width: 8, height: 8 });
    expect(Array.from(a.data)).not.toEqual(Array.from(b.data));
  });

  it("always produces fully opaque pixels", async () => {
    const result = await generateImage("opacity check", { width: 4, height: 4 });
    for (let i = 3; i < result.data.length; i += 4) {
      expect(result.data[i]).toBe(255);
    }
  });

  it("rejects a fractional dimension", async () => {
    await expect(generateImage("x", { width: 8.5, height: 8 })).rejects.toThrow(
      InvalidDimensionError,
    );
  });

  it("rejects a zero or negative dimension", async () => {
    await expect(generateImage("x", { width: 0, height: 8 })).rejects.toThrow(
      InvalidDimensionError,
    );
    await expect(generateImage("x", { width: 8, height: -1 })).rejects.toThrow(
      InvalidDimensionError,
    );
  });

  it("rejects a dimension above the maximum", async () => {
    await expect(generateImage("x", { width: 100000, height: 8 })).rejects.toThrow(
      InvalidDimensionError,
    );
  });
});
