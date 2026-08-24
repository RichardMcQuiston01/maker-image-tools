import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { createServer } from "../src/server.js";
import { decodeDepthMap, encodeRgbaImage } from "../src/wire-image.js";

describe("ai-inference server", () => {
  let server: Server;
  let baseUrl: string;

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

  it("classifies an uploaded image via POST /classify-material", async () => {
    const body = new Uint8Array([137, 80, 78, 71]); // arbitrary bytes; the stub doesn't inspect content
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

  it("generates a placeholder image via POST /generate-image", async () => {
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
});
