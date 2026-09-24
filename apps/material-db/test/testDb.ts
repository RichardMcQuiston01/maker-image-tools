import { Pool } from "pg";
import { runMigrations } from "../src/db.js";

/**
 * These tests run against a real Postgres database (no mocking - there's no
 * paid external dependency in this service, unlike @maker/billing's Stripe
 * or @maker/cloud-projects' S3, so there's nothing to fake). Point
 * DATABASE_URL at a disposable database before running (see
 * apps/material-db/README.md).
 */
export function requireTestPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL must be set to a real Postgres connection string to run apps/material-db " +
        "tests (see apps/material-db/README.md).",
    );
  }
  return new Pool({ connectionString });
}

export async function setupTestDb(pool: Pool): Promise<void> {
  await runMigrations(pool);
}

/** Clears all app tables between tests so each test starts from a known-empty state. */
export async function resetTestDb(pool: Pool): Promise<void> {
  await pool.query("TRUNCATE presets, preset_votes");
}
