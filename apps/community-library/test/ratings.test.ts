import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import type { ObjectStore } from "../src/objectStorage.js";
import { approveListing, ListingNotFoundError, publishListing } from "../src/listings.js";
import { InvalidRatingInputError, listRatings, rateListing } from "../src/ratings.js";
import { createFakeObjectStore } from "./fakeS3.js";
import { requireTestPool, resetTestDb, setupTestDb } from "./testDb.js";

const USER_1 = "11111111-1111-1111-1111-111111111111";
const USER_2 = "22222222-2222-2222-2222-222222222222";
const REVIEWER = "33333333-3333-3333-3333-333333333333";

describe("ratings", () => {
  let pool: Pool;
  let store: ObjectStore;

  beforeAll(async () => {
    pool = requireTestPool();
    await setupTestDb(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await resetTestDb(pool);
    store = createFakeObjectStore();
  });

  async function approvedListing() {
    const listing = await publishListing(pool, store, {
      userId: USER_1,
      title: "Keychain Fox",
      data: { layers: [] },
    });
    return approveListing(pool, listing.id, REVIEWER);
  }

  it("records a rating and updates the listing's aggregate", async () => {
    const listing = await approvedListing();

    const result = await rateListing(pool, listing.id, USER_2, 4, "Nice design");
    expect(result.rating.stars).toBe(4);
    expect(result.rating.comment).toBe("Nice design");
    expect(result.listing.ratingAvg).toBe(4);
    expect(result.listing.ratingCount).toBe(1);
  });

  it("upserts on a repeat rating from the same user instead of adding a second row", async () => {
    const listing = await approvedListing();
    await rateListing(pool, listing.id, USER_2, 2, undefined);
    const second = await rateListing(pool, listing.id, USER_2, 5, "changed my mind");

    expect(second.listing.ratingCount).toBe(1);
    expect(second.listing.ratingAvg).toBe(5);
    expect(await listRatings(pool, listing.id)).toHaveLength(1);
  });

  it("averages across multiple distinct raters", async () => {
    const listing = await approvedListing();
    await rateListing(pool, listing.id, USER_1, 2, undefined);
    const result = await rateListing(pool, listing.id, USER_2, 4, undefined);

    expect(result.listing.ratingCount).toBe(2);
    expect(result.listing.ratingAvg).toBe(3);
  });

  it("rejects stars outside 1-5", async () => {
    const listing = await approvedListing();
    await expect(rateListing(pool, listing.id, USER_2, 0, undefined)).rejects.toThrow(
      InvalidRatingInputError,
    );
    await expect(rateListing(pool, listing.id, USER_2, 6, undefined)).rejects.toThrow(
      InvalidRatingInputError,
    );
    await expect(rateListing(pool, listing.id, USER_2, 3.5, undefined)).rejects.toThrow(
      InvalidRatingInputError,
    );
  });

  it("throws ListingNotFoundError for an unknown listing", async () => {
    await expect(
      rateListing(pool, "00000000-0000-0000-0000-000000000000", USER_2, 5, undefined),
    ).rejects.toThrow(ListingNotFoundError);
  });

  it("lists ratings newest first", async () => {
    const listing = await approvedListing();
    await rateListing(pool, listing.id, USER_1, 3, "first");
    await rateListing(pool, listing.id, USER_2, 5, "second");

    const ratings = await listRatings(pool, listing.id);
    expect(ratings.map((r) => r.comment)).toEqual(["second", "first"]);
  });
});
