import type { Filter, FilterOptions } from "../types.js";
import { createImageData, getPixel } from "../pixel.js";

/** Options shared by every error-diffusion dithering filter. */
export interface DitherOptions extends FilterOptions {
  /** Grayscale cutoff (0-255) above which a pixel is quantized to white. Defaults to 128. */
  threshold?: number;
}

/** Options for Bayer (ordered) dithering. */
export interface BayerDitherOptions extends FilterOptions {
  /** Size of the (square) Bayer matrix. Defaults to 4. */
  matrixSize?: 2 | 4 | 8;
}

/** Options for blue-noise (ordered) dithering. Currently no tunable fields. */
export type BlueNoiseDitherOptions = FilterOptions;

const DEFAULT_THRESHOLD = 128;

/** A single error-diffusion tap: propagate `weight` (already normalized, 0-1) of the
 * quantization error to the neighbor at (x+dx, y+dy). */
interface DiffusionTap {
  dx: number;
  dy: number;
  weight: number;
}

/** Builds a kernel of normalized weights from integer numerators and a shared divisor. */
function buildKernel(divisor: number, taps: Array<[number, number, number]>): DiffusionTap[] {
  return taps.map(([dx, dy, numerator]) => ({ dx, dy, weight: numerator / divisor }));
}

function luma(r: number, g: number, b: number): number {
  return r * 0.299 + g * 0.587 + b * 0.114;
}

/** Converts image to a working grayscale buffer (one float per pixel, 0-255 range). */
function toGrayscaleBuffer(image: ImageData): Float32Array {
  const { width, height, data } = image;
  const gray = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const p = i;
      gray[y * width + x] = luma(data[p] ?? 0, data[p + 1] ?? 0, data[p + 2] ?? 0);
    }
  }
  return gray;
}

/** Writes a pure black/white pixel into `output` at `idx`, carrying over `image`'s alpha at (x, y). */
function writeBinaryPixel(
  output: ImageData,
  image: ImageData,
  x: number,
  y: number,
  idx: number,
  value: number,
): void {
  const [, , , a] = getPixel(image, x, y);
  const oi = idx * 4;
  output.data[oi] = value;
  output.data[oi + 1] = value;
  output.data[oi + 2] = value;
  output.data[oi + 3] = a;
}

/**
 * Shared error-diffusion engine. Walks the grayscale buffer left-to-right,
 * top-to-bottom, quantizing each pixel to 0/255 and pushing the resulting
 * error onto not-yet-visited neighbors per `kernel`. Out-of-bounds neighbors
 * are simply skipped (their share of the error is dropped at image edges).
 */
function diffuseErrorDither(
  image: ImageData,
  threshold: number,
  kernel: DiffusionTap[],
): ImageData {
  const { width, height } = image;
  const gray = toGrayscaleBuffer(image);
  const output = createImageData(width, height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const oldValue = gray[idx] ?? 0;
      const newValue = oldValue > threshold ? 255 : 0;
      const error = oldValue - newValue;

      writeBinaryPixel(output, image, x, y, idx, newValue);

      for (const tap of kernel) {
        const nx = x + tap.dx;
        const ny = y + tap.dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const nIdx = ny * width + nx;
        gray[nIdx] = (gray[nIdx] ?? 0) + error * tap.weight;
      }
    }
  }

  return output;
}

const FLOYD_STEINBERG_KERNEL = buildKernel(16, [
  [1, 0, 7],
  [-1, 1, 3],
  [0, 1, 5],
  [1, 1, 1],
]);

/** Floyd-Steinberg error-diffusion dithering (Floyd & Steinberg, 1976). */
export const ditherFloydSteinberg: Filter<DitherOptions> = (image, options) => {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  return diffuseErrorDither(image, threshold, FLOYD_STEINBERG_KERNEL);
};

const ATKINSON_KERNEL = buildKernel(8, [
  [1, 0, 1],
  [2, 0, 1],
  [-1, 1, 1],
  [0, 1, 1],
  [1, 1, 1],
  [0, 2, 1],
]);

/** Atkinson dithering (Bill Atkinson, Apple). Only diffuses 6/8 of the error,
 * which intentionally clips instead of fully spreading it, giving higher local contrast. */
export const ditherAtkinson: Filter<DitherOptions> = (image, options) => {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  return diffuseErrorDither(image, threshold, ATKINSON_KERNEL);
};

const JARVIS_JUDICE_NINKE_KERNEL = buildKernel(48, [
  [1, 0, 7],
  [2, 0, 5],
  [-2, 1, 3],
  [-1, 1, 5],
  [0, 1, 7],
  [1, 1, 5],
  [2, 1, 3],
  [-2, 2, 1],
  [-1, 2, 3],
  [0, 2, 5],
  [1, 2, 3],
  [2, 2, 1],
]);

/** Jarvis, Judice & Ninke error-diffusion dithering (1976). */
export const ditherJarvisJudiceNinke: Filter<DitherOptions> = (image, options) => {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  return diffuseErrorDither(image, threshold, JARVIS_JUDICE_NINKE_KERNEL);
};

const STUCKI_KERNEL = buildKernel(42, [
  [1, 0, 8],
  [2, 0, 4],
  [-2, 1, 2],
  [-1, 1, 4],
  [0, 1, 8],
  [1, 1, 4],
  [2, 1, 2],
  [-2, 2, 1],
  [-1, 2, 2],
  [0, 2, 4],
  [1, 2, 2],
  [2, 2, 1],
]);

/** Stucki error-diffusion dithering (1981). */
export const ditherStucki: Filter<DitherOptions> = (image, options) => {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  return diffuseErrorDither(image, threshold, STUCKI_KERNEL);
};

const SIERRA_KERNEL = buildKernel(32, [
  [1, 0, 5],
  [2, 0, 3],
  [-2, 1, 2],
  [-1, 1, 4],
  [0, 1, 5],
  [1, 1, 4],
  [2, 1, 2],
  [-1, 2, 2],
  [0, 2, 3],
  [1, 2, 2],
]);

/** Sierra error-diffusion dithering (Frankie Sierra). */
export const ditherSierra: Filter<DitherOptions> = (image, options) => {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  return diffuseErrorDither(image, threshold, SIERRA_KERNEL);
};

const BURKES_KERNEL = buildKernel(32, [
  [1, 0, 8],
  [2, 0, 4],
  [-2, 1, 2],
  [-1, 1, 4],
  [0, 1, 8],
  [1, 1, 4],
  [2, 1, 2],
]);

/** Burkes error-diffusion dithering (Daniel Burkes, 1988). */
export const ditherBurkes: Filter<DitherOptions> = (image, options) => {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  return diffuseErrorDither(image, threshold, BURKES_KERNEL);
};

/**
 * Recursively builds the NxN Bayer matrix (N a power of two) with entries
 * 0..N^2-1, using the standard blockwise construction:
 * M(2n) = [[4*M(n), 4*M(n)+2], [4*M(n)+3, 4*M(n)+1]]
 */
function buildBayerMatrix(size: number): number[][] {
  if (size === 2) {
    return [
      [0, 2],
      [3, 1],
    ];
  }
  const half = size / 2;
  const base = buildBayerMatrix(half);
  const matrix: number[][] = Array.from({ length: size }, () => new Array<number>(size).fill(0));
  for (let y = 0; y < half; y++) {
    for (let x = 0; x < half; x++) {
      const v = base[y]?.[x] ?? 0;
      matrix[y]![x] = 4 * v;
      matrix[y]![x + half] = 4 * v + 2;
      matrix[y + half]![x] = 4 * v + 3;
      matrix[y + half]![x + half] = 4 * v + 1;
    }
  }
  return matrix;
}

/** Builds an NxN matrix of 0-255 dithering thresholds from the raw Bayer matrix. */
function buildBayerThresholdMatrix(size: number): number[][] {
  const raw = buildBayerMatrix(size);
  const n2 = size * size;
  return raw.map((row) => row.map((value) => ((value + 0.5) / n2) * 255));
}

/** Bayer ordered dithering: compares each pixel against a tiled NxN threshold matrix. */
export const ditherBayer: Filter<BayerDitherOptions> = (image, options) => {
  const size = options.matrixSize ?? 4;
  const thresholds = buildBayerThresholdMatrix(size);
  const { width, height } = image;
  const gray = toGrayscaleBuffer(image);
  const output = createImageData(width, height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const value = gray[idx] ?? 0;
      const threshold = thresholds[y % size]?.[x % size] ?? 0;
      const newValue = value > threshold ? 255 : 0;

      writeBinaryPixel(output, image, x, y, idx, newValue);
    }
  }

  return output;
};

function fractional(v: number): number {
  return v - Math.floor(v);
}

/**
 * Blue-noise ordered dithering using Interleaved Gradient Noise (IGN) as a
 * cheap, real-time-graphics approximation of a true blue-noise texture --
 * this is not a void-and-cluster blue-noise dither, just visually similar.
 */
export const ditherBlueNoise: Filter<BlueNoiseDitherOptions> = (image) => {
  const { width, height } = image;
  const gray = toGrayscaleBuffer(image);
  const output = createImageData(width, height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const value = gray[idx] ?? 0;
      const threshold = 255 * fractional(52.9829189 * fractional(0.06711056 * x + 0.00583715 * y));
      const newValue = value > threshold ? 255 : 0;

      writeBinaryPixel(output, image, x, y, idx, newValue);
    }
  }

  return output;
};
