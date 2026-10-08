import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import type { Pool } from "pg";
import { startFakeAccounts, type FakeAccounts } from "./fakeAccounts.js";
import { startFakeBilling, type FakeBilling } from "./fakeBilling.js";
import { requireTestPool, resetTestDb, setupTestDb } from "./testDb.js";

/**
 * Proves that `GET /projects/:id/live` fans out across separate
 * `apps/cloud-projects` *processes* via the Postgres LISTEN/NOTIFY relay in
 * `liveUpdates.ts`, not just across connections handled by one process -
 * two real child processes (`test/smokeServer.ts`), each with its own
 * `Pool` and its own module state, mirroring two instances behind a load
 * balancer and sharing one disposable Postgres database.
 *
 * This has to be real separate OS processes, not two `createServer()` calls
 * in this test file's own process: `liveUpdates.ts`'s subscriber registry,
 * presence cache, and relay hook are module-level singletons, so two
 * in-process servers would share that state directly and a test could pass
 * for the wrong reason (one shared in-memory `Map`) even with the relay
 * itself completely broken.
 *
 * A short `heartbeatMs` keeps the presence-propagation assertions fast
 * instead of waiting out the relay's real default 10s heartbeat interval.
 */
const USER_1 = "11111111-1111-1111-1111-111111111111";
const USER_2 = "22222222-2222-2222-2222-222222222222";
const TOKEN_1 = "user-1-token";
const TOKEN_2 = "user-2-token";
const HEARTBEAT_MS = 150;

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.listen(0, () => {
      const address = probe.address();
      if (address === null || typeof address === "string") {
        probe.close();
        reject(new Error("Expected to bind to a numeric port"));
        return;
      }
      const { port } = address;
      probe.close(() => resolve(port));
    });
    probe.on("error", reject);
  });
}

interface Instance {
  baseUrl: string;
  stop(): Promise<void>;
}

async function spawnInstance(env: Record<string, string>): Promise<Instance> {
  const port = await getFreePort();
  const child: ChildProcessWithoutNullStreams = spawn(
    "bun",
    ["run", new URL("./smokeServer.ts", import.meta.url).pathname],
    {
      env: { ...process.env, ...env, PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf-8");
  });

  await new Promise<void>((resolve, reject) => {
    const onExit = (code: number | null) => {
      reject(new Error(`smokeServer exited with code ${code} before printing "ready":\n${stderr}`));
    };
    child.once("exit", onExit);
    let buffer = "";
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf-8");
      if (buffer.includes("ready")) {
        child.off("exit", onExit);
        resolve();
      }
    });
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  // "ready" only means the child's `server.listen()` callback fired - under
  // CI's heavier load, the very first real connection to a just-bound port
  // can still occasionally race the OS finishing setup and come back as a
  // reset ("fetch failed" / "other side closed") rather than a response.
  // `OPTIONS` is answered by `server.ts` before it ever touches the
  // database, so retrying it is a cheap, side-effect-free way to confirm the
  // instance is actually ready to accept connections before any test sends
  // it real traffic.
  for (let attempt = 0; ; attempt++) {
    try {
      await fetch(baseUrl, { method: "OPTIONS" });
      break;
    } catch (err) {
      if (attempt >= 20) throw err;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  return {
    baseUrl,
    async stop() {
      await new Promise<void>((resolve) => {
        child.once("exit", () => resolve());
        child.kill();
      });
    },
  };
}

describe("cross-instance live updates", () => {
  let pool: Pool;
  let instanceA: Instance;
  let instanceB: Instance;
  let accounts: FakeAccounts;
  let billing: FakeBilling;

  beforeAll(async () => {
    pool = requireTestPool();
    await setupTestDb(pool);
  }, 30_000);

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await resetTestDb(pool);
    accounts = await startFakeAccounts({ [TOKEN_1]: USER_1, [TOKEN_2]: USER_2 });
    billing = await startFakeBilling({});
    const env = {
      DATABASE_URL: pool.options.connectionString!,
      ACCOUNTS_URL: accounts.baseUrl,
      BILLING_URL: billing.baseUrl,
      HEARTBEAT_MS: String(HEARTBEAT_MS),
    };
    [instanceA, instanceB] = await Promise.all([spawnInstance(env), spawnInstance(env)]);
  }, 30_000);

  afterEach(async () => {
    await Promise.all([instanceA.stop(), instanceB.stop()]);
    await accounts.close();
    await billing.close();
  });

  function authHeaders(token: string): Record<string, string> {
    return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
  }

  async function createProject(baseUrl: string, token: string, name: string, data: unknown) {
    return fetch(`${baseUrl}/projects`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ name, data }),
    });
  }

  async function connectLive(baseUrl: string, token: string, projectId: string) {
    const response = await fetch(
      `${baseUrl}/projects/${projectId}/live?token=${encodeURIComponent(token)}`,
    );
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    return {
      status: response.status,
      async nextEvent(): Promise<unknown> {
        while (!buffer.includes("\n\n")) {
          const { value, done } = await reader.read();
          if (done) throw new Error("SSE stream ended before an event arrived");
          buffer += decoder.decode(value, { stream: true });
        }
        const frameEnd = buffer.indexOf("\n\n");
        const frame = buffer.slice(0, frameEnd);
        buffer = buffer.slice(frameEnd + 2);
        const dataLine = frame.split("\n").find((line) => line.startsWith("data: "));
        if (!dataLine) throw new Error(`No "data:" line in SSE frame: ${frame}`);
        return JSON.parse(dataLine.slice("data: ".length));
      },
      close() {
        void reader.cancel();
      },
    };
  }

  /**
   * Reads events until one of type `type` arrives, skipping over any others
   * - the cross-instance relay's periodic presence heartbeat (`HEARTBEAT_MS`
   * above) can legitimately interleave an extra `"presence"` frame between
   * the frames a test cares about, so asserting an exact next-event type
   * (as `test/server.test.ts`'s single-instance tests do, with no heartbeat
   * in the picture) would be flaky here.
   */
  async function nextEventOfType(
    live: { nextEvent(): Promise<unknown> },
    type: string,
  ): Promise<{ type: string; [key: string]: unknown }> {
    for (let i = 0; i < 20; i++) {
      const event = (await live.nextEvent()) as { type: string };
      if (event.type === type) return event;
    }
    throw new Error(`No "${type}" event arrived after 20 frames`);
  }

  it("delivers a save on instance A to a viewer connected to instance B", async () => {
    const created = await (
      await createProject(instanceA.baseUrl, TOKEN_1, "Mine", { v: 1 })
    ).json();

    const live = await connectLive(instanceB.baseUrl, TOKEN_1, created.project.id);
    try {
      const first = await nextEventOfType(live, "project");
      expect((first as { project: { data: unknown } }).project.data).toEqual({ v: 1 });

      const putResponse = await fetch(`${instanceA.baseUrl}/projects/${created.project.id}`, {
        method: "PUT",
        headers: authHeaders(TOKEN_1),
        body: JSON.stringify({ data: { v: 2 } }),
      });
      expect(putResponse.status).toBe(200);

      const second = await nextEventOfType(live, "project");
      expect((second as { project: { data: unknown } }).project.data).toEqual({ v: 2 });
    } finally {
      live.close();
    }
  }, 30_000);

  it('delivers a "deleted" event from instance A to a viewer connected to instance B', async () => {
    const created = await (
      await createProject(instanceA.baseUrl, TOKEN_1, "Mine", { v: 1 })
    ).json();
    await fetch(`${instanceA.baseUrl}/projects/${created.project.id}/collaborators`, {
      method: "POST",
      headers: authHeaders(TOKEN_1),
      body: JSON.stringify({ userId: USER_2 }),
    });

    const live = await connectLive(instanceB.baseUrl, TOKEN_2, created.project.id);
    try {
      await nextEventOfType(live, "project"); // initial state

      const deleteResponse = await fetch(`${instanceA.baseUrl}/projects/${created.project.id}`, {
        method: "DELETE",
        headers: authHeaders(TOKEN_1),
      });
      expect(deleteResponse.status).toBe(204);

      await nextEventOfType(live, "deleted");
    } finally {
      live.close();
    }
  }, 30_000);

  it('delivers a "collaborators" event from instance A to a viewer connected to instance B', async () => {
    const created = await (
      await createProject(instanceA.baseUrl, TOKEN_1, "Mine", { v: 1 })
    ).json();

    const live = await connectLive(instanceA.baseUrl, TOKEN_1, created.project.id);
    try {
      await nextEventOfType(live, "project"); // initial state

      const addResponse = await fetch(
        `${instanceB.baseUrl}/projects/${created.project.id}/collaborators`,
        {
          method: "POST",
          headers: authHeaders(TOKEN_1),
          body: JSON.stringify({ userId: USER_2 }),
        },
      );
      expect(addResponse.status).toBe(200);

      const event = await nextEventOfType(live, "collaborators");
      const collaborators = event.collaborators as Array<{ userId: string }>;
      expect(collaborators.map((c) => c.userId)).toEqual([USER_2]);
    } finally {
      live.close();
    }
  }, 30_000);

  it("reports a viewer connected to a different instance in the aggregate presence list", async () => {
    const created = await (
      await createProject(instanceA.baseUrl, TOKEN_1, "Mine", { v: 1 })
    ).json();
    await fetch(`${instanceA.baseUrl}/projects/${created.project.id}/collaborators`, {
      method: "POST",
      headers: authHeaders(TOKEN_1),
      body: JSON.stringify({ userId: USER_2 }),
    });

    const onA = await connectLive(instanceA.baseUrl, TOKEN_1, created.project.id);
    try {
      await onA.nextEvent(); // initial state
      const soloPresence = (await onA.nextEvent()) as { type: string; viewers: string[] };
      expect(soloPresence.type).toBe("presence");
      expect(soloPresence.viewers).toEqual([USER_1]);

      const onB = await connectLive(instanceB.baseUrl, TOKEN_2, created.project.id);
      try {
        await onB.nextEvent(); // initial state
        await onB.nextEvent(); // solo presence on B, before A's viewer is known there

        // Instance B's connect only broadcasts locally at first; A learns about
        // it once B's relay heartbeat fires and A's presence cache absorbs it.
        let bothPresence: { type: string; viewers: string[] } | undefined;
        for (let i = 0; i < 10; i++) {
          const event = (await onA.nextEvent()) as { type: string; viewers: string[] };
          expect(event.type).toBe("presence");
          if (event.viewers.length === 2) {
            bothPresence = event;
            break;
          }
        }
        expect(bothPresence?.viewers).toEqual([USER_1, USER_2]);
      } finally {
        onB.close();
      }

      // Once B's viewer disconnects, its next heartbeat snapshot is empty,
      // and A's aggregate should drop back down (no onB.close() is awaited
      // elsewhere here - closing cancels the reader, which lets instance B's
      // own `req.on("close", ...)` fire and remove the local subscriber).
      let soloAgain: { type: string; viewers: string[] } | undefined;
      for (let i = 0; i < 10; i++) {
        const event = (await onA.nextEvent()) as { type: string; viewers: string[] };
        expect(event.type).toBe("presence");
        if (event.viewers.length === 1) {
          soloAgain = event;
          break;
        }
      }
      expect(soloAgain?.viewers).toEqual([USER_1]);
    } finally {
      onA.close();
    }
  }, 30_000);
});
