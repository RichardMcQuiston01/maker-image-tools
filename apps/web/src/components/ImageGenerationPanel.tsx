import { useCallback, useState } from "react";
import { AI_INFERENCE_URL } from "../lib/aiInferenceUrl";

interface ImageGenerationPanelProps {
  onProcessed: (image: ImageData) => void;
}

interface GenerateImageResponse {
  width: number;
  height: number;
  dataBase64: string;
  notes: string;
}

function base64ToUint8ClampedArray(base64: string): Uint8ClampedArray {
  const binary = atob(base64);
  const bytes = new Uint8ClampedArray(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function ImageGenerationPanel({ onProcessed }: ImageGenerationPanelProps) {
  const [prompt, setPrompt] = useState("");
  const [status, setStatus] = useState<"idle" | "generating" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string | null>(null);

  const handleGenerate = useCallback(async () => {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    try {
      setStatus("generating");
      setError(null);
      const response = await fetch(`${AI_INFERENCE_URL}/generate-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: trimmed }),
      });
      if (!response.ok) {
        throw new Error(`Image generation service responded with ${response.status}`);
      }
      const result = (await response.json()) as GenerateImageResponse;
      const data = base64ToUint8ClampedArray(result.dataBase64).slice();
      onProcessed(new ImageData(data, result.width, result.height));
      setNotes(result.notes);
      setStatus("idle");
    } catch (err) {
      setStatus("error");
      setError(
        err instanceof Error
          ? `${err.message} (is the @maker/ai-inference dev server running?)`
          : "Failed to generate image",
      );
    }
  }, [prompt, onProcessed]);

  const busy = status === "generating";

  return (
    <section className="ai-panel">
      <h2>AI Image Generation</h2>
      <p className="ai-panel__hint">
        Generates an image from a text prompt via @maker/ai-inference. Currently a scaffold: the
        backend returns a deterministic placeholder gradient until a real diffusion model or hosted
        API is wired up.
      </p>
      <label>
        Prompt
        <input
          type="text"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="e.g. a mountain landscape at sunset"
        />
      </label>
      {error && (
        <p role="alert" className="ai-panel__error">
          {error}
        </p>
      )}
      <button type="button" disabled={!prompt.trim() || busy} onClick={() => void handleGenerate()}>
        {busy ? "Generating…" : "Generate Image"}
      </button>
      {notes && (
        <div className="ai-panel__result">
          <p className="ai-panel__hint">{notes}</p>
        </div>
      )}
    </section>
  );
}
