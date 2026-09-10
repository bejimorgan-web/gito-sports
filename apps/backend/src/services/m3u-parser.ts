import type { ParsedChannel } from "@gito/shared";

export interface M3uParseError {
  rawEntry: string;
  lineNumber: number;
  reason: string;
}

function readAttribute(line: string, name: string): string | undefined {
  const attributePattern = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s,]+))`, "i");
  const match = line.match(attributePattern);
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

function readDisplayName(line: string): string {
  const separator = line.indexOf(",");
  if (separator < 0) {
    return "Unnamed Channel";
  }

  const remainder = line.slice(separator + 1).trim();
  const inlineUrlMatch = remainder.match(/(?:https?|rtmp|rtsp|udp|srt):\/\/\S+/i);

  if (inlineUrlMatch) {
    const beforeUrl = remainder.slice(0, inlineUrlMatch.index).trim();
    return beforeUrl.replace(/,$/, "") || "Unnamed Channel";
  }

  return remainder.replace(/,$/, "") || "Unnamed Channel";
}

function readInlineUrl(line: string): string | undefined {
  const separator = line.indexOf(",");
  if (separator < 0) {
    return undefined;
  }

  const remainder = line.slice(separator + 1).trim();
  const inlineUrlMatch = remainder.match(/(?:https?|rtmp|rtsp|udp|srt):\/\/\S+/i);

  return inlineUrlMatch?.[0];
}

export function parseM3uPlaylist(content: string, onInvalidEntry?: (entry: M3uParseError) => void): ParsedChannel[] {
  const lines = content
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const channels: ParsedChannel[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (!line || !/^#EXTINF\b/i.test(line)) {
      continue;
    }

    // The URL may not be immediately on the next line (some playlists include
    // comments or meta-lines). Scan forward a few lines to find the first
    // non-comment, non-empty line that appears to be the stream URL.
    let url = readInlineUrl(line);
    for (let j = index + 1; j < Math.min(lines.length, index + 6); j += 1) {
      const candidate = lines[j];
      if (/^#EXTINF\b/i.test(candidate ?? "")) break;
      if (candidate && !candidate.startsWith("#") && candidate.length > 0) {
        if (/^(?:https?|rtmp|rtsp|udp|srt):\/\//i.test(candidate)) {
          url ??= candidate;
          break;
        }
      }
    }

    if (!url) {
      onInvalidEntry?.({
        rawEntry: line,
        lineNumber: index + 1,
        reason: "invalid_m3u_entry"
      });
      continue;
    }

    const parsedChannel: ParsedChannel = {
      name: readDisplayName(line),
      url
    };
    const externalRef = readAttribute(line, "tvg-id");
    const groupName = readAttribute(line, "group-title");
    const categoryId = readAttribute(line, "group-id") ?? readAttribute(line, "category-id");
    const declaredContentType = readAttribute(line, "content-type") ?? readAttribute(line, "type");

    if (externalRef) {
      parsedChannel.externalRef = externalRef;
    }

    if (groupName) {
      parsedChannel.groupName = groupName;
    }

    if (categoryId) {
      parsedChannel.categoryId = categoryId;
    }
    if (declaredContentType === "live" || declaredContentType === "movie" || declaredContentType === "series") {
      parsedChannel.contentType = declaredContentType;
    }

    channels.push(parsedChannel);
  }

  return channels;
}
