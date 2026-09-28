/**
 * Object-level conflict-free merging for a project's `data` - see README's
 * "Collaborative merging" section for the full picture. `apps/cloud-projects`
 * otherwise treats `data` as opaque, arbitrary JSON (see the top of the
 * README for why); this is a deliberate, narrow exception, recognizing only
 * the one shape `apps/web` actually stores - a plain object whose fields are
 * arrays of `{ id: string, ... }` objects (a `VectorDocument`'s
 * `layers`/`objects`). Anything that doesn't duck-type this way, for a whole
 * document or just one of its fields, falls back untouched to `ours` - the
 * exact whole-document replace this service did before this feature existed.
 *
 * This is a state-based (not operation-based) CRDT: instead of transforming
 * a stream of edit operations against each other (OT) or maintaining a
 * per-replica op log (a "real" CRDT library like Yjs/Automerge), it does a
 * plain three-way diff - `base` (what the caller fetched before editing),
 * `ours` (the caller's now-edited copy, arriving in this PUT) and `theirs`
 * (whatever is currently stored, which may have moved on if someone else
 * saved in between) - per id, so two collaborators editing *different*
 * objects/layers in the same project both survive instead of one PUT
 * blindly overwriting the other's.
 */

export interface IdKeyed {
  id: string;
  [key: string]: unknown;
}

/** Plain structural equality for JSON-safe values (no Date/Map/etc. - everything here came from JSON). */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }
  const aRec = a as Record<string, unknown>;
  const bRec = b as Record<string, unknown>;
  const aKeys = Object.keys(aRec);
  const bKeys = Object.keys(bRec);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every(
    (key) => Object.prototype.hasOwnProperty.call(bRec, key) && deepEqual(aRec[key], bRec[key]),
  );
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isIdKeyedArray(value: unknown): value is IdKeyed[] {
  return (
    Array.isArray(value) &&
    value.every((item) => isPlainObject(item) && typeof item.id === "string")
  );
}

type ItemAction =
  | { kind: "absent" } // never existed on this side, in base or now
  | { kind: "unchanged"; item: IdKeyed } // present, identical to base
  | { kind: "changed"; item: IdKeyed } // present, added fresh or edited relative to base
  | { kind: "deleted" }; // was in base, missing now

function actionFor(baseItem: IdKeyed | undefined, item: IdKeyed | undefined): ItemAction {
  if (item === undefined) {
    return baseItem === undefined ? { kind: "absent" } : { kind: "deleted" };
  }
  if (baseItem !== undefined && deepEqual(item, baseItem)) {
    return { kind: "unchanged", item };
  }
  return { kind: "changed", item };
}

/**
 * Resolves one id's final content from what each side did to it relative to
 * `base`. `ours` is the write being processed right now, so it's the
 * "last writer" whenever both sides made a real, conflicting change -
 * matching this service's original last-write-wins semantics, just scoped
 * to the one object/layer that actually conflicts instead of the whole
 * document. An edit always survives a concurrent delete of the same id,
 * on either side - silently losing a collaborator's real edit is worse than
 * un-deleting something they can just delete again.
 */
function resolveItem(ours: ItemAction, theirs: ItemAction): IdKeyed | undefined {
  if (ours.kind === "absent")
    return theirs.kind === "deleted" || theirs.kind === "absent" ? undefined : theirs.item;
  if (theirs.kind === "absent") return ours.kind === "deleted" ? undefined : ours.item;
  if (ours.kind === "unchanged" && theirs.kind === "unchanged") return ours.item;
  if (ours.kind === "unchanged") return theirs.kind === "deleted" ? undefined : theirs.item;
  if (theirs.kind === "unchanged") return ours.kind === "deleted" ? undefined : ours.item;
  // Both sides changed and/or deleted it relative to base.
  if (ours.kind === "changed") return ours.item;
  if (theirs.kind === "changed") return theirs.item;
  return undefined; // both deleted
}

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/**
 * Picks the final id order. Array position is the only place ordering lives
 * for layers/objects (see `packages/core-vector`'s `reorderLayers`) - it's
 * invisible to `resolveItem`'s per-id content diff, so a save that only
 * reorders things (no object content actually changed) needs its own
 * handling here: whichever side actually reordered relative to `base` wins;
 * if both did, `ours` (the write being processed now) wins, the same
 * last-writer-wins rule `resolveItem` uses for a genuine content conflict.
 * An id neither ordering mentions (added by the other side) is appended at
 * the end, in that side's own order.
 */
function chooseOrder(
  baseIds: readonly string[],
  oursIds: readonly string[],
  theirsIds: readonly string[],
  survivingIds: ReadonlySet<string>,
): string[] {
  const restrict = (ids: readonly string[]) => ids.filter((id) => survivingIds.has(id));
  const baseOrder = restrict(baseIds);
  const oursOrder = restrict(oursIds);
  const theirsOrder = restrict(theirsIds);

  const oursReordered = !sameOrder(oursOrder, baseOrder);
  const chosen = oursReordered ? oursOrder : theirsOrder;

  const seen = new Set(chosen);
  const result = [...chosen];
  for (const id of theirsOrder) {
    if (!seen.has(id)) {
      result.push(id);
      seen.add(id);
    }
  }
  for (const id of oursOrder) {
    if (!seen.has(id)) {
      result.push(id);
      seen.add(id);
    }
  }
  return result;
}

/** Three-way merges one array-of-`{id}`-keyed-objects field (e.g. `layers` or `objects`). */
export function mergeIdKeyedArrays(base: IdKeyed[], ours: IdKeyed[], theirs: IdKeyed[]): IdKeyed[] {
  const baseById = new Map(base.map((item) => [item.id, item] as const));
  const oursById = new Map(ours.map((item) => [item.id, item] as const));
  const theirsById = new Map(theirs.map((item) => [item.id, item] as const));

  const allIds = new Set<string>([...baseById.keys(), ...oursById.keys(), ...theirsById.keys()]);
  const mergedById = new Map<string, IdKeyed>();
  for (const id of allIds) {
    const baseItem = baseById.get(id);
    const merged = resolveItem(
      actionFor(baseItem, oursById.get(id)),
      actionFor(baseItem, theirsById.get(id)),
    );
    if (merged !== undefined) mergedById.set(id, merged);
  }

  const order = chooseOrder(
    base.map((item) => item.id),
    ours.map((item) => item.id),
    theirs.map((item) => item.id),
    new Set(mergedById.keys()),
  );
  return order.map((id) => mergedById.get(id)!);
}

/**
 * Three-way merges a project's `data`. Falls straight back to `ours` (a
 * plain replace) unless all three of `base`/`ours`/`theirs` are plain
 * objects; within that, only merges the fields that duck-type as an
 * array-of-`{id}`-keyed-objects in `ours`/`theirs` (and, if present, `base`)
 * - every other field just takes `ours`'s value, same as a plain replace
 * would have.
 */
export function mergeProjectData(base: unknown, ours: unknown, theirs: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(ours) || !isPlainObject(theirs)) {
    return ours;
  }
  const merged: Record<string, unknown> = { ...theirs, ...ours };
  for (const key of new Set([...Object.keys(ours), ...Object.keys(theirs)])) {
    const baseVal = base[key];
    const oursVal = ours[key];
    const theirsVal = theirs[key];
    const baseArr = baseVal === undefined ? [] : isIdKeyedArray(baseVal) ? baseVal : undefined;
    if (baseArr !== undefined && isIdKeyedArray(oursVal) && isIdKeyedArray(theirsVal)) {
      merged[key] = mergeIdKeyedArrays(baseArr, oursVal, theirsVal);
    }
  }
  return merged;
}
