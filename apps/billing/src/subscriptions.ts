import type { Pool } from "pg";
import type Stripe from "stripe";
import {
  findOrCreateStripeCustomer,
  findStripeCustomerId,
  findUserIdByStripeCustomerId,
} from "./customers.js";
import { handleInvoicePaymentFailed } from "./dunning.js";
import { planTierForPriceId, priceIdForPlan } from "./plans.js";

export interface SubscriptionStatus {
  planTier: string;
  status: string;
  currentPeriodEnd: string | null;
}

/** The most recent subscription record for a user, or the implicit free tier if they have none. */
export async function getSubscriptionStatus(
  pool: Pool,
  userId: string,
): Promise<SubscriptionStatus> {
  const { rows } = await pool.query<{
    plan_tier: string;
    status: string;
    current_period_end: Date | null;
  }>(
    "SELECT plan_tier, status, current_period_end FROM subscriptions WHERE user_id = $1 " +
      "ORDER BY updated_at DESC LIMIT 1",
    [userId],
  );
  const row = rows[0];
  if (!row) {
    return { planTier: "free", status: "none", currentPeriodEnd: null };
  }
  return {
    planTier: row.plan_tier,
    status: row.status,
    currentPeriodEnd: row.current_period_end ? row.current_period_end.toISOString() : null,
  };
}

export interface CreateCheckoutSessionParams {
  userId: string;
  email: string;
  planTier: string;
  successUrl: string;
  cancelUrl: string;
}

/** Creates a Stripe-hosted Checkout session for `userId` to subscribe to `planTier`; returns its URL. */
export async function createCheckoutSession(
  pool: Pool,
  stripe: Stripe,
  params: CreateCheckoutSessionParams,
): Promise<string> {
  const priceId = priceIdForPlan(params.planTier);
  const customerId = await findOrCreateStripeCustomer(pool, stripe, params.userId, params.email);
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    client_reference_id: params.userId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
  });
  if (!session.url) {
    throw new Error("Stripe did not return a checkout session URL");
  }
  return session.url;
}

/** Thrown when a portal session is requested for a user with no Stripe customer on file yet. */
export class NoStripeCustomerError extends Error {}

export interface CreatePortalSessionParams {
  userId: string;
  returnUrl: string;
}

/** Creates a Stripe-hosted Billing Portal session so a user can manage/cancel their subscription. */
export async function createPortalSession(
  pool: Pool,
  stripe: Stripe,
  params: CreatePortalSessionParams,
): Promise<string> {
  const customerId = await findStripeCustomerId(pool, params.userId);
  if (!customerId) {
    throw new NoStripeCustomerError(`No Stripe customer on file for user "${params.userId}"`);
  }
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: params.returnUrl,
  });
  return session.url;
}

async function upsertSubscriptionFromStripe(
  pool: Pool,
  subscription: Stripe.Subscription,
): Promise<void> {
  const customerId =
    typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
  const userId = await findUserIdByStripeCustomerId(pool, customerId);
  if (!userId) return; // Stripe customer not tracked locally (e.g. test-mode noise) - nothing to reconcile.

  const priceId = subscription.items.data[0]?.price.id;
  const planTier = (priceId && planTierForPriceId(priceId)) ?? "unknown";
  const currentPeriodEnd = new Date(subscription.current_period_end * 1000);

  await pool.query(
    "INSERT INTO subscriptions (user_id, stripe_subscription_id, plan_tier, status, current_period_end) " +
      "VALUES ($1, $2, $3, $4, $5) " +
      "ON CONFLICT (stripe_subscription_id) DO UPDATE SET " +
      "plan_tier = EXCLUDED.plan_tier, status = EXCLUDED.status, " +
      "current_period_end = EXCLUDED.current_period_end, updated_at = now()",
    [userId, subscription.id, planTier, subscription.status, currentPeriodEnd],
  );
}

/**
 * Applies a verified Stripe webhook event to the local `subscriptions` table.
 * Only the event types this service acts on are handled; everything else is
 * a silent no-op (Stripe fans out many event types this service doesn't need).
 */
export async function applyStripeWebhookEvent(
  pool: Pool,
  stripe: Stripe,
  event: Stripe.Event,
): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      if (typeof session.subscription !== "string") return;
      const subscription = await stripe.subscriptions.retrieve(session.subscription);
      await upsertSubscriptionFromStripe(pool, subscription);
      return;
    }
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      await upsertSubscriptionFromStripe(pool, event.data.object);
      return;
    }
    case "invoice.payment_failed": {
      await handleInvoicePaymentFailed(pool, event.data.object);
      return;
    }
    default:
      return;
  }
}
