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
});
