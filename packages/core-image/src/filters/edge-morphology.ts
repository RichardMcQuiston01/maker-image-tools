import type { Filter, FilterOptions } from "../types.js";
import { createImageData, getPixel, setPixel } from "../pixel.js";

/** Luma weights shared by every filter in this file that needs a grayscale value. */
function computeGrayscale(image: ImageData): Float64Array {
  const { width, height, data } = image;
  const gray = new Float64Array(width * height);
  for (let i = 0, p = 0; p < gray.length; i += 4, p++) {
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;
    gray[p] = r * 0.299 + g * 0.587 + b * 0.114;
  }
  return gray;
}

/** Foreground = dark pixel (grayscale below threshold). Used by erode/dilate/open/close. */
function computeForegroundMask(gray: Float64Array, threshold = 128): Uint8Array {
  const mask = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) {
    mask[i] = (gray[i] ?? 0) < threshold ? 1 : 0;
  }
  return mask;
}

function maskToImage(mask: Uint8Array, image: ImageData): ImageData {
  const { width, height } = image;
  const output = createImageData(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const alpha = getPixel(image, x, y)[3];
      const value = (mask[idx] ?? 0) ? 0 : 255;
      setPixel(output, x, y, [value, value, value, alpha]);
    }
  }
  return output;
}

function sampleGray(gray: Float64Array, width: number, height: number, x: number, y: number): number {
  const cx = x < 0 ? 0 : x >= width ? width - 1 : x;
  const cy = y < 0 ? 0 : y >= height ? height - 1 : y;
  return gray[cy * width + cx] ?? 0;
}

/** 3x3 Sobel gradients, clamped to the nearest edge pixel outside the image bounds. */
function computeSobelGradients(
  gray: Float64Array,
  width: number,
  height: number,
): { gx: Float64Array; gy: Float64Array; magnitude: Float64Array } {
  const size = width * height;
  const gx = new Float64Array(size);
  const gy = new Float64Array(size);
  const magnitude = new Float64Array(size);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p00 = sampleGray(gray, width, height, x - 1, y - 1);
      const p10 = sampleGray(gray, width, height, x, y - 1);
      const p20 = sampleGray(gray, width, height, x + 1, y - 1);
      const p01 = sampleGray(gray, width, height, x - 1, y);
      const p21 = sampleGray(gray, width, height, x + 1, y);
      const p02 = sampleGray(gray, width, height, x - 1, y + 1);
      const p12 = sampleGray(gray, width, height, x, y + 1);
      const p22 = sampleGray(gray, width, height, x + 1, y + 1);

      const idx = y * width + x;
      const sx = -p00 + p20 - 2 * p01 + 2 * p21 - p02 + p22;
      const sy = -p00 - 2 * p10 - p20 + p02 + 2 * p12 + p22;
      gx[idx] = sx;
      gy[idx] = sy;
      magnitude[idx] = Math.sqrt(sx * sx + sy * sy);
    }
  }

  return { gx, gy, magnitude };
}

function gaussianKernel1D(sigma: number): Float64Array {
  const safeSigma = sigma > 0 ? sigma : 1e-6;
  const radius = Math.ceil(3 * safeSigma);
  const size = 2 * radius + 1;
  const kernel = new Float64Array(size);
  let sum = 0;
  for (let i = 0; i < size; i++) {
    const d = i - radius;
    const w = Math.exp(-(d * d) / (2 * safeSigma * safeSigma));
    kernel[i] = w;
    sum += w;
  }
  for (let i = 0; i < size; i++) {
    kernel[i] = (kernel[i] ?? 0) / sum;
  }
  return kernel;
}

/** Separable Gaussian blur over a grayscale buffer, clamping at the image borders. */
function gaussianBlurGray(gray: Float64Array, width: number, height: number, sigma: number): Float64Array {
  const kernel = gaussianKernel1D(sigma);
  const radius = (kernel.length - 1) / 2;
  const temp = new Float64Array(width * height);
  const out = new Float64Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        const sx = x + k < 0 ? 0 : x + k >= width ? width - 1 : x + k;
        acc += (gray[y * width + sx] ?? 0) * (kernel[k + radius] ?? 0);
      }
      temp[y * width + x] = acc;
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        const sy = y + k < 0 ? 0 : y + k >= height ? height - 1 : y + k;
        acc += (temp[sy * width + x] ?? 0) * (kernel[k + radius] ?? 0);
      }
      out[y * width + x] = acc;
    }
  }

  return out;
}

export interface HalftoneOptions extends FilterOptions {
  /** Grid cell size in pixels. Default 8. */
  cellSize?: number;
  /** Screen rotation in degrees, applied around the image center. Default 0. */
  angle?: number;
  /** Dot shape used to render darkness within each cell. Default "circle". */
  shape?: "circle" | "line";
}

interface CellStats {
  sum: number;
  count: number;
}

/**
 * Classic halftone screen: grayscales the image, then renders each grid cell
 * as a black dot/line sized proportionally to how dark that cell's source
 * pixels were on average. Output alpha is copied from the input and plays no
 * part in the darkness computation.
 */
export const halftone: Filter<HalftoneOptions> = (image, options) => {
  const cellSize = options.cellSize ?? 8;
  const angle = options.angle ?? 0;
  const shape = options.shape ?? "circle";
  const { width, height } = image;

  const gray = computeGrayscale(image);
  const cx = width / 2;
  const cy = height / 2;
  const rad = (angle * Math.PI) / 180;
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);

  // Rotate (x, y) into the grid's local frame so the cell grid itself appears
  // rotated by `angle` in image space.
  const toGridSpace = (x: number, y: number): [number, number] => {
    const dx = x - cx;
    const dy = y - cy;
    const u = dx * cosA + dy * sinA;
    const v = -dx * sinA + dy * cosA;
    return [u, v];
  };

  const cellStats = new Map<string, CellStats>();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [u, v] = toGridSpace(x + 0.5, y + 0.5);
      const cellX = Math.floor(u / cellSize);
      const cellY = Math.floor(v / cellSize);
      const key = `${cellX},${cellY}`;
      const value = gray[y * width + x] ?? 0;
      const stats = cellStats.get(key);
      if (stats) {
        stats.sum += value;
        stats.count += 1;
      } else {
        cellStats.set(key, { sum: value, count: 1 });
      }
    }
  }

  const output = createImageData(width, height);
  const half = cellSize / 2;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [u, v] = toGridSpace(x + 0.5, y + 0.5);
      const cellX = Math.floor(u / cellSize);
      const cellY = Math.floor(v / cellSize);
      const key = `${cellX},${cellY}`;
      const stats = cellStats.get(key);
      const avg = stats ? stats.sum / stats.count : 255;
      const darkness = 1 - avg / 255;

      const localU = u - cellX * cellSize;
      const localV = v - cellY * cellSize;

      let isBlack: boolean;
      if (shape === "line") {
        const thickness = cellSize * darkness;
        isBlack = Math.abs(localV - half) <= thickness / 2;
      } else {
        const radius = half * Math.sqrt(darkness);
        const dx = localU - half;
        const dy = localV - half;
        isBlack = dx * dx + dy * dy <= radius * radius;
      }

      const alpha = getPixel(image, x, y)[3];
      const rgb = isBlack ? 0 : 255;
      setPixel(output, x, y, [rgb, rgb, rgb, alpha]);
    }
  }

  return output;
};

export interface MorphologyOptions extends FilterOptions {
  /** Neighborhood radius; the structuring element is a (2r+1)x(2r+1) square. Default 1. */
  radius?: number;
}

/**
 * Binary erosion at threshold 128: a dark pixel survives only if every pixel
 * in its square neighborhood is also dark (out-of-bounds counts as
 * background). Output is pure black/white; alpha is copied from the input.
 */
export const erode: Filter<MorphologyOptions> = (image, options) => {
  const radius = options.radius ?? 1;
  const { width, height } = image;
  const mask = computeForegroundMask(computeGrayscale(image));
  const outMask = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let allForeground = true;
      for (let dy = -radius; dy <= radius && allForeground; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height || !(mask[ny * width + nx] ?? 0)) {
            allForeground = false;
            break;
          }
        }
      }
      outMask[y * width + x] = allForeground ? 1 : 0;
    }
  }

  return maskToImage(outMask, image);
};

/**
 * Binary dilation at threshold 128: a background pixel becomes foreground if
 * any pixel in its square neighborhood is dark. Output is pure black/white;
 * alpha is copied from the input.
 */
export const dilate: Filter<MorphologyOptions> = (image, options) => {
  const radius = options.radius ?? 1;
  const { width, height } = image;
  const mask = computeForegroundMask(computeGrayscale(image));
  const outMask = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let anyForeground = false;
      for (let dy = -radius; dy <= radius && !anyForeground; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height && (mask[ny * width + nx] ?? 0)) {
            anyForeground = true;
            break;
          }
        }
      }
      outMask[y * width + x] = anyForeground ? 1 : 0;
    }
  }

  return maskToImage(outMask, image);
};

/** Opening: erode then dilate, removing small isolated foreground specks. */
export const morphOpen: Filter<MorphologyOptions> = (image, options) => dilate(erode(image, options), options);

/** Closing: dilate then erode, filling small isolated background gaps. */
export const morphClose: Filter<MorphologyOptions> = (image, options) => erode(dilate(image, options), options);

export interface SobelEdgeOptions extends FilterOptions {
  /**
   * When provided, output is binarized: white where the gradient magnitude
   * is >= threshold, black otherwise. When omitted, output is the raw
   * grayscale magnitude map (clamped to 0-255).
   */
  threshold?: number;
}

/** Standard 3x3 Sobel edge detector on the grayscale image; alpha is copied from the input. */
export const sobelEdgeDetect: Filter<SobelEdgeOptions> = (image, options) => {
  const { width, height } = image;
  const gray = computeGrayscale(image);
  const { magnitude } = computeSobelGradients(gray, width, height);
  const threshold = options.threshold;
  const output = createImageData(width, height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const mag = Math.min(255, Math.max(0, magnitude[idx] ?? 0));
      const alpha = getPixel(image, x, y)[3];
      const value = threshold !== undefined ? (mag >= threshold ? 255 : 0) : Math.round(mag);
      setPixel(output, x, y, [value, value, value, alpha]);
    }
  }

  return output;
};

export interface CannyEdgeOptions extends FilterOptions {
  /** Magnitude (0-255 scale) below which a pixel is never an edge. Default 50. */
  lowThreshold?: number;
  /** Magnitude (0-255 scale) above which a pixel is always a strong edge. Default 100. */
  highThreshold?: number;
  /** Standard deviation of the Gaussian pre-blur. Default 1.4. */
  gaussianSigma?: number;
}

/**
 * Classic Canny pipeline: grayscale -> Gaussian blur -> Sobel gradients ->
 * non-maximum suppression -> double threshold + 8-connected hysteresis.
 * Output is pure black/white; alpha is copied from the input.
 */
export const cannyEdgeDetect: Filter<CannyEdgeOptions> = (image, options) => {
  const sigma = options.gaussianSigma ?? 1.4;
  const lowThreshold = options.lowThreshold ?? 50;
  const highThreshold = options.highThreshold ?? 100;
  const { width, height } = image;

  const gray = computeGrayscale(image);
  const blurred = gaussianBlurGray(gray, width, height, sigma);
  const { gx, gy, magnitude } = computeSobelGradients(blurred, width, height);

  const suppressed = new Float64Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const mag = magnitude[idx] ?? 0;
      let angle = (Math.atan2(gy[idx] ?? 0, gx[idx] ?? 0) * 180) / Math.PI;
      angle = ((angle % 180) + 180) % 180;

      // Quantize the gradient direction to 4 buckets (0/45/90/135deg) and
      // compare against the two neighbors that lie along that direction.
      let neighborA: number;
      let neighborB: number;
      if (angle < 22.5 || angle >= 157.5) {
        neighborA = x > 0 ? (magnitude[idx - 1] ?? 0) : 0;
        neighborB = x < width - 1 ? (magnitude[idx + 1] ?? 0) : 0;
      } else if (angle < 67.5) {
        neighborA = x < width - 1 && y > 0 ? (magnitude[idx - width + 1] ?? 0) : 0;
        neighborB = x > 0 && y < height - 1 ? (magnitude[idx + width - 1] ?? 0) : 0;
      } else if (angle < 112.5) {
        neighborA = y > 0 ? (magnitude[idx - width] ?? 0) : 0;
        neighborB = y < height - 1 ? (magnitude[idx + width] ?? 0) : 0;
      } else {
        neighborA = x > 0 && y > 0 ? (magnitude[idx - width - 1] ?? 0) : 0;
        neighborB = x < width - 1 && y < height - 1 ? (magnitude[idx + width + 1] ?? 0) : 0;
      }

      suppressed[idx] = mag >= neighborA && mag >= neighborB ? mag : 0;
    }
  }

  const strong = new Uint8Array(width * height);
  const weak = new Uint8Array(width * height);
  for (let i = 0; i < suppressed.length; i++) {
    const mag = suppressed[i] ?? 0;
    if (mag >= highThreshold) {
      strong[i] = 1;
    } else if (mag >= lowThreshold) {
      weak[i] = 1;
    }
  }

  const edge = new Uint8Array(width * height);
  const stack: number[] = [];
  for (let i = 0; i < strong.length; i++) {
    if (strong[i]) {
      edge[i] = 1;
      stack.push(i);
    }
  }
  while (stack.length > 0) {
    const idx = stack.pop();
    if (idx === undefined) continue;
    const x = idx % width;
    const y = (idx - x) / width;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const nidx = ny * width + nx;
        if (!edge[nidx] && weak[nidx]) {
          edge[nidx] = 1;
          stack.push(nidx);
        }
      }
    }
  }

  const output = createImageData(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const alpha = getPixel(image, x, y)[3];
      const value = edge[idx] ? 255 : 0;
      setPixel(output, x, y, [value, value, value, alpha]);
    }
  }

  return output;
};
