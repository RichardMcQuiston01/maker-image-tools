import type { Filter } from "../types.js";
import type { FilterRegistry } from "../registry.js";
import { grayscale, levels, curves, brightnessContrast, adjustGamma } from "./tone.js";
import {
  ditherFloydSteinberg,
  ditherAtkinson,
  ditherJarvisJudiceNinke,
  ditherStucki,
  ditherSierra,
  ditherBurkes,
  ditherBayer,
  ditherBlueNoise,
} from "./dither.js";
import {
  halftone,
  erode,
  dilate,
  morphOpen,
  morphClose,
  sobelEdgeDetect,
  cannyEdgeDetect,
} from "./edge-morphology.js";
import { crop, rotate, resize } from "./transform.js";

export * from "./tone.js";
export * from "./dither.js";
export * from "./edge-morphology.js";
export * from "./transform.js";
export * from "./testgrid.js";

/**
 * Display metadata for a built-in filter, used to drive a generic filter-list
 * UI. `filter` is the single source of truth for what `name` registers to —
 * registerBuiltInFilters iterates this same list, so a name can't drift out
 * of sync between the UI listing and the registry.
 */
export interface BuiltInFilterEntry {
  name: string;
  label: string;
  group: "Tone" | "Dither" | "Edges & Morphology" | "Transform";
  filter: Filter<never>;
}

export const BUILT_IN_FILTERS: readonly BuiltInFilterEntry[] = [
  { name: "grayscale", label: "Grayscale", group: "Tone", filter: grayscale as Filter<never> },
  { name: "levels", label: "Levels", group: "Tone", filter: levels as Filter<never> },
  { name: "curves", label: "Curves", group: "Tone", filter: curves as Filter<never> },
  {
    name: "brightness-contrast",
    label: "Brightness/Contrast",
    group: "Tone",
    filter: brightnessContrast as Filter<never>,
  },
  { name: "gamma", label: "Gamma", group: "Tone", filter: adjustGamma as Filter<never> },
  {
    name: "dither-floyd-steinberg",
    label: "Dither: Floyd-Steinberg",
    group: "Dither",
    filter: ditherFloydSteinberg as Filter<never>,
  },
  {
    name: "dither-atkinson",
    label: "Dither: Atkinson",
    group: "Dither",
    filter: ditherAtkinson as Filter<never>,
  },
  {
    name: "dither-jarvis-judice-ninke",
    label: "Dither: Jarvis-Judice-Ninke",
    group: "Dither",
    filter: ditherJarvisJudiceNinke as Filter<never>,
  },
  {
    name: "dither-stucki",
    label: "Dither: Stucki",
    group: "Dither",
    filter: ditherStucki as Filter<never>,
  },
  {
    name: "dither-sierra",
    label: "Dither: Sierra",
    group: "Dither",
    filter: ditherSierra as Filter<never>,
  },
  {
    name: "dither-burkes",
    label: "Dither: Burkes",
    group: "Dither",
    filter: ditherBurkes as Filter<never>,
  },
  {
    name: "dither-bayer",
    label: "Dither: Bayer (ordered)",
    group: "Dither",
    filter: ditherBayer as Filter<never>,
  },
  {
    name: "dither-blue-noise",
    label: "Dither: Blue Noise",
    group: "Dither",
    filter: ditherBlueNoise as Filter<never>,
  },
  {
    name: "halftone",
    label: "Halftone",
    group: "Edges & Morphology",
    filter: halftone as Filter<never>,
  },
  {
    name: "sobel-edge-detect",
    label: "Edge Detect: Sobel",
    group: "Edges & Morphology",
    filter: sobelEdgeDetect as Filter<never>,
  },
  {
    name: "canny-edge-detect",
    label: "Edge Detect: Canny",
    group: "Edges & Morphology",
    filter: cannyEdgeDetect as Filter<never>,
  },
  { name: "erode", label: "Erode", group: "Edges & Morphology", filter: erode as Filter<never> },
  {
    name: "dilate",
    label: "Dilate",
    group: "Edges & Morphology",
    filter: dilate as Filter<never>,
  },
  {
    name: "morph-open",
    label: "Morphological Open",
    group: "Edges & Morphology",
    filter: morphOpen as Filter<never>,
  },
  {
    name: "morph-close",
    label: "Morphological Close",
    group: "Edges & Morphology",
    filter: morphClose as Filter<never>,
  },
  { name: "crop", label: "Crop (full image)", group: "Transform", filter: crop as Filter<never> },
  { name: "rotate", label: "Rotate 90°", group: "Transform", filter: rotate as Filter<never> },
  {
    name: "resize",
    label: "Resize (50%)",
    group: "Transform",
    filter: resize as Filter<never>,
  },
];

/**
 * Registers every Stage 1 filter into `registry` under the names listed in
 * BUILT_IN_FILTERS. Every filter here accepts `{}` as a valid options object
 * (each option field has a sensible internal default), so a generic UI can
 * call `registry.apply(name, image, {})` without knowing each filter's options.
 * Idempotent: already-registered names are skipped rather than throwing, so
 * calling this more than once on the same registry (e.g. under dev-mode hot
 * reload) is safe.
 */
export function registerBuiltInFilters(registry: FilterRegistry): void {
  for (const entry of BUILT_IN_FILTERS) {
    if (registry.has(entry.name)) continue;
    registry.register(entry.name, entry.filter);
  }
}
