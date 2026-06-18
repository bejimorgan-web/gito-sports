export function validateHttpStreamUrl(value: string): string | null {
  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    return "stream_url_malformed";
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return "stream_url_protocol_unsupported";
  }

  return null;
}
