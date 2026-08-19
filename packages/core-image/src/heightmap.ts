/**
 * Grayscale image -> heightmap relief -> STL mesh, for CNC-carving or
 * 3D-printing a relief from a photo (e.g. a portrait carved into wood).
 */

export interface HeightmapOptions {
  /** Height in mm of the tallest point (brightest pixel, or darkest if invert). Default 5. */
  maxHeight?: number;
  /** Flat base thickness in mm added underneath the relief (0 = no base, an open-bottomed shell). Default 1. */
  baseHeight?: number;
  /** Physical size of one pixel in mm, applied to both X and Y. Default 0.5. */
  pixelSize?: number;
  /** If true, darker pixels are taller (e.g. for engraving where black = deepest cut). Default false (brighter = taller). */
  invert?: boolean;
  /** Downsample factor — average NxN pixel blocks into one mesh vertex, to keep triangle count sane for large photos. Default 1 (no downsampling). Must be a positive integer. */
  downsample?: number;
}

interface ResolvedOptions {
  maxHeight: number;
  baseHeight: number;
  pixelSize: number;
  invert: boolean;
  downsample: number;
}

function resolveOptions(options: HeightmapOptions | undefined): ResolvedOptions {
  const rawDownsample = options?.downsample ?? 1;
  const downsample = Math.max(1, Math.floor(rawDownsample));
  return {
    maxHeight: options?.maxHeight ?? 5,
    baseHeight: options?.baseHeight ?? 1,
    pixelSize: options?.pixelSize ?? 0.5,
    invert: options?.invert ?? false,
    downsample,
  };
}

function luminanceAt(image: ImageData, x: number, y: number): number {
  const i = (y * image.width + x) * 4;
  const data = image.data;
  const r = data[i] ?? 0;
  const g = data[i + 1] ?? 0;
  const b = data[i + 2] ?? 0;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Computes the row-major height grid (in mm) for an image, including the
 * baseHeight offset — i.e. the top surface's Z ranges from baseHeight to
 * baseHeight + maxHeight (or the reverse when invert is set).
 */
export function computeHeightGrid(
  image: ImageData,
  options?: HeightmapOptions,
): { width: number; height: number; values: Float32Array } {
  const { maxHeight, baseHeight, invert, downsample } = resolveOptions(options);

  const gridWidth = Math.max(1, Math.ceil(image.width / downsample));
  const gridHeight = Math.max(1, Math.ceil(image.height / downsample));
  const values = new Float32Array(gridWidth * gridHeight);

  for (let gy = 0; gy < gridHeight; gy++) {
    for (let gx = 0; gx < gridWidth; gx++) {
      const startX = gx * downsample;
      const startY = gy * downsample;
      const endX = Math.min(startX + downsample, image.width);
      const endY = Math.min(startY + downsample, image.height);

      let sum = 0;
      let count = 0;
      for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
          sum += luminanceAt(image, x, y);
          count++;
        }
      }
      const luminance = count > 0 ? sum / count : 0;
      const normalized = luminance / 255;
      const t = invert ? 1 - normalized : normalized;

      values[gy * gridWidth + gx] = baseHeight + t * maxHeight;
    }
  }

  return { width: gridWidth, height: gridHeight, values };
}

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? value.toString() : "0";
}

function writeFacet(lines: string[], a: Vec3, b: Vec3, c: Vec3): void {
  lines.push("  facet normal 0 0 0");
  lines.push("    outer loop");
  lines.push(`      vertex ${formatNumber(a.x)} ${formatNumber(a.y)} ${formatNumber(a.z)}`);
  lines.push(`      vertex ${formatNumber(b.x)} ${formatNumber(b.y)} ${formatNumber(b.z)}`);
  lines.push(`      vertex ${formatNumber(c.x)} ${formatNumber(c.y)} ${formatNumber(c.z)}`);
  lines.push("    endloop");
  lines.push("  endfacet");
}

/** Builds a complete ASCII STL string for a grayscale-to-relief heightmap. */
export function imageToHeightmapStl(image: ImageData, options?: HeightmapOptions): string {
  const { baseHeight, pixelSize, downsample } = resolveOptions(options);
  const grid = computeHeightGrid(image, options);
  const { width, height, values } = grid;

  const cellSize = pixelSize * downsample;

  const heightAt = (gx: number, gy: number): number => values[gy * width + gx] ?? 0;
  const topVertex = (gx: number, gy: number): Vec3 => ({
    x: gx * cellSize,
    y: gy * cellSize,
    z: heightAt(gx, gy),
  });
  const bottomVertex = (gx: number, gy: number): Vec3 => ({
    x: gx * cellSize,
    y: gy * cellSize,
    z: 0,
  });

  const lines: string[] = ["solid heightmap"];

  // Top surface: 2 triangles per grid cell.
  for (let gy = 0; gy < height - 1; gy++) {
    for (let gx = 0; gx < width - 1; gx++) {
      const topLeft = topVertex(gx, gy);
      const topRight = topVertex(gx + 1, gy);
      const bottomLeft = topVertex(gx, gy + 1);
      const bottomRight = topVertex(gx + 1, gy + 1);

      writeFacet(lines, topLeft, bottomLeft, topRight);
      writeFacet(lines, topRight, bottomLeft, bottomRight);
    }
  }

  if (baseHeight > 0) {
    const maxX = (width - 1) * cellSize;
    const maxY = (height - 1) * cellSize;

    // Flat bottom rectangle: 2 triangles for the whole base (kept simple to limit triangle count).
    const b00: Vec3 = { x: 0, y: 0, z: 0 };
    const b10: Vec3 = { x: maxX, y: 0, z: 0 };
    const b01: Vec3 = { x: 0, y: maxY, z: 0 };
    const b11: Vec3 = { x: maxX, y: maxY, z: 0 };
    // Wound so the normal faces downward (-Z), opposite the top surface's upward winding.
    writeFacet(lines, b00, b10, b01);
    writeFacet(lines, b10, b11, b01);

    // Side walls connecting the top surface's outer edge to the flat bottom, one quad
    // (2 triangles) per grid cell along each of the four edges, so the mesh stays manifold.
    for (let gx = 0; gx < width - 1; gx++) {
      // North edge (gy = 0).
      const t0 = topVertex(gx, 0);
      const t1 = topVertex(gx + 1, 0);
      const bt0 = bottomVertex(gx, 0);
      const bt1 = bottomVertex(gx + 1, 0);
      writeFacet(lines, t0, t1, bt0);
      writeFacet(lines, t1, bt1, bt0);

      // South edge (gy = height - 1).
      const s0 = topVertex(gx, height - 1);
      const s1 = topVertex(gx + 1, height - 1);
      const bs0 = bottomVertex(gx, height - 1);
      const bs1 = bottomVertex(gx + 1, height - 1);
      writeFacet(lines, s1, s0, bs1);
      writeFacet(lines, s0, bs0, bs1);
    }

    for (let gy = 0; gy < height - 1; gy++) {
      // West edge (gx = 0).
      const w0 = topVertex(0, gy);
      const w1 = topVertex(0, gy + 1);
      const bw0 = bottomVertex(0, gy);
      const bw1 = bottomVertex(0, gy + 1);
      writeFacet(lines, w1, w0, bw1);
      writeFacet(lines, w0, bw0, bw1);

      // East edge (gx = width - 1).
      const e0 = topVertex(width - 1, gy);
      const e1 = topVertex(width - 1, gy + 1);
      const be0 = bottomVertex(width - 1, gy);
      const be1 = bottomVertex(width - 1, gy + 1);
      writeFacet(lines, e0, e1, be0);
      writeFacet(lines, e1, be1, be0);
    }
  }

  lines.push("endsolid heightmap");
  return lines.join("\n");
}
