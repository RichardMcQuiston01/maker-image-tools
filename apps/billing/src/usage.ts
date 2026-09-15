import type { Pool } from "pg";

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
