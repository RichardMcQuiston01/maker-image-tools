import { createImageData } from "@maker/core-image";
import type { BBox } from "./metrics.js";

export interface ShapeFixture {
  image: ImageData;
  groundTruthMask: boolean[];
  groundTruthBBox: BBox;
}

/**
 * A solid-colored circle on a contrasting background, with an exactly-known
 * ground-truth mask and bounding box (computed directly from the same math
 * that drew the circle, not measured after the fact) — lets a segmentation
 * or crop model's real output be scored against a precise target without
 * needing a hand-labeled or copyrighted photo.
 */
export function createCircleFixture(width: number, height: number): ShapeFixture {
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) / 3;
  const image = createImageData(width, height);
  const data = image.data;
  const groundTruthMask = new Array<boolean>(width * height);

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const inCircle = (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius;
      groundTruthMask[y * width + x] = inCircle;
      if (inCircle) {
        data[i] = 220;
        data[i + 1] = 40;
        data[i + 2] = 40;
        data[i + 3] = 255;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      } else {
        data[i] = 250;
        data[i + 1] = 250;
        data[i + 2] = 250;
        data[i + 3] = 255;
      }
    }
  }

  return {
    image,
    groundTruthMask,
    groundTruthBBox: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
  };
}

/**
 * A concentric-ring gradient plus a vertical stripe pattern — fine but
 * still photograph-plausible detail (unlike a raw per-pixel checkerboard,
 * which is Nyquist-rate noise no natural-image-trained model would try to
 * preserve). Used as the "ground truth" a downsampled copy is upscaled back
 * toward, to score how much detail the upscaler recovers/adds.
 */
export function createDetailFixture(width: number, height: number, ringPeriod = 5): ImageData {
  const image = createImageData(width, height);
  const data = image.data;
  const cx = width / 2;
  const cy = height / 2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const dx = x - cx;
      const dy = y - cy;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const ring = Math.sin(distance / ringPeriod) * 0.5 + 0.5;
      const value = Math.round(ring * 255);
      data[i] = value;
      data[i + 1] = 255 - value;
      data[i + 2] = Math.round((Math.sin(x / 6) * 0.5 + 0.5) * 255);
      data[i + 3] = 255;
    }
  }
  return image;
}
