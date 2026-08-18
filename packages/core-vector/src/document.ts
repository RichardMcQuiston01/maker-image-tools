import type { VectorPath } from "./types.js";

export type LayerMode = "line" | "fill" | "offset-fill";

export interface LayerSettings {
  id: string;
  name: string;
  color: string;
  speed?: number;
  power?: number;
  mode?: LayerMode;
  visible?: boolean;
  locked?: boolean;
}

export interface DocumentObject {
  id: string;
  path: VectorPath;
  layerId: string;
}

export interface VectorDocument {
  layers: LayerSettings[];
  objects: DocumentObject[];
}

/** Rotating palette used to auto-assign distinct colors to layers added without an explicit color. */
const LAYER_COLOR_PALETTE = [
  "#ff0000",
  "#00a651",
  "#0072ce",
  "#ff8c00",
  "#9b30ff",
  "#00c2c2",
  "#ff1493",
  "#8b4513",
];

export function createDocument(): VectorDocument {
  return { layers: [], objects: [] };
}

export function addLayer(
  doc: VectorDocument,
  layer: Partial<LayerSettings> & { name: string },
): VectorDocument {
  const color =
    layer.color ??
    // Modulo guarantees an in-range index into the non-empty palette.
    (LAYER_COLOR_PALETTE[doc.layers.length % LAYER_COLOR_PALETTE.length] as string);
  const newLayer: LayerSettings = {
    ...layer,
    id: layer.id ?? crypto.randomUUID(),
    color,
    mode: layer.mode ?? "line",
    visible: layer.visible ?? true,
    locked: layer.locked ?? false,
  };
  return { ...doc, layers: [...doc.layers, newLayer] };
}

export function removeLayer(doc: VectorDocument, layerId: string): VectorDocument {
  if (!doc.layers.some((l) => l.id === layerId)) {
    return doc;
  }
  return {
    layers: doc.layers.filter((l) => l.id !== layerId),
    objects: doc.objects.filter((o) => o.layerId !== layerId),
  };
}

export function updateLayer(
  doc: VectorDocument,
  layerId: string,
  changes: Partial<LayerSettings>,
): VectorDocument {
  const existing = doc.layers.find((l) => l.id === layerId);
  if (!existing) {
    return doc;
  }
  // Safe: `existing` always carries every required field, and `changes` can only
  // override with values of matching type under exactOptionalPropertyTypes.
  const updated = { ...existing, ...changes, id: existing.id } as LayerSettings;
  const layers = doc.layers.map((l) => (l.id === layerId ? updated : l));
  return { ...doc, layers };
}

export function reorderLayers(doc: VectorDocument, orderedLayerIds: string[]): VectorDocument {
  const byId = new Map(doc.layers.map((l) => [l.id, l] as const));
  const ordered: LayerSettings[] = [];
  const seen = new Set<string>();

  for (const id of orderedLayerIds) {
    const layer = byId.get(id);
    if (layer && !seen.has(id)) {
      ordered.push(layer);
      seen.add(id);
    }
  }
  for (const layer of doc.layers) {
    if (!seen.has(layer.id)) {
      ordered.push(layer);
      seen.add(layer.id);
    }
  }

  return { ...doc, layers: ordered };
}

export function addObject(doc: VectorDocument, path: VectorPath, layerId: string): VectorDocument {
  if (!doc.layers.some((l) => l.id === layerId)) {
    throw new Error(`Layer "${layerId}" does not exist`);
  }
  const object: DocumentObject = { id: crypto.randomUUID(), path, layerId };
  return { ...doc, objects: [...doc.objects, object] };
}

export function moveObjectToLayer(
  doc: VectorDocument,
  objectId: string,
  layerId: string,
): VectorDocument {
  if (!doc.layers.some((l) => l.id === layerId)) {
    throw new Error(`Layer "${layerId}" does not exist`);
  }
  if (!doc.objects.some((o) => o.id === objectId)) {
    return doc;
  }
  const objects = doc.objects.map((o) => (o.id === objectId ? { ...o, layerId } : o));
  return { ...doc, objects };
}

export function removeObject(doc: VectorDocument, objectId: string): VectorDocument {
  if (!doc.objects.some((o) => o.id === objectId)) {
    return doc;
  }
  return { ...doc, objects: doc.objects.filter((o) => o.id !== objectId) };
}

export function getObjectsInLayer(doc: VectorDocument, layerId: string): DocumentObject[] {
  return doc.objects.filter((o) => o.layerId === layerId);
}
