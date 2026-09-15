import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { Pool } from "pg";
import { createPool, DatabaseConfigError, runMigrations } from "./db.js";
import {
  approveListing,
  deleteListing,
  getListing,
  InvalidListingInputError,
  listListings,
  ListingNotFoundError,
  ListingNotPendingError,
  listPendingListings,
  publishListing,
  rejectListing,
} from "./listings.js";
import { getObjectStore, ObjectStorageConfigError, type ObjectStore } from "./objectStorage.js";
import { InvalidRatingInputError, listRatings, rateListing } from "./ratings.js";

const MAX_BODY_BYTES = 8 * 1024 * 1024;

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

function optionalStringArray(body: Record<string, unknown>, field: string): string[] | undefined {
  const value = body[field];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`"${field}" must be an array of strings`);
  }
  return value as string[];
}

function requireNumber(body: Record<string, unknown>, field: string): number {
  const value = body[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`"${field}" must be a number`);
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
  if (err instanceof DatabaseConfigError || err instanceof ObjectStorageConfigError) return 500;
  if (err instanceof InvalidListingInputError || err instanceof InvalidRatingInputError) return 400;
  if (err instanceof ListingNotFoundError) return 404;
  if (err instanceof ListingNotPendingError) return 409;
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

const LISTING_ID_RE = /^\/listings\/([^/]+)$/;
const APPROVE_RE = /^\/listings\/([^/]+)\/approve$/;
const REJECT_RE = /^\/listings\/([^/]+)\/reject$/;
const RATINGS_RE = /^\/listings\/([^/]+)\/ratings$/;

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
        if (req.method === "POST" && pathname === "/listings") {
          const body = await parseJsonBody(req);
          const listing = await publishListing(pool, store, {
            userId: requireString(body, "userId"),
            title: requireString(body, "title"),
            description: optionalString(body, "description"),
            tags: optionalStringArray(body, "tags"),
            data: body.data,
          });
          sendJson(res, 201, { listing });
          return;
        }

        if (req.method === "GET" && pathname === "/listings") {
          const sortParam = url.searchParams.get("sort");
          if (sortParam !== null && sortParam !== "newest" && sortParam !== "rating") {
            throw new Error('"sort" must be "newest" or "rating"');
          }
          const listings = await listListings(pool, {
            q: url.searchParams.get("q") ?? undefined,
            tag: url.searchParams.get("tag") ?? undefined,
            sort: sortParam ?? undefined,
          });
          sendJson(res, 200, { listings });
          return;
        }

        if (req.method === "GET" && pathname === "/listings/pending") {
          const listings = await listPendingListings(pool);
          sendJson(res, 200, { listings });
          return;
        }

        const approveMatch = pathname.match(APPROVE_RE);
        if (approveMatch && req.method === "POST") {
          const body = await parseJsonBody(req);
          const listing = await approveListing(
            pool,
            approveMatch[1]!,
            requireString(body, "reviewerId"),
            optionalString(body, "notes"),
          );
          sendJson(res, 200, { listing });
          return;
        }

        const rejectMatch = pathname.match(REJECT_RE);
        if (rejectMatch && req.method === "POST") {
          const body = await parseJsonBody(req);
          const listing = await rejectListing(
            pool,
            rejectMatch[1]!,
            requireString(body, "reviewerId"),
            optionalString(body, "notes"),
          );
          sendJson(res, 200, { listing });
          return;
        }

        const ratingsMatch = pathname.match(RATINGS_RE);
        if (ratingsMatch) {
          const listingId = ratingsMatch[1]!;
          if (req.method === "POST") {
            const body = await parseJsonBody(req);
            const result = await rateListing(
              pool,
              listingId,
              requireString(body, "userId"),
              requireNumber(body, "stars"),
              optionalString(body, "comment"),
            );
            sendJson(res, 200, result);
            return;
          }
          if (req.method === "GET") {
            const ratings = await listRatings(pool, listingId);
            sendJson(res, 200, { ratings });
            return;
          }
        }

        const idMatch = pathname.match(LISTING_ID_RE);
        if (idMatch) {
          const id = idMatch[1]!;

          if (req.method === "GET") {
            const listing = await getListing(pool, store, id);
            sendJson(res, 200, { listing });
            return;
          }

          if (req.method === "DELETE") {
            const userId = requireQueryParam(url, "userId");
            await deleteListing(pool, store, userId, id);
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
