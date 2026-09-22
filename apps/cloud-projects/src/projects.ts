import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import {
  deleteProjectData,
  getProjectData,
  getProjectThumbnail,
  projectStorageKey,
  projectThumbnailKey,
  putProjectData,
  putProjectThumbnail,
  type ObjectStore,
} from "./objectStorage.js";
import type { PlanQuota } from "./quotas.js";

export interface ProjectSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  hasThumbnail: boolean;
  /** The caller's relationship to this project - omitted for the unauthenticated share-link routes,
   * where there's no caller to relate it to. See "Collaborators" in the README for what each can do. */
  role?: "owner" | "collaborator";
}

export interface Project extends ProjectSummary {
  data: unknown;
}

export interface ProjectRow {
  id: string;
  user_id: string;
  name: string;
  share_token: string | null;
  created_at: Date;
  updated_at: Date;
  data_size_bytes: number;
  has_thumbnail: boolean;
}

function toSummary(row: ProjectRow): ProjectSummary {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    hasThumbnail: row.has_thumbnail,
  };
}

/** Thrown when a project doesn't exist, the calling user has no access to it (not its owner, not a collaborator), or it has no matching share token. */
export class ProjectNotFoundError extends Error {}

/** Thrown when a caller can access a project (as a collaborator) but the action requires being its owner. */
export class NotProjectOwnerError extends Error {}

/** Thrown for a caller-supplied `name`/`data` that fails basic validation. */
export class InvalidProjectInputError extends Error {}

/** Thrown when saving/updating a project would put the user over their plan's project count or storage limit. */
export class QuotaExceededError extends Error {}

/** Thrown when a project exists but has no thumbnail stored for it. */
export class ThumbnailNotFoundError extends Error {}

const THUMBNAIL_CONTENT_TYPE = "image/png";

function validateName(name: string): void {
  if (name.trim().length === 0) {
    throw new InvalidProjectInputError('"name" must be a non-empty string');
  }
}

/**
 * Checks a user's current project count/storage usage against `quota`
 * before a write that would add `dataBytes` more. `excludeProjectId` leaves
 * that project's own current size out of the usage sum (and skips the
 * project-count check entirely) - this is what makes the same check work
 * for both a new project (no exclusion, count matters) and an update to an
 * existing one (excluded, since its count already exists and only its size
 * is changing).
 */
async function assertWithinQuota(
  pool: Pool,
  userId: string,
  quota: PlanQuota,
  dataBytes: number,
  excludeProjectId?: string,
): Promise<void> {
  const { rows } = await pool.query<{ project_count: string; total_bytes: string | null }>(
    excludeProjectId
      ? "SELECT COUNT(*) AS project_count, COALESCE(SUM(data_size_bytes), 0) AS total_bytes " +
          "FROM projects WHERE user_id = $1 AND id != $2"
      : "SELECT COUNT(*) AS project_count, COALESCE(SUM(data_size_bytes), 0) AS total_bytes " +
          "FROM projects WHERE user_id = $1",
    excludeProjectId ? [userId, excludeProjectId] : [userId],
  );
  const row = rows[0]!;
  const projectCount = Number(row.project_count);
  const totalBytes = Number(row.total_bytes ?? 0);

  if (excludeProjectId === undefined && projectCount + 1 > quota.maxProjects) {
    throw new QuotaExceededError(
      `Plan limit reached: at most ${quota.maxProjects} projects allowed`,
    );
  }
  if (totalBytes + dataBytes > quota.maxTotalBytes) {
    throw new QuotaExceededError(
      `Plan limit reached: at most ${quota.maxTotalBytes} bytes of project data allowed`,
    );
  }
}

export async function createProject(
  pool: Pool,
  store: ObjectStore,
  userId: string,
  name: string,
  data: unknown,
  quota: PlanQuota,
): Promise<Project> {
  validateName(name);
  if (data === undefined) {
    throw new InvalidProjectInputError('"data" is required');
  }
  const dataBytes = Buffer.byteLength(JSON.stringify(data), "utf-8");
  await assertWithinQuota(pool, userId, quota, dataBytes);

  const { rows } = await pool.query<ProjectRow>(
    "INSERT INTO projects (user_id, name) VALUES ($1, $2) RETURNING *",
    [userId, name],
  );
  const row = rows[0]!;
  const size = await putProjectData(store, projectStorageKey(userId, row.id), data);
  await pool.query("UPDATE projects SET data_size_bytes = $1 WHERE id = $2", [size, row.id]);
  return { ...toSummary(row), role: "owner", data };
}

/** Every project the caller owns, plus every project someone else owns but shared with them as a collaborator. */
export async function listProjects(pool: Pool, userId: string): Promise<ProjectSummary[]> {
  const { rows } = await pool.query<ProjectRow>(
    `SELECT * FROM projects p
     WHERE p.user_id = $1 OR EXISTS (
       SELECT 1 FROM project_collaborators c WHERE c.project_id = p.id AND c.user_id = $1
     )
     ORDER BY p.updated_at DESC`,
    [userId],
  );
  return rows.map((row) => ({ ...toSummary(row), role: roleFor(row, userId) }));
}

/** A project row the caller can view/edit as either its owner or one of its collaborators. */
export async function findAccessibleProjectRow(
  pool: Pool,
  userId: string,
  projectId: string,
): Promise<ProjectRow> {
  const { rows } = await pool.query<ProjectRow>(
    `SELECT p.* FROM projects p
     WHERE p.id = $1 AND (p.user_id = $2 OR EXISTS (
       SELECT 1 FROM project_collaborators c WHERE c.project_id = p.id AND c.user_id = $2
     ))`,
    [projectId, userId],
  );
  const row = rows[0];
  if (!row) {
    throw new ProjectNotFoundError(`No project "${projectId}" accessible to this user`);
  }
  return row;
}

/**
 * A project row for an action only its owner can take (delete, manage
 * sharing, manage collaborators). Distinguishes "doesn't exist/no access at
 * all" (`ProjectNotFoundError`, 404 - same as a stranger would get) from
 * "you can see this project but you're not its owner" (`NotProjectOwnerError`,
 * 403 - a collaborator already knows it exists, so a 404 here would just be
 * a lie).
 */
export async function findOwnedProjectRow(
  pool: Pool,
  userId: string,
  projectId: string,
): Promise<ProjectRow> {
  const row = await findAccessibleProjectRow(pool, userId, projectId);
  if (row.user_id !== userId) {
    throw new NotProjectOwnerError(`Only project "${projectId}"'s owner can do this`);
  }
  return row;
}

function roleFor(row: ProjectRow, userId: string): "owner" | "collaborator" {
  return row.user_id === userId ? "owner" : "collaborator";
}

export async function getProject(
  pool: Pool,
  store: ObjectStore,
  userId: string,
  projectId: string,
): Promise<Project> {
  const row = await findAccessibleProjectRow(pool, userId, projectId);
  const data = await getProjectData(store, projectStorageKey(row.user_id, row.id));
  return { ...toSummary(row), role: roleFor(row, userId), data };
}

export interface ProjectChanges {
  name?: string | undefined;
  data?: unknown;
}

/**
 * Updates a project's name/data. The caller may be the owner or a
 * collaborator - either way, quota is charged against the project's owner
 * (whoever's plan the storage counts against), not the caller, so `quota`
 * is resolved lazily via `getQuota(ownerId)` once the owner is known, rather
 * than being looked up for the caller before this is even called.
 */
export async function updateProject(
  pool: Pool,
  store: ObjectStore,
  userId: string,
  projectId: string,
  changes: ProjectChanges,
  getQuota: (ownerId: string) => Promise<PlanQuota>,
): Promise<Project> {
  const row = await findAccessibleProjectRow(pool, userId, projectId);
  if (changes.name !== undefined) {
    validateName(changes.name);
  }
  if (changes.data !== undefined) {
    const dataBytes = Buffer.byteLength(JSON.stringify(changes.data), "utf-8");
    const quota = await getQuota(row.user_id);
    await assertWithinQuota(pool, row.user_id, quota, dataBytes, row.id);
  }

  const { rows } = await pool.query<ProjectRow>(
    "UPDATE projects SET name = COALESCE($1, name), updated_at = now() WHERE id = $2 RETURNING *",
    [changes.name ?? null, row.id],
  );
  const updated = rows[0]!;

  const key = projectStorageKey(row.user_id, row.id);
  if (changes.data !== undefined) {
    const size = await putProjectData(store, key, changes.data);
    await pool.query("UPDATE projects SET data_size_bytes = $1 WHERE id = $2", [size, row.id]);
  }
  const data = changes.data !== undefined ? changes.data : await getProjectData(store, key);
  return { ...toSummary(updated), role: roleFor(updated, userId), data };
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
  if (row.has_thumbnail) {
    await deleteProjectData(store, projectThumbnailKey(userId, row.id));
  }
}

/** Stores a thumbnail image for a project, overwriting any existing one. Only `image/png` is accepted, matching what apps/web's renderThumbnail produces. */
export async function saveThumbnail(
  pool: Pool,
  store: ObjectStore,
  userId: string,
  projectId: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  if (contentType !== THUMBNAIL_CONTENT_TYPE) {
    throw new InvalidProjectInputError(
      `Thumbnail must be "${THUMBNAIL_CONTENT_TYPE}", got "${contentType}"`,
    );
  }
  if (body.length === 0) {
    throw new InvalidProjectInputError("Thumbnail body is empty");
  }
  const row = await findAccessibleProjectRow(pool, userId, projectId);
  await putProjectThumbnail(store, projectThumbnailKey(row.user_id, row.id), body, contentType);
  await pool.query("UPDATE projects SET has_thumbnail = true WHERE id = $1", [row.id]);
}

export async function getThumbnail(
  pool: Pool,
  store: ObjectStore,
  userId: string,
  projectId: string,
): Promise<{ body: Buffer; contentType: string }> {
  const row = await findAccessibleProjectRow(pool, userId, projectId);
  if (!row.has_thumbnail) {
    throw new ThumbnailNotFoundError(`No thumbnail for project "${projectId}"`);
  }
  return getProjectThumbnail(store, projectThumbnailKey(row.user_id, row.id));
}

/** Removes a project's thumbnail if it has one - a no-op otherwise, matching revokeShareLink's idempotence. */
export async function deleteThumbnail(
  pool: Pool,
  store: ObjectStore,
  userId: string,
  projectId: string,
): Promise<void> {
  const row = await findAccessibleProjectRow(pool, userId, projectId);
  if (!row.has_thumbnail) return;
  await deleteProjectData(store, projectThumbnailKey(row.user_id, row.id));
  await pool.query("UPDATE projects SET has_thumbnail = false WHERE id = $1", [row.id]);
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

/** Reads a project's thumbnail by its public share token - no ownership check, matching getSharedProject. */
export async function getSharedThumbnail(
  pool: Pool,
  store: ObjectStore,
  token: string,
): Promise<{ body: Buffer; contentType: string }> {
  const { rows } = await pool.query<ProjectRow>("SELECT * FROM projects WHERE share_token = $1", [
    token,
  ]);
  const row = rows[0];
  if (!row) {
    throw new ProjectNotFoundError(`No project for this share token`);
  }
  if (!row.has_thumbnail) {
    throw new ThumbnailNotFoundError(`No thumbnail for this share token`);
  }
  return getProjectThumbnail(store, projectThumbnailKey(row.user_id, row.id));
}
