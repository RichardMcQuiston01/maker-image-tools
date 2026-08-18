import { flattenPath } from "./editor.js";
import { boundingBoxOfPoints } from "./geometry.js";
import type { Point, VectorPath } from "./types.js";

/*
 * "True" SVGnest-style nesting computes no-fit-polygons (NFPs) between every
 * pair of candidate part orientations and searches placements with a genetic
 * algorithm to minimize wasted sheet area — it's powerful but complex, slow,
 * and non-deterministic run-to-run. This module deliberately scopes that
 * down to a much simpler, fully deterministic heuristic: each part is
 * approximated by the axis-aligned bounding box of its best-fit rotation,
 * parts are sorted largest-area-first, and each is placed via a bottom-left
 * shelf-fill scan (try the topmost open shelf, then the leftmost open slot
 * on that shelf) across one or more same-size bins. This trades optimal
 * packing density for predictability, testability, and speed — reasonable
 * for a first pass at laser/CNC sheet layout, with true NFP-based nesting
 * left as a possible future upgrade.
 */

export interface NestOptions {
  binWidth: number;
  binHeight: number;
  /** Minimum gap between parts and from bin edges. Default 2. */
  spacing?: number;
  /** Candidate rotation angles in degrees to try per part. Default [0, 90, 180, 270]. */
  rotations?: number[];
}

export interface NestedPart {
  /** The ORIGINAL, unmodified input path. Caller applies rotation+translation for rendering/export. */
  path: VectorPath;
  /** Translate the part's (rotated) bounding-box top-left corner to this X. */
  x: number;
  /** Translate the part's (rotated) bounding-box top-left corner to this Y. */
  y: number;
  /** Rotation in degrees to apply, about the part's OWN bounding-box center, BEFORE translating. */
  rotation: number;
  /** Which bin/sheet (0-based) this part was placed on. */
  binIndex: number;
}

export interface NestResult {
  /** One entry per input part, in the SAME order as the input `parts` array. */
  placements: NestedPart[];
  /** Total number of bins used (1 + the highest binIndex seen). */
  binCount: number;
}

interface RotationCandidate {
  rotation: number;
  width: number;
  height: number;
}

interface PlacedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PlacementRecord {
  x: number;
  y: number;
  rotation: number;
  binIndex: number;
}

function rotatePoint(p: Point, center: Point, radians: number): Point {
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
}

function bestRotationCandidate(part: VectorPath, rotations: number[]): RotationCandidate {
  const flattened = flattenPath(part, 1);
  const bbox = boundingBoxOfPoints(flattened);
  const center: Point = { x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height / 2 };

  const candidates: RotationCandidate[] = rotations.map((rotation) => {
    const radians = (rotation * Math.PI) / 180;
    const rotatedPoints = flattened.map((p) => rotatePoint(p, center, radians));
    const rotatedBBox = boundingBoxOfPoints(rotatedPoints);
    return { rotation, width: rotatedBBox.width, height: rotatedBBox.height };
  });

  let best = candidates[0] ?? { rotation: 0, width: 0, height: 0 };
  let bestArea = best.width * best.height;
  for (const candidate of candidates) {
    const area = candidate.width * candidate.height;
    if (area < bestArea) {
      best = candidate;
      bestArea = area;
    }
  }
  return best;
}

function rectsOverlap(
  x1: number,
  y1: number,
  w1: number,
  h1: number,
  x2: number,
  y2: number,
  w2: number,
  h2: number,
): boolean {
  return x1 < x2 + w2 && x2 < x1 + w1 && y1 < y2 + h2 && y2 < y1 + h1;
}

/**
 * Attempts to place a `width x height` (spacing-inflated for collision
 * checks) rect within a single bin's already-placed rects. Returns the
 * top-left (x, y) of the first valid position found (Y ascending, then X
 * ascending), or null if it doesn't fit anywhere in this bin.
 */
function findPlacementInBin(
  placed: PlacedRect[],
  binWidth: number,
  binHeight: number,
  width: number,
  height: number,
  spacing: number,
): { x: number; y: number } | null {
  const inflatedWidth = width + spacing;
  const inflatedHeight = height + spacing;

  const candidateYs = [spacing, ...placed.map((r) => r.y + r.height + spacing)].sort(
    (a, b) => a - b,
  );

  for (const y of candidateYs) {
    if (y + inflatedHeight > binHeight) continue;

    const overlappingInY = placed.filter(
      (r) => r.y < y + inflatedHeight && y < r.y + r.height + spacing,
    );
    const candidateXs = [
      spacing,
      ...overlappingInY.map((r) => r.x + r.width + spacing),
    ].sort((a, b) => a - b);

    for (const x of candidateXs) {
      if (x + inflatedWidth > binWidth) continue;

      let collides = false;
      for (const r of placed) {
        if (
          rectsOverlap(
            x,
            y,
            inflatedWidth,
            inflatedHeight,
            r.x,
            r.y,
            r.width + spacing,
            r.height + spacing,
          )
        ) {
          collides = true;
          break;
        }
      }
      if (!collides) {
        return { x, y };
      }
    }
  }

  return null;
}

/**
 * Deterministic bounding-box shelf/bottom-left-fill nesting of `parts` onto
 * one or more `binWidth` x `binHeight` bins. See file-level comment for the
 * scope reduction from true SVGnest (NFP + genetic algorithm).
 */
export function nestParts(parts: VectorPath[], options: NestOptions): NestResult {
  const spacing = options.spacing ?? 2;
  const rotations = options.rotations ?? [0, 90, 180, 270];
  const { binWidth, binHeight } = options;

  const candidates = parts.map((part, partIndex) => {
    const best = bestRotationCandidate(part, rotations);
    return { partIndex, ...best };
  });

  const sortedOrder = candidates
    .slice()
    .sort((a, b) => b.width * b.height - a.width * a.height);

  const bins: PlacedRect[][] = [[]];
  const records = new Map<number, PlacementRecord>();

  for (const candidate of sortedOrder) {
    let placed = false;

    for (let binIndex = 0; binIndex < bins.length; binIndex++) {
      const bin = bins[binIndex];
      if (!bin) continue;
      const spot = findPlacementInBin(
        bin,
        binWidth,
        binHeight,
        candidate.width,
        candidate.height,
        spacing,
      );
      if (spot) {
        bin.push({ x: spot.x, y: spot.y, width: candidate.width, height: candidate.height });
        records.set(candidate.partIndex, {
          x: spot.x,
          y: spot.y,
          rotation: candidate.rotation,
          binIndex,
        });
        placed = true;
        break;
      }
    }

    if (!placed) {
      const newBinIndex = bins.length;
      const newBin: PlacedRect[] = [
        { x: spacing, y: spacing, width: candidate.width, height: candidate.height },
      ];
      bins.push(newBin);
      records.set(candidate.partIndex, {
        x: spacing,
        y: spacing,
        rotation: candidate.rotation,
        binIndex: newBinIndex,
      });
    }
  }

  const placements: NestedPart[] = parts.map((path, index) => {
    const record = records.get(index);
    if (!record) {
      // Should be unreachable — every part gets a record above.
      return { path, x: spacing, y: spacing, rotation: 0, binIndex: 0 };
    }
    return { path, x: record.x, y: record.y, rotation: record.rotation, binIndex: record.binIndex };
  });

  const maxBinIndex = placements.reduce((max, p) => Math.max(max, p.binIndex), 0);

  return { placements, binCount: maxBinIndex + 1 };
}
