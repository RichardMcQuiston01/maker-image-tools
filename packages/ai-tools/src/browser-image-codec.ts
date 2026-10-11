/**
 * The browser's {@link ImageCodec}: PNG in and out via a canvas. Needs the DOM,
 * so it is covered by a real-browser run rather than the jsdom unit tests.
 */
import type { AiImage } from "@richardmcquiston01/ai-providers";
import type { ImageCodec, PixelBuffer } from "./onnx-background-remover.js";

function createContext(width: number, height: number): CanvasRenderingContext2D {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas is unavailable in this browser.");
  return ctx;
}

export const browserImageCodec: ImageCodec = {
  async encode(image: PixelBuffer): Promise<AiImage> {
    const ctx = createContext(image.width, image.height);
    ctx.putImageData(
      new ImageData(image.data as Uint8ClampedArray<ArrayBuffer>, image.width, image.height),
      0,
      0,
    );
    const blob = await new Promise<Blob | null>((resolve) =>
      ctx.canvas.toBlob(resolve, "image/png"),
    );
    if (!blob) throw new Error("The browser could not encode the image as PNG.");
    return { mimeType: "image/png", data: new Uint8Array(await blob.arrayBuffer()) };
  },

  async decode(image: AiImage): Promise<PixelBuffer> {
    const bitmap = await createImageBitmap(
      new Blob([image.data as Uint8Array<ArrayBuffer>], { type: image.mimeType }),
    );
    try {
      const ctx = createContext(bitmap.width, bitmap.height);
      ctx.drawImage(bitmap, 0, 0);
      const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
      return { width: bitmap.width, height: bitmap.height, data };
    } finally {
      bitmap.close();
    }
  },
};
