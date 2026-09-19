# @maker/accounts

User identity for the platform-growth services introduced in `ROADMAP.md` Stage 6: email/password
signup and login, OAuth login (Google/GitHub/Discord), bearer-token sessions, a `planTier` field for
`@maker/billing` to manage, and a `role` field (`user`/`moderator`) other services can use to gate
privileged actions — currently consumed by `apps/web`'s moderation UI for
`@maker/community-library`/`@maker/material-db`. Lives in this monorepo as its own workspace app
rather than a separate repo — see `ROADMAP.md` §8 for why.

## Running

```sh
bun run --cwd apps/accounts dev
```

Listens on `PORT` (default `8788`). Applies any pending `migrations/*.sql` files automatically on
first request (tracked in a `_migrations` table), so there's no separate migrate step to remember.

## Environment variables

| Variable                | Required                | Default | Used by                                                                                   |
| ----------------------- | ----------------------- | ------- | ----------------------------------------------------------------------------------------- |
| `PORT`                  | no                      | `8788`  | server listen port                                                                        |
| `DATABASE_URL`          | yes                     | —       | Postgres connection string, e.g. `postgres://user:password@localhost:5432/maker_accounts` |
| `MODERATOR_EMAILS`      | no                      | —       | comma-separated emails to auto-promote to the `moderator` role (see below)                |
| `ACCOUNTS_BASE_URL`     | yes, for OAuth          | —       | this service's own publicly reachable base URL, used to build the OAuth `redirect_uri`    |
| `WEB_APP_URL`           | yes, for OAuth          | —       | `apps/web`'s origin; the OAuth callback redirects here with a token (or an error)         |
| `GOOGLE_CLIENT_ID`      | yes, for Google login   | —       | Google OAuth app client ID                                                                |
| `GOOGLE_CLIENT_SECRET`  | yes, for Google login   | —       | Google OAuth app client secret                                                            |
| `GITHUB_CLIENT_ID`      | yes, for GitHub login   | —       | GitHub OAuth app client ID                                                                |
| `GITHUB_CLIENT_SECRET`  | yes, for GitHub login   | —       | GitHub OAuth app client secret                                                            |
| `DISCORD_CLIENT_ID`     | yes, for Discord login  | —       | Discord OAuth app client ID                                                               |
| `DISCORD_CLIENT_SECRET` | yes, for Discord login  | —       | Discord OAuth app client secret                                                           |
| `MAIL_API_KEY`          | yes, for password reset | —       | API key for the email provider (see "Password reset" below)                               |
| `MAIL_FROM_ADDRESS`     | yes, for password reset | —       | the `From` address on emails this service sends                                           |

Without `DATABASE_URL` set, every request responds `500` with a message explaining the variable is
missing — matching `@maker/ai-inference`'s `GEMINI_API_KEY` handling: no silent fallback that could
be mistaken for a working configuration. Each OAuth provider fails the same way, independently:
signing up/logging in with email/password works with none of the OAuth variables set; hitting
`/oauth/google/...` without `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` (or `/oauth/github/...`/
`/oauth/discord/...` without their GitHub/Discord equivalents) responds `500`, and every provider
also needs `ACCOUNTS_BASE_URL`/`WEB_APP_URL` set to complete a login. `POST /password-reset/request`
fails the same way without `MAIL_API_KEY`/`MAIL_FROM_ADDRESS`/`WEB_APP_URL` set - see "Password
reset" below.

## Local Postgres

```sh
sudo -u postgres createuser -P maker   # password: maker
sudo -u postgres createdb -O maker maker_accounts
export DATABASE_URL=postgres://maker:maker@localhost:5432/maker_accounts
```

(or `docker run --rm -p 5432:5432 -e POSTGRES_USER=maker -e POSTGRES_PASSWORD=maker -e POSTGRES_DB=maker_accounts postgres:16`.)

## API

| Route                           | Body                  | Auth                            | Response                                                                                                                     |
| ------------------------------- | --------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `POST /signup`                  | `{ email, password }` | —                               | `201 { user, token }` / `409` if email taken / `400` if invalid                                                              |
| `POST /login`                   | `{ email, password }` | —                               | `200 { user, token }` / `401` if wrong                                                                                       |
| `POST /logout`                  | —                     | `Authorization: Bearer <token>` | `204`                                                                                                                        |
| `GET /me`                       | —                     | `Authorization: Bearer <token>` | `200 { user }` / `401` if invalid/expired                                                                                    |
| `GET /oauth/:provider/start`    | —                     | optional `?linkToken=<token>`   | `302` to the provider's consent page / `404` unknown provider / `401` invalid/expired `linkToken`                            |
| `GET /oauth/:provider/callback` | —                     | —                               | `302` back to `WEB_APP_URL` with `?token=` or `?error=` / `404` unknown provider                                             |
| `GET /users/:id/role`           | —                     | —                               | `200 { role }` / `404` unknown user id                                                                                       |
| `POST /users/:id/role`          | `{ role }`            | `Authorization: Bearer <token>` | `200 { user }` / `400` invalid role / `401` invalid/expired token / `403` caller isn't a moderator / `404` unknown target id |
| `POST /me/password`             | `{ password }`        | `Authorization: Bearer <token>` | `200 { user }` / `400` invalid password / `401` invalid/expired token / `409` account already has a password                 |
| `POST /password-reset/request`  | `{ email }`           | —                               | `202`, always the same response whether or not the email is registered                                                       |
| `POST /password-reset/confirm`  | `{ token, password }` | —                               | `200 { user, token }` / `400` invalid/expired/used token or invalid password                                                 |

`GET /users/:id/role` is server-to-server: `apps/community-library` and `apps/material-db` call it
to verify a caller-supplied `reviewerId` actually belongs to a `moderator` before honoring an
approve/reject request. It's intentionally unauthenticated (like every other cross-service call in
this repo) — the id itself, not a bearer token, is the input, and this repo's services already
trust each other's plain ids everywhere else.

`POST /users/:id/role` is the role-management API: an already-authenticated moderator sets any
user's `role` to `user` or `moderator` (promote or demote). See "Roles" below for how this fits
alongside `MODERATOR_EMAILS`.

`POST /me/password` lets a signed-in user set a password for their own account - the one way an
OAuth-only account (`password_hash IS NULL`, see "OAuth login" below) gains the ability to also log
in with `POST /login`. It only ever sets a password where none exists yet (a `409` otherwise);
changing an existing password without proving current control of the account first needs a
different flow - see "Password reset" below.

`user` is `{ id, email, planTier, role, hasPassword, createdAt }`. Sessions are bearer tokens (not cookies): the
client is expected to hold the token (e.g. in memory or `localStorage`) and send it as
`Authorization: Bearer <token>`. Only a SHA-256 hash of each token is stored, so a database leak
alone can't be replayed as a valid session. A production deployment fronting real end users would
likely want httpOnly cookies + CSRF protection instead — out of scope for this initial in-repo
service, same as `@maker/ai-inference`'s wide-open dev CORS policy.

An expired session already fails `/me`/`validateSession` on its own, so this is table-size
housekeeping rather than a security boundary: `createServer` also runs `deleteExpiredSessions`
(`sessions.ts`) on an hourly timer for as long as the process stays up, deleting every session past
its `expires_at`. There's still no separate cron/migration step to remember — it's just another
thing the running server does for itself, the same way it applies pending migrations on boot.

## Roles

Every user has a `role`: `user` (default) or `moderator`. There are two ways to grant it:

- `MODERATOR_EMAILS` (a comma-separated, case-insensitive list) is checked on every
  signup/login/session-check (`/signup`, `/login`, `/me`), and a matching user's role is promoted
  to `moderator` and persisted the moment they next authenticate. This mirrors the "trust config,
  not an admin UI" approach `GEMINI_API_KEY`-style env vars already use elsewhere in this repo, and
  solves the bootstrapping problem of needing an existing moderator to grant the first one. It's
  promote-only: removing an email from the list doesn't revoke a role already granted.
- `POST /users/:id/role` lets any already-authenticated moderator promote or demote any other user
  by id — the first moderator still has to come from `MODERATOR_EMAILS`, but every moderator after
  that can be granted (or revoked) through this API instead of a direct DB update. `apps/web`'s
  `ModerationPanel` exposes this as a small "Moderator Access" form (enter a user id, grant or
  revoke) alongside the approve/reject queues. There's deliberately no floor stopping a moderator
  from demoting themselves or every other moderator — that's a self-inflicted mistake, not
  something worth defending against server-side.

As with everything else in this service, callers are expected to enforce anything role-gated
themselves by checking the `role` on the authenticated user — this service doesn't expose a
separate authorization check, and none of the other Stage 6 services validate it either. See
`@maker/community-library`'s README for how its moderation actions are currently gated on this.

## OAuth login (Google/GitHub/Discord)

`GET /oauth/:provider/start` redirects the browser to the provider's consent page (authorization
code + PKCE); the provider then redirects back to `GET /oauth/:provider/callback`, which exchanges
the code for the provider's user info, finds or creates the matching local user, and redirects the
browser to `WEB_APP_URL/#/oauth-callback?token=<session token>` (or `?error=...` if anything went
wrong, including the user declining consent). `apps/web`'s `OAuthCallbackPanel` picks the token up
from there.

Finding/creating the local user (`findOrCreateUserForOAuthIdentity`, `oauthIdentities.ts`) checks,
in order: an existing `oauth_identities` row for this exact `(provider, providerUserId)` pair (the
ordinary repeat-login case); otherwise a user with a matching email however they originally signed
up, which links this identity to that account (the provider is trusted to have verified the email
itself); otherwise a brand-new OAuth-only user (`password_hash` is nullable - such a user can only
ever sign in via the provider that created them, until they set a password via `POST /me/password`
above).

The `state` parameter carries its own PKCE `code_verifier` and an issue timestamp, HMAC-signed with
a secret generated once per server process - enough to detect tampering and expiry (10 minutes)
without a database table or an extra required env var, since it only needs to survive one browser
round trip within a single process's uptime.

**Connecting another provider from a signed-in session:** passing `?linkToken=<session token>` to
`GET /oauth/:provider/start` runs the same authorization-code + PKCE round trip, but with that
token's user id embedded (also HMAC-signed) in the `state` alongside the PKCE `code_verifier` - an
invalid/expired `linkToken` fails immediately with `401`, before ever redirecting to the provider.
On callback, `linkOAuthIdentityToUser` (`oauthIdentities.ts`) attaches the new identity directly to
that user id instead of running the ordinary find-or-create-by-email flow above, so it never matches
by email or creates a new user. The `(provider, providerUserId)` pair is still globally unique
(`oauth_identities`'s primary key), so linking an identity already linked to a different account
fails with a redirect `?error=...` the same way any other callback failure does. `apps/web`'s
`AuthPanel` exposes this as "Connect Google" / "Connect GitHub" / "Connect Discord" links for a
signed-in user, each carrying the current session token as `linkToken`.

**Testing note:** there's no way to register a real Google/GitHub/Discord OAuth app or reach any
provider's servers from this sandbox, so `test/oauth.test.ts` runs the exact same code path against
a tiny local fake HTTP provider (`test/fakeOAuthProvider.ts`) instead, via each provider's URL
override env vars (e.g. `GOOGLE_TOKEN_URL`, `GITHUB_API_BASE_URL`, `DISCORD_API_BASE_URL`) - real
PKCE/state validation, real token exchange, real account creation/linking, just pointed at
localhost instead of the real provider. What that can't cover is the real provider's own consent
screen and redirect behavior; a deployment enabling one needs to register a real OAuth app
(redirect URI `<ACCOUNTS_BASE_URL>/oauth/<provider>/callback`) and try the full round trip by hand
at least once.

## Password reset

`POST /password-reset/request` (`{ email }`) and `POST /password-reset/confirm`
(`{ token, password }`) let anyone who controls an email address set a new password for the
matching account - both for a forgotten password on an existing password account, and (doubling as
a way to gain password login without going through a provider) for an OAuth-only account that's
never had a password.

`requestPasswordReset` (`passwordReset.ts`) always responds the same way whether or not the email
is registered - it silently does nothing for an unknown email rather than a `404`, so this endpoint
can't be used to enumerate which emails have accounts. For a known email, it generates a random
token, stores only its SHA-256 hash (`password_reset_tokens`, mirroring how `sessions.ts` never
stores a session's plaintext token either), and emails a link built from `WEB_APP_URL` - `apps/web`'s
`ResetPasswordPanel` (`.../#/reset-password?token=...`) reads the token and posts the new password to
`confirm`.

`confirmPasswordReset` consumes the token with a single atomic `UPDATE ... WHERE used_at IS NULL AND
expires_at > now() RETURNING ...`, so two concurrent confirms with the same token can't both
succeed, and a token can only ever set one password. Tokens expire after 1 hour. A successful reset
also revokes every existing session for the account (`deleteSessionsForUser`, `sessions.ts`) - the
same moment someone regains control of an account via email is exactly when a leaked/shared session
token should stop working, rather than staying valid until it naturally expires. The new password is
still validated (length, etc.) _before_ the token is touched, so a bad password never burns a token
the caller could otherwise still use once they fix it.

Sending the actual email goes through `mailer.ts`'s `sendMail` - a single `POST` to a Resend-shaped
REST API (`MAIL_API_URL`, defaulting to `https://api.resend.com/emails`) with no SDK, the same plain-REST
style as `oauth.ts`'s provider calls. It fails fast (`MailerConfigError`) if `MAIL_API_KEY`/
`MAIL_FROM_ADDRESS` aren't set, matching every other external-service client in this repo (Stripe,
S3, OAuth, `GEMINI_API_KEY`).

**Testing note:** same rationale as `fakeOAuthProvider.ts` - there's no way to reach a real email
provider or use a real API key from this sandbox, so `test/fakeMailProvider.ts` is a tiny local HTTP
server standing in for Resend, pointed at via `MAIL_API_URL` in tests. `test/mailer.test.ts` and
`test/passwordReset.test.ts` exercise the real `sendMail`/token code paths against it.

## What's not here yet

- **Email verification** — a signup or OAuth login isn't currently required to have a verified
  email address beyond what the OAuth provider itself already checked; a password signup's email is
  trusted as given.
- **Providers beyond Google/GitHub/Discord** — `oauth.ts`'s `OAuthProvider` shape is
  provider-agnostic (any provider is just a new factory function keyed by name), but only these
  three are wired up.

## Testing note

Unlike `@maker/ai-inference` (which mocks the paid Gemini API), these tests run against a real
local Postgres database — free and reproducible, so there's no reason to mock it. Set
`DATABASE_URL` to a disposable database before running `bun test` (see "Local Postgres" above); CI
provides one via a `postgres:16` service container.
