import type { Pool } from "pg";
import type Stripe from "stripe";

export async function findStripeCustomerId(
  pool: Pool,
  userId: string,
): Promise<string | undefined> {
  const { rows } = await pool.query<{ stripe_customer_id: string }>(
    "SELECT stripe_customer_id FROM customers WHERE user_id = $1",
    [userId],
  );
  return rows[0]?.stripe_customer_id;
}

export async function findUserIdByStripeCustomerId(
  pool: Pool,
  stripeCustomerId: string,
): Promise<string | undefined> {
  const { rows } = await pool.query<{ user_id: string }>(
    "SELECT user_id FROM customers WHERE stripe_customer_id = $1",
    [stripeCustomerId],
  );
  return rows[0]?.user_id;
}

/** Returns the existing Stripe customer for `userId`, creating one on Stripe (and recording it) if needed. */
export async function findOrCreateStripeCustomer(
  pool: Pool,
  stripe: Stripe,
  userId: string,
  email: string,
): Promise<string> {
  const existing = await findStripeCustomerId(pool, userId);
  if (existing) return existing;

  const customer = await stripe.customers.create({ email, metadata: { userId } });
  await pool.query(
    "INSERT INTO customers (user_id, stripe_customer_id) VALUES ($1, $2) " +
      "ON CONFLICT (user_id) DO UPDATE SET stripe_customer_id = EXCLUDED.stripe_customer_id",
    [userId, customer.id],
  );
  return customer.id;
}
