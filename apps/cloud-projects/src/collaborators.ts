import type { Pool } from "pg";
import { findAccessibleProjectRow, findOwnedProjectRow } from "./projects.js";

export interface Collaborator {
  userId: string;
  addedAt: string;
}

interface CollaboratorRow {
  project_id: string;
  user_id: string;
  added_at: Date;
}

function toCollaborator(row: CollaboratorRow): Collaborator {
  return { userId: row.user_id, addedAt: row.added_at.toISOString() };
}

/** Thrown when a project's owner tries to add themselves as their own project's collaborator - they
 * already have full access, and "owner" vs "collaborator" would stop meaning anything. */
export class CannotCollaborateWithSelfError extends Error {}

async function listCollaboratorRows(pool: Pool, projectId: string): Promise<Collaborator[]> {
  const { rows } = await pool.query<CollaboratorRow>(
    "SELECT * FROM project_collaborators WHERE project_id = $1 ORDER BY added_at ASC",
    [projectId],
  );
  return rows.map(toCollaborator);
}

/**
 * Grants `collaboratorUserId` write access to `projectId` - owner-only
 * (throws `NotProjectOwnerError`/`ProjectNotFoundError` via
 * `assertOwner`/`findAccessibleProjectRow` otherwise). Idempotent: adding an
 * already-added collaborator a second time is a no-op, not a 409 - there's
 * no meaningful "conflict" here the way there is for e.g. a share token.
 */
export async function addCollaborator(
  pool: Pool,
  callerId: string,
  projectId: string,
  collaboratorUserId: string,
): Promise<Collaborator[]> {
  const row = await findOwnedProjectRow(pool, callerId, projectId);
  if (collaboratorUserId === row.user_id) {
    throw new CannotCollaborateWithSelfError("The project's owner is already a full collaborator");
  }
  await pool.query(
    `INSERT INTO project_collaborators (project_id, user_id) VALUES ($1, $2)
     ON CONFLICT (project_id, user_id) DO NOTHING`,
    [projectId, collaboratorUserId],
  );
  return listCollaboratorRows(pool, projectId);
}

/** Revokes a collaborator's access - owner-only, idempotent (removing a non-collaborator is a no-op). */
export async function removeCollaborator(
  pool: Pool,
  callerId: string,
  projectId: string,
  collaboratorUserId: string,
): Promise<Collaborator[]> {
  await findOwnedProjectRow(pool, callerId, projectId);
  await pool.query("DELETE FROM project_collaborators WHERE project_id = $1 AND user_id = $2", [
    projectId,
    collaboratorUserId,
  ]);
  return listCollaboratorRows(pool, projectId);
}

/** Lists a project's collaborators - viewable by the owner or any existing collaborator. */
export async function listCollaborators(
  pool: Pool,
  callerId: string,
  projectId: string,
): Promise<Collaborator[]> {
  await findAccessibleProjectRow(pool, callerId, projectId);
  return listCollaboratorRows(pool, projectId);
}
