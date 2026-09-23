-- Denormalized vote counts on the preset row itself, kept in sync by
-- votes.ts's recomputeVoteAggregate - so GET /presets/GET /presets/history
-- never need a live join just to show a score alongside a preset.
ALTER TABLE presets
  ADD COLUMN upvotes INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN downvotes INTEGER NOT NULL DEFAULT 0;

-- One vote per (preset, user), upserted on a repeat vote - same shape as
-- @maker/community-library's ratings table. No foreign key to
-- @maker/accounts's users table for the same reason as `submitted_by`
-- above: that table lives in a separate database owned by a separate
-- service.
CREATE TABLE preset_votes (
  preset_id UUID NOT NULL REFERENCES presets (id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  value SMALLINT NOT NULL CHECK (value IN (1, -1)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (preset_id, user_id)
);
