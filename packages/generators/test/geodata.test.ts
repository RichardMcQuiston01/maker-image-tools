import { describe, expect, it } from "vitest";
import { generateMapFromGeoJson } from "../src/geodata.js";
import type { GeoJsonInput } from "../src/geodata.js";

describe("generateMapFromGeoJson", () => {
  it("projects a LineString's coordinates using the documented scale/offset math", () => {
    // bbox: lon [-10, 10] (width 20), lat [0, 10] (height 10).
    // target 100x100 => scale = min(100/20, 100/10) = min(5, 10) = 5... wait recompute below.
    const geojson: GeoJsonInput = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [-10, 0],
              [0, 10],
              [10, 0],
            ],
          },
        },
      ],
    };

    // Manual computation matching the documented algorithm:
    // bboxWidth = 10 - (-10) = 20, bboxHeight = 10 - 0 = 10.
    // scale = min(width / bboxWidth, height / bboxHeight) = min(100/20, 100/10) = min(5, 10) = 5.
    const width = 100;
    const height = 100;
    const bboxWidth = 20;
    const bboxHeight = 10;
    const scale = Math.min(width / bboxWidth, height / bboxHeight);
    const scaledWidth = bboxWidth * scale;
    const scaledHeight = bboxHeight * scale;
    const offsetX = (width - scaledWidth) / 2;
    const offsetY = (height - scaledHeight) / 2;

    const expected = [
      { x: (-10 - -10) * scale + offsetX, y: (10 - 0) * scale + offsetY },
      { x: (0 - -10) * scale + offsetX, y: (10 - 10) * scale + offsetY },
      { x: (10 - -10) * scale + offsetX, y: (10 - 0) * scale + offsetY },
    ];

    const [path] = generateMapFromGeoJson(geojson, { width, height });
    expect(path).toBeDefined();
    if (!path) return;

    const points = path.commands.flatMap((c) => (c.type === "Z" ? [] : [c.point]));
    expect(points).toHaveLength(3);
    for (let i = 0; i < expected.length; i++) {
      const exp = expected[i];
      const actual = points[i];
      expect(exp).toBeDefined();
      expect(actual).toBeDefined();
      if (!exp || !actual) continue;
      expect(actual.x).toBeCloseTo(exp.x, 5);
      expect(actual.y).toBeCloseTo(exp.y, 5);
    }

    // Path should be open (no closing Z) for a LineString.
    expect(path.commands.at(-1)?.type).not.toBe("Z");
    expect(path.commands[0]?.type).toBe("M");
  });

  it("produces one closed VectorPath per Polygon ring", () => {
    const geojson: GeoJsonInput = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [0, 0],
                [10, 0],
                [10, 10],
                [0, 10],
                [0, 0],
              ],
            ],
          },
        },
      ],
    };

    const paths = generateMapFromGeoJson(geojson, { width: 50, height: 50 });
    expect(paths).toHaveLength(1);
    expect(paths[0]?.commands.at(-1)?.type).toBe("Z");
  });

  it("produces one open VectorPath per MultiLineString sub-line", () => {
    const geojson: GeoJsonInput = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "MultiLineString",
            coordinates: [
              [
                [0, 0],
                [1, 1],
              ],
              [
                [5, 5],
                [6, 6],
                [7, 5],
              ],
            ],
          },
        },
      ],
    };

    const paths = generateMapFromGeoJson(geojson, { width: 50, height: 50 });
    expect(paths).toHaveLength(2);
    for (const path of paths) {
      expect(path.commands.at(-1)?.type).not.toBe("Z");
    }
  });

  it("returns an empty array for an empty FeatureCollection", () => {
    const geojson: GeoJsonInput = { type: "FeatureCollection", features: [] };
    expect(generateMapFromGeoJson(geojson, { width: 100, height: 100 })).toEqual([]);
  });

  it("preserves aspect ratio when fitting a wide bbox into a square target", () => {
    // lon span 20, lat span 5 => input aspect ratio 4:1.
    const geojson: GeoJsonInput = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [0, 0],
              [20, 5],
            ],
          },
        },
      ],
    };

    const [path] = generateMapFromGeoJson(geojson, { width: 100, height: 100 });
    expect(path).toBeDefined();
    if (!path) return;

    const points = path.commands.flatMap((c) => (c.type === "Z" ? [] : [c.point]));
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const xSpan = Math.max(...xs) - Math.min(...xs);
    const ySpan = Math.max(...ys) - Math.min(...ys);

    expect(xSpan / ySpan).toBeCloseTo(20 / 5, 3);
    // Should not fill the full 100x100 square on both axes (would be a 1:1 stretch).
    expect(ySpan).toBeLessThan(100);
  });

  it("does not produce NaN/Infinity for a degenerate zero-width bounding box", () => {
    // Both points share the same longitude => bboxWidth === 0.
    const geojson: GeoJsonInput = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [5, 0],
              [5, 10],
            ],
          },
        },
      ],
    };

    const [path] = generateMapFromGeoJson(geojson, { width: 100, height: 100 });
    expect(path).toBeDefined();
    if (!path) return;
    const points = path.commands.flatMap((c) => (c.type === "Z" ? [] : [c.point]));
    for (const p of points) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });

  it("does not produce NaN/Infinity for a single-point degenerate bounding box", () => {
    const geojson: GeoJsonInput = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "LineString", coordinates: [[5, 5]] },
        },
      ],
    };

    const [path] = generateMapFromGeoJson(geojson, { width: 100, height: 100 });
    expect(path).toBeDefined();
    if (!path) return;
    const points = path.commands.flatMap((c) => (c.type === "Z" ? [] : [c.point]));
    for (const p of points) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });
});
