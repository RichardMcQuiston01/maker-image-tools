/** Thrown when ACCOUNTS_URL is missing/blank - a deployment misconfiguration, not a bad request. */
export class AccountsConfigError extends Error {}

/** Thrown when @maker/accounts can't be reached or errors while verifying a session. */
export class SessionVerificationError extends Error {}

function accountsUrl(): string {
  const url = process.env.ACCOUNTS_URL;
  if (!url || url.trim().length === 0) {
    throw new AccountsConfigError(
      "Missing ACCOUNTS_URL environment variable. Set it to @maker/accounts's base URL " +
        "(e.g. http://localhost:8788) to enable session verification.",
    );
  }
  return url.replace(/\/$/, "");
}

/**
 * Calls @maker/accounts's `GET /me` with the caller's bearer token to find
 * out which user it belongs to - this is what closes the "any caller that
 * knows a userId can act as that user" gap this service's own README used
 * to document, the same way `moderatorAuth.ts`'s `isModerator` closed a
 * similar gap for `@maker/community-library`/`@maker/material-db`. Returns
 * `undefined` for a missing/invalid/expired token (an ordinary
 * unauthenticated-caller outcome, not an error); throws
 * `SessionVerificationError` only when @maker/accounts itself can't be
 * reached or errors, so that's never silently treated as "not signed in".
 */
export async function verifySession(token: string): Promise<string | undefined> {
  let response: Response;
  try {
    response = await fetch(`${accountsUrl()}/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (err) {
    throw new SessionVerificationError(
      `Failed to reach @maker/accounts to verify session: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  if (response.status === 401) return undefined;
  if (!response.ok) {
    throw new SessionVerificationError(
      `@maker/accounts responded with ${response.status} while verifying session`,
    );
  }
  const body = (await response.json()) as { user?: { id?: unknown } };
  return typeof body.user?.id === "string" ? body.user.id : undefined;
}
