const API_BASE_URL = (import.meta.env.VITE_GITO_API_BASE_URL ?? "http://localhost:4100").replace(/\/$/, "");

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
