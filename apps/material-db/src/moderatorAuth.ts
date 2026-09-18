/** Thrown when ACCOUNTS_URL is missing/blank - a deployment misconfiguration, not a bad request. */
export class AccountsConfigError extends Error {}

/** Thrown when @maker/accounts can't be reached or errors while verifying a role. */
export class ModeratorVerificationError extends Error {}

function accountsUrl(): string {
  const url = process.env.ACCOUNTS_URL;
  if (!url || url.trim().length === 0) {
    throw new AccountsConfigError(
      "Missing ACCOUNTS_URL environment variable. Set it to @maker/accounts's base URL " +
        "(e.g. http://localhost:8788) to enable moderator verification.",
    );
  }
  return url.replace(/\/$/, "");
}

/**
 * Calls @maker/accounts to verify reviewerId actually belongs to a user
 * with the "moderator" role - closing the gap this service's own README
 * used to document, where reviewerId was trusted as-is. Fails closed: a
 * network failure, a non-2xx/404 response, or a malformed body is treated
 * as "not verified" via a thrown ModeratorVerificationError, never
 * silently allowed through.
 */
export async function isModerator(reviewerId: string): Promise<boolean> {
  let response: Response;
  try {
    response = await fetch(`${accountsUrl()}/users/${reviewerId}/role`);
  } catch (err) {
    throw new ModeratorVerificationError(
      `Failed to reach @maker/accounts to verify moderator role: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  if (response.status === 404) return false;
  if (!response.ok) {
    throw new ModeratorVerificationError(
      `@maker/accounts responded with ${response.status} while verifying moderator role`,
    );
  }
  const body = (await response.json()) as { role?: unknown };
  return body.role === "moderator";
}
