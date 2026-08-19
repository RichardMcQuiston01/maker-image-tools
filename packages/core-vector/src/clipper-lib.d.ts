/**
 * Minimal ambient declaration for clipper-lib (no official types package,
 * and the package itself ships no .d.ts). Only covers the ClipperOffset API
 * surface this codebase actually uses for kerf/offset compensation.
 *
 * IMPORTANT: Clipper works in INTEGER coordinates. Scale floating-point
 * geometry up (e.g. multiply by 1000) before passing it in, and scale the
 * result back down by the same factor afterward.
 */
declare module "clipper-lib" {
  export interface IntPoint {
    X: number;
    Y: number;
  }

  export type Path = IntPoint[];
  export type Paths = Path[];

  export const JoinType: {
    jtSquare: number;
    jtRound: number;
    jtMiter: number;
  };

  export const EndType: {
    etOpenSquare: number;
    etOpenRound: number;
    etOpenButt: number;
    etClosedLine: number;
    etClosedPolygon: number;
  };

  export class ClipperOffset {
    constructor(miterLimit?: number, arcTolerance?: number);
    AddPath(path: Path, joinType: number, endType: number): void;
    AddPaths(paths: Paths, joinType: number, endType: number): void;
    /** Mutates `solution` in place with the offset result. */
    Execute(solution: Paths, delta: number): void;
  }
}
