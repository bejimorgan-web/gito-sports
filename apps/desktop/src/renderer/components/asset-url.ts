// Use standardized `VITE_API_URL` when available, fall back to the older
// `VITE_GITO_API_BASE_URL` for backwards compatibility, then localhost.
// NOTE: keep this a plain string — don't join parts which can produce
// incorrect values like "httplocalhost:4100".
const DEV_API_BASE_URL = "http://localhost:4100";
const API_BASE_URL = (
  (import.meta.env.VITE_API_URL as string | undefined) ??
  (import.meta.env.VITE_GITO_API_BASE_URL as string | undefined) ??
  ((import.meta as any).env?.MODE === "production" ? "https://gito-sports.onrender.com" : DEV_API_BASE_URL)
).replace(/\/$/, "");

export function resolveAssetUrl(value?: string) {
  if (!value?.trim()) return "";

  const trimmed = value.trim();

  // Data URIs and absolute URLs: return as-is
  if (trimmed.startsWith("data:image/")) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;

  // Normalize upload paths returned by the backend. Accept both
  // "/uploads/..." and "uploads/..." and ensure we prefix the API base.
  if (trimmed.startsWith("/uploads/") || trimmed.startsWith("uploads/")) {
    const path = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
    return `${API_BASE_URL}${path}`;
  }

  // Local app assets (bundled in `public/` or served at project root) —
  // normalize usages like "./assets/foo.png" or "assets/foo.png" to
  // absolute root paths so Vite/Electron can load them consistently.
  if (trimmed.startsWith("./assets/") || trimmed.startsWith("assets/")) {
    return `/${trimmed.replace(/^\.\//, "")}`;
  }

  // Fallback: return the original string — it may already be a usable path
  return trimmed;
}
