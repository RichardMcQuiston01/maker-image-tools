import { Pool } from "pg";
import { runMigrations } from "../src/db.js";

/**
 * These tests run against a real Postgres database (no mocking - unlike the
 * external S3-compatible object storage used elsewhere in this service, a
 * local/CI Postgres instance is free and reproducible, so there's no reason
 * not to exercise the real thing). Point DATABASE_URL at a disposable
 * database before running (see apps/community-library/README.md).
 */
export function requireTestPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL must be set to a real Postgres connection string to run " +
        "apps/community-library tests (see apps/community-library/README.md).",
    );
  }
  return new Pool({ connectionString });
}

export async function setupTestDb(pool: Pool): Promise<void> {
  await runMigrations(pool);
}

/** Clears all app tables between tests so each test starts from a known-empty state. */
export async function resetTestDb(pool: Pool): Promise<void> {
  await pool.query("TRUNCATE ratings, listings CASCADE");
}
