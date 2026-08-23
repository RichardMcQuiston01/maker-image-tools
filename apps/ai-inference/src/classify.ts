import { searchPresets, type MaterialPreset } from "@maker/material-library";

export interface MaterialClassification {
  /** Best-guess material name, or "unknown" while no real classifier is wired up. */
  material: string;
  /** Confidence in [0, 1]. Always 0 in stub mode. */
  confidence: number;
  /** Human-readable explanation of the result (notably: stub-mode disclosure). */
  notes: string;
  /** Material-library presets whose material name matches the classification, if any. */
  matchedPresets: MaterialPreset[];
}

/**
 * ROADMAP.md 5B-1 calls for a classifier trained on real burn data, which
 * doesn't exist yet. This stub keeps the request/response contract (and the
 * settings-mapping step below it) stable so a real hosted vision-model call
 * can be dropped in behind this same function signature later, without
 * touching the server or client integration. It deliberately reports
 * "unknown" at zero confidence rather than a plausible-looking guess.
 */
export async function classifyMaterial(_image: Uint8Array): Promise<MaterialClassification> {
  const material = "unknown";
  return {
    material,
    confidence: 0,
    notes:
      "Stub classifier: no vision model is wired up yet. Replace classifyMaterial() with a call " +
      "to a hosted vision-capable API to enable real material detection.",
    matchedPresets: searchPresets(material),
  };
}
