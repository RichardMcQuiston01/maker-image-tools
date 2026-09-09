import { useCallback, useState } from "react";
import { exportImageData } from "@maker/core-image";
import { traceImageColors, type ColorLayer } from "@maker/core-vector";
import { AI_INFERENCE_URL } from "../lib/aiInferenceUrl";

interface VectorizeColorsPanelProps {
  image: ImageData | null;
  onAddColorLayers: (layers: Array<{ colorHex: string; paths: ColorLayer["paths"] }>) => void;
}

interface SuggestPaletteResponse {
  palette: ColorLayer["color"][];
  notes: string;
}

function rgbToHex([r, g, b]: ColorLayer["color"]): string {
  const toHex = (channel: number) => channel.toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function VectorizeColorsPanel({ image, onAddColorLayers }: VectorizeColorsPanelProps) {
  const [colorCount, setColorCount] = useState(6);
  const [error, setError] = useState<string | null>(null);
  const [lastLayerCount, setLastLayerCount] = useState<number | null>(null);

  const [aiStatus, setAiStatus] = useState<"idle" | "suggesting">("idle");
  const [aiPalette, setAiPalette] = useState<ColorLayer["color"][] | null>(null);
  const [aiNotes, setAiNotes] = useState<string | null>(null);

  const handleSuggestPalette = useCallback(async () => {
    if (!image) return;
    try {
      setAiStatus("suggesting");
      setError(null);
      const blob = await exportImageData(image, { mimeType: "image/png" });
      const response = await fetch(`${AI_INFERENCE_URL}/suggest-palette?colorCount=${colorCount}`, {
        method: "POST",
        headers: { "Content-Type": blob.type },
        body: blob,
      });
      if (!response.ok) {
        throw new Error(`Palette suggestion service responded with ${response.status}`);
      }
      const result = (await response.json()) as SuggestPaletteResponse;
      setAiPalette(result.palette);
      setAiNotes(result.notes);
      setAiStatus("idle");
    } catch (err) {
      setAiStatus("idle");
      setError(
        err instanceof Error
          ? `${err.message} (is the @maker/ai-inference dev server running?)`
          : "Failed to suggest a color palette",
      );
    }
  }, [image, colorCount]);

  const handleClearAiPalette = useCallback(() => {
    setAiPalette(null);
    setAiNotes(null);
  }, []);

  const handleVectorize = useCallback(() => {
    if (!image) return;
    try {
      const layers = traceImageColors(image, aiPalette ? { palette: aiPalette } : { colorCount });
      onAddColorLayers(
        layers.map((layer) => ({ colorHex: rgbToHex(layer.color), paths: layer.paths })),
      );
      setLastLayerCount(layers.length);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to vectorize colors");
    }
  }, [image, colorCount, aiPalette, onAddColorLayers]);

  const suggesting = aiStatus === "suggesting";

  return (
    <section className="ai-panel">
      <h2>AI Multi-Color Vectorization</h2>
      <p className="ai-panel__hint">
        {aiPalette
          ? "Traces each color in the AI-suggested palette below into its own vector layer."
          : "Quantizes the image into a small color palette (median-cut) and traces each color " +
            "into its own vector layer, entirely offline."}
      </p>
      <label>
        Color count
        <input
          type="number"
          min={2}
          max={32}
          value={colorCount}
          disabled={aiPalette !== null}
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
      <div className="ai-panel__actions">
        <button
          type="button"
          disabled={!image || suggesting}
          onClick={() => void handleSuggestPalette()}
        >
          {suggesting ? "Suggesting palette…" : "Suggest Palette with AI"}
        </button>
        <button type="button" disabled={!image} onClick={handleVectorize}>
          Vectorize Colors
        </button>
      </div>
      {aiPalette && (
        <div className="ai-panel__result">
          <p className="ai-panel__hint">{aiNotes}</p>
          <ul className="ai-panel__swatches">
            {aiPalette.map((color) => (
              <li
                key={rgbToHex(color)}
                style={{ backgroundColor: rgbToHex(color) }}
                title={rgbToHex(color)}
              />
            ))}
          </ul>
          <button type="button" onClick={handleClearAiPalette}>
            Clear AI Palette (use offline quantization)
          </button>
        </div>
      )}
      {lastLayerCount !== null && (
        <p className="ai-panel__hint">Added {lastLayerCount} color layer(s).</p>
      )}
    </section>
  );
}
