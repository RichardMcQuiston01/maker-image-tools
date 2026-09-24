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

Without `DATABASE_URL` set, every request responds `500` with a message explaining the variable is
missing — matching `@maker/ai-inference`'s `GEMINI_API_KEY` handling: no silent fallback that could
be mistaken for a working configuration. The Stripe-backed routes fail the same way if
`STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`/`STRIPE_PRICE_PRO` are missing; `GET /subscription` and
`POST`/`GET /usage` don't touch Stripe at all and work without any Stripe env vars, but
`POST /usage/report` does (it calls Stripe directly) and needs `STRIPE_SECRET_KEY` like the other
Stripe-backed routes.

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

`/webhook` handles `checkout.session.completed`, `customer.subscription.updated`, and
`customer.subscription.deleted` — the three events needed to keep the local `subscriptions` table
in sync with Stripe. Every other event type is a no-op (Stripe sends many event types this service
doesn't need).

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

## What's not here yet

- **Multiple paid plan tiers** — only `pro` is wired up (`STRIPE_PRICE_PRO`). Adding another tier
  is a matter of adding another entry to `src/plans.ts`'s price-env-var map plus its own env var.
- **Failed-payment / dunning emails** — Stripe's own dashboard/portal handles this today; no
  custom notification flow.
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
