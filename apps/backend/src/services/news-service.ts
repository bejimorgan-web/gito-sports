import type { CollectNewsSourceRequest, CreateNewsArticleRequest, CreateNewsSourceRequest, NewsArticle, NewsArticleAuditEntry, NewsArticleCategory, NewsArticleLink, NewsArticleMedia, NewsArticleStatus, NewsQueryOptions, NewsResearchResult, NewsRightsAuditStatus, NewsRightsEvidenceType, NewsSource, NewsSourceRightsAudit, NewsSourceRightsEvidence, NewsSourceRightsEvidenceOrigin, NewsSourceRightsPermission, UpdateNewsArticleRequest, UpdateNewsSourceRequest } from "@gito/shared";
import { normalizeNewsText } from "./news-content-normalizer.js";
import { NewsRepository } from "../repositories/news-repository.js";
import { NewsResearchService } from "./news-research-service.js";
import { NewsClassificationService } from "./news-classification-service.js";
import { AiClassificationUnavailableError, defaultAiNewsClassificationService } from "./ai-news-classification-service.js";
import { fetchPublicTextDocument } from "./news-rss-service.js";

export type FetchArticleContentResult = {
  success: boolean;
  article: NewsArticle | null;
  body: string | null;
  summary: string | null;
  contentOrigin: NewsArticle["contentOrigin"];
  fetchedAt: string | null;
  fetchStatus: NewsArticle["fetchStatus"];
  fetchError: string | null;
  message: string;
};

export class NewsService {
  constructor(
    private readonly repository = new NewsRepository(),
    private readonly researchService = new NewsResearchService()
  ) {}

  createArticle(input: CreateNewsArticleRequest): NewsArticle {
    const article = this.repository.createArticle(input);
    this.repository.addAuditEntry(article.id, "created", input.createdBy ?? null, "Article created");
    return article;
  }

  getArticle(id: string): NewsArticle | null {
    return this.repository.getArticleById(id);
  }

  listArticles(options: NewsQueryOptions = {}): NewsArticle[] {
    return this.repository.listArticles(options);
  }

  getClassification(articleId: string): { approved: NewsArticleCategory[]; suggestions: NewsArticleCategory[] } | null {
    if (!this.repository.getArticleById(articleId)) return null;
    return {
      approved: this.repository.listApprovedCategories(articleId),
      suggestions: this.repository.listClassificationSuggestions(articleId)
    };
  }

  rerunClassification(articleId: string): { approved: NewsArticleCategory[]; suggestions: NewsArticleCategory[] } | null {
    const article = this.repository.getArticleById(articleId);
    if (!article) return null;
    const classifier = new NewsClassificationService(this.repository.getDatabaseFromConstructor());
    const result = classifier.classify({ articleId, title: article.title, summary: article.summary, body: article.body, sourceName: article.sourceName, sourceUrl: article.sourceUrl, tags: article.tags });
    this.repository.saveClassificationSuggestions(articleId, result.suggestions);
    return this.getClassification(articleId);
  }

  async aiClassifyArticle(articleId: string): Promise<{ status: "success" | "unavailable" | "failed"; classification: { approved: NewsArticleCategory[]; suggestions: NewsArticleCategory[] } | null }> {
    const article = this.repository.getArticleById(articleId);
    if (!article) return { status: "failed", classification: null };
    const deterministic = new NewsClassificationService(this.repository.getDatabaseFromConstructor()).classify({ articleId, title: article.title, summary: article.summary, body: article.body, sourceName: article.sourceName, sourceUrl: article.sourceUrl, tags: article.tags });
    this.repository.saveClassificationSuggestions(articleId, deterministic.suggestions);
    try {
      const ai = await defaultAiNewsClassificationService(this.repository.getDatabaseFromConstructor()).classify({ title: article.title, summary: article.summary, normalizedText: article.body, sourceUrl: article.sourceUrl, deterministicSuggestions: deterministic.suggestions }, articleId);
      this.repository.saveAiClassificationSuggestions(articleId, ai);
      return { status: "success", classification: this.getClassification(articleId) };
    } catch (error) {
      if (error instanceof AiClassificationUnavailableError || (error instanceof Error && error.message === "ai_classification_invalid_response")) return { status: "unavailable", classification: this.getClassification(articleId) };
      return { status: "failed", classification: this.getClassification(articleId) };
    }
  }

  approveClassification(articleId: string, categoryId: string): NewsArticleCategory | null {
    const category = this.repository.approveCategory(categoryId, articleId);
    return category?.articleId === articleId ? category : null;
  }

  rejectClassification(articleId: string, categoryId: string): NewsArticleCategory | null {
    const category = this.repository.rejectCategory(categoryId, articleId);
    return category?.articleId === articleId ? category : null;
  }

  approveClassifications(articleId: string, categoryIds: string[]): NewsArticleCategory[] | null {
    if (!this.repository.getArticleById(articleId)) return null;
    return this.repository.approveCategories(articleId, categoryIds);
  }

  addManualClassification(articleId: string, categoryType: NewsArticleCategory["categoryType"], entityId: string): NewsArticleCategory | null {
    if (!this.repository.getArticleById(articleId)) return null;
    return this.repository.addManualCategory(articleId, categoryType, entityId);
  }

  removeClassification(articleId: string, categoryId: string): boolean {
    return this.repository.removeApprovedCategory(articleId, categoryId);
  }

  updateArticle(id: string, input: UpdateNewsArticleRequest, actorId?: string | null): NewsArticle | null {
    const article = this.repository.updateArticle(id, input);
    if (article) {
      this.repository.addAuditEntry(article.id, "updated", actorId ?? null, "Article updated");
    }
    return article;
  }

  publishArticle(id: string, actorId?: string | null): NewsArticle | null {
    const article = this.repository.updateArticle(id, { status: "published", publishedAt: new Date().toISOString() });
    if (article) {
      this.repository.addAuditEntry(article.id, "published", actorId ?? null, "Article published");
    }
    return article;
  }

  archiveArticle(id: string, actorId?: string | null): NewsArticle | null {
    const article = this.repository.updateArticle(id, { status: "archived" });
    if (article) {
      this.repository.addAuditEntry(article.id, "archived", actorId ?? null, "Article archived");
    }
    return article;
  }

  deleteArticle(id: string): boolean {
    return this.repository.deleteArticle(id);
  }

  bulkDeleteArticles(ids: string[]): number {
    const validIds = [...new Set(ids.map((id) => String(id).trim()).filter(Boolean))];
    if (validIds.length === 0) {
      return 0;
    }

    return this.repository.bulkDeleteArticles(validIds);
  }

  generateGiTONewsDraft(sourceArticleId: string, actorId?: string | null): NewsArticle | null {
    const sourceArticle = this.repository.getArticleById(sourceArticleId);
    if (!sourceArticle) {
      return null;
    }

    if (this.isGiTOGeneratedArticle(sourceArticle)) {
      throw new Error("cannot_generate_from_generated_article");
    }

    const sourceName = sourceArticle.sourceName ?? sourceArticle.source?.name ?? "Unknown source";
    const sourceUrl = sourceArticle.sourceUrl ?? null;
    const normalizedTitle = normalizeNewsText(sourceArticle.title);
    const normalizedSummary = normalizeNewsText(sourceArticle.summary);
    const normalizedBody = normalizeNewsText(sourceArticle.body ?? sourceArticle.fetchedBody ?? "");

    if (!normalizedSummary && !normalizedBody) {
      return null;
    }

    const sourceText = normalizedBody || normalizedSummary;
    const classification = this.classifySourceMaterial(sourceText);
    const factCheckTag = this.buildGiTOFactCheckTag(sourceText, sourceUrl, classification);
    const generatedTitle = this.buildGiTODraftTitle(sourceArticle, sourceName, normalizedTitle);
    const generatedSummary = this.buildGiTODraftSummary(sourceName, sourceText, classification);
    const draftBody = this.buildGiTOStoryBody(sourceName, sourceUrl, sourceText, classification);
    const insufficientSourceTag = classification === "insufficient_source_material" ? "gito-insufficient-source-material" : null;

    const initialTagSet = new Set<string>([...(sourceArticle.tags ?? []), "gito-generated", "gito-review-required"]);
    if (factCheckTag) {
      initialTagSet.add(factCheckTag);
    }
    if (insufficientSourceTag) {
      initialTagSet.add(insufficientSourceTag);
    }

    const draft = this.createArticle({
      title: generatedTitle,
      summary: generatedSummary,
      body: draftBody,
      status: "review",
      sportId: sourceArticle.sportId ?? null,
      competitionId: sourceArticle.competitionId ?? null,
      teamId: sourceArticle.teamId ?? null,
      countryId: sourceArticle.countryId ?? null,
      matchId: sourceArticle.matchId ?? null,
      sourceId: sourceArticle.sourceId ?? null,
      sourceName,
      sourceUrl,
      author: "GiTO News",
      categories: sourceArticle.categories?.map((category) => ({ categoryType: category.categoryType, entityId: category.entityId })) ?? [],
      tags: Array.from(initialTagSet),
      contentAvailability: normalizedBody ? "full_feed_content" : normalizedSummary ? "summary_only" : "no_content",
      contentOrigin: "gito_ai",
      fetchStatus: "idle"
    });

    const qualityPass = this.validateGiTODraftQuality(sourceText, draft);
    if (!qualityPass) {
      const recoveryBody = this.buildSafeFallbackStoryBody(sourceName, sourceUrl, sourceText);
      const recoveryTags = Array.from(new Set([...(draft.tags ?? []), ...(factCheckTag ? [factCheckTag] : []), "gito-fact-check-needed"]))
        .filter((tag): tag is string => Boolean(tag));
      const updatedDraft = this.updateArticle(draft.id, {
        title: generatedTitle,
        summary: generatedSummary,
        body: recoveryBody,
        status: "review",
        tags: recoveryTags,
        contentOrigin: "gito_ai"
      }, actorId ?? null);

      const auditNote = `Generated GiTO editorial draft from article ${sourceArticle.id}; fact-check review required.`;
      this.repository.addAuditEntry((updatedDraft ?? draft).id, "generated", actorId ?? null, auditNote);
      return updatedDraft ?? draft;
    }

    const auditNote = factCheckTag === "gito-fact-check-needed"
      ? `Generated GiTO editorial draft from article ${sourceArticle.id}; fact-check review required.`
      : `Generated GiTO editorial draft from article ${sourceArticle.id}.`;

    this.repository.addAuditEntry(draft.id, "generated", actorId ?? null, auditNote);
    return draft;
  }

  private buildGiTODraftTitle(article: NewsArticle, sourceName: string, normalizedTitle: string): string {
    const originalTitle = normalizedTitle.trim();
    if (originalTitle) {
      return originalTitle;
    }
    return `Report from ${sourceName}`;
  }

  private buildGiTODraftSummary(sourceName: string, sourceText: string, classification: "insufficient_source_material" | "limited_source_material" | "substantial_source_material"): string {
    const cleanedText = this.cleanDraftText(sourceText);
    const summaryText = this.extractSentence(cleanedText);
    if (!summaryText) {
      return classification === "insufficient_source_material"
        ? `The source material is too limited for a reliable original story from ${sourceName}.`
        : `Limited detail is available from ${sourceName}.`;
    }

    const rewritten = this.stripSourceBoilerplate(this.rephraseSourceSentence(summaryText).trim());
    if (rewritten) {
      return rewritten;
    }

    if (classification === "insufficient_source_material") {
      return `The source material is too limited for a reliable original story from ${sourceName}.`;
    }
    return `Limited detail is available from ${sourceName}.`;
  }

  private buildGiTOStoryBody(sourceName: string, sourceUrl: string | null, sourceText: string, classification: "insufficient_source_material" | "limited_source_material" | "substantial_source_material"): string {
    const normalizedText = this.cleanDraftText(sourceText);
    const sourceSentences = this.extractMeaningfulSentences(normalizedText);
    const substantial = classification === "substantial_source_material";
    const insufficient = classification === "insufficient_source_material";

    const paragraphs: string[] = [];
    if (substantial && sourceSentences.length > 0) {
      const firstSentence = sourceSentences[0] ?? "";
      const lead = this.stripSourceBoilerplate(this.rephraseSourceSentence(firstSentence));
      paragraphs.push(lead || `The available source material points to a significant development from ${sourceName}.`);

      const support = sourceSentences.slice(1, 3).map((sentence) => this.stripSourceBoilerplate(this.rephraseSourceSentence(sentence)))
        .filter((sentence): sentence is string => Boolean(sentence && sentence.length > 12));
      support.forEach((sentence) => paragraphs.push(sentence));
    } else if (sourceSentences.length > 0) {
      const firstSentence = sourceSentences[0] ?? "";
      const lead = this.stripSourceBoilerplate(this.rephraseSourceSentence(firstSentence));
      paragraphs.push(lead || `Limited detail is available from ${sourceName}.`);
      if (!insufficient) {
        const support = sourceSentences.slice(1, 3).map((sentence) => this.stripSourceBoilerplate(this.rephraseSourceSentence(sentence)))
          .filter((sentence): sentence is string => Boolean(sentence && sentence.length > 12));
        support.forEach((sentence) => paragraphs.push(sentence));
      }
    } else {
      const fallback = insufficient
        ? "The source material is too limited to support a reliable original story, and fact-checking is required before publication."
        : `Limited detail is available from ${sourceName}.`;
      paragraphs.push(fallback);
    }

    paragraphs.push(this.buildSourceAttribution(sourceName, sourceUrl));
    return paragraphs.filter(Boolean).join("\n\n");
  }

  private buildSafeFallbackStoryBody(sourceName: string, sourceUrl: string | null, sourceText: string): string {
    const normalizedText = this.cleanDraftText(sourceText);
    const sentence = this.extractSentence(normalizedText) || `Limited detail is available from ${sourceName}.`;
    const lead = this.stripSourceBoilerplate(this.rephraseSourceSentence(sentence));
    return [lead || `Limited detail is available from ${sourceName}.`, this.buildSourceAttribution(sourceName, sourceUrl)].join("\n\n");
  }

  private buildSourceAttribution(sourceName: string, sourceUrl: string | null): string {
    if (sourceUrl) {
      return `Source reference: ${sourceName} (${sourceUrl}).`;
    }
    return `Source reference: ${sourceName}.`;
  }

  private cleanDraftText(text: string): string {
    return String(text)
      .replace(/<[^>]+>/g, " ")
      .replace(/https?:\/\/\S+\.(?:png|jpe?g|gif|webp|svg|bmp)(\?\S*)?/gi, " ")
      .replace(/https?:\/\/[^\s]+/gi, " ")
      .replace(/\b(subscription|subscribe|subscribe now|advertisement|advertisements|sponsored|promo|promotional|related article|recommended|click here|newsletter|image|video|gallery|podcast)\b/gi, " ")
      .replace(/\b(?:According to|Coverage indicates|The report draws on|The main story is about|Latest|Breaking|In a thrilling match)\b[^.]*[.?!]?\s*/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  private isGiTOGeneratedArticle(article: NewsArticle): boolean {
    return article.author === "GiTO News" || article.author === "GiTO News Assistant" || (article.tags ?? []).includes("gito-generated");
  }

  private buildGiTOFactCheckTag(sourceText: string, sourceUrl: string | null, classification?: "insufficient_source_material" | "limited_source_material" | "substantial_source_material"): string | null {
    const resolvedClassification = classification ?? this.classifySourceMaterial(sourceText);
    if (!sourceText || resolvedClassification !== "substantial_source_material" || !sourceUrl) {
      return "gito-fact-check-needed";
    }
    return null;
  }

  private classifySourceMaterial(text: string): "insufficient_source_material" | "limited_source_material" | "substantial_source_material" {
    const normalizedText = this.cleanDraftText(text);
    const sentenceCount = this.extractMeaningfulSentences(normalizedText).length;
    const wordCount = normalizedText.split(/\s+/).filter(Boolean).length;

    if (sentenceCount <= 1 || wordCount < 15) {
      return "insufficient_source_material";
    }

    if (sentenceCount === 2 && wordCount < 18) {
      return "limited_source_material";
    }

    return "substantial_source_material";
  }

  private hasSubstantialSourceMaterial(text: string): boolean {
    return this.classifySourceMaterial(text) === "substantial_source_material";
  }

  private validateGiTODraftQuality(sourceText: string, article: NewsArticle): boolean {
    const body = article.body ?? "";
    const sourceClean = this.cleanDraftText(sourceText);
    const bodyClean = this.cleanDraftText(body);

    if (!bodyClean || article.status !== "review") {
      return false;
    }

    if (/<[^>]+>/.test(body) || /https?:\/\/[^\s]+\.(?:png|jpe?g|gif|webp|svg|bmp)(?:\?[^\s]*)?/i.test(body)) {
      return false;
    }

    if (/According to|Coverage indicates|The report draws on|The main story is about|source attribution/i.test(body)) {
      return false;
    }

    if (/(subscribe|click here|newsletter|advert|sponsored|promo|related article|recommended)/i.test(body)) {
      return false;
    }

    if (!/Source reference:/i.test(body) || !(article.sourceName || article.sourceUrl)) {
      return false;
    }

    if (this.isSubstantiallyIdentical(sourceClean, bodyClean)) {
      return false;
    }

    return true;
  }

  private isSubstantiallyIdentical(sourceText: string, bodyText: string): boolean {
    const sourceWords = this.tokenize(sourceText);
    const bodyWords = this.tokenize(bodyText);
    if (!sourceWords.length || !bodyWords.length) {
      return false;
    }

    const overlap = sourceWords.filter((word) => bodyWords.includes(word)).length;
    const similarity = overlap / Math.max(sourceWords.length, bodyWords.length);
    if (sourceText && bodyText && sourceText === bodyText) {
      return true;
    }
    return similarity >= 0.9;
  }

  private tokenize(value: string): string[] {
    return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  }

  private rephraseSourceSentence(sentence: string): string {
    let normalizedSentence = this.stripSourceBoilerplate(sentence.trim());
    if (!normalizedSentence) {
      return "";
    }

    normalizedSentence = normalizedSentence
      .replace(/^(?:The|A)\s+(?:club|team|side|manager|officials|coach|captain|spokesperson|agency|player)\s+(?:said|added|noted|claimed|explained|highlighted|insisted|warned|told)\s+/i, "")
      .replace(/^(?:Officials|Staff|A spokesperson)\s+(?:said|added|noted|claimed|explained|highlighted|insisted|warned|told)\s+/i, "")
      .replace(/^Star player\s+/i, "")
      .replace(/^\s+/, "");

    normalizedSentence = normalizedSentence.replace(/[.?!]+$/, "").trim();

    const momentumBoost = normalizedSentence.match(/^(?:the\s+)?(?:win|result|performance|display|effort)\s+(?:lifted|boosted|raised|built)\s+momentum\s+ahead of the next fixture$/i);
    if (momentumBoost) {
      return "Momentum is building ahead of the next fixture.";
    }

    const scorelineWin = normalizedSentence.match(/^(.+?)\s+beat\s+(.+?)\s+(\d+[-–]\d+)\s+at home\.?$/i);
    if (scorelineWin) {
      return `${scorelineWin[1]} secured a ${scorelineWin[3]} home win over ${scorelineWin[2]}.`;
    }

    const scoredGoal = normalizedSentence.match(/^(.+?)\s+scored\s+the\s+(.+?)\s+in\s+(.+)\.?$/i);
    if (scoredGoal) {
      return `${scoredGoal[1]} found the decisive moment with ${scoredGoal[2]} in ${scoredGoal[3]}.`;
    }

    const wonMatch = normalizedSentence.match(/^(.+?)\s+won\s+(.+?)\.?$/i);
    if (wonMatch) {
      const subject = wonMatch[1] ?? "The team";
      const result = wonMatch[2] ?? "the match";
      return `${subject} came away with victory in ${this.lowercaseFirst(result)}.`;
    }

    return normalizedSentence.replace(/^([A-Z])/, (_, first: string) => first.toUpperCase());
  }

  private stripSourceBoilerplate(value: string): string {
    return value
      .replace(/^\s*(?:According to|Coverage indicates|The report draws on|The main story is about|Latest|Breaking|In a thrilling match),?\s+/i, "")
      .replace(/^\s+/, "")
      .trim();
  }

  private extractSentence(text: string): string {
    const sentences = text.split(/(?<=[.?!])\s+/).map((item) => item.trim()).filter(Boolean);
    return sentences[0] ?? text;
  }

  private extractMeaningfulSentences(text: string): string[] {
    return this.takeSentences(text, 10)
      .map((sentence) => this.stripSourceBoilerplate(sentence))
      .filter((sentence) => sentence.length > 12 && !/^source reference:/i.test(sentence));
  }

  private takeSentences(text: string, count: number): string[] {
    const sentences = text.split(/(?<=[.?!])\s+/).map((item) => item.trim()).filter(Boolean);
    return sentences.slice(0, Math.max(count, 1));
  }

  private lowercaseFirst(value: string): string {
    if (!value) {
      return value;
    }
    return value.charAt(0).toLowerCase() + value.slice(1);
  }

  createSource(input: CreateNewsSourceRequest): NewsSource {
    return this.repository.createSource(input);
  }

  getSource(id: string): NewsSource | null {
    return this.repository.getSourceById(id);
  }

  listSources(): NewsSource[] {
    return this.repository.listSources();
  }

  updateSource(id: string, input: UpdateNewsSourceRequest): NewsSource | null {
    return this.repository.updateSource(id, input);
  }

  deleteSource(id: string): boolean {
    return this.repository.deleteSource(id);
  }

  researchArticle(sourceArticleId: string): NewsResearchResult {
    const article = this.repository.getArticleById(sourceArticleId);
    if (!article) {
      throw new Error("article_not_found");
    }

    const result = this.researchService.researchArticle({
      sourceArticleId: article.id,
      sourceTitle: article.title,
      sourceSummary: article.summary,
      normalizedSourceBody: article.fetchedBody ?? article.body,
      sourceUrl: article.sourceUrl ?? undefined,
      sourcePublisher: article.sourceName ?? article.source?.name ?? undefined,
      sport: article.sport?.name ?? undefined,
      competition: article.competition?.name ?? undefined,
      team: article.team?.name ?? undefined,
      country: article.country?.name ?? undefined
    });

    this.repository.saveResearchResult(article.id, result);
    return result;
  }

  getResearchResult(sourceArticleId: string): NewsResearchResult | null {
    return this.repository.getResearchResult(sourceArticleId);
  }

  generateOriginalStoryFromResearch(sourceArticleId: string, actorId?: string | null, researchResult?: NewsResearchResult | null): NewsArticle | null {
    const sourceArticle = this.repository.getArticleById(sourceArticleId);
    if (!sourceArticle) {
      return null;
    }

    if (this.isGiTOGeneratedArticle(sourceArticle)) {
      throw new Error("cannot_generate_from_generated_article");
    }

    const result = researchResult ?? this.getResearchResult(sourceArticleId);
    if (!result) {
      throw new Error("research_required");
    }
    const verifiedStatements = result.verifiedFacts.filter((fact: { status: string }) => fact.status === "verified" || fact.status === "strongly_supported");
    const shouldFlagForReview = !verifiedStatements.length || result.confidence === "low" || result.researchStatus === "failed" || result.researchStatus === "insufficient_evidence";

    const title = `${sourceArticle.title}`.trim() || "GiTO original report";
    const summary = verifiedStatements[0]?.statement || sourceArticle.summary || "Limited source material available for an original editorial draft.";
    const bodyParagraphs = [
      verifiedStatements[0]?.statement || "The available source material points to a significant development that requires human review before publication.",
      verifiedStatements[1]?.statement || "The editorial team must verify any disputed detail before publication and should rely on confirmed context rather than unconfirmed speculation.",
      "Source reference: " + (sourceArticle.sourceName ?? "Original source") + (sourceArticle.sourceUrl ? ` (${sourceArticle.sourceUrl})` : ".")
    ];

    const tags = new Set<string>([...(sourceArticle.tags ?? []), "gito-generated", "gito-review-required"]);
    if (shouldFlagForReview) {
      tags.add("gito-fact-check-needed");
      tags.add("gito-insufficient-source-material");
    }

    const draft = this.createArticle({
      title,
      summary,
      body: bodyParagraphs.join("\n\n"),
      status: "review",
      sportId: sourceArticle.sportId ?? null,
      competitionId: sourceArticle.competitionId ?? null,
      teamId: sourceArticle.teamId ?? null,
      countryId: sourceArticle.countryId ?? null,
      matchId: sourceArticle.matchId ?? null,
      sourceId: sourceArticle.sourceId ?? null,
      sourceName: sourceArticle.sourceName ?? sourceArticle.source?.name ?? null,
      sourceUrl: sourceArticle.sourceUrl ?? null,
      author: "GiTO News",
      categories: sourceArticle.categories?.map((category) => ({ categoryType: category.categoryType, entityId: category.entityId })) ?? [],
      tags: Array.from(tags),
      contentAvailability: "full_feed_content",
      contentOrigin: "gito_ai",
      fetchStatus: "idle"
    });

    this.repository.addAuditEntry(draft.id, "generated_original_story", actorId ?? null, `Created original GiTO story from article ${sourceArticle.id} using research evidence.`);
    return draft;
  }

  async collectSource(input: CollectNewsSourceRequest): Promise<{ source: NewsSource; imported: number; skipped: number; discovered: number }> {
    return this.repository.collectSource(input.sourceId);
  }

  async auditSourcePublishingRights(sourceId: string): Promise<NewsSourceRightsAudit> {
    const source = this.repository.getSourceById(sourceId);
    if (!source) {
      throw new Error("source_not_found");
    }

    const checkedAt = new Date().toISOString();
    const auditId = crypto.randomUUID();
    const evidence: NewsSourceRightsEvidence[] = [];
    const permissions: NewsSourceRightsPermission[] = [];

    const publisherOrigin = (() => {
      if (!source.baseUrl) return null;
      try {
        return new URL(source.baseUrl).origin;
      } catch {
        return null;
      }
    })();

    const feedOrigin = (() => {
      if (!source.feedUrl) return null;
      try {
        return new URL(source.feedUrl).origin;
      } catch {
        return null;
      }
    })();

    const candidatePages = new Set<string>();
    if (publisherOrigin) {
      candidatePages.add(`${publisherOrigin}/terms`);
      candidatePages.add(`${publisherOrigin}/terms-of-use`);
      candidatePages.add(`${publisherOrigin}/copyright`);
      candidatePages.add(`${publisherOrigin}/about/copyright`);
      candidatePages.add(`${publisherOrigin}/legal`);
      candidatePages.add(`${publisherOrigin}/privacy-policy`);
      candidatePages.add(`${publisherOrigin}/syndication`);
      candidatePages.add(`${publisherOrigin}/rss`);
      candidatePages.add(`${publisherOrigin}/rss-feed`);
      candidatePages.add(`${publisherOrigin}/feeds`);
      candidatePages.add(`${publisherOrigin}/content-licensing`);
    }

    if (source.baseUrl) {
      candidatePages.add(source.baseUrl);
    }

    if (source.feedUrl) {
      candidatePages.add(source.feedUrl);
    }

    let status: NewsRightsAuditStatus = "unknown";
    let summary = "No clear rights language was found on the publisher's official domain.";
    let reviewNotes = "This is an evidence-based rights audit only and does not grant legal permission.";
    let publisherEvidenceFound = false;
    let feedHostEvidenceFound = false;

    for (const pageUrl of Array.from(candidatePages)) {
      try {
        const response = await fetch(pageUrl, { headers: { "User-Agent": "GiTO-News/1.0 (+Publisher-Rights-Audit)" } });
        if (!response.ok) {
          continue;
        }
        const html = await response.text();
        const cleaned = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ");
        const text = this.stripHtml(cleaned).replace(/\s+/g, " ").trim();
        if (!text) continue;

        const evidenceType = this.detectEvidenceType(pageUrl, text);
        const pageTitle = this.extractTitleFromHtml(html) ?? new URL(pageUrl).hostname;
        const snippet = this.buildEvidenceSnippet(text, evidenceType);
        if (!snippet) continue;

        const pageOrigin = (() => {
          try {
            return new URL(pageUrl).origin;
          } catch {
            return null;
          }
        })();

        const evidenceOrigin: NewsSourceRightsEvidenceOrigin = pageOrigin === publisherOrigin
          ? "publisher"
          : pageOrigin === feedOrigin
            ? "feed_host"
            : "third_party";

        if (evidenceOrigin === "publisher") {
          publisherEvidenceFound = true;
        } else if (evidenceOrigin === "feed_host") {
          feedHostEvidenceFound = true;
        }

        evidence.push({
          id: crypto.randomUUID(),
          auditId,
          evidenceUrl: pageUrl,
          pageTitle,
          evidenceType,
          evidenceDomain: pageOrigin,
          evidenceOrigin,
          snippet,
          checkedAt,
          createdAt: new Date().toISOString()
        } as NewsSourceRightsEvidence);

        if (evidenceOrigin !== "publisher") {
          continue;
        }

        const normalizedText = text.toLowerCase();
        const explicitlyPermits = /republi(c|sh)|syndic|reuse|republish|redistribute|share|copy.*article|full article|summary.*allowed|headline.*allowed|quote.*allowed|link.*required/i.test(normalizedText);
        const explicitlyProhibits = /not.*permit|may not.*republish|no.*republication|no.*reuse|prohibited|unauthorized.*reuse|do not.*republish|cannot.*republish|without permission/i.test(normalizedText);
        const limitedUse = /attribution|original url|required.*link|non-commercial|no modification|no derivatives|limited.*use|summary.*only|headline.*only|excerpt.*only|credit.*required/i.test(normalizedText);

        if (explicitlyPermits && !explicitlyProhibits) {
          status = limitedUse ? "republication_permitted_with_conditions" : "full_republication_permitted";
          summary = limitedUse ? "The publisher appears to permit reuse with conditions." : "The publisher appears to permit republication.";
          reviewNotes = limitedUse ? "Conditions such as attribution or original-link requirements were found." : "Explicit republication permission was found on the official page.";
        } else if (explicitlyProhibits) {
          status = "republication_not_permitted";
          summary = "The publisher explicitly restricts republication or reuse.";
          reviewNotes = "The evidence indicates a prohibition or restriction on publication reuse.";
        } else if (limitedUse) {
          status = "limited_use_only";
          summary = "The publisher allows limited reuse only, with conditions.";
        }
      } catch {
        // Ignore inaccessible pages; record the fact only as evidence if we can access it.
      }
    }

    if (!publisherEvidenceFound) {
      status = "review_required";
      summary = feedHostEvidenceFound
        ? "Rights evidence was found only on the feed host, not on the publisher's official domain."
        : "No authoritative rights language was found on the publisher's official domain.";
      reviewNotes = "The audit remains conservative: publisher-domain evidence is required for republication permissions.";
    }

    const permissionMap: Array<{ permission: NewsSourceRightsPermission["permission"]; allowed: boolean; notes: string; evidenceUrl?: string }> = [
      { permission: "full_article_republication", allowed: status === "full_republication_permitted", notes: status === "full_republication_permitted" ? "Explicit full republication permission found." : "Not confirmed on official evidence." },
      { permission: "headline", allowed: status === "full_republication_permitted" || status === "republication_permitted_with_conditions" || status === "limited_use_only", notes: status === "limited_use_only" ? "Headline use may be allowed within limited-use conditions." : "Unclear from official evidence." },
      { permission: "summary_excerpt", allowed: status === "full_republication_permitted" || status === "republication_permitted_with_conditions" || status === "limited_use_only", notes: status === "limited_use_only" ? "Summary/excerpt use may be permitted under a limited-use policy." : "Not confirmed." },
      { permission: "original_link_reference", allowed: status === "republication_permitted_with_conditions" || status === "limited_use_only" || status === "full_republication_permitted", notes: status === "unknown" ? "Original-link requirement remains unconfirmed." : "Link/reference requirement may apply." },
      { permission: "commercial_use", allowed: false, notes: "Commercial use must be confirmed separately and is not assumed from text rights." },
      { permission: "modification", allowed: false, notes: "Modification is not assumed unless the publisher explicitly permits it." },
      { permission: "attribution", allowed: status === "republication_permitted_with_conditions" || status === "limited_use_only", notes: status === "republication_permitted_with_conditions" ? "Attribution appears required." : "Attribution not confirmed." },
      { permission: "image_reuse", allowed: false, notes: "Image rights are independent from text republication rights." },
      { permission: "video_reuse", allowed: false, notes: "Video rights are independent from text republication rights." },
      { permission: "ai_assisted_original_story", allowed: false, notes: "AI-assisted original narrative rights are not granted by default and require separate review." }
    ];

    for (const permissionEntry of permissionMap) {
      const permission = {
        id: crypto.randomUUID(),
        auditId,
        permission: permissionEntry.permission,
        allowed: Boolean(permissionEntry.allowed),
        notes: permissionEntry.notes,
        evidenceUrl: evidence[0]?.evidenceUrl ?? null,
        createdAt: checkedAt
      } as NewsSourceRightsPermission;
      permissions.push(permission);
    }

    const audit: NewsSourceRightsAudit = {
      id: auditId,
      sourceId,
      status,
      summary,
      reviewNotes,
      administratorDecision: null,
      checkedAt,
      createdAt: checkedAt,
      updatedAt: checkedAt,
      evidence,
      permissions
    };

    this.repository.updateSource(sourceId, {
      rightsStatus: status,
      rightsLastCheckedAt: checkedAt,
      rightsReviewNotes: reviewNotes,
      rightsAdministratorDecision: null,
      rightsDecisionAt: null,
      rightsAuditSummary: summary
    });

    const db = this.repository.getDatabaseFromConstructor();
    db.prepare(`
      INSERT INTO news_source_rights_audits (id, source_id, status, summary, review_notes, administrator_decision, checked_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(audit.id, sourceId, audit.status, audit.summary ?? null, audit.reviewNotes ?? null, audit.administratorDecision ?? null, audit.checkedAt, audit.createdAt, audit.updatedAt);

    for (const item of audit.evidence) {
      db.prepare(`
        INSERT INTO news_source_rights_evidence (id, audit_id, evidence_url, page_title, evidence_type, evidence_domain, evidence_origin, matched_rule, snippet, checked_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(item.id, audit.id, item.evidenceUrl, item.pageTitle ?? null, item.evidenceType, item.evidenceDomain ?? null, item.evidenceOrigin ?? null, item.matchedRule ?? null, item.snippet ?? null, item.checkedAt, item.createdAt);
    }

    for (const item of audit.permissions) {
      db.prepare(`
        INSERT INTO news_source_rights_permissions (id, audit_id, permission, allowed, notes, evidence_url, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(item.id, audit.id, item.permission, item.allowed ? 1 : 0, item.notes ?? null, item.evidenceUrl ?? null, item.createdAt);
    }

    return audit;
  }

  private stripHtml(value: string): string {
    return value
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, " & ")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/\s+/g, " ")
      .trim();
  }

  private extractTitleFromHtml(html: string): string | null {
    const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = match?.[1];
    if (!title) return null;
    return this.stripHtml(title).slice(0, 180) || null;
  }

  private detectEvidenceType(pageUrl: string, text: string): NewsRightsEvidenceType {
    const lowerUrl = pageUrl.toLowerCase();
    const lowerText = text.toLowerCase();
    if (/(rss|feed)/i.test(lowerUrl) || /(rss|feed)/i.test(lowerText)) return "rss_terms";
    if (/(terms|usage|policy)/i.test(lowerUrl) || /(terms of use|usage policy)/i.test(lowerText)) return "terms_of_use";
    if (/(copyright|rights)/i.test(lowerUrl) || /(copyright|rights)/i.test(lowerText)) return "copyright_policy";
    if (/(syndic|republication|reuse|redistribute)/i.test(lowerUrl) || /(syndic|reuse|republish|redistribute)/i.test(lowerText)) return "republication_policy";
    if (/(licen|license)/i.test(lowerUrl) || /(license|licensing)/i.test(lowerText)) return "licensing";
    return "other";
  }

  private buildEvidenceSnippet(text: string, evidenceType: NewsRightsEvidenceType): string | null {
    const cleaned = this.stripHtml(text);
    const lower = cleaned.toLowerCase();
    const keywords = [
      "republish",
      "reuse",
      "copyright",
      "rights",
      "syndication",
      "licence",
      "license",
      "attribution",
      "original url",
      "no modification",
      "non-commercial",
      "summary",
      "headline",
      "terms of use"
    ];

    const matchIndex = keywords.findIndex((keyword) => lower.includes(keyword));
    if (matchIndex === -1) {
      return cleaned.length > 250 ? `${cleaned.slice(0, 250)}…` : cleaned || null;
    }

    const keyword = keywords[matchIndex]!;
    const index = lower.indexOf(keyword);
    const start = Math.max(0, index - 120);
    const end = Math.min(cleaned.length, index + 220);
    const snippet = cleaned.slice(start, end).trim();
    return snippet || null;
  }

  addMedia(articleId: string, url: string, mediaType: "image" | "video" | "embed" = "image", altText?: string | null): NewsArticleMedia {
    return this.repository.addMedia(articleId, url, mediaType, altText);
  }

  listMedia(articleId: string): NewsArticleMedia[] {
    return this.repository.listMedia(articleId);
  }

  addLink(articleId: string, url: string, label?: string | null): NewsArticleLink {
    return this.repository.addLink(articleId, url, label);
  }

  listLinks(articleId: string): NewsArticleLink[] {
    return this.repository.listLinks(articleId);
  }

  addAuditEntry(articleId: string, action: string, actorId?: string | null, note?: string | null): NewsArticleAuditEntry {
    return this.repository.addAuditEntry(articleId, action, actorId, note);
  }

  listAudit(articleId: string): NewsArticleAuditEntry[] {
    return this.repository.listAudit(articleId);
  }

  async fetchArticleContent(articleId: string): Promise<FetchArticleContentResult> {
    const existing = this.repository.getArticleById(articleId);
    if (!existing) {
      return {
        success: false,
        article: null,
        body: null,
        summary: null,
        contentOrigin: "summary",
        fetchedAt: null,
        fetchStatus: "failed",
        fetchError: "article_not_found",
        message: "Article not found."
      };
    }

    if (!existing.sourceUrl) {
      const failedArticle = this.repository.updateArticle(articleId, {
        contentOrigin: existing.contentOrigin ?? "summary",
        fetchedAt: new Date().toISOString(),
        fetchStatus: "failed",
        fetchError: "source_url_required"
      });

      return {
        success: false,
        article: failedArticle,
        body: existing.body ?? null,
        summary: existing.summary ?? null,
        contentOrigin: failedArticle?.contentOrigin ?? existing.contentOrigin ?? "summary",
        fetchedAt: failedArticle?.fetchedAt ?? null,
        fetchStatus: failedArticle?.fetchStatus ?? "failed",
        fetchError: "source_url_required",
        message: "Article source URL is required before fetching full content."
      };
    }

    try {
      const document = await fetchPublicTextDocument(existing.sourceUrl, "text/html, application/xhtml+xml;q=0.9");
      const html = document.text;
      if (/just a moment|checking your browser|cf-chl-|challenge-platform|captcha|access denied|automated access/i.test(html)) {
        throw new Error("automated_access_blocked");
      }
      const extracted = this.extractArticleContentFromHtml(html);
      const fetchedBody = extracted.body ?? extracted.summary ?? null;

      if (!fetchedBody) {
        throw new Error("no_article_content_found");
      }

      const timestamp = new Date().toISOString();
      const nextBody = existing.body && existing.body.trim().length > 0 ? existing.body : fetchedBody;
      const nextSummary = existing.summary && existing.summary.trim().length > 0
        ? existing.summary
        : extracted.summary ?? existing.summary ?? null;

      const updated = this.repository.updateArticle(articleId, {
        summary: nextSummary,
        body: nextBody,
        contentAvailability: "full_feed_content",
        contentOrigin: "fetched_page",
        fetchedBody,
        fetchedAt: timestamp,
        fetchStatus: "success",
        fetchError: null
      });

      this.repository.addAuditEntry(articleId, "content_fetched", null, "Fetched article page content from source URL");

      return {
        success: true,
        article: updated,
        body: updated?.body ?? null,
        summary: updated?.summary ?? null,
        contentOrigin: updated?.contentOrigin ?? "fetched_page",
        fetchedAt: updated?.fetchedAt ?? null,
        fetchStatus: updated?.fetchStatus ?? "success",
        fetchError: null,
        message: "Full article content fetched successfully."
      };
    } catch (error) {
      const message = this.classifyArticleFetchError(error);
      const timestamp = new Date().toISOString();
      const updated = this.repository.updateArticle(articleId, {
        contentOrigin: existing.contentOrigin ?? "summary",
        fetchedAt: timestamp,
        fetchStatus: "failed",
        fetchError: message
      });

      this.repository.addAuditEntry(articleId, "content_fetch_failed", null, `Content fetch failed: ${message}`);

      return {
        success: false,
        article: updated,
        body: existing.body ?? null,
        summary: existing.summary ?? null,
        contentOrigin: updated?.contentOrigin ?? existing.contentOrigin ?? "summary",
        fetchedAt: updated?.fetchedAt ?? null,
        fetchStatus: updated?.fetchStatus ?? "failed",
        fetchError: message,
        message: `Could not fetch article content: ${message}`
      };
    }
  }

  private classifyArticleFetchError(error: unknown): string {
    const raw = error instanceof Error ? error.message.toLowerCase() : "";
    if (raw.includes("invalid") || raw.includes("scheme_not_allowed") || raw.includes("credentials_not_allowed")) return "invalid_source_url";
    if (raw.includes("private_network")) return "source_private_network_blocked";
    if (raw.includes("abort") || raw.includes("timeout") || raw.includes("timed out")) return "source_timeout";
    if (raw.includes("redirect_limit")) return "redirect_limit_exceeded";
    if (raw.includes("content_type_not_supported")) return "unsupported_page";
    if (raw.includes("no_article_content_found")) return "content_not_found";
    if (raw.includes("automated_access") || raw.includes("captcha") || raw.includes("cloudflare") || raw.includes("blocked")) return "automated_access_blocked";
    if (raw.includes("fetch_failed_401") || raw.includes("fetch_failed_403") || raw.includes("fetch_failed_429")) return "source_access_denied";
    if (raw.includes("fetch_failed_")) return "source_unavailable";
    return "fetch_failed";
  }

  private extractArticleContentFromHtml(html: string): { body: string | null; summary: string | null } {
    const scripts = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
    const candidates: unknown[] = [];

    for (const match of scripts) {
      const payload = match[1];
      if (typeof payload !== "string" || payload.trim().length === 0) {
        continue;
      }

      try {
        const parsed = JSON.parse(payload);
        if (Array.isArray(parsed)) {
          candidates.push(...parsed);
        } else if (parsed && typeof parsed === "object") {
          candidates.push(parsed);
        }
      } catch {
        // Ignore malformed JSON-LD blocks.
      }
    }

    const flatCandidates: unknown[] = [];
    const visit = (value: unknown) => {
      if (!value || typeof value !== "object") {
        return;
      }

      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }

      flatCandidates.push(value);
      Object.values(value as Record<string, unknown>).forEach(visit);
    };

    for (const candidate of candidates) {
      visit(candidate);
    }

    for (const candidate of flatCandidates) {
      if (!candidate || typeof candidate !== "object") {
        continue;
      }

      const record = candidate as Record<string, unknown>;
      const typeValue = record["@type"];
      const types = Array.isArray(typeValue) ? typeValue : [typeValue];
      const isArticle = types.some((entry) => typeof entry === "string" && /NewsArticle|Article/i.test(entry));
      if (!isArticle) {
        continue;
      }

      const bodyText = this.extractTextValue(record["articleBody"]) ?? this.extractTextValue(record["text"]) ?? null;
      const summaryText = this.extractTextValue(record["description"]) ?? this.extractTextValue(record["headline"]) ?? null;
      if (bodyText || summaryText) {
        return {
          body: bodyText,
          summary: summaryText
        };
      }
    }

    return {
      body: null,
      summary: null
    };
  }

  private extractTextValue(value: unknown): string | null {
    if (!value) {
      return null;
    }

    if (typeof value === "string") {
      return value.trim() || null;
    }

    if (typeof value === "number") {
      return String(value);
    }

    if (Array.isArray(value)) {
      for (const entry of value) {
        const text = this.extractTextValue(entry);
        if (text) {
          return text;
        }
      }
      return null;
    }

    if (typeof value === "object") {
      const record = value as Record<string, unknown>;
      const name = this.extractTextValue(record["text"]);
      if (name) {
        return name;
      }
      const articleBody = this.extractTextValue(record["articleBody"]);
      if (articleBody) {
        return articleBody;
      }
      const description = this.extractTextValue(record["description"]);
      if (description) {
        return description;
      }
    }

    return null;
  }
}
