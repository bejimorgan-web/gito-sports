export interface ParsedFeedItem {
  title: string;
  url: string;
  externalId: string;
  summary?: string | null;
  body?: string | null;
  contentAvailability: "full_feed_content" | "summary_only" | "no_content";
  publishedAt?: string | null;
  author?: string | null;
  categories: string[];
  media: Array<{ mediaType: "image" | "video"; url: string; altText?: string | null }>;
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractTagContent(content: string, tagName: string): string | null {
  const pattern = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i");
  const match = content.match(pattern);
  if (!match?.[1]) {
    return null;
  }
  return decodeXml(match[1]).trim();
}

function extractAttribute(content: string, tagName: string, attributeName: string): string | null {
  const pattern = new RegExp(`<${tagName}\\b[^>]*\\b${attributeName}=["']([^"']+)["'][^>]*>`, "i");
  const match = content.match(pattern);
  return match?.[1] ? decodeXml(match[1]).trim() : null;
}

function extractMediaUrl(content: string, tagName: string): string | null {
  return extractAttribute(content, tagName, "url");
}

function extractMedia(content: string): Array<{ mediaType: "image" | "video"; url: string; altText?: string | null }> {
  const media: Array<{ mediaType: "image" | "video"; url: string; altText?: string | null }> = [];
  const add = (mediaType: "image" | "video", url: string | null) => {
    const normalized = url?.trim();
    if (normalized && !media.some((entry) => entry.url === normalized)) {
      media.push({ mediaType, url: normalized });
    }
  };

  for (const match of content.matchAll(/<media:content\b([^>]*)>/gi)) {
    const attributes = match[1] ?? "";
    const url = attributes.match(/\burl=["']([^"']+)["']/i)?.[1] ?? null;
    const type = attributes.match(/\btype=["']([^"']+)["']/i)?.[1] ?? "";
    const medium = attributes.match(/\bmedium=["']([^"']+)["']/i)?.[1] ?? "";
    add(type.toLowerCase().startsWith("video") || medium.toLowerCase() === "video" ? "video" : "image", url ? decodeXml(url) : null);
  }

  for (const match of content.matchAll(/<enclosure\b([^>]*)\/?\s*>/gi)) {
    const attributes = match[1] ?? "";
    const url = attributes.match(/\burl=["']([^"']+)["']/i)?.[1] ?? null;
    const type = attributes.match(/\btype=["']([^"']+)["']/i)?.[1] ?? "";
    add(type.toLowerCase().startsWith("video") ? "video" : "image", url ? decodeXml(url) : null);
  }

  add("image", extractMediaUrl(content, "media:thumbnail"));
  add("image", extractMediaUrl(content, "media:image"));
  add("image", extractMediaUrl(content, "image"));
  const nestedImageUrl = content.match(/<image\b[^>]*>[\s\S]*?<url\b[^>]*>([\s\S]*?)<\/url>/i)?.[1];
  add("image", nestedImageUrl ? decodeXml(nestedImageUrl).trim() : null);

  return media.sort((left, right) => Number(right.mediaType === "image") - Number(left.mediaType === "image"));
}

function extractLink(content: string): string | null {
  const hrefPattern = /<link\b[^>]*href=["']([^"']+)["'][^>]*>/i;
  const hrefMatch = content.match(hrefPattern);
  if (hrefMatch?.[1]) {
    return decodeXml(hrefMatch[1]).trim();
  }

  const contentPattern = /<link\b[^>]*>([^<]+)<\/link>/i;
  const contentMatch = content.match(contentPattern);
  if (contentMatch?.[1]) {
    return decodeXml(contentMatch[1]).trim();
  }

  return null;
}

function normalizeExternalId(value: string | null | undefined): string {
  const normalized = (value ?? "").trim();
  return normalized.length > 0 ? normalized : "unknown";
}

function normalizeDate(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

export function parseFeedItems(xml: string, fallbackUrl: string): ParsedFeedItem[] {
  const normalized = xml.replace(/\r/g, "");
  const itemPatterns = [/<item\b[^>]*>([\s\S]*?)<\/item>/gi, /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi];
  const seen = new Set<string>();
  const items: ParsedFeedItem[] = [];

  for (const pattern of itemPatterns) {
    for (const match of normalized.matchAll(pattern)) {
      const content = match[1] ?? "";
      const title = decodeXml(extractTagContent(content, "title") ?? "Untitled").trim();
      const link = extractLink(content);
      const guid = extractTagContent(content, "guid") ?? extractTagContent(content, "id");
      const description = extractTagContent(content, "description") ?? extractTagContent(content, "summary") ?? null;
      const fullContent = extractTagContent(content, "content:encoded") ?? extractTagContent(content, "content");
      const contentAvailability = fullContent ? "full_feed_content" : description ? "summary_only" : "no_content";
      const publishedAt = normalizeDate(extractTagContent(content, "pubDate") ?? extractTagContent(content, "published") ?? extractTagContent(content, "updated"));
      const author = extractTagContent(content, "dc:creator") ?? extractTagContent(content, "author");
      const categories = [...content.matchAll(/<category\b[^>]*>([\s\S]*?)<\/category>/gi)]
        .map((categoryMatch) => decodeXml(categoryMatch[1] ?? "").trim())
        .filter(Boolean);
      const media = extractMedia(content);
      const externalId = normalizeExternalId(guid ?? link ?? `${title}:${fallbackUrl}`);
      const dedupeKey = externalId.toLowerCase();

      if (seen.has(dedupeKey)) {
        continue;
      }

      seen.add(dedupeKey);
      items.push({
        title,
        url: link ?? fallbackUrl,
        externalId,
        summary: description ?? null,
        body: fullContent ?? null,
        contentAvailability,
        publishedAt,
        author: author ?? null,
        categories,
        media
      });
    }
  }

  return items;
}
