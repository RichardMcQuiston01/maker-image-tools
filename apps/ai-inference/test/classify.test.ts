import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classifyMaterial } from "../src/classify.js";

/**
 * classifyMaterial() calls the real Gemini API, which needs a paid API key
 * this sandbox doesn't have. Real end-to-end verification requires setting
 * GEMINI_API_KEY and hitting the live API by hand; these tests instead mock
 * `fetch` to verify the request/response contract (prompt construction,
 * response parsing, error mapping) without a live credential.
 */
describe("classifyMaterial", () => {
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

  it("parses a well-formed Gemini classification and matches presets", async () => {
    mockGeminiResponse({
      candidates: [
        {
          content: {
            parts: [
              { text: JSON.stringify({ material: "Baltic Birch Plywood 3mm", confidence: 0.9 }) },
            ],
          },
        },
      ],
    });

    const result = await classifyMaterial(new Uint8Array([1, 2, 3, 4]));
    expect(result.material).toBe("Baltic Birch Plywood 3mm");
    expect(result.confidence).toBe(0.9);
    expect(result.notes).toMatch(/gemini/i);
    expect(result.matchedPresets.length).toBeGreaterThan(0);
  });

  it("clamps an out-of-range confidence into [0, 1]", async () => {
    mockGeminiResponse({
      candidates: [
        { content: { parts: [{ text: JSON.stringify({ material: "acrylic", confidence: 5 }) }] } },
      ],
    });
    const result = await classifyMaterial(new Uint8Array([1]));
    expect(result.confidence).toBe(1);
  });

  it("falls back to unknown/0 confidence when the model omits a field", async () => {
    mockGeminiResponse({
      candidates: [{ content: { parts: [{ text: JSON.stringify({}) }] } }],
    });
    const result = await classifyMaterial(new Uint8Array([1]));
    expect(result.material).toBe("unknown");
    expect(result.confidence).toBe(0);
    expect(result.matchedPresets).toEqual([]);
  });

  it("throws when Gemini returns no text part", async () => {
    mockGeminiResponse({ candidates: [{ content: { parts: [] } }] });
    await expect(classifyMaterial(new Uint8Array([1]))).rejects.toThrow(/text part/i);
  });

  it("throws when Gemini's text isn't valid JSON", async () => {
    mockGeminiResponse({ candidates: [{ content: { parts: [{ text: "not json" }] } }] });
    await expect(classifyMaterial(new Uint8Array([1]))).rejects.toThrow(/not valid JSON/i);
  });

  it("throws a config error when GEMINI_API_KEY is unset", async () => {
    delete process.env.GEMINI_API_KEY;
    await expect(classifyMaterial(new Uint8Array([1]))).rejects.toThrow(/GEMINI_API_KEY/);
  });

  it("throws an API error when Gemini responds with a non-2xx status", async () => {
    mockGeminiResponse({ error: "quota exceeded" }, 429);
    await expect(classifyMaterial(new Uint8Array([1]))).rejects.toThrow(/failed with status 429/);
  });
});
