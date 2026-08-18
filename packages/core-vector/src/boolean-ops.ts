import type { PathCommand, Point, VectorPath } from "./types.js";

/*
 * Rasterize-then-retrace boolean ops, chosen over exact polygon clipping
 * (which has notorious edge-case bugs with self-intersections/degenerate
 * inputs) for robustness at the cost of raster precision. This file is
 * deliberately self-contained (its own flatten + boundary-trace) rather than
 * importing editor.ts/trace.ts, since those may be edited concurrently by
 * other tracks.
 *
 * Limitations:
 * - Operates on flattened (curve-free) polygons; output is always M/L/Z-only,
 *   even if the inputs had C/Q curves.
 * - Output precision is bounded by `pixelsPerUnit` (raster resolution).
 * - Each input VectorPath is treated as a single outer boundary — multiple
 *   subpaths/holes are not modeled as holes, matching the rest of Stage 2's
 *   documented tracing limitation.
 * - Very thin (near 1px) slivers in the combined mask can occasionally trace
 *   into a degenerate near-zero-area polygon rather than being fully culled;
 *   callers doing exact-emptiness checks should tolerate negligible-area
 *   results in addition to an empty array.
 */

export type BooleanOp = "union" | "intersect" | "subtract" | "xor";

const FLATTEN_SEGMENTS = 16;
const DEFAULT_PIXELS_PER_UNIT = 4;
const MAX_RASTER_DIM = 2048;
const BBOX_PADDING = 2;

function cubicAt(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const dd = t * t * t;
  return { x: a * p0.x + b * p1.x + c * p2.x + dd * p3.x, y: a * p0.y + b * p1.y + c * p2.y + dd * p3.y };
}

function quadAt(p0: Point, p1: Point, p2: Point, t: number): Point {
  const mt = 1 - t;
  const a = mt * mt;
  const b = 2 * mt * t;
  const c = t * t;
  return { x: a * p0.x + b * p1.x + c * p2.x, y: a * p0.y + b * p1.y + c * p2.y };
}

/** Simple fixed-subdivision flatten (exact smoothness doesn't matter for rasterized ops). */
function flattenToPolygon(path: VectorPath): Point[] {
  const out: Point[] = [];
  let current: Point = { x: 0, y: 0 };
  let start: Point = { x: 0, y: 0 };

  for (const cmd of path.commands) {
    switch (cmd.type) {
      case "M":
        current = cmd.point;
        start = cmd.point;
        out.push(current);
        break;
      case "L":
        current = cmd.point;
        out.push(current);
        break;
      case "C":
        for (let s = 1; s <= FLATTEN_SEGMENTS; s++) {
          out.push(cubicAt(current, cmd.control1, cmd.control2, cmd.point, s / FLATTEN_SEGMENTS));
        }
        current = cmd.point;
        break;
      case "Q":
        for (let s = 1; s <= FLATTEN_SEGMENTS; s++) {
          out.push(quadAt(current, cmd.control, cmd.point, s / FLATTEN_SEGMENTS));
        }
        current = cmd.point;
        break;
      case "Z":
        out.push(start);
        current = start;
        break;
    }
  }
  return out;
}

function bboxOfPoints(points: Point[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/** Scanline point-in-polygon fill (even-odd rule), polygon implicitly closed. */
function rasterize(
  polygon: Point[],
  originX: number,
  originY: number,
  scale: number,
  width: number,
  height: number,
): Uint8Array {
  const mask = new Uint8Array(width * height);
  if (polygon.length < 3) return mask;

  const pts = polygon.map((p) => ({ x: (p.x - originX) * scale, y: (p.y - originY) * scale }));
  const n = pts.length;

  for (let y = 0; y < height; y++) {
    const scanY = y + 0.5;
    const xs: number[] = [];
    for (let i = 0; i < n; i++) {
      const p1 = pts[i];
      const p2 = pts[(i + 1) % n];
      if (!p1 || !p2) continue;
      const y1 = p1.y;
      const y2 = p2.y;
      if (y1 === y2) continue;
      if ((y1 <= scanY && y2 > scanY) || (y2 <= scanY && y1 > scanY)) {
        const t = (scanY - y1) / (y2 - y1);
        xs.push(p1.x + t * (p2.x - p1.x));
      }
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const xStart = xs[i];
      const xEnd = xs[i + 1];
      if (xStart === undefined || xEnd === undefined) continue;
      const startPx = Math.max(0, Math.ceil(xStart - 0.5));
      const endPx = Math.min(width - 1, Math.floor(xEnd - 0.5));
      for (let x = startPx; x <= endPx; x++) {
        mask[y * width + x] = 1;
      }
    }
  }
  return mask;
}

const NEIGHBOR_OFFSETS: Array<[number, number]> = [
  [0, -1], // N
  [1, -1], // NE
  [1, 0], // E
  [1, 1], // SE
  [0, 1], // S
  [-1, 1], // SW
  [-1, 0], // W
  [-1, -1], // NW
];

function floodFillComponent(
  mask: Uint8Array,
  visited: Uint8Array,
  width: number,
  height: number,
  sx: number,
  sy: number,
): number {
  const stack: number[] = [sy * width + sx];
  visited[sy * width + sx] = 1;
  let count = 0;
  while (stack.length > 0) {
    const idx = stack.pop();
    if (idx === undefined) break;
    count++;
    const y = Math.floor(idx / width);
    const x = idx - y * width;
    for (const [dx, dy] of NEIGHBOR_OFFSETS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const nidx = ny * width + nx;
      if (mask[nidx] === 1 && visited[nidx] === 0) {
        visited[nidx] = 1;
        stack.push(nidx);
      }
    }
  }
  return count;
}

/** Moore-neighbor boundary tracing, starting backtrack direction = West (index 6). */
function traceBoundary(
  mask: Uint8Array,
  width: number,
  height: number,
  startX: number,
  startY: number,
  componentPixelCount: number,
): Array<{ x: number; y: number }> {
  const isForeground = (x: number, y: number): boolean => {
    if (x < 0 || x >= width || y < 0 || y >= height) return false;
    return mask[y * width + x] === 1;
  };

  const contour: Array<{ x: number; y: number }> = [{ x: startX, y: startY }];
  let curX = startX;
  let curY = startY;
  let backtrackDir = 6; // West
  const maxSteps = 8 * Math.max(componentPixelCount, 1);

  for (let step = 0; step < maxSteps; step++) {
    let found = -1;
    let foundX = curX;
    let foundY = curY;
    for (let k = 1; k <= 8; k++) {
      const dirIdx = (backtrackDir + k) % 8;
      const offset = NEIGHBOR_OFFSETS[dirIdx];
      if (!offset) continue;
      const nx = curX + offset[0];
      const ny = curY + offset[1];
      if (isForeground(nx, ny)) {
        found = dirIdx;
        foundX = nx;
        foundY = ny;
        break;
      }
    }
    if (found === -1) break; // isolated pixel, no neighbors

    backtrackDir = (found + 4) % 8;
    if (foundX === startX && foundY === startY && backtrackDir === 6) {
      break; // returned to start via its original backtrack direction
    }
    contour.push({ x: foundX, y: foundY });
    curX = foundX;
    curY = foundY;
  }

  return contour;
}

function traceComponents(
  mask: Uint8Array,
  width: number,
  height: number,
): Array<Array<{ x: number; y: number }>> {
  const visited = new Uint8Array(width * height);
  const contours: Array<Array<{ x: number; y: number }>> = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (mask[idx] !== 1 || visited[idx] === 1) continue;
      const pixelCount = floodFillComponent(mask, visited, width, height, x, y);
      const contour = traceBoundary(mask, width, height, x, y, pixelCount);
      if (contour.length >= 3) contours.push(contour);
    }
  }
  return contours;
}

function rasterToSpace(p: { x: number; y: number }, minX: number, minY: number, scale: number): Point {
  return { x: p.x / scale + minX, y: p.y / scale + minY };
}

/**
 * Computes a boolean combination of two VectorPaths by flattening both to
 * polygons, rasterizing them to a shared bitmap (even-odd fill), combining
 * masks per `op`, and retracing the result's connected components back into
 * polygonal VectorPaths. See file-level comment for limitations.
 */
export function booleanOp(
  op: BooleanOp,
  a: VectorPath,
  b: VectorPath,
  options?: { pixelsPerUnit?: number },
): VectorPath[] {
  const polyA = flattenToPolygon(a);
  const polyB = flattenToPolygon(b);
  if (polyA.length < 3 && polyB.length < 3) return [];

  const allPoints = [...polyA, ...polyB];
  const bbox = bboxOfPoints(allPoints);
  const minX = bbox.minX - BBOX_PADDING;
  const minY = bbox.minY - BBOX_PADDING;
  const maxX = bbox.maxX + BBOX_PADDING;
  const maxY = bbox.maxY + BBOX_PADDING;
  const spanX = Math.max(maxX - minX, 1e-6);
  const spanY = Math.max(maxY - minY, 1e-6);

  let pixelsPerUnit = options?.pixelsPerUnit ?? DEFAULT_PIXELS_PER_UNIT;
  const maxRaw = Math.max(spanX * pixelsPerUnit, spanY * pixelsPerUnit);
  if (maxRaw > MAX_RASTER_DIM) {
    pixelsPerUnit *= MAX_RASTER_DIM / maxRaw;
  }

  const width = Math.max(1, Math.round(spanX * pixelsPerUnit));
  const height = Math.max(1, Math.round(spanY * pixelsPerUnit));

  const maskA = rasterize(polyA, minX, minY, pixelsPerUnit, width, height);
  const maskB = rasterize(polyB, minX, minY, pixelsPerUnit, width, height);

  const combined = new Uint8Array(width * height);
  for (let i = 0; i < combined.length; i++) {
    const va = maskA[i] === 1;
    const vb = maskB[i] === 1;
    let result: boolean;
    switch (op) {
      case "union":
        result = va || vb;
        break;
      case "intersect":
        result = va && vb;
        break;
      case "subtract":
        result = va && !vb;
        break;
      case "xor":
        result = va !== vb;
        break;
    }
    combined[i] = result ? 1 : 0;
  }

  const contours = traceComponents(combined, width, height);
  const paths: VectorPath[] = [];
  for (const contour of contours) {
    if (contour.length < 3) continue;
    const first = contour[0];
    if (!first) continue;
    const commands: PathCommand[] = [{ type: "M", point: rasterToSpace(first, minX, minY, pixelsPerUnit) }];
    for (let i = 1; i < contour.length; i++) {
      const pt = contour[i];
      if (!pt) continue;
      commands.push({ type: "L", point: rasterToSpace(pt, minX, minY, pixelsPerUnit) });
    }
    commands.push({ type: "Z" });
    paths.push({ id: crypto.randomUUID(), commands });
  }
  return paths;
}

export function union(a: VectorPath, b: VectorPath): VectorPath[] {
  return booleanOp("union", a, b);
}

export function intersect(a: VectorPath, b: VectorPath): VectorPath[] {
  return booleanOp("intersect", a, b);
}

export function subtract(a: VectorPath, b: VectorPath): VectorPath[] {
  return booleanOp("subtract", a, b);
}

export function xor(a: VectorPath, b: VectorPath): VectorPath[] {
  return booleanOp("xor", a, b);
}
