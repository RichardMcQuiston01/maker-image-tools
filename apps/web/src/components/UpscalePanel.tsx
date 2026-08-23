import { useCallback, useRef, useState } from "react";
import type { UpscaleFactor, UpscaleModel } from "@maker/ai-tools";

interface UpscalePanelProps {
  image: ImageData | null;
  onProcessed: (image: ImageData) => void;
}

const SUPPORTED_FACTORS: UpscaleFactor[] = [2, 4];

function modelUrlFor(factor: UpscaleFactor): string {
  return `/models/esrgan-slim/${factor}x/model.json`;
}

export function UpscalePanel({ image, onProcessed }: UpscalePanelProps) {
  const [factor, setFactor] = useState<UpscaleFactor>(2);
  const [status, setStatus] = useState<"idle" | "loading-model" | "running" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const modelsRef = useRef<Map<UpscaleFactor, Promise<UpscaleModel>>>(new Map());

  const handleUpscale = useCallback(async () => {
    if (!image) return;
    try {
      let modelPromise = modelsRef.current.get(factor);
      if (!modelPromise) {
        setStatus("loading-model");
        const { loadUpscaleModel } = await import("@maker/ai-tools");
        modelPromise = loadUpscaleModel(factor, { modelUrl: modelUrlFor(factor) });
        modelsRef.current.set(factor, modelPromise);
      }
      const model = await modelPromise;
      setStatus("running");
      const result = await model.upscale(image);
      onProcessed(result);
      setStatus("idle");
      setError(null);
    } catch (err) {
      modelsRef.current.delete(factor);
      setStatus("error");
      setError(err instanceof Error ? err.message : "Failed to upscale image");
    }
  }, [image, factor, onProcessed]);

  const busy = status === "loading-model" || status === "running";

  return (
    <section className="ai-panel">
      <h2>AI Upscaling</h2>
      <p className="ai-panel__hint">
        Runs fully offline in your browser (ESRGAN-slim, loaded once per scale and cached).
      </p>
      <label>
        Scale factor
        <select
          value={factor}
          onChange={(event) => setFactor(Number(event.target.value) as UpscaleFactor)}
          disabled={busy}
        >
          {SUPPORTED_FACTORS.map((f) => (
            <option key={f} value={f}>
              {f}x
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p role="alert" className="ai-panel__error">
          {error}
        </p>
      )}
      <button type="button" disabled={!image || busy} onClick={() => void handleUpscale()}>
        {status === "loading-model"
          ? "Loading model…"
          : status === "running"
            ? "Upscaling…"
            : "Upscale"}
      </button>
    </section>
  );
}
