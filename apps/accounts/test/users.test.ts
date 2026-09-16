import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import {
  authenticate,
  createUser,
  EmailAlreadyRegisteredError,
  findUserByEmail,
  findUserById,
  InvalidCredentialsFormatError,
} from "../src/users.js";
import { requireTestPool, resetTestDb, setupTestDb } from "./testDb.js";

describe("users", () => {
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

  it("creates a user with the default free plan tier and user role", async () => {
    const user = await createUser(pool, "Ada@Example.com", "hunter22222");
    expect(user.email).toBe("ada@example.com"); // normalized to lowercase
    expect(user.planTier).toBe("free");
    expect(user.role).toBe("user");
    expect(user.id).toBeTruthy();
  });

  it("rejects a second signup with the same (case-insensitive) email", async () => {
    await createUser(pool, "ada@example.com", "hunter22222");
    await expect(createUser(pool, "ADA@EXAMPLE.COM", "different99")).rejects.toThrow(
      EmailAlreadyRegisteredError,
    );
  });

  it("rejects an invalid email format", async () => {
    await expect(createUser(pool, "not-an-email", "hunter22222")).rejects.toThrow(
      InvalidCredentialsFormatError,
    );
  });

  it("rejects a too-short password", async () => {
    await expect(createUser(pool, "ada@example.com", "short")).rejects.toThrow(
      InvalidCredentialsFormatError,
    );
  });

  it("finds a user by email and by id", async () => {
    const created = await createUser(pool, "ada@example.com", "hunter22222");
    expect((await findUserByEmail(pool, "ada@example.com"))?.id).toBe(created.id);
    expect((await findUserById(pool, created.id))?.email).toBe("ada@example.com");
  });

  it("returns undefined for an unknown email or id", async () => {
    expect(await findUserByEmail(pool, "nobody@example.com")).toBeUndefined();
    expect(await findUserById(pool, "00000000-0000-0000-0000-000000000000")).toBeUndefined();
  });

  describe("authenticate", () => {
    it("returns the user for correct credentials", async () => {
      const created = await createUser(pool, "ada@example.com", "hunter22222");
      const user = await authenticate(pool, "ada@example.com", "hunter22222");
      expect(user?.id).toBe(created.id);
    });

    it("returns undefined for a wrong password", async () => {
      await createUser(pool, "ada@example.com", "hunter22222");
      expect(await authenticate(pool, "ada@example.com", "wrong-password")).toBeUndefined();
    });

    it("returns undefined for an unknown email", async () => {
      expect(await authenticate(pool, "nobody@example.com", "hunter22222")).toBeUndefined();
    });
  });
});
