import type { BBox, Point } from "@maker/core-vector";
import { boundingBoxOfPoints } from "@maker/core-vector";

export interface GcodeMove {
  type: "rapid" | "cut";
  from: Point;
  to: Point;
  feedRate?: number;
  power?: number;
  laserOn: boolean;
}

const WORD_RE = /^([A-Za-z])(-?\d+(?:\.\d+)?)$/;

/** Strip `;` line comments and `(...)` parenthetical comments, then trim. */
function stripComments(line: string): string {
  const withoutSemicolon = line.split(";")[0] ?? "";
  return withoutSemicolon.replace(/\([^)]*\)/g, "").trim();
}

interface Word {
  letter: string;
  value: number;
}

function tokenize(line: string): Word[] {
  const words: Word[] = [];
  for (const token of line.split(/\s+/)) {
    if (token.length === 0) continue;
    const match = WORD_RE.exec(token);
    if (!match) continue;
    const letter = match[1]?.toUpperCase();
    const value = Number(match[2]);
    if (!letter || Number.isNaN(value)) continue;
    words.push({ letter, value });
  }
  return words;
}

function findWord(words: readonly Word[], letter: string): Word | undefined {
  return words.find((w) => w.letter === letter);
}

function hasGCode(words: readonly Word[], code: number): boolean {
  return words.some((w) => w.letter === "G" && w.value === code);
}

function hasMCode(words: readonly Word[], code: number): boolean {
  return words.some((w) => w.letter === "M" && w.value === code);
}

export function parseGcode(gcodeText: string): GcodeMove[] {
  const moves: GcodeMove[] = [];

  let currentX = 0;
  let currentY = 0;
  let currentFeedRate: number | undefined;
  let currentPower: number | undefined;
  let laserOn = false;

  const lines = gcodeText.split(/\r\n|\n/);

  for (const rawLine of lines) {
    const line = stripComments(rawLine);
    if (line.length === 0) continue;

    const words = tokenize(line);
    if (words.length === 0) continue;

    const fWord = findWord(words, "F");
    if (fWord) currentFeedRate = fWord.value;

    const sWord = findWord(words, "S");
    if (sWord) currentPower = sWord.value;

    if (hasMCode(words, 3) || hasMCode(words, 4)) laserOn = true;
    if (hasMCode(words, 5)) laserOn = false;

    const isRapid = hasGCode(words, 0);
    const isCut = hasGCode(words, 1) || hasGCode(words, 2) || hasGCode(words, 3);
    // G2/G3 (arcs) are best-effort only: treated as a straight chord to the
    // target X/Y, ignoring I/J/R — real arc interpolation is out of scope.
    if (!isRapid && !isCut) continue;

    const xWord = findWord(words, "X");
    const yWord = findWord(words, "Y");
    const targetX = xWord ? xWord.value : currentX;
    const targetY = yWord ? yWord.value : currentY;

    if (targetX !== currentX || targetY !== currentY) {
      const move: GcodeMove = {
        type: isRapid ? "rapid" : "cut",
        from: { x: currentX, y: currentY },
        to: { x: targetX, y: targetY },
        laserOn,
        ...(currentFeedRate !== undefined ? { feedRate: currentFeedRate } : {}),
        ...(currentPower !== undefined ? { power: currentPower } : {}),
      };
      moves.push(move);
    }

    currentX = targetX;
    currentY = targetY;
  }

  return moves;
}

export function computeGcodeBounds(moves: GcodeMove[]): BBox {
  const points: Point[] = [];
  for (const move of moves) {
    points.push(move.from, move.to);
  }
  return boundingBoxOfPoints(points);
}
