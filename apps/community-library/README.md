# @maker/community-library

Shared project/asset marketplace, per `ROADMAP.md` Stage 6: browse/search/publish listings, a
moderation queue, and ratings. Lives in this monorepo as its own workspace app rather than a
separate repo — see `ROADMAP.md` §8 for why.

This is deliberately decoupled from `@maker/cloud-projects` (private per-user save/sync): a listing
isn't a reference to a saved cloud project, it's its own copy of the design data, submitted directly
by the publisher. That matches this repo's established pattern of services owning their own data
with no cross-service foreign keys or synchronous service-to-service HTTP calls — `apps/web` is the
only thing that talks to more than one of these services, and it already has the design data loaded
when the user clicks "publish," so there's nothing to fetch from elsewhere first.

Like `@maker/billing`/`@maker/cloud-projects`/`@maker/material-db`, this service trusts the caller
(`apps/web`, having already authenticated against `@maker/accounts`) to pass the correct
`userId`/`reviewerId` — it doesn't itself validate bearer tokens or session cookies, or the caller's
role. `@maker/accounts` now has a `role` field (`user`/`moderator`, see its README's "Roles"
section), and `apps/web` uses it to decide who sees the moderation UI (its `ModerationPanel` only
shows the pending-listings queue and Approve/Reject actions to a signed-in user whose `role` is
`moderator`; everyone else sees a one-line hint instead) and therefore who ever calls
`/listings/:id/approve`/`/reject` in practice. That's a client-side gate, consistent with this
service's existing trust model for `userId`/`reviewerId` generally — it is not enforced by this API
itself, so a direct API call can still pass any `reviewerId`. Real enforcement at this layer would
need this service to validate the caller's session against `@maker/accounts`, which would introduce
the synchronous service-to-service call this repo's services deliberately avoid (see above); that's
a bigger architectural step than adding a role field, and hasn't been taken yet.

## Running

```sh
bun run --cwd apps/community-library dev
```

Listens on `PORT` (default `8792`). Applies any pending `migrations/*.sql` files automatically on
first request (tracked in a `_migrations` table), so there's no separate migrate step to remember.

## Environment variables

| Variable               | Required | Default | Used by                                                                                            |
| ---------------------- | -------- | ------- | -------------------------------------------------------------------------------------------------- |
| `PORT`                 | no       | `8792`  | server listen port                                                                                 |
| `DATABASE_URL`         | yes      | —       | Postgres connection string, e.g. `postgres://user:password@localhost:5432/maker_community_library` |
| `S3_ENDPOINT`          | yes      | —       | S3-compatible endpoint URL (AWS S3, Cloudflare R2, a local MinIO)                                  |
| `S3_BUCKET`            | yes      | —       | bucket name listing data is stored under                                                           |
| `S3_ACCESS_KEY_ID`     | yes      | —       | object storage credentials                                                                         |
| `S3_SECRET_ACCESS_KEY` | yes      | —       | object storage credentials                                                                         |
| `S3_REGION`            | no       | `auto`  | most S3-compatible providers other than AWS itself ignore this                                     |

Without `DATABASE_URL` (or without all four `S3_*` variables) set, every request responds `500`
with a message explaining what's missing — matching `@maker/ai-inference`'s `GEMINI_API_KEY`
handling: no silent fallback that could be mistaken for a working configuration.

## Local Postgres + object storage

```sh
sudo -u postgres createuser -P maker   # password: maker
sudo -u postgres createdb -O maker maker_community_library
export DATABASE_URL=postgres://maker:maker@localhost:5432/maker_community_library
```

For object storage, run a local MinIO (a free, S3-compatible server) and point the `S3_*` variables
at it — see `apps/cloud-projects/README.md`'s "Local Postgres + object storage" section for the
full `docker run`/`mc mb` walkthrough (or point at a real AWS S3/Cloudflare R2 bucket instead). A
real deployment would front this bucket with a CDN, per `ROADMAP.md`'s stack line for this
workstream; that's out of scope here, same as `@maker/cloud-projects`'s bucket having no CDN either.

## Data model

A **listing** is one published submission: `title`, optional `description`, `tags` (free text,
trimmed/lowercased/deduped), the submitter's `userId`, and a moderation `status` (`pending` →
`approved`/`rejected`). Its design payload (`data`, an arbitrary JSON blob — `apps/web` is expected
to pass its `VectorDocument` verbatim) lives in S3-compatible object storage under
`listings/{listingId}.json`, keeping the same split `@maker/cloud-projects` uses (lightweight,
queryable metadata in Postgres; the actual blob in object storage).

**Ratings** are one row per `(listing, user)` pair (`stars` 1-5, optional `comment`) — rating the
same listing again updates your existing rating rather than adding a second one. Each write
recomputes and stores the listing's `ratingAvg`/`ratingCount` in the same transaction, so browsing/
sorting by rating never needs a live aggregate join.

## API

| Route                        | Body / Query                                   | Response                                                                                       |
| ---------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `POST /listings`             | `{ userId, title, description?, tags?, data }` | `201 { listing }` (status `pending`) / `400` for invalid input                                 |
| `GET /listings`              | `?q=&tag=&sort=newest\|rating` (all optional)  | `200 { listings }` — approved only, summaries (no `data`)                                      |
| `GET /listings/pending`      | —                                              | `200 { listings }` — awaiting moderation, oldest first                                         |
| `GET /listings/:id`          | —                                              | `200 { listing }` (includes `data`, any status) / `404`                                        |
| `DELETE /listings/:id`       | `?userId=`                                     | `204` / `404` if missing or not owned by `userId`                                              |
| `POST /listings/:id/approve` | `{ reviewerId, notes? }`                       | `200 { listing }` (status `approved`) / `404` / `409` if already reviewed                      |
| `POST /listings/:id/reject`  | `{ reviewerId, notes? }`                       | `200 { listing }` (status `rejected`) / `404` / `409` if already reviewed                      |
| `POST /listings/:id/ratings` | `{ userId, stars, comment? }` (`stars` 1-5)    | `200 { rating, listing }` — `listing` carries the freshly recomputed aggregate / `400` / `404` |
| `GET /listings/:id/ratings`  | —                                              | `200 { ratings }` — individual ratings, newest first                                           |

`listing` is `{ id, userId, title, description, tags, status, ratingAvg, ratingCount, reviewedBy, reviewedAt, reviewNotes, createdAt, updatedAt }`,
plus `data` on the single-listing/publish/ratings responses. `rating` is
`{ id, listingId, userId, stars, comment, createdAt, updatedAt }`.

## What's not here yet

- **API-level moderator role enforcement** — `reviewerId` is trusted as-is by this service; any
  direct API caller can still approve/reject. `apps/web` now gates its moderation UI on
  `@maker/accounts`'s `role` field (see the note near the top of this README), but this API doesn't
  check it itself.
- **Full-text/fuzzy search** — `q` filtering is a plain `ILIKE '%...%'` over title/description, not
  a search index.
- **Abuse handling for ratings** — no rate limiting, no verified-purchase/verified-use gating; any
  `userId` can rate any approved listing once.

## Testing note

Like `@maker/accounts`, these tests run against a real local Postgres database (free and
reproducible, so there's no reason to mock it). Unlike Postgres, this sandbox has no S3-compatible
bucket to test against (and can't reach the internet to download and stand up a local MinIO server
either), so the AWS SDK client itself is faked in tests (`test/fakeS3.ts`) — the same approach
`@maker/cloud-projects` takes. Set `DATABASE_URL` to a disposable database before running
`bun test` (see "Local Postgres" above); CI provisions one via the shared `postgres:16` service
container already used for the other Postgres-backed services.
