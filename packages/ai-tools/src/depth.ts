import { resize } from "@richardmcquiston01/core-image";
import * as ort from "onnxruntime-web";

/**
 * Depth Anything V2 Small (see models/NOTICE.md) takes an RGB image whose sides
 * are multiples of 14, normalized with ImageNet mean/std and laid out
 * channel-first (NCHW), and returns one relative inverse-depth value per input
 * pixel (larger = nearer). Both sides may be any multiple of 14, so the image
 * keeps its proportions rather than being squashed to a square.
 */
const PATCH_SIZE = 14;
const DEFAULT_INPUT_SIZE = 518;
const MIN_INPUT_SIZE = PATCH_SIZE * 8;
const MAX_INPUT_SIZE = 1022;
const CHANNEL_MEAN = [0.485, 0.456, 0.406];
const CHANNEL_STD = [0.229, 0.224, 0.225];

export type DepthExecutionProvider = "webgpu" | "wasm";

export interface LoadDepthModelOptions {
  /**
   * Base URL onnxruntime-web should use to locate its own WASM runtime files
   * (ort-wasm*.wasm), passed through to `ort.env.wasm.wasmPaths`. Bundlers that
   * don't resolve onnxruntime-web's WASM assets on their own need this pointed
   * at wherever those files were copied.
   */
  wasmPaths?: string;
  /**
   * onnxruntime-web execution providers to try, in order. Defaults to
   * `["wasm"]`. A run that fails on `"webgpu"` rebuilds the session on
   * WebAssembly and retries once.
   */
  executionProviders?: readonly DepthExecutionProvider[];
  /**
   * Length, in pixels, the image's longer side is scaled to before inference
   * (rounded to a multiple of 14, between 112 and 1022). Larger is more
   * detailed and slower; the default is the model's native 518.
   */
  inputSize?: number;
}

export interface DepthMap {
  /**
   * Row-major relative depth in [0, 1], one value per pixel of the source
   * image, where 1 is the nearest point in the picture and 0 the farthest. It is
   * relative, not metric: it says what is in front of what, not by how many
   * centimetres.
   */
  values: Float32Array;
  width: number;
  height: number;
}

export interface DepthModel {
  /**
   * Estimates a relative depth map for `image`. Transparency is ignored: the
   * colour channels are read as they are, so flatten a cutout onto a backdrop
   * first if its hidden pixels would mislead the model.
   */
  estimateDepth(image: ImageData): Promise<DepthMap>;
}

/** The model's input size for an image: its longer side `inputSize`, both sides multiples of 14. */
export function depthInputSize(
  width: number,
  height: number,
  inputSize: number = DEFAULT_INPUT_SIZE,
): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) {
    throw new Error(`Cannot estimate depth for an image of ${width} x ${height} pixels.`);
  }
  const target = Math.min(MAX_INPUT_SIZE, Math.max(MIN_INPUT_SIZE, inputSize));
  const scale = target / Math.max(width, height);
  const snap = (side: number): number =>
    Math.max(PATCH_SIZE, Math.round((side * scale) / PATCH_SIZE) * PATCH_SIZE);
  return { width: snap(width), height: snap(height) };
}

function preprocess(image: ImageData, size: { width: number; height: number }): ort.Tensor {
  const resized = resize(image, { width: size.width, height: size.height, method: "bilinear" });
  const pixelCount = size.width * size.height;
  const chw = new Float32Array(3 * pixelCount);
  const data = resized.data;
  for (let i = 0; i < pixelCount; i++) {
    for (let channel = 0; channel < 3; channel++) {
      const value = (data[i * 4 + channel] ?? 0) / 255;
      chw[channel * pixelCount + i] = (value - CHANNEL_MEAN[channel]!) / CHANNEL_STD[channel]!;
    }
  }
  return new ort.Tensor("float32", chw, [1, 3, size.height, size.width]);
}

/** Min-max normalizes raw depth to [0, 1]; a flat map (no range to stretch) comes back all zero. */
export function normalizeDepth(raw: Float32Array): Float32Array {
  let min = Infinity;
  let max = -Infinity;
  for (const value of raw) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  const normalized = new Float32Array(raw.length);
  const range = max - min;
  if (!(range > 1e-9)) return normalized;
  for (let i = 0; i < raw.length; i++) normalized[i] = ((raw[i] ?? 0) - min) / range;
  return normalized;
}

/** Bilinear resample of a single-channel float map, keeping full float precision. */
export function resampleDepth(
  source: Float32Array,
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number,
): Float32Array {
  if (sourceWidth === width && sourceHeight === height) return source.slice();
  const result = new Float32Array(width * height);
  const xScale = sourceWidth / width;
  const yScale = sourceHeight / height;
  for (let y = 0; y < height; y++) {
    const sy = Math.min(sourceHeight - 1, Math.max(0, (y + 0.5) * yScale - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(sourceHeight - 1, y0 + 1);
    const fy = sy - y0;
    for (let x = 0; x < width; x++) {
      const sx = Math.min(sourceWidth - 1, Math.max(0, (x + 0.5) * xScale - 0.5));
      const x0 = Math.floor(sx);
      const x1 = Math.min(sourceWidth - 1, x0 + 1);
      const fx = sx - x0;
      const top =
        (source[y0 * sourceWidth + x0] ?? 0) * (1 - fx) + (source[y0 * sourceWidth + x1] ?? 0) * fx;
      const bottom =
        (source[y1 * sourceWidth + x0] ?? 0) * (1 - fx) + (source[y1 * sourceWidth + x1] ?? 0) * fx;
      result[y * width + x] = top * (1 - fy) + bottom * fy;
    }
  }
  return result;
}

export async function loadDepthModel(
  model: string | ArrayBuffer | Uint8Array,
  options?: LoadDepthModelOptions,
): Promise<DepthModel> {
  if (options?.wasmPaths !== undefined) {
    ort.env.wasm.wasmPaths = options.wasmPaths;
  }

  const source =
    typeof model === "string" || model instanceof Uint8Array ? model : new Uint8Array(model);
  const createSession = (executionProviders: readonly DepthExecutionProvider[]) =>
    typeof source === "string"
      ? ort.InferenceSession.create(source, { executionProviders: [...executionProviders] })
      : ort.InferenceSession.create(source, { executionProviders: [...executionProviders] });

  let providers: readonly DepthExecutionProvider[] = options?.executionProviders ?? ["wasm"];
  let session = await createSession(providers);
  const rawInputName = session.inputNames[0];
  const rawOutputName = session.outputNames[0];
  if (!rawInputName || !rawOutputName) {
    throw new Error("Depth model has no input/output names");
  }
  const inputName: string = rawInputName;
  const outputName: string = rawOutputName;

  async function runModel(feeds: Record<string, ort.Tensor>) {
    try {
      return await session.run(feeds);
    } catch (cause) {
      if (!providers.includes("webgpu")) throw cause;
      providers = ["wasm"];
      session = await createSession(providers);
      return session.run(feeds);
    }
  }

  return {
    async estimateDepth(image: ImageData): Promise<DepthMap> {
      const size = depthInputSize(image.width, image.height, options?.inputSize);
      const results = await runModel({ [inputName]: preprocess(image, size) });
      const output = results[outputName];
      if (!output) {
        throw new Error(`Depth model did not produce output "${outputName}"`);
      }
      const expected = size.width * size.height;
      if (output.data.length !== expected) {
        throw new Error(
          `Depth model returned ${output.data.length} values for a ${size.width} x ${size.height} input (expected ${expected}).`,
        );
      }
      const normalized = normalizeDepth(output.data as Float32Array);
      const values = resampleDepth(normalized, size.width, size.height, image.width, image.height);
      return { values, width: image.width, height: image.height };
    },
  };
}
