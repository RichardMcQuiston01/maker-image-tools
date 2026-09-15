import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import {
  findOrCreateStripeCustomer,
  findStripeCustomerId,
  findUserIdByStripeCustomerId,
} from "../src/customers.js";
import { asStripe, createFakeStripe, type FakeStripe } from "./fakeStripe.js";
import { requireTestPool, resetTestDb, setupTestDb } from "./testDb.js";

// apps/accounts assigns real users a Postgres-generated UUID; `user_id` here
// is typed as UUID to match, so tests use UUID-shaped literals too.
const USER_1 = "11111111-1111-1111-1111-111111111111";
const NOBODY = "99999999-9999-9999-9999-999999999999";

describe("customers", () => {
  let pool: Pool;
  let fakeStripe: FakeStripe;

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
  });

  it("creates a Stripe customer and records it on first lookup", async () => {
    const customerId = await findOrCreateStripeCustomer(
      pool,
      asStripe(fakeStripe),
      USER_1,
      "ada@example.com",
    );

    expect(customerId).toMatch(/^cus_fake_/);
    expect(fakeStripe.customers.create).toHaveBeenCalledTimes(1);
    expect(await findStripeCustomerId(pool, USER_1)).toBe(customerId);
    expect(await findUserIdByStripeCustomerId(pool, customerId)).toBe(USER_1);
  });

  it("reuses an existing customer instead of creating a second one", async () => {
    const first = await findOrCreateStripeCustomer(
      pool,
      asStripe(fakeStripe),
      USER_1,
      "ada@example.com",
    );
    const second = await findOrCreateStripeCustomer(
      pool,
      asStripe(fakeStripe),
      USER_1,
      "ada@example.com",
    );

    expect(second).toBe(first);
    expect(fakeStripe.customers.create).toHaveBeenCalledTimes(1);
  });

  it("returns undefined for a user with no Stripe customer on file", async () => {
    expect(await findStripeCustomerId(pool, NOBODY)).toBeUndefined();
    expect(await findUserIdByStripeCustomerId(pool, "cus_nobody")).toBeUndefined();
  });
});
