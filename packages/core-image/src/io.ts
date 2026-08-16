import type { ExportOptions } from "./types.js";

/**
 * Decode/export pipeline. These functions require a real browser Canvas 2D
 * context, so unlike registry.ts/pixel.ts they are not exercised by jsdom
 * unit tests — they're covered by apps/web integration/e2e testing instead.
 */

function getCanvas2dContext(
  width: number,
  height: number,
): {
  canvas: OffscreenCanvas | HTMLCanvasElement;
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
} {
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to acquire an OffscreenCanvas 2D context");
    return { canvas, ctx };
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to acquire a canvas 2D context");
  return { canvas, ctx };
}

/** Decode a raster image file (JPG/PNG/BMP/WebP) into ImageData. */
export async function loadImageData(source: Blob): Promise<ImageData> {
  const bitmap = await createImageBitmap(source);
  const { width, height } = bitmap;
  const { ctx } = getCanvas2dContext(width, height);
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return ctx.getImageData(0, 0, width, height);
}

/** Encode ImageData back to a Blob for download/export. */
export async function exportImageData(
  image: ImageData,
  options: ExportOptions = {},
): Promise<Blob> {
  const { mimeType = "image/png", quality } = options;
  const { canvas, ctx } = getCanvas2dContext(image.width, image.height);
  ctx.putImageData(image, 0, 0);

  if (canvas instanceof OffscreenCanvas) {
    return canvas.convertToBlob(
      quality === undefined ? { type: mimeType } : { type: mimeType, quality },
    );
  }

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("canvas.toBlob returned null"))),
      mimeType,
      quality,
    );
  });
}
