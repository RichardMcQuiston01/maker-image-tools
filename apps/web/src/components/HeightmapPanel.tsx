import { useCallback, useState } from "react";
import { imageToHeightmapStl } from "@maker/core-image";
import { downloadBlob } from "../lib/download";

interface HeightmapPanelProps {
  image: ImageData | null;
}

export function HeightmapPanel({ image }: HeightmapPanelProps) {
  const [maxHeight, setMaxHeight] = useState(5);
  const [baseHeight, setBaseHeight] = useState(1);
  const [pixelSize, setPixelSize] = useState(0.5);
  const [downsample, setDownsample] = useState(1);
  const [invert, setInvert] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleExport = useCallback(() => {
    if (!image) return;
    try {
      const stl = imageToHeightmapStl(image, {
        maxHeight,
        baseHeight,
        pixelSize,
        downsample,
        invert,
      });
      downloadBlob(new Blob([stl], { type: "model/stl" }), "maker-image-tools-relief.stl");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate heightmap STL");
    }
  }, [image, maxHeight, baseHeight, pixelSize, downsample, invert]);

  return (
    <section className="heightmap-panel">
      <h2>Heightmap / STL Relief</h2>
      <label>
        Max height (mm)
        <input
          type="number"
          min={0}
          step={0.1}
          value={maxHeight}
          onChange={(event) => setMaxHeight(Number(event.target.value) || 0)}
        />
      </label>
      <label>
        Base height (mm)
        <input
          type="number"
          min={0}
          step={0.1}
          value={baseHeight}
          onChange={(event) => setBaseHeight(Math.max(0, Number(event.target.value) || 0))}
        />
      </label>
      <label>
        Pixel size (mm)
        <input
          type="number"
          min={0.01}
          step={0.01}
          value={pixelSize}
          onChange={(event) => setPixelSize(Math.max(0.01, Number(event.target.value) || 0.01))}
        />
      </label>
      <label>
        Downsample
        <input
          type="number"
          min={1}
          step={1}
          value={downsample}
          onChange={(event) =>
            setDownsample(Math.max(1, Math.floor(Number(event.target.value)) || 1))
          }
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={invert}
          onChange={(event) => setInvert(event.target.checked)}
        />
        Invert (dark = tall)
      </label>
      {error && (
        <p role="alert" className="heightmap-panel__error">
          {error}
        </p>
      )}
      <button type="button" disabled={!image} onClick={handleExport}>
        Export STL
      </button>
    </section>
  );
}
