-- Adds real full-text search over title/description, replacing the plain
-- ILIKE substring match `q` filtering used before (see listings.ts's
-- listListings). A generated, stored tsvector column - rather than
-- computing to_tsvector() at query time - keeps itself in sync on every
-- INSERT/UPDATE and lets a GIN index actually get used. Title is weighted
-- higher than description, so a match in the title ranks above one only in
-- the description if a caller ever orders by ts_rank.
ALTER TABLE listings
  ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B')
  ) STORED;

CREATE INDEX listings_search_vector_idx ON listings USING GIN (search_vector);
