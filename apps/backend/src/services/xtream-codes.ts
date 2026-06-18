import type { ParsedChannel, ProviderConnectionTest } from "@gito/shared";

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
  const url = new URL("player_api.php", baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);

  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));

  return url;
}

export async function testXtreamConnection(
  baseUrl: string,
  username: string,
  password: string
): Promise<ProviderConnectionTest> {
  try {
    const response = await fetch(
      buildUrl(baseUrl, {
        username,
        password
      })
    );

    return {
      ok: response.ok,
      statusCode: response.status,
      message: response.ok ? "Xtream provider responded." : "Xtream provider rejected the request."
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
  const categoriesResponse = await fetch(
    buildUrl(baseUrl, {
      username,
      password,
      action: "get_live_categories"
    })
  );
  const streamsResponse = await fetch(
    buildUrl(baseUrl, {
      username,
      password,
      action: "get_live_streams"
    })
  );

  if (!categoriesResponse.ok || !streamsResponse.ok) {
    throw new Error("Xtream channel extraction failed.");
  }

  const categories = (await categoriesResponse.json()) as XtreamCategory[];
  const streams = (await streamsResponse.json()) as XtreamStream[];
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
