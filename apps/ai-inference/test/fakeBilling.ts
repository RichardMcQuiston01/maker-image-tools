import { createServer, type Server } from "node:http";

/**
 * A tiny local HTTP server standing in for @maker/billing's
 * `GET /subscription`, `GET /usage`, and `POST /usage` - mirrors
 * `fakeAccounts.ts`'s reasoning for why this is faked at the HTTP boundary
 * instead of booting a real billing service (with its own Postgres/Stripe
 * wiring) inside this service's test suite. Usage is tracked in-memory per
 * `(userId, metric)` pair, matching `@maker/billing`'s real
 * `GET /usage`/`POST /usage` semantics closely enough to exercise
 * `billingClient.ts`'s quota check end to end.
 */
export interface FakeBilling {
  baseUrl: string;
  /** Every `POST /usage` body received, in call order - lets a test assert usage was (or wasn't) recorded. */
  usageRecords: Array<{ userId: string; metric: string }>;
  close(): Promise<void>;
}

/**
 * `planTiers` maps a user id to the plan tier `GET /subscription` should
 * report for them (an unlisted user id reports "free"). `initialUsage`
 * seeds a starting count for a `(userId, metric)` pair, so a test can start
 * a user already at or near a quota without making that many real calls
 * first.
 */
export async function startFakeBilling(
  planTiers: Record<string, string>,
  initialUsage: Record<string, number> = {},
): Promise<FakeBilling> {
  const usage = new Map<string, number>(Object.entries(initialUsage));
  const usageRecords: Array<{ userId: string; metric: string }> = [];

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (req.method === "GET" && url.pathname === "/subscription") {
      const userId = url.searchParams.get("userId");
      const planTier = (userId && planTiers[userId]) || "free";
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          planTier,
          status: planTier === "free" ? "none" : "active",
          currentPeriodEnd: null,
        }),
      );
      return;
    }

    if (req.method === "GET" && url.pathname === "/usage") {
      const userId = url.searchParams.get("userId") ?? "";
      const metric = url.searchParams.get("metric") ?? "";
      const total = usage.get(`${userId}:${metric}`) ?? 0;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ metric, total }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/usage") {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf-8")) as {
          userId: string;
          metric: string;
          quantity?: number;
        };
        usageRecords.push({ userId: body.userId, metric: body.metric });
        const key = `${body.userId}:${body.metric}`;
        usage.set(key, (usage.get(key) ?? 0) + (body.quantity ?? 1));
        res.writeHead(204);
        res.end();
      });
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected fake billing server to bind to a numeric port");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    usageRecords,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
