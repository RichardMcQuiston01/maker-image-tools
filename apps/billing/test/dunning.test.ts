import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { findOrCreateStripeCustomer } from "../src/customers.js";
import { handleInvoicePaymentFailed } from "../src/dunning.js";
import { asStripe, createFakeStripe, makeFakeInvoice, type FakeStripe } from "./fakeStripe.js";
import { startFakeMailProvider, type FakeMailProvider } from "./fakeMailProvider.js";
import { requireTestPool, resetTestDb, setupTestDb } from "./testDb.js";

const USER_1 = "11111111-1111-1111-1111-111111111111";

const ENV_KEYS = ["MAIL_API_KEY", "MAIL_FROM_ADDRESS", "MAIL_API_URL"] as const;

describe("handleInvoicePaymentFailed", () => {
  let pool: Pool;
  let fakeStripe: FakeStripe;
  let provider: FakeMailProvider;
  const originalEnv: Record<string, string | undefined> = {};

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
    for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
    provider = await startFakeMailProvider();
    process.env.MAIL_API_KEY = "fake-mail-api-key";
    process.env.MAIL_FROM_ADDRESS = "billing@example.com";
    process.env.MAIL_API_URL = provider.baseUrl;
  });

  afterEach(async () => {
    await provider.close();
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  });

  it("sends a dunning email for a tracked customer's failed invoice", async () => {
    const customerId = await findOrCreateStripeCustomer(
      pool,
      asStripe(fakeStripe),
      USER_1,
      "ada@example.com",
    );

    await handleInvoicePaymentFailed(
      pool,
      makeFakeInvoice({
        customer: customerId,
        customerEmail: "ada@example.com",
        attemptCount: 1,
        amountDue: 2500,
      }),
    );

    expect(provider.sent).toHaveLength(1);
    expect(provider.sent[0]).toMatchObject({
      to: "ada@example.com",
      subject: "Your maker-image-tools payment didn't go through",
    });
    expect(provider.sent[0]!.text).toContain("$25.00");
    expect(provider.sent[0]!.text).toContain("attempt 1");
  });

  it("does nothing for a Stripe customer this service doesn't track", async () => {
    await handleInvoicePaymentFailed(
      pool,
      makeFakeInvoice({ customer: "cus_unknown", customerEmail: "ghost@example.com" }),
    );
    expect(provider.sent).toHaveLength(0);
  });

  it("does nothing when the invoice has no customer_email", async () => {
    const customerId = await findOrCreateStripeCustomer(
      pool,
      asStripe(fakeStripe),
      USER_1,
      "ada@example.com",
    );
    await handleInvoicePaymentFailed(
      pool,
      makeFakeInvoice({ customer: customerId, customerEmail: null }),
    );
    expect(provider.sent).toHaveLength(0);
  });

  it("doesn't send a duplicate email for the same invoice and attempt on a repeated webhook delivery", async () => {
    const customerId = await findOrCreateStripeCustomer(
      pool,
      asStripe(fakeStripe),
      USER_1,
      "ada@example.com",
    );
    const invoice = makeFakeInvoice({ id: "in_1", customer: customerId, attemptCount: 1 });

    await handleInvoicePaymentFailed(pool, invoice);
    await handleInvoicePaymentFailed(pool, invoice);

    expect(provider.sent).toHaveLength(1);
  });

  it("sends a new email for a later attempt on the same invoice", async () => {
    const customerId = await findOrCreateStripeCustomer(
      pool,
      asStripe(fakeStripe),
      USER_1,
      "ada@example.com",
    );

    await handleInvoicePaymentFailed(
      pool,
      makeFakeInvoice({ id: "in_1", customer: customerId, attemptCount: 1 }),
    );
    await handleInvoicePaymentFailed(
      pool,
      makeFakeInvoice({ id: "in_1", customer: customerId, attemptCount: 2 }),
    );

    expect(provider.sent).toHaveLength(2);
  });

  it("leaves the attempt eligible for retry if the mail send fails", async () => {
    const customerId = await findOrCreateStripeCustomer(
      pool,
      asStripe(fakeStripe),
      USER_1,
      "ada@example.com",
    );
    const invoice = makeFakeInvoice({ id: "in_1", customer: customerId, attemptCount: 1 });

    provider.failWithStatus = 500;
    await expect(handleInvoicePaymentFailed(pool, invoice)).rejects.toThrow("responded with 500");
    expect(provider.sent).toHaveLength(0);

    provider.failWithStatus = undefined;
    await handleInvoicePaymentFailed(pool, invoice);
    expect(provider.sent).toHaveLength(1);
  });

  it("mentions when Stripe won't retry automatically", async () => {
    const customerId = await findOrCreateStripeCustomer(
      pool,
      asStripe(fakeStripe),
      USER_1,
      "ada@example.com",
    );
    await handleInvoicePaymentFailed(
      pool,
      makeFakeInvoice({ customer: customerId, nextPaymentAttempt: null }),
    );
    expect(provider.sent[0]!.text).toContain("won't automatically retry");
  });
});
