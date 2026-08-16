import { describe, expect, it } from "vitest";
import { createFilterRegistry } from "../src/registry.js";
import { createImageData } from "../src/pixel.js";
import type { Filter, FilterOptions } from "../src/types.js";

interface InvertOptions extends FilterOptions {
  strength?: number;
}

const invert: Filter<InvertOptions> = (image) => {
  const data = new Uint8ClampedArray(image.data);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255 - (data[i] ?? 0);
    data[i + 1] = 255 - (data[i + 1] ?? 0);
    data[i + 2] = 255 - (data[i + 2] ?? 0);
  }
  return new ImageData(data, image.width, image.height);
};

describe("FilterRegistry", () => {
  it("registers and lists filters by name", () => {
    const registry = createFilterRegistry();
    registry.register("invert", invert);

    expect(registry.has("invert")).toBe(true);
    expect(registry.list()).toEqual(["invert"]);
  });

  it("throws when registering a duplicate name", () => {
    const registry = createFilterRegistry();
    registry.register("invert", invert);

    expect(() => registry.register("invert", invert)).toThrow(/already registered/);
  });

  it("applies a registered filter to ImageData", () => {
    const registry = createFilterRegistry();
    registry.register("invert", invert);

    const input = createImageData(2, 1, [10, 20, 30, 255]);
    const output = registry.apply("invert", input, {});

    expect(Array.from(output.data.slice(0, 4))).toEqual([245, 235, 225, 255]);
  });

  it("throws when applying an unknown filter", () => {
    const registry = createFilterRegistry();
    expect(() => registry.apply("missing", createImageData(1, 1), {})).toThrow(
      /No filter registered/,
    );
  });
});
