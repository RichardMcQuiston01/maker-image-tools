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

/** Display metadata for a built-in filter, used to drive a generic filter-list UI. */
export interface BuiltInFilterEntry {
  name: string;
  label: string;
  group: "Tone" | "Dither" | "Edges & Morphology" | "Transform";
}

export const BUILT_IN_FILTERS: readonly BuiltInFilterEntry[] = [
  { name: "grayscale", label: "Grayscale", group: "Tone" },
  { name: "levels", label: "Levels", group: "Tone" },
  { name: "curves", label: "Curves", group: "Tone" },
  { name: "brightness-contrast", label: "Brightness/Contrast", group: "Tone" },
  { name: "gamma", label: "Gamma", group: "Tone" },
  { name: "dither-floyd-steinberg", label: "Dither: Floyd-Steinberg", group: "Dither" },
  { name: "dither-atkinson", label: "Dither: Atkinson", group: "Dither" },
  { name: "dither-jarvis-judice-ninke", label: "Dither: Jarvis-Judice-Ninke", group: "Dither" },
  { name: "dither-stucki", label: "Dither: Stucki", group: "Dither" },
  { name: "dither-sierra", label: "Dither: Sierra", group: "Dither" },
  { name: "dither-burkes", label: "Dither: Burkes", group: "Dither" },
  { name: "dither-bayer", label: "Dither: Bayer (ordered)", group: "Dither" },
  { name: "dither-blue-noise", label: "Dither: Blue Noise", group: "Dither" },
  { name: "halftone", label: "Halftone", group: "Edges & Morphology" },
  { name: "sobel-edge-detect", label: "Edge Detect: Sobel", group: "Edges & Morphology" },
  { name: "canny-edge-detect", label: "Edge Detect: Canny", group: "Edges & Morphology" },
  { name: "erode", label: "Erode", group: "Edges & Morphology" },
  { name: "dilate", label: "Dilate", group: "Edges & Morphology" },
  { name: "morph-open", label: "Morphological Open", group: "Edges & Morphology" },
  { name: "morph-close", label: "Morphological Close", group: "Edges & Morphology" },
  { name: "crop", label: "Crop (full image)", group: "Transform" },
  { name: "rotate", label: "Rotate 90°", group: "Transform" },
  { name: "resize", label: "Resize (50%)", group: "Transform" },
];

/**
 * Registers every Stage 1 filter into `registry` under the names listed in
 * BUILT_IN_FILTERS. Every filter here accepts `{}` as a valid options object
 * (each option field has a sensible internal default), so a generic UI can
 * call `registry.apply(name, image, {})` without knowing each filter's options.
 */
export function registerBuiltInFilters(registry: FilterRegistry): void {
  registry.register("grayscale", grayscale);
  registry.register("levels", levels);
  registry.register("curves", curves);
  registry.register("brightness-contrast", brightnessContrast);
  registry.register("gamma", adjustGamma);

  registry.register("dither-floyd-steinberg", ditherFloydSteinberg);
  registry.register("dither-atkinson", ditherAtkinson);
  registry.register("dither-jarvis-judice-ninke", ditherJarvisJudiceNinke);
  registry.register("dither-stucki", ditherStucki);
  registry.register("dither-sierra", ditherSierra);
  registry.register("dither-burkes", ditherBurkes);
  registry.register("dither-bayer", ditherBayer);
  registry.register("dither-blue-noise", ditherBlueNoise);

  registry.register("halftone", halftone);
  registry.register("sobel-edge-detect", sobelEdgeDetect);
  registry.register("canny-edge-detect", cannyEdgeDetect);
  registry.register("erode", erode);
  registry.register("dilate", dilate);
  registry.register("morph-open", morphOpen);
  registry.register("morph-close", morphClose);

  registry.register("crop", crop);
  registry.register("rotate", rotate);
  registry.register("resize", resize);
}
