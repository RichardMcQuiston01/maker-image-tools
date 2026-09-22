import type { ServerResponse } from "node:http";
import type { Collaborator } from "./collaborators.js";
import type { Project } from "./projects.js";

export type LiveEvent =
  | { type: "project"; project: Project }
  | { type: "deleted" }
  | { type: "collaborators"; collaborators: Collaborator[] };

/**
 * In-process pub/sub for `GET /projects/:id/live`'s SSE streams, keyed by
 * project id. Deliberately in-memory and per-process - fine for a single
 * dev-server instance (this whole feature's scope, like every other
 * `apps/*` service in this repo), but a multi-replica production deployment
 * would need a real pub/sub backend (e.g. Redis) to fan a write on one
 * instance out to viewers connected to another.
 */
const subscribers = new Map<string, Set<ServerResponse>>();

export function subscribe(projectId: string, res: ServerResponse): void {
  let set = subscribers.get(projectId);
  if (!set) {
    set = new Set();
    subscribers.set(projectId, set);
  }
  set.add(res);
}

export function unsubscribe(projectId: string, res: ServerResponse): void {
  const set = subscribers.get(projectId);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) {
    subscribers.delete(projectId);
  }
}

/** Writes `event` to every open SSE stream currently subscribed to `projectId`. A no-op if nobody's listening. */
export function publish(projectId: string, event: LiveEvent): void {
  const set = subscribers.get(projectId);
  if (!set || set.size === 0) return;
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of set) {
    res.write(payload);
  }
}

/** Test-only hook: how many live streams are currently open for a project. */
export function subscriberCount(projectId: string): number {
  return subscribers.get(projectId)?.size ?? 0;
}
