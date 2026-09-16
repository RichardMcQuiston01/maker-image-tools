import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { syncModeratorRole } from "../src/moderators.js";
import { createUser } from "../src/users.js";
import { requireTestPool, resetTestDb, setupTestDb } from "./testDb.js";

describe("syncModeratorRole", () => {
  let pool: Pool;
  const originalModeratorEmails = process.env.MODERATOR_EMAILS;

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

  afterEach(() => {
    if (originalModeratorEmails === undefined) {
      delete process.env.MODERATOR_EMAILS;
    } else {
      process.env.MODERATOR_EMAILS = originalModeratorEmails;
    }
  });

  it("leaves the role unchanged when MODERATOR_EMAILS is unset", async () => {
    delete process.env.MODERATOR_EMAILS;
    const user = await createUser(pool, "ada@example.com", "hunter22222");
    const synced = await syncModeratorRole(pool, user);
    expect(synced.role).toBe("user");
  });

  it("leaves the role unchanged when the user's email isn't listed", async () => {
    process.env.MODERATOR_EMAILS = "someone-else@example.com";
    const user = await createUser(pool, "ada@example.com", "hunter22222");
    const synced = await syncModeratorRole(pool, user);
    expect(synced.role).toBe("user");
  });

  it("promotes a user whose email is listed (case-insensitively) and persists it", async () => {
    process.env.MODERATOR_EMAILS = "Someone@Example.com, ADA@EXAMPLE.COM";
    const user = await createUser(pool, "ada@example.com", "hunter22222");
    const synced = await syncModeratorRole(pool, user);
    expect(synced.role).toBe("moderator");

    // Persisted, not just returned in-memory.
    const { rows } = await pool.query("SELECT role FROM users WHERE id = $1", [user.id]);
    expect(rows[0].role).toBe("moderator");
  });

  it("is a no-op for an already-moderator user", async () => {
    process.env.MODERATOR_EMAILS = "ada@example.com";
    const user = await createUser(pool, "ada@example.com", "hunter22222");
    const first = await syncModeratorRole(pool, user);
    delete process.env.MODERATOR_EMAILS;
    const second = await syncModeratorRole(pool, first);
    expect(second.role).toBe("moderator");
  });
});
