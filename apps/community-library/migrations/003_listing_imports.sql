-- Tracks that a user has loaded a listing's design into the editor - the
-- "verified use" signal ratings.ts's rateListing checks before allowing a
-- rating (see "Rating abuse handling" in the README). No separate `id`
-- column: (listing_id, user_id) is already the natural key, and recording
-- an import is idempotent (loading a design you've already loaded again is
-- a no-op, not a new row).
CREATE TABLE listing_imports (
  listing_id UUID NOT NULL REFERENCES listings (id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (listing_id, user_id)
);
