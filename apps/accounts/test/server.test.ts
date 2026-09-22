import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import type { Pool } from "pg";
import { createServer } from "../src/server.js";
import { createSession, validateSession } from "../src/sessions.js";
import { createOAuthOnlyUser } from "../src/users.js";
import { requireTestPool, resetTestDb, setupTestDb } from "./testDb.js";
import { startFakeMailProvider, type FakeMailProvider } from "./fakeMailProvider.js";

describe("accounts server", () => {
  let pool: Pool;
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    pool = requireTestPool();
    await setupTestDb(pool);
    server = createServer(pool);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Expected server to bind to a numeric port");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    server.close();
    await pool.end();
  });

  beforeEach(async () => {
    await resetTestDb(pool);
  });

  async function signup(email: string, password: string) {
    return fetch(`${baseUrl}/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
  }

  it("signs up a new user and returns a usable session token", async () => {
    const response = await signup("ada@example.com", "hunter22222");
    expect(response.status).toBe(201);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    const body = await response.json();
    expect(body.user.email).toBe("ada@example.com");
    expect(body.user.role).toBe("user");
    expect(typeof body.token).toBe("string");

    const me = await fetch(`${baseUrl}/me`, {
      headers: { Authorization: `Bearer ${body.token}` },
    });
    expect(me.status).toBe(200);
    expect((await me.json()).user.id).toBe(body.user.id);
  });

  it("promotes a user to moderator based on MODERATOR_EMAILS on signup, login, and /me", async () => {
    const originalModeratorEmails = process.env.MODERATOR_EMAILS;
    process.env.MODERATOR_EMAILS = "ada@example.com";
    try {
      const signupResponse = await signup("ada@example.com", "hunter22222");
      const signupBody = await signupResponse.json();
      expect(signupBody.user.role).toBe("moderator");

      const login = await fetch(`${baseUrl}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "ada@example.com", password: "hunter22222" }),
      });
      expect((await login.json()).user.role).toBe("moderator");

      const me = await fetch(`${baseUrl}/me`, {
        headers: { Authorization: `Bearer ${signupBody.token}` },
      });
      expect((await me.json()).user.role).toBe("moderator");
    } finally {
      if (originalModeratorEmails === undefined) {
        delete process.env.MODERATOR_EMAILS;
      } else {
        process.env.MODERATOR_EMAILS = originalModeratorEmails;
      }
    }
  });

  it("rejects signup with a duplicate email with 409", async () => {
    await signup("ada@example.com", "hunter22222");
    const response = await signup("ada@example.com", "different99");
    expect(response.status).toBe(409);
  });

  it("rejects signup with a short password with 400", async () => {
    const response = await signup("ada@example.com", "short");
    expect(response.status).toBe(400);
  });

  it("logs in with correct credentials and rejects wrong ones", async () => {
    await signup("ada@example.com", "hunter22222");

    const ok = await fetch(`${baseUrl}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "ada@example.com", password: "hunter22222" }),
    });
    expect(ok.status).toBe(200);

    const bad = await fetch(`${baseUrl}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "ada@example.com", password: "wrong-password" }),
    });
    expect(bad.status).toBe(401);
  });

  it("rejects /me without a bearer token", async () => {
    const response = await fetch(`${baseUrl}/me`);
    expect(response.status).toBe(401);
  });

  it("rejects /me with an invalid bearer token", async () => {
    const response = await fetch(`${baseUrl}/me`, {
      headers: { Authorization: "Bearer not-a-real-token" },
    });
    expect(response.status).toBe(401);
  });

  it("logs out and invalidates the session token", async () => {
    const signupResponse = await signup("ada@example.com", "hunter22222");
    const { token } = await signupResponse.json();

    const logout = await fetch(`${baseUrl}/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(logout.status).toBe(204);

    const me = await fetch(`${baseUrl}/me`, { headers: { Authorization: `Bearer ${token}` } });
    expect(me.status).toBe(401);
  });

  it("reports a user's role for a sibling service to verify", async () => {
    const signupResponse = await signup("ada@example.com", "hunter22222");
    const { user } = await signupResponse.json();

    const response = await fetch(`${baseUrl}/users/${user.id}/role`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ role: "user" });
  });

  it("returns 404 for the role of an unknown user id", async () => {
    const response = await fetch(`${baseUrl}/users/00000000-0000-0000-0000-000000000000/role`);
    expect(response.status).toBe(404);
  });

  describe("GET /users/by-email", () => {
    it("looks up a user's id by email for an authenticated caller", async () => {
      const target = await (await signup("target@example.com", "hunter22222")).json();
      const caller = await (await signup("caller@example.com", "hunter22222")).json();

      const response = await fetch(
        `${baseUrl}/users/by-email?email=${encodeURIComponent("target@example.com")}`,
        { headers: { Authorization: `Bearer ${caller.token}` } },
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ id: target.user.id });
    });

    it("returns 404 for an email with no matching user", async () => {
      const caller = await (await signup("caller@example.com", "hunter22222")).json();
      const response = await fetch(`${baseUrl}/users/by-email?email=nobody@example.com`, {
        headers: { Authorization: `Bearer ${caller.token}` },
      });
      expect(response.status).toBe(404);
    });

    it("rejects an unauthenticated caller with 401", async () => {
      const response = await fetch(`${baseUrl}/users/by-email?email=anyone@example.com`);
      expect(response.status).toBe(401);
    });

    it("rejects a missing email query parameter with 400", async () => {
      const caller = await (await signup("caller@example.com", "hunter22222")).json();
      const response = await fetch(`${baseUrl}/users/by-email`, {
        headers: { Authorization: `Bearer ${caller.token}` },
      });
      expect(response.status).toBe(400);
    });
  });

  describe("POST /users/:id/role", () => {
    async function promoteToModerator(email: string) {
      const originalModeratorEmails = process.env.MODERATOR_EMAILS;
      process.env.MODERATOR_EMAILS = email;
      try {
        const signupResponse = await signup(email, "hunter22222");
        return await signupResponse.json();
      } finally {
        if (originalModeratorEmails === undefined) {
          delete process.env.MODERATOR_EMAILS;
        } else {
          process.env.MODERATOR_EMAILS = originalModeratorEmails;
        }
      }
    }

    it("lets an existing moderator promote another user to moderator", async () => {
      const moderator = await promoteToModerator("mod@example.com");
      const targetSignup = await (await signup("target@example.com", "hunter22222")).json();

      const response = await fetch(`${baseUrl}/users/${targetSignup.user.id}/role`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${moderator.token}`,
        },
        body: JSON.stringify({ role: "moderator" }),
      });
      expect(response.status).toBe(200);
      expect((await response.json()).user.role).toBe("moderator");

      const roleCheck = await fetch(`${baseUrl}/users/${targetSignup.user.id}/role`);
      expect((await roleCheck.json()).role).toBe("moderator");
    });

    it("lets an existing moderator demote another moderator back to user", async () => {
      const moderator = await promoteToModerator("mod@example.com");
      const otherModerator = await promoteToModerator("other-mod@example.com");

      const response = await fetch(`${baseUrl}/users/${otherModerator.user.id}/role`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${moderator.token}`,
        },
        body: JSON.stringify({ role: "user" }),
      });
      expect(response.status).toBe(200);
      expect((await response.json()).user.role).toBe("user");
    });

    it("rejects a non-moderator caller with 403", async () => {
      const caller = await (await signup("caller@example.com", "hunter22222")).json();
      const target = await (await signup("target@example.com", "hunter22222")).json();

      const response = await fetch(`${baseUrl}/users/${target.user.id}/role`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${caller.token}`,
        },
        body: JSON.stringify({ role: "moderator" }),
      });
      expect(response.status).toBe(403);

      const roleCheck = await fetch(`${baseUrl}/users/${target.user.id}/role`);
      expect((await roleCheck.json()).role).toBe("user");
    });

    it("rejects a request with no bearer token with 401", async () => {
      const target = await (await signup("target@example.com", "hunter22222")).json();
      const response = await fetch(`${baseUrl}/users/${target.user.id}/role`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "moderator" }),
      });
      expect(response.status).toBe(401);
    });

    it("rejects an invalid role value with 400", async () => {
      const moderator = await promoteToModerator("mod@example.com");
      const target = await (await signup("target@example.com", "hunter22222")).json();

      const response = await fetch(`${baseUrl}/users/${target.user.id}/role`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${moderator.token}`,
        },
        body: JSON.stringify({ role: "admin" }),
      });
      expect(response.status).toBe(400);
    });

    it("returns 404 for an unknown target user id", async () => {
      const moderator = await promoteToModerator("mod@example.com");
      const response = await fetch(`${baseUrl}/users/00000000-0000-0000-0000-000000000000/role`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${moderator.token}`,
        },
        body: JSON.stringify({ role: "moderator" }),
      });
      expect(response.status).toBe(404);
    });
  });

  describe("POST /me/password", () => {
    it("sets a password for an OAuth-only account and lets it log in afterward", async () => {
      const oauthUser = await createOAuthOnlyUser(pool, "oauth-only@example.com");
      const session = await createSession(pool, oauthUser.id);

      const response = await fetch(`${baseUrl}/me/password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({ password: "hunter22222" }),
      });
      expect(response.status).toBe(200);
      expect((await response.json()).user.hasPassword).toBe(true);

      const login = await fetch(`${baseUrl}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "oauth-only@example.com", password: "hunter22222" }),
      });
      expect(login.status).toBe(200);
    });

    it("rejects setting a password on an account that already has one with 409", async () => {
      const signupResponse = await signup("ada@example.com", "hunter22222");
      const { token } = await signupResponse.json();

      const response = await fetch(`${baseUrl}/me/password`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ password: "different99" }),
      });
      expect(response.status).toBe(409);
    });

    it("rejects a request with no bearer token with 401", async () => {
      const response = await fetch(`${baseUrl}/me/password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "hunter22222" }),
      });
      expect(response.status).toBe(401);
    });

    it("rejects a too-short password with 400", async () => {
      const oauthUser = await createOAuthOnlyUser(pool, "oauth-only@example.com");
      const session = await createSession(pool, oauthUser.id);

      const response = await fetch(`${baseUrl}/me/password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({ password: "short" }),
      });
      expect(response.status).toBe(400);
    });
  });

  describe("POST /password-reset/request and /password-reset/confirm", () => {
    const ENV_KEYS = ["MAIL_API_KEY", "MAIL_FROM_ADDRESS", "MAIL_API_URL", "WEB_APP_URL"] as const;
    let provider: FakeMailProvider;
    const originalEnv: Record<string, string | undefined> = {};

    function extractToken(emailText: string): string {
      const match = emailText.match(/token=(\S+)/);
      if (!match) throw new Error(`No token found in email text: ${emailText}`);
      return decodeURIComponent(match[1]!);
    }

    // Signup also fires a best-effort verification email through the same
    // fake provider (see server.ts's sendVerificationEmailBestEffort), so
    // these tests filter by subject rather than asserting on provider.sent's
    // raw length - otherwise they'd depend on that fire-and-forget send's
    // timing relative to the assertion.
    function resetEmailsSentTo(provider: FakeMailProvider, to: string) {
      return provider.sent.filter(
        (email) => email.subject === "Reset your password" && email.to === to,
      );
    }

    beforeEach(async () => {
      for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
      provider = await startFakeMailProvider();
      process.env.MAIL_API_KEY = "fake-mail-api-key";
      process.env.MAIL_FROM_ADDRESS = "accounts@example.com";
      process.env.MAIL_API_URL = provider.baseUrl;
      process.env.WEB_APP_URL = "http://localhost:5173";
    });

    afterEach(async () => {
      await provider.close();
      for (const key of ENV_KEYS) {
        if (originalEnv[key] === undefined) delete process.env[key];
        else process.env[key] = originalEnv[key];
      }
    });

    it("emails a reset link and lets the token confirm a new password with a fresh session", async () => {
      const signupResponse = await signup("ada@example.com", "old-password1");
      const { token: oldSessionToken } = await signupResponse.json();

      const requestResponse = await fetch(`${baseUrl}/password-reset/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "ada@example.com" }),
      });
      expect(requestResponse.status).toBe(202);
      const resetEmails = resetEmailsSentTo(provider, "ada@example.com");
      expect(resetEmails).toHaveLength(1);
      const resetToken = extractToken(resetEmails[0]!.text);
      expect(resetEmails[0]!.text).toContain("http://localhost:5173/#/reset-password");

      const confirmResponse = await fetch(`${baseUrl}/password-reset/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: resetToken, password: "new-password1" }),
      });
      expect(confirmResponse.status).toBe(200);
      const confirmBody = await confirmResponse.json();
      expect(confirmBody.user.email).toBe("ada@example.com");
      expect(typeof confirmBody.token).toBe("string");

      const login = await fetch(`${baseUrl}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "ada@example.com", password: "new-password1" }),
      });
      expect(login.status).toBe(200);

      // The old session should have been revoked by the reset.
      expect(await validateSession(pool, oldSessionToken)).toBeUndefined();
    });

    it("responds the same way whether or not the email is registered", async () => {
      const known = await signup("ada@example.com", "old-password1");
      expect(known.status).toBe(201);

      const knownRequest = await fetch(`${baseUrl}/password-reset/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "ada@example.com" }),
      });
      const unknownRequest = await fetch(`${baseUrl}/password-reset/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "nobody@example.com" }),
      });

      expect(knownRequest.status).toBe(unknownRequest.status);
      expect(await knownRequest.json()).toEqual(await unknownRequest.json());
      // Only the registered email actually got a reset email.
      expect(resetEmailsSentTo(provider, "ada@example.com")).toHaveLength(1);
      expect(resetEmailsSentTo(provider, "nobody@example.com")).toHaveLength(0);
    });

    it("rejects an invalid or expired token with 400", async () => {
      const response = await fetch(`${baseUrl}/password-reset/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "not-a-real-token", password: "new-password1" }),
      });
      expect(response.status).toBe(400);
    });

    it("rejects a too-short new password with 400", async () => {
      await signup("ada@example.com", "old-password1");
      await fetch(`${baseUrl}/password-reset/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "ada@example.com" }),
      });
      const token = extractToken(resetEmailsSentTo(provider, "ada@example.com")[0]!.text);

      const response = await fetch(`${baseUrl}/password-reset/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password: "short" }),
      });
      expect(response.status).toBe(400);
    });
  });

  describe("POST /verify-email and POST /me/resend-verification", () => {
    const ENV_KEYS = ["MAIL_API_KEY", "MAIL_FROM_ADDRESS", "MAIL_API_URL", "WEB_APP_URL"] as const;
    let provider: FakeMailProvider;
    const originalEnv: Record<string, string | undefined> = {};

    function extractToken(emailText: string): string {
      const match = emailText.match(/token=(\S+)/);
      if (!match) throw new Error(`No token found in email text: ${emailText}`);
      return decodeURIComponent(match[1]!);
    }

    function verificationEmailsSentTo(to: string) {
      return provider.sent.filter(
        (email) => email.subject === "Verify your email" && email.to === to,
      );
    }

    beforeEach(async () => {
      for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
      provider = await startFakeMailProvider();
      process.env.MAIL_API_KEY = "fake-mail-api-key";
      process.env.MAIL_FROM_ADDRESS = "accounts@example.com";
      process.env.MAIL_API_URL = provider.baseUrl;
      process.env.WEB_APP_URL = "http://localhost:5173";
    });

    afterEach(async () => {
      await provider.close();
      for (const key of ENV_KEYS) {
        if (originalEnv[key] === undefined) delete process.env[key];
        else process.env[key] = originalEnv[key];
      }
    });

    it("sends a verification email on signup and confirms it via the token", async () => {
      const signupResponse = await signup("ada@example.com", "hunter22222");
      const signupBody = await signupResponse.json();
      expect(signupBody.user.emailVerified).toBe(false);

      // The best-effort send on signup is fire-and-forget - wait for it to land.
      await vi.waitFor(() => expect(verificationEmailsSentTo("ada@example.com")).toHaveLength(1));
      const token = extractToken(verificationEmailsSentTo("ada@example.com")[0]!.text);

      const confirmResponse = await fetch(`${baseUrl}/verify-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      expect(confirmResponse.status).toBe(200);
      const confirmBody = await confirmResponse.json();
      expect(confirmBody.user.id).toBe(signupBody.user.id);
      expect(confirmBody.user.emailVerified).toBe(true);
    });

    it("rejects an invalid or expired token with 400", async () => {
      const response = await fetch(`${baseUrl}/verify-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "not-a-real-token" }),
      });
      expect(response.status).toBe(400);
    });

    it("resends a verification email for the signed-in caller", async () => {
      const signupResponse = await signup("ada@example.com", "hunter22222");
      const { token: sessionToken } = await signupResponse.json();
      await vi.waitFor(() => expect(verificationEmailsSentTo("ada@example.com")).toHaveLength(1));

      const response = await fetch(`${baseUrl}/me/resend-verification`, {
        method: "POST",
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      expect(response.status).toBe(202);
      await vi.waitFor(() => expect(verificationEmailsSentTo("ada@example.com")).toHaveLength(2));
    });

    it("rejects resending for an already-verified account with 409", async () => {
      const oauthUser = await createOAuthOnlyUser(pool, "oauth-only@example.com");
      const session = await createSession(pool, oauthUser.id);

      const response = await fetch(`${baseUrl}/me/resend-verification`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.token}` },
      });
      expect(response.status).toBe(409);
    });

    it("rejects a resend request with no bearer token with 401", async () => {
      const response = await fetch(`${baseUrl}/me/resend-verification`, { method: "POST" });
      expect(response.status).toBe(401);
    });
  });

  it("rejects a request body that isn't valid JSON with 400", async () => {
    const response = await fetch(`${baseUrl}/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    expect(response.status).toBe(400);
  });

  it("answers CORS preflight requests", async () => {
    const response = await fetch(`${baseUrl}/signup`, { method: "OPTIONS" });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-methods")).toContain("POST");
  });

  it("returns 404 for unknown routes", async () => {
    const response = await fetch(`${baseUrl}/nope`);
    expect(response.status).toBe(404);
  });
});
