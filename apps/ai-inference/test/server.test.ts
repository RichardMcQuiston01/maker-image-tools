import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { createServer } from "../src/server.js";

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
});
