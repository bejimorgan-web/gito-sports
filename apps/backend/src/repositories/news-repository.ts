import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { getDatabase } from "../db/connection.js";
import type { CreateNewsArticleRequest, CreateNewsSourceRequest, NewsArticle, NewsArticleAuditEntry, NewsArticleBodyBlock, NewsArticleCategory, NewsArticleCategoryInput, NewsArticleLink, NewsArticleMedia, NewsQueryOptions, UpdateNewsArticleRequest, UpdateNewsSourceRequest, NewsSource, NewsResearchResult, NewsClassificationSuggestion, NewsClassificationStatus } from "@gito/shared";
import { parseFeedItems } from "../services/news-collector.js";
import { NewsClassificationService } from "../services/news-classification-service.js";

function toArticleRow(row: any): NewsArticle {
  let bodyBlocks: NewsArticleBodyBlock[] = [];
  if (row.body_blocks_json) {
    try {
      const parsed = JSON.parse(row.body_blocks_json);
      if (Array.isArray(parsed)) bodyBlocks = parsed;
    } catch {
      bodyBlocks = [];
    }
  }
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    summary: row.summary ?? null,
    body: row.body ?? null,
    bodyBlocks,
    status: row.status,
    sportId: row.sport_id ?? null,
    competitionId: row.competition_id ?? null,
    teamId: row.team_id ?? null,
    countryId: row.country_id ?? null,
    matchId: row.match_id ?? null,
    sourceId: row.source_id ?? null,
    sourceName: row.source_name ?? null,
    sourceUrl: row.source_url ?? null,
    externalId: row.external_id ?? null,
    author: row.author ?? null,
    categories: row.categories_json ? JSON.parse(row.categories_json) : [],
    tags: row.tags_json ? JSON.parse(row.tags_json) : [],
    contentAvailability: row.content_availability ?? null,
    contentOrigin: row.content_origin ?? null,
    fetchedBody: row.fetched_body ?? null,
    fetchedAt: row.fetched_at ?? null,
    fetchStatus: row.fetch_status ?? null,
    fetchError: row.fetch_error ?? null,
    createdBy: row.created_by ?? null,
    publishedAt: row.published_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sport: row.sport_name ? { id: row.sport_id, name: row.sport_name } : null,
    competition: row.competition_name ? { id: row.competition_id, name: row.competition_name } : null,
    team: row.team_name ? { id: row.team_id, name: row.team_name } : null,
    country: row.country_name ? { id: row.country_id, name: row.country_name } : null,
    match: row.match_name ? { id: row.match_id } : null,
    source: row.configured_source_name ? { id: row.source_id, name: row.configured_source_name, sourceType: row.source_type } : null,
    media: [],
    links: [],
    audit: []
  };
}

export class NewsRepository {
  private db: Database;

  constructor(database?: Database) {
    this.db = database ?? getDatabase();
    const articleTable = this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'news_articles'").get();
    if (articleTable) {
      const hasExternalId = (this.db.prepare("PRAGMA table_info(news_articles)").all() as Array<{ name: string }>).some((column) => column.name === "external_id");
      if (!hasExternalId) {
        this.db.exec("ALTER TABLE news_articles ADD COLUMN external_id TEXT");
      }
      const articleColumns = this.db.prepare("PRAGMA table_info(news_articles)").all() as Array<{ name: string }>;
      for (const [columnName, columnType] of [["country_id", "TEXT"], ["author", "TEXT"], ["categories_json", "TEXT"], ["tags_json", "TEXT"], ["body_blocks_json", "TEXT"], ["content_availability", "TEXT"], ["content_origin", "TEXT"], ["fetched_body", "TEXT"], ["fetched_at", "TEXT"], ["fetch_status", "TEXT"], ["fetch_error", "TEXT"]] as const) {
        if (!articleColumns.some((column) => column.name === columnName)) {
          this.db.exec(`ALTER TABLE news_articles ADD COLUMN ${columnName} ${columnType}`);
        }
      }
    }
    const categoryTable = this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'news_article_categories'").get();
    if (categoryTable) {
      const columns = this.db.prepare("PRAGMA table_info(news_article_categories)").all() as Array<{ name: string }>;
      for (const [columnName, columnType] of [["confidence", "INTEGER NOT NULL DEFAULT 100"], ["reason", "TEXT"], ["classification_source", "TEXT NOT NULL DEFAULT 'editorial'"], ["classification_status", "TEXT NOT NULL DEFAULT 'approved'"]] as const) {
        if (!columns.some((column) => column.name === columnName)) {
          this.db.exec(`ALTER TABLE news_article_categories ADD COLUMN ${columnName} ${columnType}`);
        }
      }
    }
  }

  getDatabaseFromConstructor(): Database {
    return this.db;
  }

  private generateUniqueSlug(baseSlug: string, excludeArticleId?: string): string {
    const normalizedBaseSlug = baseSlug.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "article";
    let candidate = normalizedBaseSlug;
    let suffix = 1;

    if (excludeArticleId) {
      while (this.db.prepare("SELECT 1 FROM news_articles WHERE slug = ? AND id != ? LIMIT 1").get(candidate, excludeArticleId)) {
        candidate = `${normalizedBaseSlug}-${suffix}`;
        suffix += 1;
      }
      return candidate;
    }

    while (this.db.prepare("SELECT 1 FROM news_articles WHERE slug = ? LIMIT 1").get(candidate)) {
      candidate = `${normalizedBaseSlug}-${suffix}`;
      suffix += 1;
    }

    return candidate;
  }

  createArticle(input: CreateNewsArticleRequest): NewsArticle {
    const now = new Date().toISOString();
    const id = randomUUID();
    const slug = this.generateUniqueSlug(input.slug ?? input.title);

    const statement = this.db.prepare(`
      INSERT INTO news_articles (
        id, title, slug, summary, body, body_blocks_json, status, sport_id, competition_id, team_id, match_id,
        source_id, source_name, source_url, external_id, country_id, author, categories_json, tags_json,
        content_availability, content_origin, fetched_body, fetched_at, fetch_status, fetch_error,
        created_by, published_at, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?
      )
    `);

    const normalizedCategories = this.normalizeCategoryInputs(input.categories ?? []);
    const derivedContentOrigin = input.contentOrigin ?? (input.body ? "rss_full" : input.summary ? "summary" : "manual");
    const derivedFetchStatus = input.fetchStatus ?? "idle";

    statement.run(
      id,
      input.title,
      slug,
      input.summary ?? null,
      input.body ?? null,
      this.serializeBodyBlocks(input.bodyBlocks),
      input.status ?? "draft",
      input.sportId ?? null,
      input.competitionId ?? null,
      input.teamId ?? null,
      input.matchId ?? null,
      input.sourceId ?? null,
      input.sourceName ?? null,
      input.sourceUrl ?? null,
      input.externalId ?? null,
      input.countryId ?? null,
      input.author ?? null,
      JSON.stringify(normalizedCategories),
      JSON.stringify(input.tags ?? []),
      input.contentAvailability ?? (input.body ? "full_feed_content" : input.summary ? "summary_only" : "no_content"),
      derivedContentOrigin,
      input.fetchedBody ?? null,
      input.fetchedAt ?? null,
      derivedFetchStatus,
      input.fetchError ?? null,
      input.createdBy ?? null,
      input.publishedAt ?? null,
      now,
      now
    );

    this.syncArticleCategories(id, [
      ...this.deriveLegacyCategoryInputs(input),
      ...normalizedCategories
    ], input.classificationMode === "suggestion" ? "suggested" : "approved");

    const article = this.getArticleById(id);
    if (!article) {
      throw new Error("News article was not created");
    }
    return article;
  }

  getArticleById(id: string): NewsArticle | null {
    const row = this.db.prepare(`
      SELECT a.*, s.name AS sport_name, c.name AS competition_name, t.name AS team_name, co.name AS country_name, m.id AS match_id, ns.name AS configured_source_name, ns.source_type
      FROM news_articles a
      LEFT JOIN sports s ON s.id = a.sport_id
      LEFT JOIN competitions c ON c.id = a.competition_id
      LEFT JOIN teams t ON t.id = a.team_id
      LEFT JOIN countries co ON co.id = a.country_id
      LEFT JOIN matches m ON m.id = a.match_id
      LEFT JOIN news_sources ns ON ns.id = a.source_id
      WHERE a.id = ?
    `).get(id) as any;

    if (!row) return null;

    return this.attachRelations(toArticleRow(row));
  }

  listArticles(options: NewsQueryOptions = {}): NewsArticle[] {
    const conditions: string[] = [];
    const params: any[] = [];

    if (options.status) {
      conditions.push("a.status = ?");
      params.push(options.status);
    }

    if (options.sportId) {
      conditions.push("(EXISTS (SELECT 1 FROM news_article_categories nsc WHERE nsc.article_id = a.id AND nsc.category_type = 'sport' AND nsc.entity_id = ? AND nsc.classification_status = 'approved') OR (a.sport_id = ? AND NOT EXISTS (SELECT 1 FROM news_article_categories nsc_any WHERE nsc_any.article_id = a.id AND nsc_any.category_type = 'sport')))");
      params.push(options.sportId);
      params.push(options.sportId);
    }

    if (options.competitionId) {
      conditions.push("(EXISTS (SELECT 1 FROM news_article_categories ncc WHERE ncc.article_id = a.id AND ncc.category_type = 'competition' AND ncc.entity_id = ? AND ncc.classification_status = 'approved') OR (a.competition_id = ? AND NOT EXISTS (SELECT 1 FROM news_article_categories ncc_any WHERE ncc_any.article_id = a.id AND ncc_any.category_type = 'competition')))");
      params.push(options.competitionId);
      params.push(options.competitionId);
    }

    if (options.teamId) {
      conditions.push("(EXISTS (SELECT 1 FROM news_article_categories ntc WHERE ntc.article_id = a.id AND ntc.category_type = 'team' AND ntc.entity_id = ? AND ntc.classification_status = 'approved') OR (a.team_id = ? AND NOT EXISTS (SELECT 1 FROM news_article_categories ntc_any WHERE ntc_any.article_id = a.id AND ntc_any.category_type = 'team')))");
      params.push(options.teamId);
      params.push(options.teamId);
    }

    if (options.countryId) {
      conditions.push("(a.country_id = ? OR EXISTS (SELECT 1 FROM news_article_categories nco WHERE nco.article_id = a.id AND nco.category_type = 'country' AND nco.entity_id = ? AND nco.classification_status = 'approved'))");
      params.push(options.countryId);
      params.push(options.countryId);
    }

    if (options.matchId) {
      conditions.push("(EXISTS (SELECT 1 FROM news_article_categories nmc WHERE nmc.article_id = a.id AND nmc.category_type = 'match' AND nmc.entity_id = ? AND nmc.classification_status = 'approved') OR (a.match_id = ? AND NOT EXISTS (SELECT 1 FROM news_article_categories nmc_any WHERE nmc_any.article_id = a.id AND nmc_any.category_type = 'match')))");
      params.push(options.matchId);
      params.push(options.matchId);
    }

    if (options.sourceId) {
      conditions.push("a.source_id = ?");
      params.push(options.sourceId);
    }

    if (options.search) {
      conditions.push("(a.title LIKE ? OR a.summary LIKE ? OR a.body LIKE ?)");
      const searchPattern = `%${options.search}%`;
      params.push(searchPattern, searchPattern, searchPattern);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const limitClause = options.limit ? `LIMIT ${Number(options.limit)}` : "";
    const offsetClause = options.offset ? `OFFSET ${Number(options.offset)}` : "";

    const query = `
      SELECT a.*, s.name AS sport_name, c.name AS competition_name, t.name AS team_name, co.name AS country_name, m.id AS match_id, ns.name AS configured_source_name, ns.source_type
      FROM news_articles a
      LEFT JOIN sports s ON s.id = a.sport_id
      LEFT JOIN competitions c ON c.id = a.competition_id
      LEFT JOIN teams t ON t.id = a.team_id
      LEFT JOIN countries co ON co.id = a.country_id
      LEFT JOIN matches m ON m.id = a.match_id
      LEFT JOIN news_sources ns ON ns.id = a.source_id
      ${whereClause}
      ORDER BY a.created_at DESC
      ${limitClause} ${offsetClause}
    `.trim();

    const rows = this.db.prepare(query).all(...params) as any[];
    return rows.map((row) => this.attachRelations(toArticleRow(row)));
  }

  updateArticle(id: string, input: UpdateNewsArticleRequest): NewsArticle | null {
    const existing = this.getArticleById(id);
    if (!existing) return null;

    const now = new Date().toISOString();
    const slug = this.generateUniqueSlug(input.slug ?? existing.slug, id);
    const statement = this.db.prepare(`
      UPDATE news_articles
        SET title = ?, slug = ?, summary = ?, body = ?, body_blocks_json = ?, status = ?, sport_id = ?, competition_id = ?, team_id = ?, country_id = ?, match_id = ?,
          source_id = ?, source_name = ?, source_url = ?, external_id = ?, author = ?, categories_json = ?, tags_json = ?, content_availability = ?,
          content_origin = COALESCE(?, content_origin), fetched_body = ?, fetched_at = ?, fetch_status = ?, fetch_error = ?, published_at = ?, updated_at = ?
      WHERE id = ?
    `);

    const nextSportId = input.sportId !== undefined ? input.sportId : existing.sportId ?? null;
    const nextCompetitionId = input.competitionId !== undefined ? input.competitionId : existing.competitionId ?? null;
    const nextTeamId = input.teamId !== undefined ? input.teamId : existing.teamId ?? null;
    const nextCountryId = input.countryId !== undefined ? input.countryId : existing.countryId ?? null;
    const nextMatchId = input.matchId !== undefined ? input.matchId : existing.matchId ?? null;
    const nextCategories = input.categories !== undefined ? this.normalizeCategoryInputs(input.categories) : [...this.deriveLegacyCategoryInputs(existing as any)];

    const nextContentOrigin = input.contentOrigin ?? existing.contentOrigin ?? (input.body ? "rss_full" : input.summary ? "summary" : "manual");
    const nextFetchedBody = input.fetchedBody ?? existing.fetchedBody ?? null;
    const nextFetchedAt = input.fetchedAt ?? existing.fetchedAt ?? null;
    const nextFetchStatus = input.fetchStatus ?? existing.fetchStatus ?? "idle";
    const nextFetchError = input.fetchError ?? existing.fetchError ?? null;

    statement.run(
      input.title ?? existing.title,
      slug,
      input.summary ?? existing.summary ?? null,
      input.body ?? existing.body ?? null,
      input.bodyBlocks !== undefined ? this.serializeBodyBlocks(input.bodyBlocks) : this.serializeBodyBlocks(existing.bodyBlocks),
      input.status ?? existing.status,
      nextSportId,
      nextCompetitionId,
      nextTeamId,
      nextCountryId,
      nextMatchId,
      input.sourceId ?? existing.sourceId ?? null,
      input.sourceName ?? existing.sourceName ?? null,
      input.sourceUrl ?? existing.sourceUrl ?? null,
      input.externalId ?? existing.externalId ?? null,
      input.author ?? existing.author ?? null,
      JSON.stringify(nextCategories),
      JSON.stringify(input.tags ?? existing.tags ?? []),
      input.contentAvailability ?? existing.contentAvailability ?? (input.body ? "full_feed_content" : input.summary ? "summary_only" : "no_content"),
      nextContentOrigin,
      nextFetchedBody,
      nextFetchedAt,
      nextFetchStatus,
      nextFetchError,
      input.publishedAt ?? existing.publishedAt ?? null,
      now,
      id
    );

    this.syncArticleCategories(id, [
      ...this.deriveLegacyCategoryInputs({
        sportId: nextSportId,
        competitionId: nextCompetitionId,
        teamId: nextTeamId,
        countryId: nextCountryId,
        matchId: nextMatchId
      }),
      ...nextCategories
    ]);

    const article = this.getArticleById(id);
    if (!article) {
      throw new Error("News article was not updated");
    }
    return article;
  }

  deleteArticle(id: string): boolean {
    this.db.prepare("DELETE FROM news_article_media WHERE article_id = ?").run(id);
    this.db.prepare("DELETE FROM news_article_links WHERE article_id = ?").run(id);
    this.db.prepare("DELETE FROM news_article_audit WHERE article_id = ?").run(id);
    this.db.prepare("DELETE FROM news_article_research_results WHERE article_id = ?").run(id);
    this.db.prepare("DELETE FROM news_article_categories WHERE article_id = ?").run(id);
    const result = this.db.prepare("DELETE FROM news_articles WHERE id = ?").run(id);
    return result.changes > 0;
  }

  bulkDeleteArticles(ids: string[]): number {
    const validIds = [...new Set(ids.map((id) => String(id).trim()).filter(Boolean))];
    if (validIds.length === 0) {
      return 0;
    }

    const transaction = this.db.transaction(() => {
      let deletedCount = 0;
      for (const id of validIds) {
        const existing = this.db.prepare("SELECT id FROM news_articles WHERE id = ?").get(id);
        if (!existing) {
          continue;
        }

        this.db.prepare("DELETE FROM news_article_media WHERE article_id = ?").run(id);
        this.db.prepare("DELETE FROM news_article_links WHERE article_id = ?").run(id);
        this.db.prepare("DELETE FROM news_article_audit WHERE article_id = ?").run(id);
        this.db.prepare("DELETE FROM news_article_research_results WHERE article_id = ?").run(id);
        this.db.prepare("DELETE FROM news_article_categories WHERE article_id = ?").run(id);
        const result = this.db.prepare("DELETE FROM news_articles WHERE id = ?").run(id);
        if (result.changes > 0) {
          deletedCount += 1;
        }
      }
      return deletedCount;
    });

    return transaction();
  }

  createSource(input: CreateNewsSourceRequest): NewsSource {
    const now = new Date().toISOString();
    const id = randomUUID();
    const statement = this.db.prepare(`
      INSERT INTO news_sources (id, name, source_type, base_url, feed_url, enabled, collection_interval_minutes, rights_status, rights_last_checked_at, rights_review_notes, rights_administrator_decision, rights_decision_at, rights_audit_summary, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    statement.run(
      id,
      input.name,
      input.sourceType ?? "external",
      input.baseUrl ?? null,
      input.feedUrl ?? null,
      input.enabled ?? true ? 1 : 0,
      input.collectionIntervalMinutes ?? 60,
      input.rightsStatus ?? "unknown",
      input.rightsLastCheckedAt ?? null,
      input.rightsReviewNotes ?? null,
      input.rightsAdministratorDecision ?? null,
      input.rightsDecisionAt ?? null,
      input.rightsAuditSummary ?? null,
      now,
      now
    );

    const source = this.getSourceById(id);
    if (!source) {
      throw new Error("News source was not created");
    }
    return source;
  }

  getSourceById(id: string): NewsSource | null {
    const row = this.db.prepare("SELECT * FROM news_sources WHERE id = ?").get(id) as any;
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      sourceType: row.source_type,
      baseUrl: row.base_url ?? null,
      feedUrl: row.feed_url ?? null,
      enabled: Boolean(row.enabled),
      collectionIntervalMinutes: row.collection_interval_minutes ?? 60,
      lastCollectedAt: row.last_collected_at ?? null,
      lastCollectionStatus: row.last_collection_status ?? null,
      lastCollectionMessage: row.last_collection_message ?? null,
      lastCollectionAttemptAt: row.last_collection_attempt_at ?? null,
      lastCollectionSucceededAt: row.last_collection_succeeded_at ?? null,
      lastCollectionError: row.last_collection_error ?? null,
      lastCollectionDiscoveredCount: row.last_collection_discovered_count ?? null,
      lastCollectionNewCount: row.last_collection_new_count ?? null,
      lastCollectionDuplicateCount: row.last_collection_duplicate_count ?? null,
      rightsStatus: row.rights_status ?? null,
      rightsLastCheckedAt: row.rights_last_checked_at ?? null,
      rightsReviewNotes: row.rights_review_notes ?? null,
      rightsAdministratorDecision: row.rights_administrator_decision ?? null,
      rightsDecisionAt: row.rights_decision_at ?? null,
      rightsAuditSummary: row.rights_audit_summary ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  listSources(): NewsSource[] {
    const rows = this.db.prepare("SELECT * FROM news_sources ORDER BY name ASC").all() as any[];
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      sourceType: row.source_type,
      baseUrl: row.base_url ?? null,
      feedUrl: row.feed_url ?? null,
      enabled: Boolean(row.enabled),
      collectionIntervalMinutes: row.collection_interval_minutes ?? 60,
      lastCollectedAt: row.last_collected_at ?? null,
      lastCollectionStatus: row.last_collection_status ?? null,
      lastCollectionMessage: row.last_collection_message ?? null,
      lastCollectionAttemptAt: row.last_collection_attempt_at ?? null,
      lastCollectionSucceededAt: row.last_collection_succeeded_at ?? null,
      lastCollectionError: row.last_collection_error ?? null,
      lastCollectionDiscoveredCount: row.last_collection_discovered_count ?? null,
      lastCollectionNewCount: row.last_collection_new_count ?? null,
      lastCollectionDuplicateCount: row.last_collection_duplicate_count ?? null,
      rightsStatus: row.rights_status ?? null,
      rightsLastCheckedAt: row.rights_last_checked_at ?? null,
      rightsReviewNotes: row.rights_review_notes ?? null,
      rightsAdministratorDecision: row.rights_administrator_decision ?? null,
      rightsDecisionAt: row.rights_decision_at ?? null,
      rightsAuditSummary: row.rights_audit_summary ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  updateSource(id: string, input: UpdateNewsSourceRequest): NewsSource | null {
    const existing = this.getSourceById(id);
    if (!existing) return null;
    const now = new Date().toISOString();
    const statement = this.db.prepare(`
      UPDATE news_sources
      SET name = ?, source_type = ?, base_url = ?, feed_url = ?, enabled = ?, collection_interval_minutes = ?, rights_status = ?, rights_last_checked_at = ?, rights_review_notes = ?, rights_administrator_decision = ?, rights_decision_at = ?, rights_audit_summary = ?, updated_at = ?
      WHERE id = ?
    `);

    statement.run(
      input.name ?? existing.name,
      input.sourceType ?? existing.sourceType,
      input.baseUrl ?? existing.baseUrl ?? null,
      input.feedUrl ?? existing.feedUrl ?? null,
      input.enabled ?? existing.enabled ? 1 : 0,
      input.collectionIntervalMinutes ?? existing.collectionIntervalMinutes ?? 60,
      input.rightsStatus ?? existing.rightsStatus ?? "unknown",
      input.rightsLastCheckedAt ?? existing.rightsLastCheckedAt ?? null,
      input.rightsReviewNotes ?? existing.rightsReviewNotes ?? null,
      input.rightsAdministratorDecision ?? existing.rightsAdministratorDecision ?? null,
      input.rightsDecisionAt ?? existing.rightsDecisionAt ?? null,
      input.rightsAuditSummary ?? existing.rightsAuditSummary ?? null,
      now,
      id
    );

    const source = this.getSourceById(id);
    if (!source) {
      throw new Error("News source was not updated");
    }
    return source;
  }

  deleteSource(id: string): boolean {
    const result = this.db.prepare("DELETE FROM news_sources WHERE id = ?").run(id);
    return result.changes > 0;
  }

  updateSourceCollectionStatus(id: string, status: string, message: string | null, collectedAt: string): NewsSource | null {
    const now = new Date().toISOString();
    const statement = this.db.prepare(`
      UPDATE news_sources
      SET last_collected_at = ?, last_collection_status = ?, last_collection_message = ?, updated_at = ?
      WHERE id = ?
    `);
    statement.run(collectedAt, status, message ?? null, now, id);
    return this.getSourceById(id);
  }

  async collectSource(id: string): Promise<{ source: NewsSource; imported: number; skipped: number; discovered: number }> {
    const source = this.getSourceById(id);
    if (!source || !source.enabled || !source.feedUrl) {
      throw new Error("source_not_available");
    }

    const now = new Date().toISOString();
    const feedXml = await this.fetchFeed(source.feedUrl);
    const parsedItems = parseFeedItems(feedXml, source.baseUrl ?? source.feedUrl);
    const classifier = new NewsClassificationService(this.db);
    let imported = 0;
    let skipped = 0;

    const importTransaction = this.db.transaction((items: typeof parsedItems) => {
      const currentSource = this.getSourceById(source.id);
      if (!currentSource || !currentSource.enabled || !currentSource.feedUrl) {
        throw new Error("source_not_available");
      }

      for (const item of items) {
        const existingArticleId = this.findExistingArticleBySourceUrl(source.id, item.url);
        if (existingArticleId) {
          skipped += 1;
          continue;
        }

        const classification = classifier.classify({
          title: item.title,
          summary: item.summary,
          body: item.body,
          sourceName: source.name,
          sourceUrl: item.url,
          categories: item.categories,
          author: item.author
        });

        const article = this.createArticle({
          title: item.title,
          summary: item.summary ?? null,
          body: item.body ?? null,
          status: "draft",
          sourceId: source.id,
          sourceName: source.name,
          sourceUrl: item.url,
          publishedAt: item.publishedAt ?? null,
          author: item.author ?? null,
          categories: item.categories,
          sportId: classification.sportId,
          competitionId: classification.competitionId,
          teamId: classification.teamId,
          countryId: classification.countryId,
          matchId: classification.matchId,
          contentAvailability: item.contentAvailability,
          classificationMode: "suggestion"
        });
        this.saveClassificationSuggestions(article.id, classification.suggestions);
        this.addAuditEntry(article.id, "collected", source.id, `Collected from ${source.name}`);
        for (const media of item.media) {
          this.addMedia(article.id, media.url, media.mediaType, media.altText ?? item.title);
        }
        imported += 1;
      }
    });

    importTransaction(parsedItems);

    this.updateSourceCollectionStatus(source.id, imported > 0 || skipped > 0 ? "success" : "empty", imported > 0 ? `${imported} imported, ${skipped} skipped` : "No new items found", now);
    return { source: this.getSourceById(source.id)!, imported, skipped, discovered: parsedItems.length };
  }

  private async fetchFeed(feedUrl: string): Promise<string> {
    const response = await fetch(feedUrl);
    if (!response.ok) {
      throw new Error(`feed_fetch_failed_${response.status}`);
    }
    return response.text();
  }

  private findExistingArticleBySourceUrl(sourceId: string, sourceUrl: string): string | null {
    const row = this.db.prepare(`
      SELECT id FROM news_articles
      WHERE source_id = ? AND source_url = ?
      LIMIT 1
    `).get(sourceId, sourceUrl) as { id: string } | undefined;
    return row?.id ?? null;
  }

  findExistingArticleByFeedItem(sourceId: string, externalId: string, sourceUrl: string): string | null {
    const row = this.db.prepare(`
      SELECT id FROM news_articles
      WHERE source_id = ? AND (external_id = ? OR source_url = ?)
      LIMIT 1
    `).get(sourceId, externalId, sourceUrl) as { id: string } | undefined;
    return row?.id ?? null;
  }

  addMedia(articleId: string, url: string, mediaType: "image" | "video" | "embed" = "image", altText?: string | null): NewsArticleMedia {
    const id = randomUUID();
    const now = new Date().toISOString();
    const statement = this.db.prepare(`
      INSERT INTO news_article_media (id, article_id, media_type, url, alt_text, sort_order, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    statement.run(id, articleId, mediaType, url, altText ?? null, 0, now);
    const media = this.getMediaById(id);
    if (!media) {
      throw new Error("News media was not created");
    }
    return media;
  }

  getMediaById(id: string): NewsArticleMedia | null {
    const row = this.db.prepare("SELECT * FROM news_article_media WHERE id = ?").get(id) as any;
    if (!row) return null;
    return {
      id: row.id,
      articleId: row.article_id,
      mediaType: row.media_type,
      url: row.url,
      altText: row.alt_text ?? null,
      sortOrder: row.sort_order,
      createdAt: row.created_at
    };
  }

  listMedia(articleId: string): NewsArticleMedia[] {
    const rows = this.db.prepare("SELECT * FROM news_article_media WHERE article_id = ? ORDER BY sort_order ASC, created_at ASC").all(articleId) as any[];
    return rows.map((row) => ({
      id: row.id,
      articleId: row.article_id,
      mediaType: row.media_type,
      url: row.url,
      altText: row.alt_text ?? null,
      sortOrder: row.sort_order,
      createdAt: row.created_at
    }));
  }

  addLink(articleId: string, url: string, label?: string | null): NewsArticleLink {
    const id = randomUUID();
    const now = new Date().toISOString();
    const statement = this.db.prepare(`
      INSERT INTO news_article_links (id, article_id, url, label, sort_order, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    statement.run(id, articleId, url, label ?? null, 0, now);
    const link = this.getLinkById(id);
    if (!link) {
      throw new Error("News link was not created");
    }
    return link;
  }

  getLinkById(id: string): NewsArticleLink | null {
    const row = this.db.prepare("SELECT * FROM news_article_links WHERE id = ?").get(id) as any;
    if (!row) return null;
    return {
      id: row.id,
      articleId: row.article_id,
      url: row.url,
      label: row.label ?? null,
      sortOrder: row.sort_order,
      createdAt: row.created_at
    };
  }

  listLinks(articleId: string): NewsArticleLink[] {
    const rows = this.db.prepare("SELECT * FROM news_article_links WHERE article_id = ? ORDER BY sort_order ASC, created_at ASC").all(articleId) as any[];
    return rows.map((row) => ({
      id: row.id,
      articleId: row.article_id,
      url: row.url,
      label: row.label ?? null,
      sortOrder: row.sort_order,
      createdAt: row.created_at
    }));
  }

  addAuditEntry(articleId: string, action: string, actorId?: string | null, note?: string | null): NewsArticleAuditEntry {
    const id = randomUUID();
    const now = new Date().toISOString();
    const normalizedActorId = this.normalizeActorId(actorId);

    try {
      const statement = this.db.prepare(`
        INSERT INTO news_article_audit (id, article_id, actor_id, action, note, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      statement.run(id, articleId, normalizedActorId, action, note ?? null, now);
      const entry = this.getAuditEntryById(id);
      if (!entry) {
        throw new Error("News audit entry was not created");
      }
      return entry;
    } catch (error) {
      const sqliteError = error as Error & { code?: string };
      if (sqliteError.code === "SQLITE_CONSTRAINT_FOREIGNKEY") {
        return {
          id,
          articleId,
          actorId: normalizedActorId,
          action,
          note: note ?? null,
          createdAt: now
        };
      }
      throw error;
    }
  }

  getAuditEntryById(id: string): NewsArticleAuditEntry | null {
    const row = this.db.prepare("SELECT * FROM news_article_audit WHERE id = ?").get(id) as any;
    if (!row) return null;
    return {
      id: row.id,
      articleId: row.article_id,
      actorId: row.actor_id ?? null,
      action: row.action,
      note: row.note ?? null,
      createdAt: row.created_at
    };
  }

  listAudit(articleId: string): NewsArticleAuditEntry[] {
    const rows = this.db.prepare("SELECT * FROM news_article_audit WHERE article_id = ? ORDER BY created_at DESC").all(articleId) as any[];
    return rows.map((row) => ({
      id: row.id,
      articleId: row.article_id,
      actorId: row.actor_id ?? null,
      action: row.action,
      note: row.note ?? null,
      createdAt: row.created_at
    }));
  }

  saveResearchResult(articleId: string, result: NewsResearchResult): NewsResearchResult {
    const now = new Date().toISOString();
    const payload = JSON.stringify(result);
    const existing = this.db.prepare("SELECT id FROM news_article_research_results WHERE article_id = ?").get(articleId) as { id: string } | undefined;

    if (existing) {
      this.db.prepare(`
        UPDATE news_article_research_results
        SET query = ?, research_json = ?, updated_at = ?
        WHERE id = ?
      `).run(result.query, payload, now, existing.id);
      return result;
    }

    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO news_article_research_results (id, article_id, query, research_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, articleId, result.query, payload, now, now);
    return result;
  }

  getResearchResult(articleId: string): NewsResearchResult | null {
    const row = this.db.prepare(`
      SELECT research_json, query
      FROM news_article_research_results
      WHERE article_id = ?
      ORDER BY updated_at DESC
      LIMIT 1
    `).get(articleId) as { research_json?: string | null } | undefined;

    if (!row?.research_json) {
      return null;
    }

    try {
      return JSON.parse(row.research_json) as NewsResearchResult;
    } catch {
      return null;
    }
  }

  private normalizeActorId(actorId?: string | null): string | null {
    if (!actorId) {
      return null;
    }

    const trimmed = actorId.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private serializeBodyBlocks(blocks?: NewsArticleBodyBlock[] | null): string | null {
    if (!blocks?.length) return null;
    return JSON.stringify(blocks.filter((block) => {
      if (!block || typeof block !== "object" || typeof block.type !== "string") return false;
      if (block.type === "paragraph") return typeof block.text === "string" && block.text.trim().length > 0;
      if (!("url" in block) || typeof block.url !== "string") return false;
      try {
        const parsed = new URL(block.url);
        return (parsed.protocol === "http:" || parsed.protocol === "https:") && !parsed.username && !parsed.password;
      } catch {
        return false;
      }
    }));
  }

  private normalizeCategoryInputs(input: Array<NewsArticleCategoryInput | string> | null | undefined): NewsArticleCategoryInput[] {
    if (!input) {
      return [];
    }

    return input.filter((entry): entry is NewsArticleCategoryInput => {
      if (typeof entry === "string") {
        return false;
      }

      return Boolean(entry?.categoryType && entry?.entityId);
    });
  }

  private deriveLegacyCategoryInputs(article: Partial<Pick<NewsArticle, "sportId" | "competitionId" | "teamId" | "countryId" | "matchId">>): NewsArticleCategoryInput[] {
    const categories: NewsArticleCategoryInput[] = [];
    const pairs: Array<["sport" | "competition" | "team" | "country" | "match", string | null | undefined]> = [
      ["sport", article.sportId],
      ["competition", article.competitionId],
      ["team", article.teamId],
      ["country", article.countryId],
      ["match", article.matchId]
    ];

    for (const [categoryType, entityId] of pairs) {
      if (entityId) {
        categories.push({ categoryType, entityId });
      }
    }

    return categories;
  }

  private syncArticleCategories(articleId: string, categoryInputs: Array<NewsArticleCategoryInput | string>, classificationStatus: NewsClassificationStatus = "approved"): void {
    const deduped = new Map<string, NewsArticleCategoryInput>();
    for (const entry of this.normalizeCategoryInputs(categoryInputs)) {
      deduped.set(`${entry.categoryType}:${entry.entityId}`, entry);
    }

    this.db.prepare("DELETE FROM news_article_categories WHERE article_id = ? AND classification_status = 'approved'").run(articleId);
    const insert = this.db.prepare(`
      INSERT INTO news_article_categories (id, article_id, category_type, entity_id, confidence, reason, classification_source, classification_status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const now = new Date().toISOString();
    for (const entry of deduped.values()) {
      insert.run(randomUUID(), articleId, entry.categoryType, entry.entityId, classificationStatus === "approved" ? 100 : 0, null, classificationStatus === "approved" ? "editorial" : "deterministic", classificationStatus, now, now);
    }
  }

  listArticleCategories(articleId: string): NewsArticleCategory[] {
    const rows = this.db.prepare("SELECT * FROM news_article_categories WHERE article_id = ? ORDER BY created_at ASC, category_type ASC").all(articleId) as any[];
    return rows.map((row) => ({
      id: row.id,
      articleId: row.article_id,
      categoryType: row.category_type,
      entityId: row.entity_id,
      confidence: Number(row.confidence ?? 100),
      reason: row.reason ?? null,
      classificationSource: row.classification_source ?? "editorial",
      classificationStatus: row.classification_status ?? "approved",
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  listApprovedCategories(articleId: string): NewsArticleCategory[] {
    return this.listArticleCategories(articleId).filter((category) => category.classificationStatus === "approved");
  }

  listClassificationSuggestions(articleId: string): NewsArticleCategory[] {
    return this.listArticleCategories(articleId).filter((category) => category.classificationStatus !== "approved");
  }

  saveClassificationSuggestions(articleId: string, suggestions: NewsClassificationSuggestion[]): NewsArticleCategory[] {
    const transaction = this.db.transaction(() => {
      const now = new Date().toISOString();
      for (const suggestion of suggestions) {
        const existing = this.db.prepare("SELECT id, classification_status FROM news_article_categories WHERE article_id = ? AND category_type = ? AND entity_id = ?").get(articleId, suggestion.categoryType, suggestion.entityId) as { id: string; classification_status: string } | undefined;
        if (existing?.classification_status === "approved" || existing?.classification_status === "rejected") continue;
        if (existing) {
          this.db.prepare("UPDATE news_article_categories SET confidence = ?, reason = ?, classification_source = ?, classification_status = 'suggested', updated_at = ? WHERE id = ?").run(suggestion.confidence, suggestion.reason, suggestion.classificationSource, now, existing.id);
        } else {
          this.db.prepare("INSERT INTO news_article_categories (id, article_id, category_type, entity_id, confidence, reason, classification_source, classification_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'suggested', ?, ?)").run(randomUUID(), articleId, suggestion.categoryType, suggestion.entityId, suggestion.confidence, suggestion.reason, suggestion.classificationSource, now, now);
        }
      }
    });
    transaction();
    return this.listClassificationSuggestions(articleId);
  }

  saveAiClassificationSuggestions(articleId: string, suggestions: NewsClassificationSuggestion[]): NewsArticleCategory[] {
    const transaction = this.db.transaction(() => {
      const now = new Date().toISOString();
      for (const suggestion of suggestions) {
        const existing = this.db.prepare("SELECT id, classification_status, classification_source FROM news_article_categories WHERE article_id = ? AND category_type = ? AND entity_id = ?").get(articleId, suggestion.categoryType, suggestion.entityId) as { id: string; classification_status: string; classification_source: string } | undefined;
        if (existing?.classification_status === "approved" || existing?.classification_status === "rejected" || existing?.classification_source === "deterministic") continue;
        if (existing) {
          this.db.prepare("UPDATE news_article_categories SET confidence = ?, reason = ?, classification_source = 'ai', classification_status = 'suggested', updated_at = ? WHERE id = ?").run(suggestion.confidence, suggestion.reason, now, existing.id);
        } else {
          this.db.prepare("INSERT INTO news_article_categories (id, article_id, category_type, entity_id, confidence, reason, classification_source, classification_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'ai', 'suggested', ?, ?)").run(randomUUID(), articleId, suggestion.categoryType, suggestion.entityId, suggestion.confidence, suggestion.reason, now, now);
        }
      }
    });
    transaction();
    return this.listClassificationSuggestions(articleId);
  }

  approveCategory(categoryId: string, articleId?: string): NewsArticleCategory | null {
    const transaction = this.db.transaction(() => {
      const result = this.db.prepare("UPDATE news_article_categories SET classification_status = 'approved', updated_at = ? WHERE id = ? AND (? IS NULL OR article_id = ?)").run(new Date().toISOString(), categoryId, articleId ?? null, articleId ?? null);
      if (!result.changes) return false;
      return true;
    });
    if (!transaction()) return null;
    const row = this.db.prepare("SELECT article_id FROM news_article_categories WHERE id = ?").get(categoryId) as { article_id: string } | undefined;
    if (!row) return null;
    this.syncLegacyScalarProjection(row.article_id);
    return this.listArticleCategories(row.article_id).find((category) => category.id === categoryId) ?? null;
  }

  rejectCategory(categoryId: string, articleId?: string): NewsArticleCategory | null {
    const result = this.db.prepare("UPDATE news_article_categories SET classification_status = 'rejected', updated_at = ? WHERE id = ? AND (? IS NULL OR article_id = ?)").run(new Date().toISOString(), categoryId, articleId ?? null, articleId ?? null);
    if (!result.changes) return null;
    const row = this.db.prepare("SELECT article_id FROM news_article_categories WHERE id = ?").get(categoryId) as { article_id: string } | undefined;
    return row ? this.listArticleCategories(row.article_id).find((category) => category.id === categoryId) ?? null : null;
  }

  approveCategories(articleId: string, categoryIds: string[]): NewsArticleCategory[] {
    const transaction = this.db.transaction(() => {
      const now = new Date().toISOString();
      for (const categoryId of [...new Set(categoryIds)]) this.db.prepare("UPDATE news_article_categories SET classification_status = 'approved', updated_at = ? WHERE id = ? AND article_id = ? AND classification_status != 'rejected'").run(now, categoryId, articleId);
    });
    transaction();
    this.syncLegacyScalarProjection(articleId);
    return this.listApprovedCategories(articleId);
  }

  addManualCategory(articleId: string, categoryType: NewsArticleCategory["categoryType"], entityId: string): NewsArticleCategory {
    const validTables: Record<NewsArticleCategory["categoryType"], string> = { team: "teams", competition: "competitions", country: "countries", sport: "sports", match: "matches" };
    if (!this.db.prepare(`SELECT id FROM ${validTables[categoryType]} WHERE id = ?`).get(entityId)) throw new Error("classification_entity_not_found");
    const existing = this.db.prepare("SELECT id FROM news_article_categories WHERE article_id = ? AND category_type = ? AND entity_id = ?").get(articleId, categoryType, entityId) as { id: string } | undefined;
    if (existing) {
      const category = this.listArticleCategories(articleId).find((item) => item.id === existing.id);
      if (category?.classificationStatus === "rejected") this.db.prepare("UPDATE news_article_categories SET classification_status = 'approved', classification_source = 'editorial', confidence = 100, reason = 'Manually assigned by editor.', updated_at = ? WHERE id = ?").run(new Date().toISOString(), existing.id);
      else if (category) return category;
    } else {
      const now = new Date().toISOString();
      this.db.prepare("INSERT INTO news_article_categories (id, article_id, category_type, entity_id, confidence, reason, classification_source, classification_status, created_at, updated_at) VALUES (?, ?, ?, ?, 100, 'Manually assigned by editor.', 'editorial', 'approved', ?, ?)").run(randomUUID(), articleId, categoryType, entityId, now, now);
    }
    this.syncLegacyScalarProjection(articleId);
    return this.listArticleCategories(articleId).find((item) => item.categoryType === categoryType && item.entityId === entityId)!;
  }

  removeApprovedCategory(articleId: string, categoryId: string): boolean {
    const result = this.db.prepare("DELETE FROM news_article_categories WHERE id = ? AND article_id = ? AND classification_status = 'approved'").run(categoryId, articleId);
    if (!result.changes) return false;
    this.syncLegacyScalarProjection(articleId);
    return true;
  }

  private syncLegacyScalarProjection(articleId: string): void {
    const primary = (categoryType: string) => this.db.prepare("SELECT entity_id FROM news_article_categories WHERE article_id = ? AND category_type = ? AND classification_status = 'approved' ORDER BY confidence DESC, created_at ASC, entity_id ASC LIMIT 1").get(articleId, categoryType) as { entity_id: string } | undefined;
    this.db.prepare("UPDATE news_articles SET sport_id = ?, competition_id = ?, team_id = ?, country_id = ?, match_id = ?, updated_at = ? WHERE id = ?").run(primary("sport")?.entity_id ?? null, primary("competition")?.entity_id ?? null, primary("team")?.entity_id ?? null, primary("country")?.entity_id ?? null, primary("match")?.entity_id ?? null, new Date().toISOString(), articleId);
  }

  private attachRelations(article: NewsArticle): NewsArticle {
    article.categories = this.listArticleCategories(article.id);
    article.media = this.listMedia(article.id);
    article.links = this.listLinks(article.id);
    article.audit = this.listAudit(article.id);
    return article;
  }
}
