-- Grants another user write access to a project without transferring
-- ownership: `projects.user_id` (the owner) still owns billing/quota
-- accounting and admin actions (delete, sharing, managing this table
-- itself), while a row here just lets that user_id also view/edit the
-- project's data. `ON DELETE CASCADE` so a deleted project's collaborator
-- rows never linger as orphans.
CREATE TABLE project_collaborators (
  project_id UUID NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);

CREATE INDEX project_collaborators_user_id_idx ON project_collaborators (user_id);
