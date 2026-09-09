import { assignColorLabels, quantizeColors, type RgbColor } from "./color-quantize.js";
import { traceMask } from "./trace.js";
import type { VectorPath } from "./types.js";

export interface ColorLayer {
  color: RgbColor;
  paths: VectorPath[];
}

export interface TraceImageColorsOptions {
  /** Target number of color layers. Default 6. Actual output may be fewer. Ignored if `palette` is given. */
  colorCount?: number;
  /**
   * Explicit palette to trace against, instead of deriving one from the
   * image via median-cut quantization. Each pixel is assigned to its
   * nearest color in this list. Intended for a caller-supplied (e.g.
   * AI-suggested) palette — see `@maker/ai-inference`'s
   * `suggestColorPalette()` — while keeping tracing itself deterministic
   * and fully offline-capable: this whole module works with or without one.
   */
  palette?: RgbColor[];
  /** Connected regions smaller than this many pixels are discarded. Default 2. */
  minRegionSize?: number;
  /** Douglas-Peucker simplification tolerance, in pixels. Default 1.0. */
  simplifyTolerance?: number;
}

/**
 * AI-assisted multi-color vectorization (ROADMAP.md 5B-4): reduces the
 * image to a small palette — either derived from the image itself
 * (median-cut color quantization, the default) or a caller-supplied
 * palette (see `options.palette`) — and traces each color's pixels into
 * its own closed-outline vector layer, reusing Stage 2's tracing engine
 * per color instead of a single luma threshold.
 */
export function traceImageColors(
  image: ImageData,
  options?: TraceImageColorsOptions,
): ColorLayer[] {
  const { labels, palette } = options?.palette
    ? { labels: assignColorLabels(image, options.palette), palette: options.palette }
    : quantizeColors(image, options);
  const { width, height } = image;
  const traceOptions: { minRegionSize?: number; simplifyTolerance?: number } = {};
  if (options?.minRegionSize !== undefined) traceOptions.minRegionSize = options.minRegionSize;
  if (options?.simplifyTolerance !== undefined) {
    traceOptions.simplifyTolerance = options.simplifyTolerance;
  }

  const layers: ColorLayer[] = [];
  for (let paletteIndex = 0; paletteIndex < palette.length; paletteIndex++) {
    const mask = new Uint8Array(width * height);
    for (let p = 0; p < mask.length; p++) {
      mask[p] = labels[p] === paletteIndex ? 1 : 0;
    }
    const paths = traceMask(mask, width, height, traceOptions);
    if (paths.length === 0) continue;
    layers.push({ color: palette[paletteIndex] as RgbColor, paths });
  }

  return layers;
}
