export type DetectedProviderType = "m3u" | "xtream" | "manual";

function looksLikeXtreamBaseUrl(baseUrl: string) {
  const normalized = baseUrl.trim().toLowerCase();
  return /(^|\/)(player_api\.php|get\.php|api\.php|xmltv\.php|xtream)(\/|$)/.test(normalized);
}

function looksLikeM3uBaseUrl(baseUrl: string) {
  const normalized = baseUrl.trim().toLowerCase();
  return /\.m3u(8)?($|\?)/.test(normalized) || normalized.includes("playlist") || normalized.includes("m3u");
}

function looksLikeXtreamPayload(payload: string) {
  const normalized = payload.trim().toLowerCase();
  return /(player_api|get_live_categories|get_live_streams|user_info|server_info|streams|categories)/.test(normalized);
}

export async function detectProviderType(input: {
  baseUrl?: string;
  username?: string;
  password?: string;
  payload?: string;
}): Promise<DetectedProviderType> {
  const baseUrl = input.baseUrl?.trim() ?? "";
  const payload = input.payload?.trim() ?? "";

  if (looksLikeXtreamBaseUrl(baseUrl) || (input.username && input.password && /xtream|player_api|get\.php|api\.php/i.test(baseUrl))) {
    return "xtream";
  }

  if (payload.includes("#EXTM3U") || looksLikeM3uBaseUrl(baseUrl)) {
    return "m3u";
  }

  if (looksLikeXtreamPayload(payload) && (input.username || input.password)) {
    return "xtream";
  }

  return "manual";
}
