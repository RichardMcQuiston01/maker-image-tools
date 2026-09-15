import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import type { ObjectStore } from "../src/objectStorage.js";
import {
  approveListing,
  deleteListing,
  getListing,
  InvalidListingInputError,
  listListings,
  ListingNotFoundError,
  ListingNotPendingError,
  listPendingListings,
  publishListing,
  rejectListing,
} from "../src/listings.js";
import { createFakeObjectStore } from "./fakeS3.js";
import { requireTestPool, resetTestDb, setupTestDb } from "./testDb.js";

// apps/accounts assigns real users a Postgres-generated UUID; `user_id` here
// is typed as UUID to match, so tests use UUID-shaped literals too.
const USER_1 = "11111111-1111-1111-1111-111111111111";
const USER_2 = "22222222-2222-2222-2222-222222222222";
const REVIEWER = "33333333-3333-3333-3333-333333333333";

function baseSubmission(overrides: Partial<Parameters<typeof publishListing>[2]> = {}) {
  return {
    userId: USER_1,
    title: "Keychain Fox",
    description: "A laser-cut fox keychain",
    tags: ["Keychain", "Animal"],
    data: { layers: [] },
    ...overrides,
  };
}

describe("listings", () => {
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

  describe("publishListing", () => {
    it("creates a pending listing with normalized, deduped tags", async () => {
      const listing = await publishListing(
        pool,
        store,
        baseSubmission({ tags: ["Keychain", "keychain ", "Animal"] }),
      );
      expect(listing.status).toBe("pending");
      expect(listing.tags).toEqual(["keychain", "animal"]);
      expect(listing.data).toEqual({ layers: [] });
      expect(listing.ratingAvg).toBe(0);
      expect(listing.ratingCount).toBe(0);
    });

    it("rejects a blank title", async () => {
      await expect(publishListing(pool, store, baseSubmission({ title: "  " }))).rejects.toThrow(
        InvalidListingInputError,
      );
    });

    it("rejects missing data", async () => {
      await expect(
        publishListing(pool, store, baseSubmission({ data: undefined })),
      ).rejects.toThrow(InvalidListingInputError);
    });

    it("rejects a blank tag", async () => {
      await expect(publishListing(pool, store, baseSubmission({ tags: [""] }))).rejects.toThrow(
        InvalidListingInputError,
      );
    });
  });

  describe("listListings", () => {
    it("only returns approved listings", async () => {
      const pending = await publishListing(pool, store, baseSubmission());
      expect(await listListings(pool, {})).toEqual([]);

      await approveListing(pool, pending.id, REVIEWER);
      const results = await listListings(pool, {});
      expect(results).toHaveLength(1);
      expect(results[0]!.status).toBe("approved");
    });

    it("filters by search text and tag", async () => {
      const fox = await publishListing(pool, store, baseSubmission());
      await approveListing(pool, fox.id, REVIEWER);
      const box = await publishListing(
        pool,
        store,
        baseSubmission({
          title: "Storage Box",
          description: "A cardboard box joint container",
          tags: ["box"],
        }),
      );
      await approveListing(pool, box.id, REVIEWER);

      expect((await listListings(pool, { q: "fox" })).map((l) => l.title)).toEqual([
        "Keychain Fox",
      ]);
      expect((await listListings(pool, { tag: "box" })).map((l) => l.title)).toEqual([
        "Storage Box",
      ]);
    });

    it("sorts by rating when requested", async () => {
      const low = await publishListing(pool, store, baseSubmission({ title: "Low rated" }));
      await approveListing(pool, low.id, REVIEWER);
      const high = await publishListing(pool, store, baseSubmission({ title: "High rated" }));
      await approveListing(pool, high.id, REVIEWER);

      await pool.query("UPDATE listings SET rating_avg = 2 WHERE id = $1", [low.id]);
      await pool.query("UPDATE listings SET rating_avg = 5 WHERE id = $1", [high.id]);

      const results = await listListings(pool, { sort: "rating" });
      expect(results.map((l) => l.title)).toEqual(["High rated", "Low rated"]);
    });
  });

  describe("getListing", () => {
    it("returns a listing regardless of status", async () => {
      const listing = await publishListing(pool, store, baseSubmission());
      const fetched = await getListing(pool, store, listing.id);
      expect(fetched.data).toEqual({ layers: [] });
      expect(fetched.status).toBe("pending");
    });

    it("throws ListingNotFoundError for an unknown id", async () => {
      await expect(getListing(pool, store, "00000000-0000-0000-0000-000000000000")).rejects.toThrow(
        ListingNotFoundError,
      );
    });
  });

  describe("deleteListing", () => {
    it("deletes a listing's row and its stored data, owner-only", async () => {
      const listing = await publishListing(pool, store, baseSubmission());
      await expect(deleteListing(pool, store, USER_2, listing.id)).rejects.toThrow(
        ListingNotFoundError,
      );

      await deleteListing(pool, store, USER_1, listing.id);
      await expect(getListing(pool, store, listing.id)).rejects.toThrow(ListingNotFoundError);
    });
  });

  describe("moderation", () => {
    it("lists only pending listings, oldest first", async () => {
      const first = await publishListing(pool, store, baseSubmission());
      const second = await publishListing(pool, store, baseSubmission({ title: "Second" }));
      await approveListing(pool, first.id, REVIEWER);

      const pending = await listPendingListings(pool);
      expect(pending.map((l) => l.id)).toEqual([second.id]);
    });

    it("approves and rejects, recording the reviewer", async () => {
      const listing = await publishListing(pool, store, baseSubmission());
      const approved = await approveListing(pool, listing.id, REVIEWER, "looks good");
      expect(approved.status).toBe("approved");
      expect(approved.reviewedBy).toBe(REVIEWER);
      expect(approved.reviewNotes).toBe("looks good");

      const listing2 = await publishListing(pool, store, baseSubmission({ title: "Another" }));
      const rejected = await rejectListing(pool, listing2.id, REVIEWER, "low effort");
      expect(rejected.status).toBe("rejected");
      expect(rejected.reviewNotes).toBe("low effort");
    });

    it("throws ListingNotPendingError when re-reviewing", async () => {
      const listing = await publishListing(pool, store, baseSubmission());
      await approveListing(pool, listing.id, REVIEWER);
      await expect(approveListing(pool, listing.id, REVIEWER)).rejects.toThrow(
        ListingNotPendingError,
      );
    });
  });
});
