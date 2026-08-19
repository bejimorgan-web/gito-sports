import type Database from "better-sqlite3";
import type { NewsArticleCategoryType, NewsClassificationSuggestion } from "@gito/shared";
import { env, runtimeConfig } from "../config/env.js";

const SUPPORTED_TYPES = new Set<NewsArticleCategoryType>(["team", "competition", "country", "sport", "match"]);
const MAX_SUGGESTIONS = 20;
const MAX_RESPONSE_BYTES = 256 * 1024;

export interface AiClassificationRequest {
  title: string;
  summary?: string | null;
  normalizedText?: string | null;
  sourceUrl?: string | null;
  deterministicSuggestions: NewsClassificationSuggestion[];
}

export interface AiClassificationProvider {
  classify(request: AiClassificationRequest, catalog: Record<string, Array<{ id: string; name: string; shortName?: string; slug?: string }>>): Promise<unknown>;
}

export class AiClassificationUnavailableError extends Error {
  constructor() { super("ai_classification_unavailable"); }
}

export class OpenAiCompatibleClassificationProvider implements AiClassificationProvider {
  async classify(request: AiClassificationRequest, catalog: Record<string, Array<{ id: string; name: string; shortName?: string; slug?: string }>>): Promise<unknown> {
    if (!runtimeConfig.aiClassificationEnabled || !env.aiApiKey || !env.aiBaseUrl) throw new AiClassificationUnavailableError();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), runtimeConfig.aiClassificationTimeoutMs);
    try {
      const payload = {
        model: env.aiModel,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "Return only JSON with a suggestions array. Suggest only IDs from the supplied catalog. Never approve relationships. Each suggestion must contain categoryType, entityId, confidence (1-100), and concise reason." },
          { role: "user", content: JSON.stringify({ article: { title: request.title, summary: request.summary ?? null, text: (request.normalizedText ?? "").slice(0, 12000), sourceUrl: request.sourceUrl ?? null }, catalog, deterministicSuggestions: request.deterministicSuggestions.map(({ categoryType, entityId, confidence, reason }) => ({ categoryType, entityId, confidence, reason })) }) }
        ]
      };
      const response = await fetch(env.aiBaseUrl, { method: "POST", signal: controller.signal, headers: { "content-type": "application/json", authorization: `Bearer ${env.aiApiKey}` }, body: JSON.stringify(payload) });
      const contentLength = Number(response.headers.get("content-length") ?? 0);
      if (contentLength > MAX_RESPONSE_BYTES) throw new AiClassificationUnavailableError();
      const text = await response.text();
      if (!response.ok || Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) throw new AiClassificationUnavailableError();
      const envelope = JSON.parse(text) as any;
      const content = envelope?.choices?.[0]?.message?.content;
      if (typeof content !== "string") throw new AiClassificationUnavailableError();
      return JSON.parse(content);
    } catch (error) {
      if (error instanceof AiClassificationUnavailableError) throw error;
      throw new AiClassificationUnavailableError();
    } finally { clearTimeout(timeout); }
  }
}

function normalizeConfidence(value: unknown): number | null {
  const numeric = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  if (!Number.isFinite(numeric)) return null;
  const normalized = numeric >= 0 && numeric <= 1 ? numeric * 100 : numeric;
  if (!Number.isFinite(normalized) || normalized < 1 || normalized > 100) return null;
  return Math.round(normalized);
}

export class AiNewsClassificationService {
  constructor(private readonly database: Database, private readonly provider: AiClassificationProvider) {}

  buildCatalog() {
    const rows = (sql: string) => this.database.prepare(sql).all() as Array<{ id: string; name: string; short_name?: string | null; slug?: string | null }>;
    return {
      teams: rows("SELECT id, name, short_name, slug FROM teams WHERE status = 'active' ORDER BY name").map(this.catalogItem),
      competitions: rows("SELECT id, name, slug FROM competitions WHERE status = 'active' ORDER BY name").map(this.catalogItem),
      countries: rows("SELECT id, name FROM countries WHERE status = 'active' ORDER BY name").map(this.catalogItem),
      sports: rows("SELECT id, name, slug FROM sports WHERE status = 'active' ORDER BY name").map(this.catalogItem),
      matches: rows("SELECT id, id AS name FROM matches ORDER BY starts_at").map(this.catalogItem)
    };
  }

  async classify(request: AiClassificationRequest, articleId: string): Promise<NewsClassificationSuggestion[]> {
    const catalog = this.buildCatalog();
    const raw = await this.provider.classify(request, catalog);
    return this.validate(raw, articleId, catalog);
  }

  private catalogItem(row: { id: string; name: string; short_name?: string | null; slug?: string | null }) {
    return { id: row.id, name: row.name, ...(row.short_name ? { shortName: row.short_name } : {}), ...(row.slug ? { slug: row.slug } : {}) };
  }

  private validate(raw: unknown, articleId: string, catalog: Record<string, Array<{ id: string; name: string; shortName?: string; slug?: string }>>) {
    const suggestions = (raw as any)?.suggestions;
    if (!Array.isArray(suggestions) || suggestions.length > MAX_SUGGESTIONS) throw new Error("ai_classification_invalid_response");
    const validIds = new Map<string, Set<string>>(Object.entries(catalog).map(([key, values]) => [key, new Set(values.map((value) => value.id))]));
    const result: NewsClassificationSuggestion[] = [];
    const seen = new Set<string>();
    for (const item of suggestions) {
      if (!item || !SUPPORTED_TYPES.has(item.categoryType)) throw new Error("ai_classification_invalid_response");
      const categoryType = item.categoryType as NewsArticleCategoryType;
      const catalogKey = categoryType === "country" ? "countries" : categoryType === "match" ? "matches" : `${categoryType}s`;
      if (!validIds.get(catalogKey)?.has(String(item.entityId))) throw new Error("ai_classification_unknown_entity");
      const confidence = normalizeConfidence(item.confidence);
      const reason = typeof item.reason === "string" ? item.reason.trim() : "";
      const key = `${categoryType}:${item.entityId}`;
      if (!confidence || !reason || seen.has(key)) throw new Error("ai_classification_invalid_response");
      seen.add(key);
      result.push({ articleId, categoryType, entityId: String(item.entityId), confidence, reason: reason.slice(0, 500), classificationSource: "ai", classificationStatus: "suggested" });
    }
    return result;
  }
}

export const defaultAiNewsClassificationService = (database: Database) => new AiNewsClassificationService(database, new OpenAiCompatibleClassificationProvider());
