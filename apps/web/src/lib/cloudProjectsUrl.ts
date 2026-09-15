export const CLOUD_PROJECTS_URL = (
  (import.meta.env.VITE_CLOUD_PROJECTS_URL as string | undefined) ?? "http://localhost:8790"
).replace(/\/$/, "");
