import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import type { Pool } from "pg";
import { createServer } from "../src/server.js";
import { requireTestPool, resetTestDb, setupTestDb } from "./testDb.js";

const USER_1 = "11111111-1111-1111-1111-111111111111";
const REVIEWER = "22222222-2222-2222-2222-222222222222";

describe("material-db server", () => {
  let pool: Pool;
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    pool = requireTestPool();
    await setupTestDb(pool);
    server = createServer(pool);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Expected server to bind to a numeric port");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    server.close();
    await pool.end();
  });

  beforeEach(async () => {
    await resetTestDb(pool);
  });

  function submit(overrides: Record<string, unknown> = {}) {
    return fetch(`${baseUrl}/presets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: USER_1,
        material: "Baltic Birch Plywood 3mm",
        machineType: "diode-laser",
        operation: "cut",
        speed: 300,
        power: 950,
        ...overrides,
      }),
    });
  }

  it("submits a preset and returns 201", async () => {
    const response = await submit();
    expect(response.status).toBe(201);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    const body = await response.json();
    expect(body.preset.status).toBe("pending");
    expect(body.preset.version).toBe(1);
  });

  it("rejects an invalid submission with 400", async () => {
    const response = await submit({ speed: -5 });
    expect(response.status).toBe(400);
  });

  it("excludes unapproved presets from search, and includes them once approved", async () => {
    const created = await (await submit()).json();

    const beforeApproval = await fetch(`${baseUrl}/presets`);
    expect((await beforeApproval.json()).presets).toEqual([]);

    const approveResponse = await fetch(`${baseUrl}/presets/${created.preset.id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewerId: REVIEWER }),
    });
    expect(approveResponse.status).toBe(200);
    expect((await approveResponse.json()).preset.status).toBe("approved");

    const afterApproval = await fetch(`${baseUrl}/presets`);
    const body = await afterApproval.json();
    expect(body.presets).toHaveLength(1);
    expect(body.presets[0].id).toBe(created.preset.id);
  });

  it("filters search results by query parameters", async () => {
    const plywood = await (await submit()).json();
    await fetch(`${baseUrl}/presets/${plywood.preset.id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewerId: REVIEWER }),
    });
    const acrylic = await (
      await submit({ material: "Acrylic 3mm", machineType: "co2-laser", operation: "engrave" })
    ).json();
    await fetch(`${baseUrl}/presets/${acrylic.preset.id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewerId: REVIEWER }),
    });

    const response = await fetch(`${baseUrl}/presets?machineType=co2-laser`);
    const body = await response.json();
    expect(body.presets).toHaveLength(1);
    expect(body.presets[0].material).toBe("acrylic 3mm");
  });

  it("lists pending presets for moderation", async () => {
    await submit();
    const response = await fetch(`${baseUrl}/presets/pending`);
    expect(response.status).toBe(200);
    expect((await response.json()).presets).toHaveLength(1);
  });

  it("rejects a preset via POST /presets/:id/reject", async () => {
    const created = await (await submit()).json();
    const response = await fetch(`${baseUrl}/presets/${created.preset.id}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewerId: REVIEWER, notes: "unsafe" }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.preset.status).toBe("rejected");
    expect(body.preset.reviewNotes).toBe("unsafe");
  });

  it("returns 409 when reviewing an already-reviewed preset", async () => {
    const created = await (await submit()).json();
    await fetch(`${baseUrl}/presets/${created.preset.id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewerId: REVIEWER }),
    });
    const response = await fetch(`${baseUrl}/presets/${created.preset.id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewerId: REVIEWER }),
    });
    expect(response.status).toBe(409);
  });

  it("returns full version history for a key", async () => {
    const v1 = await (await submit()).json();
    await fetch(`${baseUrl}/presets/${v1.preset.id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewerId: REVIEWER }),
    });
    await submit({ speed: 275 });

    const response = await fetch(
      `${baseUrl}/presets/history?material=Baltic+Birch+Plywood+3mm&machineType=diode-laser&operation=cut`,
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.presets.map((p: { version: number }) => p.version)).toEqual([2, 1]);
  });

  it("fetches a single preset by id", async () => {
    const created = await (await submit()).json();
    const response = await fetch(`${baseUrl}/presets/${created.preset.id}`);
    expect(response.status).toBe(200);
    expect((await response.json()).preset.id).toBe(created.preset.id);
  });

  it("returns 404 for an unknown preset id", async () => {
    const response = await fetch(`${baseUrl}/presets/00000000-0000-0000-0000-000000000000`);
    expect(response.status).toBe(404);
  });

  it("rejects a request body that isn't valid JSON with 400", async () => {
    const response = await fetch(`${baseUrl}/presets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    expect(response.status).toBe(400);
  });

  it("answers CORS preflight requests", async () => {
    const response = await fetch(`${baseUrl}/presets`, { method: "OPTIONS" });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-methods")).toContain("POST");
  });

  it("returns 404 for unknown routes", async () => {
    const response = await fetch(`${baseUrl}/nope`);
    expect(response.status).toBe(404);
  });
});
