import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import {
  createSession,
  deleteExpiredSessions,
  deleteSession,
  validateSession,
} from "../src/sessions.js";
import { createUser } from "../src/users.js";
import { requireTestPool, resetTestDb, setupTestDb } from "./testDb.js";

describe("sessions", () => {
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

  it("validates a freshly created session back to its user", async () => {
    const user = await createUser(pool, "ada@example.com", "hunter22222");
    const session = await createSession(pool, user.id);
    const validated = await validateSession(pool, session.token);
    expect(validated?.id).toBe(user.id);
  });

  it("rejects an unknown token", async () => {
    expect(await validateSession(pool, "not-a-real-token")).toBeUndefined();
  });

  it("rejects an already-expired session", async () => {
    const user = await createUser(pool, "ada@example.com", "hunter22222");
    const session = await createSession(pool, user.id, -1000); // expired 1s ago
    expect(await validateSession(pool, session.token)).toBeUndefined();
  });

  it("stops validating a session after logout", async () => {
    const user = await createUser(pool, "ada@example.com", "hunter22222");
    const session = await createSession(pool, user.id);
    await deleteSession(pool, session.token);
    expect(await validateSession(pool, session.token)).toBeUndefined();
  });

  it("issues a different token for each session", async () => {
    const user = await createUser(pool, "ada@example.com", "hunter22222");
    const a = await createSession(pool, user.id);
    const b = await createSession(pool, user.id);
    expect(a.token).not.toBe(b.token);
  });

  describe("deleteExpiredSessions", () => {
    it("deletes only expired sessions, leaving unexpired ones valid", async () => {
      const user = await createUser(pool, "ada@example.com", "hunter22222");
      const expired = await createSession(pool, user.id, -1000);
      const active = await createSession(pool, user.id);

      const deletedCount = await deleteExpiredSessions(pool);
      expect(deletedCount).toBe(1);

      expect(await validateSession(pool, expired.token)).toBeUndefined();
      expect((await validateSession(pool, active.token))?.id).toBe(user.id);
    });

    it("returns 0 when there's nothing to clean up", async () => {
      const user = await createUser(pool, "ada@example.com", "hunter22222");
      await createSession(pool, user.id);
      expect(await deleteExpiredSessions(pool)).toBe(0);
    });
  });
});
