import type { SaliencyMask } from "./background-removal.js";

export interface CropRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ComputeCropRegionOptions {
  /**
   * Foreground-probability threshold in [0, 1] above which a pixel counts as
   * "subject". Defaults to 0.5.
   */
  threshold?: number;
  /**
   * Extra padding added on each side of the tight subject bounding box, in
   * pixels. Defaults to 0.
   */
  margin?: number;
}

/**
 * Computes the tight (plus optional margin) bounding box around the
 * foreground of a saliency mask, clamped to the mask's own bounds. Falls
 * back to the full mask extent if no pixel clears the threshold.
 */
export function computeCropRegion(
  mask: SaliencyMask,
  options?: ComputeCropRegionOptions,
): CropRegion {
  const threshold = options?.threshold ?? 0.5;
  const margin = options?.margin ?? 0;
  const { width, height, values } = mask;

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const value = values[y * width + x] ?? 0;
      if (value >= threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX || maxY < minY) {
    return { x: 0, y: 0, width, height };
  }

  const x = Math.max(0, minX - margin);
  const y = Math.max(0, minY - margin);
  const clampedMaxX = Math.min(width - 1, maxX + margin);
  const clampedMaxY = Math.min(height - 1, maxY + margin);

  return {
    x,
    y,
    width: clampedMaxX - x + 1,
    height: clampedMaxY - y + 1,
  };
}
