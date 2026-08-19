import type { ParsedChannel, ProviderConnectionTest } from "@gito/shared";

export function buildXtreamEndpointCandidates(baseUrl: string) {
  const normalizedBase = baseUrl.trim();
  if (!normalizedBase) {
    return [];
  }

  const trimmed = normalizedBase.replace(/\/$/, "");
  const candidates = new Set<string>();

  if (!trimmed) {
    return [];
  }

  candidates.add(trimmed);
  candidates.add(`${trimmed}/player_api.php`);
  candidates.add(`${trimmed}/api.php`);
  candidates.add(`${trimmed}/get.php`);
  candidates.add(`${trimmed}/xmltv.php`);

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
  password: string
): Promise<ProviderConnectionTest> {
  try {
    const endpointCandidates = buildXtreamEndpointCandidates(baseUrl);
    const responses = await Promise.allSettled(
      endpointCandidates.map((candidate) =>
        fetch(
          buildUrl(candidate, {
            username,
            password
          })
        )
      )
    );

    const successful = responses.find(
      (response): response is PromiseFulfilledResult<Response> => response.status === "fulfilled" && response.value.ok
    );

    if (successful) {
      return {
        ok: true,
        statusCode: successful.value.status,
        message: "Xtream provider responded."
      };
    }

    const lastFailure = responses[responses.length - 1];
    const fallbackStatus = lastFailure?.status === "fulfilled" ? lastFailure.value.status : undefined;

    return {
      ok: false,
      statusCode: fallbackStatus,
      message: "Xtream provider rejected the request."
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Provider connection failed."
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
      fetch(
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
      fetch(
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
