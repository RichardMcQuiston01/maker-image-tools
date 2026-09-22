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

/** Thrown when a listing's own submitter tries to rate it - rating your own listing to inflate its score is the obvious abuse case a same-user check closes. */
export class SelfRatingNotAllowedError extends Error {}

/** Thrown when a user has rated too many distinct listings too recently - see RATE_LIMIT_* below. */
export class RatingRateLimitedError extends Error {}

/**
 * A user may touch at most this many *other* listings' ratings within
 * RATE_LIMIT_WINDOW - re-rating a listing they've already rated inside the
 * window never counts against this (see the `listing_id != $2` exclusion
 * below), so this throttles how many listings a single identity can sway
 * in a burst (brigading a set of listings up or down), without penalizing
 * someone changing their mind about one rating repeatedly.
 */
const RATE_LIMIT_MAX_OTHER_LISTINGS = 20;
const RATE_LIMIT_WINDOW = "10 minutes";

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
    const listingRow = listingRows[0];
    if (!listingRow) {
      throw new ListingNotFoundError(`No listing "${listingId}"`);
    }
    if (listingRow.user_id === userId) {
      throw new SelfRatingNotAllowedError("You can't rate your own listing");
    }

    const { rows: recentRows } = await client.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM ratings
       WHERE user_id = $1 AND listing_id != $2 AND updated_at >= now() - $3::interval`,
      [userId, listingId, RATE_LIMIT_WINDOW],
    );
    if (Number(recentRows[0]!.count) >= RATE_LIMIT_MAX_OTHER_LISTINGS) {
      throw new RatingRateLimitedError(
        `Too many ratings submitted recently - try again in a few minutes`,
      );
    }

    const { rows: ratingRows } = await client.query<RatingRow>(
      `INSERT INTO ratings (listing_id, user_id, stars, comment)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (listing_id, user_id)
       DO UPDATE SET stars = EXCLUDED.stars, comment = EXCLUDED.comment, updated_at = now()
       RETURNING *`,
      [listingId, userId, stars, comment ?? null],
    );
    const updatedListingRow = await recomputeListingAggregate(client, listingId);
    await client.query("COMMIT");
    return { rating: toRating(ratingRows[0]!), listing: toListingSummary(updatedListingRow) };
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
