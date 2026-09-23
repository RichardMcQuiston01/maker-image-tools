import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { Pool } from "pg";
import { createPool, DatabaseConfigError, runMigrations } from "./db.js";
import { AccountsConfigError, isModerator, ModeratorVerificationError } from "./moderatorAuth.js";
import {
  approvePreset,
  findSimilarApprovedPreset,
  getPresetById,
  getPresetHistory,
  InvalidPresetInputError,
  listPendingPresets,
  PresetNotFoundError,
  PresetNotPendingError,
  rejectPreset,
  searchPresets,
  submitPreset,
} from "./presets.js";
import {
  InvalidVoteValueError,
  PresetNotApprovedError,
  removeVote,
  SelfVoteNotAllowedError,
  voteOnPreset,
} from "./votes.js";

/** Thrown when a caller-supplied reviewerId doesn't belong to a moderator. */
export class NotAModeratorError extends Error {}

const MAX_BODY_BYTES = 1 * 1024 * 1024;

function setCorsHeaders(res: ServerResponse): void {
  // Wide open for local/dev use; a real deployment would restrict this to the app's own origin.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
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

function requireNumber(body: Record<string, unknown>, field: string): number {
  const value = body[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`"${field}" must be a number`);
  }
  return value;
}

function optionalInteger(body: Record<string, unknown>, field: string): number | undefined {
  const value = body[field];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`"${field}" must be an integer`);
  }
  return value;
}

function requireQueryParam(url: URL, field: string): string {
  const value = url.searchParams.get(field);
  if (!value) {
    throw new Error(`"${field}" query parameter is required`);
  }
  return value;
}

function errorStatus(err: unknown): number {
  if (
    err instanceof DatabaseConfigError ||
    err instanceof AccountsConfigError ||
    err instanceof ModeratorVerificationError
  )
    return 500;
  if (err instanceof InvalidPresetInputError || err instanceof InvalidVoteValueError) return 400;
  if (err instanceof NotAModeratorError || err instanceof SelfVoteNotAllowedError) return 403;
  if (err instanceof PresetNotFoundError) return 404;
  if (err instanceof PresetNotPendingError || err instanceof PresetNotApprovedError) return 409;
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

const PRESET_ID_RE = /^\/presets\/([^/]+)$/;
const APPROVE_RE = /^\/presets\/([^/]+)\/approve$/;
const REJECT_RE = /^\/presets\/([^/]+)\/reject$/;
const VOTE_RE = /^\/presets\/([^/]+)\/vote$/;

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
        if (req.method === "POST" && pathname === "/presets") {
          const body = await parseJsonBody(req);
          const material = requireString(body, "material");
          const machineType = requireString(body, "machineType");
          const operation = requireString(body, "operation");
          const speed = requireNumber(body, "speed");
          const power = requireNumber(body, "power");
          const passes = optionalInteger(body, "passes");
          const preset = await submitPreset(pool, {
            userId: requireString(body, "userId"),
            material,
            machineType,
            operation,
            speed,
            power,
            passes,
            notes: optionalString(body, "notes"),
          });
          // Informational only - a close match never blocks the submission, just nudges the
          // caller that they might want to vote for the existing one instead. See
          // findSimilarApprovedPreset's docs for the tolerance this uses.
          const similarPreset = await findSimilarApprovedPreset(
            pool,
            material,
            machineType,
            operation,
            speed,
            power,
            passes ?? 1,
          );
          sendJson(res, 201, { preset, similarPreset });
          return;
        }

        if (req.method === "GET" && pathname === "/presets") {
          const presets = await searchPresets(pool, {
            material: url.searchParams.get("material") ?? undefined,
            machineType: url.searchParams.get("machineType") ?? undefined,
            operation: url.searchParams.get("operation") ?? undefined,
          });
          sendJson(res, 200, { presets });
          return;
        }

        if (req.method === "GET" && pathname === "/presets/pending") {
          const presets = await listPendingPresets(pool);
          sendJson(res, 200, { presets });
          return;
        }

        if (req.method === "GET" && pathname === "/presets/history") {
          const presets = await getPresetHistory(
            pool,
            requireQueryParam(url, "material"),
            requireQueryParam(url, "machineType"),
            requireQueryParam(url, "operation"),
          );
          sendJson(res, 200, { presets });
          return;
        }

        const approveMatch = pathname.match(APPROVE_RE);
        if (approveMatch && req.method === "POST") {
          const body = await parseJsonBody(req);
          const reviewerId = requireString(body, "reviewerId");
          if (!(await isModerator(reviewerId))) {
            throw new NotAModeratorError(`"reviewerId" (${reviewerId}) is not a moderator`);
          }
          const preset = await approvePreset(
            pool,
            approveMatch[1]!,
            reviewerId,
            optionalString(body, "notes"),
          );
          sendJson(res, 200, { preset });
          return;
        }

        const rejectMatch = pathname.match(REJECT_RE);
        if (rejectMatch && req.method === "POST") {
          const body = await parseJsonBody(req);
          const reviewerId = requireString(body, "reviewerId");
          if (!(await isModerator(reviewerId))) {
            throw new NotAModeratorError(`"reviewerId" (${reviewerId}) is not a moderator`);
          }
          const preset = await rejectPreset(
            pool,
            rejectMatch[1]!,
            reviewerId,
            optionalString(body, "notes"),
          );
          sendJson(res, 200, { preset });
          return;
        }

        const voteMatch = pathname.match(VOTE_RE);
        if (voteMatch) {
          const presetId = voteMatch[1]!;
          if (req.method === "POST") {
            const body = await parseJsonBody(req);
            const preset = await voteOnPreset(
              pool,
              presetId,
              requireString(body, "userId"),
              requireNumber(body, "value"),
            );
            sendJson(res, 200, { preset });
            return;
          }
          if (req.method === "DELETE") {
            const preset = await removeVote(pool, presetId, requireQueryParam(url, "userId"));
            sendJson(res, 200, { preset });
            return;
          }
        }

        const idMatch = pathname.match(PRESET_ID_RE);
        if (idMatch && req.method === "GET") {
          const preset = await getPresetById(pool, idMatch[1]!);
          sendJson(res, 200, { preset });
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
