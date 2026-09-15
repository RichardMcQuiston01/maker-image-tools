import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getStripeClient,
  getWebhookSecret,
  resetStripeClientForTests,
  StripeConfigError,
} from "../src/stripeClient.js";

describe("stripeClient", () => {
  const originalSecretKey = process.env.STRIPE_SECRET_KEY;
  const originalWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  beforeEach(() => {
    resetStripeClientForTests();
  });

  afterEach(() => {
    resetStripeClientForTests();
    if (originalSecretKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = originalSecretKey;
    if (originalWebhookSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = originalWebhookSecret;
  });

  it("throws StripeConfigError when STRIPE_SECRET_KEY is unset", () => {
    delete process.env.STRIPE_SECRET_KEY;
    expect(() => getStripeClient()).toThrow(StripeConfigError);
  });

  it("constructs a client once STRIPE_SECRET_KEY is set", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_fake";
    expect(() => getStripeClient()).not.toThrow();
  });

  it("throws StripeConfigError when STRIPE_WEBHOOK_SECRET is unset", () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    expect(() => getWebhookSecret()).toThrow(StripeConfigError);
  });

  it("returns the webhook secret once set", () => {
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_fake";
    expect(getWebhookSecret()).toBe("whsec_fake");
  });
});
