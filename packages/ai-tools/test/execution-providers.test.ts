import { beforeEach, describe, expect, it, vi } from "vitest";

const created: string[][] = [];
let failRunsOn: string | null = null;

vi.mock("onnxruntime-web", () => {
  class Tensor {
    constructor(
      readonly type: string,
      readonly data: Float32Array,
      readonly dims: number[],
    ) {}
  }
  return {
    env: { wasm: {} },
    Tensor,
    InferenceSession: {
      async create(_model: unknown, options: { executionProviders: string[] }) {
        const providers = options.executionProviders;
        created.push(providers);
        return {
          inputNames: ["input"],
          outputNames: ["mask"],
          async run() {
            if (failRunsOn && providers.includes(failRunsOn)) {
              throw new Error("using ceil() in shape computation is not yet supported for MaxPool");
            }
            return { mask: { data: new Float32Array(320 * 320).fill(0.5) } };
          },
        };
      },
    },
  };
});

import { loadBackgroundRemovalModel } from "../src/background-removal.js";

function image(): ImageData {
  return new ImageData(new Uint8ClampedArray(8 * 8 * 4).fill(200), 8, 8);
}

beforeEach(() => {
  created.length = 0;
  failRunsOn = null;
});

describe("execution providers", () => {
  it("uses WebAssembly only by default, even when the browser reports WebGPU", async () => {
    vi.stubGlobal("navigator", { gpu: {} });
    try {
      const model = await loadBackgroundRemovalModel(new Uint8Array(4));
      await model.removeBackground(image());
      expect(created).toEqual([["wasm"]]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("passes through the providers the caller asks for", async () => {
    await loadBackgroundRemovalModel(new Uint8Array(4), { executionProviders: ["webgpu", "wasm"] });
    expect(created).toEqual([["webgpu", "wasm"]]);
  });

  it("falls back to WebAssembly and retries when a run fails on WebGPU", async () => {
    failRunsOn = "webgpu";
    const model = await loadBackgroundRemovalModel(new Uint8Array(4), {
      executionProviders: ["webgpu", "wasm"],
    });
    const out = await model.removeBackground(image());
    expect(out.width).toBe(8);
    expect(created).toEqual([["webgpu", "wasm"], ["wasm"]]);
    // Later runs reuse the WebAssembly session.
    await model.removeBackground(image());
    expect(created).toHaveLength(2);
  });

  it("does not hide a failure when WebGPU was never asked for", async () => {
    failRunsOn = "wasm";
    const model = await loadBackgroundRemovalModel(new Uint8Array(4));
    await expect(model.removeBackground(image())).rejects.toThrow("MaxPool");
    expect(created).toEqual([["wasm"]]);
  });
});
