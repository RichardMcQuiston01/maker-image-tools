import { createImageData, resize } from "@maker/core-image";
import * as tf from "@tensorflow/tfjs";
import x2 from "@upscalerjs/esrgan-slim/2x";
import x3 from "@upscalerjs/esrgan-slim/3x";
import x4 from "@upscalerjs/esrgan-slim/4x";
import x8 from "@upscalerjs/esrgan-slim/8x";
import Upscaler from "upscaler";

export type UpscaleFactor = 2 | 3 | 4 | 8;

interface UpscalerModelDefinition {
  path?: string;
  [key: string]: unknown;
}

const MODEL_DEFINITIONS: Record<UpscaleFactor, UpscalerModelDefinition> = {
  2: x2 as UpscalerModelDefinition,
  3: x3 as UpscalerModelDefinition,
  4: x4 as UpscalerModelDefinition,
  8: x8 as UpscalerModelDefinition,
};

export interface LoadUpscaleModelOptions {
  /**
   * Full URL to this scale factor's `model.json` (with its weight-shard files
   * served alongside it), overriding the library's default behavior of
   * fetching from the jsdelivr/unpkg CDN mirrors of the npm package. Needed
   * for a fully self-contained deployment with no external CDN dependency —
   * the caller is expected to serve the vendored model files (bundled from
   * `@upscalerjs/esrgan-slim`'s own `models/<scale>x/` directory) and pass
   * their resolved URL here.
   */
  modelUrl?: string;
}

export interface UpscaleModel {
  readonly scaleFactor: UpscaleFactor;
  /** Upscales `image` by this model's scale factor, preserving the alpha channel. */
  upscale(image: ImageData): Promise<ImageData>;
}

function imageToRgbTensor(image: ImageData): tf.Tensor3D {
  const pixelCount = image.width * image.height;
  const rgb = new Int32Array(pixelCount * 3);
  const data = image.data;
  for (let i = 0; i < pixelCount; i++) {
    rgb[i * 3] = data[i * 4] ?? 0;
    rgb[i * 3 + 1] = data[i * 4 + 1] ?? 0;
    rgb[i * 3 + 2] = data[i * 4 + 2] ?? 0;
  }
  return tf.tensor3d(rgb, [image.height, image.width, 3], "int32");
}

/** Upsamples the alpha channel to the output size by round-tripping it through the RGBA resize filter (the upscaling model only understands RGB). */
function upsampleAlpha(image: ImageData, outWidth: number, outHeight: number): Uint8ClampedArray {
  const alphaImage = createImageData(image.width, image.height);
  const src = image.data;
  const dst = alphaImage.data;
  for (let i = 0; i < image.width * image.height; i++) {
    const a = src[i * 4 + 3] ?? 255;
    dst[i * 4] = a;
    dst[i * 4 + 1] = a;
    dst[i * 4 + 2] = a;
    dst[i * 4 + 3] = 255;
  }
  const resized = resize(alphaImage, { width: outWidth, height: outHeight, method: "bilinear" });
  const result = new Uint8ClampedArray(outWidth * outHeight);
  for (let i = 0; i < result.length; i++) {
    result[i] = resized.data[i * 4] ?? 255;
  }
  return result;
}

export async function loadUpscaleModel(
  scaleFactor: UpscaleFactor,
  options?: LoadUpscaleModelOptions,
): Promise<UpscaleModel> {
  const baseDefinition = MODEL_DEFINITIONS[scaleFactor];
  const modelDefinition: UpscalerModelDefinition = options?.modelUrl
    ? { ...baseDefinition, path: options.modelUrl }
    : baseDefinition;
  const upscaler = new Upscaler({ model: modelDefinition });
  await upscaler.ready;

  return {
    scaleFactor,
    async upscale(image: ImageData): Promise<ImageData> {
      const inputTensor = imageToRgbTensor(image);
      let outputTensor: tf.Tensor3D;
      try {
        outputTensor = await upscaler.upscale(inputTensor, { output: "tensor" });
      } finally {
        inputTensor.dispose();
      }

      const [outHeight, outWidth] = outputTensor.shape;
      if (outHeight === undefined || outWidth === undefined) {
        outputTensor.dispose();
        throw new Error("Upscale model produced a tensor with an unexpected shape");
      }

      const pixels = await outputTensor.data();
      outputTensor.dispose();

      const alpha = upsampleAlpha(image, outWidth, outHeight);
      const result = createImageData(outWidth, outHeight);
      const dst = result.data;
      const pixelCount = outWidth * outHeight;
      for (let i = 0; i < pixelCount; i++) {
        dst[i * 4] = pixels[i * 3] ?? 0;
        dst[i * 4 + 1] = pixels[i * 3 + 1] ?? 0;
        dst[i * 4 + 2] = pixels[i * 3 + 2] ?? 0;
        dst[i * 4 + 3] = alpha[i] ?? 255;
      }
      return result;
    },
  };
}
