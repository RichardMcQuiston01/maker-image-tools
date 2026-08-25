import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PNG } from "pngjs";
import { generateImage, InvalidDimensionError } from "../src/generate-image.js";

/**
 * generateImage() calls the real Gemini API, which needs a paid API key this
 * sandbox doesn't have. Real end-to-end verification requires setting
 * GEMINI_API_KEY and hitting the live API by hand; these tests instead mock
 * `fetch` to return a small hand-built PNG (via pngjs, the same library the
 * implementation uses to decode a real response) and verify the
 * decode/resize/response contract without a live credential.
 */
describe("generateImage", () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.GEMINI_API_KEY;

  beforeEach(() => {
    process.env.GEMINI_API_KEY = "test-key";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalApiKey;
  });

  /** Builds a solid-color PNG and mocks fetch to return it as Gemini's inline image data. */
  function mockGeminiImage(width: number, height: number, rgb: [number, number, number]) {
    const png = new PNG({ width, height });
    for (let i = 0; i < width * height; i++) {
      png.data[i * 4] = rgb[0];
      png.data[i * 4 + 1] = rgb[1];
      png.data[i * 4 + 2] = rgb[2];
      png.data[i * 4 + 3] = 255;
    }
    const base64 = PNG.sync.write(png).toString("base64");
    global.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            candidates: [
              { content: { parts: [{ inlineData: { mimeType: "image/png", data: base64 } }] } },
            ],
          }),
          { status: 200 },
        ),
    ) as never;
  }

  it("decodes a Gemini-generated image already at the requested size", async () => {
    mockGeminiImage(16, 12, [200, 50, 50]);
    const result = await generateImage("a red bicycle", { width: 16, height: 12 });
    expect(result.width).toBe(16);
    expect(result.height).toBe(12);
    expect(result.data.length).toBe(16 * 12 * 4);
    expect(result.data[0]).toBe(200);
    expect(result.data[1]).toBe(50);
    expect(result.notes).toMatch(/gemini/i);
  });

  it("resizes a Gemini-generated image that doesn't match the requested size", async () => {
    mockGeminiImage(8, 8, [10, 20, 30]);
    const result = await generateImage("anything", { width: 32, height: 24 });
    expect(result.width).toBe(32);
    expect(result.height).toBe(24);
    expect(result.data.length).toBe(32 * 24 * 4);
    expect(result.notes).toMatch(/resized/i);
  });

  it("defaults to a 512x512 image when no size is given", async () => {
    mockGeminiImage(512, 512, [1, 2, 3]);
    const result = await generateImage("anything");
    expect(result.width).toBe(512);
    expect(result.height).toBe(512);
    expect(result.data.length).toBe(512 * 512 * 4);
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

  it("throws when Gemini returns no image part", async () => {
    global.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ candidates: [{ content: { parts: [] } }] }), {
          status: 200,
        }),
    ) as never;
    await expect(generateImage("x", { width: 4, height: 4 })).rejects.toThrow(/generated image/i);
  });

  it("throws a config error when GEMINI_API_KEY is unset", async () => {
    delete process.env.GEMINI_API_KEY;
    await expect(generateImage("x", { width: 4, height: 4 })).rejects.toThrow(/GEMINI_API_KEY/);
  });
});
