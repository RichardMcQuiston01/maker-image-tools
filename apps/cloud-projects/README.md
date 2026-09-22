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

| Variable               | Required | Default | Used by                                                                                                                  |
| ---------------------- | -------- | ------- | ------------------------------------------------------------------------------------------------------------------------ |
| `PORT`                 | no       | `8790`  | server listen port                                                                                                       |
| `DATABASE_URL`         | yes      | —       | Postgres connection string, e.g. `postgres://user:password@localhost:5432/maker_cloud_projects`                          |
| `S3_ENDPOINT`          | yes      | —       | S3-compatible endpoint URL (AWS S3, Cloudflare R2, a local MinIO)                                                        |
| `S3_BUCKET`            | yes      | —       | bucket name project data is stored under                                                                                 |
| `S3_ACCESS_KEY_ID`     | yes      | —       | object storage credentials                                                                                               |
| `S3_SECRET_ACCESS_KEY` | yes      | —       | object storage credentials                                                                                               |
| `S3_REGION`            | no       | `auto`  | most S3-compatible providers other than AWS itself ignore this                                                           |
| `ACCOUNTS_URL`         | yes      | —       | `@maker/accounts`'s base URL, used to verify a caller's bearer token via `GET /me`                                       |
| `BILLING_URL`          | yes      | —       | `@maker/billing`'s base URL, e.g. `http://localhost:8789` — used to look up a caller's plan tier via `GET /subscription` |

Without `DATABASE_URL` (or without all four `S3_*` variables) set, every request responds `500`
with a message explaining what's missing — matching `@maker/ai-inference`'s `GEMINI_API_KEY`
handling: no silent fallback that could be mistaken for a working configuration. Every
project-scoped route fails the same way without `ACCOUNTS_URL` set - see "Access control" below.
`POST /projects` and `PUT /projects/:id` additionally fail without `BILLING_URL` set - see "Storage
quotas" below.

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

| Route                                    | Body / Query         | Auth                            | Response                                                                                                                                                 |
| ---------------------------------------- | -------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /projects`                         | `{ name, data }`     | `Authorization: Bearer <token>` | `201 { project }` / `400` for a blank `name` or missing `data` / `401` invalid/expired token / `402` over the caller's plan quota                        |
| `GET /projects`                          | —                    | `Authorization: Bearer <token>` | `200 { projects }` — owned and collaborated-on, summaries only (no `data`), newest-updated first / `401`                                                 |
| `GET /projects/:id`                      | —                    | `Authorization: Bearer <token>` | `200 { project }` (includes `data`) / `404` if missing or the caller is neither its owner nor a collaborator / `401`                                     |
| `PUT /projects/:id`                      | `{ name?, data? }`   | `Authorization: Bearer <token>` | `200 { project }` — updates whichever of `name`/`data` is present / `404` / `401` / `402` if the new `data` would put the project over its owner's quota |
| `DELETE /projects/:id`                   | —                    | `Authorization: Bearer <token>` | `204` — owner-only / `403` if the caller is a collaborator, not the owner / `404` / `401`                                                                |
| `POST /projects/:id/share`               | —                    | `Authorization: Bearer <token>` | `200 { token }` — owner-only, creates a share token if the project doesn't already have one / `403` / `404` / `401`                                      |
| `DELETE /projects/:id/share`             | —                    | `Authorization: Bearer <token>` | `204` — owner-only, revokes the project's share token / `403` / `404` / `401`                                                                            |
| `PUT /projects/:id/thumbnail`            | raw `image/png` body | `Authorization: Bearer <token>` | `204` / `400` for a non-`image/png` body / `404` / `401`                                                                                                 |
| `GET /projects/:id/thumbnail`            | —                    | `Authorization: Bearer <token>` | `200` raw `image/png` body / `404` if missing or inaccessible / `401`                                                                                    |
| `DELETE /projects/:id/thumbnail`         | —                    | `Authorization: Bearer <token>` | `204` — removes the thumbnail if there is one (idempotent) / `404` / `401`                                                                               |
| `GET /projects/:id/collaborators`        | —                    | `Authorization: Bearer <token>` | `200 { collaborators }` / `404` if the caller has no access to the project / `401`                                                                       |
| `POST /projects/:id/collaborators`       | `{ userId }`         | `Authorization: Bearer <token>` | `200 { collaborators }` — owner-only, idempotent / `400` if `userId` is the project's own owner / `403` / `404` / `401`                                  |
| `DELETE /projects/:id/collaborators/:id` | —                    | `Authorization: Bearer <token>` | `204` — owner-only, idempotent / `403` / `404` / `401`                                                                                                   |
| `GET /projects/:id/live`                 | `?token=<token>`     | via `token` query parameter     | `200`, a `text/event-stream` of live updates for as long as the connection stays open / `404` if inaccessible / `401` missing/invalid/expired token      |
| `GET /shared/:token`                     | —                    | —                               | `200 { project }` (includes `data`, no auth) / `404` if the token is unknown/revoked                                                                     |
| `GET /shared/:token/thumbnail`           | —                    | —                               | `200` raw `image/png` body (no auth) / `404` if the token is unknown/revoked or has no thumbnail                                                         |

`project` is `{ id, name, createdAt, updatedAt, hasThumbnail, data, role }`, where `data` is an
arbitrary JSON-serializable payload — `apps/web` is expected to pass its `VectorDocument` (or
similar) here verbatim; this service never inspects its shape. `hasThumbnail` tells a caller
whether it's worth fetching `GET .../thumbnail` at all, instead of issuing a request that's
guaranteed to `404`. `role` is `"owner"` or `"collaborator"` (see "Collaborators" below) - omitted
from `GET /shared/:token`'s response, since an anonymous share-link viewer has neither
relationship to the project.

## Access control

Every project-scoped route resolves the caller's `userId` from their bearer token, never from a
client-supplied value - `accountsAuth.ts`'s `verifySession(token)` calls `@maker/accounts`'s
`GET /me` and returns the id of whichever user that token belongs to (or `undefined` for a
missing/invalid/expired one, which the route maps to `401`). `projects.ts`'s
`findAccessibleProjectRow` then does the rest: it matches a project the caller either owns
(`user_id = $2`) or is a collaborator on (a row in `project_collaborators`), and throws
`ProjectNotFoundError` (`404`) otherwise - a valid token for user A can never read, edit, or
discover the existence of a project neither owned by nor shared with them, the exact same `404` a
genuinely unknown project id would produce. This mirrors
`@maker/community-library`/`@maker/material-db`'s `moderatorAuth.ts` (which verifies a moderator
role against `@maker/accounts` the same way), just verifying identity instead of a role.

A second tier, `findOwnedProjectRow`, additionally requires the caller to be the project's
_owner_ - used by the delete/share/collaborator-management routes (see "Collaborators" below).
Reaching a project at all but failing this stricter check throws `NotProjectOwnerError` (`403`)
instead of `404`: a collaborator already knows the project exists (they can view and edit it), so
a `404` there would just be a lie the way it correctly isn't for a total stranger.

`GET /shared/:token` is the one deliberately unauthenticated route - a share link's whole purpose is
letting anyone with the link view the project, so requiring a session there would defeat it.

## Collaborators

A project has exactly one owner (whoever created it - the `user_id` column always means this) and
any number of collaborators (rows in `project_collaborators`, a plain `(project_id, user_id)` pair
with no cross-service foreign key - `user_id` is just `@maker/accounts`'s opaque UUID, the same
trust model `projects.user_id` itself already uses). The split:

- **Owner**: everything a collaborator can do, plus delete the project, create/revoke its share
  link, and manage its collaborator list (`POST`/`DELETE .../collaborators`).
- **Collaborator**: view and edit the project's `name`/`data` (`GET`/`PUT /projects/:id`) and its
  thumbnail, exactly like the owner - but nothing admin-shaped. A collaborator's edit is charged
  against the _owner's_ storage quota (`updateProject`'s `getQuota` callback resolves the plan tier
  for `row.user_id`, not the caller), since the data is stored under the owner's account either way.

`POST /projects/:id/collaborators` takes a `userId`, not an email - `apps/web`'s "invite a
collaborator" UI resolves an email to a user id first via `@maker/accounts`'s
`GET /users/by-email`, then calls this with the result. Adding an already-added collaborator, or
removing one who isn't currently a collaborator, is a no-op (not a `409`/`404`) - there's no
meaningful "conflict" in either direction. A project's owner can't be added as their own
collaborator (`400`) - they already have full access, and the distinction would stop meaning
anything.

`GET /projects`/`GET /projects/:id`/`PUT /projects/:id` all include a `role` (`"owner"` or
`"collaborator"`) in their response, telling `apps/web` which controls to show for a given project
without it having to separately track "is this my project" itself.

## Live updates

`GET /projects/:id/live` is a `text/event-stream` (Server-Sent Events) connection: on connect it
immediately sends the project's current state as one `{ "type": "project", "project": {...} }`
message, then a further message of the same shape every time _anyone_ (owner or any collaborator)
successfully `PUT`s the project, plus `{ "type": "deleted" }` if it's deleted and
`{ "type": "collaborators", "collaborators": [...] }` when the collaborator list changes. This is
how `apps/web` notices a collaborator's save without polling - see its `CloudProjectsPanel` for how
it surfaces this as a dismissible "updated elsewhere, reload?" banner rather than silently
overwriting whatever's open in the editor.

This is deliberately last-write-wins broadcast, not operational-transform/CRDT-style merging -
concurrent edits to the same project still just overwrite each other on `PUT`, the same as before
this feature existed; live updates only make that visible instead of silent. `EventSource` can't
set custom headers, so auth here is a `?token=` query parameter (validated with the same
`verifySession` as everywhere else) rather than an `Authorization` header. `liveUpdates.ts`'s
subscriber registry is in-memory and per-process (`Map<projectId, Set<ServerResponse>>`) - fine
for this service's single-dev-server-instance scope like every other `apps/*` service in this
repo, but a multi-replica production deployment would need a real pub/sub backend (e.g. Redis) to
fan a write on one instance out to viewers connected to another.

## Storage quotas

`POST /projects` and `PUT /projects/:id` (when it changes `data`) enforce a per-user limit on
project count and total stored bytes, based on the caller's `@maker/billing` plan tier:

| Plan tier | Max projects | Max total data size |
| --------- | ------------ | ------------------- |
| `free`    | 10           | 5 MB                |
| `pro`     | 200          | 250 MB              |

`billingClient.ts`'s `getPlanTier(userId)` calls `@maker/billing`'s `GET /subscription?userId=` to
find the caller's tier (defaulting to `free` for anyone with no active subscription, matching
`@maker/billing`'s own default), and `quotas.ts`'s `quotaForPlanTier` maps that tier to the limits
above - falling back to the `free` limits for any tier it doesn't recognize, so an unexpected value
is never treated as unlimited. `projects.ts`'s `assertWithinQuota` then sums a user's _other_
projects' `data_size_bytes` (a column maintained alongside each save, so this never has to re-fetch
every project's data from S3 just to measure it) and rejects the write with `QuotaExceededError`
(`402 Payment Required`) if it would put them over either limit. Project count only factors into
`POST /projects` - updating an existing project's `data` never changes how many projects the user
has, only how large this one is.

## Thumbnails

A project can have one small preview image alongside its design JSON, stored in the same S3
bucket under `projects/{userId}/{projectId}-thumbnail.png` (`objectStorage.ts`'s
`projectThumbnailKey`) and tracked by a `has_thumbnail` column on the `projects` row so `GET
/projects`/`GET /projects/:id` can report `hasThumbnail` without a speculative S3 lookup. Only
`image/png` is accepted (that's all `apps/web`'s `renderThumbnail.ts` ever produces, by rasterizing
the design's visible vector paths onto a small canvas) - anything else is rejected with `400`.
`DELETE /projects/:id` also removes the project's thumbnail object, if it has one, so nothing is
orphaned in the bucket. `GET /shared/:token/thumbnail` mirrors `GET /shared/:token`: no auth
required, since a share link's whole point is letting anyone with it view the project - preview
included.

## What's not here yet

- **Real-time collaborative editing (OT/CRDT)** — "Collaborators" and "Live updates" above cover
  shared write access and a last-write-wins broadcast of each save, but two people editing the same
  project at the same moment still just overwrite each other on `PUT`; there's no operational
  transform/CRDT merging of concurrent, in-flight changes the way e.g. Google Docs has.
- **Presence** ("who else is viewing this right now") — the live-updates stream broadcasts project
  changes, not who's currently connected to it.
- **Multi-instance live updates** — see "Live updates" above; `liveUpdates.ts`'s subscriber registry
  is per-process, so a deployment with more than one `apps/cloud-projects` instance behind a load
  balancer would need a shared pub/sub backend for a save on one instance to reach a viewer
  connected to another.

## Testing note

Like `@maker/accounts` and `@maker/billing`, these tests run against a real local Postgres database
(free and reproducible, so there's no reason to mock it). Unlike Postgres, this sandbox has no
S3-compatible bucket to test against (and can't even reach the public internet to download a local
MinIO server to stand one up), so the AWS SDK client itself is faked in tests
(`test/fakeS3.ts`) — using the SDK's own `Command` classes so only the network transport is faked,
the same approach `@maker/billing` takes for the paid Stripe API. Set `DATABASE_URL` to a disposable
database before running `bun test` (see "Local Postgres" above); CI provisions one via the shared
`postgres:16` service container already used for `@maker/accounts`/`@maker/billing`.
