import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { findOrCreateStripeCustomer } from "../src/customers.js";
import {
  applyStripeWebhookEvent,
  createCheckoutSession,
  createPortalSession,
  getSubscriptionStatus,
  NoStripeCustomerError,
} from "../src/subscriptions.js";
import { UnknownPlanTierError } from "../src/plans.js";
import {
  asStripe,
  createFakeStripe,
  makeFakeInvoice,
  makeFakeSubscription,
  type FakeStripe,
} from "./fakeStripe.js";
import { startFakeMailProvider, type FakeMailProvider } from "./fakeMailProvider.js";
import { requireTestPool, resetTestDb, setupTestDb } from "./testDb.js";

// apps/accounts assigns real users a Postgres-generated UUID; `user_id` here
// is typed as UUID to match, so tests use a UUID-shaped literal too.
const USER_1 = "11111111-1111-1111-1111-111111111111";

describe("subscriptions", () => {
  let pool: Pool;
  let fakeStripe: FakeStripe;
  const originalPrice = process.env.STRIPE_PRICE_PRO;

  beforeAll(async () => {
    pool = requireTestPool();
    await setupTestDb(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await resetTestDb(pool);
    fakeStripe = createFakeStripe();
    process.env.STRIPE_PRICE_PRO = "price_pro_fake";
  });

  afterEach(() => {
    if (originalPrice === undefined) delete process.env.STRIPE_PRICE_PRO;
    else process.env.STRIPE_PRICE_PRO = originalPrice;
  });

  describe("getSubscriptionStatus", () => {
    it("defaults to the free tier for a user with no subscription row", async () => {
      expect(await getSubscriptionStatus(pool, USER_1)).toEqual({
        planTier: "free",
        status: "none",
        currentPeriodEnd: null,
      });
    });
  });

  describe("createCheckoutSession", () => {
    it("creates/reuses a Stripe customer and returns the Checkout Session URL", async () => {
      const url = await createCheckoutSession(pool, asStripe(fakeStripe), {
        userId: USER_1,
        email: "ada@example.com",
        planTier: "pro",
        successUrl: "https://app.example.com/success",
        cancelUrl: "https://app.example.com/cancel",
      });

      expect(url).toBe("https://checkout.stripe.com/pay/fake_session");
      expect(fakeStripe.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: "subscription",
          client_reference_id: USER_1,
          line_items: [{ price: "price_pro_fake", quantity: 1 }],
        }),
      );
    });

    it("throws UnknownPlanTierError for a plan tier this service doesn't sell", async () => {
      await expect(
        createCheckoutSession(pool, asStripe(fakeStripe), {
          userId: USER_1,
          email: "ada@example.com",
          planTier: "enterprise",
          successUrl: "https://app.example.com/success",
          cancelUrl: "https://app.example.com/cancel",
        }),
      ).rejects.toThrow(UnknownPlanTierError);
    });
  });

  describe("createPortalSession", () => {
    it("throws NoStripeCustomerError for a user with no Stripe customer on file", async () => {
      await expect(
        createPortalSession(pool, asStripe(fakeStripe), {
          userId: USER_1,
          returnUrl: "https://app.example.com/account",
        }),
      ).rejects.toThrow(NoStripeCustomerError);
    });

    it("returns the Billing Portal session URL for an existing customer", async () => {
      await findOrCreateStripeCustomer(pool, asStripe(fakeStripe), USER_1, "ada@example.com");

      const url = await createPortalSession(pool, asStripe(fakeStripe), {
        userId: USER_1,
        returnUrl: "https://app.example.com/account",
      });

      expect(url).toBe("https://billing.stripe.com/session/fake_portal");
    });
  });

  describe("applyStripeWebhookEvent", () => {
    it("records a subscription after checkout.session.completed", async () => {
      const customerId = await findOrCreateStripeCustomer(
        pool,
        asStripe(fakeStripe),
        USER_1,
        "ada@example.com",
      );
      fakeStripe.subscriptions.retrieve.mockResolvedValueOnce(
        makeFakeSubscription({ id: "sub_1", customer: customerId, status: "active" }),
      );

      await applyStripeWebhookEvent(pool, asStripe(fakeStripe), {
        type: "checkout.session.completed",
        data: { object: { subscription: "sub_1" } },
      } as never);

      const status = await getSubscriptionStatus(pool, USER_1);
      expect(status.planTier).toBe("pro");
      expect(status.status).toBe("active");
      expect(status.currentPeriodEnd).not.toBeNull();
    });

    it("updates the local subscription on customer.subscription.updated", async () => {
      const customerId = await findOrCreateStripeCustomer(
        pool,
        asStripe(fakeStripe),
        USER_1,
        "ada@example.com",
      );

      await applyStripeWebhookEvent(pool, asStripe(fakeStripe), {
        type: "customer.subscription.updated",
        data: {
          object: makeFakeSubscription({ id: "sub_1", customer: customerId, status: "past_due" }),
        },
      } as never);

      expect((await getSubscriptionStatus(pool, USER_1)).status).toBe("past_due");
    });

    it("marks the subscription canceled on customer.subscription.deleted", async () => {
      const customerId = await findOrCreateStripeCustomer(
        pool,
        asStripe(fakeStripe),
        USER_1,
        "ada@example.com",
      );

      await applyStripeWebhookEvent(pool, asStripe(fakeStripe), {
        type: "customer.subscription.deleted",
        data: {
          object: makeFakeSubscription({ id: "sub_1", customer: customerId, status: "canceled" }),
        },
      } as never);

      expect((await getSubscriptionStatus(pool, USER_1)).status).toBe("canceled");
    });

    it("ignores webhook events for a Stripe customer this service doesn't track", async () => {
      await applyStripeWebhookEvent(pool, asStripe(fakeStripe), {
        type: "customer.subscription.updated",
        data: {
          object: makeFakeSubscription({ id: "sub_1", customer: "cus_unknown", status: "active" }),
        },
      } as never);
      // No throw, and no row created for anyone - nothing to assert on except it didn't blow up.
    });

    it("ignores event types it doesn't act on", async () => {
      await expect(
        applyStripeWebhookEvent(pool, asStripe(fakeStripe), {
          type: "invoice.paid",
          data: { object: {} },
        } as never),
      ).resolves.toBeUndefined();
    });

    describe("invoice.payment_failed", () => {
      const ENV_KEYS = ["MAIL_API_KEY", "MAIL_FROM_ADDRESS", "MAIL_API_URL"] as const;
      let provider: FakeMailProvider;
      const originalMailEnv: Record<string, string | undefined> = {};

      beforeEach(async () => {
        for (const key of ENV_KEYS) originalMailEnv[key] = process.env[key];
        provider = await startFakeMailProvider();
        process.env.MAIL_API_KEY = "fake-mail-api-key";
        process.env.MAIL_FROM_ADDRESS = "billing@example.com";
        process.env.MAIL_API_URL = provider.baseUrl;
      });

      afterEach(async () => {
        await provider.close();
        for (const key of ENV_KEYS) {
          if (originalMailEnv[key] === undefined) delete process.env[key];
          else process.env[key] = originalMailEnv[key];
        }
      });

      it("sends a dunning email via the webhook route's dispatch", async () => {
        const customerId = await findOrCreateStripeCustomer(
          pool,
          asStripe(fakeStripe),
          USER_1,
          "ada@example.com",
        );

        await applyStripeWebhookEvent(pool, asStripe(fakeStripe), {
          type: "invoice.payment_failed",
          data: { object: makeFakeInvoice({ customer: customerId }) },
        } as never);

        expect(provider.sent).toHaveLength(1);
        expect(provider.sent[0]!.to).toBe("ada@example.com");
      });
    });
  });
});
