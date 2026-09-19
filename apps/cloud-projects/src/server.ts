import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { Pool } from "pg";
import { AccountsConfigError, SessionVerificationError, verifySession } from "./accountsAuth.js";
import { createPool, DatabaseConfigError, runMigrations } from "./db.js";
import { getObjectStore, ObjectStorageConfigError, type ObjectStore } from "./objectStorage.js";
import {
  createProject,
  createShareLink,
  deleteProject,
  getProject,
  getSharedProject,
  InvalidProjectInputError,
  listProjects,
  ProjectNotFoundError,
  revokeShareLink,
  updateProject,
} from "./projects.js";

const MAX_BODY_BYTES = 8 * 1024 * 1024;

function setCorsHeaders(res: ServerResponse): void {
  // Wide open for local/dev use; a real deployment would restrict this to the app's own origin.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) {
      throw new Error("Request body too large");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function parseJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const body = await readBody(req);
  if (body.length === 0) {
    throw new Error("Request body is empty");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString("utf-8"));
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

function optionalString(body: Record<string, unknown>, field: string): string | undefined {
  const value = body[field];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`"${field}" must be a non-empty string`);
  }
  return value;
}

function bearerToken(req: IncomingMessage): string | undefined {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return undefined;
  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : undefined;
}

/**
 * Resolves the authenticated caller's user id via @maker/accounts, or
 * writes the appropriate 401 response and returns `undefined` - this is
 * what replaced trusting a client-supplied `userId` body/query param
 * everywhere below (see README's former "Access control" gap).
 */
async function requireAuthenticatedUserId(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<string | undefined> {
  const token = bearerToken(req);
  if (!token) {
    sendJson(res, 401, { error: "Missing bearer token" });
    return undefined;
  }
  const userId = await verifySession(token);
  if (!userId) {
    sendJson(res, 401, { error: "Invalid or expired session" });
    return undefined;
  }
  return userId;
}

function errorStatus(err: unknown): number {
  if (
    err instanceof DatabaseConfigError ||
    err instanceof ObjectStorageConfigError ||
    err instanceof AccountsConfigError ||
    err instanceof SessionVerificationError
  )
    return 500;
  if (err instanceof InvalidProjectInputError) return 400;
  if (err instanceof ProjectNotFoundError) return 404;
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

const PROJECT_ID_RE = /^\/projects\/([^/]+)$/;
const SHARE_RE = /^\/projects\/([^/]+)\/share$/;
const SHARED_RE = /^\/shared\/([^/]+)$/;

export function createServer(pool: Pool = createPool(), store: ObjectStore = getObjectStore()) {
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
        if (req.method === "POST" && pathname === "/projects") {
          const userId = await requireAuthenticatedUserId(req, res);
          if (!userId) return;
          const body = await parseJsonBody(req);
          const project = await createProject(
            pool,
            store,
            userId,
            requireString(body, "name"),
            body.data,
          );
          sendJson(res, 201, { project });
          return;
        }

        if (req.method === "GET" && pathname === "/projects") {
          const userId = await requireAuthenticatedUserId(req, res);
          if (!userId) return;
          const projects = await listProjects(pool, userId);
          sendJson(res, 200, { projects });
          return;
        }

        const shareMatch = pathname.match(SHARE_RE);
        if (shareMatch && (req.method === "POST" || req.method === "DELETE")) {
          const projectId = shareMatch[1]!;
          const userId = await requireAuthenticatedUserId(req, res);
          if (!userId) return;
          if (req.method === "POST") {
            const token = await createShareLink(pool, userId, projectId);
            sendJson(res, 200, { token });
            return;
          }
          await revokeShareLink(pool, userId, projectId);
          res.writeHead(204);
          res.end();
          return;
        }

        const sharedMatch = pathname.match(SHARED_RE);
        if (sharedMatch && req.method === "GET") {
          const project = await getSharedProject(pool, store, sharedMatch[1]!);
          sendJson(res, 200, { project });
          return;
        }

        const projectMatch = pathname.match(PROJECT_ID_RE);
        if (projectMatch) {
          const projectId = projectMatch[1]!;

          if (req.method === "GET") {
            const userId = await requireAuthenticatedUserId(req, res);
            if (!userId) return;
            const project = await getProject(pool, store, userId, projectId);
            sendJson(res, 200, { project });
            return;
          }

          if (req.method === "PUT") {
            const userId = await requireAuthenticatedUserId(req, res);
            if (!userId) return;
            const body = await parseJsonBody(req);
            const project = await updateProject(pool, store, userId, projectId, {
              name: optionalString(body, "name"),
              data: body.data,
            });
            sendJson(res, 200, { project });
            return;
          }

          if (req.method === "DELETE") {
            const userId = await requireAuthenticatedUserId(req, res);
            if (!userId) return;
            await deleteProject(pool, store, userId, projectId);
            res.writeHead(204);
            res.end();
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
