import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import type { Pool } from "pg";
import { createServer } from "../src/server.js";
import { createSession } from "../src/sessions.js";
import { createOAuthOnlyUser } from "../src/users.js";
import { requireTestPool, resetTestDb, setupTestDb } from "./testDb.js";
import { startFakeOAuthProvider, type FakeOAuthProvider } from "./fakeOAuthProvider.js";

const ENV_KEYS = [
  "ACCOUNTS_BASE_URL",
  "WEB_APP_URL",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_AUTHORIZE_URL",
  "GOOGLE_TOKEN_URL",
  "GOOGLE_USERINFO_URL",
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
  "GITHUB_AUTHORIZE_URL",
  "GITHUB_TOKEN_URL",
  "GITHUB_API_BASE_URL",
  "DISCORD_CLIENT_ID",
  "DISCORD_CLIENT_SECRET",
  "DISCORD_AUTHORIZE_URL",
  "DISCORD_TOKEN_URL",
  "DISCORD_API_BASE_URL",
] as const;

describe("OAuth login", () => {
  let pool: Pool;
  let server: Server;
  let baseUrl: string;
  let fakeProvider: FakeOAuthProvider;
  const originalEnv: Record<string, string | undefined> = {};

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
    for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
    fakeProvider = await startFakeOAuthProvider();
    process.env.ACCOUNTS_BASE_URL = baseUrl;
    process.env.WEB_APP_URL = "http://localhost:5173";
    process.env.GOOGLE_CLIENT_ID = "google-client-id";
    process.env.GOOGLE_CLIENT_SECRET = "google-client-secret";
    process.env.GOOGLE_AUTHORIZE_URL = `${fakeProvider.baseUrl}/authorize`;
    process.env.GOOGLE_TOKEN_URL = `${fakeProvider.baseUrl}/token`;
    process.env.GOOGLE_USERINFO_URL = `${fakeProvider.baseUrl}/userinfo`;
    process.env.GITHUB_CLIENT_ID = "github-client-id";
    process.env.GITHUB_CLIENT_SECRET = "github-client-secret";
    process.env.GITHUB_AUTHORIZE_URL = `${fakeProvider.baseUrl}/authorize`;
    process.env.GITHUB_TOKEN_URL = `${fakeProvider.baseUrl}/token`;
    process.env.GITHUB_API_BASE_URL = fakeProvider.baseUrl;
    process.env.DISCORD_CLIENT_ID = "discord-client-id";
    process.env.DISCORD_CLIENT_SECRET = "discord-client-secret";
    process.env.DISCORD_AUTHORIZE_URL = `${fakeProvider.baseUrl}/authorize`;
    process.env.DISCORD_TOKEN_URL = `${fakeProvider.baseUrl}/token`;
    process.env.DISCORD_API_BASE_URL = fakeProvider.baseUrl;
  });

  afterEach(async () => {
    await fakeProvider.close();
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  });

  function extractQueryParam(location: string, param: string): string | null {
    return new URL(location).searchParams.get(param);
  }

  async function startFlow(
    provider: string,
    linkToken?: string,
  ): Promise<{ location: string; state: string }> {
    const query = linkToken ? `?linkToken=${encodeURIComponent(linkToken)}` : "";
    const response = await fetch(`${baseUrl}/oauth/${provider}/start${query}`, {
      redirect: "manual",
    });
    expect(response.status).toBe(302);
    const location = response.headers.get("location")!;
    const state = extractQueryParam(location, "state")!;
    expect(state).toBeTruthy();
    return { location, state };
  }

  async function runCallback(
    provider: string,
    query: Record<string, string>,
  ): Promise<{ status: number; location: string | null }> {
    const params = new URLSearchParams(query);
    const response = await fetch(`${baseUrl}/oauth/${provider}/callback?${params.toString()}`, {
      redirect: "manual",
    });
    return { status: response.status, location: response.headers.get("location") };
  }

  it("GET /oauth/google/start redirects to a well-formed authorization URL", async () => {
    const { location } = await startFlow("google");
    const url = new URL(location);
    expect(url.origin + url.pathname).toBe(`${fakeProvider.baseUrl}/authorize`);
    expect(url.searchParams.get("client_id")).toBe("google-client-id");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("redirect_uri")).toBe(`${baseUrl}/oauth/google/callback`);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
  });

  it("completes a full Google login for a brand-new user", async () => {
    await fakeProvider.close();
    fakeProvider = await startFakeOAuthProvider({
      userInfo: { sub: "google-sub-1", email: "ada@example.com" },
    });
    process.env.GOOGLE_TOKEN_URL = `${fakeProvider.baseUrl}/token`;
    process.env.GOOGLE_USERINFO_URL = `${fakeProvider.baseUrl}/userinfo`;

    const { state } = await startFlow("google");
    const { status, location } = await runCallback("google", { code: "fake-code", state });

    expect(status).toBe(302);
    const callbackUrl = new URL(location!.replace("#/", ""));
    expect(callbackUrl.origin).toBe("http://localhost:5173");
    const token = callbackUrl.searchParams.get("token");
    expect(token).toBeTruthy();

    const me = await fetch(`${baseUrl}/me`, { headers: { Authorization: `Bearer ${token}` } });
    expect(me.status).toBe(200);
    const body = await me.json();
    expect(body.user.email).toBe("ada@example.com");
    expect(body.user.role).toBe("user");

    expect(fakeProvider.tokenRequests[0]?.get("code")).toBe("fake-code");
    expect(fakeProvider.tokenRequests[0]?.get("grant_type")).toBe("authorization_code");
    expect(fakeProvider.tokenRequests[0]?.get("code_verifier")).toBeTruthy();
  });

  it("reuses the same local user on a second login from the same Google identity", async () => {
    await fakeProvider.close();
    fakeProvider = await startFakeOAuthProvider({
      userInfo: { sub: "google-sub-2", email: "grace@example.com" },
    });
    process.env.GOOGLE_TOKEN_URL = `${fakeProvider.baseUrl}/token`;
    process.env.GOOGLE_USERINFO_URL = `${fakeProvider.baseUrl}/userinfo`;

    const first = await startFlow("google");
    const firstCallback = await runCallback("google", { code: "code-1", state: first.state });
    const firstToken = new URL(firstCallback.location!.replace("#/", "")).searchParams.get("token");
    const firstMe = await (
      await fetch(`${baseUrl}/me`, { headers: { Authorization: `Bearer ${firstToken}` } })
    ).json();

    const second = await startFlow("google");
    const secondCallback = await runCallback("google", { code: "code-2", state: second.state });
    const secondToken = new URL(secondCallback.location!.replace("#/", "")).searchParams.get(
      "token",
    );
    const secondMe = await (
      await fetch(`${baseUrl}/me`, { headers: { Authorization: `Bearer ${secondToken}` } })
    ).json();

    expect(secondMe.user.id).toBe(firstMe.user.id);
  });

  it("links a Google login to an existing email/password account with the same email", async () => {
    const signup = await fetch(`${baseUrl}/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "shared@example.com", password: "hunter22222" }),
    });
    const { user: passwordUser } = await signup.json();

    await fakeProvider.close();
    fakeProvider = await startFakeOAuthProvider({
      userInfo: { sub: "google-sub-3", email: "shared@example.com" },
    });
    process.env.GOOGLE_TOKEN_URL = `${fakeProvider.baseUrl}/token`;
    process.env.GOOGLE_USERINFO_URL = `${fakeProvider.baseUrl}/userinfo`;

    const { state } = await startFlow("google");
    const { location } = await runCallback("google", { code: "fake-code", state });
    const token = new URL(location!.replace("#/", "")).searchParams.get("token");
    const me = await (
      await fetch(`${baseUrl}/me`, { headers: { Authorization: `Bearer ${token}` } })
    ).json();

    expect(me.user.id).toBe(passwordUser.id);
  });

  it("falls back to /user/emails when GitHub's primary user response has no public email", async () => {
    await fakeProvider.close();
    fakeProvider = await startFakeOAuthProvider({
      githubUser: { id: 42, email: null },
      githubEmails: [
        { email: "secondary@example.com", primary: false, verified: true },
        { email: "primary@example.com", primary: true, verified: true },
      ],
    });
    process.env.GITHUB_TOKEN_URL = `${fakeProvider.baseUrl}/token`;
    process.env.GITHUB_API_BASE_URL = fakeProvider.baseUrl;

    const { state } = await startFlow("github");
    const { location } = await runCallback("github", { code: "fake-code", state });
    const token = new URL(location!.replace("#/", "")).searchParams.get("token");
    const me = await (
      await fetch(`${baseUrl}/me`, { headers: { Authorization: `Bearer ${token}` } })
    ).json();

    expect(me.user.email).toBe("primary@example.com");
  });

  it("completes a full Discord login for a brand-new user", async () => {
    await fakeProvider.close();
    fakeProvider = await startFakeOAuthProvider({
      discordUser: { id: "discord-id-1", email: "ada@example.com", verified: true },
    });
    process.env.DISCORD_TOKEN_URL = `${fakeProvider.baseUrl}/token`;
    process.env.DISCORD_API_BASE_URL = fakeProvider.baseUrl;

    const { state } = await startFlow("discord");
    const { status, location } = await runCallback("discord", { code: "fake-code", state });

    expect(status).toBe(302);
    const callbackUrl = new URL(location!.replace("#/", ""));
    const token = callbackUrl.searchParams.get("token");
    expect(token).toBeTruthy();

    const me = await (
      await fetch(`${baseUrl}/me`, { headers: { Authorization: `Bearer ${token}` } })
    ).json();
    expect(me.user.email).toBe("ada@example.com");
  });

  it("rejects a Discord login with an unverified email", async () => {
    await fakeProvider.close();
    fakeProvider = await startFakeOAuthProvider({
      discordUser: { id: "discord-id-2", email: "unverified@example.com", verified: false },
    });
    process.env.DISCORD_TOKEN_URL = `${fakeProvider.baseUrl}/token`;
    process.env.DISCORD_API_BASE_URL = fakeProvider.baseUrl;

    const { state } = await startFlow("discord");
    const { status, location } = await runCallback("discord", { code: "fake-code", state });

    expect(status).toBe(302);
    expect(location).toContain("/#/oauth-callback?error=");
  });

  it("redirects to the web app with an error when the provider reports one (user declined consent)", async () => {
    const { status, location } = await runCallback("google", { error: "access_denied" });
    expect(status).toBe(302);
    expect(location).toContain("http://localhost:5173/#/oauth-callback?error=access_denied");
    expect(fakeProvider.tokenRequests).toHaveLength(0);
  });

  it("redirects to the web app with an error for a missing code or state", async () => {
    const { status, location } = await runCallback("google", {});
    expect(status).toBe(302);
    expect(location).toContain("error=missing_code_or_state");
  });

  it("redirects to the web app with an error for a tampered state", async () => {
    const { state } = await startFlow("google");
    const tampered = state.slice(0, -1) + (state.at(-1) === "a" ? "b" : "a");
    const { status, location } = await runCallback("google", {
      code: "fake-code",
      state: tampered,
    });
    expect(status).toBe(302);
    expect(location).toContain("/#/oauth-callback?error=");
  });

  it("returns 404 for an unknown provider", async () => {
    const startResponse = await fetch(`${baseUrl}/oauth/facebook/start`, { redirect: "manual" });
    expect(startResponse.status).toBe(404);

    const callbackResponse = await fetch(`${baseUrl}/oauth/facebook/callback?code=x&state=y`, {
      redirect: "manual",
    });
    expect(callbackResponse.status).toBe(404);
  });

  it("returns 500 when the provider's client id/secret aren't configured", async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    const response = await fetch(`${baseUrl}/oauth/google/start`, { redirect: "manual" });
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toContain("GOOGLE_CLIENT_ID");
  });

  it("returns 500 when ACCOUNTS_BASE_URL isn't configured", async () => {
    delete process.env.ACCOUNTS_BASE_URL;
    const response = await fetch(`${baseUrl}/oauth/google/start`, { redirect: "manual" });
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toContain("ACCOUNTS_BASE_URL");
  });

  describe("connecting another provider from a signed-in session", () => {
    it("links a second provider to the signed-in caller's account, not a new or email-matched one", async () => {
      const signup = await fetch(`${baseUrl}/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "ada@example.com", password: "hunter22222" }),
      });
      const { user: passwordUser, token } = await signup.json();

      await fakeProvider.close();
      fakeProvider = await startFakeOAuthProvider({
        githubUser: { id: "github-sub-1", email: "ada+github@example.com" },
      });
      process.env.GITHUB_TOKEN_URL = `${fakeProvider.baseUrl}/token`;
      process.env.GITHUB_API_BASE_URL = fakeProvider.baseUrl;

      const { state } = await startFlow("github", token);
      const { status, location } = await runCallback("github", { code: "fake-code", state });
      expect(status).toBe(302);
      const linkToken = new URL(location!.replace("#/", "")).searchParams.get("token");
      const linkedMe = await (
        await fetch(`${baseUrl}/me`, { headers: { Authorization: `Bearer ${linkToken}` } })
      ).json();

      // Linked to the already-signed-in account, not a new user or one matched by the GitHub email.
      expect(linkedMe.user.id).toBe(passwordUser.id);
      expect(linkedMe.user.email).toBe("ada@example.com");
    });

    it("rejects linking an identity already linked to a different account with a redirect error", async () => {
      await fakeProvider.close();
      fakeProvider = await startFakeOAuthProvider({
        userInfo: { sub: "google-sub-shared", email: "first@example.com" },
      });
      process.env.GOOGLE_TOKEN_URL = `${fakeProvider.baseUrl}/token`;
      process.env.GOOGLE_USERINFO_URL = `${fakeProvider.baseUrl}/userinfo`;

      const { state: firstState } = await startFlow("google");
      const { location: firstLocation } = await runCallback("google", {
        code: "code-1",
        state: firstState,
      });
      const firstOwner = new URL(firstLocation!.replace("#/", "")).searchParams.get("token")!;
      const firstOwnerMe = await (
        await fetch(`${baseUrl}/me`, { headers: { Authorization: `Bearer ${firstOwner}` } })
      ).json();

      const secondOwner = await createOAuthOnlyUser(pool, "second@example.com");
      const secondOwnerSession = await createSession(pool, secondOwner.id);

      const { state } = await startFlow("google", secondOwnerSession.token);
      const { status, location } = await runCallback("google", { code: "code-2", state });
      expect(status).toBe(302);
      expect(location).toContain("/#/oauth-callback?error=");
      expect(location).toContain("already");

      // The identity is still linked to whoever had it first, unaffected by the failed attempt.
      const stillFirst = await (
        await fetch(`${baseUrl}/me`, { headers: { Authorization: `Bearer ${firstOwner}` } })
      ).json();
      expect(stillFirst.user.id).toBe(firstOwnerMe.user.id);
    });

    it("rejects a start request with an invalid linkToken with 401", async () => {
      const response = await fetch(`${baseUrl}/oauth/github/start?linkToken=not-a-real-token`, {
        redirect: "manual",
      });
      expect(response.status).toBe(401);
    });
  });
});
