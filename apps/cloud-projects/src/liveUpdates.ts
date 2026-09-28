import type { ServerResponse } from "node:http";
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
 * browser tabs - so this is a Map rather than a Set). Deliberately
 * in-memory and per-process - fine for a single dev-server instance (this
 * whole feature's scope, like every other `apps/*` service in this repo),
 * but a multi-replica production deployment would need a real pub/sub
 * backend (e.g. Redis) to fan a write on one instance out to viewers
 * connected to another.
 */
const subscribers = new Map<string, Map<ServerResponse, string>>();

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

/** Writes `event` to every open SSE stream currently subscribed to `projectId`. A no-op if nobody's listening. */
export function publish(projectId: string, event: LiveEvent): void {
  const connections = subscribers.get(projectId);
  if (!connections || connections.size === 0) return;
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of connections.keys()) {
    res.write(payload);
  }
}

/**
 * The distinct userIds currently holding at least one open `/live`
 * connection to `projectId`, sorted for a stable comparison/render order -
 * the same user connected from two tabs only counts once. Used both to
 * build the `"presence"` event broadcast on connect/disconnect and by
 * tests.
 */
export function currentViewers(projectId: string): string[] {
  const connections = subscribers.get(projectId);
  if (!connections) return [];
  return Array.from(new Set(connections.values())).sort();
}

/** Test-only hook: how many live streams are currently open for a project. */
export function subscriberCount(projectId: string): number {
  return subscribers.get(projectId)?.size ?? 0;
}
