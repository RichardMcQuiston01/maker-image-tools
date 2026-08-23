import { describe, expect, it } from "vitest";
import { classifyMaterial } from "../src/classify.js";

describe("classifyMaterial", () => {
  it("reports unknown at zero confidence in stub mode, with no matched presets", async () => {
    const result = await classifyMaterial(new Uint8Array([1, 2, 3, 4]));
    expect(result.material).toBe("unknown");
    expect(result.confidence).toBe(0);
    expect(result.matchedPresets).toEqual([]);
    expect(result.notes).toMatch(/stub/i);
  });
});
