/**
 * The in-browser U²-Net background remover, as an `ImageGenerator`.
 *
 * It runs the model from this package (ONNX Runtime Web) on the visitor's own
 * machine, so it needs no server, no account and no network once the model is
 * cached — and, being an `ImageGenerator` from
 * `@richardmcquiston01/ai-providers`, it is interchangeable with any other
 * provider (a local ComfyUI, a hosted API). Providers exchange *encoded*
 * images, so an {@link ImageCodec} turns them into pixels and back.
 */
import {
  describeUnknownError,
  err,
  ok,
  type AiImage,
  type ImageGenerator,
  type ImageRequest,
  type ImageResult,
  type Result,
} from "@richardmcquiston01/ai-providers";
import type {
  BackgroundRemovalModel,
  LoadBackgroundRemovalModelOptions,
} from "./background-removal.js";

/** The one thing this provider does. */
export const REMOVE_BACKGROUND_MODE = "remove-background";

/** RGBA pixels, row-major: structurally an `ImageData`, without needing one. */
export interface PixelBuffer {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** Converts between the encoded images providers exchange and RGBA pixels. */
export interface ImageCodec {
  encode(image: PixelBuffer): Promise<AiImage>;
  decode(image: AiImage): Promise<PixelBuffer>;
}

export interface OnnxBackgroundRemoverOptions {
  /** Loads the model. Called once; a failed load is retried on the next run. */
  loadModel: () => Promise<BackgroundRemovalModel>;
  codec: ImageCodec;
}

export class OnnxBackgroundRemover implements ImageGenerator {
  readonly provider = "onnx-web";
  readonly model = "u2netp";

  private readonly loadModel: () => Promise<BackgroundRemovalModel>;
  private readonly codec: ImageCodec;
  private modelPromise: Promise<BackgroundRemovalModel> | null = null;

  constructor(options: OnnxBackgroundRemoverOptions) {
    this.loadModel = options.loadModel;
    this.codec = options.codec;
  }

  async listModes(): Promise<Result<readonly string[]>> {
    return ok([REMOVE_BACKGROUND_MODE]);
  }

  async generateImage(request: ImageRequest): Promise<Result<ImageResult>> {
    const label = `${this.provider} (model "${this.model}")`;

    if (request.mode !== null && request.mode !== REMOVE_BACKGROUND_MODE) {
      return err(
        `${label} has no mode "${request.mode}"; its only mode is "${REMOVE_BACKGROUND_MODE}".`,
      );
    }
    const input = request.images[0];
    if (!input) {
      return err(`${label} needs the image to cut out, but the request had none.`);
    }
    if (request.signal?.aborted) {
      return err(`${label} was cancelled before it started.`);
    }

    try {
      const model = await this.getModel();
      const pixels = await this.codec.decode(input);
      const cutout = await model.removeBackground(
        new ImageData(pixels.data as Uint8ClampedArray<ArrayBuffer>, pixels.width, pixels.height),
      );
      // The model can't be interrupted mid-run, so honour a cancel afterwards.
      if (request.signal?.aborted) {
        return err(`${label} was cancelled while it was running.`);
      }
      const image = await this.codec.encode({
        width: cutout.width,
        height: cutout.height,
        data: cutout.data,
      });
      return ok({ image, notes: null });
    } catch (cause) {
      return err(`${label} failed: ${describeUnknownError(cause)}`, cause);
    }
  }

  /** Load the model once and share it; forget a failed load so it can retry. */
  private getModel(): Promise<BackgroundRemovalModel> {
    if (!this.modelPromise) {
      this.modelPromise = this.loadModel().catch((cause: unknown) => {
        this.modelPromise = null;
        throw cause;
      });
    }
    return this.modelPromise;
  }
}

/**
 * A `loadModel` for {@link OnnxBackgroundRemover} that imports ONNX Runtime
 * only when the model is first needed, so a bundler keeps it out of the chunk
 * that merely lists the provider.
 */
export function lazyBackgroundRemovalModel(
  model: string | ArrayBuffer | Uint8Array,
  options?: LoadBackgroundRemovalModelOptions,
): () => Promise<BackgroundRemovalModel> {
  return async () => {
    const { loadBackgroundRemovalModel } = await import("./background-removal.js");
    return loadBackgroundRemovalModel(model, options);
  };
}
