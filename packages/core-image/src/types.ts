export type SupportedImageMimeType = "image/jpeg" | "image/png" | "image/bmp" | "image/webp";

export const SUPPORTED_IMAGE_MIME_TYPES: readonly SupportedImageMimeType[] = [
  "image/jpeg",
  "image/png",
  "image/bmp",
  "image/webp",
];

/** Options bag threaded through to a Filter. Concrete filters extend this with their own fields. */
export interface FilterOptions {
  [key: string]: unknown;
}

/**
 * A Filter is a pure function: same input ImageData + options always produces
 * the same output ImageData, with no side effects. This is the contract every
 * Stage 1+ pixel-processing feature (grayscale, dithering, edge detection, ...)
 * implements, so they can be composed, tested, and run in a Web Worker
 * uniformly.
 */
export type Filter<TOptions extends FilterOptions = FilterOptions> = (
  image: ImageData,
  options: TOptions,
) => ImageData;

export interface ExportOptions {
  mimeType?: SupportedImageMimeType;
  /** 0-1, only applies to lossy formats (jpeg/webp). */
  quality?: number;
}
