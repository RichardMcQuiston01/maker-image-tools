import { useCallback, useState } from "react";
import { svgToPaths, type VectorPath } from "@maker/core-vector";
import {
  generateEarringPair,
  generateFingerJointBox,
  generateKeychainBlank,
  generateMapFromGeoJson,
  type GeoJsonInput,
  type KeychainOptions,
} from "@maker/generators";
import {
  createFontRegistry,
  generateSign,
  type FontRegistry,
  type GenerateSignError,
  type ScrewSize,
  type SignShape,
  type SignStyle,
  type Unit,
} from "@richardmcquiston01/house-number-generator";

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

const SCREW_SIZES: ScrewSize[] = ["M3", "M4", "M5", "#4-40", "#6-32", "#8-32", "#10-24", "1/4-20"];

function describeGenerateError(error: GenerateSignError): string {
  if (error.stage === "validation") {
    return error.errors.map((e) => `${e.field}: ${e.message}`).join("; ");
  }
  return error.error.message;
}

function HouseNumberSignGenerator({ onAddPaths }: GeneratorsPanelProps) {
  const [fonts] = useState<FontRegistry>(() => createFontRegistry());
  const [numberFontLoaded, setNumberFontLoaded] = useState(false);
  const [nameFontLoaded, setNameFontLoaded] = useState(false);
  const [fontError, setFontError] = useState<string | null>(null);

  const [style, setStyle] = useState<SignStyle>("numbersOnly");
  const [houseNumber, setHouseNumber] = useState("");
  const [name, setName] = useState("");
  const [shape, setShape] = useState<SignShape>("rectangle");
  const [numberHeight, setNumberHeight] = useState(4);
  const [margin, setMargin] = useState(0.5);
  const [unit, setUnit] = useState<Unit>("in");
  const [assemblyType, setAssemblyType] = useState<"hardware" | "adhesive">("hardware");
  const [screwSize, setScrewSize] = useState<ScrewSize>("M3");
  const [error, setError] = useState<string | null>(null);

  const handleFontFile = useCallback(
    async (id: "numberFont" | "nameFont", file: File | undefined) => {
      if (!file) return;
      const buffer = await file.arrayBuffer();
      const result = fonts.register(id, buffer);
      if (!result.ok) {
        setFontError(result.error.message);
        return;
      }
      setFontError(null);
      if (id === "numberFont") setNumberFontLoaded(true);
      else setNameFontLoaded(true);
    },
    [fonts],
  );

  const canGenerate =
    houseNumber.trim().length > 0 &&
    numberFontLoaded &&
    (style === "numbersOnly" || (name.trim().length > 0 && nameFontLoaded));

  const handleGenerate = useCallback(() => {
    const result = generateSign({
      config: {
        style,
        houseNumber: houseNumber.trim(),
        ...(style === "nameAndNumbers" ? { name: name.trim() } : {}),
        font: {
          numberFont: "numberFont",
          ...(style === "nameAndNumbers" ? { nameFont: "nameFont" } : {}),
        },
        shape,
        numberHeight,
        margin,
        unit,
        assembly:
          assemblyType === "hardware" ? { type: "hardware", screwSize } : { type: "adhesive" },
      },
      fonts,
      format: "svg",
    });
    if (!result.ok) {
      setError(describeGenerateError(result.error));
      return;
    }
    const paths = result.value.flatMap((file) => svgToPaths(file.content));
    onAddPaths(paths);
    setError(null);
  }, [
    style,
    houseNumber,
    name,
    shape,
    numberHeight,
    margin,
    unit,
    assemblyType,
    screwSize,
    fonts,
    onAddPaths,
  ]);

  return (
    <fieldset className="generators-panel__section">
      <legend>House number sign</legend>
      <label>
        Style
        <select value={style} onChange={(e) => setStyle(e.target.value as SignStyle)}>
          <option value="numbersOnly">Numbers only</option>
          <option value="nameAndNumbers">Name + numbers</option>
        </select>
      </label>
      <label>
        House number
        <input
          type="text"
          placeholder="742"
          value={houseNumber}
          onChange={(e) => setHouseNumber(e.target.value)}
        />
      </label>
      <label>
        Number font file (.ttf/.otf)
        <input
          type="file"
          accept=".ttf,.otf,font/ttf,font/otf"
          onChange={(e) => void handleFontFile("numberFont", e.target.files?.[0])}
        />
      </label>
      {style === "nameAndNumbers" && (
        <>
          <label>
            Name
            <input
              type="text"
              placeholder="The Smiths"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Name font file (.ttf/.otf)
            <input
              type="file"
              accept=".ttf,.otf,font/ttf,font/otf"
              onChange={(e) => void handleFontFile("nameFont", e.target.files?.[0])}
            />
          </label>
        </>
      )}
      {fontError && (
        <p role="alert" className="generators-panel__error">
          {fontError}
        </p>
      )}
      <label>
        Sign shape
        <select value={shape} onChange={(e) => setShape(e.target.value as SignShape)}>
          <option value="rectangle">Rectangle</option>
          <option value="square">Square</option>
          <option value="round">Round</option>
        </select>
      </label>
      <label>
        Unit
        <select value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>
          <option value="in">Inches</option>
          <option value="mm">Millimeters</option>
        </select>
      </label>
      <label>
        Number height ({unit})
        <input
          type="number"
          min={0.1}
          step={0.1}
          value={numberHeight}
          onChange={(e) => setNumberHeight(Number(e.target.value) || 0.1)}
        />
      </label>
      <label>
        Margin ({unit})
        <input
          type="number"
          min={0}
          step={0.1}
          value={margin}
          onChange={(e) => setMargin(Math.max(0, Number(e.target.value) || 0))}
        />
      </label>
      <label>
        Assembly
        <select
          value={assemblyType}
          onChange={(e) => setAssemblyType(e.target.value as "hardware" | "adhesive")}
        >
          <option value="hardware">Hardware (screws)</option>
          <option value="adhesive">Adhesive/glue</option>
        </select>
      </label>
      {assemblyType === "hardware" && (
        <label>
          Screw size
          <select value={screwSize} onChange={(e) => setScrewSize(e.target.value as ScrewSize)}>
            {SCREW_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      )}
      {error && (
        <p role="alert" className="generators-panel__error">
          {error}
        </p>
      )}
      <button type="button" disabled={!canGenerate} onClick={handleGenerate}>
        Add Sign to Design
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
      <HouseNumberSignGenerator onAddPaths={onAddPaths} />
    </section>
  );
}
