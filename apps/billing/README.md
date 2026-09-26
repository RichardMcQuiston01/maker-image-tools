# @maker/billing

Subscriptions and payments for the platform-growth services introduced in `ROADMAP.md` Stage 6:
Stripe-hosted checkout and billing-portal sessions, a local record of each user's subscription
status, and minimal usage metering. Lives in this monorepo as its own workspace app rather than a
separate repo — see `ROADMAP.md` §8 for why.

This service doesn't write to `@maker/accounts`'s `users.plan_tier` column directly — it's a
separate service with its own database, so it can't (no cross-service foreign keys, no shared
schema). It's the source of truth for subscription status; a caller (`apps/web`, or
`@maker/accounts` itself) asks `GET /subscription` to find out what plan a user is actually on.

## Running

```sh
bun run --cwd apps/billing dev
```

Listens on `PORT` (default `8789`). Applies any pending `migrations/*.sql` files automatically on
first request (tracked in a `_migrations` table), so there's no separate migrate step to remember.

## Environment variables

| Variable                | Required                                         | Default | Used by                                                                                  |
| ----------------------- | ------------------------------------------------ | ------- | ---------------------------------------------------------------------------------------- |
| `PORT`                  | no                                               | `8789`  | server listen port                                                                       |
| `DATABASE_URL`          | yes                                              | —       | Postgres connection string, e.g. `postgres://user:password@localhost:5432/maker_billing` |
| `STRIPE_SECRET_KEY`     | yes, for checkout/portal/webhook/usage reporting | —       | Stripe API calls (a free test-mode key works: https://dashboard.stripe.com/apikeys)      |
| `STRIPE_WEBHOOK_SECRET` | yes, for `/webhook`                              | —       | verifies incoming webhook signatures (https://dashboard.stripe.com/webhooks)             |
| `STRIPE_PRICE_PRO`      | yes, to sell the `pro` plan                      | —       | Stripe Price ID for the `pro` plan (https://dashboard.stripe.com/products)               |
| `STRIPE_PRICE_STUDIO`   | yes, to sell the `studio` plan                   | —       | Stripe Price ID for the `studio` plan (https://dashboard.stripe.com/products)            |
| `MAIL_API_KEY`          | yes, for dunning emails                          | —       | API key for the email provider (see "Failed-payment / dunning emails" below)             |
| `MAIL_FROM_ADDRESS`     | yes, for dunning emails                          | —       | the `From` address on dunning emails this service sends                                  |

Without `DATABASE_URL` set, every request responds `500` with a message explaining the variable is
missing — matching `@maker/ai-inference`'s `GEMINI_API_KEY` handling: no silent fallback that could
be mistaken for a working configuration. The Stripe-backed routes fail the same way if
`STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`/`STRIPE_PRICE_PRO`/`STRIPE_PRICE_STUDIO` are missing
(only the plan tier actually being checked out needs its own price env var set - `STRIPE_PRICE_PRO`
missing doesn't block selling `studio`, and vice versa); `GET /subscription` and
`POST`/`GET /usage` don't touch Stripe at all and work without any Stripe env vars, but
`POST /usage/report` does (it calls Stripe directly) and needs `STRIPE_SECRET_KEY` like the other
Stripe-backed routes. `POST /webhook` needs `MAIL_API_KEY`/`MAIL_FROM_ADDRESS` too, but only when the
event it's processing is an `invoice.payment_failed` that actually has a recipient to email —
`checkout.session.completed`/`customer.subscription.updated`/`customer.subscription.deleted` never
touch the mailer at all.

## Local Postgres

```sh
sudo -u postgres createuser -P maker   # password: maker
sudo -u postgres createdb -O maker maker_billing
export DATABASE_URL=postgres://maker:maker@localhost:5432/maker_billing
```

(or `docker run --rm -p 5432:5432 -e POSTGRES_USER=maker -e POSTGRES_PASSWORD=maker -e POSTGRES_DB=maker_billing postgres:16`.)

A Stripe test-mode secret key is free — create one at https://dashboard.stripe.com/test/apikeys,
then a test Product/Price for the `pro` plan and a webhook endpoint (the Stripe CLI's
`stripe listen --forward-to localhost:8789/webhook` is the easiest way to get a
`STRIPE_WEBHOOK_SECRET` for local dev).

## API

| Route                    | Body / Query                                                                       | Response                                                                                                                                      |
| ------------------------ | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /checkout-session` | `{ userId, email, planTier, successUrl, cancelUrl }`                               | `200 { url }` — a Stripe-hosted Checkout Session / `400` for an unknown `planTier`                                                            |
| `POST /portal-session`   | `{ userId, returnUrl }`                                                            | `200 { url }` — a Stripe-hosted Billing Portal session / `404` if the user has no Stripe customer yet                                         |
| `GET /subscription`      | `?userId=`                                                                         | `200 { planTier, status, currentPeriodEnd }` — `{ planTier: "free", status: "none", currentPeriodEnd: null }` if the user has no subscription |
| `POST /usage`            | `{ userId, metric, quantity? }` (`quantity` defaults to `1`)                       | `204`                                                                                                                                         |
| `GET /usage`             | `?userId=&metric=&since=` (`since` defaults to the start of the current UTC month) | `200 { metric, total }`                                                                                                                       |
| `POST /usage/report`     | `{ userId }`                                                                       | `200 { reported }` — reports the user's unreported usage to Stripe / `404` if they have no Stripe customer yet                                |
| `POST /webhook`          | raw Stripe event body, `Stripe-Signature` header                                   | `200 { received: true }` / `400` on a bad/missing signature                                                                                   |

`/webhook` verifies the signature with the Stripe SDK's `constructEventAsync` rather than
`constructEvent` — the synchronous form's crypto provider doesn't work under Bun (it throws
`SubtleCryptoProvider cannot be used in a synchronous context`), a gap none of the existing tests
caught since they fake the whole Stripe client and never exercise real signature verification.

`/webhook` handles `checkout.session.completed`, `customer.subscription.updated`,
`customer.subscription.deleted` (keeping the local `subscriptions` table in sync with Stripe), and
`invoice.payment_failed` (sending a dunning email — see "Failed-payment / dunning emails" below).
Every other event type is a no-op (Stripe sends many event types this service doesn't need).

## Usage-based billing

`POST /usage/report`'s `usage.ts`:`reportUsageToStripe` reports a user's not-yet-reported
`usage_events` rows to Stripe as [Billing Meter events](https://docs.stripe.com/billing/subscriptions/usage-based/recording-usage)
(`stripe.billing.meterEvents.create`), one event per row, using the row's `metric` as the meter's
`event_name` — a [Stripe Meter](https://dashboard.stripe.com/meters) configured with that same
`event_name` and attached to a metered Price is what actually turns these into metered invoice
line items; that meter/price setup happens on the Stripe dashboard, the same way `STRIPE_PRICE_PRO`
is a dashboard-created Price ID this service just references. Each reported row's
`stripe_reported_at` column is set right away, so calling `/usage/report` again only reports usage
recorded since the last call — nothing is ever double-reported (Stripe's own per-event `identifier`
also de-dupes server-side within a rolling ~24h window, as a second line of defense). Each call
holds a Postgres advisory lock for `userId` for its duration, so two overlapping calls for the same
user never report the same row twice.

`createServer` also runs this automatically: `usage.ts`'s `reportAllUnreportedUsage` finds every
user with at least one unreported `usage_events` row and calls `reportUsageToStripe` for each,
skipping (not failing) a user who has unreported usage but no Stripe customer on file yet — nothing
to report to until they have one, so their events just wait for a later run. One user's failure
(Stripe/DB error) is logged and doesn't block reporting for the rest, the same isolation
`reportUnreportedUsage` already applies per-event, one level up. `createServer` runs this on an
hourly `setInterval` (`USAGE_REPORT_INTERVAL_MS` in `server.ts`, matching `@maker/accounts`'s
session-cleanup cadence), `.unref()`'d so it never keeps the process (or a test's event loop) alive,
and cleared on `server.close()`. There's no separate scheduler process or cron/queue infrastructure
involved — this mirrors `@maker/accounts`'s expired-session cleanup, an in-process timer set up once
in `createServer`.

Rolling this out onto a deployment that already has `usage_events` history matters: migration
`002_stripe_usage_reporting.sql` leaves every existing row unreported, so the first `/usage/report`
call after it lands reports a user's _entire_ history at once, not just new usage — see that
migration's own comment for the tradeoff and what to do differently for a real rollout.

## Plans

Two paid tiers are wired up, `pro` and `studio` (`src/plans.ts`'s `PLAN_PRICE_ENV_VARS`), each with
its own Stripe Price ID env var (`STRIPE_PRICE_PRO`/`STRIPE_PRICE_STUDIO`) — plus the implicit
`free` tier every new `@maker/accounts` user starts on, which never needs a Stripe price. Every
plan-tier-aware route (`POST /checkout-session`, the webhook handlers, `GET /subscription`) is
already generic over the tier name, so `studio` didn't need any code beyond that one new map entry;
`apps/cloud-projects`'s `quotas.ts` maps each tier to its own storage limits (see that service's
README) and `apps/web`'s `BillingPanel` lists a checkout button per paid tier. Adding a further tier
is the same one-line change to `PLAN_PRICE_ENV_VARS` plus its own env var - the storage-quota and UI
sides are the only other places a plan tier name currently gets hand-kept in sync (there's no
shared-schema way to enforce that across services; see the top of this README for why).

## Failed-payment / dunning emails

`dunning.ts`'s `handleInvoicePaymentFailed` runs on `/webhook`'s `invoice.payment_failed` event and
emails the customer that a payment didn't go through, using `mailer.ts`'s `sendMail` — a plain
`fetch` POST to Resend's REST API (`MAIL_API_URL`, defaulting to `https://api.resend.com/emails`),
copied from `@maker/accounts`'s mailer of the same name rather than shared (there's no shared
package in this monorepo — see the top of this README for why cross-service code isn't shared that
way). It fails fast (`MailerConfigError`) if `MAIL_API_KEY`/`MAIL_FROM_ADDRESS` aren't set, matching
every other external-service client in this repo.

The recipient comes from the invoice's own `customer_email` field — this service has nowhere else
to look, since `customers.ts` never stores an email address locally (see the top of this README).
A Stripe customer this service doesn't track locally (e.g. test-mode noise from an unrelated Stripe
account posting to the same webhook endpoint), or an invoice with no `customer_email` at all, is
silently skipped rather than treated as an error.

Stripe fires `invoice.payment_failed` once per retry attempt on the same invoice (not just once per
invoice), so each attempt gets its own email — but Stripe's webhooks are also at-least-once, so a
redelivery of the exact same attempt must not send a duplicate. Migration `003_dunning_emails.sql`'s
`dunning_emails` table guards this: the `(invoice id, attempt count)` pair is inserted inside the
same transaction as the send and only kept if the send actually succeeds (rolled back on a send
failure), so a failed send leaves that attempt eligible for a real retry instead of silently losing
the notification, while a successful send is never repeated.

## What's not here yet

- **`apps/web` calling `POST /usage`** — usage is now reported to Stripe automatically once
  recorded (see "Usage-based billing" above), but nothing in `apps/web` calls `POST /usage` itself
  yet either — that's a follow-up once a feature actually needs a usage cap.

## Testing note

Like `@maker/accounts`, these tests run against a real local Postgres database (free and
reproducible, so there's no reason to mock it). Unlike Postgres, the Stripe API is a paid,
external, account-gated service this sandbox doesn't have credentials for, so the Stripe SDK
client itself is faked in tests (`test/fakeStripe.ts`) — the same approach
`@maker/ai-inference` takes for the paid Gemini API. Set `DATABASE_URL` to a disposable database
before running `bun test` (see "Local Postgres" above); CI provisions one via the shared
`postgres:16` service container already used for `@maker/accounts`.
