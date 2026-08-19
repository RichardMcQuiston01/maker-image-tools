import { MATERIAL_PRESETS } from "./presets.js";
import type { MachineType, MaterialOperation, MaterialPreset } from "./types.js";

/** Returns a fresh copy of every bundled preset; safe for callers to mutate. */
export function getAllPresets(): MaterialPreset[] {
  return [...MATERIAL_PRESETS];
}

/** Unique `material` values across all presets, sorted alphabetically. */
export function listMaterials(): string[] {
  return [...new Set(MATERIAL_PRESETS.map((p) => p.material))].sort((a, b) => a.localeCompare(b));
}

/** Unique `machineType` values present in the bundled data. */
export function listMachineTypes(): MachineType[] {
  return [...new Set(MATERIAL_PRESETS.map((p) => p.machineType))];
}

/** Presets whose `material` matches the given name exactly, case-insensitively. */
export function getPresetsForMaterial(material: string): MaterialPreset[] {
  const needle = material.toLowerCase();
  return MATERIAL_PRESETS.filter((p) => p.material.toLowerCase() === needle);
}

/** Presets for a given machine type. */
export function getPresetsForMachine(machineType: MachineType): MaterialPreset[] {
  return MATERIAL_PRESETS.filter((p) => p.machineType === machineType);
}

/** The single preset matching material (case-insensitive), machine type, and operation. */
export function findPreset(
  material: string,
  machineType: MachineType,
  operation: MaterialOperation,
): MaterialPreset | undefined {
  const needle = material.toLowerCase();
  return MATERIAL_PRESETS.find(
    (p) =>
      p.material.toLowerCase() === needle &&
      p.machineType === machineType &&
      p.operation === operation,
  );
}

/** Presets whose `material` contains the given substring, case-insensitively. */
export function searchPresets(query: string): MaterialPreset[] {
  const needle = query.toLowerCase();
  return MATERIAL_PRESETS.filter((p) => p.material.toLowerCase().includes(needle));
}
