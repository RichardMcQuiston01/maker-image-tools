import { describe, expect, it } from "vitest";
import { createDocument, type VectorDocument } from "@maker/core-vector";
import { renderThumbnail } from "../lib/renderThumbnail";

describe("renderThumbnail", () => {
  it("returns undefined for a document with no objects", async () => {
    const doc = createDocument();
    await expect(renderThumbnail(doc, 400, 400)).resolves.toBeUndefined();
  });

  it("returns undefined when every layer with objects is hidden", async () => {
    const doc: VectorDocument = {
      layers: [{ id: "l1", name: "Layer 1", color: "#ff0000", visible: false }],
      objects: [
        {
          id: "o1",
          layerId: "l1",
          path: { id: "p1", commands: [{ type: "M", point: { x: 0, y: 0 } }] },
        },
      ],
    };
    await expect(renderThumbnail(doc, 400, 400)).resolves.toBeUndefined();
  });

  it("returns undefined for a non-positive source size", async () => {
    const doc: VectorDocument = {
      layers: [{ id: "l1", name: "Layer 1", color: "#ff0000" }],
      objects: [
        {
          id: "o1",
          layerId: "l1",
          path: { id: "p1", commands: [{ type: "M", point: { x: 0, y: 0 } }] },
        },
      ],
    };
    await expect(renderThumbnail(doc, 0, 400)).resolves.toBeUndefined();
    await expect(renderThumbnail(doc, 400, -1)).resolves.toBeUndefined();
  });
});
