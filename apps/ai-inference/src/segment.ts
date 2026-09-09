import { callGemini, firstTextPart } from "./gemini-client.js";

export type RgbColor = [number, number, number];

export interface SuggestColorPaletteOptions {
  /** Target number of palette colors. Default 6, clamped to [1, 32]. */
  colorCount?: number;
}

export interface ColorPaletteSuggestion {
  /** Suggested palette, one RGB triple per meaningful color/region Gemini identified. */
  palette: RgbColor[];
  /** Human-readable disclosure of how the palette was produced. */
  notes: string;
}

const DEFAULT_MODEL = "gemini-2.5-flash";
const DEFAULT_COLOR_COUNT = 6;
const MIN_COLOR_COUNT = 1;
const MAX_COLOR_COUNT = 32;

const HEX_COLOR_RE = /^#?([0-9a-f]{6})$/i;

function buildPrompt(colorCount: number): string {
  return (
    "You are assisting a laser cutter / CNC router operator preparing a photo for multi-color " +
    "vector tracing (one cut/engrave layer per color). Look at this image and identify up to " +
    `${colorCount} colors that best separate its distinct subjects/regions — e.g. one color per ` +
    "object, background, or visually distinct area — rather than a purely statistical color " +
    "average. Prefer fewer, more meaningful colors over many similar ones. " +
    'Respond with ONLY a JSON object of the shape {"colors": string[]}, no other text, where each ' +
    'string is a 6-digit hex color code like "#RRGGBB".'
  );
}

interface ParsedPaletteSuggestion {
  colors?: unknown;
}

function hexToRgb(hex: string): RgbColor | undefined {
  const match = HEX_COLOR_RE.exec(hex.trim());
  if (!match) return undefined;
  const value = match[1] as string;
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
}

/**
 * Calls Gemini's multimodal API to propose a small palette of "meaningful"
 * colors for `@maker/core-vector`'s `traceImageColors({ palette })` — a
 * semantic stand-in for the median-cut color quantization that function
 * otherwise falls back to, so multi-color vectorization (ROADMAP.md 5B-4)
 * can separate an image by subject/region rather than pure color statistics.
 * The actual per-pixel labeling and tracing stay entirely client-side and
 * deterministic; this call only ever supplies the palette itself.
 */
export async function suggestColorPalette(
  image: Uint8Array,
  options?: SuggestColorPaletteOptions,
): Promise<ColorPaletteSuggestion> {
  const colorCount = Math.min(
    MAX_COLOR_COUNT,
    Math.max(MIN_COLOR_COUNT, Math.floor(options?.colorCount ?? DEFAULT_COLOR_COUNT)),
  );
  const model = process.env.GEMINI_PALETTE_MODEL || DEFAULT_MODEL;
  const base64 = Buffer.from(image).toString("base64");

  const response = await callGemini(model, {
    contents: [
      {
        parts: [
          { inlineData: { mimeType: "image/png", data: base64 } },
          { text: buildPrompt(colorCount) },
        ],
      },
    ],
    generationConfig: { responseMimeType: "application/json" },
  });

  const raw = firstTextPart(response);
  if (!raw) {
    throw new Error("Gemini response did not include a text part with the palette result");
  }

  let parsed: ParsedPaletteSuggestion;
  try {
    parsed = JSON.parse(raw) as ParsedPaletteSuggestion;
  } catch {
    throw new Error(`Gemini response was not valid JSON: ${raw.slice(0, 200)}`);
  }

  if (!Array.isArray(parsed.colors)) {
    throw new Error('Gemini response did not include a "colors" array');
  }

  const palette: RgbColor[] = [];
  for (const entry of parsed.colors) {
    if (typeof entry !== "string") continue;
    const rgb = hexToRgb(entry);
    if (rgb) palette.push(rgb);
    if (palette.length >= colorCount) break;
  }

  if (palette.length === 0) {
    throw new Error("Gemini response did not include any valid hex colors");
  }

  return {
    palette,
    notes: `Palette suggested by Gemini (model: ${model}).`,
  };
}
