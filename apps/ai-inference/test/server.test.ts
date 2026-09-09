import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import { PNG } from "pngjs";
import { createServer } from "../src/server.js";
import { decodeDepthMap, encodeRgbaImage } from "../src/wire-image.js";

const originalFetch = global.fetch;

/**
 * /classify-material and /generate-image call the real Gemini API, which
 * needs a paid key this sandbox doesn't have. These tests mock only requests
 * to Gemini's endpoint and pass everything else (notably the test's own
 * calls to the local `baseUrl` server, which share the same global `fetch`)
 * through to the real implementation.
 */
function mockGeminiFetch(buildResponse: () => Response) {
  global.fetch = vi.fn((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("generativelanguage.googleapis.com")) {
      return Promise.resolve(buildResponse());
    }
    return originalFetch(input, init);
  }) as typeof fetch;
}

function pngBase64(width: number, height: number, rgb: [number, number, number]): string {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    png.data[i * 4] = rgb[0];
    png.data[i * 4 + 1] = rgb[1];
    png.data[i * 4 + 2] = rgb[2];
    png.data[i * 4 + 3] = 255;
  }
  return PNG.sync.write(png).toString("base64");
}

describe("ai-inference server", () => {
  let server: Server;
  let baseUrl: string;
  const originalApiKey = process.env.GEMINI_API_KEY;

  beforeAll(async () => {
    server = createServer();
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Expected server to bind to a numeric port");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(() => {
    server.close();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalApiKey;
  });

  it("classifies an uploaded image via POST /classify-material", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    mockGeminiFetch(
      () =>
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: JSON.stringify({ material: "unknown", confidence: 0 }) }],
                },
              },
            ],
          }),
          { status: 200 },
        ),
    );

    const body = new Uint8Array([137, 80, 78, 71]);
    const response = await fetch(`${baseUrl}/classify-material`, {
      method: "POST",
      headers: { "Content-Type": "image/png" },
      body,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    const json = await response.json();
    expect(json).toMatchObject({ material: "unknown", confidence: 0, matchedPresets: [] });
  });

  it("rejects an empty body with 400", async () => {
    const response = await fetch(`${baseUrl}/classify-material`, {
      method: "POST",
      headers: { "Content-Type": "image/png" },
      body: new Uint8Array(0),
    });
    expect(response.status).toBe(400);
  });

  it("returns 500 for /classify-material when GEMINI_API_KEY is unset", async () => {
    delete process.env.GEMINI_API_KEY;
    const response = await fetch(`${baseUrl}/classify-material`, {
      method: "POST",
      headers: { "Content-Type": "image/png" },
      body: new Uint8Array([1, 2, 3, 4]),
    });
    expect(response.status).toBe(500);
    const json = await response.json();
    expect(json.error).toMatch(/GEMINI_API_KEY/);
  });

  it("answers CORS preflight requests", async () => {
    const response = await fetch(`${baseUrl}/classify-material`, { method: "OPTIONS" });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-methods")).toContain("POST");
  });

  it("returns 404 for unknown routes", async () => {
    const response = await fetch(`${baseUrl}/nope`, { method: "POST" });
    expect(response.status).toBe(404);
  });

  it("estimates depth for an uploaded image via POST /depth-map", async () => {
    const width = 32;
    const height = 24;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = data[i + 1] = data[i + 2] = Math.floor((i / data.length) * 255);
      data[i + 3] = 255;
    }
    const body = encodeRgbaImage({ width, height, data });
    const response = await fetch(`${baseUrl}/depth-map`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body,
    });
    expect(response.status).toBe(200);
    const buffer = new Uint8Array(await response.arrayBuffer());
    const depth = decodeDepthMap(buffer);
    expect(depth.width).toBe(width);
    expect(depth.height).toBe(height);
    expect(depth.values.length).toBe(width * height);
    for (const v of depth.values) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  }, 60000);

  it("rejects a malformed /depth-map body with 400", async () => {
    const response = await fetch(`${baseUrl}/depth-map`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: new Uint8Array([1, 2, 3]),
    });
    expect(response.status).toBe(400);
  });

  it("generates an image via POST /generate-image", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    mockGeminiFetch(
      () =>
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      inlineData: {
                        mimeType: "image/png",
                        data: pngBase64(8, 8, [200, 50, 50]),
                      },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200 },
        ),
    );

    const response = await fetch(`${baseUrl}/generate-image`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "a red bicycle", width: 8, height: 8 }),
    });
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.width).toBe(8);
    expect(json.height).toBe(8);
    expect(typeof json.notes).toBe("string");
    const bytes = Buffer.from(json.dataBase64, "base64");
    expect(bytes.length).toBe(8 * 8 * 4);
  });

  it("returns 500 for /generate-image when GEMINI_API_KEY is unset", async () => {
    delete process.env.GEMINI_API_KEY;
    const response = await fetch(`${baseUrl}/generate-image`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "x", width: 8, height: 8 }),
    });
    expect(response.status).toBe(500);
    const json = await response.json();
    expect(json.error).toMatch(/GEMINI_API_KEY/);
  });

  it("rejects a /generate-image request missing a prompt", async () => {
    const response = await fetch(`${baseUrl}/generate-image`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(400);
  });

  it("rejects a /generate-image request with invalid JSON", async () => {
    const response = await fetch(`${baseUrl}/generate-image`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    expect(response.status).toBe(400);
  });

  it("rejects a /generate-image request with an oversized dimension", async () => {
    const response = await fetch(`${baseUrl}/generate-image`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "x", width: 100000, height: 8 }),
    });
    expect(response.status).toBe(400);
  });

  it("rejects a /generate-image request with a fractional dimension", async () => {
    const response = await fetch(`${baseUrl}/generate-image`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "x", width: 8.5, height: 8 }),
    });
    expect(response.status).toBe(400);
  });

  it("suggests a color palette for an uploaded image via POST /suggest-palette", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    mockGeminiFetch(
      () =>
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: { parts: [{ text: JSON.stringify({ colors: ["#ff0000", "#00ff00"] }) }] },
              },
            ],
          }),
          { status: 200 },
        ),
    );

    const body = new Uint8Array([137, 80, 78, 71]);
    const response = await fetch(`${baseUrl}/suggest-palette`, {
      method: "POST",
      headers: { "Content-Type": "image/png" },
      body,
    });
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.palette).toEqual([
      [255, 0, 0],
      [0, 255, 0],
    ]);
    expect(typeof json.notes).toBe("string");
  });

  it("respects a colorCount query parameter on /suggest-palette", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    mockGeminiFetch(
      () =>
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: JSON.stringify({ colors: ["#ff0000", "#00ff00", "#0000ff"] }) }],
                },
              },
            ],
          }),
          { status: 200 },
        ),
    );

    const response = await fetch(`${baseUrl}/suggest-palette?colorCount=2`, {
      method: "POST",
      headers: { "Content-Type": "image/png" },
      body: new Uint8Array([137, 80, 78, 71]),
    });
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.palette).toHaveLength(2);
  });

  it("rejects a non-numeric colorCount query parameter on /suggest-palette", async () => {
    const response = await fetch(`${baseUrl}/suggest-palette?colorCount=nope`, {
      method: "POST",
      headers: { "Content-Type": "image/png" },
      body: new Uint8Array([137, 80, 78, 71]),
    });
    expect(response.status).toBe(400);
  });

  it("rejects an empty body on /suggest-palette with 400", async () => {
    const response = await fetch(`${baseUrl}/suggest-palette`, {
      method: "POST",
      headers: { "Content-Type": "image/png" },
      body: new Uint8Array(0),
    });
    expect(response.status).toBe(400);
  });

  it("returns 500 for /suggest-palette when GEMINI_API_KEY is unset", async () => {
    delete process.env.GEMINI_API_KEY;
    const response = await fetch(`${baseUrl}/suggest-palette`, {
      method: "POST",
      headers: { "Content-Type": "image/png" },
      body: new Uint8Array([137, 80, 78, 71]),
    });
    expect(response.status).toBe(500);
    const json = await response.json();
    expect(json.error).toMatch(/GEMINI_API_KEY/);
  });
});
