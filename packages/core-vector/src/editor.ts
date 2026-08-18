import type { PathCommand, Point, VectorPath } from "./types.js";

const MAX_FLATTEN_DEPTH = 16;

function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function pointsEqual(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}

/** Perpendicular distance from p to the infinite line through a-b (a===b degenerates to point distance). */
function perpendicularDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const cross = (p.x - a.x) * dy - (p.y - a.y) * dx;
  return Math.abs(cross) / Math.sqrt(lenSq);
}

function subdivideCubic(
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point,
): { left: [Point, Point, Point, Point]; right: [Point, Point, Point, Point] } {
  const p01 = lerp(p0, p1, 0.5);
  const p12 = lerp(p1, p2, 0.5);
  const p23 = lerp(p2, p3, 0.5);
  const p012 = lerp(p01, p12, 0.5);
  const p123 = lerp(p12, p23, 0.5);
  const p0123 = lerp(p012, p123, 0.5);
  return {
    left: [p0, p01, p012, p0123],
    right: [p0123, p123, p23, p3],
  };
}

function flattenCubic(
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point,
  tolerance: number,
  depth: number,
  out: Point[],
): void {
  const flat =
    perpendicularDistance(p1, p0, p3) <= tolerance && perpendicularDistance(p2, p0, p3) <= tolerance;
  if (depth >= MAX_FLATTEN_DEPTH || flat) {
    out.push(p3);
    return;
  }
  const { left, right } = subdivideCubic(p0, p1, p2, p3);
  flattenCubic(left[0], left[1], left[2], left[3], tolerance, depth + 1, out);
  flattenCubic(right[0], right[1], right[2], right[3], tolerance, depth + 1, out);
}

function flattenQuadratic(
  p0: Point,
  p1: Point,
  p2: Point,
  tolerance: number,
  depth: number,
  out: Point[],
): void {
  const flat = perpendicularDistance(p1, p0, p2) <= tolerance;
  if (depth >= MAX_FLATTEN_DEPTH || flat) {
    out.push(p2);
    return;
  }
  const p01 = lerp(p0, p1, 0.5);
  const p12 = lerp(p1, p2, 0.5);
  const p012 = lerp(p01, p12, 0.5);
  flattenQuadratic(p0, p01, p012, tolerance, depth + 1, out);
  flattenQuadratic(p012, p12, p2, tolerance, depth + 1, out);
}

/**
 * Inserts a new L command with `point` immediately after commands[commandIndex].
 * commandIndex is clamped into the valid range. Pure — returns a new VectorPath.
 */
export function insertPointAfter(path: VectorPath, commandIndex: number, point: Point): VectorPath {
  const commands = path.commands;
  const idx = Math.min(Math.max(commandIndex, 0), commands.length - 1);
  const newCommands: PathCommand[] = [
    ...commands.slice(0, idx + 1),
    { type: "L", point },
    ...commands.slice(idx + 1),
  ];
  return { ...path, commands: newCommands };
}

/**
 * Removes commands[commandIndex]. No-op (returns `path` unchanged) if that would
 * leave fewer than 2 commands, or if commandIndex is out of range. Pure.
 */
export function removePoint(path: VectorPath, commandIndex: number): VectorPath {
  const commands = path.commands;
  if (commands.length < 3) return path;
  if (commandIndex < 0 || commandIndex >= commands.length) return path;
  const newCommands = [...commands.slice(0, commandIndex), ...commands.slice(commandIndex + 1)];
  return { ...path, commands: newCommands };
}

/**
 * Replaces the `point` of commands[commandIndex] (M/L/C/Q). No-op for a Z command
 * (it has no point) or an out-of-range index. Pure.
 */
export function movePoint(path: VectorPath, commandIndex: number, newPoint: Point): VectorPath {
  const commands = path.commands;
  if (commandIndex < 0 || commandIndex >= commands.length) return path;
  const cmd = commands[commandIndex];
  if (!cmd || cmd.type === "Z") return path;
  const updated: PathCommand = { ...cmd, point: newPoint };
  const newCommands = commands.slice();
  newCommands[commandIndex] = updated;
  return { ...path, commands: newCommands };
}

/**
 * Replaces a control point of commands[commandIndex]: "control1"/"control2" for a
 * C command, "control" for a Q command. No-op if the command doesn't have that
 * control point (wrong type, or out-of-range index). Pure.
 */
export function moveControlPoint(
  path: VectorPath,
  commandIndex: number,
  which: "control1" | "control2" | "control",
  newPoint: Point,
): VectorPath {
  const commands = path.commands;
  if (commandIndex < 0 || commandIndex >= commands.length) return path;
  const cmd = commands[commandIndex];
  if (!cmd) return path;

  let updated: PathCommand | null = null;
  if (cmd.type === "C" && which === "control1") {
    updated = { ...cmd, control1: newPoint };
  } else if (cmd.type === "C" && which === "control2") {
    updated = { ...cmd, control2: newPoint };
  } else if (cmd.type === "Q" && which === "control") {
    updated = { ...cmd, control: newPoint };
  }
  if (!updated) return path;

  const newCommands = commands.slice();
  newCommands[commandIndex] = updated;
  return { ...path, commands: newCommands };
}

/**
 * Flattens a path (which may contain C/Q curves) into a polyline of Points,
 * suitable for hit-testing/rendering/boolean-op input. Curves are adaptively
 * subdivided via De Casteljau's algorithm, splitting until the control point(s)
 * deviate from the chord by no more than `tolerance`, capped at recursion depth
 * MAX_FLATTEN_DEPTH to guarantee termination. Z emits the subpath's start point
 * (unless the last emitted point already equals it) to close the polyline.
 */
export function flattenPath(path: VectorPath, tolerance = 1): Point[] {
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
        flattenCubic(current, cmd.control1, cmd.control2, cmd.point, tolerance, 0, out);
        current = cmd.point;
        break;
      case "Q":
        flattenQuadratic(current, cmd.control, cmd.point, tolerance, 0, out);
        current = cmd.point;
        break;
      case "Z": {
        const last = out[out.length - 1];
        if (!last || !pointsEqual(last, start)) {
          out.push(start);
        }
        current = start;
        break;
      }
    }
  }
  return out;
}
