import { describe, expect, test } from "vitest";
import type { ImageRequest } from "@richardmcquiston01/ai-providers";
import type { BackgroundRemovalModel } from "../src/background-removal.js";
import {
  OnnxBackgroundRemover,
  REMOVE_BACKGROUND_MODE,
  type ImageCodec,
} from "../src/onnx-background-remover.js";

/** Encodes `[width, height, ...pixels]` as the "image", so no real decoder is needed. */
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

/** A model that halves every pixel's alpha and counts its calls. */
function fakeModel(): BackgroundRemovalModel & { calls: number } {
  const model = {
    calls: 0,
    async removeBackground(image: ImageData): Promise<ImageData> {
      model.calls += 1;
      const data = new Uint8ClampedArray(image.data);
      for (let i = 3; i < data.length; i += 4) data[i] = (data[i] ?? 0) >> 1;
      return new ImageData(data, image.width, image.height);
    },
    async computeSaliencyMask(): Promise<never> {
      throw new Error("not used");
    },
  };
  return model;
}

function request(overrides: Partial<ImageRequest> = {}): ImageRequest {
  return {
    instructions: "",
    prompt: "",
    images: [{ mimeType: "image/x-test", data: new Uint8Array([1, 1, 10, 20, 30, 200]) }],
    mode: REMOVE_BACKGROUND_MODE,
    ...overrides,
  };
}

describe("OnnxBackgroundRemover", () => {
  test("identifies itself and offers one mode", async () => {
    const remover = new OnnxBackgroundRemover({ loadModel: async () => fakeModel(), codec });
    expect(remover.provider).toBe("onnx-web");
    expect(remover.model).toBe("u2netp");
    expect(await remover.listModes()).toEqual({ ok: true, value: [REMOVE_BACKGROUND_MODE] });
  });

  test("cuts the image out and returns an encoded result", async () => {
    const remover = new OnnxBackgroundRemover({ loadModel: async () => fakeModel(), codec });
    const result = await remover.generateImage(request());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Array.from(result.value.image.data)).toEqual([1, 1, 10, 20, 30, 100]);
    expect(result.value.notes).toBeNull();
  });

  test("accepts a null mode as its default", async () => {
    const remover = new OnnxBackgroundRemover({ loadModel: async () => fakeModel(), codec });
    expect((await remover.generateImage(request({ mode: null }))).ok).toBe(true);
  });

  test("loads the model once and shares it between runs", async () => {
    let loads = 0;
    const model = fakeModel();
    const remover = new OnnxBackgroundRemover({
      loadModel: async () => {
        loads += 1;
        return model;
      },
      codec,
    });
    await remover.generateImage(request());
    await remover.generateImage(request());
    expect(loads).toBe(1);
    expect(model.calls).toBe(2);
  });

  test("retries loading after a failed load, and says why it failed", async () => {
    let loads = 0;
    const remover = new OnnxBackgroundRemover({
      loadModel: async () => {
        loads += 1;
        if (loads === 1) throw new Error("model download failed (HTTP 404)");
        return fakeModel();
      },
      codec,
    });
    const first = await remover.generateImage(request());
    expect(first.ok).toBe(false);
    if (first.ok) return;
    expect(first.error).toBe('onnx-web (model "u2netp") failed: model download failed (HTTP 404)');
    expect((await remover.generateImage(request())).ok).toBe(true);
    expect(loads).toBe(2);
  });

  test("refuses an unknown mode, naming it", async () => {
    const remover = new OnnxBackgroundRemover({ loadModel: async () => fakeModel(), codec });
    const result = await remover.generateImage(request({ mode: "upscale" }));
    expect(result).toEqual({
      ok: false,
      error:
        'onnx-web (model "u2netp") has no mode "upscale"; its only mode is "remove-background".',
    });
  });

  test("refuses a request with no image", async () => {
    const remover = new OnnxBackgroundRemover({ loadModel: async () => fakeModel(), codec });
    const result = await remover.generateImage(request({ images: [] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("needs the image to cut out");
  });

  test("does nothing when already cancelled, and drops a result cancelled mid-run", async () => {
    const controller = new AbortController();
    const model = fakeModel();
    const remover = new OnnxBackgroundRemover({
      loadModel: async () => ({
        ...model,
        async removeBackground(image: ImageData) {
          controller.abort();
          return model.removeBackground(image);
        },
      }),
      codec,
    });

    const early = new AbortController();
    early.abort();
    const skipped = await remover.generateImage(request({ signal: early.signal }));
    expect(skipped.ok).toBe(false);
    expect(model.calls).toBe(0);

    const interrupted = await remover.generateImage(request({ signal: controller.signal }));
    expect(interrupted.ok).toBe(false);
    if (interrupted.ok) return;
    expect(interrupted.error).toContain("cancelled while it was running");
  });
});
