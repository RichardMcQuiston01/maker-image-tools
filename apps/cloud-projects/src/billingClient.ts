/** Thrown when BILLING_URL is missing/blank - a deployment misconfiguration, not a bad request. */
export class BillingConfigError extends Error {}

/** Thrown when @maker/billing can't be reached or errors while checking a plan tier. */
export class BillingVerificationError extends Error {}

function billingUrl(): string {
  const url = process.env.BILLING_URL;
  if (!url || url.trim().length === 0) {
    throw new BillingConfigError(
      "Missing BILLING_URL environment variable. Set it to @maker/billing's base URL " +
        "(e.g. http://localhost:8789) to enable quota enforcement.",
    );
  }
  return url.replace(/\/$/, "");
}

/**
 * Calls @maker/billing's `GET /subscription?userId=` to find out which plan
 * tier a user is on, so `quotas.ts`'s limits can be enforced against it.
 * @maker/billing defaults an unrecognized/absent subscription to
 * `planTier: "free"` itself, so this only ever throws
 * `BillingVerificationError` when @maker/billing can't be reached or errors -
 * never for the ordinary "no subscription" case.
 */
export async function getPlanTier(userId: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`${billingUrl()}/subscription?userId=${encodeURIComponent(userId)}`);
  } catch (err) {
    throw new BillingVerificationError(
      `Failed to reach @maker/billing to check plan tier: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  if (!response.ok) {
    throw new BillingVerificationError(
      `@maker/billing responded with ${response.status} while checking plan tier`,
    );
  }
  const body = (await response.json()) as { planTier?: unknown };
  return typeof body.planTier === "string" ? body.planTier : "free";
}
