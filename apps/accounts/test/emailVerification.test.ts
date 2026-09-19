import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import {
  confirmEmailVerification,
  EmailAlreadyVerifiedError,
  InvalidEmailVerificationTokenError,
  sendVerificationEmail,
} from "../src/emailVerification.js";
import { createOAuthOnlyUser, createUser } from "../src/users.js";
import { requireTestPool, resetTestDb, setupTestDb } from "./testDb.js";
import { startFakeMailProvider, type FakeMailProvider } from "./fakeMailProvider.js";

const ENV_KEYS = ["MAIL_API_KEY", "MAIL_FROM_ADDRESS", "MAIL_API_URL"] as const;
const VERIFY_URL_BASE = "http://localhost:5173/#/verify-email";

function extractToken(emailText: string): string {
  const match = emailText.match(/token=(\S+)/);
  if (!match) throw new Error(`No token found in email text: ${emailText}`);
  return decodeURIComponent(match[1]!);
}

describe("email verification", () => {
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

  it("creates OAuth-only accounts already verified", async () => {
    const user = await createOAuthOnlyUser(pool, "oauth-only@example.com");
    expect(user.emailVerified).toBe(true);
  });

  it("creates password accounts unverified", async () => {
    const user = await createUser(pool, "ada@example.com", "hunter22222");
    expect(user.emailVerified).toBe(false);
  });

  it("emails a verification link and lets the token confirm it", async () => {
    const user = await createUser(pool, "ada@example.com", "hunter22222");

    await sendVerificationEmail(pool, user.id, VERIFY_URL_BASE);
    expect(provider.sent).toHaveLength(1);
    expect(provider.sent[0]?.to).toBe("ada@example.com");
    expect(provider.sent[0]?.text).toContain(VERIFY_URL_BASE);

    const token = extractToken(provider.sent[0]!.text);
    const verified = await confirmEmailVerification(pool, token);
    expect(verified.id).toBe(user.id);
    expect(verified.emailVerified).toBe(true);
  });

  it("refuses to send a verification email for an already-verified account", async () => {
    const user = await createOAuthOnlyUser(pool, "oauth-only@example.com");
    await expect(sendVerificationEmail(pool, user.id, VERIFY_URL_BASE)).rejects.toThrow(
      EmailAlreadyVerifiedError,
    );
    expect(provider.sent).toHaveLength(0);
  });

  it("rejects an unknown token", async () => {
    await expect(confirmEmailVerification(pool, "not-a-real-token")).rejects.toThrow(
      InvalidEmailVerificationTokenError,
    );
  });

  it("rejects a token that's already been used", async () => {
    const user = await createUser(pool, "ada@example.com", "hunter22222");
    await sendVerificationEmail(pool, user.id, VERIFY_URL_BASE);
    const token = extractToken(provider.sent[0]!.text);

    await confirmEmailVerification(pool, token);
    await expect(confirmEmailVerification(pool, token)).rejects.toThrow(
      InvalidEmailVerificationTokenError,
    );
  });

  it("rejects an expired token", async () => {
    const user = await createUser(pool, "ada@example.com", "hunter22222");
    await sendVerificationEmail(pool, user.id, VERIFY_URL_BASE);
    const token = extractToken(provider.sent[0]!.text);

    await pool.query(
      "UPDATE email_verification_tokens SET expires_at = now() - interval '1 hour' WHERE user_id = $1",
      [user.id],
    );

    await expect(confirmEmailVerification(pool, token)).rejects.toThrow(
      InvalidEmailVerificationTokenError,
    );
  });
});
