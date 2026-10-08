import type { Pool, PoolClient } from "pg";
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
  createdAt: Date;
}

async function findUnreportedUsageEvents(
  client: PoolClient,
  userId: string,
): Promise<UnreportedUsageEvent[]> {
  const { rows } = await client.query<{
    id: string;
    metric: string;
    quantity: number;
    created_at: Date;
  }>(
    "SELECT id, metric, quantity, created_at FROM usage_events " +
      "WHERE user_id = $1 AND stripe_reported_at IS NULL ORDER BY id",
    [userId],
  );
  return rows.map((row) => ({
    id: row.id,
    metric: row.metric,
    quantity: row.quantity,
    createdAt: row.created_at,
  }));
}

/** Stripe rejects a meter event timestamped further back than this. */
const METER_EVENT_MAX_AGE_MS = 34 * 24 * 60 * 60 * 1000;

/**
 * The Stripe timestamp to report a `usage_events` row's usage under - its own
 * `created_at`, so usage always lands in the billing period it actually
 * happened in, not the (possibly much later) period a delayed reporting run
 * happens to execute in. `undefined` (Stripe then defaults to "now") only
 * for a row too old for Stripe's 35-day window to accept as-is; that still
 * reports it - in the wrong period - rather than leaving it unreported
 * forever or blocking every newer row queued behind it.
 */
function meterEventTimestamp(createdAt: Date): number | undefined {
  if (Date.now() - createdAt.getTime() > METER_EVENT_MAX_AGE_MS) return undefined;
  return Math.floor(createdAt.getTime() / 1000);
}

export interface UsageReportResult {
  reported: number;
}

async function reportUnreportedUsage(
  client: PoolClient,
  stripe: Stripe,
  userId: string,
  customerId: string,
): Promise<UsageReportResult> {
  const unreported = await findUnreportedUsageEvents(client, userId);
  let reported = 0;
  for (const event of unreported) {
    try {
      const timestamp = meterEventTimestamp(event.createdAt);
      await stripe.billing.meterEvents.create({
        event_name: event.metric,
        payload: { stripe_customer_id: customerId, value: String(event.quantity) },
        identifier: `usage_event_${event.id}`,
        ...(timestamp !== undefined && { timestamp }),
      });
    } catch {
      // Leave this row unreported - it's retried on the next call - rather
      // than letting one bad row (e.g. a metric with no Stripe Meter
      // configured for it) permanently block every later row behind it,
      // which `ORDER BY id` would otherwise select first on every retry.
      continue;
    }
    await client.query("UPDATE usage_events SET stripe_reported_at = now() WHERE id = $1", [
      event.id,
    ]);
    reported++;
  }
  return { reported };
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
 * re-run of this function (e.g. a periodic job) never reports it twice;
 * Stripe's own per-event `identifier` also de-dupes server-side as a second
 * line of defense, within a rolling ~24h window (this doesn't cover a crash
 * between Stripe accepting an event and the following `UPDATE` committing -
 * see the PR discussion for why that residual gap is accepted rather than
 * built out further here).
 *
 * The whole call runs under a session-scoped Postgres advisory lock keyed on
 * `userId`, so two overlapping calls for the same user (e.g. a manual retry
 * racing a scheduled job) never select and report the same row twice; it's
 * released before returning, not tied to a transaction, so it doesn't hold a
 * DB transaction open across the Stripe network calls above.
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

  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext($1))", [userId]);
    try {
      return await reportUnreportedUsage(client, stripe, userId, customerId);
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext($1))", [userId]);
    }
  } finally {
    client.release();
  }
}

async function findUsersWithUnreportedUsage(pool: Pool): Promise<string[]> {
  const { rows } = await pool.query<{ user_id: string }>(
    "SELECT DISTINCT user_id FROM usage_events WHERE stripe_reported_at IS NULL",
  );
  return rows.map((row) => row.user_id);
}

export interface ScheduledUsageReportResult {
  usersReported: number;
  eventsReported: number;
  usersSkipped: number;
}

/**
 * Calls `reportUsageToStripe` for every user with at least one unreported
 * `usage_events` row - what `createServer`'s periodic scheduler (see
 * `server.ts`) runs on a timer, so `POST /usage/report`'s per-user reporting
 * actually happens without a caller remembering to trigger it.
 *
 * A user with unreported usage but no Stripe customer on file yet (e.g. they
 * used a metered feature before ever subscribing) is counted in
 * `usersSkipped`, not treated as a failure - there's nothing to report to
 * until they have a customer, and their events stay unreported for the next
 * run to pick up once they do. Any other per-user failure (e.g. a transient
 * Stripe/DB error) is logged and skipped too, so one user's failure can't
 * block reporting for the rest - the same isolation `reportUnreportedUsage`
 * already applies at the per-event level, one level up.
 */
export async function reportAllUnreportedUsage(
  pool: Pool,
  stripe: Stripe,
): Promise<ScheduledUsageReportResult> {
  const userIds = await findUsersWithUnreportedUsage(pool);
  let usersReported = 0;
  let eventsReported = 0;
  let usersSkipped = 0;
  for (const userId of userIds) {
    try {
      const { reported } = await reportUsageToStripe(pool, stripe, userId);
      eventsReported += reported;
      if (reported > 0) usersReported++;
    } catch (err) {
      if (err instanceof NoStripeCustomerError) {
        usersSkipped++;
        continue;
      }
      console.error(`Failed to report usage for user "${userId}":`, err);
    }
  }
  return { usersReported, eventsReported, usersSkipped };
}
