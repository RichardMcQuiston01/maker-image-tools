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
  upvotes: number;
  downvotes: number;
}

export interface PresetRow {
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
  upvotes: number;
  downvotes: number;
}

export function toPreset(row: PresetRow): Preset {
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
    upvotes: row.upvotes,
    downvotes: row.downvotes,
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

/**
 * The current (vote-weighted, approved) preset for each matching (material, machineType,
 * operation) key - what a UI picking sane defaults for a material should query. Within a key,
 * the approved version with the highest net vote score (`upvotes - downvotes`) wins; version
 * number only breaks a tie (most commonly: every version tied at a net score of 0, since voting
 * is opt-in and most versions never get any - in that case this is exactly "highest version",
 * same as before this ordering existed). This is what keeps a highly-downvoted latest version
 * from beating a well-regarded older one - see "Duplicate detection and voting" in the README.
 * `material` is matched against `material_search` (see migration 002_fulltext_search.sql) via
 * `plainto_tsquery`, so a multi-word query matches regardless of word order - unlike the plain
 * substring match this replaced.
 */
export async function searchPresets(pool: Pool, search: PresetSearch): Promise<Preset[]> {
  const material = search.material?.trim() || null;
  const machineType = search.machineType ? normalizeKey(search.machineType) : null;
  const operation = search.operation ? normalizeKey(search.operation) : null;

  const { rows } = await pool.query<PresetRow>(
    `SELECT DISTINCT ON (material, machine_type, operation) *
     FROM presets
     WHERE status = 'approved'
       AND ($1::text IS NULL OR material_search @@ plainto_tsquery('english', $1))
       AND ($2::text IS NULL OR machine_type = $2)
       AND ($3::text IS NULL OR operation = $3)
     ORDER BY material, machine_type, operation, (upvotes - downvotes) DESC, version DESC`,
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

/** A submission counts as a near-duplicate of an existing approved preset if its speed and power
 * are both within this fraction of the existing one's - passes must match exactly, since e.g. 1
 * vs 2 passes is a meaningfully different process, not a rounding difference. */
const DUPLICATE_TOLERANCE = 0.1;

/**
 * Finds the closest already-approved preset for the same (material, machineType, operation) key
 * whose speed/power/passes are a near-duplicate of the given values - the "did you mean to vote
 * for this instead of resubmitting" nudge `submitPreset`'s caller (see server.ts) surfaces
 * alongside a successful submission. Never blocks the submission itself: a crowdsourced value
 * space benefits from multiple independent confirmations of the same setting, so this is
 * informational, not a rejection.
 */
export async function findSimilarApprovedPreset(
  pool: Pool,
  material: string,
  machineType: string,
  operation: string,
  speed: number,
  power: number,
  passes: number,
): Promise<Preset | undefined> {
  const { rows } = await pool.query<PresetRow>(
    `SELECT * FROM presets WHERE material = $1 AND machine_type = $2 AND operation = $3 AND status = 'approved'`,
    [normalizeKey(material), normalizeKey(machineType), normalizeKey(operation)],
  );

  let best: PresetRow | undefined;
  let bestDelta = Infinity;
  for (const row of rows) {
    if (row.passes !== passes) continue;
    const rowSpeed = Number(row.speed);
    const rowPower = Number(row.power);
    const speedDelta = Math.abs(rowSpeed - speed) / rowSpeed;
    const powerDelta = Math.abs(rowPower - power) / rowPower;
    if (speedDelta > DUPLICATE_TOLERANCE || powerDelta > DUPLICATE_TOLERANCE) continue;
    const delta = speedDelta + powerDelta;
    if (delta < bestDelta) {
      bestDelta = delta;
      best = row;
    }
  }
  return best ? toPreset(best) : undefined;
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
