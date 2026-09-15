-- No foreign key to apps/accounts's `users` table: that table lives in a
-- separate database owned by a separate service. `user_id`/`reviewed_by`
-- here are just the accounts service's user UUIDs, carried opaquely.

CREATE TABLE listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  rating_avg NUMERIC NOT NULL DEFAULT 0,
  rating_count INTEGER NOT NULL DEFAULT 0,
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX listings_status_idx ON listings (status);
CREATE INDEX listings_user_id_idx ON listings (user_id);
CREATE INDEX listings_tags_idx ON listings USING GIN (tags);

CREATE TABLE ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES listings (id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (listing_id, user_id)
);
