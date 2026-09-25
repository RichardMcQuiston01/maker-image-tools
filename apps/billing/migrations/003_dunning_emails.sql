-- Guards dunning.ts's handleInvoicePaymentFailed against Stripe's
-- at-least-once webhook delivery: without this, a redelivered
-- invoice.payment_failed event for an attempt already emailed would just
-- email the customer again. Keyed on (invoice, attempt) rather than just the
-- invoice, since Stripe fires this event once per retry attempt on the same
-- invoice and each attempt is worth its own notice.
CREATE TABLE dunning_emails (
  invoice_id TEXT NOT NULL,
  attempt_count INTEGER NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (invoice_id, attempt_count)
);
