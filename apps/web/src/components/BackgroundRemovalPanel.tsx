import { useCallback, useRef, useState } from "react";
import type { BackgroundRemovalModel } from "@maker/ai-tools";

interface BackgroundRemovalPanelProps {
  image: ImageData | null;
  onProcessed: (image: ImageData) => void;
}

const MODEL_URL = "/models/u2netp.onnx";

export function BackgroundRemovalPanel({ image, onProcessed }: BackgroundRemovalPanelProps) {
  const [status, setStatus] = useState<"idle" | "loading-model" | "running" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const modelRef = useRef<Promise<BackgroundRemovalModel> | null>(null);

  const handleRemoveBackground = useCallback(async () => {
    if (!image) return;
    try {
      if (!modelRef.current) {
        setStatus("loading-model");
        const { loadBackgroundRemovalModel } = await import("@maker/ai-tools");
        modelRef.current = loadBackgroundRemovalModel(MODEL_URL);
      }
      const model = await modelRef.current;
      setStatus("running");
      const result = await model.removeBackground(image);
      onProcessed(result);
      setStatus("idle");
      setError(null);
    } catch (err) {
      modelRef.current = null;
      setStatus("error");
      setError(err instanceof Error ? err.message : "Failed to remove background");
    }
  }, [image, onProcessed]);

  const busy = status === "loading-model" || status === "running";

  return (
    <section className="ai-panel">
      <h2>AI Background Removal</h2>
      <p className="ai-panel__hint">
        Runs fully offline in your browser (U²-Net, ~4.5MB model, loaded once and cached).
      </p>
      {error && (
        <p role="alert" className="ai-panel__error">
          {error}
        </p>
      )}
      <button type="button" disabled={!image || busy} onClick={() => void handleRemoveBackground()}>
        {status === "loading-model"
          ? "Loading model…"
          : status === "running"
            ? "Removing background…"
            : "Remove Background"}
      </button>
    </section>
  );
}
