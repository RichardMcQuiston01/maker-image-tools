import { commandsToPathData, type VectorDocument } from "@maker/core-vector";

export const THUMBNAIL_WIDTH = 320;
export const THUMBNAIL_HEIGHT = 240;

function visibleObjectsOf(vectorDocument: VectorDocument) {
  const visibleLayerIds = new Set(
    vectorDocument.layers.filter((layer) => layer.visible !== false).map((layer) => layer.id),
  );
  return vectorDocument.objects.filter((object) => visibleLayerIds.has(object.layerId));
}

function toSourceSvg(
  vectorDocument: VectorDocument,
  sourceWidth: number,
  sourceHeight: number,
): string {
  const strokeWidth = Math.max(sourceWidth, sourceHeight) / 200;
  const paths = visibleObjectsOf(vectorDocument)
    .map((object) => {
      const layer = vectorDocument.layers.find((candidate) => candidate.id === object.layerId);
      const d = commandsToPathData(object.path.commands);
      return `<path d="${d}" fill="none" stroke="${layer?.color ?? "#000000"}" stroke-width="${strokeWidth}" />`;
    })
    .join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${sourceWidth} ${sourceHeight}">` +
    `<rect width="100%" height="100%" fill="#ffffff" />${paths}</svg>`
  );
}

/**
 * Rasterizes a VectorDocument's visible objects into a small PNG thumbnail,
 * letterboxed to THUMBNAIL_WIDTH x THUMBNAIL_HEIGHT while preserving the
 * source's aspect ratio (`sourceWidth`/`sourceHeight` - typically the traced
 * image's pixel dimensions, matching the coordinate space `VectorPreview`
 * already renders in). Returns undefined for a document with no visible
 * objects, or an invalid source size - there's nothing meaningful to draw.
 */
export async function renderThumbnail(
  vectorDocument: VectorDocument,
  sourceWidth: number,
  sourceHeight: number,
): Promise<Blob | undefined> {
  if (visibleObjectsOf(vectorDocument).length === 0) return undefined;
  if (sourceWidth <= 0 || sourceHeight <= 0) return undefined;

  const svg = toSourceSvg(vectorDocument, sourceWidth, sourceHeight);
  const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Failed to rasterize thumbnail SVG"));
    image.src = svgUrl;
  });

  const scale = Math.min(THUMBNAIL_WIDTH / sourceWidth, THUMBNAIL_HEIGHT / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  const offsetX = (THUMBNAIL_WIDTH - drawWidth) / 2;
  const offsetY = (THUMBNAIL_HEIGHT - drawHeight) / 2;

  const canvas = document.createElement("canvas");
  canvas.width = THUMBNAIL_WIDTH;
  canvas.height = THUMBNAIL_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) return undefined;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);
  ctx.drawImage(image, offsetX, offsetY, drawWidth, drawHeight);

  return new Promise<Blob | undefined>((resolve) => {
    canvas.toBlob((blob) => resolve(blob ?? undefined), "image/png");
  });
}
