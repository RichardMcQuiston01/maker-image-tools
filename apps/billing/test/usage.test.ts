import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { getUsageTotal, InvalidUsageQuantityError, recordUsage } from "../src/usage.js";
import { requireTestPool, resetTestDb, setupTestDb } from "./testDb.js";

// apps/accounts assigns real users a Postgres-generated UUID; `user_id` here
// is typed as UUID to match, so tests use UUID-shaped literals too.
const USER_1 = "11111111-1111-1111-1111-111111111111";
const USER_2 = "22222222-2222-2222-2222-222222222222";

describe("usage", () => {
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

  it("sums recorded usage for a user/metric pair", async () => {
    await recordUsage(pool, USER_1, "ai-inference-calls", 3);
    await recordUsage(pool, USER_1, "ai-inference-calls", 2);
    await recordUsage(pool, USER_1, "exports", 1);

    expect(await getUsageTotal(pool, USER_1, "ai-inference-calls")).toBe(5);
    expect(await getUsageTotal(pool, USER_1, "exports")).toBe(1);
  });

  it("defaults quantity to 1", async () => {
    await recordUsage(pool, USER_1, "exports");
    expect(await getUsageTotal(pool, USER_1, "exports")).toBe(1);
  });

  it("returns 0 for a metric with no recorded usage", async () => {
    expect(await getUsageTotal(pool, USER_1, "exports")).toBe(0);
  });

  it("excludes usage before the given `since` cutoff", async () => {
    await recordUsage(pool, USER_1, "exports", 1);
    const future = new Date(Date.now() + 60_000);
    expect(await getUsageTotal(pool, USER_1, "exports", future)).toBe(0);
  });

  it("keeps usage separate per user", async () => {
    await recordUsage(pool, USER_1, "exports", 4);
    await recordUsage(pool, USER_2, "exports", 9);
    expect(await getUsageTotal(pool, USER_1, "exports")).toBe(4);
    expect(await getUsageTotal(pool, USER_2, "exports")).toBe(9);
  });

  it("rejects a non-positive quantity", async () => {
    await expect(recordUsage(pool, USER_1, "exports", 0)).rejects.toThrow(
      InvalidUsageQuantityError,
    );
    await expect(recordUsage(pool, USER_1, "exports", -1)).rejects.toThrow(
      InvalidUsageQuantityError,
    );
  });

  it("rejects a non-integer quantity", async () => {
    await expect(recordUsage(pool, USER_1, "exports", 1.5)).rejects.toThrow(
      InvalidUsageQuantityError,
    );
  });
});
