import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createPool, DatabaseConfigError, runMigrations } from "./db.js";
import { createSession, deleteSession, validateSession } from "./sessions.js";
import {
  authenticate,
  createUser,
  EmailAlreadyRegisteredError,
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

function userJson(user: User) {
  return {
    id: user.id,
    email: user.email,
    planTier: user.planTier,
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

function errorStatus(err: unknown): number {
  if (err instanceof DatabaseConfigError) return 500;
  if (err instanceof InvalidCredentialsFormatError) return 400;
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

    const pathname = (req.url ?? "").split("?", 1)[0];

    migrationsReady
      .then(async () => {
        if (req.method === "POST" && pathname === "/signup") {
          const body = await parseJsonBody(req);
          const email = requireString(body, "email");
          const password = requireString(body, "password");
          const user = await createUser(pool, email, password);
          const session = await createSession(pool, user.id);
          sendJson(res, 201, { user: userJson(user), token: session.token });
          return;
        }

        if (req.method === "POST" && pathname === "/login") {
          const body = await parseJsonBody(req);
          const email = requireString(body, "email");
          const password = requireString(body, "password");
          const user = await authenticate(pool, email, password);
          if (!user) {
            sendJson(res, 401, { error: "Invalid email or password" });
            return;
          }
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
          const user = await validateSession(pool, token);
          if (!user) {
            sendJson(res, 401, { error: "Invalid or expired session" });
            return;
          }
          sendJson(res, 200, { user: userJson(user) });
          return;
        }

        sendJson(res, 404, { error: "Not found" });
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : "Internal error";
        sendJson(res, errorStatus(err), { error: message });
      });
  });
}
