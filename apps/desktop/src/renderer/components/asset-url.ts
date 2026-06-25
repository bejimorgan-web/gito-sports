// Resolve asset URLs using the shared API base URL from the API client.
import { API_BASE_URL } from "../services/api-client";

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
