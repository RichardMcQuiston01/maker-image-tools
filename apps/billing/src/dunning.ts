import type { Pool } from "pg";
import type Stripe from "stripe";
import { findUserIdByStripeCustomerId } from "./customers.js";
import { sendMail } from "./mailer.js";

function formatCents(amountCents: number): string {
  return `$${(amountCents / 100).toFixed(2)}`;
}

function dunningEmailBody(invoice: Stripe.Invoice): string {
  const lines = [
    `We tried to charge ${formatCents(invoice.amount_due)} for your maker-image-tools ` +
      `subscription, but the payment didn't go through (attempt ${invoice.attempt_count}).`,
  ];
  lines.push(
    invoice.next_payment_attempt
      ? "We'll automatically try again on " +
          `${new Date(invoice.next_payment_attempt * 1000).toDateString()}.`
      : "We won't automatically retry this charge again - your subscription may be canceled if " +
          "this isn't resolved.",
  );
  if (invoice.hosted_invoice_url) {
    lines.push(`Update your payment method or pay now: ${invoice.hosted_invoice_url}`);
  }
  return lines.join("\n\n");
}

/**
 * Sends a dunning ("your payment failed") email in response to Stripe's
 * `invoice.payment_failed` webhook event. The recipient comes from the
 * invoice's own `customer_email` - this service has nowhere else to look,
 * since `customers.ts` never stores an email address locally (see this
 * service's README's second paragraph).
 *
 * No-ops (doesn't throw, doesn't send) for a Stripe customer this service
 * doesn't track locally, matching `subscriptions.ts`'s
 * `upsertSubscriptionFromStripe` - e.g. test-mode noise from an unrelated
 * Stripe account posting to the same webhook endpoint. Also no-ops if the
 * invoice has no `customer_email` at all, since there's nothing to send to.
 *
 * Guarded by the `dunning_emails` table (migration 003) so a webhook
 * redelivery of the exact same failed attempt (Stripe's webhooks are
 * at-least-once) never sends the same email twice: the `(invoice id, attempt
 * count)` pair is inserted *before* sending and only kept if the send
 * actually succeeds (the whole thing runs in one transaction, rolled back on
 * a send failure), so a failed send leaves the attempt eligible for a real
 * retry instead of silently losing the notification.
 */
export async function handleInvoicePaymentFailed(
  pool: Pool,
  invoice: Stripe.Invoice,
): Promise<void> {
  const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
  if (!customerId) return;
  const userId = await findUserIdByStripeCustomerId(pool, customerId);
  if (!userId) return;

  const to = invoice.customer_email;
  if (!to) return;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      "INSERT INTO dunning_emails (invoice_id, attempt_count) VALUES ($1, $2) " +
        "ON CONFLICT (invoice_id, attempt_count) DO NOTHING RETURNING invoice_id",
      [invoice.id, invoice.attempt_count],
    );
    if (rows.length === 0) {
      // Already sent a dunning email for this exact attempt.
      await client.query("COMMIT");
      return;
    }
    try {
      await sendMail({
        to,
        subject: "Your maker-image-tools payment didn't go through",
        text: dunningEmailBody(invoice),
      });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
    await client.query("COMMIT");
  } finally {
    client.release();
  }
}
