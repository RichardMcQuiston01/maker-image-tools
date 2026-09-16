export const COMMUNITY_LIBRARY_URL = (
  (import.meta.env.VITE_COMMUNITY_LIBRARY_URL as string | undefined) ?? "http://localhost:8792"
).replace(/\/$/, "");
