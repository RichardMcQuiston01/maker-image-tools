import type { Pool } from "pg";

export type PresetStatus = "pending" | "approved" | "rejected";

export interface Preset {
  id: string;
  material: string;
  machineType: string;
  operation: string;
  speed: number;
  power: number;
  passes: number;
  notes: string | null;
  status: PresetStatus;
  version: number;
  submittedBy: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  createdAt: string;
}

interface PresetRow {
  id: string;
  material: string;
  machine_type: string;
  operation: string;
  speed: string;
  power: string;
  passes: number;
  notes: string | null;
  status: PresetStatus;
  version: number;
  submitted_by: string;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  review_notes: string | null;
  created_at: Date;
}

function toPreset(row: PresetRow): Preset {
  return {
    id: row.id,
    material: row.material,
    machineType: row.machine_type,
    operation: row.operation,
    speed: Number(row.speed),
    power: Number(row.power),
    passes: row.passes,
    notes: row.notes,
    status: row.status,
    version: row.version,
    submittedBy: row.submitted_by,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at ? row.reviewed_at.toISOString() : null,
    reviewNotes: row.review_notes,
    createdAt: row.created_at.toISOString(),
  };
}

/** Trims and lowercases a grouping key (`material`/`machineType`/`operation`) so near-duplicate
 * submissions ("Baltic Birch" vs "baltic birch ") land in the same version history. */
function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

/** Thrown for caller-supplied preset fields that fail basic validation. */
export class InvalidPresetInputError extends Error {}

/** Thrown when a preset id doesn't exist. */
export class PresetNotFoundError extends Error {}

/** Thrown when approving/rejecting a preset that's already been reviewed. */
export class PresetNotPendingError extends Error {}

export interface PresetSubmission {
  userId: string;
  material: string;
  machineType: string;
  operation: string;
  speed: number;
  power: number;
  passes?: number | undefined;
  notes?: string | undefined;
}

function validateSubmission(input: PresetSubmission): void {
  if (input.material.trim().length === 0) {
    throw new InvalidPresetInputError('"material" must be a non-empty string');
  }
  if (input.machineType.trim().length === 0) {
    throw new InvalidPresetInputError('"machineType" must be a non-empty string');
  }
  if (input.operation.trim().length === 0) {
    throw new InvalidPresetInputError('"operation" must be a non-empty string');
  }
  if (!Number.isFinite(input.speed) || input.speed <= 0) {
    throw new InvalidPresetInputError('"speed" must be a positive number');
  }
  if (!Number.isFinite(input.power) || input.power <= 0) {
    throw new InvalidPresetInputError('"power" must be a positive number');
  }
  if (input.passes !== undefined && (!Number.isInteger(input.passes) || input.passes < 1)) {
    throw new InvalidPresetInputError('"passes" must be a positive integer');
  }
}

/**
 * Records a new submission as the next version of its (material, machineType,
 * operation) key, starting out `pending`. The version number is computed in
 * the same INSERT statement, so concurrent submissions for the same key
 * can't race to reuse a version number.
 */
export async function submitPreset(pool: Pool, input: PresetSubmission): Promise<Preset> {
  validateSubmission(input);
  const material = normalizeKey(input.material);
  const machineType = normalizeKey(input.machineType);
  const operation = normalizeKey(input.operation);

  const { rows } = await pool.query<PresetRow>(
    `INSERT INTO presets (material, machine_type, operation, speed, power, passes, notes, submitted_by, version)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
       (SELECT COALESCE(MAX(version), 0) + 1 FROM presets WHERE material = $1 AND machine_type = $2 AND operation = $3))
     RETURNING *`,
    [
      material,
      machineType,
      operation,
      input.speed,
      input.power,
      input.passes ?? 1,
      input.notes ?? null,
      input.userId,
    ],
  );
  return toPreset(rows[0]!);
}

export interface PresetSearch {
  material?: string | undefined;
  machineType?: string | undefined;
  operation?: string | undefined;
}

/** The current (highest-version, approved) preset for each matching (material, machineType,
 * operation) key - what a UI picking sane defaults for a material should query. */
export async function searchPresets(pool: Pool, search: PresetSearch): Promise<Preset[]> {
  const material = search.material ? normalizeKey(search.material) : null;
  const machineType = search.machineType ? normalizeKey(search.machineType) : null;
  const operation = search.operation ? normalizeKey(search.operation) : null;

  const { rows } = await pool.query<PresetRow>(
    `SELECT DISTINCT ON (material, machine_type, operation) *
     FROM presets
     WHERE status = 'approved'
       AND ($1::text IS NULL OR material ILIKE '%' || $1 || '%')
       AND ($2::text IS NULL OR machine_type = $2)
       AND ($3::text IS NULL OR operation = $3)
     ORDER BY material, machine_type, operation, version DESC`,
    [material, machineType, operation],
  );
  return rows.map(toPreset).sort((a, b) => a.material.localeCompare(b.material));
}

/** Every version ever submitted for an exact (material, machineType, operation) key, newest first. */
export async function getPresetHistory(
  pool: Pool,
  material: string,
  machineType: string,
  operation: string,
): Promise<Preset[]> {
  const { rows } = await pool.query<PresetRow>(
    `SELECT * FROM presets WHERE material = $1 AND machine_type = $2 AND operation = $3 ORDER BY version DESC`,
    [normalizeKey(material), normalizeKey(machineType), normalizeKey(operation)],
  );
  return rows.map(toPreset);
}

export async function getPresetById(pool: Pool, id: string): Promise<Preset> {
  const { rows } = await pool.query<PresetRow>(`SELECT * FROM presets WHERE id = $1`, [id]);
  const row = rows[0];
  if (!row) {
    throw new PresetNotFoundError(`No preset "${id}"`);
  }
  return toPreset(row);
}

/** Submissions awaiting moderation, oldest first. */
export async function listPendingPresets(pool: Pool): Promise<Preset[]> {
  const { rows } = await pool.query<PresetRow>(
    `SELECT * FROM presets WHERE status = 'pending' ORDER BY created_at ASC`,
  );
  return rows.map(toPreset);
}

async function findPendingPreset(pool: Pool, id: string): Promise<PresetRow> {
  const { rows } = await pool.query<PresetRow>(`SELECT * FROM presets WHERE id = $1`, [id]);
  const row = rows[0];
  if (!row) {
    throw new PresetNotFoundError(`No preset "${id}"`);
  }
  if (row.status !== "pending") {
    throw new PresetNotPendingError(`Preset "${id}" has already been reviewed (${row.status})`);
  }
  return row;
}

async function reviewPreset(
  pool: Pool,
  id: string,
  status: "approved" | "rejected",
  reviewerId: string,
  notes: string | undefined,
): Promise<Preset> {
  await findPendingPreset(pool, id);
  const { rows } = await pool.query<PresetRow>(
    `UPDATE presets SET status = $1, reviewed_by = $2, reviewed_at = now(), review_notes = $3
     WHERE id = $4 RETURNING *`,
    [status, reviewerId, notes ?? null, id],
  );
  return toPreset(rows[0]!);
}

export async function approvePreset(
  pool: Pool,
  id: string,
  reviewerId: string,
  notes?: string,
): Promise<Preset> {
  return reviewPreset(pool, id, "approved", reviewerId, notes);
}

export async function rejectPreset(
  pool: Pool,
  id: string,
  reviewerId: string,
  notes?: string,
): Promise<Preset> {
  return reviewPreset(pool, id, "rejected", reviewerId, notes);
}
