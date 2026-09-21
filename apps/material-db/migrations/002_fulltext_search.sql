-- Adds real full-text search over `material`, replacing the plain ILIKE
-- substring match used before (see presets.ts's searchPresets). A
-- generated, stored tsvector column - rather than computing to_tsvector()
-- at query time - keeps itself in sync on every INSERT and lets a GIN
-- index actually get used.
ALTER TABLE presets
  ADD COLUMN material_search tsvector
  GENERATED ALWAYS AS (to_tsvector('english', material)) STORED;

CREATE INDEX presets_material_search_idx ON presets USING GIN (material_search);
