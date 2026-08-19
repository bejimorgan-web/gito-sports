import type Database from "better-sqlite3";
import type { NewsArticleCategoryType, NewsArticleStatus, NewsClassificationSuggestion } from "@gito/shared";

export interface NewsClassificationInput {
  articleId?: string;
  title: string;
  summary?: string | null;
  body?: string | null;
  sourceName?: string | null;
  sourceUrl?: string | null;
  categories?: string[];
  author?: string | null;
  tags?: string[];
  status?: NewsArticleStatus;
}

export interface NewsClassificationResult {
  sportId: string | null;
  competitionId: string | null;
  teamId: string | null;
  countryId: string | null;
  matchId: string | null;
  confidence: "high" | "medium" | "low";
  reasons: string[];
  suggestions: NewsClassificationSuggestion[];
}

interface CatalogRow {
  id: string;
  name: string;
  slug?: string | null;
  short_name?: string | null;
  iso2_code?: string | null;
  iso3_code?: string | null;
  sport_id?: string | null;
  country_id?: string | null;
  competition_id?: string | null;
  home_team_id?: string | null;
  away_team_id?: string | null;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function containsTerm(text: string, term: string): boolean {
  const normalizedText = ` ${normalize(text)} `;
  const normalizedTerm = normalize(term);
  return normalizedTerm.length > 1 && normalizedText.includes(` ${normalizedTerm} `);
}

function searchableText(input: NewsClassificationInput): string {
  return [
    input.title,
    input.summary,
    input.body,
    input.sourceName,
    input.sourceUrl,
    ...(input.categories ?? []),
    input.author,
    ...(input.tags ?? [])
  ].filter(Boolean).join(" ");
}

function matchSignals(row: CatalogRow, text: string): { confidence: number; reasons: string[] } | null {
  const reasons: string[] = [];
  let confidence = 0;
  if (containsTerm(text, row.name)) {
    confidence = 95;
    reasons.push("Exact normalized catalog name found in article text");
  } else if (row.slug && containsTerm(text, row.slug)) {
    confidence = 88;
    reasons.push("Catalog slug found in article text");
  } else if (row.short_name && containsTerm(text, row.short_name)) {
    confidence = normalize(row.short_name).split(" ").length > 1 ? 82 : 58;
    reasons.push("Catalog short name found in article text");
  } else {
    return null;
  }
  return { confidence, reasons };
}

function suggestion(articleId: string, categoryType: NewsArticleCategoryType, row: CatalogRow, signal: { confidence: number; reasons: string[] }, extraReasons: string[] = []): NewsClassificationSuggestion {
  return {
    articleId,
    categoryType,
    entityId: row.id,
    confidence: signal.confidence,
    reason: [...signal.reasons, ...extraReasons].join("; "),
    classificationSource: "deterministic",
    classificationStatus: "suggested"
  };
}

export class NewsClassificationService {
  constructor(private readonly database: Database) {}

  private hasColumn(tableName: string, columnName: string): boolean {
    return (this.database.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>).some((column) => column.name === columnName);
  }

  classify(input: NewsClassificationInput): NewsClassificationResult {
    const text = searchableText(input);
    const reasons: string[] = [];

    const sports = this.database.prepare("SELECT id, name, slug FROM sports WHERE status = 'active' ORDER BY name").all() as CatalogRow[];
    const teamSlug = this.hasColumn("teams", "slug") ? "slug" : "NULL AS slug";
    const teams = this.database.prepare(`SELECT id, name, short_name, ${teamSlug}, sport_id, country_id FROM teams WHERE status = 'active' ORDER BY length(name) DESC, name`).all() as CatalogRow[];
    const countries = this.database.prepare("SELECT id, name, iso2_code, iso3_code FROM countries WHERE status = 'active' ORDER BY length(name) DESC, name").all() as CatalogRow[];
    const competitions = this.database.prepare("SELECT id, name, slug, sport_id, country_id FROM competitions WHERE status = 'active' ORDER BY length(name) DESC, name").all() as CatalogRow[];

    const teamMatches = teams.map((row) => ({ row, signal: matchSignals(row, text) })).filter((item): item is { row: CatalogRow; signal: { confidence: number; reasons: string[] } } => Boolean(item.signal));
    const competitionMatches = competitions.map((row) => ({ row, signal: matchSignals(row, text) })).filter((item): item is { row: CatalogRow; signal: { confidence: number; reasons: string[] } } => Boolean(item.signal));
    const countryMatches = countries.filter((row) => this.isUsableCountry(row)).map((row) => ({ row, signal: matchSignals(row, text) })).filter((item): item is { row: CatalogRow; signal: { confidence: number; reasons: string[] } } => Boolean(item.signal));
    const sportMatches = sports.map((row) => ({ row, signal: matchSignals(row, text) })).filter((item): item is { row: CatalogRow; signal: { confidence: number; reasons: string[] } } => Boolean(item.signal));
    const detectedSportIds = new Set(teamMatches.map(({ row }) => row.sport_id).filter(Boolean));
    const suggestions: NewsClassificationSuggestion[] = [];

    for (const item of teamMatches) suggestions.push(suggestion("", "team", item.row, item.signal));
    for (const item of competitionMatches) {
      const context = item.row.sport_id && detectedSportIds.has(item.row.sport_id) ? ["Team and competition share the same sport catalog relationship"] : [];
      suggestions.push(suggestion("", "competition", item.row, item.signal, context));
    }
    for (const item of countryMatches) suggestions.push(suggestion("", "country", item.row, item.signal));
    for (const item of sportMatches) suggestions.push(suggestion("", "sport", item.row, item.signal));

    const teamIds = new Set(teamMatches.map(({ row }) => row.id));
    const competitionIds = new Set(competitionMatches.map(({ row }) => row.id));
    const canonicalMatches = this.database.prepare("SELECT id, competition_id, home_team_id, away_team_id FROM matches").all() as CatalogRow[];
    for (const match of canonicalMatches) {
      const homeMentioned = teamIds.has(match.home_team_id ?? "");
      const awayMentioned = teamIds.has(match.away_team_id ?? "");
      const competitionMentioned = competitionIds.has(match.competition_id ?? "");
      if (homeMentioned && awayMentioned && competitionMentioned) {
        suggestions.push({ articleId: "", categoryType: "match", entityId: match.id, confidence: 96, reason: "Both canonical fixture participants and its competition were detected in the article", classificationSource: "deterministic", classificationStatus: "suggested" });
      }
    }
    const matchSuggestions = suggestions.filter((item) => item.categoryType === "match");
    if (matchSuggestions.length === 0 && competitionIds.size === 1 && teamIds.size > 0) {
      const fallbackMatches = canonicalMatches.filter((match) => competitionIds.has(match.competition_id ?? "") && (teamIds.has(match.home_team_id ?? "") || teamIds.has(match.away_team_id ?? "")));
      if (fallbackMatches.length === 1) {
        suggestions.push({ articleId: "", categoryType: "match", entityId: fallbackMatches[0]!.id, confidence: 72, reason: "One canonical fixture matched the detected competition and team; the second participant was not explicit", classificationSource: "deterministic", classificationStatus: "suggested" });
      }
    }

    const primary = (categoryType: NewsArticleCategoryType) => suggestions.filter((item) => item.categoryType === categoryType).sort((left, right) => right.confidence - left.confidence || left.entityId.localeCompare(right.entityId))[0];
    for (const item of suggestions) {
      if (item.reason) reasons.push(`${item.categoryType}: ${item.reason}`);
    }
    const primaryTeam = primary("team");
    const primaryCompetition = primary("competition");
    const primaryCountry = primary("country");
    const primarySport = primary("sport");
    const primaryMatch = primary("match");
    const assignments = [primarySport, primaryTeam, primaryCountry, primaryCompetition, primaryMatch].filter(Boolean).length;
    const articleId = input.articleId ?? "";
    const withArticleId = suggestions.map((item) => ({ ...item, articleId }));
    return {
      sportId: primarySport?.entityId ?? null,
      competitionId: primaryCompetition?.entityId ?? null,
      teamId: primaryTeam?.entityId ?? null,
      countryId: primaryCountry?.entityId ?? null,
      matchId: primaryMatch?.entityId ?? null,
      confidence: assignments >= 2 ? "high" : assignments === 1 ? "medium" : "low",
      reasons,
      suggestions: withArticleId
    };
  }

  private isUsableCountry(country: CatalogRow | null): boolean {
    if (!country) return false;
    return country.iso2_code !== "XX" && country.iso3_code !== "XXX" && normalize(country.name) !== "fifa";
  }

}
