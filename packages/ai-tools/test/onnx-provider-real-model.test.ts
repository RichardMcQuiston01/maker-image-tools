import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  lazyBackgroundRemovalModel,
  OnnxBackgroundRemover,
  REMOVE_BACKGROUND_MODE,
  type ImageCodec,
} from "../src/onnx-background-remover.js";

const MODEL_PATH = join(process.cwd(), "models", "u2netp.onnx");

/** `[width, height, ...pixels]` as the encoded image, so no real PNG codec is needed. */
const codec: ImageCodec = {
  async encode(image) {
    return {
      mimeType: "image/x-test",
      data: new Uint8Array([image.width, image.height, ...image.data]),
    };
  },
  async decode(image) {
    const [width = 0, height = 0, ...rest] = image.data;
    return { width, height, data: new Uint8ClampedArray(rest) };
  },
};

describe("OnnxBackgroundRemover with the vendored model", () => {
  it("loads the model lazily and cuts a red disc out of a white backdrop", async () => {
    const width = 64;
    const height = 48;
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const inDisc = (x - width / 2) ** 2 + (y - height / 2) ** 2 <= (height / 3) ** 2;
        pixels.set(inDisc ? [220, 40, 40, 255] : [250, 250, 250, 255], i);
      }
    }

    const modelBytes = readFileSync(MODEL_PATH);
    const remover = new OnnxBackgroundRemover({
      loadModel: lazyBackgroundRemovalModel(new Uint8Array(modelBytes)),
      codec,
    });
    const result = await remover.generateImage({
      instructions: "",
      prompt: "",
      images: [{ mimeType: "image/x-test", data: new Uint8Array([width, height, ...pixels]) }],
      mode: REMOVE_BACKGROUND_MODE,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [outWidth, outHeight, ...rgba] = result.value.image.data;
    expect([outWidth, outHeight]).toEqual([width, height]);
    expect(rgba.length).toBe(width * height * 4);
    // The model is not asked for a perfect mask, only that the disc is kept more
    // than the backdrop: compare the alpha at the centre with a corner.
    const alphaAt = (x: number, y: number): number => rgba[(y * width + x) * 4 + 3] ?? 0;
    expect(alphaAt(width / 2, height / 2)).toBeGreaterThan(alphaAt(1, 1));
  });
});
