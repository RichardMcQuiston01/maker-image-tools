import type { Pool } from "pg";
import { hashPassword, verifyPassword } from "./password.js";

export interface User {
  id: string;
  email: string;
  planTier: string;
  createdAt: Date;
}

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  plan_tier: string;
  created_at: Date;
}

function toUser(row: UserRow): User {
  return { id: row.id, email: row.email, planTier: row.plan_tier, createdAt: row.created_at };
}

/** Thrown by `createUser` when the email is already registered. */
export class EmailAlreadyRegisteredError extends Error {}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

/** Thrown for a caller-supplied email/password that fails basic format validation. */
export class InvalidCredentialsFormatError extends Error {}

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
  if (!row) return undefined;
  const valid = await verifyPassword(password, row.password_hash);
  return valid ? toUser(row) : undefined;
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}
