import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import type { Pool } from "pg";
import { createServer } from "../src/server.js";
import type { ObjectStore } from "../src/objectStorage.js";
import { createFakeObjectStore } from "./fakeS3.js";
import { requireTestPool, resetTestDb, setupTestDb } from "./testDb.js";

const USER_1 = "11111111-1111-1111-1111-111111111111";
const USER_2 = "22222222-2222-2222-2222-222222222222";

describe("cloud-projects server", () => {
  let pool: Pool;
  let store: ObjectStore;
  let server: Server;
  let baseUrl: string;

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
  });

  async function createProject(userId: string, name: string, data: unknown) {
    return fetch(`${baseUrl}/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, name, data }),
    });
  }

  it("creates a project and returns 201", async () => {
    const response = await createProject(USER_1, "My Design", { layers: [] });
    expect(response.status).toBe(201);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    const body = await response.json();
    expect(body.project.name).toBe("My Design");
    expect(body.project.data).toEqual({ layers: [] });
  });

  it("lists only the requesting user's projects", async () => {
    await createProject(USER_1, "Mine", { v: 1 });
    await createProject(USER_2, "Theirs", { v: 2 });

    const response = await fetch(`${baseUrl}/projects?userId=${USER_1}`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.projects).toHaveLength(1);
    expect(body.projects[0].name).toBe("Mine");
  });

  it("requires a userId query parameter to list projects", async () => {
    const response = await fetch(`${baseUrl}/projects`);
    expect(response.status).toBe(400);
  });

  it("fetches a single project by id, scoped to its owner", async () => {
    const created = await (await createProject(USER_1, "Mine", { v: 1 })).json();

    const ok = await fetch(`${baseUrl}/projects/${created.project.id}?userId=${USER_1}`);
    expect(ok.status).toBe(200);
    expect((await ok.json()).project.data).toEqual({ v: 1 });

    const wrongUser = await fetch(`${baseUrl}/projects/${created.project.id}?userId=${USER_2}`);
    expect(wrongUser.status).toBe(404);
  });

  it("returns 404 for an unknown project id", async () => {
    const response = await fetch(
      `${baseUrl}/projects/00000000-0000-0000-0000-000000000000?userId=${USER_1}`,
    );
    expect(response.status).toBe(404);
  });

  it("updates a project's name and data via PUT", async () => {
    const created = await (await createProject(USER_1, "Original", { v: 1 })).json();

    const response = await fetch(`${baseUrl}/projects/${created.project.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: USER_1, name: "Renamed", data: { v: 2 } }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.project.name).toBe("Renamed");
    expect(body.project.data).toEqual({ v: 2 });
  });

  it("deletes a project via DELETE", async () => {
    const created = await (await createProject(USER_1, "Doomed", { v: 1 })).json();

    const deleteResponse = await fetch(
      `${baseUrl}/projects/${created.project.id}?userId=${USER_1}`,
      { method: "DELETE" },
    );
    expect(deleteResponse.status).toBe(204);

    const getResponse = await fetch(`${baseUrl}/projects/${created.project.id}?userId=${USER_1}`);
    expect(getResponse.status).toBe(404);
  });

  it("creates a share link and serves the project publicly through it", async () => {
    const created = await (await createProject(USER_1, "Shared", { v: 1 })).json();

    const shareResponse = await fetch(`${baseUrl}/projects/${created.project.id}/share`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: USER_1 }),
    });
    expect(shareResponse.status).toBe(200);
    const { token } = await shareResponse.json();

    const publicResponse = await fetch(`${baseUrl}/shared/${token}`);
    expect(publicResponse.status).toBe(200);
    expect((await publicResponse.json()).project.data).toEqual({ v: 1 });

    const revokeResponse = await fetch(`${baseUrl}/projects/${created.project.id}/share`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: USER_1 }),
    });
    expect(revokeResponse.status).toBe(204);

    const afterRevoke = await fetch(`${baseUrl}/shared/${token}`);
    expect(afterRevoke.status).toBe(404);
  });

  it("rejects a request body that isn't valid JSON with 400", async () => {
    const response = await fetch(`${baseUrl}/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
});
