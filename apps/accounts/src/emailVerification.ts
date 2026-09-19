import { createHash, randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { sendMail } from "./mailer.js";
import { findUserById, markEmailVerified, type User } from "./users.js";

/** Thrown when trying to send/resend a verification email for an account that's already verified. */
export class EmailAlreadyVerifiedError extends Error {}

/** Thrown for a verification token that's unknown, expired, or already used. */
export class InvalidEmailVerificationTokenError extends Error {}

const TOKEN_BYTES = 32;
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Generates an email-verification token for `userId`'s account and emails a
 * link built from `verifyUrlBase` (e.g. `${WEB_APP_URL}/#/verify-email`, see
 * server.ts). Throws `EmailAlreadyVerifiedError` if the account is already
 * verified - an OAuth-only account always is (`createOAuthOnlyUser` marks it
 * verified at creation, since the provider already vouched for the email),
 * so this only ever has real work to do for a password account.
 */
export async function sendVerificationEmail(
  pool: Pool,
  userId: string,
  verifyUrlBase: string,
): Promise<void> {
  const user = await findUserById(pool, userId);
  if (!user) {
    throw new Error(`Cannot send verification email: no user with id ${userId}`);
  }
  if (user.emailVerified) {
    throw new EmailAlreadyVerifiedError(`User (${userId}) already has a verified email`);
  }

  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
  await pool.query(
    "INSERT INTO email_verification_tokens (token_hash, user_id, expires_at) VALUES ($1, $2, $3)",
    [hashToken(token), user.id, expiresAt],
  );

  const verifyUrl = `${verifyUrlBase}?token=${encodeURIComponent(token)}`;
  await sendMail({
    to: user.email,
    subject: "Verify your email",
    text:
      "Confirm this is your email address to finish verifying your account.\n\n" +
      `Verify your email: ${verifyUrl}\n\n` +
      "This link expires in 24 hours.",
  });
}

/**
 * Consumes an email-verification token and marks the account verified,
 * returning the updated user. Throws `InvalidEmailVerificationTokenError`
 * for a token that's unknown, expired, or already used - the single atomic
 * `UPDATE ... RETURNING` below is what makes "already used" race-proof, the
 * same pattern `passwordReset.ts`'s `confirmPasswordReset` uses.
 */
export async function confirmEmailVerification(pool: Pool, token: string): Promise<User> {
  const { rows } = await pool.query<{ user_id: string }>(
    "UPDATE email_verification_tokens SET used_at = now() " +
      "WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() " +
      "RETURNING user_id",
    [hashToken(token)],
  );
  const row = rows[0];
  if (!row) {
    throw new InvalidEmailVerificationTokenError(
      "Invalid, expired, or already-used verification token",
    );
  }

  const user = await markEmailVerified(pool, row.user_id);
  if (!user) {
    throw new Error(`email_verification_tokens row references a missing user (id=${row.user_id})`);
  }
  return user;
}
