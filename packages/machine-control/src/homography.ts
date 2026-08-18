import type { Point } from "@maker/core-vector";

export interface PointCorrespondence {
  source: Point;
  target: Point;
}

export interface HomographyMatrix {
  m: number[];
}

const UNKNOWNS = 8;

export function computeHomography(correspondences: PointCorrespondence[]): HomographyMatrix {
  if (correspondences.length < 4) {
    throw new Error("computeHomography requires at least 4 point correspondences");
  }

  // Direct Linear Transform (DLT): each correspondence (x, y) -> (x', y')
  // contributes two rows to the linear system A*h = b in the 8 unknowns
  // h0..h7, with h8 fixed to 1 (a homography is only defined up to scale).
  const rows: number[][] = [];
  const rhs: number[] = [];

  for (const { source, target } of correspondences) {
    const { x, y } = source;
    const { x: xp, y: yp } = target;
    rows.push([x, y, 1, 0, 0, 0, -xp * x, -xp * y]);
    rhs.push(xp);
    rows.push([0, 0, 0, x, y, 1, -yp * x, -yp * y]);
    rhs.push(yp);
  }

  const AtA = multiplyAtA(rows);
  const Atb = multiplyAtB(rows, rhs);
  const h = solveLinearSystem(AtA, Atb);

  return { m: [...h, 1] };
}

export function applyHomography(matrix: HomographyMatrix, point: Point): Point {
  const m = matrix.m;
  const xp = m[0]! * point.x + m[1]! * point.y + m[2]!;
  const yp = m[3]! * point.x + m[4]! * point.y + m[5]!;
  const wp = m[6]! * point.x + m[7]! * point.y + m[8]!;
  return { x: xp / wp, y: yp / wp };
}

/** Computes A^T * A for the tall N x 8 matrix `rows`, returning an 8x8 matrix. */
function multiplyAtA(rows: number[][]): number[][] {
  const result: number[][] = Array.from({ length: UNKNOWNS }, () =>
    new Array<number>(UNKNOWNS).fill(0),
  );
  for (const row of rows) {
    for (let i = 0; i < UNKNOWNS; i++) {
      const resultRow = result[i]!;
      const rowI = row[i]!;
      for (let j = 0; j < UNKNOWNS; j++) {
        resultRow[j] = resultRow[j]! + rowI * row[j]!;
      }
    }
  }
  return result;
}

/** Computes A^T * b for the tall N x 8 matrix `rows` and length-N vector `b`. */
function multiplyAtB(rows: number[][], b: number[]): number[] {
  const result = new Array<number>(UNKNOWNS).fill(0);
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]!;
    const bVal = b[r]!;
    for (let i = 0; i < UNKNOWNS; i++) {
      result[i] = result[i]! + row[i]! * bVal;
    }
  }
  return result;
}

/**
 * Solves the square system A*x = b via Gaussian elimination with partial
 * pivoting. A small, self-contained helper so this module has no external
 * linear-algebra dependency.
 */
function solveLinearSystem(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m: number[][] = a.map((row, i) => [...row, b[i]!]);

  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    let maxAbs = Math.abs(m[col]![col]!);
    for (let r = col + 1; r < n; r++) {
      const val = Math.abs(m[r]![col]!);
      if (val > maxAbs) {
        maxAbs = val;
        pivotRow = r;
      }
    }
    if (maxAbs === 0) {
      throw new Error("computeHomography: degenerate point correspondences");
    }
    if (pivotRow !== col) {
      const tmp = m[col]!;
      m[col] = m[pivotRow]!;
      m[pivotRow] = tmp;
    }

    const pivotValue = m[col]![col]!;
    for (let r = col + 1; r < n; r++) {
      const factor = m[r]![col]! / pivotValue;
      if (factor === 0) continue;
      for (let c = col; c <= n; c++) {
        m[r]![c] = m[r]![c]! - factor * m[col]![c]!;
      }
    }
  }

  const x = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let sum = m[row]![n]!;
    for (let c = row + 1; c < n; c++) {
      sum -= m[row]![c]! * x[c]!;
    }
    x[row] = sum / m[row]![row]!;
  }
  return x;
}
