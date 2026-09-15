import { StripeConfigError } from "./stripeClient.js";

/**
 * Paid plan tiers this service knows how to sell, mapped to the env var
 * holding that plan's Stripe Price ID. `free` isn't listed here - it's the
 * default `apps/accounts` already assigns and never needs a Stripe price.
 */
const PLAN_PRICE_ENV_VARS: Record<string, string> = {
  pro: "STRIPE_PRICE_PRO",
};

/** Thrown for a plan tier this service doesn't sell (a caller/config error, not a Stripe error). */
export class UnknownPlanTierError extends Error {}

export function priceIdForPlan(planTier: string): string {
  const envVar = PLAN_PRICE_ENV_VARS[planTier];
  if (!envVar) {
    throw new UnknownPlanTierError(
      `Unknown plan tier "${planTier}". Known tiers: ${Object.keys(PLAN_PRICE_ENV_VARS).join(", ")}`,
    );
  }
  const priceId = process.env[envVar];
  if (!priceId || priceId.trim().length === 0) {
    throw new StripeConfigError(
      `Missing ${envVar} environment variable. Set it to the Stripe Price ID for the "${planTier}" ` +
        "plan (https://dashboard.stripe.com/products) to enable checkout for it.",
    );
  }
  return priceId;
}

/** Reverse lookup used when a webhook event carries a Stripe price ID and needs a plan tier. */
export function planTierForPriceId(priceId: string): string | undefined {
  for (const [planTier, envVar] of Object.entries(PLAN_PRICE_ENV_VARS)) {
    if (process.env[envVar] === priceId) return planTier;
  }
  return undefined;
}
