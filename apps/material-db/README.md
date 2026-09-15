# @maker/material-db

Crowdsourced material settings (speed/power presets by material × machine), per `ROADMAP.md`
Stage 6: a submission/review API with versioned presets and search. Lives in this monorepo as its
own workspace app rather than a separate repo — see `ROADMAP.md` §8 for why. `packages/material-library`
(Stage 4B's bundled, hand-curated static JSON) is expected to migrate into this service later as a
one-time seed, once this exists to migrate into.

Like `@maker/billing`/`@maker/cloud-projects`, this service trusts the caller (`apps/web`, having
already authenticated against `@maker/accounts`) to pass the correct `userId`/`reviewerId` — it
doesn't itself validate bearer tokens or session cookies, and has no concept of a "moderator" role
yet (see "What's not here yet").

## Running

```sh
bun run --cwd apps/material-db dev
```

Listens on `PORT` (default `8791`). Applies any pending `migrations/*.sql` files automatically on
first request (tracked in a `_migrations` table), so there's no separate migrate step to remember.

## Environment variables

| Variable       | Required | Default | Used by                                                                                      |
| -------------- | -------- | ------- | -------------------------------------------------------------------------------------------- |
| `PORT`         | no       | `8791`  | server listen port                                                                           |
| `DATABASE_URL` | yes      | —       | Postgres connection string, e.g. `postgres://user:password@localhost:5432/maker_material_db` |

Without `DATABASE_URL` set, every request responds `500` with a message explaining the variable is
missing — matching `@maker/ai-inference`'s `GEMINI_API_KEY` handling: no silent fallback that could
be mistaken for a working configuration.

## Local Postgres

```sh
sudo -u postgres createuser -P maker   # password: maker
sudo -u postgres createdb -O maker maker_material_db
export DATABASE_URL=postgres://maker:maker@localhost:5432/maker_material_db
```

(or `docker run --rm -p 5432:5432 -e POSTGRES_USER=maker -e POSTGRES_PASSWORD=maker -e POSTGRES_DB=maker_material_db postgres:16`.)

## Data model

A **preset** is one submission for a `(material, machineType, operation)` key — e.g.
`("Baltic Birch Plywood 3mm", "diode-laser", "cut")` — with a `speed`/`power`/`passes` and optional
free-text `notes`. `material`/`machineType`/`operation` are free text (not a closed enum), trimmed
and lowercased so near-duplicates ("Baltic Birch" vs "baltic birch ") land in the same history;
`packages/material-library`'s `MachineType`/`MaterialOperation` unions (`diode-laser`/`co2-laser`/
`fiber-laser`/`cnc-router` and `cut`/`engrave`/`score`/`mark`) are the canonical values worth
sticking to, but this service doesn't enforce them, since a crowdsourced material name space can't
be a closed list.

Every submission for a key gets the next `version` number and starts `pending`. A moderator
approves or rejects it; search (`GET /presets`) only ever returns the highest-versioned **approved**
row per key, while `GET /presets/history` returns every version (any status) for a key, so nothing
is ever deleted or overwritten — that's the "versioned" part.

## API

| Route                       | Body / Query                                                                  | Response                                                                 |
| --------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `POST /presets`             | `{ userId, material, machineType, operation, speed, power, passes?, notes? }` | `201 { preset }` (status `pending`) / `400` for invalid input            |
| `GET /presets`              | `?material=&machineType=&operation=` (all optional)                           | `200 { presets }` — current approved preset per matching key             |
| `GET /presets/pending`      | —                                                                             | `200 { presets }` — awaiting moderation, oldest first                    |
| `GET /presets/history`      | `?material=&machineType=&operation=` (all required)                           | `200 { presets }` — every version for that exact key, newest first       |
| `GET /presets/:id`          | —                                                                             | `200 { preset }` / `404`                                                 |
| `POST /presets/:id/approve` | `{ reviewerId, notes? }`                                                      | `200 { preset }` (status `approved`) / `404` / `409` if already reviewed |
| `POST /presets/:id/reject`  | `{ reviewerId, notes? }`                                                      | `200 { preset }` (status `rejected`) / `404` / `409` if already reviewed |

`preset` is `{ id, material, machineType, operation, speed, power, passes, notes, status, version, submittedBy, reviewedBy, reviewedAt, reviewNotes, createdAt }`.
`speed` is mm/min, `power` a 0-1000 S-value — matching `packages/material-library`'s `MaterialPreset`
so a future seed migration is a straight field mapping.

## What's not here yet

- **Moderator role enforcement** — `reviewerId` is trusted as-is; any caller can approve/reject.
  `@maker/accounts` has no role/permission system yet to check against.
- **Migrating `packages/material-library`'s bundled presets in** — this service exists now, but the
  actual one-time seed script hasn't been written.
- **Duplicate-submission detection / voting** — two users submitting near-identical settings for the
  same key just creates two versions; there's no "this matches an existing preset" nudge or
  upvote/downvote signal yet.
- **Full-text/fuzzy search** — `material` filtering is a plain `ILIKE '%...%'`, not a search index.

## Testing note

Like `@maker/accounts`, these tests run against a real local Postgres database (free and
reproducible, so there's no reason to mock it) — this service has no paid external dependency to
fake, unlike `@maker/billing` (Stripe) or `@maker/cloud-projects` (S3). Set `DATABASE_URL` to a
disposable database before running `bun test` (see "Local Postgres" above); CI provisions one via
the shared `postgres:16` service container already used for the other Postgres-backed services.
