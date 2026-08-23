import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadBackgroundRemovalModel } from "../src/background-removal.js";

const MODEL_PATH = join(process.cwd(), "models", "u2netp.onnx");

function buildTestImage(width: number, height: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) / 3;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const inCircle = (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius;
      if (inCircle) {
        data[i] = 220;
        data[i + 1] = 40;
        data[i + 2] = 40;
      } else {
        data[i] = 250;
        data[i + 1] = 250;
        data[i + 2] = 250;
      }
      data[i + 3] = 255;
    }
  }
  return new ImageData(data, width, height);
}

describe("loadBackgroundRemovalModel", () => {
  it("runs real inference against the vendored u2netp model and returns a valid alpha-masked image", async () => {
    const modelBytes = readFileSync(MODEL_PATH);
    const model = await loadBackgroundRemovalModel(
      modelBytes.buffer.slice(modelBytes.byteOffset, modelBytes.byteOffset + modelBytes.byteLength),
    );

    const input = buildTestImage(64, 48);
    const output = await model.removeBackground(input);

    expect(output.width).toBe(64);
    expect(output.height).toBe(48);
    expect(output.data.length).toBe(input.data.length);

    // RGB channels are passed through untouched; only alpha is modified.
    for (let i = 0; i < output.data.length; i += 4) {
      expect(output.data[i]).toBe(input.data[i]);
      expect(output.data[i + 1]).toBe(input.data[i + 1]);
      expect(output.data[i + 2]).toBe(input.data[i + 2]);
      const alpha = output.data[i + 3]!;
      expect(alpha).toBeGreaterThanOrEqual(0);
      expect(alpha).toBeLessThanOrEqual(255);
    }

    // The model should produce some variation in the alpha channel rather than
    // a uniformly flat mask — a sanity check that real inference ran, not a
    // quality assertion about segmentation accuracy.
    const alphas = new Set<number>();
    for (let i = 3; i < output.data.length; i += 4) alphas.add(output.data[i]!);
    expect(alphas.size).toBeGreaterThan(1);
  });

  it("throws a clear error when the underlying model has no usable input/output names", async () => {
    // A minimal syntactically-invalid buffer should fail session creation with
    // an error, not hang or silently produce garbage output.
    await expect(loadBackgroundRemovalModel(new Uint8Array([1, 2, 3, 4]).buffer)).rejects.toThrow();
  });
});
