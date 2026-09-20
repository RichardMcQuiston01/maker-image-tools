/** Per-plan-tier limits on a user's saved projects. */
export interface PlanQuota {
  /** Max number of projects a user on this tier can have at once. */
  maxProjects: number;
  /** Max combined size, in bytes, of all of a user's projects' `data` payloads. */
  maxTotalBytes: number;
}

const MB = 1024 * 1024;

/**
 * The only two tiers `@maker/billing` currently sells (see its `plans.ts`) -
 * `free` is the default `@maker/accounts` assigns every new user, and is
 * also the fallback below for any plan tier this map doesn't recognize
 * (never trust an unrecognized tier as unlimited or as a paid tier's
 * quota).
 */
const QUOTAS: Record<string, PlanQuota> = {
  free: { maxProjects: 10, maxTotalBytes: 5 * MB },
  pro: { maxProjects: 200, maxTotalBytes: 250 * MB },
};

export function quotaForPlanTier(planTier: string): PlanQuota {
  return QUOTAS[planTier] ?? QUOTAS.free!;
}
