# @maker/cloud-projects

Save/sync/share designs across devices, per `ROADMAP.md` Stage 6: a project-metadata API backed by
Postgres, the actual design payload (layers/paths/settings) stored in an S3-compatible object
store, and shareable read-only links. Lives in this monorepo as its own workspace app rather than a
separate repo — see `ROADMAP.md` §8 for why.

Every project-scoped route requires `Authorization: Bearer <token>` and verifies it against
`@maker/accounts`'s `GET /me` (`accountsAuth.ts`'s `verifySession`) - the caller never supplies a
`userId` directly, it's derived from the validated session. The one exception is `GET /shared/:token`,
which is deliberately unauthenticated: that's the whole point of a share link. See "Access control"
below for the details.

## Running

```sh
bun run --cwd apps/cloud-projects dev
```

Listens on `PORT` (default `8790`). Applies any pending `migrations/*.sql` files automatically on
first request (tracked in a `_migrations` table), so there's no separate migrate step to remember.

## Environment variables

| Variable               | Required | Default | Used by                                                                                         |
| ---------------------- | -------- | ------- | ----------------------------------------------------------------------------------------------- |
| `PORT`                 | no       | `8790`  | server listen port                                                                              |
| `DATABASE_URL`         | yes      | —       | Postgres connection string, e.g. `postgres://user:password@localhost:5432/maker_cloud_projects` |
| `S3_ENDPOINT`          | yes      | —       | S3-compatible endpoint URL (AWS S3, Cloudflare R2, a local MinIO)                               |
| `S3_BUCKET`            | yes      | —       | bucket name project data is stored under                                                        |
| `S3_ACCESS_KEY_ID`     | yes      | —       | object storage credentials                                                                      |
| `S3_SECRET_ACCESS_KEY` | yes      | —       | object storage credentials                                                                      |
| `S3_REGION`            | no       | `auto`  | most S3-compatible providers other than AWS itself ignore this                                  |
| `ACCOUNTS_URL`         | yes      | —       | `@maker/accounts`'s base URL, used to verify a caller's bearer token via `GET /me`              |

Without `DATABASE_URL` (or without all four `S3_*` variables) set, every request responds `500`
with a message explaining what's missing — matching `@maker/ai-inference`'s `GEMINI_API_KEY`
handling: no silent fallback that could be mistaken for a working configuration. Every
project-scoped route fails the same way without `ACCOUNTS_URL` set - see "Access control" below.

## Local Postgres + object storage

```sh
sudo -u postgres createuser -P maker   # password: maker
sudo -u postgres createdb -O maker maker_cloud_projects
export DATABASE_URL=postgres://maker:maker@localhost:5432/maker_cloud_projects
```

For object storage, run a local MinIO (a free, S3-compatible server) and point the `S3_*`
variables at it:

```sh
docker run --rm -p 9000:9000 -e MINIO_ROOT_USER=maker -e MINIO_ROOT_PASSWORD=makermaker \
  minio/minio server /data
export S3_ENDPOINT=http://localhost:9000
export S3_BUCKET=maker-cloud-projects   # create it first: `mc mb local/maker-cloud-projects`
export S3_ACCESS_KEY_ID=maker
export S3_SECRET_ACCESS_KEY=makermaker
```

(or point at a real AWS S3/Cloudflare R2 bucket instead.)

## API

| Route                        | Body / Query       | Auth                            | Response                                                                                        |
| ---------------------------- | ------------------ | ------------------------------- | ----------------------------------------------------------------------------------------------- |
| `POST /projects`             | `{ name, data }`   | `Authorization: Bearer <token>` | `201 { project }` / `400` for a blank `name` or missing `data` / `401` invalid/expired token    |
| `GET /projects`              | —                  | `Authorization: Bearer <token>` | `200 { projects }` — summaries only (no `data`), newest-updated first / `401`                   |
| `GET /projects/:id`          | —                  | `Authorization: Bearer <token>` | `200 { project }` (includes `data`) / `404` if missing or not owned by the caller / `401`       |
| `PUT /projects/:id`          | `{ name?, data? }` | `Authorization: Bearer <token>` | `200 { project }` — updates whichever of `name`/`data` is present / `404` / `401`               |
| `DELETE /projects/:id`       | —                  | `Authorization: Bearer <token>` | `204` / `404` / `401`                                                                           |
| `POST /projects/:id/share`   | —                  | `Authorization: Bearer <token>` | `200 { token }` — creates a share token if the project doesn't already have one / `404` / `401` |
| `DELETE /projects/:id/share` | —                  | `Authorization: Bearer <token>` | `204` — revokes the project's share token / `404` / `401`                                       |
| `GET /shared/:token`         | —                  | —                               | `200 { project }` (includes `data`, no auth) / `404` if the token is unknown/revoked            |

`project` is `{ id, name, createdAt, updatedAt, data }`, where `data` is an arbitrary
JSON-serializable payload — `apps/web` is expected to pass its `VectorDocument` (or similar) here
verbatim; this service never inspects its shape.

## Access control

Every project-scoped route resolves the caller's `userId` from their bearer token, never from a
client-supplied value - `accountsAuth.ts`'s `verifySession(token)` calls `@maker/accounts`'s
`GET /me` and returns the id of whichever user that token belongs to (or `undefined` for a
missing/invalid/expired one, which the route maps to `401`). `projects.ts`'s existing
`WHERE id = $1 AND user_id = $2` ownership checks then do the rest: a valid token for user A can
never read, update, delete, or (re)share a project belonging to user B - it fails with the exact
same `404` a genuinely unknown project id would, rather than leaking whether the id exists. This
mirrors `@maker/community-library`/`@maker/material-db`'s `moderatorAuth.ts` (which verifies a
moderator role against `@maker/accounts` the same way), just verifying identity instead of a role.

`GET /shared/:token` is the one deliberately unauthenticated route - a share link's whole purpose is
letting anyone with the link view the project, so requiring a session there would defeat it.

## What's not here yet

- **Thumbnails/previews** — `GET /projects` returns metadata only, no preview image. Would likely
  live alongside the design JSON in the same S3 bucket once `apps/web` renders one to upload.
- **Storage quotas per plan tier** — `@maker/billing` knows a user's plan, but nothing here checks
  it or limits project count/size by tier yet.
- **Collaborative editing** — this is single-writer save/load, not realtime multi-user sync.

## Testing note

Like `@maker/accounts` and `@maker/billing`, these tests run against a real local Postgres database
(free and reproducible, so there's no reason to mock it). Unlike Postgres, this sandbox has no
S3-compatible bucket to test against (and can't even reach the public internet to download a local
MinIO server to stand one up), so the AWS SDK client itself is faked in tests
(`test/fakeS3.ts`) — using the SDK's own `Command` classes so only the network transport is faked,
the same approach `@maker/billing` takes for the paid Stripe API. Set `DATABASE_URL` to a disposable
database before running `bun test` (see "Local Postgres" above); CI provisions one via the shared
`postgres:16` service container already used for `@maker/accounts`/`@maker/billing`.
