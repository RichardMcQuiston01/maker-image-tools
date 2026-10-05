import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import type { ObjectStore } from "../src/objectStorage.js";
import { hasImportedListing, recordListingImport } from "../src/imports.js";
import { ListingNotFoundError, publishListing } from "../src/listings.js";
import { createFakeObjectStore } from "./fakeS3.js";
import { requireTestPool, resetTestDb, setupTestDb } from "./testDb.js";

const USER_1 = "11111111-1111-1111-1111-111111111111";
const USER_2 = "22222222-2222-2222-2222-222222222222";

describe("imports", () => {
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

  async function listing() {
    return publishListing(pool, store, { userId: USER_1, title: "Keychain Fox", data: {} });
  }

  it("records that a user has imported a listing", async () => {
    const created = await listing();
    expect(await hasImportedListing(pool, created.id, USER_2)).toBe(false);

    await recordListingImport(pool, created.id, USER_2);
    expect(await hasImportedListing(pool, created.id, USER_2)).toBe(true);
  });

  it("is idempotent - importing the same listing twice doesn't error", async () => {
    const created = await listing();
    await recordListingImport(pool, created.id, USER_2);
    await recordListingImport(pool, created.id, USER_2);
    expect(await hasImportedListing(pool, created.id, USER_2)).toBe(true);
  });

  it("tracks imports per user independently", async () => {
    const created = await listing();
    await recordListingImport(pool, created.id, USER_2);
    expect(await hasImportedListing(pool, created.id, USER_1)).toBe(false);
  });

  it("throws ListingNotFoundError for an unknown listing", async () => {
    await expect(
      recordListingImport(pool, "00000000-0000-0000-0000-000000000000", USER_2),
    ).rejects.toThrow(ListingNotFoundError);
  });
});
