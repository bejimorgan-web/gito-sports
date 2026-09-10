import type { ParsedChannel, ProviderConnectionTest } from "@gito/shared";

/**
 * Normalize an Xtream server URL to standard form.
 * Handles:
 * - http://host:port
 * - https://host:port
 * - http://host:port/player_api.php (strips redundant path)
 * - Validates protocol is HTTP or HTTPS
 * - Strips trailing slashes
 */
export function normalizeXtreamUrl(baseUrl: string): { url: string; error?: string } {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    return { url: "", error: "URL cannot be empty." };
  }

  // Simple protocol check - must start with http:// or https://
  if (!/^https?:\/\//i.test(trimmed)) {
    return { url: "", error: "Enter a valid HTTP/HTTPS Xtream server URL." };
  }

  try {
    const url = new URL(trimmed);

    // Validate protocol
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { url: "", error: "Enter a valid HTTP/HTTPS Xtream server URL." };
    }

    // Preserve legitimate installation subpaths, but remove a supplied API filename.
    const pathname = url.pathname
      .replace(/\/(?:player_api|api|get)\.php$/i, "")
      .replace(/\/+$/, "");
    const baseWithoutPath = `${url.origin}${pathname}`;

    return { url: baseWithoutPath };
  } catch {
    return { url: "", error: "Enter a valid HTTP/HTTPS Xtream server URL." };
  }
}

export function buildXtreamEndpointCandidates(baseUrl: string) {
  const trimmed = baseUrl.trim().replace(/\/$/, "");
  if (!trimmed) {
    return [];
  }

  const candidates = new Set<string>();
  candidates.add(trimmed);
  candidates.add(`${trimmed}/player_api.php`);
  candidates.add(`${trimmed}/api.php`);
  candidates.add(`${trimmed}/get.php`);

  if (/player_api\.php$/i.test(trimmed)) {
    candidates.add(trimmed);
  }

  if (/get\.php$/i.test(trimmed)) {
    candidates.add(trimmed);
  }

  return Array.from(candidates);
}

interface XtreamCategory {
  category_id: string;
  category_name: string;
}

interface XtreamStream {
  name: string;
  stream_id: number;
  category_id?: string;
}

export async function fetchWithTimeout(input: string | URL, init: RequestInit = {}, timeoutMs = 15_000) {
  const controller = new AbortController();
  const externalSignal = init.signal;
  const abortFromExternal = () => controller.abort();
  externalSignal?.addEventListener("abort", abortFromExternal, { once: true });
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abortFromExternal);
  }
}

export async function readResponseTextWithTimeout(response: Response, timeoutMs = 15_000, signal?: AbortSignal): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abortHandler: (() => void) | undefined;
  const body = response.text();
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DOMException("Response body timed out", "TimeoutError")), timeoutMs);
    abortHandler = () => reject(new DOMException("Response body aborted", "AbortError"));
    signal?.addEventListener("abort", abortHandler, { once: true });
  });

  try {
    return await Promise.race([body, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
    if (abortHandler) signal?.removeEventListener("abort", abortHandler);
  }
}

export async function fetchTextWithTimeout(input: string | URL, init: RequestInit = {}, timeoutMs = 15_000) {
  const controller = new AbortController();
  const externalSignal = init.signal;
  const abortFromExternal = () => controller.abort();
  externalSignal?.addEventListener("abort", abortFromExternal, { once: true });
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    const text = await response.text();
    return { response, text };
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abortFromExternal);
  }
}

async function fetchJsonWithTimeout(input: string | URL, init: RequestInit = {}, timeoutMs = 15_000) {
  const result = await fetchTextWithTimeout(input, init, timeoutMs);
  if (!result.text.trim()) {
    return { response: result.response, payload: null, parseError: false };
  }

  try {
    return { response: result.response, payload: JSON.parse(result.text), parseError: false };
  } catch {
    return { response: result.response, payload: null, parseError: true };
  }
}

function buildUrl(baseUrl: string, params: Record<string, string>) {
  const normalizedBase = baseUrl.trim().replace(/\/$/, "");
  const candidateBase = normalizedBase.endsWith("/player_api.php") || normalizedBase.endsWith("/get.php") || normalizedBase.endsWith("/api.php")
    ? normalizedBase
    : `${normalizedBase}/player_api.php`;
  const url = new URL(candidateBase);

  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));

  return url;
}

export async function testXtreamConnection(
  baseUrl: string,
  username: string,
  password: string,
  signal?: AbortSignal
): Promise<ProviderConnectionTest> {
  // First validate and normalize the URL
  const urlResult = normalizeXtreamUrl(baseUrl);
  if (urlResult.error) {
    return {
      ok: false,
      message: urlResult.error,
      statusCode: 400
    };
  }

  const normalizedUrl = urlResult.url;

  try {
    const endpointCandidates = buildXtreamEndpointCandidates(normalizedUrl);
    if (endpointCandidates.length === 0) {
      return {
        ok: false,
        message: "Could not build valid Xtream endpoints.",
        statusCode: 400
      };
    }

    const responses = await Promise.allSettled(
      endpointCandidates.map((candidate) =>
        fetchJsonWithTimeout(
          buildUrl(candidate, {
            username,
            password
          }),
          { signal }
        )
      )
    );

    // Look for successful response
    let malformedResponse = false;
    for (const response of responses) {
      if (response.status !== "fulfilled" || !response.value.response.ok) {
        continue;
      }

      try {
        const payload = response.value.payload;
        if (payload && typeof payload === "object" && !Array.isArray(payload)) {
          return {
            ok: true,
            statusCode: response.value.response.status,
            message: "Connected — credentials accepted."
          };
        }
        malformedResponse = malformedResponse || response.value.parseError;
      } catch {
        malformedResponse = true;
      }
    }

    // Classify the failure by examining responses
    let authFailureCount = 0;
    let networkFailureCount = 0;
    let timeoutFailureCount = 0;
    let lastStatusCode: number | undefined;

    for (const response of responses) {
      if (response.status === "fulfilled") {
        const status = response.value.response.status;
        lastStatusCode = status;

        if (status === 401 || status === 403) {
          authFailureCount++;
        }
      } else if (response.status === "rejected") {
        const reason = response.reason;
        const errorMessage = String(reason);

        if (errorMessage.includes("AbortError") || errorMessage.includes("timeout")) {
          timeoutFailureCount++;
        } else if (
          errorMessage.includes("ENOTFOUND") ||
          errorMessage.includes("ECONNREFUSED") ||
          errorMessage.includes("Failed host lookup") ||
          errorMessage.includes("network")
        ) {
          networkFailureCount++;
        }
      }
    }

    // Return classified error
    if (timeoutFailureCount > 0) {
      return {
        ok: false,
        statusCode: 408,
        message: "The provider did not respond within the allowed time."
      };
    }

    if (networkFailureCount > 0 || responses.every((r) => r.status === "rejected")) {
      return {
        ok: false,
        statusCode: 503,
        message: "GiTO could not reach the provider server."
      };
    }

    if (authFailureCount > 0 || lastStatusCode === 401 || lastStatusCode === 403) {
      return {
        ok: false,
        statusCode: lastStatusCode ?? 401,
        message: "Username or password was rejected by the provider."
      };
    }

    if (malformedResponse) {
      return {
        ok: false,
        statusCode: lastStatusCode ?? 502,
        message: "Xtream provider returned an invalid response."
      };
    }

    // Generic provider error
    return {
      ok: false,
      statusCode: lastStatusCode ?? 500,
      message: "Xtream provider returned an error."
    };
  } catch (error) {
    // Network or system error
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (errorMessage.includes("AbortError") || errorMessage.includes("timeout")) {
      return {
        ok: false,
        statusCode: 408,
        message: "The provider did not respond within the allowed time."
      };
    }

    if (
      errorMessage.includes("ENOTFOUND") ||
      errorMessage.includes("ECONNREFUSED") ||
      errorMessage.includes("Failed host lookup")
    ) {
      return {
        ok: false,
        statusCode: 503,
        message: "GiTO could not reach the provider server."
      };
    }

    return {
      ok: false,
      statusCode: 500,
      message: "GiTO could not validate this provider."
    };
  }
}

export interface XtreamParseError {
  rawEntry: XtreamStream;
  reason: string;
}

export async function fetchXtreamChannels(
  baseUrl: string,
  username: string,
  password: string,
  onInvalidStream?: (entry: XtreamParseError) => void
): Promise<ParsedChannel[]> {
  const endpointCandidates = buildXtreamEndpointCandidates(baseUrl);
  const categoryResponses = await Promise.allSettled(
    endpointCandidates.map((candidate) =>
      fetchWithTimeout(
        buildUrl(candidate, {
          username,
          password,
          action: "get_live_categories"
        })
      )
    )
  );

  const streamsResponses = await Promise.allSettled(
    endpointCandidates.map((candidate) =>
      fetchWithTimeout(
        buildUrl(candidate, {
          username,
          password,
          action: "get_live_streams"
        })
      )
    )
  );

  const categoriesResponse = categoryResponses.find((result) => result.status === "fulfilled" && result.value.ok);
  const streamsResponse = streamsResponses.find((result) => result.status === "fulfilled" && result.value.ok);

  if (!categoriesResponse || !streamsResponse) {
    throw new Error("Xtream channel extraction failed.");
  }

  const resolvedCategoriesResponse = categoriesResponse.status === "fulfilled" ? categoriesResponse.value : null;
  const resolvedStreamsResponse = streamsResponse.status === "fulfilled" ? streamsResponse.value : null;

  if (!resolvedCategoriesResponse || !resolvedStreamsResponse) {
    throw new Error("Xtream channel extraction failed.");
  }

  const categoriesResponseData = resolvedCategoriesResponse;
  const streamsResponseData = resolvedStreamsResponse;

  if (!categoriesResponseData.ok || !streamsResponseData.ok) {
    throw new Error("Xtream channel extraction failed.");
  }

  const categories = (await categoriesResponseData.json()) as XtreamCategory[];
  const streams = (await streamsResponseData.json()) as XtreamStream[];
  const categoryNames = new Map(categories.map((category) => [category.category_id, category.category_name]));
  const streamBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;

  return streams.flatMap((stream) => {
    if (!stream.stream_id || !stream.name) {
      onInvalidStream?.({ rawEntry: stream, reason: "invalid_xtream_stream" });
      return [];
    }

    const groupName = stream.category_id ? categoryNames.get(stream.category_id) : undefined;
    const channel: ParsedChannel = {
      name: stream.name,
      externalRef: String(stream.stream_id),
      url: `${streamBase}/live/${username}/${password}/${stream.stream_id}.m3u8`
    };

    if (groupName) {
      channel.groupName = groupName;
    }

    return [channel];
  });
}
