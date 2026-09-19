import { createHash, randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { sendMail } from "./mailer.js";
import { deleteSessionsForUser } from "./sessions.js";
import { findUserByEmail, setPasswordForUser, validatePassword, type User } from "./users.js";

/** Thrown for a reset token that's unknown, expired, or already used. */
export class InvalidPasswordResetTokenError extends Error {}

const TOKEN_BYTES = 32;
const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Generates a password-reset token for `email`'s account and emails a link
 * built from `resetUrlBase` (e.g. `${WEB_APP_URL}/#/reset-password`, see
 * server.ts). Silently does nothing if no account has that email - the
 * caller (`POST /password-reset/request`) always responds the same way
 * either way, so this never reveals whether an email is registered.
 *
 * Works the same for a password account (forgotten password) and an
 * OAuth-only account (`password_hash IS NULL`) - either way this is "prove
 * you control this email, then set a password", which for an OAuth-only
 * account doubles as a way to gain password login without going through the
 * provider that created it.
 */
export async function requestPasswordReset(
  pool: Pool,
  email: string,
  resetUrlBase: string,
): Promise<void> {
  const user = await findUserByEmail(pool, email);
  if (!user) return;

  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
  await pool.query(
    "INSERT INTO password_reset_tokens (token_hash, user_id, expires_at) VALUES ($1, $2, $3)",
    [hashToken(token), user.id, expiresAt],
  );

  const resetUrl = `${resetUrlBase}?token=${encodeURIComponent(token)}`;
  await sendMail({
    to: user.email,
    subject: "Reset your password",
    text:
      "Someone (hopefully you) requested a password reset for your account.\n\n" +
      `Reset your password: ${resetUrl}\n\n` +
      "This link expires in 1 hour and can only be used once. If you didn't request this, " +
      "you can safely ignore this email.",
  });
}

/**
 * Consumes a password-reset token and sets the new password, returning the
 * updated user. Throws `InvalidPasswordResetTokenError` for a token that's
 * unknown, expired, or already used - the single atomic `UPDATE ... RETURNING`
 * below is what makes "already used" race-proof: two concurrent confirms
 * with the same token can't both succeed.
 *
 * Also revokes every existing session for the account (`deleteSessionsForUser`)
 * - resetting a password is exactly the moment a leaked/shared session token
 * should stop working, rather than staying valid until it naturally expires.
 *
 * Validates `newPassword` before touching the token, not after - a bad
 * password must fail without burning a token the caller can otherwise still
 * use once they fix it.
 */
export async function confirmPasswordReset(
  pool: Pool,
  token: string,
  newPassword: string,
): Promise<User> {
  validatePassword(newPassword);

  const { rows } = await pool.query<{ user_id: string }>(
    "UPDATE password_reset_tokens SET used_at = now() " +
      "WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() " +
      "RETURNING user_id",
    [hashToken(token)],
  );
  const row = rows[0];
  if (!row) {
    throw new InvalidPasswordResetTokenError("Invalid, expired, or already-used reset token");
  }

  const user = await setPasswordForUser(pool, row.user_id, newPassword);
  if (!user) {
    throw new Error(`password_reset_tokens row references a missing user (id=${row.user_id})`);
  }
  await deleteSessionsForUser(pool, user.id);
  return user;
}
