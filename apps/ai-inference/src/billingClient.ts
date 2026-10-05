/** Thrown when BILLING_URL is missing/blank - a deployment misconfiguration, not a bad request. */
export class BillingConfigError extends Error {}

/** Thrown when @maker/billing can't be reached or errors while checking a plan tier or usage. */
export class BillingVerificationError extends Error {}

/** Thrown when a free-tier caller has already used up this month's AI request allowance. */
export class UsageQuotaExceededError extends Error {}

/**
 * Every Gemini-backed route (`/classify-material`, `/generate-image`,
 * `/suggest-palette`) shares one metric and one monthly allowance - there's
 * no reason to meter them separately, since what's being rationed is
 * exposure to the paid Gemini API itself, not any one feature of it.
 * `/depth-map` runs a vendored local model with no API key and no per-call
 * cost, so it's never metered.
 */
export const AI_USAGE_METRIC = "ai_requests";
const FREE_TIER_MONTHLY_LIMIT = 20;

function billingUrl(): string {
  const url = process.env.BILLING_URL;
  if (!url || url.trim().length === 0) {
    throw new BillingConfigError(
      "Missing BILLING_URL environment variable. Set it to @maker/billing's base URL " +
        "(e.g. http://localhost:8789) to enable usage-based access control.",
    );
  }
  return url.replace(/\/$/, "");
}

/**
 * Calls @maker/billing's `GET /subscription?userId=` to find out which plan
 * tier a user is on - the same `billingClient.ts` pattern
 * `@maker/cloud-projects` already uses. @maker/billing defaults an
 * unrecognized/absent subscription to `planTier: "free"` itself, so this
 * only ever throws `BillingVerificationError` when @maker/billing can't be
 * reached or errors - never for the ordinary "no subscription" case.
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

/** Calls @maker/billing's `GET /usage` for this calendar month's running total of `metric`. */
async function getMonthlyUsage(userId: string, metric: string): Promise<number> {
  let response: Response;
  try {
    response = await fetch(
      `${billingUrl()}/usage?userId=${encodeURIComponent(userId)}&metric=${encodeURIComponent(metric)}`,
    );
  } catch (err) {
    throw new BillingVerificationError(
      `Failed to reach @maker/billing to check usage: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  if (!response.ok) {
    throw new BillingVerificationError(
      `@maker/billing responded with ${response.status} while checking usage`,
    );
  }
  const body = (await response.json()) as { total?: unknown };
  return typeof body.total === "number" ? body.total : 0;
}

/** Calls @maker/billing's `POST /usage` to record one use of `metric` - this is what makes a
 * paid tier's AI usage show up as Stripe metered billing (see that service's README). */
export async function recordUsage(userId: string, metric: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${billingUrl()}/usage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, metric }),
    });
  } catch (err) {
    throw new BillingVerificationError(
      `Failed to reach @maker/billing to record usage: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  if (!response.ok) {
    throw new BillingVerificationError(
      `@maker/billing responded with ${response.status} while recording usage`,
    );
  }
}

/**
 * Rejects with `UsageQuotaExceededError` if `userId` is on the free tier and
 * has already made `FREE_TIER_MONTHLY_LIMIT` AI requests this calendar
 * month - paid tiers (`pro`/`studio`) have no cap here, since their AI usage
 * is billed through Stripe metering instead (see `recordUsage`). Call this
 * *before* making the actual Gemini call, so a caller already over quota
 * never spends budget on the real API; call `recordUsage` after the Gemini
 * call succeeds, not before, so a failed Gemini call never counts against
 * either the free-tier cap or a paid tier's metered bill.
 */
export async function enforceFreeTierQuota(userId: string, planTier: string): Promise<void> {
  if (planTier !== "free") return;
  const used = await getMonthlyUsage(userId, AI_USAGE_METRIC);
  if (used >= FREE_TIER_MONTHLY_LIMIT) {
    throw new UsageQuotaExceededError(
      `Free tier is limited to ${FREE_TIER_MONTHLY_LIMIT} AI requests per month (used ${used} ` +
        `already) - upgrade your plan for unlimited AI features.`,
    );
  }
}
