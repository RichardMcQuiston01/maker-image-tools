import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool, type PoolClient } from "pg";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

/** Thrown when DATABASE_URL is missing/blank — a deployment misconfiguration, not a bad request. */
export class DatabaseConfigError extends Error {}

export function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString || connectionString.trim().length === 0) {
    throw new DatabaseConfigError(
      "Missing DATABASE_URL environment variable. Set it to a Postgres connection string " +
        "(e.g. postgres://user:password@localhost:5432/maker_billing) to enable this service.",
    );
  }
  return new Pool({ connectionString });
}

/**
 * Applies every `migrations/*.sql` file that hasn't already run, in filename
 * order, tracking progress in a `_migrations` table so this is safe to call
 * on every process start rather than requiring a separate deploy step.
 */
export async function runMigrations(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(
      "CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())",
    );
    const { rows } = await client.query<{ name: string }>("SELECT name FROM _migrations");
    const applied = new Set(rows.map((row) => row.name));

    const files = (await readdir(MIGRATIONS_DIR)).filter((name) => name.endsWith(".sql")).sort();
    for (const name of files) {
      if (applied.has(name)) continue;
      const sql = await readFile(join(MIGRATIONS_DIR, name), "utf-8");
      await applyMigration(client, name, sql);
    }
  } finally {
    client.release();
  }
}

async function applyMigration(client: PoolClient, name: string, sql: string): Promise<void> {
  await client.query("BEGIN");
  try {
    await client.query(sql);
    await client.query("INSERT INTO _migrations (name) VALUES ($1)", [name]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw new Error(`Migration "${name}" failed: ${err instanceof Error ? err.message : err}`);
  }
}
