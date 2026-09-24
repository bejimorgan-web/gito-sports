import { request } from "../../services/api-client";
export async function listNewsArticles() {
    return request("/news/articles");
}
export async function createNewsArticle(input, accessToken) {
    return request("/news/articles", {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(input)
    });
}
export async function updateNewsArticle(articleId, input, accessToken) {
    return request(`/news/articles/${articleId}`, {
        method: "PUT",
        headers: { authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(input)
    });
}
export async function publishNewsArticle(articleId, accessToken) {
    return request(`/news/articles/${articleId}/publish`, {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}` }
    });
}
export async function archiveNewsArticle(articleId, accessToken) {
    return request(`/news/articles/${articleId}/archive`, {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}` }
    });
}
export async function generateGiTONewsDraft(articleId, accessToken) {
    return request(`/news/articles/${articleId}/generate-gito-draft`, {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}` }
    });
}
export async function researchNewsArticle(articleId, accessToken) {
    return request(`/news/articles/${articleId}/research`, {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}` }
    });
}
export async function getNewsResearchResult(articleId, accessToken) {
    return request(`/news/articles/${articleId}/research`, {
        headers: { authorization: `Bearer ${accessToken}` }
    });
}
export async function listNewsRssSources(accessToken) {
    return request("/news/rss-sources", { headers: { authorization: `Bearer ${accessToken}` } });
}
export async function createNewsRssSource(name, feedUrl, accessToken) {
    return request("/news/rss-sources", { method: "POST", headers: { authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ name, feedUrl }) });
}
export async function deleteNewsRssSource(sourceId, accessToken) {
    return request(`/news/rss-sources/${sourceId}`, { method: "DELETE", headers: { authorization: `Bearer ${accessToken}` } });
}
export async function fetchNewsRssSource(sourceId, accessToken) {
    return request(`/news/rss-sources/${sourceId}/fetch`, { method: "POST", headers: { authorization: `Bearer ${accessToken}` } });
}
export async function generateGiTOOriginalStory(articleId, researchResult, accessToken) {
    return request(`/news/articles/${articleId}/generate-original`, {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ researchResult })
    });
}
export async function deleteNewsArticle(articleId, accessToken) {
    return request(`/news/articles/${articleId}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${accessToken}` }
    });
}
export async function bulkDeleteNewsArticles(articleIds, accessToken) {
    return request("/news/articles/bulk-delete", {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ ids: articleIds })
    });
}
export async function listNewsSources() {
    return request("/news/sources");
}
export async function createNewsSource(input, accessToken) {
    return request("/news/sources", {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(input)
    });
}
export async function updateNewsSource(sourceId, input, accessToken) {
    return request(`/news/sources/${sourceId}`, {
        method: "PUT",
        headers: { authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(input)
    });
}
export async function deleteNewsSource(sourceId, accessToken) {
    return request(`/news/sources/${sourceId}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${accessToken}` }
    });
}
export async function collectNewsSource(sourceId, accessToken) {
    return request(`/news/sources/${sourceId}/collect`, {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}` }
    });
}
export async function auditNewsSourcePublishingRights(sourceId, accessToken) {
    return request(`/news/sources/${sourceId}/audit-rights`, {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}` }
    });
}
export async function fetchNewsArticleContent(articleId, accessToken) {
    return request(`/news/articles/${articleId}/fetch-content`, {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}` }
    });
}
