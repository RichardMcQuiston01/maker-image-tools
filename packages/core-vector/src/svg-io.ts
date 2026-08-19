import type { PathCommand, Point, VectorPath } from "./types.js";
import { createSvgRoot, parseSvg, serializeSvg } from "./svg.js";

const SVG_NS = "http://www.w3.org/2000/svg";
/** Kappa: cubic-bezier control offset that best approximates a quarter circle. */
const KAPPA = 0.5522847498;

type Token = { kind: "cmd"; letter: string } | { kind: "num"; value: number };

function tokenize(d: string): Token[] {
  // Matches a single command letter, or a (possibly signed/exponential) number.
  // Numbers with no separator between them (e.g. "0.5.5") are correctly split
  // because each match consumes only as much as a single number needs.
  const re = /([MmLlHhVvCcQqZzAaSsTt])|(-?\d*\.\d+(?:[eE][-+]?\d+)?|-?\d+(?:[eE][-+]?\d+)?)/g;
  const tokens: Token[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(d)) !== null) {
    if (match[1]) {
      tokens.push({ kind: "cmd", letter: match[1] });
    } else if (match[2] !== undefined) {
      tokens.push({ kind: "num", value: Number(match[2]) });
    }
  }
  return tokens;
}

/**
 * Endpoint-to-center elliptical arc conversion (W3C SVG 1.1 Appendix F.6),
 * sampled into a polyline. Best-effort: assumes the two flag digits are
 * tokenized as separate numbers (i.e. whitespace/comma separated in the
 * source, e.g. "A25,25,0,1,1,50,50"); the zero-separator shorthand for
 * concatenated flags (e.g. "...0 01 50 50") is not specially handled.
 */
function arcToPoints(
  x1: number,
  y1: number,
  rxIn: number,
  ryIn: number,
  xAxisRotationDeg: number,
  largeArcFlag: boolean,
  sweepFlag: boolean,
  x2: number,
  y2: number,
): Point[] {
  if (rxIn === 0 || ryIn === 0) {
    return [{ x: x2, y: y2 }];
  }
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  const phi = (xAxisRotationDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);

  const dx2 = (x1 - x2) / 2;
  const dy2 = (y1 - y2) / 2;
  const x1p = cosPhi * dx2 + sinPhi * dy2;
  const y1p = -sinPhi * dx2 + cosPhi * dy2;

  let rxSq = rx * rx;
  let rySq = ry * ry;
  const x1pSq = x1p * x1p;
  const y1pSq = y1p * y1p;

  const lambda = x1pSq / rxSq + y1pSq / rySq;
  if (lambda > 1) {
    const scale = Math.sqrt(lambda);
    rx *= scale;
    ry *= scale;
    rxSq = rx * rx;
    rySq = ry * ry;
  }

  const sign = largeArcFlag !== sweepFlag ? 1 : -1;
  const num = rxSq * rySq - rxSq * y1pSq - rySq * x1pSq;
  const denom = rxSq * y1pSq + rySq * x1pSq;
  const co = sign * Math.sqrt(Math.max(0, num) / (denom === 0 ? 1 : denom));
  const cxp = (co * (rx * y1p)) / ry;
  const cyp = (co * (-ry * x1p)) / rx;

  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;

  const angleBetween = (ux: number, uy: number, vx: number, vy: number): number => {
    const dot = ux * vx + uy * vy;
    const len = Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy));
    let a = Math.acos(Math.min(1, Math.max(-1, len === 0 ? 1 : dot / len)));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };

  const theta1 = angleBetween(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dtheta = angleBetween(
    (x1p - cxp) / rx,
    (y1p - cyp) / ry,
    (-x1p - cxp) / rx,
    (-y1p - cyp) / ry,
  );
  if (!sweepFlag && dtheta > 0) dtheta -= 2 * Math.PI;
  if (sweepFlag && dtheta < 0) dtheta += 2 * Math.PI;

  const segments = Math.max(2, Math.ceil(Math.abs(dtheta) / (Math.PI / 16)));
  const points: Point[] = [];
  for (let i = 1; i <= segments; i++) {
    const t = theta1 + (dtheta * i) / segments;
    points.push({
      x: cx + rx * Math.cos(t) * cosPhi - ry * Math.sin(t) * sinPhi,
      y: cy + rx * Math.cos(t) * sinPhi + ry * Math.sin(t) * cosPhi,
    });
  }
  return points;
}

/**
 * Parses an SVG path `d` attribute into absolute PathCommands.
 *
 * Support level: M/m L/l H/h V/v C/c Q/q Z/z are fully supported (relative
 * commands resolved against a tracked current point; H/V expanded to full
 * L commands; implicit repeated arguments supported, e.g. "M0 0 10 10").
 * A/a (elliptical arc) is best-effort: converted to a short run of L
 * segments approximating the arc (see arcToPoints for caveats), never
 * throwing. S/T/s/t (smooth curve shorthand) are NOT supported; encountering
 * one stops parsing further (returning whatever was parsed so far) rather
 * than misinterpreting subsequent numbers. Malformed/truncated data is
 * handled the same way: parsing never throws, it just stops early.
 */
export function pathDataToCommands(d: string): PathCommand[] {
  const tokens = tokenize(d);
  const commands: PathCommand[] = [];
  let i = 0;
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let currentLetter: string | null = null;

  const nextNum = (): number => {
    const t = tokens[i];
    if (!t || t.kind !== "num") throw new Error("malformed path data");
    i++;
    return t.value;
  };

  try {
    while (i < tokens.length) {
      const t = tokens[i];
      if (!t) break;
      if (t.kind === "cmd") {
        currentLetter = t.letter;
        i++;
      }
      if (currentLetter === null) break;

      switch (currentLetter) {
        case "M":
        case "m": {
          const x = nextNum();
          const y = nextNum();
          const abs: boolean = currentLetter === "M";
          cx = abs ? x : cx + x;
          cy = abs ? y : cy + y;
          sx = cx;
          sy = cy;
          commands.push({ type: "M", point: { x: cx, y: cy } });
          // Implicit repeats after the first M pair are treated as lineto.
          currentLetter = abs ? "L" : "l";
          break;
        }
        case "L":
        case "l": {
          const x = nextNum();
          const y = nextNum();
          const abs = currentLetter === "L";
          cx = abs ? x : cx + x;
          cy = abs ? y : cy + y;
          commands.push({ type: "L", point: { x: cx, y: cy } });
          break;
        }
        case "H":
        case "h": {
          const x = nextNum();
          cx = currentLetter === "H" ? x : cx + x;
          commands.push({ type: "L", point: { x: cx, y: cy } });
          break;
        }
        case "V":
        case "v": {
          const y = nextNum();
          cy = currentLetter === "V" ? y : cy + y;
          commands.push({ type: "L", point: { x: cx, y: cy } });
          break;
        }
        case "C":
        case "c": {
          const x1 = nextNum();
          const y1 = nextNum();
          const x2 = nextNum();
          const y2 = nextNum();
          const ex = nextNum();
          const ey = nextNum();
          const abs = currentLetter === "C";
          const control1 = abs ? { x: x1, y: y1 } : { x: cx + x1, y: cy + y1 };
          const control2 = abs ? { x: x2, y: y2 } : { x: cx + x2, y: cy + y2 };
          const point = abs ? { x: ex, y: ey } : { x: cx + ex, y: cy + ey };
          commands.push({ type: "C", control1, control2, point });
          cx = point.x;
          cy = point.y;
          break;
        }
        case "Q":
        case "q": {
          const x1 = nextNum();
          const y1 = nextNum();
          const ex = nextNum();
          const ey = nextNum();
          const abs = currentLetter === "Q";
          const control = abs ? { x: x1, y: y1 } : { x: cx + x1, y: cy + y1 };
          const point = abs ? { x: ex, y: ey } : { x: cx + ex, y: cy + ey };
          commands.push({ type: "Q", control, point });
          cx = point.x;
          cy = point.y;
          break;
        }
        case "Z":
        case "z": {
          commands.push({ type: "Z" });
          cx = sx;
          cy = sy;
          // Z never implicitly repeats; a following bare number would be malformed.
          currentLetter = null;
          break;
        }
        case "A":
        case "a": {
          const rx = nextNum();
          const ry = nextNum();
          const xrot = nextNum();
          const largeArc = nextNum() !== 0;
          const sweep = nextNum() !== 0;
          const ex = nextNum();
          const ey = nextNum();
          const abs = currentLetter === "A";
          const endX = abs ? ex : cx + ex;
          const endY = abs ? ey : cy + ey;
          for (const p of arcToPoints(cx, cy, rx, ry, xrot, largeArc, sweep, endX, endY)) {
            commands.push({ type: "L", point: p });
          }
          cx = endX;
          cy = endY;
          break;
        }
        default:
          // Unsupported command (S/T smooth-curve shorthand, or garbage). Bail out
          // rather than risk misinterpreting trailing numbers as the wrong command.
          i = tokens.length;
          break;
      }
    }
  } catch {
    // Truncated/malformed argument list — return whatever parsed cleanly so far.
  }

  return commands;
}

/** Serializes PathCommands back into an SVG path `d` string using absolute commands only. */
export function commandsToPathData(commands: PathCommand[]): string {
  const parts: string[] = [];
  for (const c of commands) {
    switch (c.type) {
      case "M":
        parts.push(`M ${c.point.x},${c.point.y}`);
        break;
      case "L":
        parts.push(`L ${c.point.x},${c.point.y}`);
        break;
      case "C":
        parts.push(
          `C ${c.control1.x},${c.control1.y} ${c.control2.x},${c.control2.y} ${c.point.x},${c.point.y}`,
        );
        break;
      case "Q":
        parts.push(`Q ${c.control.x},${c.control.y} ${c.point.x},${c.point.y}`);
        break;
      case "Z":
        parts.push("Z");
        break;
    }
  }
  return parts.join(" ");
}

function attrNum(el: Element, name: string, fallback = 0): number {
  const v = el.getAttribute(name);
  if (v === null) return fallback;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function parsePointsAttr(value: string): Point[] {
  const nums = (value.match(/-?\d*\.?\d+(?:[eE][-+]?\d+)?/g) ?? []).map(Number);
  const points: Point[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    const x = nums[i];
    const y = nums[i + 1];
    if (x === undefined || y === undefined) continue;
    points.push({ x, y });
  }
  return points;
}

function polylineCommands(points: Point[], closed: boolean): PathCommand[] {
  const first = points[0];
  if (!first) return [];
  const commands: PathCommand[] = [{ type: "M", point: first }];
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    if (p) commands.push({ type: "L", point: p });
  }
  if (closed) commands.push({ type: "Z" });
  return commands;
}

/** Standard 4-cubic-bezier construction of a circle/ellipse, closed. */
function circleCommands(cx: number, cy: number, rx: number, ry: number): PathCommand[] {
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;
  return [
    { type: "M", point: { x: cx + rx, y: cy } },
    {
      type: "C",
      control1: { x: cx + rx, y: cy + ky },
      control2: { x: cx + kx, y: cy + ry },
      point: { x: cx, y: cy + ry },
    },
    {
      type: "C",
      control1: { x: cx - kx, y: cy + ry },
      control2: { x: cx - rx, y: cy + ky },
      point: { x: cx - rx, y: cy },
    },
    {
      type: "C",
      control1: { x: cx - rx, y: cy - ky },
      control2: { x: cx - kx, y: cy - ry },
      point: { x: cx, y: cy - ry },
    },
    {
      type: "C",
      control1: { x: cx + kx, y: cy - ry },
      control2: { x: cx + rx, y: cy - ky },
      point: { x: cx + rx, y: cy },
    },
    { type: "Z" },
  ];
}

/**
 * Parses an SVG document string into VectorPaths by walking every descendant
 * element in document order. Recognizes <path>, <rect>, <circle>, <ellipse>,
 * <line>, <polyline>, <polygon>; anything else (including containers like
 * <g>/<defs>) is skipped without error — their recognized descendants are
 * still visited since querySelectorAll walks the whole subtree.
 */
export function svgToPaths(svgString: string): VectorPath[] {
  const root = parseSvg(svgString);
  const elements = root.querySelectorAll("*");
  const paths: VectorPath[] = [];

  elements.forEach((el) => {
    const tag = el.tagName.toLowerCase();
    switch (tag) {
      case "path": {
        const d = el.getAttribute("d");
        if (!d) return;
        paths.push({ id: crypto.randomUUID(), commands: pathDataToCommands(d) });
        break;
      }
      case "rect": {
        const x = attrNum(el, "x");
        const y = attrNum(el, "y");
        const width = attrNum(el, "width");
        const height = attrNum(el, "height");
        if (width <= 0 || height <= 0) return;
        paths.push({
          id: crypto.randomUUID(),
          commands: [
            { type: "M", point: { x, y } },
            { type: "L", point: { x: x + width, y } },
            { type: "L", point: { x: x + width, y: y + height } },
            { type: "L", point: { x, y: y + height } },
            { type: "Z" },
          ],
        });
        break;
      }
      case "circle": {
        const cx = attrNum(el, "cx");
        const cy = attrNum(el, "cy");
        const r = attrNum(el, "r");
        if (r <= 0) return;
        paths.push({ id: crypto.randomUUID(), commands: circleCommands(cx, cy, r, r) });
        break;
      }
      case "ellipse": {
        const cx = attrNum(el, "cx");
        const cy = attrNum(el, "cy");
        const rx = attrNum(el, "rx");
        const ry = attrNum(el, "ry");
        if (rx <= 0 || ry <= 0) return;
        paths.push({ id: crypto.randomUUID(), commands: circleCommands(cx, cy, rx, ry) });
        break;
      }
      case "line": {
        const x1 = attrNum(el, "x1");
        const y1 = attrNum(el, "y1");
        const x2 = attrNum(el, "x2");
        const y2 = attrNum(el, "y2");
        paths.push({
          id: crypto.randomUUID(),
          commands: [
            { type: "M", point: { x: x1, y: y1 } },
            { type: "L", point: { x: x2, y: y2 } },
          ],
        });
        break;
      }
      case "polyline": {
        const pts = parsePointsAttr(el.getAttribute("points") ?? "");
        if (pts.length < 2) return;
        paths.push({ id: crypto.randomUUID(), commands: polylineCommands(pts, false) });
        break;
      }
      case "polygon": {
        const pts = parsePointsAttr(el.getAttribute("points") ?? "");
        if (pts.length < 2) return;
        paths.push({ id: crypto.randomUUID(), commands: polylineCommands(pts, true) });
        break;
      }
      default:
        break;
    }
  });

  return paths;
}

/**
 * Serializes VectorPaths to an SVG document string, one <path> element per
 * VectorPath. Canvas size defaults to 400x400 (chosen for simplicity — the
 * geometry itself is not clipped to the viewport, so this is just a nominal
 * document size) and can be overridden via `options`.
 */
export function pathsToSvg(
  paths: VectorPath[],
  options?: { width?: number; height?: number },
): string {
  const width = options?.width ?? 400;
  const height = options?.height ?? 400;
  const root = createSvgRoot(width, height);
  const doc = root.ownerDocument;
  for (const path of paths) {
    const el = doc.createElementNS(SVG_NS, "path");
    el.setAttribute("d", commandsToPathData(path.commands));
    root.appendChild(el);
  }
  return serializeSvg(root);
}
