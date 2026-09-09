export type RgbColor = [number, number, number];

export interface QuantizeColorsOptions {
  /** Target number of color clusters. Default 6. Actual output may be fewer if the image has less color variety. */
  colorCount?: number;
}

export interface QuantizeColorsResult {
  /** Row-major palette index per pixel (index into `palette`). */
  labels: Uint8Array;
  /** Representative RGB color for each cluster, in the same order `labels` indexes into. */
  palette: RgbColor[];
}

const DEFAULT_COLOR_COUNT = 6;
// `labels` is a Uint8Array (one byte per pixel), so the palette can't exceed 256 entries anyway;
// capped well below that since a real multi-color trace/laser job rarely needs more than a
// couple dozen color layers.
const MAX_COLOR_COUNT = 64;

interface Bucket {
  /** Indices into the flat pixel list belonging to this bucket. */
  pixelIndices: number[];
}

/**
 * Median-cut color quantization: recursively splits the bucket with the
 * widest channel range at its median, until `colorCount` buckets exist (or
 * no bucket can be split further, e.g. an image with fewer distinct colors
 * than requested). Deterministic — unlike k-means, there's no random
 * initialization to make output vary between runs on the same input.
 */
export function quantizeColors(
  image: ImageData,
  options?: QuantizeColorsOptions,
): QuantizeColorsResult {
  const colorCount = Math.min(
    MAX_COLOR_COUNT,
    Math.max(1, Math.floor(options?.colorCount ?? DEFAULT_COLOR_COUNT)),
  );
  const { width, height, data } = image;
  const pixelCount = width * height;

  const r = new Uint8Array(pixelCount);
  const g = new Uint8Array(pixelCount);
  const b = new Uint8Array(pixelCount);
  for (let p = 0; p < pixelCount; p++) {
    r[p] = data[p * 4] ?? 0;
    g[p] = data[p * 4 + 1] ?? 0;
    b[p] = data[p * 4 + 2] ?? 0;
  }

  const allIndices = Array.from({ length: pixelCount }, (_, i) => i);
  const buckets: Bucket[] = [{ pixelIndices: allIndices }];

  while (buckets.length < colorCount) {
    const splitIndex = findWidestSplittableBucket(buckets, r, g, b);
    if (splitIndex === -1) break; // nothing left worth splitting (all buckets are single-color)

    const bucket = buckets[splitIndex] as Bucket;
    const [left, right] = splitBucket(bucket, r, g, b);
    buckets.splice(splitIndex, 1, left, right);
  }

  const palette: RgbColor[] = buckets.map((bucket) => averageColor(bucket, r, g, b));
  const labels = new Uint8Array(pixelCount);
  buckets.forEach((bucket, paletteIndex) => {
    for (const p of bucket.pixelIndices) {
      labels[p] = paletteIndex;
    }
  });

  return { labels, palette };
}

function channelRange(bucket: Bucket, channel: Uint8Array): number {
  let min = 255;
  let max = 0;
  for (const p of bucket.pixelIndices) {
    const v = channel[p] ?? 0;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return max - min;
}

function findWidestSplittableBucket(
  buckets: Bucket[],
  r: Uint8Array,
  g: Uint8Array,
  b: Uint8Array,
): number {
  let bestIndex = -1;
  let bestRange = 0;
  for (let i = 0; i < buckets.length; i++) {
    const bucket = buckets[i] as Bucket;
    if (bucket.pixelIndices.length < 2) continue;
    const range = Math.max(
      channelRange(bucket, r),
      channelRange(bucket, g),
      channelRange(bucket, b),
    );
    if (range > bestRange) {
      bestRange = range;
      bestIndex = i;
    }
  }
  return bestRange > 0 ? bestIndex : -1;
}

/**
 * Splits a bucket on its widest channel at that channel's *value* midpoint
 * (not a point-count median). A count-based median would fail to cleanly
 * separate e.g. pure red/green/blue blocks — R is bimodal (0 or 255) with a
 * 2:1 point-count skew toward 0, so a count-based split cuts through the
 * green/blue group instead of isolating red. A value-midpoint split always
 * separates the low and high ends of the range cleanly.
 */
function splitBucket(
  bucket: Bucket,
  r: Uint8Array,
  g: Uint8Array,
  b: Uint8Array,
): [Bucket, Bucket] {
  const rRange = channelRange(bucket, r);
  const gRange = channelRange(bucket, g);
  const bRange = channelRange(bucket, b);
  const widest = rRange >= gRange && rRange >= bRange ? r : gRange >= bRange ? g : b;

  let min = 255;
  let max = 0;
  for (const p of bucket.pixelIndices) {
    const v = widest[p] ?? 0;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const midpoint = (min + max) / 2;

  const left: number[] = [];
  const right: number[] = [];
  for (const p of bucket.pixelIndices) {
    ((widest[p] ?? 0) <= midpoint ? left : right).push(p);
  }
  return [{ pixelIndices: left }, { pixelIndices: right }];
}

/**
 * Assigns each pixel to the nearest color in a caller-supplied palette
 * (squared Euclidean RGB distance), rather than deriving the palette from
 * the image itself the way `quantizeColors` does. Used when the palette
 * comes from somewhere else — e.g. an AI-suggested set of "meaningful"
 * colors for `traceImageColors`'s `palette` option — while reusing the same
 * per-pixel labeling contract (`Uint8Array` of palette indices) that
 * `traceMask`-based tracing already expects.
 */
export function assignColorLabels(image: ImageData, palette: RgbColor[]): Uint8Array {
  const { width, height, data } = image;
  const pixelCount = width * height;
  const labels = new Uint8Array(pixelCount);
  if (palette.length === 0) return labels;

  for (let p = 0; p < pixelCount; p++) {
    const r = data[p * 4] ?? 0;
    const g = data[p * 4 + 1] ?? 0;
    const b = data[p * 4 + 2] ?? 0;

    let bestIndex = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < palette.length; i++) {
      const [pr, pg, pb] = palette[i] as RgbColor;
      const dr = r - pr;
      const dg = g - pg;
      const db = b - pb;
      const distance = dr * dr + dg * dg + db * db;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = i;
      }
    }
    labels[p] = bestIndex;
  }

  return labels;
}

function averageColor(bucket: Bucket, r: Uint8Array, g: Uint8Array, b: Uint8Array): RgbColor {
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  for (const p of bucket.pixelIndices) {
    sumR += r[p] ?? 0;
    sumG += g[p] ?? 0;
    sumB += b[p] ?? 0;
  }
  const count = bucket.pixelIndices.length || 1;
  return [Math.round(sumR / count), Math.round(sumG / count), Math.round(sumB / count)];
}
