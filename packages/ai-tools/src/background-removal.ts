import { createImageData, resize } from "@maker/core-image";
import * as ort from "onnxruntime-web";

/**
 * U2NETP (see models/NOTICE.md) expects a 320x320 RGB input, normalized with
 * ImageNet mean/std, laid out channel-first (NCHW). Its first output is the
 * final fused, sigmoid-activated saliency mask; the remaining six outputs are
 * the network's deep-supervision side outputs and are not used here.
 */
const MODEL_INPUT_SIZE = 320;
const CHANNEL_MEAN = [0.485, 0.456, 0.406];
const CHANNEL_STD = [0.229, 0.224, 0.225];

export interface LoadBackgroundRemovalModelOptions {
  /**
   * Base URL onnxruntime-web should use to locate its own WASM runtime files
   * (ort-wasm*.wasm), passed through to `ort.env.wasm.wasmPaths`. Bundlers
   * that don't automatically resolve onnxruntime-web's WASM assets (e.g.
   * Vite, unless configured) need this pointed at wherever those files were
   * copied. If omitted, onnxruntime-web's own default resolution is used.
   */
  wasmPaths?: string;
}

export interface BackgroundRemovalModel {
  /**
   * Removes the background from `image`, returning a same-size ImageData
   * whose background pixels are made transparent (alpha scaled by the
   * predicted foreground mask).
   */
  removeBackground(image: ImageData): Promise<ImageData>;
}

function preprocess(image: ImageData): ort.Tensor {
  const resized = resize(image, {
    width: MODEL_INPUT_SIZE,
    height: MODEL_INPUT_SIZE,
    method: "bilinear",
  });

  const pixelCount = MODEL_INPUT_SIZE * MODEL_INPUT_SIZE;
  const chw = new Float32Array(3 * pixelCount);
  const data = resized.data;

  for (let i = 0; i < pixelCount; i++) {
    const r = (data[i * 4] ?? 0) / 255;
    const g = (data[i * 4 + 1] ?? 0) / 255;
    const b = (data[i * 4 + 2] ?? 0) / 255;
    chw[i] = (r - CHANNEL_MEAN[0]!) / CHANNEL_STD[0]!;
    chw[pixelCount + i] = (g - CHANNEL_MEAN[1]!) / CHANNEL_STD[1]!;
    chw[pixelCount * 2 + i] = (b - CHANNEL_MEAN[2]!) / CHANNEL_STD[2]!;
  }

  return new ort.Tensor("float32", chw, [1, 3, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE]);
}

/** Min-max normalizes the raw mask output to [0, 1], matching U2Net's standard postprocessing. */
function normalizeMask(mask: Float32Array): Float32Array {
  let min = Infinity;
  let max = -Infinity;
  for (const v of mask) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min;
  if (range < 1e-6) {
    return mask;
  }
  const normalized = new Float32Array(mask.length);
  for (let i = 0; i < mask.length; i++) {
    normalized[i] = ((mask[i] ?? 0) - min) / range;
  }
  return normalized;
}

/** Upsamples a 320x320 [0,1] mask to `width`x`height` by round-tripping it through the RGBA resize filter. */
function upsampleMask(mask: Float32Array, width: number, height: number): Float32Array {
  const maskImage = createImageData(MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);
  const maskData = maskImage.data;
  for (let i = 0; i < mask.length; i++) {
    const value = Math.round((mask[i] ?? 0) * 255);
    maskData[i * 4] = value;
    maskData[i * 4 + 1] = value;
    maskData[i * 4 + 2] = value;
    maskData[i * 4 + 3] = 255;
  }

  const resized = resize(maskImage, { width, height, method: "bilinear" });
  const result = new Float32Array(width * height);
  for (let i = 0; i < result.length; i++) {
    result[i] = (resized.data[i * 4] ?? 0) / 255;
  }
  return result;
}

function supportsWebGpu(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator && navigator.gpu != null;
}

export async function loadBackgroundRemovalModel(
  model: string | ArrayBuffer | Uint8Array,
  options?: LoadBackgroundRemovalModelOptions,
): Promise<BackgroundRemovalModel> {
  if (options?.wasmPaths !== undefined) {
    ort.env.wasm.wasmPaths = options.wasmPaths;
  }

  const executionProviders = supportsWebGpu() ? ["webgpu", "wasm"] : ["wasm"];
  const session =
    typeof model === "string"
      ? await ort.InferenceSession.create(model, { executionProviders })
      : await ort.InferenceSession.create(
          model instanceof Uint8Array ? model : new Uint8Array(model),
          { executionProviders },
        );
  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];
  if (!inputName || !outputName) {
    throw new Error("Background removal model has no input/output names");
  }

  return {
    async removeBackground(image: ImageData): Promise<ImageData> {
      const tensor = preprocess(image);
      const results = await session.run({ [inputName]: tensor });
      const output = results[outputName];
      if (!output) {
        throw new Error(`Background removal model did not produce output "${outputName}"`);
      }

      const mask = normalizeMask(output.data as Float32Array);
      const upsampled = upsampleMask(mask, image.width, image.height);

      const result = createImageData(image.width, image.height);
      const srcData = image.data;
      const dstData = result.data;
      for (let i = 0; i < upsampled.length; i++) {
        const srcAlpha = srcData[i * 4 + 3] ?? 255;
        dstData[i * 4] = srcData[i * 4] ?? 0;
        dstData[i * 4 + 1] = srcData[i * 4 + 1] ?? 0;
        dstData[i * 4 + 2] = srcData[i * 4 + 2] ?? 0;
        dstData[i * 4 + 3] = Math.round((upsampled[i] ?? 0) * srcAlpha);
      }
      return result;
    },
  };
}
