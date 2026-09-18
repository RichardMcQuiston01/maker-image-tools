import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createPool, DatabaseConfigError, runMigrations } from "./db.js";
import { syncModeratorRole } from "./moderators.js";
import {
  buildAuthorizationRequest,
  exchangeCodeForUserInfo,
  getOAuthProvider,
  InvalidOAuthStateError,
  OAuthConfigError,
} from "./oauth.js";
import { findOrCreateUserForOAuthIdentity } from "./oauthIdentities.js";
import { createSession, deleteSession, validateSession } from "./sessions.js";
import {
  authenticate,
  createUser,
  EmailAlreadyRegisteredError,
  findUserById,
  InvalidCredentialsFormatError,
  type User,
} from "./users.js";
import type { Pool } from "pg";

const MAX_BODY_BYTES = 1 * 1024 * 1024;

function setCorsHeaders(res: ServerResponse): void {
  // Wide open for local/dev use; a real deployment would restrict this to the app's own origin.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

async function readBody(req: IncomingMessage): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) {
      throw new Error("Request body too large");
    }
    chunks.push(chunk);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function redirect(res: ServerResponse, location: string): void {
  res.writeHead(302, { Location: location });
  res.end();
}

const OAUTH_START_RE = /^\/oauth\/([^/]+)\/start$/;
const OAUTH_CALLBACK_RE = /^\/oauth\/([^/]+)\/callback$/;
const USER_ROLE_RE = /^\/users\/([^/]+)\/role$/;

function userJson(user: User) {
  return {
    id: user.id,
    email: user.email,
    planTier: user.planTier,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
  };
}

function bearerToken(req: IncomingMessage): string | undefined {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return undefined;
  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : undefined;
}

async function parseJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const body = await readBody(req);
  if (body.length === 0) {
    throw new Error("Request body is empty");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body).toString("utf-8"));
  } catch {
    throw new Error("Request body is not valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Request body must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function requireString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`"${field}" must be a non-empty string`);
  }
  return value;
}

function requireOAuthEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new OAuthConfigError(
      `Missing ${name} environment variable. Set it to enable OAuth login.`,
    );
  }
  return value;
}

function errorStatus(err: unknown): number {
  if (err instanceof DatabaseConfigError || err instanceof OAuthConfigError) return 500;
  if (err instanceof InvalidCredentialsFormatError || err instanceof InvalidOAuthStateError)
    return 400;
  if (err instanceof EmailAlreadyRegisteredError) return 409;
  const message = err instanceof Error ? err.message : "";
  if (message === "Request body too large") return 413;
  if (
    message === "Request body is empty" ||
    message === "Request body is not valid JSON" ||
    message === "Request body must be a JSON object" ||
    message.startsWith('"')
  ) {
    return 400;
  }
  return 500;
}

export function createServer(pool: Pool = createPool()) {
  const migrationsReady = runMigrations(pool);

  return createHttpServer((req, res) => {
    setCorsHeaders(res);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? "/", "http://localhost");
    const pathname = url.pathname;

    migrationsReady
      .then(async () => {
        if (req.method === "POST" && pathname === "/signup") {
          const body = await parseJsonBody(req);
          const email = requireString(body, "email");
          const password = requireString(body, "password");
          const user = await syncModeratorRole(pool, await createUser(pool, email, password));
          const session = await createSession(pool, user.id);
          sendJson(res, 201, { user: userJson(user), token: session.token });
          return;
        }

        if (req.method === "POST" && pathname === "/login") {
          const body = await parseJsonBody(req);
          const email = requireString(body, "email");
          const password = requireString(body, "password");
          const authenticated = await authenticate(pool, email, password);
          if (!authenticated) {
            sendJson(res, 401, { error: "Invalid email or password" });
            return;
          }
          const user = await syncModeratorRole(pool, authenticated);
          const session = await createSession(pool, user.id);
          sendJson(res, 200, { user: userJson(user), token: session.token });
          return;
        }

        if (req.method === "POST" && pathname === "/logout") {
          const token = bearerToken(req);
          if (!token) {
            sendJson(res, 401, { error: "Missing bearer token" });
            return;
          }
          await deleteSession(pool, token);
          res.writeHead(204);
          res.end();
          return;
        }

        if (req.method === "GET" && pathname === "/me") {
          const token = bearerToken(req);
          if (!token) {
            sendJson(res, 401, { error: "Missing bearer token" });
            return;
          }
          const validated = await validateSession(pool, token);
          if (!validated) {
            sendJson(res, 401, { error: "Invalid or expired session" });
            return;
          }
          const user = await syncModeratorRole(pool, validated);
          sendJson(res, 200, { user: userJson(user) });
          return;
        }

        if (req.method === "GET") {
          const roleMatch = pathname.match(USER_ROLE_RE);
          if (roleMatch) {
            const user = await findUserById(pool, roleMatch[1]!);
            if (!user) {
              sendJson(res, 404, { error: "Not found" });
              return;
            }
            sendJson(res, 200, { role: user.role });
            return;
          }

          const startMatch = pathname.match(OAUTH_START_RE);
          if (startMatch) {
            const providerName = startMatch[1]!;
            const provider = getOAuthProvider(providerName);
            if (!provider) {
              sendJson(res, 404, { error: `Unknown OAuth provider "${providerName}"` });
              return;
            }
            const redirectUri = `${requireOAuthEnv("ACCOUNTS_BASE_URL").replace(/\/$/, "")}/oauth/${providerName}/callback`;
            const { redirectTo } = buildAuthorizationRequest(provider, redirectUri);
            redirect(res, redirectTo);
            return;
          }

          const callbackMatch = pathname.match(OAUTH_CALLBACK_RE);
          if (callbackMatch) {
            const providerName = callbackMatch[1]!;
            const webAppUrl = requireOAuthEnv("WEB_APP_URL").replace(/\/$/, "");

            const providerError = url.searchParams.get("error");
            if (providerError) {
              redirect(
                res,
                `${webAppUrl}/#/oauth-callback?error=${encodeURIComponent(providerError)}`,
              );
              return;
            }

            const provider = getOAuthProvider(providerName);
            if (!provider) {
              sendJson(res, 404, { error: `Unknown OAuth provider "${providerName}"` });
              return;
            }
            const code = url.searchParams.get("code");
            const state = url.searchParams.get("state");
            if (!code || !state) {
              redirect(res, `${webAppUrl}/#/oauth-callback?error=missing_code_or_state`);
              return;
            }

            const redirectUri = `${requireOAuthEnv("ACCOUNTS_BASE_URL").replace(/\/$/, "")}/oauth/${providerName}/callback`;
            try {
              const userInfo = await exchangeCodeForUserInfo(provider, code, state, redirectUri);
              const user = await syncModeratorRole(
                pool,
                await findOrCreateUserForOAuthIdentity(pool, {
                  provider: providerName,
                  ...userInfo,
                }),
              );
              const session = await createSession(pool, user.id);
              redirect(
                res,
                `${webAppUrl}/#/oauth-callback?token=${encodeURIComponent(session.token)}`,
              );
            } catch (err) {
              // A callback failure is a browser redirect target, not an API
              // caller expecting JSON - hand the browser back to the app
              // with an error instead of a raw error page.
              const message = err instanceof Error ? err.message : "oauth_failed";
              redirect(res, `${webAppUrl}/#/oauth-callback?error=${encodeURIComponent(message)}`);
            }
            return;
          }
        }

        sendJson(res, 404, { error: "Not found" });
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : "Internal error";
        sendJson(res, errorStatus(err), { error: message });
      });
  });
}
