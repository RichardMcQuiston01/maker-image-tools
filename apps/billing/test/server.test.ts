import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import type { Pool } from "pg";
import { createServer } from "../src/server.js";
import { asStripe, createFakeStripe, makeFakeSubscription, type FakeStripe } from "./fakeStripe.js";
import { requireTestPool, resetTestDb, setupTestDb } from "./testDb.js";

// apps/accounts assigns real users a Postgres-generated UUID; `user_id` here
// is typed as UUID to match, so tests use UUID-shaped literals too.
const USER_1 = "11111111-1111-1111-1111-111111111111";
const NOBODY = "99999999-9999-9999-9999-999999999999";

describe("billing server", () => {
  let pool: Pool;
  let fakeStripe: FakeStripe;
  let server: Server;
  let baseUrl: string;
  const originalPrice = process.env.STRIPE_PRICE_PRO;
  const originalWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  beforeAll(async () => {
    pool = requireTestPool();
    await setupTestDb(pool);
    process.env.STRIPE_PRICE_PRO = "price_pro_fake";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_fake";
    fakeStripe = createFakeStripe();
    server = createServer(pool, asStripe(fakeStripe));
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
    if (originalPrice === undefined) delete process.env.STRIPE_PRICE_PRO;
    else process.env.STRIPE_PRICE_PRO = originalPrice;
    if (originalWebhookSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = originalWebhookSecret;
  });

  beforeEach(async () => {
    await resetTestDb(pool);
    vi.clearAllMocks();
  });

  it("creates a Checkout Session for a known plan tier", async () => {
    const response = await fetch(`${baseUrl}/checkout-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: USER_1,
        email: "ada@example.com",
        planTier: "pro",
        successUrl: "https://app.example.com/success",
        cancelUrl: "https://app.example.com/cancel",
      }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect((await response.json()).url).toBe("https://checkout.stripe.com/pay/fake_session");
  });

  it("rejects a checkout session for an unknown plan tier with 400", async () => {
    const response = await fetch(`${baseUrl}/checkout-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: USER_1,
        email: "ada@example.com",
        planTier: "enterprise",
        successUrl: "https://app.example.com/success",
        cancelUrl: "https://app.example.com/cancel",
      }),
    });
    expect(response.status).toBe(400);
  });

  it("rejects a portal session for a user with no Stripe customer with 404", async () => {
    const response = await fetch(`${baseUrl}/portal-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: USER_1, returnUrl: "https://app.example.com/account" }),
    });
    expect(response.status).toBe(404);
  });

  it("returns a portal session URL for an existing customer", async () => {
    await fetch(`${baseUrl}/checkout-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: USER_1,
        email: "ada@example.com",
        planTier: "pro",
        successUrl: "https://app.example.com/success",
        cancelUrl: "https://app.example.com/cancel",
      }),
    });

    const response = await fetch(`${baseUrl}/portal-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: USER_1, returnUrl: "https://app.example.com/account" }),
    });
    expect(response.status).toBe(200);
    expect((await response.json()).url).toBe("https://billing.stripe.com/session/fake_portal");
  });

  it("defaults an unknown user's subscription status to the free tier", async () => {
    const response = await fetch(`${baseUrl}/subscription?userId=${NOBODY}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      planTier: "free",
      status: "none",
      currentPeriodEnd: null,
    });
  });

  it("requires a userId query parameter on /subscription", async () => {
    const response = await fetch(`${baseUrl}/subscription`);
    expect(response.status).toBe(400);
  });

  it("records and totals usage", async () => {
    const record = await fetch(`${baseUrl}/usage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: USER_1, metric: "ai-inference-calls", quantity: 3 }),
    });
    expect(record.status).toBe(204);

    const total = await fetch(`${baseUrl}/usage?userId=${USER_1}&metric=ai-inference-calls`);
    expect(total.status).toBe(200);
    expect(await total.json()).toEqual({ metric: "ai-inference-calls", total: 3 });
  });

  it("rejects a non-positive usage quantity with 400", async () => {
    const response = await fetch(`${baseUrl}/usage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: USER_1, metric: "exports", quantity: 0 }),
    });
    expect(response.status).toBe(400);
  });

  it("reports a user's usage to Stripe as Billing Meter events", async () => {
    await fetch(`${baseUrl}/checkout-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: USER_1,
        email: "ada@example.com",
        planTier: "pro",
        successUrl: "https://app.example.com/success",
        cancelUrl: "https://app.example.com/cancel",
      }),
    });
    await fetch(`${baseUrl}/usage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: USER_1, metric: "ai-inference-calls", quantity: 4 }),
    });

    const response = await fetch(`${baseUrl}/usage/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: USER_1 }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ reported: 1 });
    expect(fakeStripe.billing.meterEvents.create).toHaveBeenCalledWith(
      expect.objectContaining({ event_name: "ai-inference-calls" }),
    );
  });

  it("rejects reporting usage for a user with no Stripe customer with 404", async () => {
    const response = await fetch(`${baseUrl}/usage/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: NOBODY }),
    });
    expect(response.status).toBe(404);
  });

  it("rejects a webhook request missing the Stripe-Signature header", async () => {
    const response = await fetch(`${baseUrl}/webhook`, {
      method: "POST",
      body: JSON.stringify({ type: "invoice.paid", data: { object: {} } }),
    });
    expect(response.status).toBe(400);
  });

  it("applies a webhook event and updates the subscription status", async () => {
    const checkout = await fetch(`${baseUrl}/checkout-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: USER_1,
        email: "ada@example.com",
        planTier: "pro",
        successUrl: "https://app.example.com/success",
        cancelUrl: "https://app.example.com/cancel",
      }),
    });
    expect(checkout.status).toBe(200);
    const customerId = (await fakeStripe.customers.create.mock.results[0]!.value).id as string;
    fakeStripe.subscriptions.retrieve.mockResolvedValueOnce(
      makeFakeSubscription({ id: "sub_1", customer: customerId, status: "active" }),
    );

    const webhook = await fetch(`${baseUrl}/webhook`, {
      method: "POST",
      headers: { "Stripe-Signature": "t=1,v1=fake" },
      body: JSON.stringify({
        type: "checkout.session.completed",
        data: { object: { subscription: "sub_1" } },
      }),
    });
    expect(webhook.status).toBe(200);
    expect(await webhook.json()).toEqual({ received: true });

    const status = await fetch(`${baseUrl}/subscription?userId=${USER_1}`);
    const body = await status.json();
    expect(body.planTier).toBe("pro");
    expect(body.status).toBe("active");
  });

  it("answers CORS preflight requests", async () => {
    const response = await fetch(`${baseUrl}/checkout-session`, { method: "OPTIONS" });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-methods")).toContain("POST");
  });

  it("rejects a request body that isn't valid JSON with 400", async () => {
    const response = await fetch(`${baseUrl}/checkout-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    expect(response.status).toBe(400);
  });

  it("returns 404 for unknown routes", async () => {
    const response = await fetch(`${baseUrl}/nope`);
    expect(response.status).toBe(404);
  });
});
