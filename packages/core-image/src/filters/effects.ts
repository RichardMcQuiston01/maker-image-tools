import type { Filter, FilterOptions } from "../types.js";
import { cloneImageData } from "../pixel.js";

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

/** An sRGB colour as [red, green, blue], each 0-255. */
export type Rgb = [number, number, number];

function gaussianKernel(sigma: number): Float64Array {
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const kernel = new Float64Array(radius * 2 + 1);
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const weight = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel[i + radius] = weight;
    sum += weight;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] = (kernel[i] ?? 0) / sum;
  return kernel;
}

/**
 * Separable Gaussian blur over premultiplied RGBA, clamping at the borders.
 * Premultiplying means a transparent pixel's colour never bleeds into its
 * opaque neighbours, so cutouts blur cleanly. Returns un-premultiplied bytes.
 */
function blurRgba(image: ImageData, sigma: number): Uint8ClampedArray<ArrayBuffer> {
  const { width, height, data } = image;
  const kernel = gaussianKernel(sigma);
  const radius = (kernel.length - 1) / 2;
  const count = width * height;

  let current = new Float32Array(count * 4);
  for (let p = 0; p < count; p++) {
    const alpha = (data[p * 4 + 3] ?? 0) / 255;
    current[p * 4] = (data[p * 4] ?? 0) * alpha;
    current[p * 4 + 1] = (data[p * 4 + 1] ?? 0) * alpha;
    current[p * 4 + 2] = (data[p * 4 + 2] ?? 0) * alpha;
    current[p * 4 + 3] = alpha * 255;
  }

  for (const horizontal of [true, false]) {
    const next = new Float32Array(count * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        for (let k = -radius; k <= radius; k++) {
          const sx = horizontal ? Math.min(width - 1, Math.max(0, x + k)) : x;
          const sy = horizontal ? y : Math.min(height - 1, Math.max(0, y + k));
          const weight = kernel[k + radius] ?? 0;
          const i = (sy * width + sx) * 4;
          r += (current[i] ?? 0) * weight;
          g += (current[i + 1] ?? 0) * weight;
          b += (current[i + 2] ?? 0) * weight;
          a += (current[i + 3] ?? 0) * weight;
        }
        const o = (y * width + x) * 4;
        next[o] = r;
        next[o + 1] = g;
        next[o + 2] = b;
        next[o + 3] = a;
      }
    }
    current = next;
  }

  const output = new Uint8ClampedArray(new ArrayBuffer(count * 4));
  for (let p = 0; p < count; p++) {
    const alpha = (current[p * 4 + 3] ?? 0) / 255;
    const scale = alpha > 0 ? 1 / alpha : 0;
    output[p * 4] = (current[p * 4] ?? 0) * scale;
    output[p * 4 + 1] = (current[p * 4 + 1] ?? 0) * scale;
    output[p * 4 + 2] = (current[p * 4 + 2] ?? 0) * scale;
    output[p * 4 + 3] = alpha * 255;
  }
  return output;
}

export interface GaussianBlurOptions extends FilterOptions {
  /** Standard deviation in pixels. 0 returns an unchanged copy. Default 2. */
  sigma?: number;
}

/** Gaussian blur: the standard bell-shaped falloff, ideal for soft defocus. */
export const gaussianBlur: Filter<GaussianBlurOptions> = (image, options) => {
  const sigma = options.sigma ?? 2;
  if (!(sigma > 0)) return cloneImageData(image);
  return new ImageData(blurRgba(image, sigma), image.width, image.height);
};

export interface HighPassOptions extends FilterOptions {
  /** Standard deviation of the blur that is subtracted. Default 3. */
  sigma?: number;
  /** Multiplier on the extracted detail. Default 1. */
  amount?: number;
}

/**
 * High pass: the image minus a blurred copy, centred on mid-grey, which keeps
 * edges and fine detail and drops the broad tones. Alpha is left as it was.
 */
export const highPass: Filter<HighPassOptions> = (image, options) => {
  const sigma = options.sigma ?? 3;
  const amount = options.amount ?? 1;
  const output = cloneImageData(image);
  const blurred = sigma > 0 ? blurRgba(image, sigma) : null;
  const data = output.data;
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const original = data[i + c] ?? 0;
      const base = blurred ? (blurred[i + c] ?? 0) : original;
      data[i + c] = 128 + (original - base) * amount;
    }
  }
  return output;
};

export interface SepiaOptions extends FilterOptions {
  /** 0 = unchanged, 1 = full sepia. Default 1. */
  amount?: number;
}

/** Classic sepia tone for an antique-photograph look. */
export const sepia: Filter<SepiaOptions> = (image, options) => {
  const amount = clamp01(options.amount ?? 1);
  const output = cloneImageData(image);
  const data = output.data;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;
    const sr = r * 0.393 + g * 0.769 + b * 0.189;
    const sg = r * 0.349 + g * 0.686 + b * 0.168;
    const sb = r * 0.272 + g * 0.534 + b * 0.131;
    data[i] = lerp(r, sr, amount);
    data[i + 1] = lerp(g, sg, amount);
    data[i + 2] = lerp(b, sb, amount);
  }
  return output;
};

export interface AlphaThresholdOptions extends FilterOptions {
  /** Alpha at or above this (0-255) becomes fully opaque, below becomes transparent. Default 128. */
  threshold?: number;
}

/** Makes semi-transparent pixels fully opaque or fully transparent, for crisp sticker-style cutouts. */
export const alphaThreshold: Filter<AlphaThresholdOptions> = (image, options) => {
  const threshold = options.threshold ?? 128;
  const output = cloneImageData(image);
  const data = output.data;
  for (let i = 3; i < data.length; i += 4) {
    data[i] = (data[i] ?? 0) >= threshold ? 255 : 0;
  }
  return output;
};

export interface PixelateOptions extends FilterOptions {
  /** Side of each block in pixels (rounded, at least 1). Default 8. */
  blockSize?: number;
}

/** Reduces the image to large flat blocks, each the average of the pixels it covers. */
export const pixelate: Filter<PixelateOptions> = (image, options) => {
  const block = Math.max(1, Math.round(options.blockSize ?? 8));
  const output = cloneImageData(image);
  if (block === 1) return output;
  const { width, height } = image;
  const source = image.data;
  const data = output.data;
  for (let by = 0; by < height; by += block) {
    for (let bx = 0; bx < width; bx += block) {
      const endY = Math.min(height, by + block);
      const endX = Math.min(width, bx + block);
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let y = by; y < endY; y++) {
        for (let x = bx; x < endX; x++) {
          const i = (y * width + x) * 4;
          const alpha = source[i + 3] ?? 0;
          r += (source[i] ?? 0) * alpha;
          g += (source[i + 1] ?? 0) * alpha;
          b += (source[i + 2] ?? 0) * alpha;
          a += alpha;
        }
      }
      const pixels = (endY - by) * (endX - bx);
      const scale = a > 0 ? 1 / a : 0;
      const fill = [r * scale, g * scale, b * scale, a / pixels];
      for (let y = by; y < endY; y++) {
        for (let x = bx; x < endX; x++) {
          const i = (y * width + x) * 4;
          data[i] = fill[0] ?? 0;
          data[i + 1] = fill[1] ?? 0;
          data[i + 2] = fill[2] ?? 0;
          data[i + 3] = fill[3] ?? 0;
        }
      }
    }
  }
  return output;
};

export interface DuotoneOptions extends FilterOptions {
  /** Colour for the darkest tones. Default midnight blue. */
  shadow?: Rgb;
  /** Colour for the brightest tones. Default warm cream. */
  highlight?: Rgb;
}

/** Maps brightness onto a two-colour gradient, for a graphic poster or branding look. */
export const duotone: Filter<DuotoneOptions> = (image, options) => {
  const shadow = options.shadow ?? [25, 25, 112];
  const highlight = options.highlight ?? [255, 214, 140];
  const output = cloneImageData(image);
  const data = output.data;
  for (let i = 0; i < data.length; i += 4) {
    const luminance =
      ((data[i] ?? 0) * 0.299 + (data[i + 1] ?? 0) * 0.587 + (data[i + 2] ?? 0) * 0.114) / 255;
    data[i] = lerp(shadow[0], highlight[0], luminance);
    data[i + 1] = lerp(shadow[1], highlight[1], luminance);
    data[i + 2] = lerp(shadow[2], highlight[2], luminance);
  }
  return output;
};

export interface CrossProcessOptions extends FilterOptions {
  /** 0 = unchanged, 1 = full effect. Default 1. */
  strength?: number;
}

/** Smooth S-curve on 0-1 with `contrast` > 1 steepening the middle. */
function sCurve(value: number, contrast: number): number {
  const centred = value * 2 - 1;
  const shaped = Math.sign(centred) * Math.pow(Math.abs(centred), 1 / contrast);
  return (shaped + 1) / 2;
}

/**
 * Cross process: the vivid, colour-shifted look of film developed in the
 * wrong chemicals. Red gains contrast, green a little, and blue is lifted in
 * the shadows and held back in the highlights.
 */
export const crossProcess: Filter<CrossProcessOptions> = (image, options) => {
  const strength = clamp01(options.strength ?? 1);
  const redLut = new Float32Array(256);
  const greenLut = new Float32Array(256);
  const blueLut = new Float32Array(256);
  for (let v = 0; v < 256; v++) {
    const unit = v / 255;
    redLut[v] = sCurve(unit, 1.6) * 255;
    greenLut[v] = sCurve(unit, 1.2) * 255;
    blueLut[v] = (0.16 + unit * 0.68) * 255;
  }
  const output = cloneImageData(image);
  const data = output.data;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;
    data[i] = lerp(r, redLut[r] ?? r, strength);
    data[i + 1] = lerp(g, greenLut[g] ?? g, strength);
    data[i + 2] = lerp(b, blueLut[b] ?? b, strength);
  }
  return output;
};
