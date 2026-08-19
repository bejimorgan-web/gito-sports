export function normalizeNewsText(input?: string | null): string {
  if (!input) {
    return "";
  }

  let text = String(input);

  // Remove comments, scripts, styles, and invisible elements.
  text = text.replace(/<!--([\s\S]*?)-->/g, " ");
  text = text.replace(/<script[\s\S]*?<\/script>/gi, " ");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, " ");
  text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");

  // Remove obvious navigation/promotional/advertising blocks.
  text = text.replace(/<(nav|aside|footer|header|form|figure|iframe|section|article|div)\b[^>]*\b(?:class|id|role)=["'][^"']*\b(?:nav|navigation|promo|advert|ads?|banner|subscribe|subscription|newsletter|related|recommend|cookie|share|social|widget|modal|popup|sidebar|breadcrumb|breadcrumbs|header|footer|advertisement|sponsored|subscribe|newsletter)[^"']*["'][^>]*>[\s\S]*?<\/\1>/gi, " ");
  text = text.replace(/<(nav|aside|footer|header|form|figure|iframe|section|article|div)\b[^>]*>[\s\S]*?<\/\1>/gi, (match) => {
    if (/\b(nav|navigation|promo|advert|ads?|banner|subscribe|subscription|newsletter|related|recommend|cookie|share|social|widget|modal|popup|sidebar|breadcrumb|breadcrumbs|header|footer|advertisement|sponsored|subscribe|newsletter)\b/i.test(match)) {
      return " ";
    }
    return match;
  });
  text = text.replace(/<img\b[^>]*>/gi, " ");
  text = text.replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, " ");
  text = text.replace(/<object\b[^>]*>[\s\S]*?<\/object>/gi, " ");
  text = text.replace(/<video\b[^>]*>[\s\S]*?<\/video>/gi, " ");

  // Convert common block tags and line breaks into whitespace/newlines.
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/p>/gi, "\n");
  text = text.replace(/<\/div>/gi, "\n");
  text = text.replace(/<\/article>/gi, "\n");
  text = text.replace(/<\/section>/gi, "\n");
  text = text.replace(/<\/li>/gi, "\n");
  text = text.replace(/<\/h[1-6]>/gi, "\n");
  text = text.replace(/<\/header>/gi, "\n");
  text = text.replace(/<\/footer>/gi, "\n");
  text = text.replace(/<\/blockquote>/gi, "\n");
  text = text.replace(/<\/figure>/gi, "\n");
  text = text.replace(/<\/figcaption>/gi, "\n");
  text = text.replace(/<\/tr>/gi, "\n");
  text = text.replace(/<\/td>/gi, " \n");
  text = text.replace(/<\/th>/gi, " \n");

  text = text.replace(/<(p|div|article|section|li|h[1-6]|header|footer|blockquote|figure|figcaption|tr|td|th)[^>]*>/gi, "\n");

  // Remove all remaining tags and keep text content.
  text = text.replace(/<[^>]+>/g, " ");

  // Decode common HTML entities.
  text = decodeHtmlEntities(text);

  // Collapse whitespace but preserve paragraph breaks.
  text = text.replace(/\r\n|\r/g, "\n");
  text = text.replace(/\n[ \t\f\v]*\n+/g, "\n\n");
  text = text.replace(/[ \t\f\v]+/g, " ");
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text.replace(/^[ \t\n\r]+|[ \t\n\r]+$/g, "");

  return text;
}

export interface SummaryResult {
  title: string;
  summary: string;
  keywords: string[];
}

export function buildSummaryFromText(rawText: string, maxWords = 40): SummaryResult {
  const cleaned = normalizeSummaryText(rawText);

  if (!cleaned) {
    return {
      title: "Untitled",
      summary: "",
      keywords: []
    };
  }

  const sentences = splitIntoSentences(cleaned)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  const title = buildTitle(sentences, cleaned);
  const summaryBase = sentences.length ? sentences.slice(0, 3).join(" ").trim() : cleaned;

  return {
    title: title || "Untitled",
    summary: truncate(summaryBase || cleaned, maxWords),
    keywords: extractKeywords(cleaned)
  };
}

function normalizeSummaryText(value: string): string {
  return normalizeNewsText(value)
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[#*_~`]/g, " ")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitIntoSentences(value: string): string[] {
  return value
    .split(/(?<=[.!?])\s+|(?=\n)/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter((part) => part.length > 0);
}

function buildTitle(sentences: string[], fullText: string): string {
  if (!sentences.length) return "Untitled";

  const firstSentence = sentences[0];
  if (!firstSentence) return "Untitled";

  const candidate = firstSentence
    .replace(/^[^a-zA-Z0-9]+/, "")
    .replace(/[.!?]+$/, "")
    .trim();

  if (!candidate) return "Untitled";

  if (candidate.length <= 80) return candidate;

  const words = candidate.split(/\s+/);
  return words.slice(0, 12).join(" ").replace(/[.,;:!?]+$/, "");
}

function extractKeywords(value: string): string[] {
  const stopWords = new Set([
    "the", "a", "an", "and", "or", "but", "for", "with", "from", "into",
    "that", "this", "these", "those", "their", "there", "here", "about",
    "over", "under", "after", "before", "while", "when", "what", "which",
    "who", "why", "how", "your", "our", "you", "we", "it", "is", "are",
    "was", "were", "be", "been", "being", "to", "of", "in", "on", "at",
    "by", "as", "if", "then", "than", "them", "they", "his", "her", "its",
    "new", "next", "available", "expand", "improves", "speeds", "plans", "access", "update"
  ]);

  const words = value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 3 && !stopWords.has(word));

  const counts = new Map<string, number>();
  const firstSeen = new Map<string, number>();

  for (const [index, word] of words.entries()) {
    counts.set(word, (counts.get(word) ?? 0) + 1);
    if (!firstSeen.has(word)) {
      firstSeen.set(word, index);
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (firstSeen.get(a[0]) ?? 0) - (firstSeen.get(b[0]) ?? 0))
    .slice(0, 6)
    .map(([word]) => word);
}

function truncate(value: string, maxWords: number): string {
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return value;
  return `${words.slice(0, maxWords).join(" ")}...`;
}

function decodeHtmlEntities(input: string): string {
  const entityMap: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    nbsp: " ",
    quot: '"',
    apos: "'",
    rsquo: "'",
    ldquo: '"',
    rdquo: '"',
    hellip: "..."
  };

  return input.replace(/&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      const codePoint = parseInt(entity.slice(2), 16);
      return Number.isNaN(codePoint) ? match : String.fromCodePoint(codePoint);
    }
    if (entity.startsWith("#")) {
      const codePoint = parseInt(entity.slice(1), 10);
      return Number.isNaN(codePoint) ? match : String.fromCodePoint(codePoint);
    }
    return entityMap[entity] ?? match;
  });
}
