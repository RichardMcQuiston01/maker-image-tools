-- Tracks whether a project has a stored thumbnail, so GET /projects can tell
-- callers which projects to fetch a thumbnail image for without a
-- speculative S3 lookup (or a 404) per project, and so DELETE /projects
-- knows whether there's a thumbnail object to clean up alongside the
-- project's data. Existing rows default to false, which is simply correct -
-- no project had a thumbnail before this feature existed.
ALTER TABLE projects
  ADD COLUMN has_thumbnail BOOLEAN NOT NULL DEFAULT false;
