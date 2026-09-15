import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { Pool } from "pg";
import Stripe from "stripe";
import { createPool, DatabaseConfigError, runMigrations } from "./db.js";
import { UnknownPlanTierError } from "./plans.js";
import { getStripeClient, getWebhookSecret, StripeConfigError } from "./stripeClient.js";
import {
  applyStripeWebhookEvent,
  createCheckoutSession,
  createPortalSession,
  getSubscriptionStatus,
  NoStripeCustomerError,
} from "./subscriptions.js";
import { getUsageTotal, InvalidUsageQuantityError, recordUsage } from "./usage.js";

const MAX_BODY_BYTES = 1 * 1024 * 1024;

function setCorsHeaders(res: ServerResponse): void {
  // Wide open for local/dev use; a real deployment would restrict this to the app's own origin.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Stripe-Signature");
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

function requireQueryParam(url: URL, field: string): string {
  const value = url.searchParams.get(field);
  if (!value) {
    throw new Error(`"${field}" query parameter is required`);
  }
  return value;
}

function errorStatus(err: unknown): number {
  if (err instanceof DatabaseConfigError || err instanceof StripeConfigError) return 500;
  if (err instanceof UnknownPlanTierError || err instanceof InvalidUsageQuantityError) return 400;
  if (err instanceof NoStripeCustomerError) return 404;
  if (err instanceof Stripe.errors.StripeSignatureVerificationError) return 400;
  if (err instanceof Stripe.errors.StripeInvalidRequestError) return 400;
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

export function createServer(pool: Pool = createPool(), stripe: Stripe = getStripeClient()) {
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
        if (req.method === "POST" && pathname === "/checkout-session") {
          const body = await parseJsonBody(req);
          const url = await createCheckoutSession(pool, stripe, {
            userId: requireString(body, "userId"),
            email: requireString(body, "email"),
            planTier: requireString(body, "planTier"),
            successUrl: requireString(body, "successUrl"),
            cancelUrl: requireString(body, "cancelUrl"),
          });
          sendJson(res, 200, { url });
          return;
        }

        if (req.method === "POST" && pathname === "/portal-session") {
          const body = await parseJsonBody(req);
          const url = await createPortalSession(pool, stripe, {
            userId: requireString(body, "userId"),
            returnUrl: requireString(body, "returnUrl"),
          });
          sendJson(res, 200, { url });
          return;
        }

        if (req.method === "GET" && pathname === "/subscription") {
          const userId = requireQueryParam(url, "userId");
          const status = await getSubscriptionStatus(pool, userId);
          sendJson(res, 200, status);
          return;
        }

        if (req.method === "POST" && pathname === "/usage") {
          const body = await parseJsonBody(req);
          const userId = requireString(body, "userId");
          const metric = requireString(body, "metric");
          const quantity = body.quantity === undefined ? 1 : Number(body.quantity);
          await recordUsage(pool, userId, metric, quantity);
          res.writeHead(204);
          res.end();
          return;
        }

        if (req.method === "GET" && pathname === "/usage") {
          const userId = requireQueryParam(url, "userId");
          const metric = requireQueryParam(url, "metric");
          const since = url.searchParams.get("since");
          const total = await getUsageTotal(
            pool,
            userId,
            metric,
            since ? new Date(since) : undefined,
          );
          sendJson(res, 200, { metric, total });
          return;
        }

        if (req.method === "POST" && pathname === "/webhook") {
          const rawBody = await readBody(req);
          const signature = req.headers["stripe-signature"];
          if (typeof signature !== "string") {
            sendJson(res, 400, { error: "Missing Stripe-Signature header" });
            return;
          }
          const event = stripe.webhooks.constructEvent(rawBody, signature, getWebhookSecret());
          await applyStripeWebhookEvent(pool, stripe, event);
          sendJson(res, 200, { received: true });
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
