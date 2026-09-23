import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { approvePreset, submitPreset } from "../src/presets.js";
import {
  InvalidVoteValueError,
  PresetNotApprovedError,
  removeVote,
  SelfVoteNotAllowedError,
  voteOnPreset,
} from "../src/votes.js";
import { requireTestPool, resetTestDb, setupTestDb } from "./testDb.js";

const SUBMITTER = "11111111-1111-1111-1111-111111111111";
const REVIEWER = "22222222-2222-2222-2222-222222222222";
const VOTER_1 = "33333333-3333-3333-3333-333333333333";
const VOTER_2 = "44444444-4444-4444-4444-444444444444";

function baseSubmission() {
  return {
    userId: SUBMITTER,
    material: "Baltic Birch Plywood 3mm",
    machineType: "diode-laser",
    operation: "cut",
    speed: 300,
    power: 950,
  };
}

describe("votes", () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = requireTestPool();
    await setupTestDb(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await resetTestDb(pool);
  });

  async function approvedPreset() {
    const preset = await submitPreset(pool, baseSubmission());
    return approvePreset(pool, preset.id, REVIEWER);
  }

  it("upvotes a preset", async () => {
    const preset = await approvedPreset();
    const voted = await voteOnPreset(pool, preset.id, VOTER_1, 1);
    expect(voted.upvotes).toBe(1);
    expect(voted.downvotes).toBe(0);
  });

  it("downvotes a preset", async () => {
    const preset = await approvedPreset();
    const voted = await voteOnPreset(pool, preset.id, VOTER_1, -1);
    expect(voted.upvotes).toBe(0);
    expect(voted.downvotes).toBe(1);
  });

  it("changes an existing vote instead of adding a second one", async () => {
    const preset = await approvedPreset();
    await voteOnPreset(pool, preset.id, VOTER_1, 1);
    const changed = await voteOnPreset(pool, preset.id, VOTER_1, -1);
    expect(changed.upvotes).toBe(0);
    expect(changed.downvotes).toBe(1);
  });

  it("tallies votes across multiple distinct voters", async () => {
    const preset = await approvedPreset();
    await voteOnPreset(pool, preset.id, VOTER_1, 1);
    const result = await voteOnPreset(pool, preset.id, VOTER_2, 1);
    expect(result.upvotes).toBe(2);
    expect(result.downvotes).toBe(0);
  });

  it("rejects an invalid vote value", async () => {
    const preset = await approvedPreset();
    await expect(voteOnPreset(pool, preset.id, VOTER_1, 0)).rejects.toThrow(InvalidVoteValueError);
    await expect(voteOnPreset(pool, preset.id, VOTER_1, 2)).rejects.toThrow(InvalidVoteValueError);
  });

  it("rejects the submitter voting on their own preset", async () => {
    const preset = await approvedPreset();
    await expect(voteOnPreset(pool, preset.id, SUBMITTER, 1)).rejects.toThrow(
      SelfVoteNotAllowedError,
    );
  });

  it("rejects voting on a preset that isn't approved yet", async () => {
    const preset = await submitPreset(pool, baseSubmission());
    await expect(voteOnPreset(pool, preset.id, VOTER_1, 1)).rejects.toThrow(PresetNotApprovedError);
  });

  it("removes a vote", async () => {
    const preset = await approvedPreset();
    await voteOnPreset(pool, preset.id, VOTER_1, 1);
    const result = await removeVote(pool, preset.id, VOTER_1);
    expect(result.upvotes).toBe(0);
    expect(result.downvotes).toBe(0);
  });

  it("is idempotent - removing a vote that was never cast is a no-op", async () => {
    const preset = await approvedPreset();
    const result = await removeVote(pool, preset.id, VOTER_1);
    expect(result.upvotes).toBe(0);
    expect(result.downvotes).toBe(0);
  });

  it("doesn't count another user's vote removal against this user's tally", async () => {
    const preset = await approvedPreset();
    await voteOnPreset(pool, preset.id, VOTER_1, 1);
    await voteOnPreset(pool, preset.id, VOTER_2, 1);
    const result = await removeVote(pool, preset.id, VOTER_1);
    expect(result.upvotes).toBe(1);
  });
});
