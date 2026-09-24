export function isGiTOGeneratedArticle(article) {
    if (!article) {
        return false;
    }
    return article.contentOrigin === "gito_ai"
        || article.author === "GiTO News"
        || article.author === "GiTO News Assistant"
        || (article.tags ?? []).includes("gito-generated");
}
export function isGiTOFactCheckRequired(article) {
    if (!article) {
        return false;
    }
    return (article.tags ?? []).includes("gito-fact-check-needed");
}
export function isGiTOInsufficientSourceMaterial(article) {
    if (!article) {
        return false;
    }
    return (article.tags ?? []).includes("gito-insufficient-source-material");
}
export function getNormalizedFetchedSourcePreview(article) {
    if (!article || !article.fetchedBody) {
        return null;
    }
    return normalizeFetchedSourceBody(article.fetchedBody);
}
export function getDefaultNewsArticleFilters() {
    return {
        sport: "",
        competition: "",
        team: "",
        status: "",
        source: "",
        search: "",
        generatedOnly: false,
        factCheckOnly: false,
        insufficientOnly: false,
        researchCompletedOnly: false,
        researchFailedOnly: false
    };
}
export function filterNewsArticles(articles, filters) {
    const searchTerm = filters.search.trim().toLowerCase();
    return articles.filter((article) => {
        const sportMatch = !filters.sport || article.sport?.id === filters.sport;
        const competitionMatch = !filters.competition || article.competition?.id === filters.competition;
        const teamMatch = !filters.team || article.team?.id === filters.team;
        const statusMatch = !filters.status || article.status === filters.status;
        const sourceMatch = !filters.source || article.source?.id === filters.source;
        const titleMatch = !searchTerm || article.title.toLowerCase().includes(searchTerm);
        const generatedMatch = !filters.generatedOnly || isGiTOGeneratedArticle(article);
        const factCheckMatch = !filters.factCheckOnly || isGiTOFactCheckRequired(article);
        const insufficientMatch = !filters.insufficientOnly || isGiTOInsufficientSourceMaterial(article);
        const researchCompletedMatch = !filters.researchCompletedOnly || (article.tags ?? []).includes("gito-research-completed");
        const researchFailedMatch = !filters.researchFailedOnly || (article.tags ?? []).includes("gito-research-failed");
        return sportMatch && competitionMatch && teamMatch && statusMatch && sourceMatch && titleMatch && generatedMatch && factCheckMatch && insufficientMatch && researchCompletedMatch && researchFailedMatch;
    });
}
export function shouldClearSelectedArticleAfterDelete(selectedArticleId, deletedIds) {
    return selectedArticleId !== null && deletedIds.includes(selectedArticleId);
}
export function shouldClearEditingArticleAfterDelete(editingArticleId, deletedIds) {
    return editingArticleId !== null && deletedIds.includes(editingArticleId);
}
export function normalizeFetchedSourceBody(input) {
    return String(input)
        .replace(/<\/p>/gi, "\n\n")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/\s+/g, " ")
        .replace(/\n[ \t]+/g, "\n")
        .trim();
}
