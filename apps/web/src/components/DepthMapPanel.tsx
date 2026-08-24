import { useCallback, useState } from "react";
import { createImageData, imageToHeightmapStl } from "@maker/core-image";
import { decodeDepthMap, encodeRgbaImage, type DepthMap } from "@maker/ai-inference/wire";
import { AI_INFERENCE_URL } from "../lib/aiInferenceUrl";
import { downloadBlob } from "../lib/download";

interface DepthMapPanelProps {
  image: ImageData | null;
}

/** Renders a DepthMap's [0,1] values as a same-size grayscale ImageData, reusing @maker/core-image's existing heightmap/STL pipeline. */
function depthMapToGrayscale(depth: DepthMap) {
  const image = createImageData(depth.width, depth.height);
  const data = image.data;
  for (let i = 0; i < depth.values.length; i++) {
    const value = Math.round((depth.values[i] ?? 0) * 255);
    data[i * 4] = value;
    data[i * 4 + 1] = value;
    data[i * 4 + 2] = value;
    data[i * 4 + 3] = 255;
  }
  return image;
}

export function DepthMapPanel({ image }: DepthMapPanelProps) {
  const [status, setStatus] = useState<"idle" | "estimating" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [depth, setDepth] = useState<DepthMap | null>(null);

  const [maxHeight, setMaxHeight] = useState(5);
  const [baseHeight, setBaseHeight] = useState(1);
  const [pixelSize, setPixelSize] = useState(0.5);
  const [downsample, setDownsample] = useState(1);

  const handleEstimateDepth = useCallback(async () => {
    if (!image) return;
    try {
      setStatus("estimating");
      setError(null);
      const encoded = encodeRgbaImage({
        width: image.width,
        height: image.height,
        data: image.data,
      });
      const response = await fetch(`${AI_INFERENCE_URL}/depth-map`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: encoded.slice(),
      });
      if (!response.ok) {
        throw new Error(`Depth estimation service responded with ${response.status}`);
      }
      const buffer = new Uint8Array(await response.arrayBuffer());
      setDepth(decodeDepthMap(buffer));
      setStatus("idle");
    } catch (err) {
      setStatus("error");
      setError(
        err instanceof Error
          ? `${err.message} (is the @maker/ai-inference dev server running?)`
          : "Failed to estimate depth",
      );
    }
  }, [image]);

  const handleExportStl = useCallback(() => {
    if (!depth) return;
    try {
      const grayscale = depthMapToGrayscale(depth);
      const stl = imageToHeightmapStl(grayscale, { maxHeight, baseHeight, pixelSize, downsample });
      downloadBlob(new Blob([stl], { type: "model/stl" }), "maker-image-tools-depth-relief.stl");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate relief STL");
    }
  }, [depth, maxHeight, baseHeight, pixelSize, downsample]);

  const busy = status === "estimating";

  return (
    <section className="ai-panel">
      <h2>AI Depth Map / 3D Relief</h2>
      <p className="ai-panel__hint">
        Estimates a depth map via @maker/ai-inference (MiDaS v2.1 small) and exports it as a
        3D-relief STL.
      </p>
      {error && (
        <p role="alert" className="ai-panel__error">
          {error}
        </p>
      )}
      <button type="button" disabled={!image || busy} onClick={() => void handleEstimateDepth()}>
        {busy ? "Estimating depth…" : "Estimate Depth"}
      </button>
      {depth && (
        <div className="ai-panel__result">
          <p>
            Depth map ready ({depth.width}x{depth.height}).
          </p>
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
          <button type="button" onClick={handleExportStl}>
            Export Relief STL
          </button>
        </div>
      )}
    </section>
  );
}
