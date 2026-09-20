import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import type { Pool } from "pg";
import { createServer } from "../src/server.js";
import type { ObjectStore } from "../src/objectStorage.js";
import { createFakeObjectStore } from "./fakeS3.js";
import { startFakeAccounts, type FakeAccounts } from "./fakeAccounts.js";
import { startFakeBilling, type FakeBilling } from "./fakeBilling.js";
import { requireTestPool, resetTestDb, setupTestDb } from "./testDb.js";

const USER_1 = "11111111-1111-1111-1111-111111111111";
const USER_2 = "22222222-2222-2222-2222-222222222222";
const TOKEN_1 = "user-1-token";
const TOKEN_2 = "user-2-token";

describe("cloud-projects server", () => {
  let pool: Pool;
  let store: ObjectStore;
  let server: Server;
  let baseUrl: string;
  let accounts: FakeAccounts;
  let billing: FakeBilling;
  const originalAccountsUrl = process.env.ACCOUNTS_URL;
  const originalBillingUrl = process.env.BILLING_URL;

  beforeAll(async () => {
    pool = requireTestPool();
    await setupTestDb(pool);
    store = createFakeObjectStore();
    server = createServer(pool, store);
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
    accounts = await startFakeAccounts({ [TOKEN_1]: USER_1, [TOKEN_2]: USER_2 });
    process.env.ACCOUNTS_URL = accounts.baseUrl;
    billing = await startFakeBilling({});
    process.env.BILLING_URL = billing.baseUrl;
  });

  afterEach(async () => {
    await accounts.close();
    await billing.close();
    if (originalAccountsUrl === undefined) delete process.env.ACCOUNTS_URL;
    else process.env.ACCOUNTS_URL = originalAccountsUrl;
    if (originalBillingUrl === undefined) delete process.env.BILLING_URL;
    else process.env.BILLING_URL = originalBillingUrl;
  });

  function authHeaders(token: string): Record<string, string> {
    return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
  }

  async function createProject(token: string, name: string, data: unknown) {
    return fetch(`${baseUrl}/projects`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ name, data }),
    });
  }

  it("creates a project and returns 201", async () => {
    const response = await createProject(TOKEN_1, "My Design", { layers: [] });
    expect(response.status).toBe(201);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    const body = await response.json();
    expect(body.project.name).toBe("My Design");
    expect(body.project.data).toEqual({ layers: [] });
  });

  it("lists only the requesting user's projects", async () => {
    await createProject(TOKEN_1, "Mine", { v: 1 });
    await createProject(TOKEN_2, "Theirs", { v: 2 });

    const response = await fetch(`${baseUrl}/projects`, { headers: authHeaders(TOKEN_1) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.projects).toHaveLength(1);
    expect(body.projects[0].name).toBe("Mine");
  });

  it("rejects a request with no bearer token with 401", async () => {
    const response = await fetch(`${baseUrl}/projects`);
    expect(response.status).toBe(401);
  });

  it("rejects a request with an invalid bearer token with 401", async () => {
    const response = await fetch(`${baseUrl}/projects`, {
      headers: { Authorization: "Bearer not-a-real-token" },
    });
    expect(response.status).toBe(401);
  });

  it("fetches a single project by id, scoped to its owner", async () => {
    const created = await (await createProject(TOKEN_1, "Mine", { v: 1 })).json();

    const ok = await fetch(`${baseUrl}/projects/${created.project.id}`, {
      headers: authHeaders(TOKEN_1),
    });
    expect(ok.status).toBe(200);
    expect((await ok.json()).project.data).toEqual({ v: 1 });

    const wrongUser = await fetch(`${baseUrl}/projects/${created.project.id}`, {
      headers: authHeaders(TOKEN_2),
    });
    expect(wrongUser.status).toBe(404);
  });

  it("returns 404 for an unknown project id", async () => {
    const response = await fetch(`${baseUrl}/projects/00000000-0000-0000-0000-000000000000`, {
      headers: authHeaders(TOKEN_1),
    });
    expect(response.status).toBe(404);
  });

  it("updates a project's name and data via PUT", async () => {
    const created = await (await createProject(TOKEN_1, "Original", { v: 1 })).json();

    const response = await fetch(`${baseUrl}/projects/${created.project.id}`, {
      method: "PUT",
      headers: authHeaders(TOKEN_1),
      body: JSON.stringify({ name: "Renamed", data: { v: 2 } }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.project.name).toBe("Renamed");
    expect(body.project.data).toEqual({ v: 2 });
  });

  it("rejects updating another user's project with 404", async () => {
    const created = await (await createProject(TOKEN_1, "Original", { v: 1 })).json();

    const response = await fetch(`${baseUrl}/projects/${created.project.id}`, {
      method: "PUT",
      headers: authHeaders(TOKEN_2),
      body: JSON.stringify({ name: "Hijacked" }),
    });
    expect(response.status).toBe(404);
  });

  it("deletes a project via DELETE", async () => {
    const created = await (await createProject(TOKEN_1, "Doomed", { v: 1 })).json();

    const deleteResponse = await fetch(`${baseUrl}/projects/${created.project.id}`, {
      method: "DELETE",
      headers: authHeaders(TOKEN_1),
    });
    expect(deleteResponse.status).toBe(204);

    const getResponse = await fetch(`${baseUrl}/projects/${created.project.id}`, {
      headers: authHeaders(TOKEN_1),
    });
    expect(getResponse.status).toBe(404);
  });

  it("rejects deleting another user's project with 404, leaving it intact", async () => {
    const created = await (await createProject(TOKEN_1, "Mine", { v: 1 })).json();

    const deleteResponse = await fetch(`${baseUrl}/projects/${created.project.id}`, {
      method: "DELETE",
      headers: authHeaders(TOKEN_2),
    });
    expect(deleteResponse.status).toBe(404);

    const getResponse = await fetch(`${baseUrl}/projects/${created.project.id}`, {
      headers: authHeaders(TOKEN_1),
    });
    expect(getResponse.status).toBe(200);
  });

  it("creates a share link and serves the project publicly through it", async () => {
    const created = await (await createProject(TOKEN_1, "Shared", { v: 1 })).json();

    const shareResponse = await fetch(`${baseUrl}/projects/${created.project.id}/share`, {
      method: "POST",
      headers: authHeaders(TOKEN_1),
    });
    expect(shareResponse.status).toBe(200);
    const { token } = await shareResponse.json();

    const publicResponse = await fetch(`${baseUrl}/shared/${token}`);
    expect(publicResponse.status).toBe(200);
    expect((await publicResponse.json()).project.data).toEqual({ v: 1 });

    const revokeResponse = await fetch(`${baseUrl}/projects/${created.project.id}/share`, {
      method: "DELETE",
      headers: authHeaders(TOKEN_1),
    });
    expect(revokeResponse.status).toBe(204);

    const afterRevoke = await fetch(`${baseUrl}/shared/${token}`);
    expect(afterRevoke.status).toBe(404);
  });

  it("rejects creating a share link for another user's project with 404", async () => {
    const created = await (await createProject(TOKEN_1, "Mine", { v: 1 })).json();

    const shareResponse = await fetch(`${baseUrl}/projects/${created.project.id}/share`, {
      method: "POST",
      headers: authHeaders(TOKEN_2),
    });
    expect(shareResponse.status).toBe(404);
  });

  it("rejects a request body that isn't valid JSON with 400", async () => {
    const response = await fetch(`${baseUrl}/projects`, {
      method: "POST",
      headers: authHeaders(TOKEN_1),
      body: "not json",
    });
    expect(response.status).toBe(400);
  });

  it("answers CORS preflight requests", async () => {
    const response = await fetch(`${baseUrl}/projects`, { method: "OPTIONS" });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-methods")).toContain("DELETE");
  });

  it("returns 404 for unknown routes", async () => {
    const response = await fetch(`${baseUrl}/nope`);
    expect(response.status).toBe(404);
  });

  it("rejects creating a project past the free tier's project count limit with 402", async () => {
    for (let i = 0; i < 10; i++) {
      const response = await createProject(TOKEN_1, `Project ${i}`, { v: i });
      expect(response.status).toBe(201);
    }
    const overLimit = await createProject(TOKEN_1, "One too many", { v: 10 });
    expect(overLimit.status).toBe(402);
  });

  it("rejects creating a project past the free tier's total byte size limit with 402", async () => {
    const bigData = { blob: "x".repeat(6 * 1024 * 1024) };
    const response = await createProject(TOKEN_1, "Too big", bigData);
    expect(response.status).toBe(402);
  });

  it("rejects updating a project's data past the free tier's byte size limit with 402", async () => {
    const created = await (await createProject(TOKEN_1, "Original", { v: 1 })).json();
    const bigData = { blob: "x".repeat(6 * 1024 * 1024) };

    const response = await fetch(`${baseUrl}/projects/${created.project.id}`, {
      method: "PUT",
      headers: authHeaders(TOKEN_1),
      body: JSON.stringify({ data: bigData }),
    });
    expect(response.status).toBe(402);
  });

  it("allows the pro tier's higher project count and byte size limits", async () => {
    await billing.close();
    billing = await startFakeBilling({ [USER_1]: "pro" });
    process.env.BILLING_URL = billing.baseUrl;

    for (let i = 0; i < 10; i++) {
      const response = await createProject(TOKEN_1, `Project ${i}`, { v: i });
      expect(response.status).toBe(201);
    }
    const bigData = { blob: "x".repeat(6 * 1024 * 1024) };
    const response = await createProject(TOKEN_1, "Still fits", bigData);
    expect(response.status).toBe(201);
  });
});
