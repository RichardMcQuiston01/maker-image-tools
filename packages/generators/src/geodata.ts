import type { PathCommand, Point, VectorPath } from "@maker/core-vector";

/**
 * Minimal GeoJSON subset this function understands — a FeatureCollection of LineString /
 * MultiLineString / Polygon geometries, coordinates as [longitude, latitude] pairs (standard
 * GeoJSON order).
 */
export interface GeoJsonInput {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    geometry:
      | { type: "LineString"; coordinates: [number, number][] }
      | { type: "MultiLineString"; coordinates: [number, number][][] }
      | { type: "Polygon"; coordinates: [number, number][][] };
  }>;
}

export interface MapGeneratorOptions {
  /** Target output width in mm. The geodata's bounding box is scaled (preserving aspect ratio) to fit within width x height. */
  width: number;
  /** Target output height in mm. */
  height: number;
}

interface LonLatBBox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

function allCoordinates(geojson: GeoJsonInput): [number, number][] {
  const coords: [number, number][] = [];
  for (const feature of geojson.features) {
    const geometry = feature.geometry;
    if (geometry.type === "LineString") {
      coords.push(...geometry.coordinates);
    } else if (geometry.type === "MultiLineString") {
      for (const line of geometry.coordinates) coords.push(...line);
    } else if (geometry.type === "Polygon") {
      for (const ring of geometry.coordinates) coords.push(...ring);
    }
  }
  return coords;
}

function computeBBox(coords: readonly [number, number][]): LonLatBBox {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of coords) {
    if (lon < minLon) minLon = lon;
    if (lat < minLat) minLat = lat;
    if (lon > maxLon) maxLon = lon;
    if (lat > maxLat) maxLat = lat;
  }
  return { minLon, minLat, maxLon, maxLat };
}

function polylineCommands(points: Point[], closed: boolean): PathCommand[] {
  const commands: PathCommand[] = [];
  const first = points[0];
  if (!first) return commands;
  commands.push({ type: "M", point: first });
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    if (p) commands.push({ type: "L", point: p });
  }
  if (closed) commands.push({ type: "Z" });
  return commands;
}

/**
 * Converts GeoJSON LineString/MultiLineString/Polygon features into laser-ready VectorPaths,
 * scaled to fit the target size with Y-axis flipped (GeoJSON is lat-increases-northward/up;
 * SVG/machine Y increases downward, matching this codebase's other Y-down conventions) and
 * aspect ratio preserved (centered within the target box, not stretched).
 *
 * Simplification: coordinates are treated with a simple equirectangular mapping — longitude maps
 * directly to X and latitude directly to Y, with no real map projection (e.g. no correction for
 * latitude-dependent longitude scale). Real projections are out of scope for this generator.
 */
export function generateMapFromGeoJson(
  geojson: GeoJsonInput,
  options: MapGeneratorOptions,
): VectorPath[] {
  const { width, height } = options;

  if (geojson.features.length === 0) return [];

  const coords = allCoordinates(geojson);
  const bbox = computeBBox(coords);
  const bboxWidth = bbox.maxLon - bbox.minLon;
  const bboxHeight = bbox.maxLat - bbox.minLat;

  const scale =
    bboxWidth === 0 || bboxHeight === 0 ? 1 : Math.min(width / bboxWidth, height / bboxHeight);

  const scaledWidth = bboxWidth * scale;
  const scaledHeight = bboxHeight * scale;
  const offsetX = (width - scaledWidth) / 2;
  const offsetY = (height - scaledHeight) / 2;

  const project = ([lon, lat]: [number, number]): Point => ({
    x: (lon - bbox.minLon) * scale + offsetX,
    y: (bbox.maxLat - lat) * scale + offsetY,
  });

  const paths: VectorPath[] = [];

  for (const feature of geojson.features) {
    const geometry = feature.geometry;
    if (geometry.type === "LineString") {
      const points = geometry.coordinates.map(project);
      paths.push({ id: crypto.randomUUID(), commands: polylineCommands(points, false) });
    } else if (geometry.type === "MultiLineString") {
      for (const line of geometry.coordinates) {
        const points = line.map(project);
        paths.push({ id: crypto.randomUUID(), commands: polylineCommands(points, false) });
      }
    } else if (geometry.type === "Polygon") {
      for (const ring of geometry.coordinates) {
        const points = ring.map(project);
        paths.push({ id: crypto.randomUUID(), commands: polylineCommands(points, true) });
      }
    }
  }

  return paths;
}
