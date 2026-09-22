import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import {
  addCollaborator,
  CannotCollaborateWithSelfError,
  listCollaborators,
  removeCollaborator,
} from "../src/collaborators.js";
import { createProject, NotProjectOwnerError, ProjectNotFoundError } from "../src/projects.js";
import { quotaForPlanTier } from "../src/quotas.js";
import { createFakeObjectStore } from "./fakeS3.js";
import { requireTestPool, resetTestDb, setupTestDb } from "./testDb.js";

const USER_1 = "11111111-1111-1111-1111-111111111111";
const USER_2 = "22222222-2222-2222-2222-222222222222";
const USER_3 = "33333333-3333-3333-3333-333333333333";
const FREE_QUOTA = quotaForPlanTier("free");

describe("collaborators", () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = requireTestPool();
    await setupTestDb(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await resetTestDb(pool);
  });

  async function ownedProject() {
    const store = createFakeObjectStore();
    return createProject(pool, store, USER_1, "Original", { v: 1 }, FREE_QUOTA);
  }

  it("adds a collaborator and lists them", async () => {
    const project = await ownedProject();
    const collaborators = await addCollaborator(pool, USER_1, project.id, USER_2);
    expect(collaborators).toEqual([{ userId: USER_2, addedAt: expect.any(String) }]);
    expect(await listCollaborators(pool, USER_1, project.id)).toEqual(collaborators);
  });

  it("lets an added collaborator list the collaborator roster too", async () => {
    const project = await ownedProject();
    await addCollaborator(pool, USER_1, project.id, USER_2);
    expect(await listCollaborators(pool, USER_2, project.id)).toHaveLength(1);
  });

  it("is idempotent - adding the same collaborator twice doesn't duplicate them", async () => {
    const project = await ownedProject();
    await addCollaborator(pool, USER_1, project.id, USER_2);
    const collaborators = await addCollaborator(pool, USER_1, project.id, USER_2);
    expect(collaborators).toHaveLength(1);
  });

  it("supports multiple collaborators on one project", async () => {
    const project = await ownedProject();
    await addCollaborator(pool, USER_1, project.id, USER_2);
    const collaborators = await addCollaborator(pool, USER_1, project.id, USER_3);
    expect(collaborators.map((c) => c.userId).sort()).toEqual([USER_2, USER_3].sort());
  });

  it("rejects the owner adding themselves as their own collaborator", async () => {
    const project = await ownedProject();
    await expect(addCollaborator(pool, USER_1, project.id, USER_1)).rejects.toThrow(
      CannotCollaborateWithSelfError,
    );
  });

  it("rejects a non-owner adding a collaborator with NotProjectOwnerError", async () => {
    const project = await ownedProject();
    await addCollaborator(pool, USER_1, project.id, USER_2);
    await expect(addCollaborator(pool, USER_2, project.id, USER_3)).rejects.toThrow(
      NotProjectOwnerError,
    );
  });

  it("rejects adding a collaborator to a project the caller has no access to at all", async () => {
    const project = await ownedProject();
    await expect(addCollaborator(pool, USER_2, project.id, USER_3)).rejects.toThrow(
      ProjectNotFoundError,
    );
  });

  it("removes a collaborator", async () => {
    const project = await ownedProject();
    await addCollaborator(pool, USER_1, project.id, USER_2);
    const collaborators = await removeCollaborator(pool, USER_1, project.id, USER_2);
    expect(collaborators).toEqual([]);
  });

  it("is idempotent - removing a non-collaborator is a no-op", async () => {
    const project = await ownedProject();
    const collaborators = await removeCollaborator(pool, USER_1, project.id, USER_2);
    expect(collaborators).toEqual([]);
  });

  it("rejects a non-owner removing a collaborator with NotProjectOwnerError", async () => {
    const project = await ownedProject();
    await addCollaborator(pool, USER_1, project.id, USER_2);
    await expect(removeCollaborator(pool, USER_2, project.id, USER_2)).rejects.toThrow(
      NotProjectOwnerError,
    );
  });

  it("rejects listing collaborators for a caller with no access to the project", async () => {
    const project = await ownedProject();
    await expect(listCollaborators(pool, USER_2, project.id)).rejects.toThrow(ProjectNotFoundError);
  });
});
