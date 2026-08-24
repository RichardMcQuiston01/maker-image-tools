export const AI_INFERENCE_URL = (
  (import.meta.env.VITE_AI_INFERENCE_URL as string | undefined) ?? "http://localhost:8787"
).replace(/\/$/, "");
