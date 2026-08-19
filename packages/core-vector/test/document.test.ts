import { describe, expect, it } from "vitest";
import {
  addLayer,
  addObject,
  createDocument,
  getObjectsInLayer,
  moveObjectToLayer,
  removeLayer,
  removeObject,
  reorderLayers,
  updateLayer,
  type VectorDocument,
} from "../src/document.js";
import type { VectorPath } from "../src/types.js";

function makePath(id: string): VectorPath {
  return {
    id,
    commands: [
      { type: "M", point: { x: 0, y: 0 } },
      { type: "L", point: { x: 10, y: 10 } },
    ],
  };
}

describe("createDocument", () => {
  it("returns an empty document", () => {
    expect(createDocument()).toEqual({ layers: [], objects: [] });
  });
});

describe("addLayer", () => {
  it("appends a layer with a generated id and default settings", () => {
    const doc = createDocument();
    const next = addLayer(doc, { name: "Layer 1" });

    expect(next).not.toBe(doc);
    expect(next.layers).toHaveLength(1);
    const layer = next.layers[0];
    expect(layer.name).toBe("Layer 1");
    expect(layer.id).toBeTruthy();
    expect(layer.color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(layer.mode).toBe("line");
    expect(layer.visible).toBe(true);
    expect(layer.locked).toBe(false);

    // original doc untouched
    expect(doc.layers).toHaveLength(0);
  });

  it("respects explicit color and mode", () => {
    const doc = createDocument();
    const next = addLayer(doc, { name: "Fill layer", color: "#123456", mode: "fill" });
    expect(next.layers[0].color).toBe("#123456");
    expect(next.layers[0].mode).toBe("fill");
  });

  it("assigns different colors to successive auto-colored layers", () => {
    let doc = createDocument();
    doc = addLayer(doc, { name: "A" });
    doc = addLayer(doc, { name: "B" });
    expect(doc.layers[0].color).not.toBe(doc.layers[1].color);
  });
});

describe("updateLayer", () => {
  it("shallow-merges changes and preserves id", () => {
    let doc = createDocument();
    doc = addLayer(doc, { name: "Layer 1" });
    const id = doc.layers[0].id;

    const next = updateLayer(doc, id, { name: "Renamed", speed: 500, id: "hacked-id" });
    expect(next).not.toBe(doc);
    expect(next.layers[0].id).toBe(id);
    expect(next.layers[0].name).toBe("Renamed");
    expect(next.layers[0].speed).toBe(500);

    expect(doc.layers[0].name).toBe("Layer 1");
  });

  it("is a no-op for an unknown layer id", () => {
    const doc = addLayer(createDocument(), { name: "Layer 1" });
    const next = updateLayer(doc, "does-not-exist", { name: "X" });
    expect(next).toBe(doc);
  });
});

describe("reorderLayers", () => {
  it("reorders layers to match the given id order", () => {
    let doc = createDocument();
    doc = addLayer(doc, { name: "A" });
    doc = addLayer(doc, { name: "B" });
    doc = addLayer(doc, { name: "C" });
    const [a, b, c] = doc.layers;

    const next = reorderLayers(doc, [c.id, a.id, b.id]);
    expect(next.layers.map((l) => l.id)).toEqual([c.id, a.id, b.id]);
    expect(doc.layers.map((l) => l.id)).toEqual([a.id, b.id, c.id]);
  });

  it("appends unlisted layer ids at the end in original relative order", () => {
    let doc = createDocument();
    doc = addLayer(doc, { name: "A" });
    doc = addLayer(doc, { name: "B" });
    doc = addLayer(doc, { name: "C" });
    const [a, b, c] = doc.layers;

    const next = reorderLayers(doc, [b.id]);
    expect(next.layers.map((l) => l.id)).toEqual([b.id, a.id, c.id]);
  });

  it("ignores unknown ids in the ordering list", () => {
    let doc = createDocument();
    doc = addLayer(doc, { name: "A" });
    const [a] = doc.layers;

    const next = reorderLayers(doc, ["nope", a.id]);
    expect(next.layers.map((l) => l.id)).toEqual([a.id]);
  });
});

describe("removeLayer", () => {
  it("removes the layer and cascades to remove its objects", () => {
    let doc = createDocument();
    doc = addLayer(doc, { name: "A" });
    doc = addLayer(doc, { name: "B" });
    const [layerA, layerB] = doc.layers;
    doc = addObject(doc, makePath("p1"), layerA.id);
    doc = addObject(doc, makePath("p2"), layerB.id);

    const next = removeLayer(doc, layerA.id);
    expect(next).not.toBe(doc);
    expect(next.layers.map((l) => l.id)).toEqual([layerB.id]);
    expect(next.objects).toHaveLength(1);
    expect(next.objects[0].layerId).toBe(layerB.id);

    // original untouched
    expect(doc.layers).toHaveLength(2);
    expect(doc.objects).toHaveLength(2);
  });

  it("is a no-op for an unknown layer id", () => {
    const doc = addLayer(createDocument(), { name: "A" });
    const next = removeLayer(doc, "does-not-exist");
    expect(next).toBe(doc);
  });
});

describe("addObject", () => {
  it("adds an object to a valid layer", () => {
    let doc = createDocument();
    doc = addLayer(doc, { name: "A" });
    const layerId = doc.layers[0].id;
    const path = makePath("p1");

    const next = addObject(doc, path, layerId);
    expect(next).not.toBe(doc);
    expect(next.objects).toHaveLength(1);
    expect(next.objects[0].path).toBe(path);
    expect(next.objects[0].layerId).toBe(layerId);
    expect(next.objects[0].id).toBeTruthy();

    expect(doc.objects).toHaveLength(0);
  });

  it("throws when the layer does not exist", () => {
    const doc = createDocument();
    expect(() => addObject(doc, makePath("p1"), "missing-layer")).toThrow(
      /Layer "missing-layer" does not exist/,
    );
  });
});

describe("moveObjectToLayer", () => {
  it("moves an object to a different layer", () => {
    let doc = createDocument();
    doc = addLayer(doc, { name: "A" });
    doc = addLayer(doc, { name: "B" });
    const [layerA, layerB] = doc.layers;
    doc = addObject(doc, makePath("p1"), layerA.id);
    const objectId = doc.objects[0].id;

    const next = moveObjectToLayer(doc, objectId, layerB.id);
    expect(next).not.toBe(doc);
    expect(next.objects[0].layerId).toBe(layerB.id);
    expect(doc.objects[0].layerId).toBe(layerA.id);
  });

  it("throws when the target layer does not exist", () => {
    let doc = createDocument();
    doc = addLayer(doc, { name: "A" });
    doc = addObject(doc, makePath("p1"), doc.layers[0].id);
    const objectId = doc.objects[0].id;

    expect(() => moveObjectToLayer(doc, objectId, "missing-layer")).toThrow(
      /Layer "missing-layer" does not exist/,
    );
  });

  it("is a no-op when the object does not exist", () => {
    const doc = addLayer(createDocument(), { name: "A" });
    const next = moveObjectToLayer(doc, "missing-object", doc.layers[0].id);
    expect(next).toBe(doc);
  });
});

describe("removeObject", () => {
  it("removes the object", () => {
    let doc = createDocument();
    doc = addLayer(doc, { name: "A" });
    doc = addObject(doc, makePath("p1"), doc.layers[0].id);
    const objectId = doc.objects[0].id;

    const next = removeObject(doc, objectId);
    expect(next).not.toBe(doc);
    expect(next.objects).toHaveLength(0);
    expect(doc.objects).toHaveLength(1);
  });

  it("is a no-op for an unknown object id", () => {
    const doc = addLayer(createDocument(), { name: "A" });
    const next = removeObject(doc, "does-not-exist");
    expect(next).toBe(doc);
  });
});

describe("getObjectsInLayer", () => {
  it("returns objects for the given layer preserving order", () => {
    let doc = createDocument();
    doc = addLayer(doc, { name: "A" });
    doc = addLayer(doc, { name: "B" });
    const [layerA, layerB] = doc.layers;
    doc = addObject(doc, makePath("p1"), layerA.id);
    doc = addObject(doc, makePath("p2"), layerB.id);
    doc = addObject(doc, makePath("p3"), layerA.id);

    const inA = getObjectsInLayer(doc, layerA.id);
    expect(inA.map((o) => o.path.id)).toEqual(["p1", "p3"]);
  });

  it("returns an empty array for a layer with no objects", () => {
    const doc = addLayer(createDocument(), { name: "A" });
    expect(getObjectsInLayer(doc, doc.layers[0].id)).toEqual([]);
  });
});

describe("document interoperability", () => {
  it("supports a realistic multi-layer workflow", () => {
    let doc: VectorDocument = createDocument();
    doc = addLayer(doc, { name: "Cut" });
    doc = addLayer(doc, { name: "Engrave", mode: "fill" });
    const [cut, engrave] = doc.layers;

    doc = addObject(doc, makePath("outline"), cut.id);
    doc = addObject(doc, makePath("text"), engrave.id);

    expect(getObjectsInLayer(doc, cut.id)).toHaveLength(1);
    expect(getObjectsInLayer(doc, engrave.id)).toHaveLength(1);
  });
});
