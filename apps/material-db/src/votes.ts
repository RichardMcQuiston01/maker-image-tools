import type { Pool } from "pg";
import { PresetNotFoundError, toPreset, type Preset, type PresetRow } from "./presets.js";

/** Thrown for a caller-supplied vote `value` that isn't `1` or `-1`. */
export class InvalidVoteValueError extends Error {}

/** Thrown when a preset's own submitter tries to vote on it - voting your own preset up to
 * inflate its score is the obvious abuse case a same-user check closes, the same reasoning as
 * @maker/community-library's self-rating rejection. */
export class SelfVoteNotAllowedError extends Error {}

/** Thrown when voting on a preset that hasn't been approved yet - there's nothing to vouch for
 * in an unreviewed or rejected submission. */
export class PresetNotApprovedError extends Error {}

async function recomputeVoteAggregate(pool: Pool, presetId: string): Promise<Preset> {
  const { rows } = await pool.query<PresetRow>(
    `UPDATE presets SET
       upvotes = (SELECT COUNT(*) FROM preset_votes WHERE preset_id = $1 AND value = 1),
       downvotes = (SELECT COUNT(*) FROM preset_votes WHERE preset_id = $1 AND value = -1)
     WHERE id = $1
     RETURNING *`,
    [presetId],
  );
  return toPreset(rows[0]!);
}

/**
 * Records (or changes) one user's vote on a preset - one vote per (preset, user), upserted, so
 * changing your mind just moves your existing vote rather than adding a second one. Only allowed
 * on an approved preset, and never by the preset's own submitter.
 */
export async function voteOnPreset(
  pool: Pool,
  presetId: string,
  userId: string,
  value: number,
): Promise<Preset> {
  if (value !== 1 && value !== -1) {
    throw new InvalidVoteValueError('"value" must be 1 or -1');
  }

  const { rows } = await pool.query<PresetRow>(`SELECT * FROM presets WHERE id = $1`, [presetId]);
  const row = rows[0];
  if (!row) {
    throw new PresetNotFoundError(`No preset "${presetId}"`);
  }
  if (row.status !== "approved") {
    throw new PresetNotApprovedError(`Preset "${presetId}" hasn't been approved yet`);
  }
  if (row.submitted_by === userId) {
    throw new SelfVoteNotAllowedError("You can't vote on your own preset submission");
  }

  await pool.query(
    `INSERT INTO preset_votes (preset_id, user_id, value) VALUES ($1, $2, $3)
     ON CONFLICT (preset_id, user_id) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [presetId, userId, value],
  );
  return recomputeVoteAggregate(pool, presetId);
}

/** Removes a user's vote on a preset, if they have one - a no-op otherwise (idempotent, matching
 * @maker/cloud-projects' revokeShareLink). */
export async function removeVote(pool: Pool, presetId: string, userId: string): Promise<Preset> {
  const { rows } = await pool.query<PresetRow>(`SELECT * FROM presets WHERE id = $1`, [presetId]);
  if (!rows[0]) {
    throw new PresetNotFoundError(`No preset "${presetId}"`);
  }
  await pool.query(`DELETE FROM preset_votes WHERE preset_id = $1 AND user_id = $2`, [
    presetId,
    userId,
  ]);
  return recomputeVoteAggregate(pool, presetId);
}
