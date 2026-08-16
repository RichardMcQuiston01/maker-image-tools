import type { Filter, FilterOptions } from "../types.js";
import { createImageData, getPixel, setPixel } from "../pixel.js";

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.trunc(clamp(value, min, max));
}

export interface CropOptions extends FilterOptions {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export const crop: Filter<CropOptions> = (image, options) => {
  const x = clampInt(options.x ?? 0, 0, image.width);
  const y = clampInt(options.y ?? 0, 0, image.height);
  const requestedWidth = options.width ?? image.width;
  const requestedHeight = options.height ?? image.height;
  const width = clampInt(requestedWidth, 0, image.width - x);
  const height = clampInt(requestedHeight, 0, image.height - y);

  const output = createImageData(width, height);
  for (let dy = 0; dy < height; dy++) {
    for (let dx = 0; dx < width; dx++) {
      setPixel(output, dx, dy, getPixel(image, x + dx, y + dy));
    }
  }
  return output;
};

/** Bilinear-sample `image` at fractional coordinates, falling back to `background` outside its bounds. */
function sampleBilinear(
  image: ImageData,
  sx: number,
  sy: number,
  background: [number, number, number, number],
): [number, number, number, number] {
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const tx = sx - x0;
  const ty = sy - y0;

  const inBounds = (px: number, py: number) => px >= 0 && px < image.width && py >= 0 && py < image.height;

  const p00 = inBounds(x0, y0) ? getPixel(image, x0, y0) : background;
  const p10 = inBounds(x1, y0) ? getPixel(image, x1, y0) : background;
  const p01 = inBounds(x0, y1) ? getPixel(image, x0, y1) : background;
  const p11 = inBounds(x1, y1) ? getPixel(image, x1, y1) : background;

  const result: [number, number, number, number] = [0, 0, 0, 0];
  for (let c = 0; c < 4; c++) {
    const top = (p00[c] ?? 0) + ((p10[c] ?? 0) - (p00[c] ?? 0)) * tx;
    const bottom = (p01[c] ?? 0) + ((p11[c] ?? 0) - (p01[c] ?? 0)) * tx;
    result[c] = top + (bottom - top) * ty;
  }
  return result;
}

/** Bilinear-sample `image` at fractional coordinates, clamping to the edge pixel outside its bounds. */
function sampleBilinearClamped(image: ImageData, sx: number, sy: number): [number, number, number, number] {
  const x0 = clampInt(Math.floor(sx), 0, image.width - 1);
  const y0 = clampInt(Math.floor(sy), 0, image.height - 1);
  const x1 = clampInt(x0 + 1, 0, image.width - 1);
  const y1 = clampInt(y0 + 1, 0, image.height - 1);
  const tx = clamp(sx, 0, image.width - 1) - x0;
  const ty = clamp(sy, 0, image.height - 1) - y0;

  const p00 = getPixel(image, x0, y0);
  const p10 = getPixel(image, x1, y0);
  const p01 = getPixel(image, x0, y1);
  const p11 = getPixel(image, x1, y1);

  const result: [number, number, number, number] = [0, 0, 0, 0];
  for (let c = 0; c < 4; c++) {
    const top = (p00[c] ?? 0) + ((p10[c] ?? 0) - (p00[c] ?? 0)) * tx;
    const bottom = (p01[c] ?? 0) + ((p11[c] ?? 0) - (p01[c] ?? 0)) * tx;
    result[c] = top + (bottom - top) * ty;
  }
  return result;
}

export interface RotateOptions extends FilterOptions {
  degrees?: number;
  backgroundColor?: [number, number, number, number];
}

export const rotate: Filter<RotateOptions> = (image, options) => {
  const degrees = options.degrees ?? 90;
  const backgroundColor = options.backgroundColor ?? [255, 255, 255, 255];
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  // Bounding box of the rotated source rectangle, big enough to contain it fully.
  const newWidth = Math.max(1, Math.round(Math.abs(image.width * cos) + Math.abs(image.height * sin)));
  const newHeight = Math.max(1, Math.round(Math.abs(image.width * sin) + Math.abs(image.height * cos)));

  const srcCx = image.width / 2;
  const srcCy = image.height / 2;
  const dstCx = newWidth / 2;
  const dstCy = newHeight / 2;

  // Inverse rotation (by -degrees) to map each destination pixel back into source space.
  const cosInv = Math.cos(-radians);
  const sinInv = Math.sin(-radians);

  const output = createImageData(newWidth, newHeight);
  for (let dy = 0; dy < newHeight; dy++) {
    for (let dx = 0; dx < newWidth; dx++) {
      const ox = dx + 0.5 - dstCx;
      const oy = dy + 0.5 - dstCy;
      const sx = ox * cosInv - oy * sinInv + srcCx - 0.5;
      const sy = ox * sinInv + oy * cosInv + srcCy - 0.5;
      setPixel(output, dx, dy, sampleBilinear(image, sx, sy, backgroundColor));
    }
  }
  return output;
};

export interface ResizeOptions extends FilterOptions {
  width?: number;
  height?: number;
  method?: "nearest" | "bilinear";
}

export const resize: Filter<ResizeOptions> = (image, options) => {
  const width = Math.max(1, Math.round(options.width ?? image.width * 0.5));
  const height = Math.max(1, Math.round(options.height ?? image.height * 0.5));
  const method = options.method ?? "bilinear";

  const scaleX = image.width / width;
  const scaleY = image.height / height;

  const output = createImageData(width, height);
  for (let dy = 0; dy < height; dy++) {
    for (let dx = 0; dx < width; dx++) {
      if (method === "nearest") {
        const sx = clampInt(Math.floor((dx + 0.5) * scaleX), 0, image.width - 1);
        const sy = clampInt(Math.floor((dy + 0.5) * scaleY), 0, image.height - 1);
        setPixel(output, dx, dy, getPixel(image, sx, sy));
      } else {
        const sx = clamp((dx + 0.5) * scaleX - 0.5, 0, image.width - 1);
        const sy = clamp((dy + 0.5) * scaleY - 0.5, 0, image.height - 1);
        setPixel(output, dx, dy, sampleBilinearClamped(image, sx, sy));
      }
    }
  }
  return output;
};
