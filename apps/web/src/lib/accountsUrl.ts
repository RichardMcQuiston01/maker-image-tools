export const ACCOUNTS_URL = (
  (import.meta.env.VITE_ACCOUNTS_URL as string | undefined) ?? "http://localhost:8788"
).replace(/\/$/, "");
