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

function inferContentType(url: string, groupName?: string): ParsedChannel["contentType"] {
  try {
    const path = new URL(url).pathname.toLowerCase();
    if (/(^|\/)movie(\/|$)/.test(path)) return "movie";
    if (/(^|\/)series(\/|$)/.test(path)) return "series";
    if (/(^|\/)live(\/|$)/.test(path)) return "live";
  } catch {
    // Fall through to playlist metadata for non-URL entries.
  }

  const normalizedGroup = groupName?.toLowerCase() ?? "";
  if (/\b(movie|movies|vod|video on demand)\b/.test(normalizedGroup)) return "movie";
  if (/\b(series|serials|shows|tv series)\b/.test(normalizedGroup)) return "series";
  if (/\b(live|live tv|channels?)\b/.test(normalizedGroup)) return "live";
  return "live";
}

function readNumberAttribute(line: string, ...names: string[]): number | undefined {
  for (const name of names) {
    const raw = readAttribute(line, name);
    if (raw === undefined) continue;
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
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

    const externalRef = readAttribute(line, "tvg-id");
    const tvgName = readAttribute(line, "tvg-name");
    const groupName = readAttribute(line, "group-title");
    const logoUrl = readAttribute(line, "tvg-logo");
    const categoryId = readAttribute(line, "group-id") ?? readAttribute(line, "category-id");
    const declaredContentType = readAttribute(line, "content-type") ?? readAttribute(line, "type");
    const seriesExternalRef = readAttribute(line, "series-id") ?? readAttribute(line, "series_id");
    const seriesName = readAttribute(line, "series-name") ?? readAttribute(line, "series_name");
    const parsedChannel: ParsedChannel = {
      name: readDisplayName(line),
      url,
      contentType: inferContentType(url, groupName)
    };

    if (externalRef) {
      parsedChannel.externalRef = externalRef;
    }

    if (tvgName) {
      parsedChannel.tvgName = tvgName;
    }

    if (groupName) {
      parsedChannel.groupName = groupName;
    }

    if (logoUrl) {
      parsedChannel.logoUrl = logoUrl;
    }

    if (categoryId) {
      parsedChannel.categoryId = categoryId;
    }
    if (declaredContentType === "live" || declaredContentType === "movie" || declaredContentType === "series") {
      parsedChannel.contentType = declaredContentType;
    }

    const resolvedSeriesExternalRef = seriesExternalRef ?? (parsedChannel.contentType === "series" ? groupName : undefined);
    if (resolvedSeriesExternalRef) parsedChannel.seriesExternalRef = resolvedSeriesExternalRef;
    if (seriesName) parsedChannel.seriesName = seriesName;
    const seasonNumber = readNumberAttribute(line, "season-number", "season", "season_num");
    const episodeNumber = readNumberAttribute(line, "episode-number", "episode", "episode-num", "episode_num");
    if (seasonNumber !== undefined) parsedChannel.seasonNumber = seasonNumber;
    if (episodeNumber !== undefined) parsedChannel.episodeNumber = episodeNumber;

    channels.push(parsedChannel);
  }

  return channels;
}
