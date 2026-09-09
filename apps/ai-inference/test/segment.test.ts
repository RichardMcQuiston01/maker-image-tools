import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { suggestColorPalette } from "../src/segment.js";

/**
 * suggestColorPalette() calls the real Gemini API, which needs a paid API
 * key this sandbox doesn't have. Real end-to-end verification requires
 * setting GEMINI_API_KEY and hitting the live API by hand; these tests
 * instead mock `fetch` to verify the request/response contract (prompt
 * construction, response parsing, error mapping) without a live credential.
 */
describe("suggestColorPalette", () => {
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

  function mockGeminiResponse(body: unknown, status = 200) {
    global.fetch = vi.fn(async () => new Response(JSON.stringify(body), { status })) as never;
  }

  function geminiTextResponse(text: string) {
    return {
      candidates: [{ content: { parts: [{ text }] } }],
    };
  }

  it("parses a well-formed palette of hex colors into RGB triples", async () => {
    mockGeminiResponse(geminiTextResponse(JSON.stringify({ colors: ["#ff0000", "#00ff00"] })));

    const result = await suggestColorPalette(new Uint8Array([1, 2, 3, 4]));
    expect(result.palette).toEqual([
      [255, 0, 0],
      [0, 255, 0],
    ]);
    expect(result.notes).toMatch(/gemini/i);
  });

  it("accepts hex colors without a leading #", async () => {
    mockGeminiResponse(geminiTextResponse(JSON.stringify({ colors: ["0000ff"] })));
    const result = await suggestColorPalette(new Uint8Array([1]));
    expect(result.palette).toEqual([[0, 0, 255]]);
  });

  it("skips non-string and malformed entries but keeps valid ones", async () => {
    mockGeminiResponse(
      geminiTextResponse(JSON.stringify({ colors: ["#ff0000", 123, "not-a-color", "#00ff00"] })),
    );
    const result = await suggestColorPalette(new Uint8Array([1]));
    expect(result.palette).toEqual([
      [255, 0, 0],
      [0, 255, 0],
    ]);
  });

  it("clamps the returned palette to a requested colorCount", async () => {
    mockGeminiResponse(
      geminiTextResponse(JSON.stringify({ colors: ["#ff0000", "#00ff00", "#0000ff"] })),
    );
    const result = await suggestColorPalette(new Uint8Array([1]), { colorCount: 2 });
    expect(result.palette).toHaveLength(2);
  });

  it("throws when Gemini returns no text part", async () => {
    mockGeminiResponse({ candidates: [{ content: { parts: [] } }] });
    await expect(suggestColorPalette(new Uint8Array([1]))).rejects.toThrow(/text part/i);
  });

  it("throws when Gemini's text isn't valid JSON", async () => {
    mockGeminiResponse(geminiTextResponse("not json"));
    await expect(suggestColorPalette(new Uint8Array([1]))).rejects.toThrow(/not valid JSON/i);
  });

  it("throws when the response has no colors array", async () => {
    mockGeminiResponse(geminiTextResponse(JSON.stringify({})));
    await expect(suggestColorPalette(new Uint8Array([1]))).rejects.toThrow(/"colors" array/);
  });

  it("throws when no entry in the colors array is a valid hex color", async () => {
    mockGeminiResponse(geminiTextResponse(JSON.stringify({ colors: ["not-a-color", 42] })));
    await expect(suggestColorPalette(new Uint8Array([1]))).rejects.toThrow(/valid hex colors/);
  });

  it("throws a config error when GEMINI_API_KEY is unset", async () => {
    delete process.env.GEMINI_API_KEY;
    await expect(suggestColorPalette(new Uint8Array([1]))).rejects.toThrow(/GEMINI_API_KEY/);
  });

  it("throws an API error when Gemini responds with a non-2xx status", async () => {
    mockGeminiResponse({ error: "quota exceeded" }, 429);
    await expect(suggestColorPalette(new Uint8Array([1]))).rejects.toThrow(
      /failed with status 429/,
    );
  });
});
