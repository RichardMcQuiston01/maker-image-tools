-- Tracks which usage_events rows have already been reported to Stripe as
-- Billing Meter events, so re-running the reporting job never double-reports
-- a row. (Stripe's own `identifier` field on each meter event also de-dupes
-- server-side, but only within a rolling ~24h window - this column is what
-- makes a reporting run cheap and correct indefinitely after that.)
ALTER TABLE usage_events ADD COLUMN stripe_reported_at TIMESTAMPTZ;

-- Partial index: reporting only ever scans a user's *unreported* rows, and
-- that set stays small relative to the table's full history.
CREATE INDEX usage_events_unreported_idx ON usage_events (user_id, id)
  WHERE stripe_reported_at IS NULL;
