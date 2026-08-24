import "./image-data-polyfill.js";
import { createImageData, resize } from "@maker/core-image";
import * as ort from "onnxruntime-node";
import type { RgbaImage, DepthMap } from "./wire-image.js";

/**
 * MiDaS v2.1 small (see models/NOTICE.md) expects a 256x256 RGB input,
 * normalized with ImageNet mean/std, laid out channel-first (NCHW). Its
 * single output is a relative inverse-depth map (higher = nearer), not
 * metric depth, so it's min-max normalized to [0, 1] per image before use.
 */
const MODEL_INPUT_SIZE = 256;
const CHANNEL_MEAN = [0.485, 0.456, 0.406];
const CHANNEL_STD = [0.229, 0.224, 0.225];

export type { RgbaImage, DepthMap };

export interface DepthModel {
  estimateDepth(image: RgbaImage): Promise<DepthMap>;
}

function preprocess(image: RgbaImage): ort.Tensor {
  const resized = resize(image as ImageData, {
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

/** Min-max normalizes the raw relative inverse-depth output to [0, 1]. */
function normalizeDepth(raw: Float32Array): Float32Array {
  let min = Infinity;
  let max = -Infinity;
  for (const v of raw) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min;
  if (range < 1e-6) {
    return raw.slice();
  }
  const normalized = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    normalized[i] = ((raw[i] ?? 0) - min) / range;
  }
  return normalized;
}

/** Upsamples a 256x256 [0,1] depth map to `width`x`height` by round-tripping through the RGBA resize filter. */
function upsampleDepth(depth: Float32Array, width: number, height: number): Float32Array {
  const depthImage = createImageData(MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);
  const depthData = depthImage.data;
  for (let i = 0; i < depth.length; i++) {
    const value = Math.round((depth[i] ?? 0) * 255);
    depthData[i * 4] = value;
    depthData[i * 4 + 1] = value;
    depthData[i * 4 + 2] = value;
    depthData[i * 4 + 3] = 255;
  }

  const resized = resize(depthImage, { width, height, method: "bilinear" });
  const result = new Float32Array(width * height);
  for (let i = 0; i < result.length; i++) {
    result[i] = (resized.data[i * 4] ?? 0) / 255;
  }
  return result;
}

export async function loadDepthModel(modelPath: string): Promise<DepthModel> {
  const session = await ort.InferenceSession.create(modelPath);
  const rawInputName = session.inputNames[0];
  const rawOutputName = session.outputNames[0];
  if (!rawInputName || !rawOutputName) {
    throw new Error("Depth model has no input/output names");
  }
  const inputName: string = rawInputName;
  const outputName: string = rawOutputName;

  return {
    async estimateDepth(image: RgbaImage): Promise<DepthMap> {
      const tensor = preprocess(image);
      const results = await session.run({ [inputName]: tensor });
      const output = results[outputName];
      if (!output) {
        throw new Error(`Depth model did not produce output "${outputName}"`);
      }

      const normalized = normalizeDepth(output.data as Float32Array);
      const values = upsampleDepth(normalized, image.width, image.height);
      return { values, width: image.width, height: image.height };
    },
  };
}
