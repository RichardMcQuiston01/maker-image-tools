export interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Intersection-over-union between a predicted per-pixel foreground
 * probability map (thresholded) and a known ground-truth boolean mask of the
 * same length. 1.0 is a perfect match, 0.0 is no overlap at all.
 */
export function maskIoU(
  predicted: ArrayLike<number>,
  groundTruth: ArrayLike<boolean>,
  threshold = 0.5,
): number {
  let intersection = 0;
  let union = 0;
  for (let i = 0; i < groundTruth.length; i++) {
    const predictedPositive = (predicted[i] ?? 0) >= threshold;
    const truePositive = groundTruth[i] ?? false;
    if (predictedPositive || truePositive) union++;
    if (predictedPositive && truePositive) intersection++;
  }
  return union === 0 ? 1 : intersection / union;
}

/** Intersection-over-union between two axis-aligned bounding boxes. */
export function bboxIoU(a: BBox, b: BBox): number {
  const interX1 = Math.max(a.x, b.x);
  const interY1 = Math.max(a.y, b.y);
  const interX2 = Math.min(a.x + a.width, b.x + b.width);
  const interY2 = Math.min(a.y + a.height, b.y + b.height);

  const intersection = Math.max(0, interX2 - interX1) * Math.max(0, interY2 - interY1);
  const union = a.width * a.height + b.width * b.height - intersection;

  return union === 0 ? 1 : intersection / union;
}

/**
 * Variance of the discrete Laplacian over a grayscale copy of `image` — a
 * classic, simple blur/sharpness metric (higher = more high-frequency
 * detail present, lower = smoother/blurrier).
 *
 * This is what the upscale quality gate scores instead of pixel-accuracy
 * metrics like PSNR/SSIM: `@maker/ai-tools`'s upscaler is a GAN-based
 * (ESRGAN) super-resolution model, and those are trained to hallucinate
 * plausible-looking fine detail rather than to minimize per-pixel error
 * against the true source — calibration against this repo's own vendored
 * model confirmed it scores *worse* than naive bilinear upsampling on PSNR
 * (an expected, well-documented property of GAN-based super-resolution, not
 * a bug) while consistently producing far sharper output. Sharpness-vs-naive
 * is the metric that actually reflects what this feature is for.
 */
export function sharpness(image: ImageData): number {
  const { width, height, data } = image;
  const gray = new Float64Array(width * height);
  for (let i = 0; i < width * height; i++) {
    gray[i] =
      0.299 * (data[i * 4] ?? 0) + 0.587 * (data[i * 4 + 1] ?? 0) + 0.114 * (data[i * 4 + 2] ?? 0);
  }

  const laplacian: number[] = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const center = gray[y * width + x] ?? 0;
      const up = gray[(y - 1) * width + x] ?? 0;
      const down = gray[(y + 1) * width + x] ?? 0;
      const left = gray[y * width + x - 1] ?? 0;
      const right = gray[y * width + x + 1] ?? 0;
      laplacian.push(up + down + left + right - 4 * center);
    }
  }

  const mean = laplacian.reduce((sum, value) => sum + value, 0) / laplacian.length;
  return laplacian.reduce((sum, value) => sum + (value - mean) ** 2, 0) / laplacian.length;
}
