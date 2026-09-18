import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import type { Pool } from "pg";
import { createServer } from "../src/server.js";
import type { ObjectStore } from "../src/objectStorage.js";
import { startFakeAccounts, type FakeAccounts } from "./fakeAccounts.js";
import { createFakeObjectStore } from "./fakeS3.js";
import { requireTestPool, resetTestDb, setupTestDb } from "./testDb.js";

const USER_1 = "11111111-1111-1111-1111-111111111111";
const USER_2 = "22222222-2222-2222-2222-222222222222";
const REVIEWER = "33333333-3333-3333-3333-333333333333";
const NON_MODERATOR = "44444444-4444-4444-4444-444444444444";

describe("community-library server", () => {
  let pool: Pool;
  let store: ObjectStore;
  let server: Server;
  let baseUrl: string;
  let fakeAccounts: FakeAccounts;

  beforeAll(async () => {
    pool = requireTestPool();
    await setupTestDb(pool);
    store = createFakeObjectStore();
    fakeAccounts = await startFakeAccounts([REVIEWER]);
    process.env.ACCOUNTS_URL = fakeAccounts.baseUrl;
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
    await fakeAccounts.close();
  });

  beforeEach(async () => {
    await resetTestDb(pool);
  });

  function publish(overrides: Record<string, unknown> = {}) {
    return fetch(`${baseUrl}/listings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: USER_1,
        title: "Keychain Fox",
        description: "A laser-cut fox keychain",
        tags: ["keychain"],
        data: { layers: [] },
        ...overrides,
      }),
    });
  }

  function approve(id: string) {
    return fetch(`${baseUrl}/listings/${id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewerId: REVIEWER }),
    });
  }

  it("publishes a listing and returns 201", async () => {
    const response = await publish();
    expect(response.status).toBe(201);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    const body = await response.json();
    expect(body.listing.status).toBe("pending");
    expect(body.listing.tags).toEqual(["keychain"]);
  });

  it("rejects an invalid submission with 400", async () => {
    const response = await publish({ title: "" });
    expect(response.status).toBe(400);
  });

  it("excludes unapproved listings from browse, includes them once approved", async () => {
    const created = await (await publish()).json();

    const before = await fetch(`${baseUrl}/listings`);
    expect((await before.json()).listings).toEqual([]);

    const approveResponse = await approve(created.listing.id);
    expect(approveResponse.status).toBe(200);

    const after = await fetch(`${baseUrl}/listings`);
    const body = await after.json();
    expect(body.listings).toHaveLength(1);
    expect(body.listings[0].id).toBe(created.listing.id);
  });

  it("searches by query text and tag", async () => {
    const fox = await (await publish()).json();
    await approve(fox.listing.id);
    const box = await (
      await publish({ title: "Storage Box", description: "box joint container", tags: ["box"] })
    ).json();
    await approve(box.listing.id);

    const byQuery = await fetch(`${baseUrl}/listings?q=fox`);
    expect((await byQuery.json()).listings).toHaveLength(1);

    const byTag = await fetch(`${baseUrl}/listings?tag=box`);
    const byTagBody = await byTag.json();
    expect(byTagBody.listings).toHaveLength(1);
    expect(byTagBody.listings[0].title).toBe("Storage Box");
  });

  it("lists pending listings for moderation", async () => {
    await publish();
    const response = await fetch(`${baseUrl}/listings/pending`);
    expect(response.status).toBe(200);
    expect((await response.json()).listings).toHaveLength(1);
  });

  it("rejects a listing via POST /listings/:id/reject", async () => {
    const created = await (await publish()).json();
    const response = await fetch(`${baseUrl}/listings/${created.listing.id}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewerId: REVIEWER, notes: "low effort" }),
    });
    expect(response.status).toBe(200);
    expect((await response.json()).listing.status).toBe("rejected");
  });

  it("rejects an approve/reject attempt from a reviewerId that isn't a moderator", async () => {
    const created = await (await publish()).json();
    const response = await fetch(`${baseUrl}/listings/${created.listing.id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewerId: NON_MODERATOR }),
    });
    expect(response.status).toBe(403);

    const pending = await fetch(`${baseUrl}/listings/pending`);
    expect((await pending.json()).listings).toHaveLength(1);
  });

  it("returns 409 when reviewing an already-reviewed listing", async () => {
    const created = await (await publish()).json();
    await approve(created.listing.id);
    const response = await approve(created.listing.id);
    expect(response.status).toBe(409);
  });

  it("fetches a single listing including its data", async () => {
    const created = await (await publish()).json();
    const response = await fetch(`${baseUrl}/listings/${created.listing.id}`);
    expect(response.status).toBe(200);
    expect((await response.json()).listing.data).toEqual({ layers: [] });
  });

  it("returns 404 for an unknown listing id", async () => {
    const response = await fetch(`${baseUrl}/listings/00000000-0000-0000-0000-000000000000`);
    expect(response.status).toBe(404);
  });

  it("deletes a listing, owner-only", async () => {
    const created = await (await publish()).json();

    const wrongOwner = await fetch(`${baseUrl}/listings/${created.listing.id}?userId=${USER_2}`, {
      method: "DELETE",
    });
    expect(wrongOwner.status).toBe(404);

    const owner = await fetch(`${baseUrl}/listings/${created.listing.id}?userId=${USER_1}`, {
      method: "DELETE",
    });
    expect(owner.status).toBe(204);

    const getResponse = await fetch(`${baseUrl}/listings/${created.listing.id}`);
    expect(getResponse.status).toBe(404);
  });

  it("rates a listing and returns the updated aggregate", async () => {
    const created = await (await publish()).json();
    await approve(created.listing.id);

    const response = await fetch(`${baseUrl}/listings/${created.listing.id}/ratings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: USER_2, stars: 5, comment: "great" }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.rating.stars).toBe(5);
    expect(body.listing.ratingAvg).toBe(5);
    expect(body.listing.ratingCount).toBe(1);

    const listResponse = await fetch(`${baseUrl}/listings/${created.listing.id}/ratings`);
    expect(listResponse.status).toBe(200);
    expect((await listResponse.json()).ratings).toHaveLength(1);
  });

  it("rejects an out-of-range rating with 400", async () => {
    const created = await (await publish()).json();
    await approve(created.listing.id);

    const response = await fetch(`${baseUrl}/listings/${created.listing.id}/ratings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: USER_2, stars: 9 }),
    });
    expect(response.status).toBe(400);
  });

  it("rejects a request body that isn't valid JSON with 400", async () => {
    const response = await fetch(`${baseUrl}/listings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    expect(response.status).toBe(400);
  });

  it("answers CORS preflight requests", async () => {
    const response = await fetch(`${baseUrl}/listings`, { method: "OPTIONS" });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-methods")).toContain("DELETE");
  });

  it("returns 404 for unknown routes", async () => {
    const response = await fetch(`${baseUrl}/nope`);
    expect(response.status).toBe(404);
  });
});
