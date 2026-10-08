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
  billing: { meterEvents: { create: ReturnType<typeof vi.fn> } };
  webhooks: { constructEventAsync: ReturnType<typeof vi.fn> };
}

export function createFakeStripe(): FakeStripe {
  let customerCounter = 0;
  let meterEventCounter = 0;
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
    billing: {
      meterEvents: {
        create: vi.fn(async (params: { event_name: string; payload: Record<string, string> }) => ({
          id: `mtr_evt_fake_${++meterEventCounter}`,
          object: "billing.meter_event",
          event_name: params.event_name,
          payload: params.payload,
          livemode: false,
        })),
      },
    },
    webhooks: {
      // Real signature verification is Stripe SDK code, already trusted; this
      // just parses the raw body so tests can exercise the route wiring.
      // Async to match the real SDK's constructEventAsync, which server.ts
      // uses because Bun's crypto provider can't run constructEvent's
      // synchronous path (see this service's README).
      constructEventAsync: vi.fn(async (rawBody: Buffer | string) =>
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

export function makeFakeInvoice(
  overrides: {
    id?: string;
    customer?: string;
    customerEmail?: string | null;
    attemptCount?: number;
    amountDue?: number;
    nextPaymentAttempt?: number | null;
    hostedInvoiceUrl?: string | null;
  } = {},
): Stripe.Invoice {
  const {
    id = "in_fake_1",
    customer = "cus_fake_1",
    customerEmail = "ada@example.com",
    attemptCount = 1,
    amountDue = 1000,
    nextPaymentAttempt = Math.floor(Date.now() / 1000) + 3 * 24 * 60 * 60,
    hostedInvoiceUrl = "https://invoice.stripe.com/i/fake",
  } = overrides;
  return {
    id,
    customer,
    customer_email: customerEmail,
    attempt_count: attemptCount,
    amount_due: amountDue,
    next_payment_attempt: nextPaymentAttempt,
    hosted_invoice_url: hostedInvoiceUrl,
  } as unknown as Stripe.Invoice;
}
