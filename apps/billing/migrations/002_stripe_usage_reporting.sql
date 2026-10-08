-- Tracks which usage_events rows have already been reported to Stripe as
-- Billing Meter events, so re-running the reporting job never double-reports
-- a row. (Stripe's own `identifier` field on each meter event also de-dupes
-- server-side, but only within a rolling ~24h window - this column is what
-- makes a reporting run cheap and correct indefinitely after that.)
--
-- Being nullable (not backfilled to "now") is deliberate: every pre-existing
-- usage_events row starts unreported, so the first /usage/report call after
-- this migration lands reports a user's *entire* history, not just usage
-- from that point on. On a deployment with real historical usage this is a
-- rollout decision to make deliberately (e.g. backfill this column to `now()`
-- for existing rows in the same migration, so only new usage gets reported)
-- rather than something this migration should silently decide either way.
ALTER TABLE usage_events ADD COLUMN stripe_reported_at TIMESTAMPTZ;

-- Partial index: reporting only ever scans a user's *unreported* rows, and
-- that set stays small relative to the table's full history.
CREATE INDEX usage_events_unreported_idx ON usage_events (user_id, id)
  WHERE stripe_reported_at IS NULL;
