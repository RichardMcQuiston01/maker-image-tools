import type { Pool } from "pg";
import { hashPassword, verifyPassword } from "./password.js";

export interface User {
  id: string;
  email: string;
  planTier: string;
  role: string;
  /** Whether this account has a password set - false for an OAuth-only account that hasn't set one yet. */
  hasPassword: boolean;
  /** Whether this account's email is verified - true immediately for an OAuth account (the provider
   * already verified it), only once the emailed link is confirmed for a password account. */
  emailVerified: boolean;
  createdAt: Date;
}

interface UserRow {
  id: string;
  email: string;
  password_hash: string | null;
  plan_tier: string;
  role: string;
  email_verified_at: Date | null;
  created_at: Date;
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    planTier: row.plan_tier,
    role: row.role,
    hasPassword: row.password_hash !== null,
    emailVerified: row.email_verified_at !== null,
    createdAt: row.created_at,
  };
}

/** Thrown by `createUser` when the email is already registered. */
export class EmailAlreadyRegisteredError extends Error {}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

/** Thrown for a caller-supplied email/password that fails basic format validation. */
export class InvalidCredentialsFormatError extends Error {}

const VALID_ROLES = new Set(["user", "moderator"]);

/** Thrown for a caller-supplied role that isn't one of the roles this service recognizes. */
export class InvalidRoleError extends Error {}

/** Thrown by `setPasswordForOAuthOnlyUser` when the target account already has a password. */
export class PasswordAlreadySetError extends Error {}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function validateEmail(email: string): void {
  if (!EMAIL_RE.test(email)) {
    throw new InvalidCredentialsFormatError("Invalid email address");
  }
}

export function validatePassword(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new InvalidCredentialsFormatError(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    );
  }
}

export async function createUser(pool: Pool, email: string, password: string): Promise<User> {
  const normalizedEmail = normalizeEmail(email);
  validateEmail(normalizedEmail);
  validatePassword(password);

  const passwordHash = await hashPassword(password);
  try {
    const { rows } = await pool.query<UserRow>(
      "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING *",
      [normalizedEmail, passwordHash],
    );
    return toUser(rows[0] as UserRow);
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new EmailAlreadyRegisteredError(`Email "${normalizedEmail}" is already registered`);
    }
    throw err;
  }
}

/**
 * Creates a user with no password - for an OAuth-only signup, where there's
 * no password to hash and verifying a stored `NULL` would never be
 * meaningful. Such a user can still gain a password later (not implemented
 * yet) but for now can only ever sign in via the OAuth provider that
 * created them.
 */
export async function createOAuthOnlyUser(pool: Pool, email: string): Promise<User> {
  const normalizedEmail = normalizeEmail(email);
  validateEmail(normalizedEmail);

  try {
    const { rows } = await pool.query<UserRow>(
      "INSERT INTO users (email, password_hash, email_verified_at) VALUES ($1, NULL, now()) RETURNING *",
      [normalizedEmail],
    );
    return toUser(rows[0] as UserRow);
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new EmailAlreadyRegisteredError(`Email "${normalizedEmail}" is already registered`);
    }
    throw err;
  }
}

export async function findUserByEmail(pool: Pool, email: string): Promise<User | undefined> {
  const { rows } = await pool.query<UserRow>("SELECT * FROM users WHERE email = $1", [
    normalizeEmail(email),
  ]);
  return rows[0] ? toUser(rows[0]) : undefined;
}

export async function findUserById(pool: Pool, id: string): Promise<User | undefined> {
  const { rows } = await pool.query<UserRow>("SELECT * FROM users WHERE id = $1", [id]);
  return rows[0] ? toUser(rows[0]) : undefined;
}

/**
 * Sets `id`'s role, returning the updated user or `undefined` if no user has
 * that id. Callers are expected to have already verified the caller is
 * allowed to do this (see server.ts's `POST /users/:id/role`) - this
 * function itself just validates the role value against the database's own
 * `CHECK (role IN ('user', 'moderator'))` constraint, so a bad value fails
 * with a clean 400-worthy error instead of a raw constraint-violation one.
 */
export async function setUserRole(pool: Pool, id: string, role: string): Promise<User | undefined> {
  if (!VALID_ROLES.has(role)) {
    throw new InvalidRoleError(`"role" must be one of: ${[...VALID_ROLES].join(", ")}`);
  }
  const { rows } = await pool.query<UserRow>(
    "UPDATE users SET role = $1 WHERE id = $2 RETURNING *",
    [role, id],
  );
  return rows[0] ? toUser(rows[0]) : undefined;
}

/**
 * Sets a password for `id`'s account, returning the updated user, or
 * `undefined` if no user has that id. Only works on an OAuth-only account
 * (`password_hash IS NULL`) - throws `PasswordAlreadySetError` if the
 * account already has one, since changing an existing password (which
 * would need the current password verified first) is a different, larger
 * feature (see "Password reset" in the README) than this one covers.
 */
export async function setPasswordForOAuthOnlyUser(
  pool: Pool,
  id: string,
  password: string,
): Promise<User | undefined> {
  validatePassword(password);
  const passwordHash = await hashPassword(password);
  const { rows } = await pool.query<UserRow>(
    "UPDATE users SET password_hash = $1 WHERE id = $2 AND password_hash IS NULL RETURNING *",
    [passwordHash, id],
  );
  if (rows[0]) return toUser(rows[0]);

  const existing = await findUserById(pool, id);
  if (!existing) return undefined;
  throw new PasswordAlreadySetError(`User (${id}) already has a password set`);
}

/**
 * Unconditionally sets `id`'s password, returning the updated user, or
 * `undefined` if no user has that id. Unlike `setPasswordForOAuthOnlyUser`,
 * this overwrites any existing password - callers are expected to have
 * already verified the caller is allowed to do this (see
 * `passwordReset.ts`'s `confirmPasswordReset`, which only calls this after
 * consuming a valid password-reset token).
 */
export async function setPasswordForUser(
  pool: Pool,
  id: string,
  password: string,
): Promise<User | undefined> {
  validatePassword(password);
  const passwordHash = await hashPassword(password);
  const { rows } = await pool.query<UserRow>(
    "UPDATE users SET password_hash = $1 WHERE id = $2 RETURNING *",
    [passwordHash, id],
  );
  return rows[0] ? toUser(rows[0]) : undefined;
}

/**
 * Marks `id`'s email as verified, returning the updated user, or `undefined`
 * if no user has that id. Idempotent (`COALESCE`) - confirming an
 * already-verified email again just keeps the original verification time
 * rather than erroring, since there's nothing unsafe about it. Callers are
 * expected to have already proven ownership of the email (see
 * `emailVerification.ts`'s `confirmEmailVerification`, which only calls this
 * after consuming a valid verification token).
 */
export async function markEmailVerified(pool: Pool, id: string): Promise<User | undefined> {
  const { rows } = await pool.query<UserRow>(
    "UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1 RETURNING *",
    [id],
  );
  return rows[0] ? toUser(rows[0]) : undefined;
}

/** Verifies email+password and returns the matching user, or `undefined` if either is wrong. */
export async function authenticate(
  pool: Pool,
  email: string,
  password: string,
): Promise<User | undefined> {
  const { rows } = await pool.query<UserRow>("SELECT * FROM users WHERE email = $1", [
    normalizeEmail(email),
  ]);
  const row = rows[0];
  // An OAuth-only account (see createOAuthOnlyUser) has no password to check
  // against - never treat a null hash as a match, whatever "password" is.
  if (!row || row.password_hash === null) return undefined;
  const valid = await verifyPassword(password, row.password_hash);
  return valid ? toUser(row) : undefined;
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}
