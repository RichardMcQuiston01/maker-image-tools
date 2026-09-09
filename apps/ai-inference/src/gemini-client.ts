/**
 * Minimal client for Google's Gemini API (https://ai.google.dev), used to back
 * both /classify-material (vision) and /generate-image (image generation).
 * Plain `fetch` against the REST endpoint rather than the official SDK, to
 * avoid pulling in a heavyweight dependency for what's a single JSON POST.
 */

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_TIMEOUT_MS = 30_000;

/** Thrown when GEMINI_API_KEY is missing/blank — a deployment misconfiguration, not a bad request. */
export class GeminiConfigError extends Error {}

/** Thrown when the Gemini API itself returns a non-2xx response or an unusable body. */
export class GeminiApiError extends Error {}

function getApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key || key.trim().length === 0) {
    throw new GeminiConfigError(
      "Missing GEMINI_API_KEY environment variable. Set it to a Google AI Studio API key " +
        "(https://aistudio.google.com/apikey) to enable real Gemini-backed inference.",
    );
  }
  return key;
}

export interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}

export interface GeminiGenerateContentRequest {
  contents: Array<{ role?: string; parts: GeminiPart[] }>;
  generationConfig?: Record<string, unknown>;
}

export interface GeminiGenerateContentResponse {
  candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
}

export async function callGemini(
  model: string,
  request: GeminiGenerateContentRequest,
  options?: { timeoutMs?: number },
): Promise<GeminiGenerateContentResponse> {
  const apiKey = getApiKey();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(
      `${GEMINI_API_BASE}/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      },
    );
    const text = await response.text();
    if (!response.ok) {
      throw new GeminiApiError(
        `Gemini API request to model "${model}" failed with status ${response.status}: ${text.slice(0, 500)}`,
      );
    }
    try {
      return JSON.parse(text) as GeminiGenerateContentResponse;
    } catch {
      throw new GeminiApiError(`Gemini API returned a non-JSON response: ${text.slice(0, 500)}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

/** First text part of the first candidate, if any. */
export function firstTextPart(response: GeminiGenerateContentResponse): string | undefined {
  return response.candidates?.[0]?.content?.parts?.find(
    (part): part is { text: string } => typeof part.text === "string",
  )?.text;
}

/** First inline-image part (base64 data + mime type) of the first candidate, if any. */
export function firstInlineImagePart(
  response: GeminiGenerateContentResponse,
): { mimeType: string; data: string } | undefined {
  return response.candidates?.[0]?.content?.parts?.find((part) => part.inlineData !== undefined)
    ?.inlineData;
}
