// Use standardized `VITE_API_URL` when available, fall back to the older
// `VITE_GITO_API_BASE_URL` for backwards compatibility, then localhost.
const DEV_API_BASE_URL = ["http://", "localhost", ":4100"].join("");
const API_BASE_URL = ((import.meta.env.VITE_API_URL as string | undefined) ?? (import.meta.env.VITE_GITO_API_BASE_URL as string | undefined) ?? ((import.meta as any).env?.MODE === "production" ? "https://gito-sports.onrender.com" : DEV_API_BASE_URL)).replace(/\/$/, "");

export function resolveAssetUrl(value?: string) {
  if (!value?.trim()) {
    return "";
  }

  const trimmed = value.trim();

  if (trimmed.startsWith("data:image/")) {
    return trimmed;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  if (trimmed.startsWith("/uploads/")) {
    return `${API_BASE_URL}${trimmed}`;
  }

  return trimmed;
}
