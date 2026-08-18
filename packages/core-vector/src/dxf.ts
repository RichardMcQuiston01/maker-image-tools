import type { PathCommand, Point, VectorPath } from "./types.js";

const CURVE_SEGMENTS = 12;
const CIRCLE_SEGMENTS = 32;
const MAX_ARC_DEGREES_PER_SEGMENT = 15;

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

function cubicBezierPoint(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
}

function quadraticBezierPoint(p0: Point, p1: Point, p2: Point, t: number): Point {
  const mt = 1 - t;
  const a = mt * mt;
  const b = 2 * mt * t;
  const c = t * t;
  return { x: a * p0.x + b * p1.x + c * p2.x, y: a * p0.y + b * p1.y + c * p2.y };
}

/** Flatten a path's commands into polylines of points, honoring M as a new subpath start and Z as closing the current one. Curves are subdivided into straight segments. */
function flattenPath(path: VectorPath): { points: Point[]; closed: boolean }[] {
  const subpaths: { points: Point[]; closed: boolean }[] = [];
  let current: Point[] = [];
  let closed = false;
  let cursor: Point = { x: 0, y: 0 };
  let start: Point = { x: 0, y: 0 };

  const finishSubpath = () => {
    if (current.length > 0) {
      subpaths.push({ points: current, closed });
    }
    current = [];
    closed = false;
  };

  for (const command of path.commands) {
    if (command.type === "M") {
      finishSubpath();
      cursor = command.point;
      start = command.point;
      current.push(cursor);
    } else if (command.type === "L") {
      cursor = command.point;
      current.push(cursor);
    } else if (command.type === "C") {
      for (let i = 1; i <= CURVE_SEGMENTS; i++) {
        const t = i / CURVE_SEGMENTS;
        current.push(cubicBezierPoint(cursor, command.control1, command.control2, command.point, t));
      }
      cursor = command.point;
    } else if (command.type === "Q") {
      for (let i = 1; i <= CURVE_SEGMENTS; i++) {
        const t = i / CURVE_SEGMENTS;
        current.push(quadraticBezierPoint(cursor, command.control, command.point, t));
      }
      cursor = command.point;
    } else if (command.type === "Z") {
      closed = true;
      cursor = start;
    }
  }
  finishSubpath();
  return subpaths;
}

function polylineEntity(points: Point[], closed: boolean): string {
  const lines: string[] = [];
  lines.push("0", "POLYLINE", "8", "0", "66", "1", "70", closed ? "1" : "0");
  for (const p of points) {
    lines.push("0", "VERTEX", "8", "0", "10", String(p.x), "20", String(p.y), "30", "0.0");
  }
  lines.push("0", "SEQEND");
  return lines.join("\n");
}

/**
 * Serialize paths to a minimal DXF R12 ASCII document. Every subpath is written as a
 * POLYLINE entity (not LWPOLYLINE, which is an R14+ entity many R12-era tools reject);
 * curves are flattened to straight VERTEX segments since R12 has no native curve entity
 * we'd want to rely on here.
 */
export function pathsToDxf(paths: VectorPath[]): string {
  const entities: string[] = [];
  for (const path of paths) {
    for (const subpath of flattenPath(path)) {
      if (subpath.points.length < 2) continue;
      entities.push(polylineEntity(subpath.points, subpath.closed));
    }
  }

  const lines = ["0", "SECTION", "2", "ENTITIES", ...entities.flatMap((e) => e.split("\n")), "0", "ENDSEC", "0", "EOF"];
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

interface GroupPair {
  code: number;
  value: string;
}

/** Split raw DXF text into group-code/value pairs, tolerant of CRLF and trailing blank lines. */
function parseGroupPairs(source: string): GroupPair[] {
  const rawLines = source.split(/\r\n|\r|\n/).map((line) => line.trim());
  while (rawLines.length > 0 && rawLines[rawLines.length - 1] === "") {
    rawLines.pop();
  }

  const pairs: GroupPair[] = [];
  for (let i = 0; i + 1 < rawLines.length; i += 2) {
    const codeText = rawLines[i];
    const value = rawLines[i + 1] ?? "";
    const code = Number.parseInt(codeText ?? "", 10);
    if (Number.isNaN(code)) continue;
    pairs.push({ code, value });
  }
  return pairs;
}

interface RawEntity {
  type: string;
  /** All group codes for this entity, in order (a code may repeat, e.g. VERTEX/10 in LWPOLYLINE). */
  fields: GroupPair[];
}

const RECOGNIZED_ENTITY_TYPES = new Set([
  "LINE",
  "POLYLINE",
  "VERTEX",
  "SEQEND",
  "LWPOLYLINE",
  "CIRCLE",
  "ARC",
]);

/**
 * Scan for entity boundaries anywhere in the file. Real-world DXFs put entities inside a
 * SECTION/ENTITIES block, but since entity type codes are unambiguous (LINE, POLYLINE, ...)
 * scanning for `0/<recognized type>` directly is robust enough for this stage and sidesteps
 * needing to track section nesting for HEADER/TABLES/BLOCKS content we don't otherwise parse.
 */
function splitEntities(pairs: GroupPair[]): RawEntity[] {
  const entities: RawEntity[] = [];
  let current: RawEntity | null = null;

  for (const pair of pairs) {
    if (pair.code === 0) {
      if (current) entities.push(current);
      current = RECOGNIZED_ENTITY_TYPES.has(pair.value) ? { type: pair.value, fields: [] } : null;
      continue;
    }
    if (current) current.fields.push(pair);
  }
  if (current) entities.push(current);
  return entities;
}

function findValue(fields: GroupPair[], code: number): string | undefined {
  return fields.find((f) => f.code === code)?.value;
}

function numberOr(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number.parseFloat(value);
  return Number.isNaN(n) ? fallback : n;
}

function newPath(commands: PathCommand[]): VectorPath {
  return { id: crypto.randomUUID(), commands };
}

function lineToPath(fields: GroupPair[]): VectorPath {
  const x1 = numberOr(findValue(fields, 10), 0);
  const y1 = numberOr(findValue(fields, 20), 0);
  const x2 = numberOr(findValue(fields, 11), 0);
  const y2 = numberOr(findValue(fields, 21), 0);
  return newPath([
    { type: "M", point: { x: x1, y: y1 } },
    { type: "L", point: { x: x2, y: y2 } },
  ]);
}

function circleToPath(fields: GroupPair[]): VectorPath {
  const cx = numberOr(findValue(fields, 10), 0);
  const cy = numberOr(findValue(fields, 20), 0);
  const r = numberOr(findValue(fields, 40), 0);

  const commands: PathCommand[] = [];
  for (let i = 0; i < CIRCLE_SEGMENTS; i++) {
    const angle = (i / CIRCLE_SEGMENTS) * 2 * Math.PI;
    const point = { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
    commands.push({ type: i === 0 ? "M" : "L", point });
  }
  commands.push({ type: "Z" });
  return newPath(commands);
}

function arcToPath(fields: GroupPair[]): VectorPath {
  const cx = numberOr(findValue(fields, 10), 0);
  const cy = numberOr(findValue(fields, 20), 0);
  const r = numberOr(findValue(fields, 40), 0);
  const startDeg = numberOr(findValue(fields, 50), 0);
  let endDeg = numberOr(findValue(fields, 51), 0);
  if (endDeg < startDeg) endDeg += 360;

  const span = endDeg - startDeg;
  const segments = Math.max(1, Math.ceil(span / MAX_ARC_DEGREES_PER_SEGMENT));

  const commands: PathCommand[] = [];
  for (let i = 0; i <= segments; i++) {
    const deg = startDeg + (span * i) / segments;
    const rad = (deg * Math.PI) / 180;
    const point = { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
    commands.push({ type: i === 0 ? "M" : "L", point });
  }
  return newPath(commands);
}

function polylineToPath(fields: GroupPair[], allEntitiesFromHere: RawEntity[], index: number): VectorPath | null {
  const flags = Math.trunc(numberOr(findValue(fields, 70), 0));
  const closed = (flags & 1) === 1;

  const commands: PathCommand[] = [];
  for (let i = index + 1; i < allEntitiesFromHere.length; i++) {
    const entity = allEntitiesFromHere[i];
    if (!entity) break;
    if (entity.type === "SEQEND") break;
    if (entity.type !== "VERTEX") continue;
    const x = numberOr(findValue(entity.fields, 10), 0);
    const y = numberOr(findValue(entity.fields, 20), 0);
    commands.push({ type: commands.length === 0 ? "M" : "L", point: { x, y } });
  }
  if (commands.length === 0) return null;
  if (closed) commands.push({ type: "Z" });
  return newPath(commands);
}

function lwpolylineToPath(fields: GroupPair[]): VectorPath | null {
  const flags = Math.trunc(numberOr(findValue(fields, 70), 0));
  const closed = (flags & 1) === 1;

  // Each group code 10 starts a new vertex; the following 20 (if present before the next 10)
  // supplies its y. This tolerates interleaved bulge/width codes we don't otherwise handle.
  const commands: PathCommand[] = [];
  let pendingX: number | null = null;
  for (const field of fields) {
    if (field.code === 10) {
      pendingX = Number.parseFloat(field.value);
    } else if (field.code === 20 && pendingX !== null) {
      const y = Number.parseFloat(field.value);
      commands.push({ type: commands.length === 0 ? "M" : "L", point: { x: pendingX, y } });
      pendingX = null;
    }
  }
  if (commands.length === 0) return null;
  if (closed) commands.push({ type: "Z" });
  return newPath(commands);
}

/**
 * Parse a DXF ASCII document into VectorPaths. Entities are located by scanning for
 * `0/<recognized type>` group codes anywhere in the file (see splitEntities), so HEADER/TABLES
 * content is naturally ignored without needing to track SECTION nesting. Unrecognized entity
 * types are skipped. Malformed or empty input yields an empty array rather than throwing.
 */
export function dxfToPaths(dxfString: string): VectorPath[] {
  const pairs = parseGroupPairs(dxfString);
  const entities = splitEntities(pairs);

  const paths: VectorPath[] = [];
  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];
    if (!entity) continue;
    switch (entity.type) {
      case "LINE":
        paths.push(lineToPath(entity.fields));
        break;
      case "POLYLINE": {
        const path = polylineToPath(entity.fields, entities, i);
        if (path) paths.push(path);
        break;
      }
      case "LWPOLYLINE": {
        const path = lwpolylineToPath(entity.fields);
        if (path) paths.push(path);
        break;
      }
      case "CIRCLE":
        paths.push(circleToPath(entity.fields));
        break;
      case "ARC":
        paths.push(arcToPath(entity.fields));
        break;
      default:
        break; // VERTEX/SEQEND consumed by polylineToPath; anything else is skipped
    }
  }
  return paths;
}
