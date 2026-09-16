import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { getAllPresets } from "@maker/material-library";
import { getPresetHistory, searchPresets, submitPreset } from "../src/presets.js";
import { SEED_SYSTEM_ID, seedFromMaterialLibrary } from "../src/seed.js";
import { requireTestPool, resetTestDb, setupTestDb } from "./testDb.js";

describe("seedFromMaterialLibrary", () => {
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

  it("inserts every bundled preset as an approved, searchable row with the fields mapped over", async () => {
    const libraryPresets = getAllPresets();
    const result = await seedFromMaterialLibrary(pool);

    expect(result).toEqual({ inserted: libraryPresets.length, skipped: 0 });

    const sample = libraryPresets[0]!;
    const history = await getPresetHistory(
      pool,
      sample.material,
      sample.machineType,
      sample.operation,
    );
    expect(history).toHaveLength(1);
    const row = history[0]!;
    expect(row.status).toBe("approved");
    expect(row.speed).toBe(sample.speed);
    expect(row.power).toBe(sample.power);
    expect(row.passes).toBe(sample.passes ?? 1);
    expect(row.notes).toBe(sample.notes ?? null);
    expect(row.submittedBy).toBe(SEED_SYSTEM_ID);
    expect(row.reviewedBy).toBe(SEED_SYSTEM_ID);

    const found = await searchPresets(pool, {
      material: sample.material,
      machineType: sample.machineType,
      operation: sample.operation,
    });
    expect(found).toHaveLength(1);
  });

  it("is idempotent: a second run inserts nothing and skips every key", async () => {
    const first = await seedFromMaterialLibrary(pool);
    const second = await seedFromMaterialLibrary(pool);

    expect(second).toEqual({ inserted: 0, skipped: first.inserted });
  });

  it("skips a key that already has a real user submission instead of adding a duplicate version", async () => {
    const sample = getAllPresets()[0]!;
    await submitPreset(pool, {
      userId: "11111111-1111-1111-1111-111111111111",
      material: sample.material,
      machineType: sample.machineType,
      operation: sample.operation,
      speed: 1,
      power: 1,
    });

    const result = await seedFromMaterialLibrary(pool);
    expect(result.skipped).toBeGreaterThanOrEqual(1);

    const history = await getPresetHistory(
      pool,
      sample.material,
      sample.machineType,
      sample.operation,
    );
    expect(history).toHaveLength(1);
    expect(history[0]!.submittedBy).toBe("11111111-1111-1111-1111-111111111111");
  });
});
