-- Supports searchPresets's DISTINCT ON ordering (material, machine_type,
-- operation, (upvotes - downvotes) DESC, version DESC), so choosing each
-- key's vote-weighted current preset doesn't require an in-memory sort per
-- key as approved version history grows. Partial on status = 'approved'
-- since that's the one status searchPresets ever queries.
--
-- presets_key_version_idx (from 001_init.sql) stays - it still serves
-- getPresetHistory's plain `ORDER BY version DESC` for an exact key, which
-- this index's column order (vote score before version) doesn't satisfy.
CREATE INDEX presets_key_vote_score_version_idx
  ON presets (material, machine_type, operation, (upvotes - downvotes) DESC, version DESC)
  WHERE status = 'approved';
