import { useCallback, useState } from "react";
import { exportImageData } from "@maker/core-image";
import type { MaterialClassification } from "@maker/ai-inference";
import { useAuth } from "../hooks/useAuth";
import { AI_INFERENCE_URL, readAiInferenceErrorMessage } from "../lib/aiInferenceUrl";

interface MaterialDetectionPanelProps {
  image: ImageData | null;
}

export function MaterialDetectionPanel({ image }: MaterialDetectionPanelProps) {
  const { token } = useAuth();
  const [status, setStatus] = useState<"idle" | "detecting" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MaterialClassification | null>(null);

  const handleDetect = useCallback(async () => {
    if (!image || !token) return;
    try {
      setStatus("detecting");
      setError(null);
      const blob = await exportImageData(image, { mimeType: "image/png" });
      const response = await fetch(`${AI_INFERENCE_URL}/classify-material`, {
        method: "POST",
        headers: { "Content-Type": blob.type, Authorization: `Bearer ${token}` },
        body: blob,
      });
      if (!response.ok) {
        throw new Error(await readAiInferenceErrorMessage(response, "Material detection failed"));
      }
      const classification = (await response.json()) as MaterialClassification;
      setResult(classification);
      setStatus("idle");
    } catch (err) {
      setStatus("error");
      setError(
        err instanceof Error
          ? `${err.message} (is the @maker/ai-inference dev server running?)`
          : "Failed to detect material",
      );
    }
  }, [image, token]);

  return (
    <section className="ai-panel">
      <h2>AI Material Detection</h2>
      <p className="ai-panel__hint">
        Calls the @maker/ai-inference backend (Gemini vision) to identify the material in this image
        and suggest matching cut/engrave presets.
      </p>
      {error && (
        <p role="alert" className="ai-panel__error">
          {error}
        </p>
      )}
      {!token && <p className="ai-panel__hint">Sign in to use AI material detection.</p>}
      <button
        type="button"
        disabled={!image || !token || status === "detecting"}
        onClick={() => void handleDetect()}
      >
        {status === "detecting" ? "Detecting…" : "Detect Material"}
      </button>
      {result && (
        <div className="ai-panel__result">
          <p>
            Detected: <strong>{result.material}</strong> ({Math.round(result.confidence * 100)}%
            confidence)
          </p>
          <p className="ai-panel__hint">{result.notes}</p>
          {result.matchedPresets.length > 0 && (
            <ul>
              {result.matchedPresets.map((preset) => (
                <li key={preset.id}>
                  {preset.material} — {preset.machineType} — {preset.operation} (speed{" "}
                  {preset.speed}, power {preset.power})
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
