import { createServer, type Server } from "node:http";

/**
 * A tiny local HTTP server standing in for @maker/billing's `GET
 * /subscription?userId=` - mirrors `fakeAccounts.ts`'s reasoning for why
 * this is faked at the HTTP boundary instead of booting a real billing
 * service (with its own Postgres/Stripe wiring) inside this service's test
 * suite.
 */
export interface FakeBilling {
  baseUrl: string;
  close(): Promise<void>;
}

/** `planTiers` maps a user id to the plan tier `GET /subscription` should report for them; an unlisted user id reports "free". */
export async function startFakeBilling(planTiers: Record<string, string>): Promise<FakeBilling> {
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
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
