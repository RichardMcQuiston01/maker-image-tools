export interface Point {
  x: number;
  y: number;
}

export interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type PathCommand =
  | { type: "M"; point: Point }
  | { type: "L"; point: Point }
  | { type: "C"; control1: Point; control2: Point; point: Point }
  | { type: "Q"; control: Point; point: Point }
  | { type: "Z" };

export interface VectorPath {
  id: string;
  commands: PathCommand[];
}
