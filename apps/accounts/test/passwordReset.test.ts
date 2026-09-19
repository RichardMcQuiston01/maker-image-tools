import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import {
  confirmPasswordReset,
  InvalidPasswordResetTokenError,
  requestPasswordReset,
} from "../src/passwordReset.js";
import { createSession, validateSession } from "../src/sessions.js";
import { authenticate, createOAuthOnlyUser, createUser } from "../src/users.js";
import { requireTestPool, resetTestDb, setupTestDb } from "./testDb.js";
import { startFakeMailProvider, type FakeMailProvider } from "./fakeMailProvider.js";

const ENV_KEYS = ["MAIL_API_KEY", "MAIL_FROM_ADDRESS", "MAIL_API_URL"] as const;
const RESET_URL_BASE = "http://localhost:5173/#/reset-password";

function extractToken(emailText: string): string {
  const match = emailText.match(/token=(\S+)/);
  if (!match) throw new Error(`No token found in email text: ${emailText}`);
  return decodeURIComponent(match[1]!);
}

describe("password reset", () => {
  let pool: Pool;
  let provider: FakeMailProvider;
  const originalEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    pool = requireTestPool();
    await setupTestDb(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await resetTestDb(pool);
    for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
    provider = await startFakeMailProvider();
    process.env.MAIL_API_KEY = "fake-mail-api-key";
    process.env.MAIL_FROM_ADDRESS = "accounts@example.com";
    process.env.MAIL_API_URL = provider.baseUrl;
  });

  afterEach(async () => {
    await provider.close();
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  });

  it("emails a reset link and lets the token be used to set a new password", async () => {
    await createUser(pool, "ada@example.com", "old-password1");

    await requestPasswordReset(pool, "ada@example.com", RESET_URL_BASE);
    expect(provider.sent).toHaveLength(1);
    expect(provider.sent[0]?.to).toBe("ada@example.com");
    expect(provider.sent[0]?.text).toContain(RESET_URL_BASE);

    const token = extractToken(provider.sent[0]!.text);
    const user = await confirmPasswordReset(pool, token, "new-password1");
    expect(user.email).toBe("ada@example.com");

    expect(await authenticate(pool, "ada@example.com", "new-password1")).toBeTruthy();
    expect(await authenticate(pool, "ada@example.com", "old-password1")).toBeUndefined();
  });

  it("lets an OAuth-only account gain password login via a reset token", async () => {
    const oauthUser = await createOAuthOnlyUser(pool, "oauth-only@example.com");
    expect(oauthUser.hasPassword).toBe(false);

    await requestPasswordReset(pool, "oauth-only@example.com", RESET_URL_BASE);
    const token = extractToken(provider.sent[0]!.text);
    const user = await confirmPasswordReset(pool, token, "brand-new-password1");

    expect(user.hasPassword).toBe(true);
    expect(await authenticate(pool, "oauth-only@example.com", "brand-new-password1")).toBeTruthy();
  });

  it("does not send an email or reveal anything for an unregistered email", async () => {
    await requestPasswordReset(pool, "nobody@example.com", RESET_URL_BASE);
    expect(provider.sent).toHaveLength(0);
  });

  it("revokes the account's existing sessions once the password is reset", async () => {
    const user = await createUser(pool, "ada@example.com", "old-password1");
    const session = await createSession(pool, user.id);
    expect(await validateSession(pool, session.token)).toBeTruthy();

    await requestPasswordReset(pool, "ada@example.com", RESET_URL_BASE);
    const token = extractToken(provider.sent[0]!.text);
    await confirmPasswordReset(pool, token, "new-password1");

    expect(await validateSession(pool, session.token)).toBeUndefined();
  });

  it("rejects an unknown token", async () => {
    await expect(confirmPasswordReset(pool, "not-a-real-token", "new-password1")).rejects.toThrow(
      InvalidPasswordResetTokenError,
    );
  });

  it("rejects a token that's already been used", async () => {
    await createUser(pool, "ada@example.com", "old-password1");
    await requestPasswordReset(pool, "ada@example.com", RESET_URL_BASE);
    const token = extractToken(provider.sent[0]!.text);

    await confirmPasswordReset(pool, token, "new-password1");
    await expect(confirmPasswordReset(pool, token, "another-password1")).rejects.toThrow(
      InvalidPasswordResetTokenError,
    );
  });

  it("rejects an expired token", async () => {
    await createUser(pool, "ada@example.com", "old-password1");
    await requestPasswordReset(pool, "ada@example.com", RESET_URL_BASE);
    const token = extractToken(provider.sent[0]!.text);

    await pool.query(
      "UPDATE password_reset_tokens SET expires_at = now() - interval '1 hour' " +
        "WHERE user_id = (SELECT id FROM users WHERE email = 'ada@example.com')",
    );

    await expect(confirmPasswordReset(pool, token, "new-password1")).rejects.toThrow(
      InvalidPasswordResetTokenError,
    );
  });

  it("rejects a too-short new password without consuming the token", async () => {
    await createUser(pool, "ada@example.com", "old-password1");
    await requestPasswordReset(pool, "ada@example.com", RESET_URL_BASE);
    const token = extractToken(provider.sent[0]!.text);

    await expect(confirmPasswordReset(pool, token, "short")).rejects.toThrow();

    // The token must still be usable - a rejected password shouldn't burn it.
    const user = await confirmPasswordReset(pool, token, "long-enough-password");
    expect(user.email).toBe("ada@example.com");
  });
});
