import { useCallback, useState } from "react";
import { traceImageColors, type ColorLayer } from "@maker/core-vector";

interface VectorizeColorsPanelProps {
  image: ImageData | null;
  onAddColorLayers: (layers: Array<{ colorHex: string; paths: ColorLayer["paths"] }>) => void;
}

function rgbToHex([r, g, b]: ColorLayer["color"]): string {
  const toHex = (channel: number) => channel.toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function VectorizeColorsPanel({ image, onAddColorLayers }: VectorizeColorsPanelProps) {
  const [colorCount, setColorCount] = useState(6);
  const [error, setError] = useState<string | null>(null);
  const [lastLayerCount, setLastLayerCount] = useState<number | null>(null);

  const handleVectorize = useCallback(() => {
    if (!image) return;
    try {
      const layers = traceImageColors(image, { colorCount });
      onAddColorLayers(
        layers.map((layer) => ({ colorHex: rgbToHex(layer.color), paths: layer.paths })),
      );
      setLastLayerCount(layers.length);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to vectorize colors");
    }
  }, [image, colorCount, onAddColorLayers]);

  return (
    <section className="ai-panel">
      <h2>AI Multi-Color Vectorization</h2>
      <p className="ai-panel__hint">
        Quantizes the image into a small color palette (median-cut) and traces each color into its
        own vector layer, entirely offline.
      </p>
      <label>
        Color count
        <input
          type="number"
          min={2}
          max={32}
          value={colorCount}
          onChange={(event) =>
            setColorCount(Math.min(32, Math.max(2, Math.floor(Number(event.target.value)) || 2)))
          }
        />
      </label>
      {error && (
        <p role="alert" className="ai-panel__error">
          {error}
        </p>
      )}
      <button type="button" disabled={!image} onClick={handleVectorize}>
        Vectorize Colors
      </button>
      {lastLayerCount !== null && (
        <p className="ai-panel__hint">Added {lastLayerCount} color layer(s).</p>
      )}
    </section>
  );
}
