import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import type { ObjectStore } from "../src/objectStorage.js";
import {
  createProject,
  createShareLink,
  deleteProject,
  deleteThumbnail,
  getProject,
  getSharedProject,
  getSharedThumbnail,
  getThumbnail,
  InvalidProjectInputError,
  listProjects,
  ProjectNotFoundError,
  QuotaExceededError,
  revokeShareLink,
  saveThumbnail,
  ThumbnailNotFoundError,
  updateProject,
} from "../src/projects.js";
import { quotaForPlanTier } from "../src/quotas.js";
import { createFakeObjectStore } from "./fakeS3.js";
import { requireTestPool, resetTestDb, setupTestDb } from "./testDb.js";

// apps/accounts assigns real users a Postgres-generated UUID; `user_id` here
// is typed as UUID to match, so tests use UUID-shaped literals too.
const USER_1 = "11111111-1111-1111-1111-111111111111";
const USER_2 = "22222222-2222-2222-2222-222222222222";

// Most tests here aren't about quotas, so they use the free tier's generous
// limits as a stand-in for "no limit" - actual quota enforcement gets its
// own tests below.
const FREE_QUOTA = quotaForPlanTier("free");

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
    const created = await createProject(
      pool,
      store,
      USER_1,
      "My Design",
      { layers: [] },
      FREE_QUOTA,
    );
    expect(created.name).toBe("My Design");
    expect(created.data).toEqual({ layers: [] });

    const fetched = await getProject(pool, store, USER_1, created.id);
    expect(fetched).toEqual(created);
  });

  it("rejects a blank name", async () => {
    await expect(createProject(pool, store, USER_1, "   ", {}, FREE_QUOTA)).rejects.toThrow(
      InvalidProjectInputError,
    );
  });

  it("rejects missing data", async () => {
    await expect(createProject(pool, store, USER_1, "Name", undefined, FREE_QUOTA)).rejects.toThrow(
      InvalidProjectInputError,
    );
  });

  it("lists a user's projects newest-updated first, without other users' projects", async () => {
    const a = await createProject(pool, store, USER_1, "A", { v: 1 }, FREE_QUOTA);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const b = await createProject(pool, store, USER_1, "B", { v: 2 }, FREE_QUOTA);
    await createProject(pool, store, USER_2, "Someone else's", { v: 3 }, FREE_QUOTA);

    const list = await listProjects(pool, USER_1);
    expect(list.map((p) => p.id)).toEqual([b.id, a.id]);
  });

  it("throws ProjectNotFoundError for another user's project", async () => {
    const project = await createProject(
      pool,
      store,
      USER_1,
      "Private",
      { secret: true },
      FREE_QUOTA,
    );
    await expect(getProject(pool, store, USER_2, project.id)).rejects.toThrow(ProjectNotFoundError);
  });

  it("updates a project's name and/or data independently", async () => {
    const project = await createProject(pool, store, USER_1, "Original", { v: 1 }, FREE_QUOTA);

    const renamed = await updateProject(
      pool,
      store,
      USER_1,
      project.id,
      { name: "Renamed" },
      FREE_QUOTA,
    );
    expect(renamed.name).toBe("Renamed");
    expect(renamed.data).toEqual({ v: 1 });

    const rewritten = await updateProject(
      pool,
      store,
      USER_1,
      project.id,
      { data: { v: 2 } },
      FREE_QUOTA,
    );
    expect(rewritten.name).toBe("Renamed");
    expect(rewritten.data).toEqual({ v: 2 });
  });

  it("rejects renaming to a blank name", async () => {
    const project = await createProject(pool, store, USER_1, "Original", { v: 1 }, FREE_QUOTA);
    await expect(
      updateProject(pool, store, USER_1, project.id, { name: "  " }, FREE_QUOTA),
    ).rejects.toThrow(InvalidProjectInputError);
  });

  it("deletes a project's row and its stored data", async () => {
    const project = await createProject(pool, store, USER_1, "Doomed", { v: 1 }, FREE_QUOTA);
    await deleteProject(pool, store, USER_1, project.id);
    await expect(getProject(pool, store, USER_1, project.id)).rejects.toThrow(ProjectNotFoundError);
  });

  it("creates a stable share token and revokes it", async () => {
    const project = await createProject(pool, store, USER_1, "Shared", { v: 1 }, FREE_QUOTA);
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

  describe("quota enforcement", () => {
    const TINY_QUOTA = { maxProjects: 2, maxTotalBytes: 100 };

    it("rejects creating a project past the plan's project count limit", async () => {
      await createProject(pool, store, USER_1, "A", { v: 1 }, TINY_QUOTA);
      await createProject(pool, store, USER_1, "B", { v: 2 }, TINY_QUOTA);
      await expect(createProject(pool, store, USER_1, "C", { v: 3 }, TINY_QUOTA)).rejects.toThrow(
        QuotaExceededError,
      );
    });

    it("rejects creating a project past the plan's total byte size limit", async () => {
      await expect(
        createProject(pool, store, USER_1, "Too big", { blob: "x".repeat(200) }, TINY_QUOTA),
      ).rejects.toThrow(QuotaExceededError);
    });

    it("doesn't count another user's projects against this user's quota", async () => {
      await createProject(pool, store, USER_2, "Not mine", { v: 1 }, TINY_QUOTA);
      await createProject(pool, store, USER_2, "Also not mine", { v: 2 }, TINY_QUOTA);
      const project = await createProject(pool, store, USER_1, "Mine", { v: 3 }, TINY_QUOTA);
      expect(project.name).toBe("Mine");
    });

    it("rejects growing a project's data past the plan's total byte size limit", async () => {
      const project = await createProject(pool, store, USER_1, "Original", { v: 1 }, TINY_QUOTA);
      await expect(
        updateProject(
          pool,
          store,
          USER_1,
          project.id,
          { data: { blob: "x".repeat(200) } },
          TINY_QUOTA,
        ),
      ).rejects.toThrow(QuotaExceededError);
    });

    it("allows updating a project's data that stays within the plan's byte size limit", async () => {
      const project = await createProject(pool, store, USER_1, "Original", { v: 1 }, TINY_QUOTA);
      const updated = await updateProject(
        pool,
        store,
        USER_1,
        project.id,
        { data: { v: 2 } },
        TINY_QUOTA,
      );
      expect(updated.data).toEqual({ v: 2 });
    });

    it("doesn't count project count against an update to an existing project", async () => {
      const a = await createProject(pool, store, USER_1, "A", { v: 1 }, TINY_QUOTA);
      await createProject(pool, store, USER_1, "B", { v: 2 }, TINY_QUOTA);
      const updated = await updateProject(
        pool,
        store,
        USER_1,
        a.id,
        { data: { v: 10 } },
        TINY_QUOTA,
      );
      expect(updated.data).toEqual({ v: 10 });
    });
  });

  describe("thumbnails", () => {
    const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

    it("saves a thumbnail, marks the project as having one, and reads it back", async () => {
      const project = await createProject(pool, store, USER_1, "Original", { v: 1 }, FREE_QUOTA);
      expect(project.hasThumbnail).toBe(false);

      await saveThumbnail(pool, store, USER_1, project.id, PNG_BYTES, "image/png");

      const fetched = await getProject(pool, store, USER_1, project.id);
      expect(fetched.hasThumbnail).toBe(true);

      const thumbnail = await getThumbnail(pool, store, USER_1, project.id);
      expect(thumbnail.contentType).toBe("image/png");
      expect(thumbnail.body).toEqual(PNG_BYTES);
    });

    it("rejects a non-PNG content type", async () => {
      const project = await createProject(pool, store, USER_1, "Original", { v: 1 }, FREE_QUOTA);
      await expect(
        saveThumbnail(pool, store, USER_1, project.id, PNG_BYTES, "image/jpeg"),
      ).rejects.toThrow(InvalidProjectInputError);
    });

    it("rejects an empty thumbnail body", async () => {
      const project = await createProject(pool, store, USER_1, "Original", { v: 1 }, FREE_QUOTA);
      await expect(
        saveThumbnail(pool, store, USER_1, project.id, Buffer.alloc(0), "image/png"),
      ).rejects.toThrow(InvalidProjectInputError);
    });

    it("throws ThumbnailNotFoundError for a project with no thumbnail", async () => {
      const project = await createProject(pool, store, USER_1, "Original", { v: 1 }, FREE_QUOTA);
      await expect(getThumbnail(pool, store, USER_1, project.id)).rejects.toThrow(
        ThumbnailNotFoundError,
      );
    });

    it("throws ProjectNotFoundError saving/reading a thumbnail for another user's project", async () => {
      const project = await createProject(pool, store, USER_1, "Private", { v: 1 }, FREE_QUOTA);
      await expect(
        saveThumbnail(pool, store, USER_2, project.id, PNG_BYTES, "image/png"),
      ).rejects.toThrow(ProjectNotFoundError);
      await expect(getThumbnail(pool, store, USER_2, project.id)).rejects.toThrow(
        ProjectNotFoundError,
      );
    });

    it("deletes a thumbnail, clearing hasThumbnail - idempotently, when there's none", async () => {
      const project = await createProject(pool, store, USER_1, "Original", { v: 1 }, FREE_QUOTA);
      await saveThumbnail(pool, store, USER_1, project.id, PNG_BYTES, "image/png");

      await deleteThumbnail(pool, store, USER_1, project.id);
      const fetched = await getProject(pool, store, USER_1, project.id);
      expect(fetched.hasThumbnail).toBe(false);
      await expect(getThumbnail(pool, store, USER_1, project.id)).rejects.toThrow(
        ThumbnailNotFoundError,
      );

      await expect(deleteThumbnail(pool, store, USER_1, project.id)).resolves.toBeUndefined();
    });

    it("removes the thumbnail from storage when the project is deleted", async () => {
      const project = await createProject(pool, store, USER_1, "Doomed", { v: 1 }, FREE_QUOTA);
      await saveThumbnail(pool, store, USER_1, project.id, PNG_BYTES, "image/png");
      await deleteProject(pool, store, USER_1, project.id);
      await expect(getThumbnail(pool, store, USER_1, project.id)).rejects.toThrow(
        ProjectNotFoundError,
      );
    });

    it("serves a thumbnail by share token, and errors once revoked", async () => {
      const project = await createProject(pool, store, USER_1, "Shared", { v: 1 }, FREE_QUOTA);
      await saveThumbnail(pool, store, USER_1, project.id, PNG_BYTES, "image/png");
      const token = await createShareLink(pool, USER_1, project.id);

      const thumbnail = await getSharedThumbnail(pool, store, token);
      expect(thumbnail.body).toEqual(PNG_BYTES);

      await revokeShareLink(pool, USER_1, project.id);
      await expect(getSharedThumbnail(pool, store, token)).rejects.toThrow(ProjectNotFoundError);
    });

    it("throws ThumbnailNotFoundError for a shared project with no thumbnail", async () => {
      const project = await createProject(pool, store, USER_1, "Shared", { v: 1 }, FREE_QUOTA);
      const token = await createShareLink(pool, USER_1, project.id);
      await expect(getSharedThumbnail(pool, store, token)).rejects.toThrow(ThumbnailNotFoundError);
    });
  });
});
