export function validateHttpStreamUrl(value: string): string | null {
  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    return "stream_url_malformed";
  }

  const supportedProtocols = new Set(["http:", "https:", "rtmp:", "rtsp:", "udp:", "srt:"]);
  if (!supportedProtocols.has(parsed.protocol)) {
    return "stream_url_protocol_unsupported";
  }

  return null;
}
