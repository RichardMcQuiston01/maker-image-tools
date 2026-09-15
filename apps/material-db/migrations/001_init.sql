-- No foreign key to apps/accounts's `users` table: that table lives in a
-- separate database owned by a separate service. `submitted_by`/`reviewed_by`
-- here are just the accounts service's user UUIDs, carried opaquely.

CREATE TABLE presets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material TEXT NOT NULL,
  machine_type TEXT NOT NULL,
  operation TEXT NOT NULL,
  speed NUMERIC NOT NULL,
  power NUMERIC NOT NULL,
  passes INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  version INTEGER NOT NULL,
  submitted_by UUID NOT NULL,
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Every version of the same (material, machine_type, operation) key, newest first.
CREATE INDEX presets_key_version_idx ON presets (material, machine_type, operation, version DESC);
CREATE INDEX presets_status_idx ON presets (status);
