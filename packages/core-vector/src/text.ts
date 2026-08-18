import type * as opentype from "opentype.js";
import type { PathCommand, VectorPath } from "./types.js";

export interface TextToPathsOptions {
  x?: number;
  y?: number;
  fontSize?: number;
}

/**
 * Converts `text` rendered with `font` into one VectorPath per glyph contour
 * (a glyph with holes, e.g. "o", yields multiple paths — one per M...Z run).
 *
 * Coordinates are passed through exactly as returned by opentype.js's
 * `Font#getPath`, which follows font-engine convention (Y increases upward,
 * baseline-relative) rather than SVG/canvas Y-down — callers must transform
 * if they need Y-down coordinates.
 */
export function textToPaths(
  font: opentype.Font,
  text: string,
  options?: TextToPathsOptions,
): VectorPath[] {
  const x = options?.x ?? 0;
  const y = options?.y ?? 0;
  const fontSize = options?.fontSize ?? 72;

  const path = font.getPath(text, x, y, fontSize);
  const result: VectorPath[] = [];
  let current: PathCommand[] | null = null;

  for (const command of path.commands) {
    if (command.type === "M") {
      if (current !== null) {
        pushIfNotDegenerate(result, current);
      }
      current = [];
    }
    if (current === null) {
      // Defensive: shouldn't happen since opentype paths always start with M.
      current = [];
    }
    current.push(toPathCommand(command));
  }
  if (current !== null) {
    pushIfNotDegenerate(result, current);
  }

  return result;
}

function pushIfNotDegenerate(result: VectorPath[], commands: PathCommand[]): void {
  if (commands.length >= 2) {
    result.push({ id: crypto.randomUUID(), commands });
  }
}

function toPathCommand(command: opentype.PathCommand): PathCommand {
  switch (command.type) {
    case "M":
      return { type: "M", point: { x: command.x, y: command.y } };
    case "L":
      return { type: "L", point: { x: command.x, y: command.y } };
    case "C":
      return {
        type: "C",
        control1: { x: command.x1, y: command.y1 },
        control2: { x: command.x2, y: command.y2 },
        point: { x: command.x, y: command.y },
      };
    case "Q":
      return {
        type: "Q",
        control: { x: command.x1, y: command.y1 },
        point: { x: command.x, y: command.y },
      };
    case "Z":
      return { type: "Z" };
  }
}

export function measureText(
  font: opentype.Font,
  text: string,
  fontSize?: number,
): { width: number } {
  return { width: font.getAdvanceWidth(text, fontSize ?? 72) };
}
