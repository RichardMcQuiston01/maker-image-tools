import { describe, expect, it } from "vitest";
import { quotaForPlanTier } from "../src/quotas.js";

describe("quotaForPlanTier", () => {
  it("returns the free tier's limits for 'free'", () => {
    expect(quotaForPlanTier("free")).toEqual({ maxProjects: 10, maxTotalBytes: 5 * 1024 * 1024 });
  });

  it("returns the pro tier's higher limits for 'pro'", () => {
    const quota = quotaForPlanTier("pro");
    expect(quota.maxProjects).toBeGreaterThan(quotaForPlanTier("free").maxProjects);
    expect(quota.maxTotalBytes).toBeGreaterThan(quotaForPlanTier("free").maxTotalBytes);
  });

  it("falls back to the free tier's limits for an unrecognized plan tier", () => {
    expect(quotaForPlanTier("not-a-real-tier")).toEqual(quotaForPlanTier("free"));
  });
});
