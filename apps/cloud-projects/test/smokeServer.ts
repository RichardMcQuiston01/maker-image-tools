import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import type { Pool } from "pg";
import { Pool as PgPool } from "pg";
import { createServer } from "../src/server.js";
import type { ObjectStore } from "../src/objectStorage.js";

/**
 * A standalone (non-vitest) process entry point for `test/multiInstance.test.ts`'s cross-process
 * smoke test. Booting this via a real child process - rather than calling `createServer()` twice
 * in the test's own process - matters here specifically because `liveUpdates.ts`'s subscriber
 * registry, presence cache, and relay hook are module-level singletons: two `createServer()` calls
 * in the *same* process would share that state directly, making a viewer on "instance B" see
 * "instance A"'s events via the shared in-memory `Map` regardless of whether the Postgres
 * LISTEN/NOTIFY relay under test works at all. A real separate OS process has its own module
 * instance of `liveUpdates.ts`, so the only way for one instance to learn about the other's events
 * is the relay itself - which is the thing this smoke test exists to prove.
 *
 * Reads its configuration from env vars (`PORT`, `DATABASE_URL`, `ACCOUNTS_URL`, `BILLING_URL`,
 * `HEARTBEAT_MS`) and prints "ready" once listening, so the parent process knows when it's safe to
 * send requests.
 *
 * Object storage is faked (this sandbox can't reach a real S3-compatible endpoint - see
 * `test/fakeS3.ts`), but unlike `test/fakeS3.ts`'s plain in-memory `Map` - fine for one process,
 * since every single-instance test only ever talks to one `ObjectStore` - that won't do here: a
 * real deployment's S3 bucket is shared infrastructure both instances read from, so this fakes it
 * as a table in the one piece of infrastructure this smoke test's two processes *do* share, the
 * same Postgres database, rather than process-local memory that would silently make each instance
 * blind to the other's project data.
 */
function createPostgresBackedObjectStore(pool: Pool): ObjectStore {
  // Both smoke instances boot at the same moment, and two concurrent
  // `CREATE TABLE IF NOT EXISTS` statements can race inside Postgres: the loser fails with
  // unique_violation (23505, on pg_type) or duplicate_table (42P07) even though the table now
  // exists. Either code means the other instance won, which is all this needs.
  const ready = pool
    .query(
      "CREATE TABLE IF NOT EXISTS smoke_object_store (key text PRIMARY KEY, body bytea NOT NULL, content_type text)",
    )
    .catch((err: { code?: string }) => {
      if (err.code !== "23505" && err.code !== "42P07") throw err;
    });

  const client = {
    send: async (command: unknown) => {
      await ready;
      if (command instanceof PutObjectCommand) {
        const input = command.input.Body;
        const body = Buffer.isBuffer(input) ? input : Buffer.from(String(input), "utf-8");
        await pool.query(
          "INSERT INTO smoke_object_store (key, body, content_type) VALUES ($1, $2, $3) " +
            "ON CONFLICT (key) DO UPDATE SET body = $2, content_type = $3",
          [command.input.Key, body, command.input.ContentType ?? null],
        );
        return {};
      }
      if (command instanceof GetObjectCommand) {
        const { rows } = await pool.query<{ body: Buffer; content_type: string | null }>(
          "SELECT body, content_type FROM smoke_object_store WHERE key = $1",
          [command.input.Key],
        );
        const row = rows[0];
        if (!row) {
          const err = new Error(`NoSuchKey: ${command.input.Key}`);
          err.name = "NoSuchKey";
          throw err;
        }
        return {
          ContentType: row.content_type ?? undefined,
          Body: {
            transformToString: async () => row.body.toString("utf-8"),
            transformToByteArray: async () => new Uint8Array(row.body),
          },
        };
      }
      if (command instanceof DeleteObjectCommand) {
        await pool.query("DELETE FROM smoke_object_store WHERE key = $1", [command.input.Key]);
        return {};
      }
      throw new Error(
        `Unhandled fake S3 command: ${(command as { constructor: { name: string } })?.constructor?.name}`,
      );
    },
  };
  return { client, bucket: "smoke-test-bucket" } as unknown as ObjectStore;
}

const port = Number(process.env.PORT);
const heartbeatMs = Number(process.env.HEARTBEAT_MS ?? "10000");
const pool: Pool = new PgPool({ connectionString: process.env.DATABASE_URL });
const store = createPostgresBackedObjectStore(pool);

const server = createServer(pool, store, { heartbeatMs });
server.listen(port, () => {
  console.log("ready");
});
