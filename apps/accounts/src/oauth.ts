import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Thrown when a provider's client id/secret env vars are missing/blank. */
export class OAuthConfigError extends Error {}

/** Thrown for a `state` parameter that's malformed, mismatched, or expired. */
export class InvalidOAuthStateError extends Error {}

export interface OAuthUserInfo {
  providerUserId: string;
  email: string;
}

export interface OAuthProvider {
  name: string;
  authorizeUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scope: string;
  fetchUserInfo(accessToken: string): Promise<OAuthUserInfo>;
}

function envOrDefault(name: string, defaultValue: string): string {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value : defaultValue;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new OAuthConfigError(
      `Missing ${name} environment variable. Set it to enable OAuth login via this provider.`,
    );
  }
  return value;
}

async function fetchJson(
  url: string,
  init: Parameters<typeof fetch>[1],
  errorContext: string,
): Promise<Record<string, unknown>> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`${errorContext} responded with ${response.status}`);
  }
  return (await response.json()) as Record<string, unknown>;
}

/**
 * Google's OpenID-Connect endpoints. `GOOGLE_AUTHORIZE_URL`/`GOOGLE_TOKEN_URL`/
 * `GOOGLE_USERINFO_URL` override the defaults - used by tests to point the
 * exact same flow at a local fake provider, since there's no way to
 * register a real Google OAuth app or reach Google's servers from this
 * sandbox.
 */
function googleProvider(): OAuthProvider {
  const userInfoUrl = envOrDefault(
    "GOOGLE_USERINFO_URL",
    "https://openidconnect.googleapis.com/v1/userinfo",
  );
  return {
    name: "google",
    authorizeUrl: envOrDefault(
      "GOOGLE_AUTHORIZE_URL",
      "https://accounts.google.com/o/oauth2/v2/auth",
    ),
    tokenUrl: envOrDefault("GOOGLE_TOKEN_URL", "https://oauth2.googleapis.com/token"),
    clientId: requireEnv("GOOGLE_CLIENT_ID"),
    clientSecret: requireEnv("GOOGLE_CLIENT_SECRET"),
    scope: "openid email",
    async fetchUserInfo(accessToken) {
      const body = await fetchJson(
        userInfoUrl,
        { headers: { Authorization: `Bearer ${accessToken}` } },
        "Google userinfo request",
      );
      const sub = body.sub;
      const email = body.email;
      if (typeof sub !== "string" || typeof email !== "string") {
        throw new Error("Google userinfo response is missing sub/email");
      }
      return { providerUserId: sub, email };
    },
  };
}

/**
 * GitHub's OAuth endpoints. A user's email on `GET /user` is `null` unless
 * they've made it public, so this falls back to `GET /user/emails` and picks
 * their primary verified address - GitHub's own documented pattern for
 * getting a reliable email out of the OAuth flow.
 * `GITHUB_AUTHORIZE_URL`/`GITHUB_TOKEN_URL`/`GITHUB_API_BASE_URL` override
 * the defaults for the same reason as Google's above.
 */
function githubProvider(): OAuthProvider {
  const apiBaseUrl = envOrDefault("GITHUB_API_BASE_URL", "https://api.github.com");
  return {
    name: "github",
    authorizeUrl: envOrDefault("GITHUB_AUTHORIZE_URL", "https://github.com/login/oauth/authorize"),
    tokenUrl: envOrDefault("GITHUB_TOKEN_URL", "https://github.com/login/oauth/access_token"),
    clientId: requireEnv("GITHUB_CLIENT_ID"),
    clientSecret: requireEnv("GITHUB_CLIENT_SECRET"),
    scope: "read:user user:email",
    async fetchUserInfo(accessToken) {
      const headers = {
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": "maker-image-tools-accounts",
        Accept: "application/json",
      };
      const user = await fetchJson(`${apiBaseUrl}/user`, { headers }, "GitHub user request");
      const providerUserId = user.id;
      if (typeof providerUserId !== "number" && typeof providerUserId !== "string") {
        throw new Error("GitHub user response is missing id");
      }
      if (typeof user.email === "string") {
        return { providerUserId: String(providerUserId), email: user.email };
      }

      const emailsResponse = await fetch(`${apiBaseUrl}/user/emails`, { headers });
      if (!emailsResponse.ok) {
        throw new Error(`GitHub user emails request responded with ${emailsResponse.status}`);
      }
      const emails = (await emailsResponse.json()) as Array<{
        email: string;
        primary: boolean;
        verified: boolean;
      }>;
      const chosen =
        emails.find((entry) => entry.primary && entry.verified) ??
        emails.find((entry) => entry.verified);
      if (!chosen) {
        throw new Error("GitHub account has no verified email address");
      }
      return { providerUserId: String(providerUserId), email: chosen.email };
    },
  };
}

/**
 * Discord's OAuth endpoints. `GET /users/@me` (with the `email` scope
 * granted) returns `email`/`verified` directly - no separate emails
 * endpoint to fall back to like GitHub's, but `verified` still needs
 * checking: Discord lets a user grant the `email` scope with an
 * unverified address attached to their account.
 * `DISCORD_AUTHORIZE_URL`/`DISCORD_TOKEN_URL`/`DISCORD_API_BASE_URL`
 * override the defaults for the same reason as Google's/GitHub's above.
 */
function discordProvider(): OAuthProvider {
  const apiBaseUrl = envOrDefault("DISCORD_API_BASE_URL", "https://discord.com/api");
  return {
    name: "discord",
    authorizeUrl: envOrDefault("DISCORD_AUTHORIZE_URL", "https://discord.com/oauth2/authorize"),
    tokenUrl: envOrDefault("DISCORD_TOKEN_URL", "https://discord.com/api/oauth2/token"),
    clientId: requireEnv("DISCORD_CLIENT_ID"),
    clientSecret: requireEnv("DISCORD_CLIENT_SECRET"),
    scope: "identify email",
    async fetchUserInfo(accessToken) {
      const body = await fetchJson(
        `${apiBaseUrl}/users/@me`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
        "Discord user request",
      );
      const providerUserId = body.id;
      const email = body.email;
      if (typeof providerUserId !== "string" || typeof email !== "string") {
        throw new Error("Discord user response is missing id/email");
      }
      if (body.verified !== true) {
        throw new Error("Discord account has no verified email address");
      }
      return { providerUserId, email };
    },
  };
}

const PROVIDER_FACTORIES: Record<string, () => OAuthProvider> = {
  google: googleProvider,
  github: githubProvider,
  discord: discordProvider,
};

export function getOAuthProvider(name: string): OAuthProvider | undefined {
  return PROVIDER_FACTORIES[name]?.();
}

// --- PKCE + signed state -----------------------------------------------
//
// The `state` param carries its own PKCE code_verifier and an expiry, HMAC
// signed with a secret generated once per process. That's enough to detect
// tampering and replay-after-expiry without a database table or an extra
// required env var - the whole state only needs to survive one browser
// round trip within a single server process's uptime.

const STATE_SECRET = randomBytes(32);
const STATE_TTL_MS = 10 * 60 * 1000;

interface OAuthStatePayload {
  provider: string;
  codeVerifier: string;
  issuedAt: number;
  /** Set when this flow started as "connect another provider" from a signed-in session, rather than a login. */
  linkUserId?: string;
}

function signState(payload: OAuthStatePayload): string {
  const encoded = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
  const signature = createHmac("sha256", STATE_SECRET).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function verifyState(state: string, expectedProvider: string): OAuthStatePayload {
  const [encoded, signature] = state.split(".");
  if (!encoded || !signature) {
    throw new InvalidOAuthStateError("Malformed state parameter");
  }
  const expectedSignature = createHmac("sha256", STATE_SECRET).update(encoded).digest("base64url");
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    throw new InvalidOAuthStateError("State signature mismatch");
  }

  let payload: OAuthStatePayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf-8")) as OAuthStatePayload;
  } catch {
    throw new InvalidOAuthStateError("Malformed state payload");
  }
  if (payload.provider !== expectedProvider) {
    throw new InvalidOAuthStateError("State provider mismatch");
  }
  if (Date.now() - payload.issuedAt > STATE_TTL_MS) {
    throw new InvalidOAuthStateError("State expired");
  }
  return payload;
}

function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

function codeChallengeFromVerifier(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export interface OAuthAuthorizationRequest {
  redirectTo: string;
}

/**
 * Builds the provider consent-page URL a caller should redirect the browser
 * to. Pass `linkUserId` when this flow is "connect another provider" from an
 * already-signed-in session - `exchangeCodeForUserInfo` hands it back after
 * the round trip so the callback can link to that account instead of
 * running the ordinary find-or-create-by-email login flow.
 */
export function buildAuthorizationRequest(
  provider: OAuthProvider,
  redirectUri: string,
  linkUserId?: string,
): OAuthAuthorizationRequest {
  const codeVerifier = generateCodeVerifier();
  const state = signState({
    provider: provider.name,
    codeVerifier,
    issuedAt: Date.now(),
    ...(linkUserId ? { linkUserId } : {}),
  });

  const url = new URL(provider.authorizeUrl);
  url.searchParams.set("client_id", provider.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", provider.scope);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallengeFromVerifier(codeVerifier));
  url.searchParams.set("code_challenge_method", "S256");
  return { redirectTo: url.toString() };
}

export interface OAuthExchangeResult {
  userInfo: OAuthUserInfo;
  /** Present when the original `/start` request carried a `linkUserId` (see `buildAuthorizationRequest`). */
  linkUserId?: string;
}

/** Exchanges an authorization `code` for the provider's user info, validating `state`/PKCE along the way. */
export async function exchangeCodeForUserInfo(
  provider: OAuthProvider,
  code: string,
  state: string,
  redirectUri: string,
): Promise<OAuthExchangeResult> {
  const { codeVerifier, linkUserId } = verifyState(state, provider.name);

  const tokenBody = await fetchJson(
    provider.tokenUrl,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        client_id: provider.clientId,
        client_secret: provider.clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        code_verifier: codeVerifier,
      }).toString(),
    },
    `${provider.name} token exchange`,
  );
  const accessToken = tokenBody.access_token;
  if (typeof accessToken !== "string") {
    throw new Error(`${provider.name} token response did not include an access_token`);
  }
  const userInfo = await provider.fetchUserInfo(accessToken);
  return { userInfo, ...(linkUserId ? { linkUserId } : {}) };
}
