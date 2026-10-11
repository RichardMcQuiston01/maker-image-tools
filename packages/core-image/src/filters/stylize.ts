import type { Filter, FilterOptions } from "../types.js";
import { cloneImageData } from "../pixel.js";
import type { Rgb } from "./effects.js";

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

function luma(r: number, g: number, b: number): number {
  return r * 0.299 + g * 0.587 + b * 0.114;
}

/** Small seeded PRNG (mulberry32) so a seed always gives the same picture. */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Edge strength per pixel, 0-255: the larger of the Sobel gradient of the
 * luminance (over the picture's own colours, scaled by its alpha) and of the
 * alpha channel, so both detail and the outline of a cutout count.
 */
function edgeStrength(image: ImageData): Float32Array {
  const { width, height, data } = image;
  const tone = new Float32Array(width * height);
  const alpha = new Float32Array(width * height);
  for (let p = 0; p < tone.length; p++) {
    const a = (data[p * 4 + 3] ?? 0) / 255;
    tone[p] = luma(data[p * 4] ?? 0, data[p * 4 + 1] ?? 0, data[p * 4 + 2] ?? 0) * a;
    alpha[p] = a * 255;
  }
  const strength = new Float32Array(width * height);
  const sample = (buffer: Float32Array, x: number, y: number): number =>
    buffer[Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))] ?? 0;
  const gradient = (buffer: Float32Array, x: number, y: number): number => {
    const gx =
      -sample(buffer, x - 1, y - 1) -
      2 * sample(buffer, x - 1, y) -
      sample(buffer, x - 1, y + 1) +
      sample(buffer, x + 1, y - 1) +
      2 * sample(buffer, x + 1, y) +
      sample(buffer, x + 1, y + 1);
    const gy =
      -sample(buffer, x - 1, y - 1) -
      2 * sample(buffer, x, y - 1) -
      sample(buffer, x + 1, y - 1) +
      sample(buffer, x - 1, y + 1) +
      2 * sample(buffer, x, y + 1) +
      sample(buffer, x + 1, y + 1);
    return Math.hypot(gx, gy) / 4;
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      strength[y * width + x] = Math.max(gradient(tone, x, y), gradient(alpha, x, y));
    }
  }
  return strength;
}

/** Marks pixels whose edge strength reaches `threshold`, then thickens the lines to `width` px. */
function edgeMask(image: ImageData, threshold: number, width: number): Uint8Array {
  const strength = edgeStrength(image);
  const mask = new Uint8Array(strength.length);
  for (let p = 0; p < strength.length; p++) mask[p] = (strength[p] ?? 0) >= threshold ? 1 : 0;
  const grow = Math.max(0, Math.round(width) - 1);
  if (grow === 0) return mask;
  const { width: w, height: h } = image;
  let current = mask;
  for (let pass = 0; pass < grow; pass++) {
    const next = current.slice();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (current[y * w + x]) continue;
        if (
          (x > 0 && current[y * w + x - 1]) ||
          (x < w - 1 && current[y * w + x + 1]) ||
          (y > 0 && current[(y - 1) * w + x]) ||
          (y < h - 1 && current[(y + 1) * w + x])
        ) {
          next[y * w + x] = 1;
        }
      }
    }
    current = next;
  }
  return current;
}

export interface OutlineOptions extends FilterOptions {
  /** Edge strength (0-255) a pixel needs to be drawn as a line. Lower finds more edges. Default 30. */
  threshold?: number;
  /** Line thickness in pixels (at least 1). Default 1. */
  width?: number;
  /** Line colour. Default black. */
  color?: Rgb;
  /** Line opacity, 0-1. Default 1. */
  opacity?: number;
  /** What the lines are drawn on: the picture itself, plain white, or nothing (transparent). Default "image". */
  background?: "image" | "white" | "transparent";
}

/**
 * Draws coloured lines along the picture's edges, from subtle outlines to
 * comic-style contours. The boundary of a transparent cutout counts as an
 * edge, so a cutout gets a sticker-style outline.
 */
export const outline: Filter<OutlineOptions> = (image, options) => {
  const threshold = options.threshold ?? 30;
  const color = options.color ?? [0, 0, 0];
  const opacity = clamp01(options.opacity ?? 1);
  const background = options.background ?? "image";
  const mask = edgeMask(image, threshold, options.width ?? 1);
  const output = cloneImageData(image);
  const data = output.data;
  for (let p = 0; p < mask.length; p++) {
    const i = p * 4;
    if (background === "white") {
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = 255;
    } else if (background === "transparent") {
      data[i + 3] = 0;
    }
    if (!mask[p]) continue;
    const currentAlpha = data[i + 3] ?? 0;
    const lineAlpha = opacity * 255;
    const visible = currentAlpha > 0;
    data[i] = visible ? lerp(data[i] ?? 0, color[0], opacity) : color[0];
    data[i + 1] = visible ? lerp(data[i + 1] ?? 0, color[1], opacity) : color[1];
    data[i + 2] = visible ? lerp(data[i + 2] ?? 0, color[2], opacity) : color[2];
    data[i + 3] = Math.max(currentAlpha, lineAlpha);
  }
  return output;
};

export interface ComicOptions extends FilterOptions {
  /** Colour levels per channel after posterizing (2-16). Default 4. */
  levels?: number;
  /** Edge strength (0-255) a pixel needs to be inked. Default 40. */
  edgeThreshold?: number;
  /** Ink line thickness in pixels (at least 1). Default 2. */
  lineWidth?: number;
  /** Ink colour. Default black. */
  ink?: Rgb;
}

/** Turns a photo into a cartoon illustration: posterized flat colour with ink outlines. */
export const comic: Filter<ComicOptions> = (image, options) => {
  const levels = Math.min(16, Math.max(2, Math.round(options.levels ?? 4)));
  const ink = options.ink ?? [0, 0, 0];
  const mask = edgeMask(image, options.edgeThreshold ?? 40, options.lineWidth ?? 2);
  const output = cloneImageData(image);
  const data = output.data;
  const step = 255 / (levels - 1);
  for (let p = 0; p < mask.length; p++) {
    const i = p * 4;
    if (mask[p]) {
      data[i] = ink[0];
      data[i + 1] = ink[1];
      data[i + 2] = ink[2];
      continue;
    }
    for (let c = 0; c < 3; c++) {
      data[i + c] = Math.round((data[i + c] ?? 0) / step) * step;
    }
  }
  return output;
};

export interface StippleOptions extends FilterOptions {
  /** Side in pixels of the cells the picture is sampled in. Default 6. */
  cellSize?: number;
  /** Dot radius in pixels. Default 0.8. */
  dotRadius?: number;
  /** Multiplier on how many dots are drawn. Default 1. */
  density?: number;
  /** Seed for the dot positions; the same seed gives the same picture. Default 1. */
  seed?: number;
  /** Dot colour. Default black. */
  ink?: Rgb;
  /** Paper colour. Default white. */
  paper?: Rgb;
}

/**
 * Stipple: renders tone as scattered dots, denser where the picture is darker,
 * like a traditional stippling illustration. Transparent pixels stay empty.
 */
export const stipple: Filter<StippleOptions> = (image, options) => {
  const cell = Math.max(2, Math.round(options.cellSize ?? 6));
  const radius = Math.max(0.3, options.dotRadius ?? 0.8);
  const density = Math.max(0, options.density ?? 1);
  const ink = options.ink ?? [0, 0, 0];
  const paper = options.paper ?? [255, 255, 255];
  const random = createRandom(options.seed ?? 1);
  const { width, height, data: source } = image;
  const output = cloneImageData(image);
  const data = output.data;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = paper[0];
    data[i + 1] = paper[1];
    data[i + 2] = paper[2];
  }
  const dotArea = Math.PI * radius * radius;

  for (let cy = 0; cy < height; cy += cell) {
    for (let cx = 0; cx < width; cx += cell) {
      const endX = Math.min(width, cx + cell);
      const endY = Math.min(height, cy + cell);
      let tone = 0;
      let weight = 0;
      for (let y = cy; y < endY; y++) {
        for (let x = cx; x < endX; x++) {
          const i = (y * width + x) * 4;
          const alpha = (source[i + 3] ?? 0) / 255;
          tone += luma(source[i] ?? 0, source[i + 1] ?? 0, source[i + 2] ?? 0) * alpha;
          weight += alpha;
        }
      }
      if (weight === 0) continue;
      const darkness = 1 - tone / weight / 255;
      const expected = (darkness * density * (endX - cx) * (endY - cy) * 0.5) / dotArea;
      let dots = Math.floor(expected);
      if (random() < expected - dots) dots++;

      for (let d = 0; d < dots; d++) {
        const dx = cx + random() * (endX - cx);
        const dy = cy + random() * (endY - cy);
        const minX = Math.max(0, Math.floor(dx - radius));
        const maxX = Math.min(width - 1, Math.ceil(dx + radius));
        const minY = Math.max(0, Math.floor(dy - radius));
        const maxY = Math.min(height - 1, Math.ceil(dy + radius));
        for (let y = minY; y <= maxY; y++) {
          for (let x = minX; x <= maxX; x++) {
            if (Math.hypot(x + 0.5 - dx, y + 0.5 - dy) > radius) continue;
            const i = (y * width + x) * 4;
            if ((source[i + 3] ?? 0) === 0) continue;
            data[i] = ink[0];
            data[i + 1] = ink[1];
            data[i + 2] = ink[2];
          }
        }
      }
    }
  }
  return output;
};

/**
 * A 3D colour look-up table: `size`³ output colours (each channel 0-1), stored
 * red-fastest then green then blue, the order of an Adobe `.cube` file.
 */
export interface ColorLut {
  size: number;
  data: Float32Array;
}

/** Builds a LUT by evaluating `transform` (0-1 in, 0-1 out per channel) at each grid point. */
export function createColorLut(
  size: number,
  transform: (r: number, g: number, b: number) => Rgb,
): ColorLut {
  const data = new Float32Array(size * size * size * 3);
  let index = 0;
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const [or, og, ob] = transform(r / (size - 1), g / (size - 1), b / (size - 1));
        data[index++] = clamp01(or);
        data[index++] = clamp01(og);
        data[index++] = clamp01(ob);
      }
    }
  }
  return { size, data };
}

/** Parses an Adobe/Resolve `.cube` 3D LUT. Throws an Error naming the problem if it can't be read. */
export function parseCubeLut(text: string): ColorLut {
  let size = 0;
  let domainMin: Rgb = [0, 0, 0];
  let domainMax: Rgb = [1, 1, 1];
  const values: number[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#") || line.startsWith("TITLE")) continue;
    const parts = line.split(/\s+/);
    const keyword = parts[0] ?? "";
    if (keyword === "LUT_3D_SIZE") {
      size = Number(parts[1]);
    } else if (keyword === "LUT_1D_SIZE") {
      throw new Error("1D .cube LUTs are not supported; use a 3D LUT (LUT_3D_SIZE).");
    } else if (keyword === "DOMAIN_MIN" || keyword === "DOMAIN_MAX") {
      const triple: Rgb = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
      if (triple.some((value) => !Number.isFinite(value))) {
        throw new Error(`Invalid ${keyword} line in .cube LUT: "${line}".`);
      }
      if (keyword === "DOMAIN_MIN") domainMin = triple;
      else domainMax = triple;
    } else if (/^[-+0-9.]/.test(keyword)) {
      const triple = [Number(parts[0]), Number(parts[1]), Number(parts[2])];
      if (triple.some((value) => !Number.isFinite(value))) {
        throw new Error(`Invalid colour row in .cube LUT: "${line}".`);
      }
      values.push(...triple);
    }
  }
  if (!Number.isInteger(size) || size < 2) {
    throw new Error("The .cube LUT has no valid LUT_3D_SIZE line (an integer of at least 2).");
  }
  const expected = size * size * size * 3;
  if (values.length !== expected) {
    throw new Error(
      `The .cube LUT declares size ${size}, which needs ${expected / 3} colour rows, but ${values.length / 3} were found.`,
    );
  }
  const data = new Float32Array(expected);
  for (let i = 0; i < expected; i++) {
    const channel = i % 3;
    const min = domainMin[channel] ?? 0;
    const max = domainMax[channel] ?? 1;
    data[i] = clamp01(((values[i] ?? 0) - min) / (max - min || 1));
  }
  return { size, data };
}

/** Looks up (r, g, b) in `lut` (all 0-1) with trilinear interpolation. */
function sampleLut(lut: ColorLut, r: number, g: number, b: number): Rgb {
  const { size, data } = lut;
  const top = size - 1;
  const fr = clamp01(r) * top;
  const fg = clamp01(g) * top;
  const fb = clamp01(b) * top;
  const r0 = Math.min(top - 1, Math.floor(fr));
  const g0 = Math.min(top - 1, Math.floor(fg));
  const b0 = Math.min(top - 1, Math.floor(fb));
  const tr = fr - r0;
  const tg = fg - g0;
  const tb = fb - b0;
  const at = (ri: number, gi: number, bi: number, channel: number): number =>
    data[((bi * size + gi) * size + ri) * 3 + channel] ?? 0;
  const out: Rgb = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const c00 = lerp(at(r0, g0, b0, c), at(r0 + 1, g0, b0, c), tr);
    const c10 = lerp(at(r0, g0 + 1, b0, c), at(r0 + 1, g0 + 1, b0, c), tr);
    const c01 = lerp(at(r0, g0, b0 + 1, c), at(r0 + 1, g0, b0 + 1, c), tr);
    const c11 = lerp(at(r0, g0 + 1, b0 + 1, c), at(r0 + 1, g0 + 1, b0 + 1, c), tr);
    out[c] = lerp(lerp(c00, c10, tg), lerp(c01, c11, tg), tb);
  }
  return out;
}

export type LutPresetName = "teal-orange" | "warm-film" | "cool" | "noir" | "vivid";

/** The built-in grading looks, each a function of 0-1 colour. */
const LUT_PRESET_TRANSFORMS: Record<LutPresetName, (r: number, g: number, b: number) => Rgb> = {
  "teal-orange": (r, g, b) => {
    const light = luma(r, g, b);
    const shadow = 1 - light;
    return [
      r + 0.1 * light - 0.08 * shadow,
      g + 0.02 * light + 0.02 * shadow,
      b - 0.1 * light + 0.1 * shadow,
    ];
  },
  "warm-film": (r, g, b) => [0.06 + r * 0.9 + 0.03, 0.05 + g * 0.88, 0.05 + b * 0.78],
  cool: (r, g, b) => [r * 0.94, g * 0.99 + 0.01, b * 1.0 + 0.06],
  noir: (r, g, b) => {
    const light = luma(r, g, b);
    const curved = light < 0.5 ? 2 * light * light : 1 - 2 * (1 - light) * (1 - light);
    return [curved, curved, curved];
  },
  vivid: (r, g, b) => {
    const light = luma(r, g, b);
    return [light + (r - light) * 1.4, light + (g - light) * 1.4, light + (b - light) * 1.4];
  },
};

/** Names of the built-in LUT looks, in display order. */
export const LUT_PRESET_NAMES: readonly LutPresetName[] = [
  "teal-orange",
  "warm-film",
  "cool",
  "noir",
  "vivid",
];

const presetCache = new Map<LutPresetName, ColorLut>();

/** Returns the built-in LUT for a preset look (built once, then cached). */
export function getLutPreset(name: LutPresetName): ColorLut {
  let lut = presetCache.get(name);
  if (!lut) {
    lut = createColorLut(17, LUT_PRESET_TRANSFORMS[name]);
    presetCache.set(name, lut);
  }
  return lut;
}

export interface ColorLutOptions extends FilterOptions {
  /** A LUT to apply (for example from {@link parseCubeLut}). Takes priority over `preset`. */
  lut?: ColorLut;
  /** A built-in look to apply when no `lut` is given. Default "teal-orange". */
  preset?: LutPresetName;
  /** 0 = unchanged, 1 = full effect. Default 1. */
  strength?: number;
}

/** Applies a 3D colour LUT (a built-in look or a loaded `.cube`) for one-click colour grading. */
export const colorLut: Filter<ColorLutOptions> = (image, options) => {
  const lut = options.lut ?? getLutPreset(options.preset ?? "teal-orange");
  const strength = clamp01(options.strength ?? 1);
  const output = cloneImageData(image);
  const data = output.data;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;
    const [lr, lg, lb] = sampleLut(lut, r / 255, g / 255, b / 255);
    data[i] = lerp(r, lr * 255, strength);
    data[i + 1] = lerp(g, lg * 255, strength);
    data[i + 2] = lerp(b, lb * 255, strength);
  }
  return output;
};
