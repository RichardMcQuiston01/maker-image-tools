import type { PathCommand, Point, VectorPath } from "@maker/core-vector";

export interface KeychainOptions {
  /** Shape of the blank. Default "rounded-rect". */
  shape?: "rounded-rect" | "circle" | "hexagon";
  /** Width in mm (diameter for circle, flat-to-flat for hexagon). Default 40. */
  width?: number;
  /** Height in mm (ignored for circle/hexagon, which are derived from width). Default 25 for rounded-rect. */
  height?: number;
  /** Corner radius in mm, only used for "rounded-rect". Default 4. */
  cornerRadius?: number;
  /** Diameter in mm of the hole for the keyring/earring hook. Default 4. */
  holeDiameter?: number;
  /** Distance in mm from the top edge center to the hole center. Default 6. */
  holeMargin?: number;
}

export interface EarringPairOptions extends KeychainOptions {
  /** Horizontal gap in mm between the two mirrored blanks. Default 20. */
  gap?: number;
}

const DEFAULT_WIDTH = 40;
const DEFAULT_HEIGHT = 25;
const DEFAULT_CORNER_RADIUS = 4;
const DEFAULT_HOLE_DIAMETER = 4;
const DEFAULT_HOLE_MARGIN = 6;
const DEFAULT_GAP = 20;

const CORNER_SEGMENTS = 8;
const CIRCLE_SEGMENTS = 32;

function polygonPath(points: Point[]): PathCommand[] {
  const commands: PathCommand[] = [];
  const first = points[0];
  if (!first) return commands;
  commands.push({ type: "M", point: first });
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    if (p) commands.push({ type: "L", point: p });
  }
  commands.push({ type: "Z" });
  return commands;
}

/** Approximates a full circle of the given radius, centered at (cx, cy), as a regular polygon. */
function circlePoints(cx: number, cy: number, radius: number, segments = CIRCLE_SEGMENTS): Point[] {
  const points: Point[] = [];
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    points.push({ x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) });
  }
  return points;
}

/** Approximates a regular hexagon (flat-to-flat = width) centered at origin as a straight-line polygon. */
function hexagonPoints(width: number): Point[] {
  // flat-to-flat distance = width => circumradius = width / sqrt(3)
  const circumradius = width / Math.sqrt(3);
  const points: Point[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 6) + (i / 6) * Math.PI * 2; // rotate so a flat edge faces up
    points.push({ x: circumradius * Math.cos(angle), y: circumradius * Math.sin(angle) });
  }
  return points;
}

/** Rounded rectangle centered at origin, corners approximated with short line-segment arcs. */
function roundedRectPoints(width: number, height: number, cornerRadius: number): Point[] {
  const r = Math.min(cornerRadius, width / 2, height / 2);
  const halfW = width / 2;
  const halfH = height / 2;
  const points: Point[] = [];

  const corners: Array<{ cx: number; cy: number; startAngle: number }> = [
    { cx: halfW - r, cy: -halfH + r, startAngle: -Math.PI / 2 }, // top-right
    { cx: halfW - r, cy: halfH - r, startAngle: 0 }, // bottom-right
    { cx: -halfW + r, cy: halfH - r, startAngle: Math.PI / 2 }, // bottom-left
    { cx: -halfW + r, cy: -halfH + r, startAngle: Math.PI }, // top-left
  ];

  for (const corner of corners) {
    for (let i = 0; i <= CORNER_SEGMENTS; i++) {
      const angle = corner.startAngle + (i / CORNER_SEGMENTS) * (Math.PI / 2);
      points.push({ x: corner.cx + r * Math.cos(angle), y: corner.cy + r * Math.sin(angle) });
    }
  }

  return points;
}

interface ResolvedShape {
  points: Point[];
  width: number;
  height: number;
}

function outerShapePoints(
  shape: NonNullable<KeychainOptions["shape"]>,
  width: number,
  height: number,
  cornerRadius: number,
): ResolvedShape {
  switch (shape) {
    case "circle": {
      const radius = width / 2;
      return { points: circlePoints(0, 0, radius), width, height: width };
    }
    case "hexagon": {
      return { points: hexagonPoints(width), width, height: width };
    }
    case "rounded-rect":
    default: {
      return { points: roundedRectPoints(width, height, cornerRadius), width, height };
    }
  }
}

/**
 * A single keychain/pendant blank: outer shape + a circular hole, as TWO separate closed
 * VectorPaths (outer boundary, then hole) — caller composes them (e.g. via a "hole" cut layer)
 * rather than this function attempting a boolean subtraction itself.
 */
export function generateKeychainBlank(options?: KeychainOptions): VectorPath[] {
  const shape = options?.shape ?? "rounded-rect";
  const width = options?.width ?? DEFAULT_WIDTH;
  const height = shape === "rounded-rect" ? (options?.height ?? DEFAULT_HEIGHT) : width;
  const cornerRadius = options?.cornerRadius ?? DEFAULT_CORNER_RADIUS;
  const holeDiameter = options?.holeDiameter ?? DEFAULT_HOLE_DIAMETER;
  const holeMargin = options?.holeMargin ?? DEFAULT_HOLE_MARGIN;

  const outer = outerShapePoints(shape, width, height, cornerRadius);

  // Topmost point of the outer shape is at y = -outer.height / 2 (shape is centered at origin).
  const topY = -outer.height / 2;
  const holeCenter: Point = { x: 0, y: topY + holeMargin };
  const holePoints = circlePoints(holeCenter.x, holeCenter.y, holeDiameter / 2);

  const outerPath: VectorPath = { id: crypto.randomUUID(), commands: polygonPath(outer.points) };
  const holePath: VectorPath = { id: crypto.randomUUID(), commands: polygonPath(holePoints) };

  return [outerPath, holePath];
}

/**
 * Two copies of a keychain-style blank (each with its own hole), placed side by side for a
 * matching earring pair. "Mirrored" here just means "a matching pair" — the shapes handled by
 * this generator (rounded-rect, circle, hexagon) are bilaterally symmetric, so a literal flip
 * isn't geometrically necessary; the second copy is a plain translated offset copy.
 */
export function generateEarringPair(options?: EarringPairOptions): VectorPath[] {
  const gap = options?.gap ?? DEFAULT_GAP;
  const width = options?.width ?? DEFAULT_WIDTH;

  const [leftOuter, leftHole] = generateKeychainBlank(options);
  const [rightOuterSrc, rightHoleSrc] = generateKeychainBlank(options);

  const offsetX = width + gap;
  const translate = (path: VectorPath): VectorPath => ({
    id: crypto.randomUUID(),
    commands: path.commands.map((c) =>
      c.type === "Z" ? c : { ...c, point: { x: c.point.x + offsetX, y: c.point.y } },
    ),
  });

  const rightOuter = rightOuterSrc ? translate(rightOuterSrc) : undefined;
  const rightHole = rightHoleSrc ? translate(rightHoleSrc) : undefined;

  const result: VectorPath[] = [];
  if (leftOuter) result.push(leftOuter);
  if (leftHole) result.push(leftHole);
  if (rightOuter) result.push(rightOuter);
  if (rightHole) result.push(rightHole);

  return result;
}
