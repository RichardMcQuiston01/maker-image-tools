/**
 * Test-grid generators. Unlike Filters these don't transform an input image —
 * they synthesize a fresh calibration/test-pattern ImageData from options
 * alone, so they intentionally don't match the `Filter<TOptions>` shape.
 */
import { createImageData, setPixel } from "../pixel.js";

const WHITE: [number, number, number, number] = [255, 255, 255, 255];
const BLACK: [number, number, number, number] = [0, 0, 0, 255];

export interface DpiTestGridOptions {
  widthPx?: number;
  heightPx?: number;
  lineSpacingPx?: number;
}

/**
 * A ruled grid of vertical + horizontal lines, spaced `lineSpacingPx` apart,
 * with every 10th line drawn 2px wide. Meant to be engraved and physically
 * measured to determine the laser's actual achieved DPI/line spacing.
 */
function clampInt(value: number | undefined, fallback: number, min: number): number {
  const resolved = value ?? fallback;
  return Math.max(min, Math.floor(resolved));
}

/** Loop increments and pixel dimensions must be >=1 (a value <=0 would spin forever/produce an invalid ImageData). */
function positiveInt(value: number | undefined, fallback: number): number {
  return clampInt(value, fallback, 1);
}

export function generateDpiTestGrid(options: DpiTestGridOptions = {}): ImageData {
  const widthPx = positiveInt(options.widthPx, 400);
  const heightPx = positiveInt(options.heightPx, 400);
  const lineSpacingPx = positiveInt(options.lineSpacingPx, 10);

  const image = createImageData(widthPx, heightPx, WHITE);

  const drawVerticalLine = (x: number, thickness: number): void => {
    for (let t = 0; t < thickness; t++) {
      const px = x + t;
      if (px < 0 || px >= widthPx) continue;
      for (let y = 0; y < heightPx; y++) {
        setPixel(image, px, y, BLACK);
      }
    }
  };

  const drawHorizontalLine = (y: number, thickness: number): void => {
    for (let t = 0; t < thickness; t++) {
      const py = y + t;
      if (py < 0 || py >= heightPx) continue;
      for (let x = 0; x < widthPx; x++) {
        setPixel(image, x, py, BLACK);
      }
    }
  };

  let index = 0;
  for (let x = 0; x < widthPx; x += lineSpacingPx, index++) {
    drawVerticalLine(x, index % 10 === 0 ? 2 : 1);
  }

  index = 0;
  for (let y = 0; y < heightPx; y += lineSpacingPx, index++) {
    drawHorizontalLine(y, index % 10 === 0 ? 2 : 1);
  }

  return image;
}

export interface MaterialTestGridOptions {
  speeds?: number[];
  powers?: number[];
  cellSizePx?: number;
  gapPx?: number;
}

/**
 * A grid of filled squares, one per (speed, power) combination — rows are
 * `powers`, columns are `speeds` — meant to be engraved once on a new
 * material to find good settings. Fill is a grayscale preview only (not a
 * laser-accurate rendering): darker = higher power.
 */
export function generateMaterialTestGrid(options: MaterialTestGridOptions = {}): ImageData {
  const speeds = options.speeds ?? [100, 200, 300, 400, 500];
  const powers = options.powers ?? [20, 40, 60, 80, 100];
  const cellSizePx = positiveInt(options.cellSizePx, 60);
  // gapPx=0 (cells touching) is legitimate; only negative/fractional needs guarding.
  const gapPx = clampInt(options.gapPx, 4, 0);

  const columns = speeds.length;
  const rows = powers.length;
  const width = columns * cellSizePx + (columns + 1) * gapPx;
  const height = rows * cellSizePx + (rows + 1) * gapPx;

  const image = createImageData(width, height, WHITE);
  const maxPower = Math.max(...powers);

  for (let r = 0; r < rows; r++) {
    const darkness = maxPower === 0 ? 0 : (powers[r] ?? 0) / maxPower;
    const gray = Math.round(255 * (1 - darkness));
    const fill: [number, number, number, number] = [gray, gray, gray, 255];
    const cellY = gapPx + r * (cellSizePx + gapPx);

    for (let c = 0; c < columns; c++) {
      const cellX = gapPx + c * (cellSizePx + gapPx);
      for (let y = 0; y < cellSizePx; y++) {
        for (let x = 0; x < cellSizePx; x++) {
          setPixel(image, cellX + x, cellY + y, fill);
        }
      }
    }
  }

  return image;
}
