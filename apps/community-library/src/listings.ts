import type { Pool } from "pg";
import {
  deleteListingData,
  getListingData,
  listingStorageKey,
  putListingData,
  type ObjectStore,
} from "./objectStorage.js";

export type ListingStatus = "pending" | "approved" | "rejected";

export interface ListingSummary {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  tags: string[];
  status: ListingStatus;
  ratingAvg: number;
  ratingCount: number;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Listing extends ListingSummary {
  data: unknown;
}

export interface ListingRow {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  tags: string[];
  status: ListingStatus;
  rating_avg: string;
  rating_count: number;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  review_notes: string | null;
  created_at: Date;
  updated_at: Date;
}

/** Exported for ratings.ts, which updates and re-reads this same row shape within its own transaction. */
export function toListingSummary(row: ListingRow): ListingSummary {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    description: row.description,
    tags: row.tags,
    status: row.status,
    ratingAvg: Number(row.rating_avg),
    ratingCount: row.rating_count,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at ? row.reviewed_at.toISOString() : null,
    reviewNotes: row.review_notes,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/** Thrown for caller-supplied listing fields that fail basic validation. */
export class InvalidListingInputError extends Error {}

/** Thrown when a listing doesn't exist, or isn't owned by the calling user for an owner-only action. */
export class ListingNotFoundError extends Error {}

/** Thrown when approving/rejecting a listing that's already been reviewed. */
export class ListingNotPendingError extends Error {}

export interface ListingSubmission {
  userId: string;
  title: string;
  description?: string | undefined;
  tags?: string[] | undefined;
  data: unknown;
}

function validateSubmission(input: ListingSubmission): void {
  if (input.title.trim().length === 0) {
    throw new InvalidListingInputError('"title" must be a non-empty string');
  }
  if (input.data === undefined) {
    throw new InvalidListingInputError('"data" is required');
  }
  if (input.tags?.some((tag) => typeof tag !== "string" || tag.trim().length === 0)) {
    throw new InvalidListingInputError('"tags" must be an array of non-empty strings');
  }
}

function normalizeTags(tags: string[] | undefined): string[] {
  return [...new Set((tags ?? []).map((tag) => tag.trim().toLowerCase()))];
}

/** Publishes a new listing, starting out `pending` review. */
export async function publishListing(
  pool: Pool,
  store: ObjectStore,
  input: ListingSubmission,
): Promise<Listing> {
  validateSubmission(input);
  const tags = normalizeTags(input.tags);

  const { rows } = await pool.query<ListingRow>(
    `INSERT INTO listings (user_id, title, description, tags) VALUES ($1, $2, $3, $4) RETURNING *`,
    [input.userId, input.title, input.description ?? null, tags],
  );
  const row = rows[0]!;
  await putListingData(store, listingStorageKey(row.id), input.data);
  return { ...toListingSummary(row), data: input.data };
}

export interface ListingSearch {
  q?: string | undefined;
  tag?: string | undefined;
  sort?: "newest" | "rating" | undefined;
}

/**
 * Approved listings only, matching the search/browse filters - summaries,
 * no `data`. `q` is matched against `search_vector` (see migration
 * 002_fulltext_search.sql) via `websearch_to_tsquery`, which supports the
 * query syntax a public search box's users already expect (quoted phrases,
 * `-exclude`, `or`) - unlike the plain substring match this replaced, word
 * order in the query no longer has to match the listing's text.
 */
export async function listListings(pool: Pool, search: ListingSearch): Promise<ListingSummary[]> {
  const q = search.q?.trim() || null;
  const tag = search.tag ? search.tag.trim().toLowerCase() : null;
  const orderBy =
    search.sort === "rating" ? "rating_avg DESC, rating_count DESC" : "created_at DESC";

  const { rows } = await pool.query<ListingRow>(
    `SELECT * FROM listings
     WHERE status = 'approved'
       AND ($1::text IS NULL OR search_vector @@ websearch_to_tsquery('english', $1))
       AND ($2::text IS NULL OR $2 = ANY(tags))
     ORDER BY ${orderBy}`,
    [q, tag],
  );
  return rows.map(toListingSummary);
}

async function findListingRow(pool: Pool, id: string): Promise<ListingRow> {
  const { rows } = await pool.query<ListingRow>(`SELECT * FROM listings WHERE id = $1`, [id]);
  const row = rows[0];
  if (!row) {
    throw new ListingNotFoundError(`No listing "${id}"`);
  }
  return row;
}

/** A single listing including its `data` - visible regardless of status (moderators and the
 * submitter need to see pending/rejected listings too; there's no separate private-vs-public view). */
export async function getListing(pool: Pool, store: ObjectStore, id: string): Promise<Listing> {
  const row = await findListingRow(pool, id);
  const data = await getListingData(store, listingStorageKey(row.id));
  return { ...toListingSummary(row), data };
}

export async function deleteListing(
  pool: Pool,
  store: ObjectStore,
  userId: string,
  id: string,
): Promise<void> {
  const { rows } = await pool.query<ListingRow>(
    `SELECT * FROM listings WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
  const row = rows[0];
  if (!row) {
    throw new ListingNotFoundError(`No listing "${id}" for this user`);
  }
  await pool.query("DELETE FROM listings WHERE id = $1", [row.id]);
  await deleteListingData(store, listingStorageKey(row.id));
}

/** Submissions awaiting moderation, oldest first. */
export async function listPendingListings(pool: Pool): Promise<ListingSummary[]> {
  const { rows } = await pool.query<ListingRow>(
    `SELECT * FROM listings WHERE status = 'pending' ORDER BY created_at ASC`,
  );
  return rows.map(toListingSummary);
}

async function findPendingListing(pool: Pool, id: string): Promise<ListingRow> {
  const row = await findListingRow(pool, id);
  if (row.status !== "pending") {
    throw new ListingNotPendingError(`Listing "${id}" has already been reviewed (${row.status})`);
  }
  return row;
}

async function reviewListing(
  pool: Pool,
  id: string,
  status: "approved" | "rejected",
  reviewerId: string,
  notes: string | undefined,
): Promise<ListingSummary> {
  await findPendingListing(pool, id);
  const { rows } = await pool.query<ListingRow>(
    `UPDATE listings SET status = $1, reviewed_by = $2, reviewed_at = now(), review_notes = $3, updated_at = now()
     WHERE id = $4 RETURNING *`,
    [status, reviewerId, notes ?? null, id],
  );
  return toListingSummary(rows[0]!);
}

export async function approveListing(
  pool: Pool,
  id: string,
  reviewerId: string,
  notes?: string,
): Promise<ListingSummary> {
  return reviewListing(pool, id, "approved", reviewerId, notes);
}

export async function rejectListing(
  pool: Pool,
  id: string,
  reviewerId: string,
  notes?: string,
): Promise<ListingSummary> {
  return reviewListing(pool, id, "rejected", reviewerId, notes);
}
