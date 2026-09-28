import { describe, expect, it } from "vitest";
import {
  deepEqual,
  isIdKeyedArray,
  mergeIdKeyedArrays,
  mergeProjectData,
  type IdKeyed,
} from "../src/crdtMerge.js";

function layer(id: string, overrides: Partial<IdKeyed> = {}): IdKeyed {
  return { id, name: `Layer ${id}`, color: "#ff0000", ...overrides };
}

describe("deepEqual", () => {
  it("treats structurally identical objects/arrays as equal regardless of key insertion order", () => {
    expect(deepEqual({ a: 1, b: [1, 2, { c: 3 }] }, { b: [1, 2, { c: 3 }], a: 1 })).toBe(true);
  });

  it("detects a difference in nested content", () => {
    expect(deepEqual({ a: [1, 2] }, { a: [1, 3] })).toBe(false);
  });

  it("treats mismatched key counts as unequal", () => {
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });
});

describe("isIdKeyedArray", () => {
  it("accepts an empty array and an array of objects with a string id", () => {
    expect(isIdKeyedArray([])).toBe(true);
    expect(isIdKeyedArray([{ id: "a" }, { id: "b", extra: 1 }])).toBe(true);
  });

  it("rejects a non-array, or an array with a non-object/no-id element", () => {
    expect(isIdKeyedArray("not an array")).toBe(false);
    expect(isIdKeyedArray([{ id: "a" }, "oops"])).toBe(false);
    expect(isIdKeyedArray([{ noId: true }])).toBe(false);
  });
});

describe("mergeIdKeyedArrays", () => {
  it("keeps both sides' edits when they touch different ids", () => {
    const base = [layer("a"), layer("b")];
    const ours = [layer("a", { name: "A renamed by us" }), layer("b")];
    const theirs = [layer("a"), layer("b", { name: "B renamed by them" })];

    const merged = mergeIdKeyedArrays(base, ours, theirs);
    expect(merged).toEqual([
      layer("a", { name: "A renamed by us" }),
      layer("b", { name: "B renamed by them" }),
    ]);
  });

  it("resolves a same-id conflict with the incoming write (ours) as last writer", () => {
    const base = [layer("a")];
    const ours = [layer("a", { name: "Renamed by us" })];
    const theirs = [layer("a", { name: "Renamed by them" })];

    expect(mergeIdKeyedArrays(base, ours, theirs)).toEqual([layer("a", { name: "Renamed by us" })]);
  });

  it("keeps an object someone else added concurrently, even though our copy doesn't have it", () => {
    const base = [layer("a")];
    const ours = [layer("a")];
    const theirs = [layer("a"), layer("b")];

    expect(mergeIdKeyedArrays(base, ours, theirs)).toEqual([layer("a"), layer("b")]);
  });

  it("keeps an object we added concurrently, even though the server's copy doesn't have it yet", () => {
    const base = [layer("a")];
    const ours = [layer("a"), layer("new")];
    const theirs = [layer("a")];

    expect(mergeIdKeyedArrays(base, ours, theirs)).toEqual([layer("a"), layer("new")]);
  });

  it("drops an object we deleted that nobody else touched", () => {
    const base = [layer("a"), layer("b")];
    const ours = [layer("a")];
    const theirs = [layer("a"), layer("b")];

    expect(mergeIdKeyedArrays(base, ours, theirs)).toEqual([layer("a")]);
  });

  it("drops an object someone else deleted that we didn't touch", () => {
    const base = [layer("a"), layer("b")];
    const ours = [layer("a"), layer("b")];
    const theirs = [layer("a")];

    expect(mergeIdKeyedArrays(base, ours, theirs)).toEqual([layer("a")]);
  });

  it("keeps our edit over a concurrent delete of the same object (edit beats delete)", () => {
    const base = [layer("a")];
    const ours = [layer("a", { name: "Edited by us" })];
    const theirs: IdKeyed[] = [];

    expect(mergeIdKeyedArrays(base, ours, theirs)).toEqual([layer("a", { name: "Edited by us" })]);
  });

  it("keeps their edit over our concurrent delete of the same object (edit beats delete)", () => {
    const base = [layer("a")];
    const ours: IdKeyed[] = [];
    const theirs = [layer("a", { name: "Edited by them" })];

    expect(mergeIdKeyedArrays(base, ours, theirs)).toEqual([
      layer("a", { name: "Edited by them" }),
    ]);
  });

  it("drops an object both sides deleted", () => {
    const base = [layer("a"), layer("b")];
    const ours = [layer("b")];
    const theirs = [layer("b")];

    expect(mergeIdKeyedArrays(base, ours, theirs)).toEqual([layer("b")]);
  });

  it("preserves a pure reorder (no content change) issued by us", () => {
    const base = [layer("a"), layer("b"), layer("c")];
    const ours = [layer("c"), layer("a"), layer("b")];
    const theirs = [layer("a"), layer("b"), layer("c")];

    expect(mergeIdKeyedArrays(base, ours, theirs).map((i) => i.id)).toEqual(["c", "a", "b"]);
  });

  it("preserves a pure reorder issued concurrently by someone else when we didn't reorder", () => {
    const base = [layer("a"), layer("b"), layer("c")];
    const ours = [layer("a"), layer("b"), layer("c")];
    const theirs = [layer("c"), layer("a"), layer("b")];

    expect(mergeIdKeyedArrays(base, ours, theirs).map((i) => i.id)).toEqual(["c", "a", "b"]);
  });

  it("prefers our reorder over a concurrent, different reorder from someone else", () => {
    const base = [layer("a"), layer("b"), layer("c")];
    const ours = [layer("b"), layer("c"), layer("a")];
    const theirs = [layer("c"), layer("a"), layer("b")];

    expect(mergeIdKeyedArrays(base, ours, theirs).map((i) => i.id)).toEqual(["b", "c", "a"]);
  });

  it("appends an id neither chosen ordering mentions yet, added by the other side", () => {
    const base = [layer("a"), layer("b")];
    const ours = [layer("b"), layer("a")]; // reordered
    const theirs = [layer("a"), layer("b"), layer("new")]; // someone else added "new"

    expect(mergeIdKeyedArrays(base, ours, theirs).map((i) => i.id)).toEqual(["b", "a", "new"]);
  });
});

describe("mergeProjectData", () => {
  it("merges recognized array-of-id-keyed-object fields per id", () => {
    const base = { layers: [layer("l1")], objects: [layer("o1")] };
    const ours = { layers: [layer("l1", { name: "Renamed by us" })], objects: [layer("o1")] };
    const theirs = { layers: [layer("l1")], objects: [layer("o1"), layer("o2")] };

    expect(mergeProjectData(base, ours, theirs)).toEqual({
      layers: [layer("l1", { name: "Renamed by us" })],
      objects: [layer("o1"), layer("o2")],
    });
  });

  it("falls back to a plain replace (ours) for a non-plain-object document", () => {
    expect(mergeProjectData([1, 2], [3, 4], [5, 6])).toEqual([3, 4]);
    expect(mergeProjectData("base", "ours", "theirs")).toBe("ours");
  });

  it("falls back to ours's value for a field that isn't shaped like an array of id-keyed objects", () => {
    const base = { title: "Base title", layers: [] };
    const ours = { title: "Our title", layers: [] };
    const theirs = { title: "Their title", layers: [] };

    expect(mergeProjectData(base, ours, theirs)).toEqual({ title: "Our title", layers: [] });
  });

  it("treats a field missing from base as starting empty, still merging it per id", () => {
    const base = {};
    const ours = { objects: [layer("new-by-us")] };
    const theirs = { objects: [layer("new-by-them")] };

    expect(mergeProjectData(base, ours, theirs)).toEqual({
      objects: [layer("new-by-us"), layer("new-by-them")],
    });
  });

  it("keeps a field only theirs has, unmerged (ours never touched it)", () => {
    const base = {};
    const ours = { layers: [] };
    const theirs = { layers: [], extra: "server-only field" };

    expect(mergeProjectData(base, ours, theirs)).toEqual({
      layers: [],
      extra: "server-only field",
    });
  });
});
