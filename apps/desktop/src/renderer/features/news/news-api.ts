import type {
  CollectNewsSourceRequest,
  CreateNewsArticleRequest,
  CreateNewsSourceRequest,
  NewsArticle,
  NewsResearchResult,
  NewsSource,
  NewsSourceRightsAudit,
  UpdateNewsArticleRequest,
  UpdateNewsSourceRequest
} from "@gito/shared";

import { request } from "../../services/api-client";

export async function listNewsArticles(): Promise<NewsArticle[]> {
  return request<NewsArticle[]>("/news/articles");
}

export async function createNewsArticle(input: CreateNewsArticleRequest, accessToken: string): Promise<NewsArticle> {
  return request<NewsArticle>("/news/articles", {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(input)
  });
}

export async function updateNewsArticle(articleId: string, input: UpdateNewsArticleRequest, accessToken: string): Promise<NewsArticle> {
  return request<NewsArticle>(`/news/articles/${articleId}`, {
    method: "PUT",
    headers: { authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(input)
  });
}

export async function publishNewsArticle(articleId: string, accessToken: string): Promise<NewsArticle> {
  return request<NewsArticle>(`/news/articles/${articleId}/publish`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` }
  });
}

export async function archiveNewsArticle(articleId: string, accessToken: string): Promise<NewsArticle> {
  return request<NewsArticle>(`/news/articles/${articleId}/archive`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` }
  });
}

export async function generateGiTONewsDraft(articleId: string, accessToken: string): Promise<NewsArticle> {
  return request<NewsArticle>(`/news/articles/${articleId}/generate-gito-draft`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` }
  });
}

export async function researchNewsArticle(articleId: string, accessToken: string): Promise<NewsResearchResult> {
  return request<NewsResearchResult>(`/news/articles/${articleId}/research`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` }
  });
}

export async function getNewsResearchResult(articleId: string, accessToken: string): Promise<NewsResearchResult> {
  return request<NewsResearchResult>(`/news/articles/${articleId}/research`, {
    headers: { authorization: `Bearer ${accessToken}` }
  });
}

export async function listNewsRssSources(accessToken: string): Promise<NewsSource[]> {
  return request<NewsSource[]>("/news/rss-sources", { headers: { authorization: `Bearer ${accessToken}` } });
}

export async function createNewsRssSource(name: string, feedUrl: string, accessToken: string): Promise<NewsSource> {
  return request<NewsSource>("/news/rss-sources", { method: "POST", headers: { authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ name, feedUrl }) });
}

export async function deleteNewsRssSource(sourceId: string, accessToken: string): Promise<void> {
  return request<void>(`/news/rss-sources/${sourceId}`, { method: "DELETE", headers: { authorization: `Bearer ${accessToken}` } });
}

export async function fetchNewsRssSource(sourceId: string, accessToken: string): Promise<{ sourceId: string; fetchedItems: number; importedItems: number; skippedDuplicates: number; failedItems: number }> {
  return request(`/news/rss-sources/${sourceId}/fetch`, { method: "POST", headers: { authorization: `Bearer ${accessToken}` } });
}

export async function generateGiTOOriginalStory(articleId: string, researchResult: NewsResearchResult, accessToken: string): Promise<NewsArticle> {
  return request<NewsArticle>(`/news/articles/${articleId}/generate-original`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ researchResult })
  });
}

export async function deleteNewsArticle(articleId: string, accessToken: string): Promise<void> {
  return request<void>(`/news/articles/${articleId}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${accessToken}` }
  });
}

export async function bulkDeleteNewsArticles(articleIds: string[], accessToken: string): Promise<{ deletedCount: number }> {
  return request<{ deletedCount: number }>("/news/articles/bulk-delete", {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ ids: articleIds })
  });
}

export async function listNewsSources(): Promise<NewsSource[]> {
  return request<NewsSource[]>("/news/sources");
}

export async function createNewsSource(input: CreateNewsSourceRequest, accessToken: string): Promise<NewsSource> {
  return request<NewsSource>("/news/sources", {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(input)
  });
}

export async function updateNewsSource(sourceId: string, input: UpdateNewsSourceRequest, accessToken: string): Promise<NewsSource> {
  return request<NewsSource>(`/news/sources/${sourceId}`, {
    method: "PUT",
    headers: { authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(input)
  });
}

export async function deleteNewsSource(sourceId: string, accessToken: string): Promise<void> {
  return request<void>(`/news/sources/${sourceId}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${accessToken}` }
  });
}

export async function collectNewsSource(sourceId: string, accessToken: string): Promise<{ source: NewsSource; imported: number; skipped: number }> {
  return request<{ source: NewsSource; imported: number; skipped: number }>(`/news/sources/${sourceId}/collect`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` }
  });
}

export async function auditNewsSourcePublishingRights(sourceId: string, accessToken: string): Promise<NewsSourceRightsAudit> {
  return request<NewsSourceRightsAudit>(`/news/sources/${sourceId}/audit-rights`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` }
  });
}

export async function fetchNewsArticleContent(articleId: string, accessToken: string): Promise<{
  success: boolean;
  article: NewsArticle | null;
  body: string | null;
  summary: string | null;
  contentOrigin: NewsArticle["contentOrigin"];
  fetchedAt: string | null;
  fetchStatus: NewsArticle["fetchStatus"];
  fetchError: string | null;
  message: string;
}> {
  return request<{
    success: boolean;
    article: NewsArticle | null;
    body: string | null;
    summary: string | null;
    contentOrigin: NewsArticle["contentOrigin"];
    fetchedAt: string | null;
    fetchStatus: NewsArticle["fetchStatus"];
    fetchError: string | null;
    message: string;
  }>(`/news/articles/${articleId}/fetch-content`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` }
  });
}
