import type { Pool } from "pg";
import { getAllPresets } from "@maker/material-library";
import { approvePreset, getPresetHistory, submitPreset } from "./presets.js";

/**
 * Fixed submitted_by/reviewed_by id for presets migrated in by this seed -
 * distinct from any real @maker/accounts user id, so seeded rows stay
 * identifiable in the submittedBy/reviewedBy columns.
 */
export const SEED_SYSTEM_ID = "00000000-0000-0000-0000-000000000001";

const SEED_REVIEW_NOTES = "Migrated from packages/material-library (Stage 4B static defaults).";

export interface SeedResult {
  inserted: number;
  skipped: number;
}

/**
 * One-time migration of packages/material-library's curated static presets
 * into this service, landing as already-approved rows so they're
 * immediately searchable via GET /presets. Idempotent: skips any
 * (material, machineType, operation) key that already has at least one
 * submitted version, so re-running after real user submissions exist won't
 * duplicate or clobber anything.
 */
export async function seedFromMaterialLibrary(pool: Pool): Promise<SeedResult> {
  let inserted = 0;
  let skipped = 0;
  for (const preset of getAllPresets()) {
    const existing = await getPresetHistory(
      pool,
      preset.material,
      preset.machineType,
      preset.operation,
    );
    if (existing.length > 0) {
      skipped++;
      continue;
    }
    const submitted = await submitPreset(pool, {
      userId: SEED_SYSTEM_ID,
      material: preset.material,
      machineType: preset.machineType,
      operation: preset.operation,
      speed: preset.speed,
      power: preset.power,
      passes: preset.passes,
      notes: preset.notes,
    });
    await approvePreset(pool, submitted.id, SEED_SYSTEM_ID, SEED_REVIEW_NOTES);
    inserted++;
  }
  return { inserted, skipped };
}
