import type { ParsedChannel } from "@gito/shared";

export interface M3uParseError {
  rawEntry: string;
  lineNumber: number;
  reason: string;
}

function readAttribute(line: string, name: string): string | undefined {
  const match = line.match(new RegExp(`${name}="([^"]*)"`));
  return match?.[1];
}

function readDisplayName(line: string): string {
  const commaIndex = line.lastIndexOf(",");
  return commaIndex >= 0 ? line.slice(commaIndex + 1).trim() : "Unnamed Channel";
}

export function parseM3uPlaylist(content: string, onInvalidEntry?: (entry: M3uParseError) => void): ParsedChannel[] {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const channels: ParsedChannel[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (!line?.startsWith("#EXTINF")) {
      continue;
    }

    // The URL may not be immediately on the next line (some playlists include
    // comments or meta-lines). Scan forward a few lines to find the first
    // non-comment, non-empty line that appears to be the stream URL.
    let url: string | undefined;
    for (let j = index + 1; j < Math.min(lines.length, index + 6); j += 1) {
      const candidate = lines[j];
      if (candidate && !candidate.startsWith("#") && candidate.length > 0) {
        url = candidate;
        break;
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

    if (externalRef) {
      parsedChannel.externalRef = externalRef;
    }

    if (groupName) {
      parsedChannel.groupName = groupName;
    }

    channels.push(parsedChannel);
  }

  return channels;
}
