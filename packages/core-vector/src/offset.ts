import {
  ClipperOffset,
  EndType,
  JoinType,
  type IntPoint,
  type Path,
  type Paths,
} from "clipper-lib";
import { flattenPath } from "./editor.js";
import type { PathCommand, Point, VectorPath } from "./types.js";

const DEFAULT_SCALE = 1000;

export interface OffsetOptions {
  /** Line join style used by clipper-lib when widening/narrowing corners. Default "miter". */
  joinType?: "square" | "round" | "miter";
  /** Internal integer scale factor for clipper-lib (clipper works in integer coordinates). Default 1000. */
  scale?: number;
  /** Whether the input path is treated as closed. Default: true if the path ends with a Z command, else false. */
  closed?: boolean;
}

function joinTypeFor(joinType: OffsetOptions["joinType"]): number {
  switch (joinType) {
    case "square":
      return JoinType.jtSquare;
    case "round":
      return JoinType.jtRound;
    case "miter":
    default:
      return JoinType.jtMiter;
  }
}

/**
 * Offsets `path` outward (positive `distance`) or inward (negative
 * `distance`) by `distance` units, using clipper-lib's polygon-offsetting
 * (used here for laser/CNC kerf compensation). The path is flattened to a
 * polyline first, so curves in the input become straight-segment polygons
 * in the output. Clipper's offset result is always one or more closed
 * polygons, even for open input, so every returned VectorPath ends with Z.
 */
export function offsetPath(
  path: VectorPath,
  distance: number,
  options?: OffsetOptions,
): VectorPath[] {
  const scale = options?.scale ?? DEFAULT_SCALE;
  const closed = options?.closed ?? path.commands[path.commands.length - 1]?.type === "Z";

  const flattened: Point[] = flattenPath(path, 1);
  const scaledPath: Path = flattened.map((p): IntPoint => ({
    X: Math.round(p.x * scale),
    Y: Math.round(p.y * scale),
  }));

  const offset = new ClipperOffset();
  const joinType = joinTypeFor(options?.joinType);
  const endType = closed ? EndType.etClosedPolygon : EndType.etOpenRound;
  offset.AddPath(scaledPath, joinType, endType);

  const solution: Paths = [];
  offset.Execute(solution, distance * scale);

  return solution.map((resultPath) => {
    const points: Point[] = resultPath.map((ip) => ({ x: ip.X / scale, y: ip.Y / scale }));
    const commands: PathCommand[] = [];
    const first = points[0];
    if (first) {
      commands.push({ type: "M", point: first });
      for (let i = 1; i < points.length; i++) {
        const p = points[i];
        if (p) commands.push({ type: "L", point: p });
      }
    }
    commands.push({ type: "Z" });
    return { id: crypto.randomUUID(), commands };
  });
}

export interface KerfCompensateOptions {
  /** Which direction to compensate. Default "outset". */
  side?: "outset" | "inset";
  /** Line join style, forwarded to offsetPath. Default "miter". */
  joinType?: "square" | "round" | "miter";
}

/**
 * Compensates a path for laser/CNC kerf width: "outset" (default) grows the
 * path outward by half the kerf so the cut part ends up the correct
 * external size; "inset" shrinks it inward by half the kerf.
 */
export function kerfCompensate(
  path: VectorPath,
  kerfWidth: number,
  options?: KerfCompensateOptions,
): VectorPath[] {
  const side = options?.side ?? "outset";
  const distance = side === "outset" ? kerfWidth / 2 : -kerfWidth / 2;
  const joinType = options?.joinType;
  return offsetPath(path, distance, joinType === undefined ? {} : { joinType });
}
