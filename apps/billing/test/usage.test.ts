import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { findOrCreateStripeCustomer } from "../src/customers.js";
import { NoStripeCustomerError } from "../src/subscriptions.js";
import {
  getUsageTotal,
  InvalidUsageQuantityError,
  recordUsage,
  reportUsageToStripe,
} from "../src/usage.js";
import { asStripe, createFakeStripe, type FakeStripe } from "./fakeStripe.js";
import { requireTestPool, resetTestDb, setupTestDb } from "./testDb.js";

// apps/accounts assigns real users a Postgres-generated UUID; `user_id` here
// is typed as UUID to match, so tests use UUID-shaped literals too.
const USER_1 = "11111111-1111-1111-1111-111111111111";
const USER_2 = "22222222-2222-2222-2222-222222222222";

describe("usage", () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = requireTestPool();
    await setupTestDb(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await resetTestDb(pool);
  });

  it("sums recorded usage for a user/metric pair", async () => {
    await recordUsage(pool, USER_1, "ai-inference-calls", 3);
    await recordUsage(pool, USER_1, "ai-inference-calls", 2);
    await recordUsage(pool, USER_1, "exports", 1);

    expect(await getUsageTotal(pool, USER_1, "ai-inference-calls")).toBe(5);
    expect(await getUsageTotal(pool, USER_1, "exports")).toBe(1);
  });

  it("defaults quantity to 1", async () => {
    await recordUsage(pool, USER_1, "exports");
    expect(await getUsageTotal(pool, USER_1, "exports")).toBe(1);
  });

  it("returns 0 for a metric with no recorded usage", async () => {
    expect(await getUsageTotal(pool, USER_1, "exports")).toBe(0);
  });

  it("excludes usage before the given `since` cutoff", async () => {
    await recordUsage(pool, USER_1, "exports", 1);
    const future = new Date(Date.now() + 60_000);
    expect(await getUsageTotal(pool, USER_1, "exports", future)).toBe(0);
  });

  it("keeps usage separate per user", async () => {
    await recordUsage(pool, USER_1, "exports", 4);
    await recordUsage(pool, USER_2, "exports", 9);
    expect(await getUsageTotal(pool, USER_1, "exports")).toBe(4);
    expect(await getUsageTotal(pool, USER_2, "exports")).toBe(9);
  });

  it("rejects a non-positive quantity", async () => {
    await expect(recordUsage(pool, USER_1, "exports", 0)).rejects.toThrow(
      InvalidUsageQuantityError,
    );
    await expect(recordUsage(pool, USER_1, "exports", -1)).rejects.toThrow(
      InvalidUsageQuantityError,
    );
  });

  it("rejects a non-integer quantity", async () => {
    await expect(recordUsage(pool, USER_1, "exports", 1.5)).rejects.toThrow(
      InvalidUsageQuantityError,
    );
  });

  describe("reportUsageToStripe", () => {
    let fakeStripe: FakeStripe;

    beforeEach(() => {
      fakeStripe = createFakeStripe();
    });

    it("rejects reporting for a user with no Stripe customer on file", async () => {
      await recordUsage(pool, USER_1, "ai-inference-calls", 3);
      await expect(reportUsageToStripe(pool, asStripe(fakeStripe), USER_1)).rejects.toThrow(
        NoStripeCustomerError,
      );
    });

    it("reports every unreported event as a Stripe Billing Meter event", async () => {
      const customerId = await findOrCreateStripeCustomer(
        pool,
        asStripe(fakeStripe),
        USER_1,
        "ada@example.com",
      );
      await recordUsage(pool, USER_1, "ai-inference-calls", 3);
      await recordUsage(pool, USER_1, "exports", 1);

      const result = await reportUsageToStripe(pool, asStripe(fakeStripe), USER_1);

      expect(result).toEqual({ reported: 2 });
      expect(fakeStripe.billing.meterEvents.create).toHaveBeenCalledTimes(2);
      expect(fakeStripe.billing.meterEvents.create).toHaveBeenCalledWith(
        expect.objectContaining({
          event_name: "ai-inference-calls",
          payload: { stripe_customer_id: customerId, value: "3" },
        }),
      );
      expect(fakeStripe.billing.meterEvents.create).toHaveBeenCalledWith(
        expect.objectContaining({
          event_name: "exports",
          payload: { stripe_customer_id: customerId, value: "1" },
        }),
      );
    });

    it("never reports the same event twice", async () => {
      await findOrCreateStripeCustomer(pool, asStripe(fakeStripe), USER_1, "ada@example.com");
      await recordUsage(pool, USER_1, "exports", 1);

      expect(await reportUsageToStripe(pool, asStripe(fakeStripe), USER_1)).toEqual({
        reported: 1,
      });
      expect(await reportUsageToStripe(pool, asStripe(fakeStripe), USER_1)).toEqual({
        reported: 0,
      });
      expect(fakeStripe.billing.meterEvents.create).toHaveBeenCalledTimes(1);
    });

    it("reports newly recorded usage after an earlier report already ran", async () => {
      await findOrCreateStripeCustomer(pool, asStripe(fakeStripe), USER_1, "ada@example.com");
      await recordUsage(pool, USER_1, "exports", 1);
      await reportUsageToStripe(pool, asStripe(fakeStripe), USER_1);

      await recordUsage(pool, USER_1, "exports", 2);
      expect(await reportUsageToStripe(pool, asStripe(fakeStripe), USER_1)).toEqual({
        reported: 1,
      });
    });

    it("keeps reporting separate per user", async () => {
      const customer1 = await findOrCreateStripeCustomer(
        pool,
        asStripe(fakeStripe),
        USER_1,
        "ada@example.com",
      );
      await findOrCreateStripeCustomer(pool, asStripe(fakeStripe), USER_2, "grace@example.com");
      await recordUsage(pool, USER_1, "exports", 1);
      await recordUsage(pool, USER_2, "exports", 5);

      expect(await reportUsageToStripe(pool, asStripe(fakeStripe), USER_1)).toEqual({
        reported: 1,
      });
      expect(fakeStripe.billing.meterEvents.create).toHaveBeenCalledWith(
        expect.objectContaining({ payload: { stripe_customer_id: customer1, value: "1" } }),
      );
    });

    it("gives each reported event a unique, stable identifier", async () => {
      await findOrCreateStripeCustomer(pool, asStripe(fakeStripe), USER_1, "ada@example.com");
      await recordUsage(pool, USER_1, "exports", 1);
      await recordUsage(pool, USER_1, "exports", 1);

      await reportUsageToStripe(pool, asStripe(fakeStripe), USER_1);

      const identifiers = fakeStripe.billing.meterEvents.create.mock.calls.map(
        (call: [{ identifier: string }]) => call[0].identifier,
      );
      expect(new Set(identifiers).size).toBe(2);
    });
  });
});
