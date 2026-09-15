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

| Variable                | Required                         | Default | Used by                                                                                  |
| ----------------------- | -------------------------------- | ------- | ---------------------------------------------------------------------------------------- |
| `PORT`                  | no                               | `8789`  | server listen port                                                                       |
| `DATABASE_URL`          | yes                              | —       | Postgres connection string, e.g. `postgres://user:password@localhost:5432/maker_billing` |
| `STRIPE_SECRET_KEY`     | yes, for checkout/portal/webhook | —       | Stripe API calls (a free test-mode key works: https://dashboard.stripe.com/apikeys)      |
| `STRIPE_WEBHOOK_SECRET` | yes, for `/webhook`              | —       | verifies incoming webhook signatures (https://dashboard.stripe.com/webhooks)             |
| `STRIPE_PRICE_PRO`      | yes, to sell the `pro` plan      | —       | Stripe Price ID for the `pro` plan (https://dashboard.stripe.com/products)               |

Without `DATABASE_URL` set, every request responds `500` with a message explaining the variable is
missing — matching `@maker/ai-inference`'s `GEMINI_API_KEY` handling: no silent fallback that could
be mistaken for a working configuration. The Stripe-backed routes fail the same way if
`STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`/`STRIPE_PRICE_PRO` are missing; `GET /subscription` and
the `/usage` routes don't touch Stripe at all and work without any Stripe env vars.

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
| `POST /webhook`          | raw Stripe event body, `Stripe-Signature` header                                   | `200 { received: true }` / `400` on a bad/missing signature                                                                                   |

`/webhook` handles `checkout.session.completed`, `customer.subscription.updated`, and
`customer.subscription.deleted` — the three events needed to keep the local `subscriptions` table
in sync with Stripe. Every other event type is a no-op (Stripe sends many event types this service
doesn't need).

## What's not here yet

- **Multiple paid plan tiers** — only `pro` is wired up (`STRIPE_PRICE_PRO`). Adding another tier
  is a matter of adding another entry to `src/plans.ts`'s price-env-var map plus its own env var.
- **Usage-based billing / metered pricing** — `/usage` just records and totals events; nothing
  reports usage back to Stripe for metered invoicing yet. Nothing in `apps/web` calls `/usage` yet
  either — that's a follow-up once a feature actually needs a usage cap.
- **Failed-payment / dunning emails** — Stripe's own dashboard/portal handles this today; no
  custom notification flow.

## Testing note

Like `@maker/accounts`, these tests run against a real local Postgres database (free and
reproducible, so there's no reason to mock it). Unlike Postgres, the Stripe API is a paid,
external, account-gated service this sandbox doesn't have credentials for, so the Stripe SDK
client itself is faked in tests (`test/fakeStripe.ts`) — the same approach
`@maker/ai-inference` takes for the paid Gemini API. Set `DATABASE_URL` to a disposable database
before running `bun test` (see "Local Postgres" above); CI provisions one via the shared
`postgres:16` service container already used for `@maker/accounts`.
