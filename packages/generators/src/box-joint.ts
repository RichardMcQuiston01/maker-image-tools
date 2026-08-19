import type { PathCommand, Point, VectorPath } from "@maker/core-vector";

export interface FingerJointBoxOptions {
  /** External box width in mm (X axis). */
  width: number;
  /** External box depth in mm (Y axis). */
  depth: number;
  /** External box height in mm (Z axis). */
  height: number;
  /** Material thickness in mm — panels interlock at this thickness. */
  materialThickness: number;
  /** Target finger width in mm along each joint edge. Default 10. The actual finger width is adjusted per-edge so a whole number of fingers fits exactly (see below). */
  fingerWidth?: number;
  /** Whether to include a lid (6 panels) or leave the box open-topped (5 panels: bottom + 4 sides, no top). Default true. */
  includeLid?: boolean;
}

export interface FingerJointBoxResult {
  /** One VectorPath per panel, laid out side-by-side (not overlapping) on a single sheet, ready for nesting/export. */
  panels: VectorPath[];
  /** Human-readable label per panel, same order/length as `panels`. */
  panelLabels: string[];
}

const DEFAULT_FINGER_WIDTH = 10;
const PANEL_GAP = 5;

/** Number of fingers along an edge of length `edgeLength`, sized as close as possible to `targetFingerWidth`. */
function fingerCountForEdge(edgeLength: number, targetFingerWidth: number): number {
  return Math.max(1, Math.round(edgeLength / targetFingerWidth));
}

/**
 * Builds the sequence of points for one edge of length `edgeLength`, starting at `start` and
 * running along `direction` (a unit vector), with a finger-joint zigzag of depth `depth` toward
 * `outward` (a unit vector perpendicular to `direction`). Fingers alternate tab-out/gap-in,
 * starting and ending with a tab so the edge is symmetric.
 *
 * This computes each edge's zigzag independently from the panel's own dimensions only — it does
 * not attempt to phase-match against the geometry of whichever panel would mate at this edge in a
 * real 3D assembly. Full corner-interlocking is out of scope for this generator.
 */
function fingerEdgePoints(
  start: Point,
  direction: Point,
  edgeLength: number,
  outward: Point,
  depth: number,
  targetFingerWidth: number,
): Point[] {
  const count = fingerCountForEdge(edgeLength, targetFingerWidth);
  const actualFingerWidth = edgeLength / count;

  const points: Point[] = [start];
  let current: Point = start;
  let out = false; // current z (perpendicular) state: false = at baseline, true = tab extended outward

  for (let i = 0; i < count; i++) {
    const next: Point = {
      x: current.x + direction.x * actualFingerWidth,
      y: current.y + direction.y * actualFingerWidth,
    };
    const wantOut = i % 2 === 0; // start with a tab (out) on the first finger

    if (wantOut !== out) {
      // step perpendicular before traversing this finger segment
      const stepSign = wantOut ? 1 : -1;
      const stepped: Point = {
        x: current.x + outward.x * depth * stepSign,
        y: current.y + outward.y * depth * stepSign,
      };
      points.push(stepped);
      const steppedNext: Point = {
        x: next.x + outward.x * depth * stepSign,
        y: next.y + outward.y * depth * stepSign,
      };
      points.push(steppedNext);
      out = wantOut;
    } else {
      points.push(next);
    }

    current = next;
  }

  // return to baseline at the very end of the edge if still displaced
  if (out) {
    points.push({ x: current.x, y: current.y });
  }

  return points;
}

function polygonToPath(points: Point[]): PathCommand[] {
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

interface PanelSpec {
  label: string;
  w: number;
  h: number;
}

/**
 * Builds a rectangular panel of size w x h (with origin at 0,0), where every edge is rendered as
 * a finger-joint zigzag at `materialThickness` depth (pointing outward from the rectangle).
 */
function buildPanel(
  w: number,
  h: number,
  materialThickness: number,
  targetFingerWidth: number,
): Point[] {
  const points: Point[] = [];

  // top edge: (0,0) -> (w,0), outward = up (-y)
  points.push(
    ...fingerEdgePoints(
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      w,
      { x: 0, y: -1 },
      materialThickness,
      targetFingerWidth,
    ),
  );
  // right edge: (w,0) -> (w,h), outward = right (+x)
  points.push(
    ...fingerEdgePoints(
      { x: w, y: 0 },
      { x: 0, y: 1 },
      h,
      { x: 1, y: 0 },
      materialThickness,
      targetFingerWidth,
    ),
  );
  // bottom edge: (w,h) -> (0,h), outward = down (+y)
  points.push(
    ...fingerEdgePoints(
      { x: w, y: h },
      { x: -1, y: 0 },
      w,
      { x: 0, y: 1 },
      materialThickness,
      targetFingerWidth,
    ),
  );
  // left edge: (0,h) -> (0,0), outward = left (-x)
  points.push(
    ...fingerEdgePoints(
      { x: 0, y: h },
      { x: 0, y: -1 },
      h,
      { x: -1, y: 0 },
      materialThickness,
      targetFingerWidth,
    ),
  );

  return points;
}

/**
 * Generates a laser-cut finger-joint (box-joint) open or lidded box as a flat set of panels laid
 * out side-by-side on a single sheet.
 *
 * Simplification: this generator does not perform real 3D corner-interlock math between adjacent
 * panels (matching tab/slot phase across a shared edge). Each panel edge that represents a joint
 * gets its own independently-computed zigzag of alternating in/out rectangular teeth, sized so a
 * whole number of fingers exactly tiles that edge. Panels use nominal external dimensions
 * (width x depth, width x height, depth x height) rather than being inset to account for adjoining
 * panel thickness.
 */
export function generateFingerJointBox(options: FingerJointBoxOptions): FingerJointBoxResult {
  const { width, depth, height, materialThickness } = options;
  const targetFingerWidth = options.fingerWidth ?? DEFAULT_FINGER_WIDTH;
  const includeLid = options.includeLid ?? true;

  const specs: PanelSpec[] = [
    { label: "bottom", w: width, h: depth },
    { label: "front", w: width, h: height },
    { label: "back", w: width, h: height },
    { label: "left", w: depth, h: height },
    { label: "right", w: depth, h: height },
  ];
  if (includeLid) {
    specs.push({ label: "top", w: width, h: depth });
  }

  // Finger tabs protrude by materialThickness on both sides of a panel's nominal width, so the
  // gap between laid-out panels must exceed 2x materialThickness to avoid tabs overlapping.
  const layoutGap = PANEL_GAP + 2 * materialThickness;

  const panels: VectorPath[] = [];
  const panelLabels: string[] = [];
  let offsetX = 0;

  for (const spec of specs) {
    const rawPoints = buildPanel(spec.w, spec.h, materialThickness, targetFingerWidth);
    const shifted = rawPoints.map((p) => ({ x: p.x + offsetX, y: p.y }));
    panels.push({ id: crypto.randomUUID(), commands: polygonToPath(shifted) });
    panelLabels.push(spec.label);
    offsetX += spec.w + layoutGap;
  }

  return { panels, panelLabels };
}
