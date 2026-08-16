import type { BBox, PathCommand, Point, VectorPath } from "./types.js";

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function boundingBoxOfPoints(points: readonly Point[]): BBox {
  if (points.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

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

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Points referenced by a path's commands, in order — endpoints only (no control points). */
function commandPoints(commands: readonly PathCommand[]): Point[] {
  const points: Point[] = [];
  for (const command of commands) {
    if (command.type !== "Z") {
      points.push(command.point);
    }
  }
  return points;
}

export function boundingBoxOfPath(path: VectorPath): BBox {
  return boundingBoxOfPoints(commandPoints(path.commands));
}

export function mergeBBox(a: BBox, b: BBox): BBox {
  const minX = Math.min(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxX = Math.max(a.x + a.width, b.x + b.width);
  const maxY = Math.max(a.y + a.height, b.y + b.height);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
