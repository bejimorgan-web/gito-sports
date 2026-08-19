import { Router } from "express";
import type { Request } from "express";
import { protectedRoute } from "../middleware/protected.js";
import type { AuthenticatedRequest } from "../middleware/protected.js";
import { NewsService } from "../services/news-service.js";
import { buildNewsRssXml, NewsRssService, validateRssUrl } from "../services/news-rss-service.js";
import { getWebRssUserMessage, NewsWebRssGeneratorService } from "../services/news-web-rss-generator-service.js";

export const newsRouter = Router();
const newsService = new NewsService();
const newsRssService = new NewsRssService();
const webRssGeneratorService = new NewsWebRssGeneratorService();

function backendOrigin(req: Request): string {
  return `${req.protocol}://${req.get("host")}`;
}

function absoluteGeneratedFeedUrl(req: Request, feed: { feedUrl?: string }) {
  return { ...feed, feedUrl: feed.feedUrl ? `${backendOrigin(req)}${feed.feedUrl}` : feed.feedUrl };
}

newsRouter.get("/", (_req, res) => {
  res.json({ ok: true, module: "news", articles: [] });
});

newsRouter.get("/health", (_req, res) => {
  res.json({ ok: true, module: "news" });
});

newsRouter.get("/rss.xml", (req, res) => {
  try {
    const publishedArticles = newsService.listArticles({ status: "published", limit: 500, offset: 0 });
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    res.setHeader("Content-Type", "application/rss+xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300");
    res.send(buildNewsRssXml(publishedArticles, baseUrl));
  } catch {
    res.status(500).json({ error: "failed_to_generate_news_rss" });
  }
});

newsRouter.post("/generated-rss-sources", protectedRoute, async (req, res) => {
  try {
    const name = String(req.body?.name ?? "").trim();
    const sourceUrl = String(req.body?.sourceUrl ?? "").trim();
    if (!name || !sourceUrl) {
      res.status(400).json({ error: "generated_rss_name_and_url_required" });
      return;
    }
    const feed = webRssGeneratorService.createFeed(name, sourceUrl);
    const refreshed = await webRssGeneratorService.refreshFeed(feed.id);
    res.status(201).json(absoluteGeneratedFeedUrl(req, refreshed));
  } catch (error) {
    const message = error instanceof Error ? error.message : "webpage_crawl_failed";
    const status = message === "no_articles_discovered" ? 422 : 400;
    res.status(status).json({ error: message, message: getWebRssUserMessage(error) });
  }
});

newsRouter.get("/generated-rss-sources", protectedRoute, (req, res) => {
  res.json(webRssGeneratorService.listFeeds().map((feed) => absoluteGeneratedFeedUrl(req, feed)));
});

newsRouter.post("/generated-rss-sources/:id/refresh", protectedRoute, async (req, res) => {
  try {
    const feedId = req.params.id;
    if (!feedId) {
      res.status(400).json({ error: "generated_rss_feed_id_required" });
      return;
    }
    res.json(absoluteGeneratedFeedUrl(req, await webRssGeneratorService.refreshFeed(feedId)));
  } catch (error) {
    const message = error instanceof Error ? error.message : "webpage_crawl_failed";
    res.status(message === "no_articles_discovered" ? 422 : 400).json({ error: message, message: getWebRssUserMessage(error) });
  }
});

newsRouter.get("/generated-rss-sources/:id/articles", protectedRoute, (req, res) => {
  const feedId = req.params.id;
  if (!feedId || !webRssGeneratorService.getFeed(feedId)) {
    res.status(404).json({ error: "generated_rss_feed_not_found" });
    return;
  }
  res.json(webRssGeneratorService.listArticles(feedId));
});

newsRouter.delete("/generated-rss-sources/:id", protectedRoute, (req, res) => {
  const feedId = req.params.id;
  if (!feedId || !webRssGeneratorService.deleteFeed(feedId)) {
    res.status(404).json({ error: "generated_rss_feed_not_found" });
    return;
  }
  res.status(204).send();
});

newsRouter.get("/generated-rss/:token.xml", (req, res) => {
  try {
    const token = req.params.token;
    if (!token) {
      res.status(404).send("Not found");
      return;
    }
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const xml = webRssGeneratorService.buildXml(token, baseUrl);
    res.setHeader("Content-Type", "application/rss+xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300");
    res.send(xml);
  } catch {
    res.status(404).send("Not found");
  }
});

newsRouter.post("/rss-sources", protectedRoute, (req, res) => {
  try {
    const feedUrl = String(req.body?.feedUrl ?? "").trim();
    const name = String(req.body?.name ?? "").trim();
    if (!name || !feedUrl) {
      res.status(400).json({ error: "rss_source_name_and_url_required" });
      return;
    }
    const trustedToken = webRssGeneratorService.getTrustedFeedToken(feedUrl, backendOrigin(req));
    const url = trustedToken ? new URL(feedUrl) : validateRssUrl(feedUrl);
    res.status(201).json(newsService.createSource({ name, sourceType: "external", baseUrl: url.origin, feedUrl: url.toString(), enabled: true }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "rss_source_invalid";
    res.status(400).json({ error: message });
  }
});

newsRouter.get("/rss-sources", protectedRoute, (_req, res) => {
  res.json(newsService.listSources().filter((source) => Boolean(source.feedUrl)));
});

newsRouter.delete("/rss-sources/:id", protectedRoute, (req, res) => {
  try {
    const sourceId = req.params.id;
    if (!sourceId) {
      res.status(400).json({ error: "rss_source_id_required" });
      return;
    }
    const deleted = newsService.deleteSource(sourceId);
    if (!deleted) {
      res.status(404).json({ error: "rss_source_not_found" });
      return;
    }
    res.status(204).send();
  } catch {
    res.status(500).json({ error: "failed_to_delete_rss_source" });
  }
});

newsRouter.post("/rss-sources/:id/fetch", protectedRoute, async (req, res) => {
  try {
    const sourceId = req.params.id;
    if (!sourceId) {
      res.status(400).json({ error: "rss_source_id_required" });
      return;
    }
    const source = newsService.getSource(sourceId);
    if (!source || !source.feedUrl) {
      res.status(404).json({ error: "rss_source_not_found" });
      return;
    }
    res.json(await newsRssService.fetchSource(source, {
      fetchTrustedInternalFeed: (feedUrl) => {
        const token = webRssGeneratorService.getTrustedFeedToken(feedUrl, backendOrigin(req));
        return token ? webRssGeneratorService.buildXml(token, backendOrigin(req)) : null;
      }
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "rss_fetch_failed";
    res.status(400).json({ error: "rss_fetch_failed", message });
  }
});

newsRouter.get("/articles", async (_req, res) => {
  try {
    const articles = newsService.listArticles({
      status: (_req.query.status as any) ?? undefined,
      search: (_req.query.search as string) ?? undefined,
      limit: Number(_req.query.limit ?? 50),
      offset: Number(_req.query.offset ?? 0)
    });
    res.json(articles);
  } catch (error) {
    res.status(500).json({ error: "failed_to_list_articles" });
  }
});

newsRouter.post("/articles", protectedRoute, (req, res) => {
  try {
    const authRequest = req as AuthenticatedRequest;
    const article = newsService.createArticle({
      ...req.body,
      createdBy: authRequest.operator?.id ?? null
    });
    res.status(201).json(article);
  } catch (error) {
    res.status(500).json({ error: "failed_to_create_article" });
  }
});

newsRouter.get("/articles/:id", (req, res) => {
  try {
    const article = newsService.getArticle(req.params.id);
    if (!article) {
      res.status(404).json({ error: "article_not_found" });
      return;
    }
    res.json(article);
  } catch (error) {
    res.status(500).json({ error: "failed_to_get_article" });
  }
});

newsRouter.get("/articles/:id/classification", protectedRoute, (req, res) => {
  const classification = newsService.getClassification(String(req.params.id ?? ""));
  if (!classification) { res.status(404).json({ error: "article_not_found" }); return; }
  res.json({ data: classification });
});

newsRouter.post("/articles/:id/classification/rerun", protectedRoute, (req, res) => {
  const classification = newsService.rerunClassification(String(req.params.id ?? ""));
  if (!classification) { res.status(404).json({ error: "article_not_found" }); return; }
  res.json({ data: classification });
});

newsRouter.post("/articles/:id/classification/ai", protectedRoute, async (req, res) => {
  const result = await newsService.aiClassifyArticle(String(req.params.id ?? ""));
  if (!result.classification) { res.status(404).json({ error: "article_not_found" }); return; }
  if (result.status !== "success") { res.status(503).json({ error: "ai_classification_unavailable", data: result.classification }); return; }
  res.json({ data: result.classification });
});

newsRouter.post("/articles/:id/classification/approve", protectedRoute, (req, res) => {
  const categoryIds = Array.isArray(req.body?.categoryIds) ? req.body.categoryIds.map(String) : [];
  const categories = newsService.approveClassifications(String(req.params.id ?? ""), categoryIds);
  if (!categories) { res.status(404).json({ error: "article_not_found" }); return; }
  res.json({ data: categories });
});

newsRouter.post("/articles/:id/classification/manual", protectedRoute, (req, res) => {
  try {
    const category = newsService.addManualClassification(String(req.params.id ?? ""), req.body?.categoryType, String(req.body?.entityId ?? ""));
    if (!category) { res.status(404).json({ error: "article_not_found" }); return; }
    res.status(201).json({ data: category });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(message === "classification_entity_not_found" ? 404 : 400).json({ error: message });
  }
});

newsRouter.post("/articles/:id/classification/:categoryId/approve", protectedRoute, (req, res) => {
  const category = newsService.approveClassification(String(req.params.id ?? ""), String(req.params.categoryId ?? ""));
  if (!category) { res.status(404).json({ error: "classification_not_found" }); return; }
  res.json({ data: category });
});

newsRouter.post("/articles/:id/classification/:categoryId/reject", protectedRoute, (req, res) => {
  const category = newsService.rejectClassification(String(req.params.id ?? ""), String(req.params.categoryId ?? ""));
  if (!category) { res.status(404).json({ error: "classification_not_found" }); return; }
  res.json({ data: category });
});

newsRouter.delete("/articles/:id/classification/:categoryId", protectedRoute, (req, res) => {
  if (!newsService.removeClassification(String(req.params.id ?? ""), String(req.params.categoryId ?? ""))) { res.status(404).json({ error: "approved_classification_not_found" }); return; }
  res.status(204).send();
});

newsRouter.put("/articles/:id", protectedRoute, (req, res) => {
  try {
    const articleId = req.params.id;
    if (!articleId) {
      res.status(400).json({ error: "article_id_required" });
      return;
    }
    const authRequest = req as AuthenticatedRequest;
    const article = newsService.updateArticle(articleId, req.body, authRequest.operator?.id ?? null);
    if (!article) {
      res.status(404).json({ error: "article_not_found" });
      return;
    }
    res.json(article);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[news] failed to update article", { articleId: req.params.id, message });
    res.status(500).json({ error: "failed_to_update_article", message });
  }
});

newsRouter.post("/articles/:id/publish", protectedRoute, (req, res) => {
  try {
    const articleId = req.params.id;
    if (!articleId) {
      res.status(400).json({ error: "article_id_required" });
      return;
    }
    const authRequest = req as AuthenticatedRequest;
    const article = newsService.publishArticle(articleId, authRequest.operator?.id ?? null);
    if (!article) {
      res.status(404).json({ error: "article_not_found" });
      return;
    }
    res.json(article);
  } catch (error) {
    res.status(500).json({ error: "failed_to_publish_article" });
  }
});

newsRouter.post("/articles/:id/archive", protectedRoute, (req, res) => {
  try {
    const articleId = req.params.id;
    if (!articleId) {
      res.status(400).json({ error: "article_id_required" });
      return;
    }
    const authRequest = req as AuthenticatedRequest;
    const article = newsService.archiveArticle(articleId, authRequest.operator?.id ?? null);
    if (!article) {
      res.status(404).json({ error: "article_not_found" });
      return;
    }
    res.json(article);
  } catch (error) {
    res.status(500).json({ error: "failed_to_archive_article" });
  }
});

newsRouter.post("/articles/:id/generate-gito-draft", protectedRoute, (req, res) => {
  try {
    const articleId = req.params.id;
    if (!articleId) {
      res.status(400).json({ error: "article_id_required" });
      return;
    }

    const authRequest = req as AuthenticatedRequest;
    const draft = newsService.generateGiTONewsDraft(articleId, authRequest.operator?.id ?? null);
    if (!draft) {
      res.status(404).json({ error: "article_not_found" });
      return;
    }

    res.status(201).json(draft);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[news] failed to generate GiTO draft", { articleId: req.params.id, message });
    if (message === "cannot_generate_from_generated_article") {
      res.status(400).json({ error: message });
      return;
    }
    if (message === "research_required" || message === "research_failed") {
      res.status(409).json({ error: message, message: "Research must be completed successfully before generating an original story." });
      return;
    }
    res.status(500).json({ error: "failed_to_generate_gito_draft" });
  }
});

newsRouter.post("/articles/:id/research", protectedRoute, (req, res) => {
  try {
    const articleId = req.params.id;
    if (!articleId) {
      res.status(400).json({ error: "article_id_required" });
      return;
    }

    const result = newsService.researchArticle(articleId);
    res.status(201).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[news] failed to research article", { articleId: req.params.id, message });
    if (message === "article_not_found") {
      res.status(404).json({ error: "article_not_found" });
      return;
    }
    res.status(500).json({ error: "failed_to_research_article", message });
  }
});

newsRouter.get("/articles/:id/research", (req, res) => {
  try {
    const articleId = req.params.id;
    if (!articleId) {
      res.status(400).json({ error: "article_id_required" });
      return;
    }

    const result = newsService.getResearchResult(articleId);
    if (!result) {
      res.status(404).json({ error: "research_result_not_found" });
      return;
    }

    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[news] failed to get research result", { articleId: req.params.id, message });
    res.status(500).json({ error: "failed_to_get_research_result", message });
  }
});

newsRouter.post("/articles/:id/generate-original", protectedRoute, (req, res) => {
  try {
    const articleId = req.params.id;
    if (!articleId) {
      res.status(400).json({ error: "article_id_required" });
      return;
    }

    const authRequest = req as AuthenticatedRequest;
    const article = newsService.generateOriginalStoryFromResearch(articleId, authRequest.operator?.id ?? null, req.body?.researchResult ?? null);
    if (!article) {
      res.status(404).json({ error: "article_not_found" });
      return;
    }

    res.status(201).json(article);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[news] failed to generate original story", { articleId: req.params.id, message });
    if (message === "cannot_generate_from_generated_article") {
      res.status(400).json({ error: message });
      return;
    }
    res.status(500).json({ error: "failed_to_generate_original_story", message });
  }
});

newsRouter.delete("/articles/:id", protectedRoute, (req, res) => {
  try {
    const articleId = req.params.id;
    if (!articleId) {
      res.status(400).json({ error: "article_id_required" });
      return;
    }
    const deleted = newsService.deleteArticle(articleId);
    if (!deleted) {
      res.status(404).json({ error: "article_not_found" });
      return;
    }
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: "failed_to_delete_article" });
  }
});

newsRouter.post("/articles/bulk-delete", protectedRoute, (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const validIds = ids.map((id: unknown) => String(id).trim()).filter((id: string) => id.length > 0);
    if (validIds.length === 0) {
      res.status(400).json({ error: "article_ids_required" });
      return;
    }
    const deletedCount = newsService.bulkDeleteArticles(validIds);
    res.json({ deletedCount });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[news] failed to bulk delete articles", { message });
    res.status(500).json({ error: "failed_to_bulk_delete_articles", message });
  }
});

newsRouter.post("/articles/:id/fetch-content", protectedRoute, async (req, res) => {
  try {
    const articleId = req.params.id;
    if (!articleId) {
      res.status(400).json({ error: "article_id_required" });
      return;
    }

    const result = await newsService.fetchArticleContent(articleId);
    if (!result.article) {
      res.status(404).json({ error: "article_not_found" });
      return;
    }

    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[news] failed to fetch article content", { articleId: req.params.id, message });
    res.status(500).json({ error: "failed_to_fetch_article_content", message });
  }
});

newsRouter.post("/articles/:id/media", protectedRoute, (req, res) => {
  try {
    const articleId = req.params.id;
    if (!articleId) {
      res.status(400).json({ error: "article_id_required" });
      return;
    }
    const media = newsService.addMedia(articleId, req.body.url, req.body.mediaType, req.body.altText);
    res.status(201).json(media);
  } catch (error) {
    res.status(500).json({ error: "failed_to_add_media" });
  }
});

newsRouter.get("/articles/:id/media", (req, res) => {
  try {
    const articleId = req.params.id;
    if (!articleId) {
      res.status(400).json({ error: "article_id_required" });
      return;
    }
    res.json(newsService.listMedia(articleId));
  } catch (error) {
    res.status(500).json({ error: "failed_to_list_media" });
  }
});

newsRouter.post("/articles/:id/links", protectedRoute, (req, res) => {
  try {
    const articleId = req.params.id;
    if (!articleId) {
      res.status(400).json({ error: "article_id_required" });
      return;
    }
    const link = newsService.addLink(articleId, req.body.url, req.body.label);
    res.status(201).json(link);
  } catch (error) {
    res.status(500).json({ error: "failed_to_add_link" });
  }
});

newsRouter.get("/articles/:id/links", (req, res) => {
  try {
    const articleId = req.params.id;
    if (!articleId) {
      res.status(400).json({ error: "article_id_required" });
      return;
    }
    res.json(newsService.listLinks(articleId));
  } catch (error) {
    res.status(500).json({ error: "failed_to_list_links" });
  }
});

newsRouter.get("/sources", (req, res) => {
  try {
    res.json(newsService.listSources());
  } catch (error) {
    res.status(500).json({ error: "failed_to_list_sources" });
  }
});

newsRouter.post("/sources", protectedRoute, (req, res) => {
  try {
    res.status(201).json(newsService.createSource(req.body));
  } catch (error) {
    res.status(500).json({ error: "failed_to_create_source" });
  }
});

newsRouter.get("/sources/:id", (req, res) => {
  try {
    const sourceId = req.params.id;
    if (!sourceId) {
      res.status(400).json({ error: "source_id_required" });
      return;
    }
    const source = newsService.getSource(sourceId);
    if (!source) {
      res.status(404).json({ error: "source_not_found" });
      return;
    }
    res.json(source);
  } catch (error) {
    res.status(500).json({ error: "failed_to_get_source" });
  }
});

newsRouter.put("/sources/:id", protectedRoute, (req, res) => {
  try {
    const sourceId = req.params.id;
    if (!sourceId) {
      res.status(400).json({ error: "source_id_required" });
      return;
    }
    const source = newsService.updateSource(sourceId, req.body);
    if (!source) {
      res.status(404).json({ error: "source_not_found" });
      return;
    }
    res.json(source);
  } catch (error) {
    res.status(500).json({ error: "failed_to_update_source" });
  }
});

newsRouter.delete("/sources/:id", protectedRoute, (req, res) => {
  try {
    const sourceId = req.params.id;
    if (!sourceId) {
      res.status(400).json({ error: "source_id_required" });
      return;
    }
    const deleted = newsService.deleteSource(sourceId);
    if (!deleted) {
      res.status(404).json({ error: "source_not_found" });
      return;
    }
    res.status(204).send();
  } catch (error) {
    const typedError = error as Error & { code?: string };
    console.error("[news] failed to delete source", { sourceId: req.params.id, error: typedError.message });
    res.status(500).json({ error: "failed_to_delete_source", message: typedError.message });
  }
});

newsRouter.post("/sources/:id/audit-rights", protectedRoute, async (req, res) => {
  try {
    const sourceId = req.params.id;
    if (!sourceId) {
      res.status(400).json({ error: "source_id_required" });
      return;
    }
    const audit = await newsService.auditSourcePublishingRights(sourceId);
    res.json(audit);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[news] failed to audit source rights", { sourceId: req.params.id, message });
    res.status(500).json({ error: "failed_to_audit_source_rights", message });
  }
});

newsRouter.post("/sources/:id/collect", protectedRoute, async (req, res) => {
  try {
    const sourceId = req.params.id;
    if (!sourceId) {
      res.status(400).json({ error: "source_id_required" });
      return;
    }
    const result = await newsService.collectSource({ sourceId });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: "failed_to_collect_source" });
  }
});

export default newsRouter;
