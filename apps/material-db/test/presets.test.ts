import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import {
  approvePreset,
  findSimilarApprovedPreset,
  getPresetById,
  getPresetHistory,
  InvalidPresetInputError,
  listPendingPresets,
  PresetNotFoundError,
  PresetNotPendingError,
  rejectPreset,
  searchPresets,
  submitPreset,
} from "../src/presets.js";
import { requireTestPool, resetTestDb, setupTestDb } from "./testDb.js";

// apps/accounts assigns real users a Postgres-generated UUID; `submitted_by`/
// `reviewed_by` here are typed as UUID to match, so tests use UUID-shaped
// literals too.
const USER_1 = "11111111-1111-1111-1111-111111111111";
const USER_2 = "22222222-2222-2222-2222-222222222222";

function baseSubmission(overrides: Partial<Parameters<typeof submitPreset>[1]> = {}) {
  return {
    userId: USER_1,
    material: "Baltic Birch Plywood 3mm",
    machineType: "diode-laser",
    operation: "cut",
    speed: 300,
    power: 950,
    ...overrides,
  };
}

describe("presets", () => {
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

  describe("submitPreset", () => {
    it("creates a pending, version-1 submission and normalizes the key fields", async () => {
      const preset = await submitPreset(
        pool,
        baseSubmission({ material: "  Baltic Birch Plywood 3mm  " }),
      );
      expect(preset.status).toBe("pending");
      expect(preset.version).toBe(1);
      expect(preset.material).toBe("baltic birch plywood 3mm");
      expect(preset.passes).toBe(1);
      expect(preset.submittedBy).toBe(USER_1);
    });

    it("increments the version for repeat submissions of the same key", async () => {
      await submitPreset(pool, baseSubmission());
      const second = await submitPreset(pool, baseSubmission({ speed: 250 }));
      expect(second.version).toBe(2);
    });

    it("rejects a blank material/machineType/operation", async () => {
      await expect(submitPreset(pool, baseSubmission({ material: "  " }))).rejects.toThrow(
        InvalidPresetInputError,
      );
      await expect(submitPreset(pool, baseSubmission({ machineType: "" }))).rejects.toThrow(
        InvalidPresetInputError,
      );
      await expect(submitPreset(pool, baseSubmission({ operation: "" }))).rejects.toThrow(
        InvalidPresetInputError,
      );
    });

    it("rejects a non-positive speed or power", async () => {
      await expect(submitPreset(pool, baseSubmission({ speed: 0 }))).rejects.toThrow(
        InvalidPresetInputError,
      );
      await expect(submitPreset(pool, baseSubmission({ power: -1 }))).rejects.toThrow(
        InvalidPresetInputError,
      );
    });

    it("rejects a non-positive-integer passes", async () => {
      await expect(submitPreset(pool, baseSubmission({ passes: 0 }))).rejects.toThrow(
        InvalidPresetInputError,
      );
      await expect(submitPreset(pool, baseSubmission({ passes: 1.5 }))).rejects.toThrow(
        InvalidPresetInputError,
      );
    });
  });

  describe("searchPresets", () => {
    it("only returns approved presets", async () => {
      const pending = await submitPreset(pool, baseSubmission());
      expect(await searchPresets(pool, {})).toEqual([]);

      await approvePreset(pool, pending.id, USER_2);
      const results = await searchPresets(pool, {});
      expect(results).toHaveLength(1);
      expect(results[0]!.status).toBe("approved");
    });

    it("returns only the highest approved version per key", async () => {
      const v1 = await submitPreset(pool, baseSubmission());
      await approvePreset(pool, v1.id, USER_2);
      const v2 = await submitPreset(pool, baseSubmission({ speed: 275 }));
      await approvePreset(pool, v2.id, USER_2);

      const results = await searchPresets(pool, {});
      expect(results).toHaveLength(1);
      expect(results[0]!.version).toBe(2);
      expect(results[0]!.speed).toBe(275);
    });

    it("filters by material full-text search, machineType, and operation", async () => {
      const plywood = await submitPreset(pool, baseSubmission());
      await approvePreset(pool, plywood.id, USER_2);
      const acrylic = await submitPreset(
        pool,
        baseSubmission({ material: "Acrylic 3mm", machineType: "co2-laser", operation: "engrave" }),
      );
      await approvePreset(pool, acrylic.id, USER_2);

      expect((await searchPresets(pool, { material: "birch" })).map((p) => p.material)).toEqual([
        "baltic birch plywood 3mm",
      ]);
      expect(
        (await searchPresets(pool, { machineType: "co2-laser" })).map((p) => p.material),
      ).toEqual(["acrylic 3mm"]);
      expect((await searchPresets(pool, { operation: "engrave" })).map((p) => p.material)).toEqual([
        "acrylic 3mm",
      ]);
    });

    it("searches full text regardless of word order, unlike a plain substring match", async () => {
      const plywood = await submitPreset(pool, baseSubmission());
      await approvePreset(pool, plywood.id, USER_2);
      const acrylic = await submitPreset(
        pool,
        baseSubmission({ material: "Acrylic 3mm", machineType: "co2-laser", operation: "engrave" }),
      );
      await approvePreset(pool, acrylic.id, USER_2);

      // "plywood birch" never appears as a contiguous substring ("birch
      // plywood" is the actual order) - a real full-text search still
      // matches both words regardless of order.
      expect(
        (await searchPresets(pool, { material: "plywood birch" })).map((p) => p.material),
      ).toEqual(["baltic birch plywood 3mm"]);
      expect(await searchPresets(pool, { material: "maple" })).toEqual([]);
    });
  });

  describe("getPresetHistory", () => {
    it("returns every version for a key newest-first, regardless of status", async () => {
      const v1 = await submitPreset(pool, baseSubmission());
      await approvePreset(pool, v1.id, USER_2);
      const v2 = await submitPreset(pool, baseSubmission({ speed: 275 }));
      await rejectPreset(pool, v2.id, USER_2, "too fast");

      const history = await getPresetHistory(
        pool,
        "Baltic Birch Plywood 3mm",
        "diode-laser",
        "cut",
      );
      expect(history.map((p) => [p.version, p.status])).toEqual([
        [2, "rejected"],
        [1, "approved"],
      ]);
    });
  });

  describe("getPresetById", () => {
    it("throws PresetNotFoundError for an unknown id", async () => {
      await expect(getPresetById(pool, "00000000-0000-0000-0000-000000000000")).rejects.toThrow(
        PresetNotFoundError,
      );
    });
  });

  describe("moderation", () => {
    it("lists only pending presets, oldest first", async () => {
      const first = await submitPreset(pool, baseSubmission());
      const second = await submitPreset(
        pool,
        baseSubmission({ operation: "engrave", speed: 3000 }),
      );
      await approvePreset(pool, first.id, USER_2);

      const pending = await listPendingPresets(pool);
      expect(pending.map((p) => p.id)).toEqual([second.id]);
    });

    it("approves a pending preset and records the reviewer", async () => {
      const preset = await submitPreset(pool, baseSubmission());
      const approved = await approvePreset(pool, preset.id, USER_2, "looks right");
      expect(approved.status).toBe("approved");
      expect(approved.reviewedBy).toBe(USER_2);
      expect(approved.reviewNotes).toBe("looks right");
      expect(approved.reviewedAt).not.toBeNull();
    });

    it("rejects a pending preset and records the reviewer", async () => {
      const preset = await submitPreset(pool, baseSubmission());
      const rejected = await rejectPreset(pool, preset.id, USER_2, "unsafe power level");
      expect(rejected.status).toBe("rejected");
      expect(rejected.reviewNotes).toBe("unsafe power level");
    });

    it("throws PresetNotPendingError when reviewing an already-reviewed preset", async () => {
      const preset = await submitPreset(pool, baseSubmission());
      await approvePreset(pool, preset.id, USER_2);
      await expect(approvePreset(pool, preset.id, USER_2)).rejects.toThrow(PresetNotPendingError);
      await expect(rejectPreset(pool, preset.id, USER_2)).rejects.toThrow(PresetNotPendingError);
    });

    it("throws PresetNotFoundError when reviewing an unknown preset", async () => {
      await expect(
        approvePreset(pool, "00000000-0000-0000-0000-000000000000", USER_2),
      ).rejects.toThrow(PresetNotFoundError);
    });
  });

  describe("findSimilarApprovedPreset", () => {
    it("finds an approved preset with speed/power within 10% and identical passes", async () => {
      const preset = await submitPreset(pool, baseSubmission({ speed: 300, power: 950 }));
      await approvePreset(pool, preset.id, USER_2);

      const similar = await findSimilarApprovedPreset(
        pool,
        "Baltic Birch Plywood 3mm",
        "diode-laser",
        "cut",
        320, // within 10% of 300
        900, // within 10% of 950
        1,
      );
      expect(similar?.id).toBe(preset.id);
    });

    it("returns undefined when speed/power differ by more than the tolerance", async () => {
      const preset = await submitPreset(pool, baseSubmission({ speed: 300, power: 950 }));
      await approvePreset(pool, preset.id, USER_2);

      const notSimilar = await findSimilarApprovedPreset(
        pool,
        "Baltic Birch Plywood 3mm",
        "diode-laser",
        "cut",
        500,
        950,
        1,
      );
      expect(notSimilar).toBeUndefined();
    });

    it("returns undefined when passes differ, even if speed/power match exactly", async () => {
      const preset = await submitPreset(
        pool,
        baseSubmission({ speed: 300, power: 950, passes: 1 }),
      );
      await approvePreset(pool, preset.id, USER_2);

      const notSimilar = await findSimilarApprovedPreset(
        pool,
        "Baltic Birch Plywood 3mm",
        "diode-laser",
        "cut",
        300,
        950,
        2,
      );
      expect(notSimilar).toBeUndefined();
    });

    it("ignores a pending or rejected preset - only approved ones count as a match", async () => {
      await submitPreset(pool, baseSubmission({ speed: 300, power: 950 }));

      const notSimilar = await findSimilarApprovedPreset(
        pool,
        "Baltic Birch Plywood 3mm",
        "diode-laser",
        "cut",
        300,
        950,
        1,
      );
      expect(notSimilar).toBeUndefined();
    });

    it("picks the closest match when multiple approved presets are within tolerance", async () => {
      const closer = await submitPreset(pool, baseSubmission({ speed: 305, power: 945 }));
      await approvePreset(pool, closer.id, USER_2);
      const farther = await submitPreset(pool, baseSubmission({ speed: 330, power: 900 }));
      await approvePreset(pool, farther.id, USER_2);

      const similar = await findSimilarApprovedPreset(
        pool,
        "Baltic Birch Plywood 3mm",
        "diode-laser",
        "cut",
        300,
        950,
        1,
      );
      expect(similar?.id).toBe(closer.id);
    });
  });
});
