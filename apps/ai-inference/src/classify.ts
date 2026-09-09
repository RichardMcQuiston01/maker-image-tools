import { listMaterials, searchPresets, type MaterialPreset } from "@maker/material-library";
import { callGemini, firstTextPart } from "./gemini-client.js";

export interface MaterialClassification {
  /** Best-guess material name. */
  material: string;
  /** Confidence in [0, 1]. */
  confidence: number;
  /** Human-readable explanation of the result. */
  notes: string;
  /** Material-library presets whose material name matches the classification, if any. */
  matchedPresets: MaterialPreset[];
}

const DEFAULT_MODEL = "gemini-2.5-flash";

function buildPrompt(): string {
  const known = listMaterials();
  return (
    "You are assisting a laser cutter / CNC router operator. Identify the single most likely " +
    "physical material shown in this image (e.g. plywood, acrylic, leather, cardboard, aluminum, " +
    "MDF). If it closely matches one of these known materials, respond with that exact name: " +
    `${known.join(", ")}. Otherwise give your own concise best guess (a few words). ` +
    'Respond with ONLY a JSON object of the shape {"material": string, "confidence": number}, ' +
    "no other text, where confidence is your certainty from 0 to 1."
  );
}

interface ParsedClassification {
  material?: unknown;
  confidence?: unknown;
}

/**
 * Calls Gemini's multimodal API with the uploaded image (PNG bytes, as sent
 * by the browser client) and a prompt steering it toward the material-library
 * vocabulary, so the result can be matched back to real cut/engrave presets.
 */
export async function classifyMaterial(image: Uint8Array): Promise<MaterialClassification> {
  const model = process.env.GEMINI_CLASSIFY_MODEL || DEFAULT_MODEL;
  const base64 = Buffer.from(image).toString("base64");

  const response = await callGemini(model, {
    contents: [
      {
        parts: [{ inlineData: { mimeType: "image/png", data: base64 } }, { text: buildPrompt() }],
      },
    ],
    generationConfig: { responseMimeType: "application/json" },
  });

  const raw = firstTextPart(response);
  if (!raw) {
    throw new Error("Gemini response did not include a text part with the classification result");
  }

  let parsed: ParsedClassification;
  try {
    parsed = JSON.parse(raw) as ParsedClassification;
  } catch {
    throw new Error(`Gemini response was not valid JSON: ${raw.slice(0, 200)}`);
  }

  const material =
    typeof parsed.material === "string" && parsed.material.length > 0 ? parsed.material : "unknown";
  const confidence =
    typeof parsed.confidence === "number" && Number.isFinite(parsed.confidence)
      ? Math.min(1, Math.max(0, parsed.confidence))
      : 0;

  return {
    material,
    confidence,
    notes: `Classified by Gemini (model: ${model}).`,
    matchedPresets: searchPresets(material),
  };
}
