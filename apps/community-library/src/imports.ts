import type { Pool } from "pg";
import { ListingNotFoundError } from "./listings.js";

/**
 * Records that `userId` has loaded `listingId`'s design into the editor -
 * `ratings.ts`'s `rateListing` checks for a row here before allowing a
 * rating (see "Rating abuse handling" in the README). Idempotent: loading a
 * design you've already loaded again doesn't error or create a second row,
 * it just leaves the existing one in place.
 */
export async function recordListingImport(
  pool: Pool,
  listingId: string,
  userId: string,
): Promise<void> {
  const { rowCount } = await pool.query(`SELECT 1 FROM listings WHERE id = $1`, [listingId]);
  if (rowCount === 0) {
    throw new ListingNotFoundError(`No listing "${listingId}"`);
  }
  await pool.query(
    `INSERT INTO listing_imports (listing_id, user_id) VALUES ($1, $2)
     ON CONFLICT (listing_id, user_id) DO NOTHING`,
    [listingId, userId],
  );
}

export async function hasImportedListing(
  pool: Pool,
  listingId: string,
  userId: string,
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `SELECT 1 FROM listing_imports WHERE listing_id = $1 AND user_id = $2`,
    [listingId, userId],
  );
  return (rowCount ?? 0) > 0;
}
