# @maker/accounts

User identity for the platform-growth services introduced in `ROADMAP.md` Stage 6: email/password
signup and login, bearer-token sessions, a `planTier` field for `@maker/billing` to manage, and a
`role` field (`user`/`moderator`) other services can use to gate privileged actions — currently
consumed by `apps/web`'s moderation UI for `@maker/community-library`. Lives in this monorepo as
its own workspace app rather than a separate repo — see `ROADMAP.md` §8 for why.

## Running

```sh
bun run --cwd apps/accounts dev
```

Listens on `PORT` (default `8788`). Applies any pending `migrations/*.sql` files automatically on
first request (tracked in a `_migrations` table), so there's no separate migrate step to remember.

## Environment variables

| Variable           | Required | Default | Used by                                                                                   |
| ------------------ | -------- | ------- | ----------------------------------------------------------------------------------------- |
| `PORT`             | no       | `8788`  | server listen port                                                                        |
| `DATABASE_URL`     | yes      | —       | Postgres connection string, e.g. `postgres://user:password@localhost:5432/maker_accounts` |
| `MODERATOR_EMAILS` | no       | —       | comma-separated emails to auto-promote to the `moderator` role (see below)                |

Without `DATABASE_URL` set, every request responds `500` with a message explaining the variable is
missing — matching `@maker/ai-inference`'s `GEMINI_API_KEY` handling: no silent fallback that could
be mistaken for a working configuration.

## Local Postgres

```sh
sudo -u postgres createuser -P maker   # password: maker
sudo -u postgres createdb -O maker maker_accounts
export DATABASE_URL=postgres://maker:maker@localhost:5432/maker_accounts
```

(or `docker run --rm -p 5432:5432 -e POSTGRES_USER=maker -e POSTGRES_PASSWORD=maker -e POSTGRES_DB=maker_accounts postgres:16`.)

## API

| Route          | Body                  | Auth                            | Response                                                        |
| -------------- | --------------------- | ------------------------------- | --------------------------------------------------------------- |
| `POST /signup` | `{ email, password }` | —                               | `201 { user, token }` / `409` if email taken / `400` if invalid |
| `POST /login`  | `{ email, password }` | —                               | `200 { user, token }` / `401` if wrong                          |
| `POST /logout` | —                     | `Authorization: Bearer <token>` | `204`                                                           |
| `GET /me`      | —                     | `Authorization: Bearer <token>` | `200 { user }` / `401` if invalid/expired                       |

`user` is `{ id, email, planTier, role, createdAt }`. Sessions are bearer tokens (not cookies): the
client is expected to hold the token (e.g. in memory or `localStorage`) and send it as
`Authorization: Bearer <token>`. Only a SHA-256 hash of each token is stored, so a database leak
alone can't be replayed as a valid session. A production deployment fronting real end users would
likely want httpOnly cookies + CSRF protection instead — out of scope for this initial in-repo
service, same as `@maker/ai-inference`'s wide-open dev CORS policy.

## Roles

Every user has a `role`: `user` (default) or `moderator`. There's no role-management API yet —
instead, `MODERATOR_EMAILS` (a comma-separated, case-insensitive list) is checked on every
signup/login/session-check (`/signup`, `/login`, `/me`), and a matching user's role is promoted to
`moderator` and persisted the moment they next authenticate. This mirrors the "trust config, not an
admin UI" approach `GEMINI_API_KEY`-style env vars already use elsewhere in this repo, and avoids
the bootstrapping problem of needing an existing admin to grant the first admin. It's promote-only:
removing an email from the list doesn't revoke a role already granted (that's a manual
`UPDATE users SET role = 'user'` for now).

As with everything else in this service, callers are expected to enforce anything role-gated
themselves by checking the `role` on the authenticated user — this service doesn't expose a
separate authorization check, and none of the other Stage 6 services validate it either. See
`@maker/community-library`'s README for how its moderation actions are currently gated on this.

## What's not here yet

- **OAuth** (Google/GitHub/etc.) — `ROADMAP.md` lists it alongside email/password, but it needs a
  real registered OAuth app (client ID/secret) to implement against, the same kind of external
  dependency `GEMINI_API_KEY` is for `@maker/ai-inference`. Email/password covers real signup/login
  end-to-end without one; OAuth is a follow-up once a provider app exists to test against.
- **Expired-session cleanup** — an expired session simply fails `/me`/`validateSession`; nothing
  deletes the row. A real deployment would run a periodic `DELETE FROM sessions WHERE expires_at < now()`.
- **Password reset / email verification** — not yet implemented.
- **A role-management API/UI** — roles can currently only be granted via `MODERATOR_EMAILS` config
  or a direct DB update, not through a request any user or admin can make.

## Testing note

Unlike `@maker/ai-inference` (which mocks the paid Gemini API), these tests run against a real
local Postgres database — free and reproducible, so there's no reason to mock it. Set
`DATABASE_URL` to a disposable database before running `bun test` (see "Local Postgres" above); CI
provides one via a `postgres:16` service container.
