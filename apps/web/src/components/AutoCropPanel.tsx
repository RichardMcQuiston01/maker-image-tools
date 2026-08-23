import { useCallback, useRef, useState } from "react";
import { crop } from "@maker/core-image";
import type { BackgroundRemovalModel } from "@maker/ai-tools";

interface AutoCropPanelProps {
  image: ImageData | null;
  onProcessed: (image: ImageData) => void;
}

const MODEL_URL = "/models/u2netp.onnx";

export function AutoCropPanel({ image, onProcessed }: AutoCropPanelProps) {
  const [status, setStatus] = useState<"idle" | "loading-model" | "running" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const modelRef = useRef<Promise<BackgroundRemovalModel> | null>(null);

  const handleAutoCrop = useCallback(async () => {
    if (!image) return;
    try {
      if (!modelRef.current) {
        setStatus("loading-model");
        const { loadBackgroundRemovalModel } = await import("@maker/ai-tools");
        modelRef.current = loadBackgroundRemovalModel(MODEL_URL);
      }
      const model = await modelRef.current;
      setStatus("running");
      const { computeCropRegion } = await import("@maker/ai-tools");
      const mask = await model.computeSaliencyMask(image);
      const region = computeCropRegion(mask, { margin: 8 });
      const result = crop(image, {
        x: region.x,
        y: region.y,
        width: region.width,
        height: region.height,
      });
      onProcessed(result);
      setStatus("idle");
      setError(null);
    } catch (err) {
      modelRef.current = null;
      setStatus("error");
      setError(err instanceof Error ? err.message : "Failed to auto-crop");
    }
  }, [image, onProcessed]);

  const busy = status === "loading-model" || status === "running";

  return (
    <section className="ai-panel">
      <h2>AI Auto-Crop</h2>
      <p className="ai-panel__hint">
        Detects the subject (via the same U²-Net model used for background removal) and crops
        tightly around it, fully offline.
      </p>
      {error && (
        <p role="alert" className="ai-panel__error">
          {error}
        </p>
      )}
      <button type="button" disabled={!image || busy} onClick={() => void handleAutoCrop()}>
        {status === "loading-model"
          ? "Loading model…"
          : status === "running"
            ? "Cropping…"
            : "Auto-Crop"}
      </button>
    </section>
  );
}
