import type { Filter, FilterOptions } from "../types.js";
import { cloneImageData } from "../pixel.js";

function clamp255(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : value;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

export type GrayscaleMethod = "luminance" | "average" | "lightness";

export interface GrayscaleOptions extends FilterOptions {
  method?: GrayscaleMethod;
}

export const grayscale: Filter<GrayscaleOptions> = (image, options) => {
  const method = options.method ?? "luminance";
  const output = cloneImageData(image);
  const data = output.data;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;

    let value: number;
    if (method === "average") {
      value = (r + g + b) / 3;
    } else if (method === "lightness") {
      value = (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
    } else {
      value = r * 0.299 + g * 0.587 + b * 0.114;
    }

    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
  }

  return output;
};

export interface LevelsOptions extends FilterOptions {
  inputBlack?: number;
  inputWhite?: number;
  outputBlack?: number;
  outputWhite?: number;
  gamma?: number;
}

export const levels: Filter<LevelsOptions> = (image, options) => {
  const inputBlack = options.inputBlack ?? 0;
  let inputWhite = options.inputWhite ?? 255;
  const outputBlack = options.outputBlack ?? 0;
  const outputWhite = options.outputWhite ?? 255;
  const gamma = options.gamma ?? 1;

  if (inputWhite === inputBlack) {
    inputWhite = inputBlack + 1;
  }

  const output = cloneImageData(image);
  const data = output.data;

  const apply = (value: number): number => {
    const normalized = clamp01((value - inputBlack) / (inputWhite - inputBlack));
    const gammaCorrected = normalized ** (1 / gamma);
    return clamp255(outputBlack + gammaCorrected * (outputWhite - outputBlack));
  };

  for (let i = 0; i < data.length; i += 4) {
    data[i] = apply(data[i] ?? 0);
    data[i + 1] = apply(data[i + 1] ?? 0);
    data[i + 2] = apply(data[i + 2] ?? 0);
  }

  return output;
};

export interface CurvePoint {
  x: number;
  y: number;
}

export interface CurvesOptions extends FilterOptions {
  points?: CurvePoint[];
}

function buildCurveLut(points: CurvePoint[] | undefined): Uint8ClampedArray {
  const sorted =
    points && points.length >= 2
      ? [...points].sort((a, b) => a.x - b.x)
      : [
          { x: 0, y: 0 },
          { x: 255, y: 255 },
        ];

  const lut = new Uint8ClampedArray(256);
  for (let x = 0; x < 256; x++) {
    if (x <= (sorted[0]?.x ?? 0)) {
      lut[x] = sorted[0]?.y ?? 0;
      continue;
    }
    const last = sorted[sorted.length - 1];
    if (last && x >= last.x) {
      lut[x] = last.y;
      continue;
    }

    let lo = sorted[0]!;
    let hi = sorted[sorted.length - 1]!;
    for (let j = 0; j < sorted.length - 1; j++) {
      const a = sorted[j]!;
      const b = sorted[j + 1]!;
      if (x >= a.x && x <= b.x) {
        lo = a;
        hi = b;
        break;
      }
    }

    const span = hi.x - lo.x;
    const t = span === 0 ? 0 : (x - lo.x) / span;
    lut[x] = lo.y + t * (hi.y - lo.y);
  }

  return lut;
}

export const curves: Filter<CurvesOptions> = (image, options) => {
  const lut = buildCurveLut(options.points);
  const output = cloneImageData(image);
  const data = output.data;

  for (let i = 0; i < data.length; i += 4) {
    data[i] = lut[data[i] ?? 0] ?? 0;
    data[i + 1] = lut[data[i + 1] ?? 0] ?? 0;
    data[i + 2] = lut[data[i + 2] ?? 0] ?? 0;
  }

  return output;
};

export interface BrightnessContrastOptions extends FilterOptions {
  brightness?: number;
  contrast?: number;
}

export const brightnessContrast: Filter<BrightnessContrastOptions> = (image, options) => {
  const brightness = options.brightness ?? 0;
  const contrast = options.contrast ?? 0;

  // Standard brightness/contrast formula popularized for 8-bit image editors.
  const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));

  const output = cloneImageData(image);
  const data = output.data;

  const apply = (value: number): number => clamp255(factor * (value - 128) + 128 + brightness);

  for (let i = 0; i < data.length; i += 4) {
    data[i] = apply(data[i] ?? 0);
    data[i + 1] = apply(data[i + 1] ?? 0);
    data[i + 2] = apply(data[i + 2] ?? 0);
  }

  return output;
};

export interface AdjustGammaOptions extends FilterOptions {
  gamma?: number;
}

export const adjustGamma: Filter<AdjustGammaOptions> = (image, options) => {
  const rawGamma = options.gamma ?? 1;
  const gamma = rawGamma <= 0 ? 1 : rawGamma;

  const output = cloneImageData(image);
  const data = output.data;

  const apply = (value: number): number => clamp255(255 * (value / 255) ** (1 / gamma));

  for (let i = 0; i < data.length; i += 4) {
    data[i] = apply(data[i] ?? 0);
    data[i + 1] = apply(data[i + 1] ?? 0);
    data[i + 2] = apply(data[i + 2] ?? 0);
  }

  return output;
};
