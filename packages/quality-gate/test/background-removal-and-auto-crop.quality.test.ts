import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { computeCropRegion, loadBackgroundRemovalModel } from "@maker/ai-tools";
import { bboxIoU, createCircleFixture, maskIoU } from "../src/index.js";

// Same vendored u2netp model packages/ai-tools's own tests run real
// inference against - no network access needed.
const MODEL_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "ai-tools",
  "models",
  "u2netp.onnx",
);

// Thresholds are calibrated below the model's actual observed IoU (~0.95-1.0
// on this fixture at several sizes) so this catches a real regression - a
// broken/degraded model producing a mask that no longer tracks the subject -
// without being flaky about the model's ordinary run-to-run precision.
const MIN_MASK_IOU = 0.85;
const MIN_BBOX_IOU = 0.75;

describe("background removal / auto-crop quality gate", () => {
  it("segments a high-contrast subject with IoU clearing the regression threshold", async () => {
    const modelBytes = readFileSync(MODEL_PATH);
    const model = await loadBackgroundRemovalModel(
      modelBytes.buffer.slice(modelBytes.byteOffset, modelBytes.byteOffset + modelBytes.byteLength),
    );

    for (const [width, height] of [
      [64, 48],
      [96, 96],
      [128, 96],
    ] as const) {
      const fixture = createCircleFixture(width, height);
      const mask = await model.computeSaliencyMask(fixture.image);

      const iou = maskIoU(mask.values, fixture.groundTruthMask);
      expect(iou, `mask IoU at ${width}x${height}`).toBeGreaterThanOrEqual(MIN_MASK_IOU);

      const predictedBBox = computeCropRegion(mask);
      const boxIoU = bboxIoU(predictedBBox, fixture.groundTruthBBox);
      expect(boxIoU, `bbox IoU at ${width}x${height}`).toBeGreaterThanOrEqual(MIN_BBOX_IOU);
    }
  });
});
