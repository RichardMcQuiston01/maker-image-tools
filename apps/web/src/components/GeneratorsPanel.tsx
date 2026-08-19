import { useCallback, useState } from "react";
import type { VectorPath } from "@maker/core-vector";
import {
  generateEarringPair,
  generateFingerJointBox,
  generateKeychainBlank,
  generateMapFromGeoJson,
  type GeoJsonInput,
  type KeychainOptions,
} from "@maker/generators";

interface GeneratorsPanelProps {
  onAddPaths: (paths: VectorPath[]) => void;
}

function BoxJointGenerator({ onAddPaths }: GeneratorsPanelProps) {
  const [width, setWidth] = useState(100);
  const [depth, setDepth] = useState(80);
  const [height, setHeight] = useState(50);
  const [materialThickness, setMaterialThickness] = useState(3);
  const [fingerWidth, setFingerWidth] = useState(10);
  const [includeLid, setIncludeLid] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = useCallback(() => {
    try {
      const result = generateFingerJointBox({
        width,
        depth,
        height,
        materialThickness,
        fingerWidth,
        includeLid,
      });
      onAddPaths(result.panels);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate box");
    }
  }, [width, depth, height, materialThickness, fingerWidth, includeLid, onAddPaths]);

  return (
    <fieldset className="generators-panel__section">
      <legend>Finger-joint box</legend>
      <label>
        Width (mm)
        <input
          type="number"
          min={1}
          value={width}
          onChange={(e) => setWidth(Number(e.target.value) || 1)}
        />
      </label>
      <label>
        Depth (mm)
        <input
          type="number"
          min={1}
          value={depth}
          onChange={(e) => setDepth(Number(e.target.value) || 1)}
        />
      </label>
      <label>
        Height (mm)
        <input
          type="number"
          min={1}
          value={height}
          onChange={(e) => setHeight(Number(e.target.value) || 1)}
        />
      </label>
      <label>
        Material thickness (mm)
        <input
          type="number"
          min={0.1}
          step={0.1}
          value={materialThickness}
          onChange={(e) => setMaterialThickness(Number(e.target.value) || 0.1)}
        />
      </label>
      <label>
        Finger width (mm)
        <input
          type="number"
          min={1}
          value={fingerWidth}
          onChange={(e) => setFingerWidth(Number(e.target.value) || 1)}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={includeLid}
          onChange={(e) => setIncludeLid(e.target.checked)}
        />
        Include lid
      </label>
      {error && (
        <p role="alert" className="generators-panel__error">
          {error}
        </p>
      )}
      <button type="button" onClick={handleGenerate}>
        Add Box to Design
      </button>
    </fieldset>
  );
}

function KeychainGenerator({ onAddPaths }: GeneratorsPanelProps) {
  const [shape, setShape] = useState<NonNullable<KeychainOptions["shape"]>>("rounded-rect");
  const [width, setWidth] = useState(40);
  const [height, setHeight] = useState(25);
  const [cornerRadius, setCornerRadius] = useState(4);
  const [holeDiameter, setHoleDiameter] = useState(4);
  const [holeMargin, setHoleMargin] = useState(6);
  const [asPair, setAsPair] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = useCallback(() => {
    try {
      const options: KeychainOptions = {
        shape,
        width,
        height,
        cornerRadius,
        holeDiameter,
        holeMargin,
      };
      const paths = asPair ? generateEarringPair(options) : generateKeychainBlank(options);
      onAddPaths(paths);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate blank");
    }
  }, [shape, width, height, cornerRadius, holeDiameter, holeMargin, asPair, onAddPaths]);

  return (
    <fieldset className="generators-panel__section">
      <legend>Keychain / earring blank</legend>
      <label>
        Shape
        <select value={shape} onChange={(e) => setShape(e.target.value as typeof shape)}>
          <option value="rounded-rect">Rounded rectangle</option>
          <option value="circle">Circle</option>
          <option value="hexagon">Hexagon</option>
        </select>
      </label>
      <label>
        Width (mm)
        <input
          type="number"
          min={1}
          value={width}
          onChange={(e) => setWidth(Number(e.target.value) || 1)}
        />
      </label>
      {shape === "rounded-rect" && (
        <label>
          Height (mm)
          <input
            type="number"
            min={1}
            value={height}
            onChange={(e) => setHeight(Number(e.target.value) || 1)}
          />
        </label>
      )}
      {shape === "rounded-rect" && (
        <label>
          Corner radius (mm)
          <input
            type="number"
            min={0}
            value={cornerRadius}
            onChange={(e) => setCornerRadius(Math.max(0, Number(e.target.value) || 0))}
          />
        </label>
      )}
      <label>
        Hole diameter (mm)
        <input
          type="number"
          min={0.5}
          value={holeDiameter}
          onChange={(e) => setHoleDiameter(Number(e.target.value) || 0.5)}
        />
      </label>
      <label>
        Hole margin (mm)
        <input
          type="number"
          min={0}
          value={holeMargin}
          onChange={(e) => setHoleMargin(Math.max(0, Number(e.target.value) || 0))}
        />
      </label>
      <label>
        <input type="checkbox" checked={asPair} onChange={(e) => setAsPair(e.target.checked)} />
        Generate as earring pair
      </label>
      {error && (
        <p role="alert" className="generators-panel__error">
          {error}
        </p>
      )}
      <button type="button" onClick={handleGenerate}>
        Add Blank to Design
      </button>
    </fieldset>
  );
}

function MapGenerator({ onAddPaths }: GeneratorsPanelProps) {
  const [geojsonText, setGeojsonText] = useState("");
  const [width, setWidth] = useState(150);
  const [height, setHeight] = useState(150);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = useCallback(() => {
    try {
      const parsed = JSON.parse(geojsonText) as GeoJsonInput;
      const paths = generateMapFromGeoJson(parsed, { width, height });
      onAddPaths(paths);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to parse/generate map from GeoJSON");
    }
  }, [geojsonText, width, height, onAddPaths]);

  return (
    <fieldset className="generators-panel__section">
      <legend>Map from GeoJSON</legend>
      <label className="generators-panel__geojson-input">
        GeoJSON (FeatureCollection of LineString/MultiLineString/Polygon)
        <textarea
          value={geojsonText}
          onChange={(e) => setGeojsonText(e.target.value)}
          rows={4}
          placeholder='{"type":"FeatureCollection","features":[...]}'
        />
      </label>
      <label>
        Width (mm)
        <input
          type="number"
          min={1}
          value={width}
          onChange={(e) => setWidth(Number(e.target.value) || 1)}
        />
      </label>
      <label>
        Height (mm)
        <input
          type="number"
          min={1}
          value={height}
          onChange={(e) => setHeight(Number(e.target.value) || 1)}
        />
      </label>
      {error && (
        <p role="alert" className="generators-panel__error">
          {error}
        </p>
      )}
      <button type="button" disabled={!geojsonText.trim()} onClick={handleGenerate}>
        Add Map to Design
      </button>
    </fieldset>
  );
}

export function GeneratorsPanel({ onAddPaths }: GeneratorsPanelProps) {
  return (
    <section className="generators-panel">
      <h2>Parametric Generators</h2>
      <BoxJointGenerator onAddPaths={onAddPaths} />
      <KeychainGenerator onAddPaths={onAddPaths} />
      <MapGenerator onAddPaths={onAddPaths} />
    </section>
  );
}
