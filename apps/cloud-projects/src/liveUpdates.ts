import { randomUUID } from "node:crypto";
import type { ServerResponse } from "node:http";
import type { Notification, Pool } from "pg";
import type { Collaborator } from "./collaborators.js";
import type { Project } from "./projects.js";

export type LiveEvent =
  | { type: "project"; project: Project }
  | { type: "deleted" }
  | { type: "collaborators"; collaborators: Collaborator[] }
  | { type: "presence"; viewers: string[] };

/**
 * In-process pub/sub for `GET /projects/:id/live`'s SSE streams, keyed by
 * project id, each connection tagged with the userId it was opened by (a
 * project can have several open connections for the same user - e.g. two
 * browser tabs - so this is a Map rather than a Set). This registry itself
 * is still per-process, but `startCrossInstanceRelay` below fans `publish()`
 * calls out to every other process via Postgres LISTEN/NOTIFY, so viewers
 * connected to different instances still see each other's events.
 */
const subscribers = new Map<string, Map<ServerResponse, string>>();

/**
 * Presence snapshots received from other instances via the relay, keyed by
 * project id then by the sending instance's id. `currentViewers` unions
 * these with the local viewer set. Entries are refreshed by every
 * `"presence"` relay message (both deltas and heartbeat snapshots) and
 * swept out once they go stale, so an instance that disappears without a
 * graceful shutdown doesn't haunt other instances' viewer lists forever.
 */
const remotePresence = new Map<string, Map<string, { userIds: string[]; updatedAt: number }>>();

type RelayOut = (projectId: string, event: LiveEvent) => void;
const noopRelayOut: RelayOut = () => {};
let relayOut: RelayOut = noopRelayOut;

type RelayMessage =
  | { kind: "event"; instanceId: string; projectId: string; event: LiveEvent }
  | { kind: "refresh"; instanceId: string; projectId: string }
  | { kind: "presence"; instanceId: string; projectId: string; userIds: string[] };

const CHANNEL = "cloud_projects_live";

export function subscribe(projectId: string, userId: string, res: ServerResponse): void {
  let connections = subscribers.get(projectId);
  if (!connections) {
    connections = new Map();
    subscribers.set(projectId, connections);
  }
  connections.set(res, userId);
}

export function unsubscribe(projectId: string, res: ServerResponse): void {
  const connections = subscribers.get(projectId);
  if (!connections) return;
  connections.delete(res);
  if (connections.size === 0) {
    subscribers.delete(projectId);
  }
}

/** Writes `event` to every open SSE stream on *this* process currently subscribed to `projectId`. */
function publishLocal(projectId: string, event: LiveEvent): void {
  const connections = subscribers.get(projectId);
  if (!connections || connections.size === 0) return;
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of connections.keys()) {
    res.write(payload);
  }
}

/**
 * Writes `event` to every open SSE stream subscribed to `projectId`, on this
 * process and (once `startCrossInstanceRelay` is running) every other
 * process sharing the same database. A no-op if nobody's listening anywhere
 * this process knows about.
 */
export function publish(projectId: string, event: LiveEvent): void {
  publishLocal(projectId, event);
  relayOut(projectId, event);
}

/** The distinct userIds currently holding an open `/live` connection to `projectId` on *this* process. */
function localViewerIds(projectId: string): string[] {
  const connections = subscribers.get(projectId);
  if (!connections) return [];
  return Array.from(new Set(connections.values()));
}

/**
 * The distinct userIds currently viewing `projectId`, across this process
 * and every other instance's last-known presence snapshot, sorted for a
 * stable comparison/render order - the same user connected from two tabs
 * (or two instances) only counts once. Used both to build the `"presence"`
 * event broadcast on connect/disconnect and by tests.
 */
export function currentViewers(projectId: string): string[] {
  const userIds = new Set(localViewerIds(projectId));
  const byInstance = remotePresence.get(projectId);
  if (byInstance) {
    for (const { userIds: remoteUserIds } of byInstance.values()) {
      for (const userId of remoteUserIds) userIds.add(userId);
    }
  }
  return Array.from(userIds).sort();
}

/** Test-only hook: how many live streams are currently open for a project on this process. */
export function subscriberCount(projectId: string): number {
  return subscribers.get(projectId)?.size ?? 0;
}

function setRemotePresence(projectId: string, fromInstanceId: string, userIds: string[]): void {
  let byInstance = remotePresence.get(projectId);
  if (!byInstance) {
    byInstance = new Map();
    remotePresence.set(projectId, byInstance);
  }
  byInstance.set(fromInstanceId, { userIds, updatedAt: Date.now() });
}

/** Evicts remote presence entries that haven't been refreshed in over `staleAfterMs`, re-broadcasting any project whose viewer list changed as a result. */
function sweepStalePresence(staleAfterMs: number): void {
  const now = Date.now();
  for (const [projectId, byInstance] of remotePresence) {
    let changed = false;
    for (const [instanceId, entry] of byInstance) {
      if (now - entry.updatedAt > staleAfterMs) {
        byInstance.delete(instanceId);
        changed = true;
      }
    }
    if (byInstance.size === 0) remotePresence.delete(projectId);
    if (changed) publishLocal(projectId, { type: "presence", viewers: currentViewers(projectId) });
  }
}

export interface CrossInstanceRelay {
  stop(): Promise<void>;
}

/**
 * Fans `publish()` calls out to every other process sharing the same
 * Postgres database, via LISTEN/NOTIFY on a fixed channel, so a save (or a
 * viewer connecting/disconnecting) on one `apps/cloud-projects` instance
 * reaches viewers connected to another instance behind a load balancer.
 *
 * `project` events carry an arbitrary, potentially large `VectorDocument` as
 * their payload, which could exceed NOTIFY's 8000-byte limit, so they're
 * relayed as a lightweight "refresh" signal instead - the receiving
 * instance re-fetches the project via `resolveProjectForRelay` rather than
 * trusting the NOTIFY payload to carry it. `deleted` and `collaborators`
 * events are small enough to embed directly. `presence` events are relayed
 * as each instance's own local viewer list (never the aggregate, to avoid
 * cross-hop misattribution); `currentViewers` merges these in.
 *
 * Postgres delivers a NOTIFY back to the session that issued it if that
 * session is also LISTENing on the same channel, so every outgoing message
 * carries this process's `instanceId` and incoming messages carrying that
 * same id are dropped as self-echoes.
 */
export async function startCrossInstanceRelay(
  pool: Pool,
  resolveProjectForRelay: (projectId: string) => Promise<Project | undefined>,
  options?: { heartbeatMs?: number; staleAfterMs?: number },
): Promise<CrossInstanceRelay> {
  const instanceId = randomUUID();
  const heartbeatMs = options?.heartbeatMs ?? 10_000;
  const staleAfterMs = options?.staleAfterMs ?? heartbeatMs * 3.5;

  const client = await pool.connect();

  function notify(message: RelayMessage): void {
    client.query("SELECT pg_notify($1, $2)", [CHANNEL, JSON.stringify(message)]).catch((err) => {
      console.error("cross-instance live-update relay: failed to publish", err);
    });
  }

  function relaySnapshot(projectId: string): void {
    notify({ kind: "presence", instanceId, projectId, userIds: localViewerIds(projectId) });
  }

  function handleIncoming(payload: string): void {
    let message: RelayMessage;
    try {
      message = JSON.parse(payload) as RelayMessage;
    } catch {
      return;
    }
    if (message.instanceId === instanceId) return;

    if (message.kind === "presence") {
      setRemotePresence(message.projectId, message.instanceId, message.userIds);
      publishLocal(message.projectId, {
        type: "presence",
        viewers: currentViewers(message.projectId),
      });
    } else if (message.kind === "event") {
      publishLocal(message.projectId, message.event);
    } else {
      resolveProjectForRelay(message.projectId)
        .then((project) => {
          if (project) publishLocal(message.projectId, { type: "project", project });
        })
        .catch((err) => {
          console.error("cross-instance live-update relay: failed to refresh project", err);
        });
    }
  }

  client.on("notification", (msg: Notification) => {
    if (msg.channel === CHANNEL && msg.payload) handleIncoming(msg.payload);
  });

  // The channel name is a fixed internal constant, never user input - LISTEN/UNLISTEN
  // don't support parameterized identifiers, so interpolating it here is safe.
  await client.query(`LISTEN ${CHANNEL}`);

  relayOut = (projectId, event) => {
    if (event.type === "project") {
      notify({ kind: "refresh", instanceId, projectId });
    } else if (event.type === "presence") {
      relaySnapshot(projectId);
    } else {
      notify({ kind: "event", instanceId, projectId, event });
    }
  };

  const heartbeat = setInterval(() => {
    for (const projectId of subscribers.keys()) relaySnapshot(projectId);
    sweepStalePresence(staleAfterMs);
  }, heartbeatMs);
  heartbeat.unref();

  return {
    async stop() {
      clearInterval(heartbeat);
      relayOut = noopRelayOut;
      await client.query(`UNLISTEN ${CHANNEL}`).catch(() => {});
      client.release();
    },
  };
}
