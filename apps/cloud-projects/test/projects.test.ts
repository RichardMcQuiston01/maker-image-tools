import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import type { ObjectStore } from "../src/objectStorage.js";
import {
  createProject,
  createShareLink,
  deleteProject,
  getProject,
  getSharedProject,
  InvalidProjectInputError,
  listProjects,
  ProjectNotFoundError,
  revokeShareLink,
  updateProject,
} from "../src/projects.js";
import { createFakeObjectStore } from "./fakeS3.js";
import { requireTestPool, resetTestDb, setupTestDb } from "./testDb.js";

// apps/accounts assigns real users a Postgres-generated UUID; `user_id` here
// is typed as UUID to match, so tests use UUID-shaped literals too.
const USER_1 = "11111111-1111-1111-1111-111111111111";
const USER_2 = "22222222-2222-2222-2222-222222222222";

describe("projects", () => {
  let pool: Pool;
  let store: ObjectStore;

  beforeAll(async () => {
    pool = requireTestPool();
    await setupTestDb(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await resetTestDb(pool);
    store = createFakeObjectStore();
  });

  it("creates a project and reads it back with its data", async () => {
    const created = await createProject(pool, store, USER_1, "My Design", { layers: [] });
    expect(created.name).toBe("My Design");
    expect(created.data).toEqual({ layers: [] });

    const fetched = await getProject(pool, store, USER_1, created.id);
    expect(fetched).toEqual(created);
  });

  it("rejects a blank name", async () => {
    await expect(createProject(pool, store, USER_1, "   ", {})).rejects.toThrow(
      InvalidProjectInputError,
    );
  });

  it("rejects missing data", async () => {
    await expect(createProject(pool, store, USER_1, "Name", undefined)).rejects.toThrow(
      InvalidProjectInputError,
    );
  });

  it("lists a user's projects newest-updated first, without other users' projects", async () => {
    const a = await createProject(pool, store, USER_1, "A", { v: 1 });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const b = await createProject(pool, store, USER_1, "B", { v: 2 });
    await createProject(pool, store, USER_2, "Someone else's", { v: 3 });

    const list = await listProjects(pool, USER_1);
    expect(list.map((p) => p.id)).toEqual([b.id, a.id]);
  });

  it("throws ProjectNotFoundError for another user's project", async () => {
    const project = await createProject(pool, store, USER_1, "Private", { secret: true });
    await expect(getProject(pool, store, USER_2, project.id)).rejects.toThrow(ProjectNotFoundError);
  });

  it("updates a project's name and/or data independently", async () => {
    const project = await createProject(pool, store, USER_1, "Original", { v: 1 });

    const renamed = await updateProject(pool, store, USER_1, project.id, { name: "Renamed" });
    expect(renamed.name).toBe("Renamed");
    expect(renamed.data).toEqual({ v: 1 });

    const rewritten = await updateProject(pool, store, USER_1, project.id, { data: { v: 2 } });
    expect(rewritten.name).toBe("Renamed");
    expect(rewritten.data).toEqual({ v: 2 });
  });

  it("rejects renaming to a blank name", async () => {
    const project = await createProject(pool, store, USER_1, "Original", { v: 1 });
    await expect(updateProject(pool, store, USER_1, project.id, { name: "  " })).rejects.toThrow(
      InvalidProjectInputError,
    );
  });

  it("deletes a project's row and its stored data", async () => {
    const project = await createProject(pool, store, USER_1, "Doomed", { v: 1 });
    await deleteProject(pool, store, USER_1, project.id);
    await expect(getProject(pool, store, USER_1, project.id)).rejects.toThrow(ProjectNotFoundError);
  });

  it("creates a stable share token and revokes it", async () => {
    const project = await createProject(pool, store, USER_1, "Shared", { v: 1 });
    const token = await createShareLink(pool, USER_1, project.id);
    expect(token).toMatch(/^[\w-]+$/);
    expect(await createShareLink(pool, USER_1, project.id)).toBe(token);

    const shared = await getSharedProject(pool, store, token);
    expect(shared.id).toBe(project.id);
    expect(shared.data).toEqual({ v: 1 });

    await revokeShareLink(pool, USER_1, project.id);
    await expect(getSharedProject(pool, store, token)).rejects.toThrow(ProjectNotFoundError);
  });

  it("throws ProjectNotFoundError for an unknown share token", async () => {
    await expect(getSharedProject(pool, store, "not-a-real-token")).rejects.toThrow(
      ProjectNotFoundError,
    );
  });
});
