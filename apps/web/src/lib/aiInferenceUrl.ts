export const AI_INFERENCE_URL = (
  (import.meta.env.VITE_AI_INFERENCE_URL as string | undefined) ?? "http://localhost:8787"
).replace(/\/$/, "");

/** Reads a failed fetch response's `{ error }` body, falling back to a generic message with its
 * status if the body isn't JSON - shared by every panel that calls @maker/ai-inference's
 * Gemini-backed routes, so a quota-exceeded or auth error's real message reaches the user instead
 * of just a bare status code. */
export async function readAiInferenceErrorMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error.length > 0) return body.error;
  } catch {
    // Body wasn't JSON - fall through to the generic message below.
  }
  return `${fallback} with ${response.status}`;
}
