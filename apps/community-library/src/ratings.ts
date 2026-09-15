import type { Pool, PoolClient } from "pg";
import {
  ListingNotFoundError,
  toListingSummary,
  type ListingRow,
  type ListingSummary,
} from "./listings.js";

export interface Rating {
  id: string;
  listingId: string;
  userId: string;
  stars: number;
  comment: string | null;
  createdAt: string;
  updatedAt: string;
}

interface RatingRow {
  id: string;
  listing_id: string;
  user_id: string;
  stars: number;
  comment: string | null;
  created_at: Date;
  updated_at: Date;
}

function toRating(row: RatingRow): Rating {
  return {
    id: row.id,
    listingId: row.listing_id,
    userId: row.user_id,
    stars: row.stars,
    comment: row.comment,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/** Thrown for a caller-supplied `stars` outside 1-5. */
export class InvalidRatingInputError extends Error {}

async function recomputeListingAggregate(
  client: PoolClient,
  listingId: string,
): Promise<ListingRow> {
  const { rows } = await client.query<ListingRow>(
    `UPDATE listings SET
       rating_avg = (SELECT COALESCE(AVG(stars), 0) FROM ratings WHERE listing_id = $1),
       rating_count = (SELECT COUNT(*) FROM ratings WHERE listing_id = $1),
       updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [listingId],
  );
  return rows[0]!;
}

/**
 * Records (or updates) one user's rating for a listing - one rating per
 * (listing, user) pair, upserted - then recomputes the listing's
 * denormalized `ratingAvg`/`ratingCount` in the same transaction so browse
 * queries never need a live aggregate join.
 */
export async function rateListing(
  pool: Pool,
  listingId: string,
  userId: string,
  stars: number,
  comment: string | undefined,
): Promise<{ rating: Rating; listing: ListingSummary }> {
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
    throw new InvalidRatingInputError('"stars" must be an integer from 1 to 5');
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: listingRows } = await client.query<ListingRow>(
      `SELECT * FROM listings WHERE id = $1 FOR UPDATE`,
      [listingId],
    );
    if (!listingRows[0]) {
      throw new ListingNotFoundError(`No listing "${listingId}"`);
    }

    const { rows: ratingRows } = await client.query<RatingRow>(
      `INSERT INTO ratings (listing_id, user_id, stars, comment)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (listing_id, user_id)
       DO UPDATE SET stars = EXCLUDED.stars, comment = EXCLUDED.comment, updated_at = now()
       RETURNING *`,
      [listingId, userId, stars, comment ?? null],
    );
    const listingRow = await recomputeListingAggregate(client, listingId);
    await client.query("COMMIT");
    return { rating: toRating(ratingRows[0]!), listing: toListingSummary(listingRow) };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function listRatings(pool: Pool, listingId: string): Promise<Rating[]> {
  const { rows } = await pool.query<RatingRow>(
    `SELECT * FROM ratings WHERE listing_id = $1 ORDER BY created_at DESC`,
    [listingId],
  );
  return rows.map(toRating);
}
