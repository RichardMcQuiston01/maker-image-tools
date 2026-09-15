import Stripe from "stripe";

const STRIPE_API_VERSION: Stripe.LatestApiVersion = "2025-02-24.acacia";

/** Thrown when STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET is missing/blank — a deployment
 * misconfiguration, not a bad request. */
export class StripeConfigError extends Error {}

let cachedClient: Stripe | undefined;

/**
 * Lazily constructs the Stripe client from STRIPE_SECRET_KEY, matching
 * @maker/ai-inference's GEMINI_API_KEY handling: no silent fallback that
 * could be mistaken for a working configuration.
 */
export function getStripeClient(): Stripe {
  if (cachedClient) return cachedClient;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || key.trim().length === 0) {
    throw new StripeConfigError(
      "Missing STRIPE_SECRET_KEY environment variable. Set it to a Stripe secret key " +
        "(https://dashboard.stripe.com/apikeys, a test-mode key is free) to enable billing.",
    );
  }
  cachedClient = new Stripe(key, { apiVersion: STRIPE_API_VERSION });
  return cachedClient;
}

/** Test-only hook to force the next getStripeClient() call to reconstruct the client. */
export function resetStripeClientForTests(): void {
  cachedClient = undefined;
}

export function getWebhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || secret.trim().length === 0) {
    throw new StripeConfigError(
      "Missing STRIPE_WEBHOOK_SECRET environment variable. Set it to the signing secret for " +
        "this endpoint (https://dashboard.stripe.com/webhooks) to enable webhook handling.",
    );
  }
  return secret;
}
