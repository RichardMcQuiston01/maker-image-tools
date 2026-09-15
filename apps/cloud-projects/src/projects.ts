import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import {
  deleteProjectData,
  getProjectData,
  projectStorageKey,
  putProjectData,
  type ObjectStore,
} from "./objectStorage.js";

export interface ProjectSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface Project extends ProjectSummary {
  data: unknown;
}

interface ProjectRow {
  id: string;
  user_id: string;
  name: string;
  share_token: string | null;
  created_at: Date;
  updated_at: Date;
}

function toSummary(row: ProjectRow): ProjectSummary {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/** Thrown when a project doesn't exist, isn't owned by the calling user, or has no matching share token. */
export class ProjectNotFoundError extends Error {}

/** Thrown for a caller-supplied `name`/`data` that fails basic validation. */
export class InvalidProjectInputError extends Error {}

function validateName(name: string): void {
  if (name.trim().length === 0) {
    throw new InvalidProjectInputError('"name" must be a non-empty string');
  }
}

export async function createProject(
  pool: Pool,
  store: ObjectStore,
  userId: string,
  name: string,
  data: unknown,
): Promise<Project> {
  validateName(name);
  if (data === undefined) {
    throw new InvalidProjectInputError('"data" is required');
  }
  const { rows } = await pool.query<ProjectRow>(
    "INSERT INTO projects (user_id, name) VALUES ($1, $2) RETURNING *",
    [userId, name],
  );
  const row = rows[0]!;
  await putProjectData(store, projectStorageKey(userId, row.id), data);
  return { ...toSummary(row), data };
}

export async function listProjects(pool: Pool, userId: string): Promise<ProjectSummary[]> {
  const { rows } = await pool.query<ProjectRow>(
    "SELECT * FROM projects WHERE user_id = $1 ORDER BY updated_at DESC",
    [userId],
  );
  return rows.map(toSummary);
}

async function findOwnedProjectRow(
  pool: Pool,
  userId: string,
  projectId: string,
): Promise<ProjectRow> {
  const { rows } = await pool.query<ProjectRow>(
    "SELECT * FROM projects WHERE id = $1 AND user_id = $2",
    [projectId, userId],
  );
  const row = rows[0];
  if (!row) {
    throw new ProjectNotFoundError(`No project "${projectId}" for this user`);
  }
  return row;
}

export async function getProject(
  pool: Pool,
  store: ObjectStore,
  userId: string,
  projectId: string,
): Promise<Project> {
  const row = await findOwnedProjectRow(pool, userId, projectId);
  const data = await getProjectData(store, projectStorageKey(userId, row.id));
  return { ...toSummary(row), data };
}

export interface ProjectChanges {
  name?: string | undefined;
  data?: unknown;
}

export async function updateProject(
  pool: Pool,
  store: ObjectStore,
  userId: string,
  projectId: string,
  changes: ProjectChanges,
): Promise<Project> {
  const row = await findOwnedProjectRow(pool, userId, projectId);
  if (changes.name !== undefined) {
    validateName(changes.name);
  }

  const { rows } = await pool.query<ProjectRow>(
    "UPDATE projects SET name = COALESCE($1, name), updated_at = now() WHERE id = $2 RETURNING *",
    [changes.name ?? null, row.id],
  );
  const updated = rows[0]!;

  const key = projectStorageKey(userId, row.id);
  if (changes.data !== undefined) {
    await putProjectData(store, key, changes.data);
  }
  const data = changes.data !== undefined ? changes.data : await getProjectData(store, key);
  return { ...toSummary(updated), data };
}

export async function deleteProject(
  pool: Pool,
  store: ObjectStore,
  userId: string,
  projectId: string,
): Promise<void> {
  const row = await findOwnedProjectRow(pool, userId, projectId);
  await pool.query("DELETE FROM projects WHERE id = $1", [row.id]);
  await deleteProjectData(store, projectStorageKey(userId, row.id));
}

/** Creates a share token for the project if it doesn't already have one, and returns it either way. */
export async function createShareLink(
  pool: Pool,
  userId: string,
  projectId: string,
): Promise<string> {
  const row = await findOwnedProjectRow(pool, userId, projectId);
  if (row.share_token) return row.share_token;

  const token = randomBytes(24).toString("base64url");
  await pool.query("UPDATE projects SET share_token = $1 WHERE id = $2", [token, row.id]);
  return token;
}

export async function revokeShareLink(
  pool: Pool,
  userId: string,
  projectId: string,
): Promise<void> {
  const row = await findOwnedProjectRow(pool, userId, projectId);
  await pool.query("UPDATE projects SET share_token = NULL WHERE id = $1", [row.id]);
}

/** Reads a project by its public share token - no ownership check, since that's the point of the link. */
export async function getSharedProject(
  pool: Pool,
  store: ObjectStore,
  token: string,
): Promise<Project> {
  const { rows } = await pool.query<ProjectRow>("SELECT * FROM projects WHERE share_token = $1", [
    token,
  ]);
  const row = rows[0];
  if (!row) {
    throw new ProjectNotFoundError(`No project for this share token`);
  }
  const data = await getProjectData(store, projectStorageKey(row.user_id, row.id));
  return { ...toSummary(row), data };
}
