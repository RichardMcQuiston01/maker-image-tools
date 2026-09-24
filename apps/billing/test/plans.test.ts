import { afterEach, describe, expect, it } from "vitest";
import { StripeConfigError } from "../src/stripeClient.js";
import { planTierForPriceId, priceIdForPlan, UnknownPlanTierError } from "../src/plans.js";

describe("plans", () => {
  const originalPro = process.env.STRIPE_PRICE_PRO;
  const originalStudio = process.env.STRIPE_PRICE_STUDIO;

  afterEach(() => {
    if (originalPro === undefined) delete process.env.STRIPE_PRICE_PRO;
    else process.env.STRIPE_PRICE_PRO = originalPro;
    if (originalStudio === undefined) delete process.env.STRIPE_PRICE_STUDIO;
    else process.env.STRIPE_PRICE_STUDIO = originalStudio;
  });

  it("resolves a known plan tier's Stripe Price ID from its env var", () => {
    process.env.STRIPE_PRICE_PRO = "price_123";
    expect(priceIdForPlan("pro")).toBe("price_123");
  });

  it("throws UnknownPlanTierError for a plan tier this service doesn't sell", () => {
    expect(() => priceIdForPlan("enterprise")).toThrow(UnknownPlanTierError);
  });

  it("throws StripeConfigError when a known plan tier's price env var is unset", () => {
    delete process.env.STRIPE_PRICE_PRO;
    expect(() => priceIdForPlan("pro")).toThrow(StripeConfigError);
  });

  it("reverse-maps a Stripe Price ID back to its plan tier", () => {
    process.env.STRIPE_PRICE_PRO = "price_123";
    expect(planTierForPriceId("price_123")).toBe("pro");
  });

  it("returns undefined for a Price ID that doesn't match any known plan", () => {
    process.env.STRIPE_PRICE_PRO = "price_123";
    expect(planTierForPriceId("price_unknown")).toBeUndefined();
  });

  it("resolves the studio tier's Stripe Price ID from its own env var, independent of pro's", () => {
    process.env.STRIPE_PRICE_PRO = "price_pro";
    process.env.STRIPE_PRICE_STUDIO = "price_studio";
    expect(priceIdForPlan("studio")).toBe("price_studio");
    expect(planTierForPriceId("price_studio")).toBe("studio");
  });

  it("throws StripeConfigError when studio's price env var is unset", () => {
    delete process.env.STRIPE_PRICE_STUDIO;
    expect(() => priceIdForPlan("studio")).toThrow(StripeConfigError);
  });
});
