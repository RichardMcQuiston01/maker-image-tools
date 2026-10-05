import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import type { ObjectStore } from "../src/objectStorage.js";
import { recordListingImport } from "../src/imports.js";
import { approveListing, ListingNotFoundError, publishListing } from "../src/listings.js";
import {
  InvalidRatingInputError,
  ListingNotUsedError,
  listRatings,
  RatingRateLimitedError,
  rateListing,
  SelfRatingNotAllowedError,
} from "../src/ratings.js";
import { createFakeObjectStore } from "./fakeS3.js";
import { requireTestPool, resetTestDb, setupTestDb } from "./testDb.js";

// USER_1 owns every listing `approvedListing()` publishes below, so tests
// that rate a listing use USER_2/USER_3 - never USER_1 - now that
// self-rating is rejected.
const USER_1 = "11111111-1111-1111-1111-111111111111";
const USER_2 = "22222222-2222-2222-2222-222222222222";
const USER_3 = "44444444-4444-4444-4444-444444444444";
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

  /** Most tests here are about rating mechanics, not the verified-use gate itself (that gets its
   * own `describe` below) - this records the import rateListing now requires before delegating to
   * it, so the rest of this file reads the same as it did before that gate existed. */
  async function importAndRate(
    listingId: string,
    userId: string,
    stars: number,
    comment: string | undefined,
  ) {
    await recordListingImport(pool, listingId, userId);
    return rateListing(pool, listingId, userId, stars, comment);
  }

  it("records a rating and updates the listing's aggregate", async () => {
    const listing = await approvedListing();

    const result = await importAndRate(listing.id, USER_2, 4, "Nice design");
    expect(result.rating.stars).toBe(4);
    expect(result.rating.comment).toBe("Nice design");
    expect(result.listing.ratingAvg).toBe(4);
    expect(result.listing.ratingCount).toBe(1);
  });

  it("upserts on a repeat rating from the same user instead of adding a second row", async () => {
    const listing = await approvedListing();
    await importAndRate(listing.id, USER_2, 2, undefined);
    const second = await importAndRate(listing.id, USER_2, 5, "changed my mind");

    expect(second.listing.ratingCount).toBe(1);
    expect(second.listing.ratingAvg).toBe(5);
    expect(await listRatings(pool, listing.id)).toHaveLength(1);
  });

  it("averages across multiple distinct raters", async () => {
    const listing = await approvedListing();
    await importAndRate(listing.id, USER_2, 2, undefined);
    const result = await importAndRate(listing.id, USER_3, 4, undefined);

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
    await importAndRate(listing.id, USER_2, 3, "first");
    await importAndRate(listing.id, USER_3, 5, "second");

    const ratings = await listRatings(pool, listing.id);
    expect(ratings.map((r) => r.comment)).toEqual(["second", "first"]);
  });

  it("rejects rating your own listing", async () => {
    const listing = await approvedListing();
    await expect(rateListing(pool, listing.id, USER_1, 5, undefined)).rejects.toThrow(
      SelfRatingNotAllowedError,
    );
    expect(await listRatings(pool, listing.id)).toHaveLength(0);
  });

  describe("verified-use gating", () => {
    it("rejects rating a listing the user has never loaded", async () => {
      const listing = await approvedListing();
      await expect(rateListing(pool, listing.id, USER_2, 5, undefined)).rejects.toThrow(
        ListingNotUsedError,
      );
      expect(await listRatings(pool, listing.id)).toHaveLength(0);
    });

    it("allows rating once the listing has been imported", async () => {
      const listing = await approvedListing();
      await recordListingImport(pool, listing.id, USER_2);
      const result = await rateListing(pool, listing.id, USER_2, 5, undefined);
      expect(result.rating.stars).toBe(5);
    });

    it("checks verified-use before self-rating never applies, and before the rate limit", async () => {
      // Self-rating is still checked first - an owner gets that specific error, not "not used."
      const listing = await approvedListing();
      await expect(rateListing(pool, listing.id, USER_1, 5, undefined)).rejects.toThrow(
        SelfRatingNotAllowedError,
      );
    });
  });

  describe("rate limiting", () => {
    it("rejects a 21st distinct listing rated within the window", async () => {
      const listings = await Promise.all(Array.from({ length: 20 }, () => approvedListing()));
      for (const listing of listings) {
        await importAndRate(listing.id, USER_2, 5, undefined);
      }

      const oneMore = await approvedListing();
      await recordListingImport(pool, oneMore.id, USER_2);
      await expect(rateListing(pool, oneMore.id, USER_2, 5, undefined)).rejects.toThrow(
        RatingRateLimitedError,
      );
    });

    it("doesn't count re-rating an already-touched listing against the limit", async () => {
      const listings = await Promise.all(Array.from({ length: 20 }, () => approvedListing()));
      for (const listing of listings) {
        await importAndRate(listing.id, USER_2, 5, undefined);
      }

      // Already at the 20-listing limit, but updating a rating for a listing
      // already touched in this window isn't reaching for new listings.
      const updated = await rateListing(pool, listings[0]!.id, USER_2, 3, "changed my mind");
      expect(updated.rating.stars).toBe(3);
    });

    it("doesn't count another user's rating activity against this user's limit", async () => {
      const listings = await Promise.all(Array.from({ length: 20 }, () => approvedListing()));
      for (const listing of listings) {
        await importAndRate(listing.id, USER_2, 5, undefined);
      }

      const oneMore = await approvedListing();
      const result = await importAndRate(oneMore.id, USER_3, 4, undefined);
      expect(result.rating.stars).toBe(4);
    });
  });
});
