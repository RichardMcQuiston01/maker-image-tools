import { vi } from "vitest";
import type Stripe from "stripe";

/**
 * `subscriptions.create`/`checkout.sessions.create`/etc. call the real Stripe
 * API, which needs a paid-account API key this sandbox doesn't have. Real
 * end-to-end verification requires setting STRIPE_SECRET_KEY/
 * STRIPE_WEBHOOK_SECRET and hitting Stripe's test mode by hand; these tests
 * instead fake the Stripe SDK client to verify this service's own logic
 * (customer/subscription bookkeeping, route wiring, webhook handling)
 * without a live credential - the same approach apps/ai-inference takes for
 * the paid Gemini API.
 */
export interface FakeStripe {
  customers: { create: ReturnType<typeof vi.fn> };
  checkout: { sessions: { create: ReturnType<typeof vi.fn> } };
  billingPortal: { sessions: { create: ReturnType<typeof vi.fn> } };
  subscriptions: { retrieve: ReturnType<typeof vi.fn> };
  webhooks: { constructEvent: ReturnType<typeof vi.fn> };
}

export function createFakeStripe(): FakeStripe {
  let customerCounter = 0;
  return {
    customers: {
      create: vi.fn(async ({ email }: { email: string }) => ({
        id: `cus_fake_${++customerCounter}`,
        email,
      })),
    },
    checkout: {
      sessions: {
        create: vi.fn(async () => ({ url: "https://checkout.stripe.com/pay/fake_session" })),
      },
    },
    billingPortal: {
      sessions: {
        create: vi.fn(async () => ({ url: "https://billing.stripe.com/session/fake_portal" })),
      },
    },
    subscriptions: {
      retrieve: vi.fn(async (id: string) => makeFakeSubscription({ id })),
    },
    webhooks: {
      // Real signature verification is Stripe SDK code, already trusted; this
      // just parses the raw body so tests can exercise the route wiring.
      constructEvent: vi.fn((rawBody: Buffer | string) =>
        JSON.parse(typeof rawBody === "string" ? rawBody : rawBody.toString("utf-8")),
      ),
    },
  };
}

export function asStripe(fake: FakeStripe): Stripe {
  return fake as unknown as Stripe;
}

export function makeFakeSubscription(
  overrides: {
    id?: string;
    customer?: string;
    status?: string;
    priceId?: string;
    currentPeriodEnd?: number;
  } = {},
): Stripe.Subscription {
  const {
    id = "sub_fake_1",
    customer = "cus_fake_1",
    status = "active",
    priceId = "price_pro_fake",
    currentPeriodEnd = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
  } = overrides;
  return {
    id,
    customer,
    status,
    current_period_end: currentPeriodEnd,
    items: { data: [{ price: { id: priceId } }] },
  } as unknown as Stripe.Subscription;
}
