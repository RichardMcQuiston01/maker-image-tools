export const MATERIAL_DB_URL = (
  (import.meta.env.VITE_MATERIAL_DB_URL as string | undefined) ?? "http://localhost:8791"
).replace(/\/$/, "");
