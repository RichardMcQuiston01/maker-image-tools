-- Tracks each project's stored data size so quota checks (see quotas.ts)
-- can sum a user's total storage usage from Postgres alone, without
-- fetching every project's data out of S3 just to measure it. Existing
-- rows backfill to 0 - harmless, since a project's size is always
-- recomputed and overwritten the next time it's saved (PUT), and reading
-- an under-reported size can only ever make quota enforcement more
-- permissive for pre-migration data, never less.
ALTER TABLE projects
  ADD COLUMN data_size_bytes INTEGER NOT NULL DEFAULT 0;
