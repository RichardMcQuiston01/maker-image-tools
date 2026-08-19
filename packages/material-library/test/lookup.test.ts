import { describe, expect, it } from "vitest";
import {
  findPreset,
  getAllPresets,
  getPresetsForMachine,
  getPresetsForMaterial,
  listMachineTypes,
  listMaterials,
  searchPresets,
} from "../src/index.js";

describe("getAllPresets", () => {
  it("returns a non-empty array with at least 20 presets", () => {
    const presets = getAllPresets();
    expect(presets.length).toBeGreaterThanOrEqual(20);
  });

  it("returns a defensive copy that callers can mutate without side effects", () => {
    const presets = getAllPresets();
    const originalLength = presets.length;
    presets.push({
      id: "mutation-canary",
      material: "Should Not Persist",
      machineType: "diode-laser",
      operation: "cut",
      speed: 100,
      power: 100,
    });
    expect(presets.length).toBe(originalLength + 1);

    const presetsAgain = getAllPresets();
    expect(presetsAgain.length).toBe(originalLength);
    expect(presetsAgain.some((p) => p.id === "mutation-canary")).toBe(false);
  });
});

describe("data quality", () => {
  it("has a unique id for every preset", () => {
    const presets = getAllPresets();
    const ids = new Set(presets.map((p) => p.id));
    expect(ids.size).toBe(presets.length);
  });

  it("has a positive speed and an in-range power (0-1000) for every preset", () => {
    const presets = getAllPresets();
    for (const preset of presets) {
      expect(preset.speed).toBeGreaterThan(0);
      expect(preset.power).toBeGreaterThanOrEqual(0);
      expect(preset.power).toBeLessThanOrEqual(1000);
    }
  });
});

describe("listMaterials", () => {
  it("returns a sorted, deduplicated list of material names", () => {
    const materials = listMaterials();
    const deduped = [...new Set(materials)];
    expect(materials.length).toBe(deduped.length);

    const sorted = [...materials].sort((a, b) => a.localeCompare(b));
    expect(materials).toEqual(sorted);
  });
});

describe("listMachineTypes", () => {
  it("returns exactly the machine types present in the bundled data", () => {
    const presets = getAllPresets();
    const expected = [...new Set(presets.map((p) => p.machineType))].sort();
    const actual = [...listMachineTypes()].sort();
    expect(actual).toEqual(expected);
  });
});

describe("getPresetsForMaterial", () => {
  it("matches case-insensitively against a known material", () => {
    const exact = getPresetsForMaterial("Baltic Birch Plywood 3mm");
    expect(exact.length).toBeGreaterThan(0);

    const upper = getPresetsForMaterial("BALTIC BIRCH PLYWOOD 3MM");
    expect(upper.length).toBe(exact.length);
    expect(upper.map((p) => p.id).sort()).toEqual(exact.map((p) => p.id).sort());
  });

  it("returns an empty array for a material that does not exist", () => {
    expect(getPresetsForMaterial("Unobtainium")).toEqual([]);
  });
});

describe("getPresetsForMachine", () => {
  it("returns only diode-laser presets, matching a manual filter", () => {
    const fromLookup = getPresetsForMachine("diode-laser");
    const manual = getAllPresets().filter((p) => p.machineType === "diode-laser");

    expect(fromLookup.length).toBe(manual.length);
    expect(fromLookup.every((p) => p.machineType === "diode-laser")).toBe(true);
    expect(fromLookup.map((p) => p.id).sort()).toEqual(manual.map((p) => p.id).sort());
  });
});

describe("findPreset", () => {
  it("returns the correct single preset for a known combination", () => {
    const preset = findPreset("Baltic Birch Plywood 3mm", "diode-laser", "cut");
    expect(preset).toBeDefined();
    expect(preset?.id).toBe("diode-plywood-3mm-cut");
  });

  it("matches the material case-insensitively", () => {
    const preset = findPreset("baltic birch plywood 3mm", "diode-laser", "cut");
    expect(preset?.id).toBe("diode-plywood-3mm-cut");
  });

  it("returns undefined for a nonsense combination", () => {
    expect(findPreset("Nonexistent Material", "diode-laser", "cut")).toBeUndefined();
  });
});

describe("searchPresets", () => {
  it("returns all presets matching a substring and none that don't match", () => {
    const results = searchPresets("plywood");
    const all = getAllPresets();

    expect(results.length).toBeGreaterThan(0);
    expect(results.every((p) => p.material.toLowerCase().includes("plywood"))).toBe(true);

    const expectedIds = all.filter((p) => p.material.toLowerCase().includes("plywood")).map((p) => p.id);
    expect(results.map((p) => p.id).sort()).toEqual(expectedIds.sort());
  });

  it("is case-insensitive", () => {
    const lower = searchPresets("leather");
    const upper = searchPresets("LEATHER");
    expect(upper.map((p) => p.id).sort()).toEqual(lower.map((p) => p.id).sort());
  });
});
