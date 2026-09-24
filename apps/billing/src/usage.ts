import type { Pool } from "pg";
import type Stripe from "stripe";
import { findStripeCustomerId } from "./customers.js";
import { NoStripeCustomerError } from "./subscriptions.js";

/** Thrown for a non-positive-integer usage quantity (a caller error, not a server error). */
export class InvalidUsageQuantityError extends Error {}

export async function recordUsage(
  pool: Pool,
  userId: string,
  metric: string,
  quantity = 1,
): Promise<void> {
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new InvalidUsageQuantityError(`"quantity" must be a positive integer, got ${quantity}`);
  }
  await pool.query("INSERT INTO usage_events (user_id, metric, quantity) VALUES ($1, $2, $3)", [
    userId,
    metric,
    quantity,
  ]);
}

/** UTC start of the current calendar month - the default usage-metering window. */
export function startOfCurrentMonth(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export async function getUsageTotal(
  pool: Pool,
  userId: string,
  metric: string,
  since: Date = startOfCurrentMonth(),
): Promise<number> {
  const { rows } = await pool.query<{ total: string | null }>(
    "SELECT SUM(quantity) AS total FROM usage_events WHERE user_id = $1 AND metric = $2 AND created_at >= $3",
    [userId, metric, since],
  );
  return Number(rows[0]?.total ?? 0);
}

interface UnreportedUsageEvent {
  id: string;
  metric: string;
  quantity: number;
}

async function findUnreportedUsageEvents(
  pool: Pool,
  userId: string,
): Promise<UnreportedUsageEvent[]> {
  const { rows } = await pool.query<{ id: string; metric: string; quantity: number }>(
    "SELECT id, metric, quantity FROM usage_events " +
      "WHERE user_id = $1 AND stripe_reported_at IS NULL ORDER BY id",
    [userId],
  );
  return rows;
}

export interface UsageReportResult {
  reported: number;
}

/**
 * Reports every not-yet-reported `usage_events` row for `userId` to Stripe as
 * a Billing Meter event (`stripe.billing.meterEvents.create`), one event per
 * row, using the row's `metric` as the meter's `event_name` - a Stripe Meter
 * configured with that same `event_name` (https://dashboard.stripe.com/meters)
 * is what actually turns these into metered invoice line items, same as a
 * Price ID being the dashboard-side counterpart to `priceIdForPlan` above.
 *
 * Each row's `stripe_reported_at` is set right after Stripe accepts it, so a
 * re-run of this function (e.g. a periodic job) never reports it twice; if
 * `meterEvents.create` throws partway through a batch, everything reported
 * so far stays marked and the rest is retried on the next run - Stripe's own
 * per-event `identifier` also de-dupes server-side as a second line of
 * defense, within a rolling ~24h window.
 *
 * `timestamp` is deliberately omitted from the Stripe call (Stripe defaults
 * it to "now"): meter events must be timestamped within the past 35 days,
 * and a reporting job that's fallen behind could otherwise try to report a
 * `usage_events` row older than that and fail outright.
 */
export async function reportUsageToStripe(
  pool: Pool,
  stripe: Stripe,
  userId: string,
): Promise<UsageReportResult> {
  const customerId = await findStripeCustomerId(pool, userId);
  if (!customerId) {
    throw new NoStripeCustomerError(`No Stripe customer on file for user "${userId}"`);
  }

  const unreported = await findUnreportedUsageEvents(pool, userId);
  for (const event of unreported) {
    await stripe.billing.meterEvents.create({
      event_name: event.metric,
      payload: { stripe_customer_id: customerId, value: String(event.quantity) },
      identifier: `usage_event_${event.id}`,
    });
    await pool.query("UPDATE usage_events SET stripe_reported_at = now() WHERE id = $1", [
      event.id,
    ]);
  }
  return { reported: unreported.length };
}
