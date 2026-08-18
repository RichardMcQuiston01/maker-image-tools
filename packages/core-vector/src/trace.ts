import type { PathCommand, Point, VectorPath } from "./types.js";

export interface TraceOptions {
  /** Grayscale cutoff (0-255); a pixel is "foreground" if its luma is below this. Default 128. */
  threshold?: number;
  /** Connected foreground components smaller than this many pixels are discarded. Default 2. */
  minRegionSize?: number;
  /** Douglas-Peucker simplification tolerance, in pixels. Default 1.0. */
  simplifyTolerance?: number;
}

const DEFAULT_THRESHOLD = 128;
const DEFAULT_MIN_REGION_SIZE = 2;
const DEFAULT_SIMPLIFY_TOLERANCE = 1.0;

/** The 8 Moore neighbor offsets in clockwise order starting from north. */
const NEIGHBOR_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [0, -1], // N
  [1, -1], // NE
  [1, 0], // E
  [1, 1], // SE
  [0, 1], // S
  [-1, 1], // SW
  [-1, 0], // W
  [-1, -1], // NW
];
const WEST_DIRECTION = 6;

interface Component {
  id: number;
  start: Point;
  pixelCount: number;
}

/** Trace foreground regions of a raster image into closed vector outlines. */
export function traceImage(image: ImageData, options: TraceOptions = {}): VectorPath[] {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const minRegionSize = options.minRegionSize ?? DEFAULT_MIN_REGION_SIZE;
  const simplifyTolerance = options.simplifyTolerance ?? DEFAULT_SIMPLIFY_TOLERANCE;

  const { width, height } = image;
  const foreground = binarize(image, threshold);
  const { labels, components } = findComponents(foreground, width, height);

  const paths: VectorPath[] = [];
  for (const component of components) {
    if (component.pixelCount < minRegionSize) continue;

    const boundary = traceBoundary(labels, width, height, component);
    const simplified = simplifyClosedPolygon(boundary, simplifyTolerance);
    if (simplified.length < 3) continue;

    const commands: PathCommand[] = simplified.map((point, i) =>
      i === 0 ? { type: "M", point } : { type: "L", point },
    );
    commands.push({ type: "Z" });
    paths.push({ id: crypto.randomUUID(), commands });
  }

  return paths;
}

function binarize(image: ImageData, threshold: number): Uint8Array {
  const { width, height, data } = image;
  const mask = new Uint8Array(width * height);
  for (let i = 0, p = 0; p < mask.length; i += 4, p++) {
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;
    const luma = r * 0.299 + g * 0.587 + b * 0.114;
    mask[p] = luma < threshold ? 1 : 0;
  }
  return mask;
}

/** Flood-fills 8-connected foreground components. Components are discovered in scan order, so
 * each component's `start` pixel is already its topmost, then leftmost, foreground pixel. */
function findComponents(
  foreground: Uint8Array,
  width: number,
  height: number,
): { labels: Int32Array; components: Component[] } {
  const labels = new Int32Array(width * height).fill(-1);
  const components: Component[] = [];
  let nextId = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const startIdx = y * width + x;
      if ((foreground[startIdx] ?? 0) !== 1 || (labels[startIdx] ?? -1) !== -1) continue;

      const id = nextId++;
      let pixelCount = 0;
      const stack: number[] = [startIdx];
      labels[startIdx] = id;

      while (stack.length > 0) {
        const idx = stack.pop() as number;
        pixelCount++;
        const cx = idx % width;
        const cy = (idx - cx) / width;

        for (const [dx, dy] of NEIGHBOR_OFFSETS) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const nIdx = ny * width + nx;
          if ((foreground[nIdx] ?? 0) === 1 && (labels[nIdx] ?? -1) === -1) {
            labels[nIdx] = id;
            stack.push(nIdx);
          }
        }
      }

      components.push({ id, start: { x, y }, pixelCount });
    }
  }

  return { labels, components };
}

/** Moore-neighbor tracing of a single component's outer boundary (Jacob's stopping criterion).
 * Holes inside a component are not traced — donut-shaped regions render as solid. This is a
 * documented limitation for this stage, not a bug. */
function traceBoundary(
  labels: Int32Array,
  width: number,
  height: number,
  component: Component,
): Point[] {
  const { id, start, pixelCount } = component;
  const isMember = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < width && y < height && (labels[y * width + x] ?? -1) === id;

  let currentX = start.x;
  let currentY = start.y;
  let backtrack = WEST_DIRECTION;

  const points: Point[] = [{ x: currentX + 0.5, y: currentY + 0.5 }];
  // The pixel reached by the very first move away from `start` — Jacob's stopping criterion is
  // re-arriving at this pixel by that same start->secondPixel transition, not merely revisiting
  // `start` (a plain backtrack-direction match can under-fire at corners, where several distinct
  // backtrack values all search around to the same next pixel).
  let secondPixelX = -1;
  let secondPixelY = -1;
  let haveSecondPixel = false;

  const maxSteps = 8 * pixelCount;
  for (let step = 0; step < maxSteps; step++) {
    let foundDir = -1;
    let nx = 0;
    let ny = 0;
    for (let i = 1; i <= 8; i++) {
      const dir = (backtrack + i) % 8;
      const offset = NEIGHBOR_OFFSETS[dir] as readonly [number, number];
      const tx = currentX + offset[0];
      const ty = currentY + offset[1];
      if (isMember(tx, ty)) {
        foundDir = dir;
        nx = tx;
        ny = ty;
        break;
      }
    }

    if (foundDir === -1) break; // isolated pixel: no foreground neighbor to continue to

    if (
      haveSecondPixel &&
      currentX === start.x &&
      currentY === start.y &&
      nx === secondPixelX &&
      ny === secondPixelY
    ) {
      break; // about to repeat the start->secondPixel move: boundary is closed
    }

    currentX = nx;
    currentY = ny;
    backtrack = (foundDir + 4) % 8; // opposite of the direction just traveled
    points.push({ x: currentX + 0.5, y: currentY + 0.5 });

    if (!haveSecondPixel) {
      secondPixelX = currentX;
      secondPixelY = currentY;
      haveSecondPixel = true;
    }
  }

  return points;
}

/** Perpendicular distance from `p` to the infinite line through `a` and `b`. */
function perpendicularDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const cross = dx * (p.y - a.y) - dy * (p.x - a.x);
  return Math.abs(cross) / length;
}

function douglasPeucker(
  points: readonly Point[],
  start: number,
  end: number,
  tolerance: number,
): Point[] {
  const a = points[start] as Point;
  const b = points[end] as Point;

  let maxDistance = -1;
  let maxIndex = -1;
  for (let i = start + 1; i < end; i++) {
    const d = perpendicularDistance(points[i] as Point, a, b);
    if (d > maxDistance) {
      maxDistance = d;
      maxIndex = i;
    }
  }

  if (maxIndex !== -1 && maxDistance > tolerance) {
    const left = douglasPeucker(points, start, maxIndex, tolerance);
    const right = douglasPeucker(points, maxIndex, end, tolerance);
    return left.slice(0, -1).concat(right);
  }

  return [a, b];
}

/** Simplifies a closed boundary polygon (as produced by `traceBoundary`, whose first and last
 * points coincide) via Douglas-Peucker, treated as an open polyline and then de-duplicated. */
function simplifyClosedPolygon(points: readonly Point[], tolerance: number): Point[] {
  if (points.length < 3) return points.slice();

  const simplified = douglasPeucker(points, 0, points.length - 1, tolerance);
  const first = simplified[0] as Point;
  const last = simplified[simplified.length - 1] as Point;
  if (simplified.length > 1 && first.x === last.x && first.y === last.y) {
    return simplified.slice(0, -1);
  }
  return simplified;
}
