export type DetectedProviderType = "m3u" | "xtream" | "manual";

export type XtreamCredentialHint = {
  serverUrl: string;
  username: string;
  password: string;
};
export function deriveXtreamCredentialHint(baseUrl: string, username?: string, password?: string): XtreamCredentialHint | undefined {
  try {
    const url = new URL(baseUrl.trim());
    const queryUsername = url.searchParams.get("username") ?? url.searchParams.get("user");
    const queryPassword = url.searchParams.get("password") ?? url.searchParams.get("pass");
    const resolvedUsername = username?.trim() || queryUsername?.trim();
    const resolvedPassword = password || queryPassword || undefined;
    if (!resolvedUsername || !resolvedPassword) return undefined;
    const serverPath = url.pathname.replace(/\/(?:get|player_api|api)\.php$/i, "").replace(/\/+$/, "");
    return {
      serverUrl: `${url.origin}${serverPath}`,
      username: resolvedUsername,
      password: resolvedPassword
    };
  } catch {
    return undefined;
  }
}
function looksLikeXtreamBaseUrl(baseUrl: string) {
  const normalized = baseUrl.trim().toLowerCase();
  return /(^|\/)(player_api\.php|get\.php|api\.php|xmltv\.php|xtream)([/?#]|$)/.test(normalized);
}

function looksLikeM3uBaseUrl(baseUrl: string) {
  const normalized = baseUrl.trim().toLowerCase();
  return /\.m3u(8)?($|\?)/.test(normalized) || normalized.includes("playlist") || normalized.includes("m3u");
}

function looksLikeXtreamPayload(payload: string) {
  const normalized = payload.trim().toLowerCase();
  return /\b(player_api|get_live_categories|get_live_streams|user_info|server_info|streams|categories)\b/.test(normalized);
}

export async function detectProviderType(input: {
  baseUrl?: string;
  username?: string;
  password?: string;
  payload?: string;
}): Promise<DetectedProviderType> {
  const baseUrl = input.baseUrl?.trim() ?? "";
  const payload = input.payload?.trim() ?? "";

  if (looksLikeXtreamBaseUrl(baseUrl) || (input.username && input.password && /xtream|player_api|api\.php/i.test(baseUrl))) {
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
