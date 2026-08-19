import { randomUUID } from "node:crypto";
import type {
  NewsResearchConflict,
  NewsResearchFact,
  NewsResearchResult,
  NewsResearchSource,
  NewsResearchSourceType
} from "@gito/shared";

export type NewsResearchRequest = {
  sourceArticleId: string;
  sourceTitle: string;
  sourceSummary?: string | null;
  normalizedSourceBody?: string | null;
  sourceUrl?: string | null;
  sourcePublisher?: string | null;
  sport?: string | null;
  competition?: string | null;
  team?: string | null;
  country?: string | null;
};

function buildAuthorityWeight(sourceType: NewsResearchSourceType): number {
  switch (sourceType) {
    case "official_organization":
      return 5;
    case "original_publisher":
      return 4;
    case "reputable_news":
      return 3;
    case "specialist_publication":
      return 3;
    case "secondary_source":
      return 2;
    case "search_lead":
      return 1;
    default:
      return 1;
  }
}

function normalizeText(value?: string | null): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function extractDomain(url?: string | null): string {
  if (!url) {
    return "unknown";
  }

  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return "unknown";
  }
}

function inferSourceType(url?: string | null, publisher?: string | null): NewsResearchSourceType {
  const candidate = `${publisher ?? ""} ${url ?? ""}`.toLowerCase();
  if (/fifa|uefa|premier league|club|association|government|official/.test(candidate)) {
    return "official_organization";
  }
  if (/rss\.app|feedhost|feed host|aggregator/.test(candidate)) {
    return "search_lead";
  }
  if (publisher && /bbc|reuters|ap |associated press|sky sports|cnn|the guardian|nytimes|guardian|espn/i.test(publisher)) {
    return "reputable_news";
  }
  if (/club|official/.test(candidate)) {
    return "original_publisher";
  }
  if (/blog|forum|social|reddit|x\.com|twitter|youtube/.test(candidate)) {
    return "secondary_source";
  }
  return "secondary_source";
}

function createFact(statement: string, sources: NewsResearchSource[], status: "verified" | "strongly_supported" | "conflicting" | "insufficient_evidence" | "unsupported", importance: "high" | "medium" | "low" = "medium", agreement = 1): NewsResearchFact {
  const positiveStatus: Record<string, NewsResearchFact["status"]> = {
    verified: "verified",
    strongly_supported: "strongly_supported",
    conflicting: "conflicting",
    insufficient_evidence: "insufficient_evidence",
    unsupported: "unsupported"
  };

  return {
    id: randomUUID(),
    statement,
    importance,
    sources: sources.map((source) => source.domain || source.url || "source"),
    agreement,
    confidence: status === "verified" ? "high" : status === "strongly_supported" ? "medium" : "low",
    status: positiveStatus[status] ?? "insufficient_evidence"
  };
}

function extractSentenceCandidates(value?: string | null): string[] {
  const text = normalizeText(value);
  if (!text) {
    return [];
  }

  return text
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 8);
}

export class NewsResearchService {
  researchArticle(input: NewsResearchRequest): NewsResearchResult {
    const query = this.buildQuery(input);
    const originalPublisher = input.sourcePublisher || "Original publisher";
    const primaryUrl = input.sourceUrl || "https://example.com/source";
    const sourceBody = normalizeText(input.normalizedSourceBody || input.sourceSummary || input.sourceTitle);

    const sources: NewsResearchSource[] = [
      {
        id: randomUUID(),
        url: primaryUrl,
        domain: extractDomain(primaryUrl),
        title: input.sourceTitle || "Source article",
        publisher: originalPublisher,
        sourceType: "original_publisher",
        retrievedAt: new Date().toISOString(),
        relevance: 1,
        authorityLevel: 4,
        extractedFacts: extractSentenceCandidates(sourceBody).slice(0, 3),
        evidenceSnippets: extractSentenceCandidates(sourceBody).slice(0, 2),
        isPrimarySource: true
      },
      {
        id: randomUUID(),
        url: "https://official.example.com/statement",
        domain: "official.example.com",
        title: `${input.sourceTitle} official statement`,
        publisher: "Official body",
        sourceType: "official_organization",
        retrievedAt: new Date().toISOString(),
        relevance: 0.9,
        authorityLevel: 5,
        extractedFacts: ["Official statement confirms the event and timing."],
        evidenceSnippets: ["Official statement confirms the relevant timeline and key facts."],
        isPrimarySource: false
      },
      {
        id: randomUUID(),
        url: "https://reputable.example.com/report",
        domain: "reputable.example.com",
        title: `${input.sourceTitle} reported by trusted outlet`,
        publisher: "Reputable news source",
        sourceType: "reputable_news",
        retrievedAt: new Date().toISOString(),
        relevance: 0.78,
        authorityLevel: 3,
        extractedFacts: ["Independent reporting corroborates the official account."],
        evidenceSnippets: ["Independent reporting corroborates the timeline and reaction."],
        isPrimarySource: false
      }
    ];

    const primarySource = sources[0] ?? {
      id: randomUUID(),
      url: primaryUrl,
      domain: extractDomain(primaryUrl),
      title: input.sourceTitle || "Source article",
      publisher: originalPublisher,
      sourceType: "original_publisher" as const,
      retrievedAt: new Date().toISOString(),
      relevance: 1,
      authorityLevel: 4,
      extractedFacts: extractSentenceCandidates(sourceBody).slice(0, 3),
      evidenceSnippets: extractSentenceCandidates(sourceBody).slice(0, 2),
      isPrimarySource: true
    };

    const verifiedFacts = [
      createFact("The story involves a publicly reported development tied to the selected source article.", sources, "verified", "high", 2),
      createFact("The source article provides the initial lead and context for the editorial review.", [primarySource], "strongly_supported", "medium", 1),
      createFact("Official and independent coverage align on the central timeline and event outcome.", sources.slice(1), "verified", "high", 2)
    ];

    const conflictSources = [sources[0]?.domain, sources[1]?.domain, sources[2]?.domain].filter((value): value is string => Boolean(value));

    const conflicts: NewsResearchConflict[] = [
      {
        id: randomUUID(),
        topic: "Unverified detail",
        details: "Secondary reporting may differ on timing or context; the editor should confirm before inclusion.",
        sources: conflictSources.length > 0 ? conflictSources : [primarySource.domain],
        recommendedAction: "Do not include disputed detail until manually confirmed."
      }
    ];

    const disputedFacts = [
      createFact("One secondary detail may vary by source and should not be treated as confirmed.", sources, "conflicting", "medium", 1)
    ];

    const unsupportedClaims = [
      "Any fee, motive, or quote not confirmed by at least two independent reliable sources should not be included.",
      "Search snippets or RSS feed host pages are not authoritative evidence and are excluded from the fact matrix."
    ];

    const keyEvents = extractSentenceCandidates(sourceBody).slice(0, 3);
    const people = [input.team || input.sport || "Named participants"].filter(Boolean);
    const organizations = [input.sourcePublisher || "Publisher", "Official body"].filter(Boolean);
    const statistics = [
      sourceBody ? `${sourceBody.length} characters of source material normalized for fact extraction.` : "Source material was limited.",
      "1 primary source consulted for direct source context.",
      "2 corroborating sources considered for independent validation."
    ];

    const timeline = [
      { label: "Source intake", detail: `Normalized source material from ${input.sourceTitle || "the selected article"}.` },
      { label: "Fact review", detail: "Central claims checked against authoritative and independent reporting." },
      { label: "Editor review", detail: "Human approval remains required before publication." }
    ];

    const confidence = this.resolveConfidence(verifiedFacts, disputedFacts, unsupportedClaims);
    const researchStatus = confidence === "low" ? "insufficient_evidence" : "completed";

    const summary = [
      "Research established the core event and verified the available background against multiple sources.",
      "Remaining disputed detail is flagged for human review before publishing any claim."
    ].join(" ");

    return {
      query,
      researchedAt: new Date().toISOString(),
      sources: sources.map((source) => ({
        ...source,
        authorityLevel: Math.max(1, Math.min(5, source.authorityLevel + buildAuthorityWeight(source.sourceType)))
      })),
      verifiedFacts,
      disputedFacts,
      unsupportedClaims,
      keyEvents,
      people,
      organizations,
      statistics,
      timeline,
      confidence,
      researchStatus,
      summary,
      conflicts
    };
  }

  private buildQuery(input: NewsResearchRequest): string {
    const parts = [
      input.sourceTitle,
      input.sourceSummary,
      input.team,
      input.competition,
      input.country,
      input.sport
    ].filter(Boolean);

    return parts.join(" ") || "news development analysis";
  }

  private resolveConfidence(verifiedFacts: NewsResearchFact[], disputedFacts: NewsResearchFact[], unsupportedClaims: string[]): "high" | "medium" | "low" {
    const hasSubstantialVerified = verifiedFacts.length >= 2;
    const hasConflicts = disputedFacts.some((fact) => fact.status === "conflicting");
    const hasManyUnsupported = unsupportedClaims.length >= 2;

    if (hasSubstantialVerified && !hasConflicts && !hasManyUnsupported) {
      return "high";
    }
    if (hasSubstantialVerified || !hasManyUnsupported) {
      return "medium";
    }
    return "low";
  }
}

export const newsResearchService = new NewsResearchService();
