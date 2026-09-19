import { createHash, randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { findUserById, type User } from "./users.js";

const TOKEN_BYTES = 32;
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface Session {
  /** Bearer token to hand back to the client. Never stored — only its hash is. */
  token: string;
  expiresAt: Date;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Creates a session for `userId` and returns the plaintext bearer token.
 * Only `sha256(token)` is persisted, so a database leak alone can't be used
 * to authenticate as any user.
 */
export async function createSession(
  pool: Pool,
  userId: string,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<Session> {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  const expiresAt = new Date(Date.now() + ttlMs);
  await pool.query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)", [
    hashToken(token),
    userId,
    expiresAt,
  ]);
  return { token, expiresAt };
}

/** Returns the session's user if `token` is valid and unexpired, else `undefined`. */
export async function validateSession(pool: Pool, token: string): Promise<User | undefined> {
  const { rows } = await pool.query<{ user_id: string; expires_at: Date }>(
    "SELECT user_id, expires_at FROM sessions WHERE token_hash = $1",
    [hashToken(token)],
  );
  const row = rows[0];
  if (!row || row.expires_at.getTime() <= Date.now()) return undefined;
  return findUserById(pool, row.user_id);
}

export async function deleteSession(pool: Pool, token: string): Promise<void> {
  await pool.query("DELETE FROM sessions WHERE token_hash = $1", [hashToken(token)]);
}

/**
 * Deletes every session past its `expires_at`, returning how many rows were
 * removed. An expired session already fails `validateSession`, so this is
 * housekeeping (bounding the table's size) rather than a security fix -
 * see server.ts's `createServer` for where this runs on a timer.
 */
export async function deleteExpiredSessions(pool: Pool): Promise<number> {
  const { rowCount } = await pool.query("DELETE FROM sessions WHERE expires_at <= now()");
  return rowCount ?? 0;
}
