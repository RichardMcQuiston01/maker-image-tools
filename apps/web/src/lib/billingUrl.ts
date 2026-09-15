export const BILLING_URL = (
  (import.meta.env.VITE_BILLING_URL as string | undefined) ?? "http://localhost:8789"
).replace(/\/$/, "");
