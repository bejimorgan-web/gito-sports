import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from "react";
import { createSlug } from "@gito/shared";
import { apiClient } from "../../services/api-client";
import { getFilteredCategoryOptions, getSelectedCategoryEntityId, sanitizeNewsCategoryRows } from "./news-category-filters";
import { filterNewsArticles, isGiTOFactCheckRequired, isGiTOGeneratedArticle, isGiTOInsufficientSourceMaterial, shouldClearEditingArticleAfterDelete, shouldClearSelectedArticleAfterDelete } from "./news-workspace-helpers";
import { NewsClassificationPanel } from "./NewsClassificationPanel";
const sectionItems = [
    { key: "overview", label: "Overview" },
    { key: "incoming", label: "Incoming News" },
    { key: "articles", label: "Articles" },
    { key: "sources", label: "Sources" },
    { key: "rss", label: "RSS Sources" },
    { key: "web-rss", label: "Web Page → RSS" },
    { key: "published", label: "Published" }
];
const statusLabels = {
    draft: "Draft",
    review: "Review",
    published: "Published",
    archived: "Archived"
};
const sourceTypeLabels = {
    external: "External",
    partner: "Partner",
    wire: "Wire",
    internal: "Internal"
};
const rightsStatusLabels = {
    unknown: "Unknown",
    full_republication_permitted: "Full republication permitted",
    republication_permitted_with_conditions: "Permitted with conditions",
    limited_use_only: "Limited use only",
    republication_not_permitted: "Not permitted",
    review_required: "Review required"
};
const rightsEvidenceTypeLabels = {
    rss_terms: "RSS / feed terms",
    terms_of_use: "Terms of use",
    copyright_policy: "Copyright policy",
    republication_policy: "Republication policy",
    syndication: "Syndication policy",
    licensing: "Licensing",
    other: "Other"
};
const rightsPermissionLabels = {
    full_article_republication: "Full article republication",
    headline: "Headline",
    summary_excerpt: "Summary / excerpt",
    original_link_reference: "Original link / reference",
    commercial_use: "Commercial use",
    modification: "Modification",
    attribution: "Attribution",
    image_reuse: "Image reuse",
    video_reuse: "Video reuse",
    ai_assisted_original_story: "AI-assisted original story"
};
const emptyArticleForm = () => ({
    title: "",
    summary: "",
    body: "",
    bodyBlocks: [],
    sourceId: "",
    sourceName: "",
    sourceUrl: "",
    tags: "",
    mediaReferences: "",
    outboundLinks: "",
    status: "draft",
    categories: []
});
const emptySourceForm = () => ({
    id: "",
    name: "",
    sourceType: "external",
    baseUrl: "",
    feedUrl: "",
    enabled: true
});
function formatDate(value) {
    if (!value) {
        return "—";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return "—";
    }
    return date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric"
    });
}
function getArticleThumbnail(article) {
    return article.media?.find((media) => media.mediaType === "image")?.url ?? null;
}
function getArticleCategories(article) {
    return article.categories?.map((category) => `${category.categoryType}:${category.entityId}`).join(", ") || "Uncategorized";
}
function normalizeFetchedSourceBody(input) {
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
function getContentAvailability(article) {
    if (!article) {
        return "No content";
    }
    const availability = article.contentAvailability;
    if (availability === "full_feed_content") {
        return "Full feed content";
    }
    if (availability === "summary_only") {
        return "Summary only";
    }
    if (availability === "no_content") {
        if (article.body && article.summary && article.body !== article.summary) {
            return "Full feed content";
        }
        return article.summary || article.body ? "Summary only" : "No content";
    }
    return article.summary || article.body ? "Summary only" : "No content";
}
export function NewsWorkspaceScreen({ accessToken }) {
    const [activeSection, setActiveSection] = useState("overview");
    const [articles, setArticles] = useState([]);
    const [sources, setSources] = useState([]);
    const [rssSources, setRssSources] = useState([]);
    const [rssSourceName, setRssSourceName] = useState("");
    const [rssFeedUrl, setRssFeedUrl] = useState("");
    const [rssFetchResult, setRssFetchResult] = useState({});
    const [generatedFeeds, setGeneratedFeeds] = useState([]);
    const [webRssUrl, setWebRssUrl] = useState("");
    const [webRssName, setWebRssName] = useState("");
    const [webRssLoading, setWebRssLoading] = useState(false);
    const [webRssPreview, setWebRssPreview] = useState({});
    const [sports, setSports] = useState([]);
    const [countries, setCountries] = useState([]);
    const [competitions, setCompetitions] = useState([]);
    const [teams, setTeams] = useState([]);
    const [hosts, setHosts] = useState([]);
    const [matches, setMatches] = useState([]);
    const [competitionTeamIds, setCompetitionTeamIds] = useState({});
    const [isLoading, setIsLoading] = useState(true);
    const [statusMessage, setStatusMessage] = useState("News workspace ready.");
    const [articleFilters, setArticleFilters] = useState({
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
    });
    const [articleForm, setArticleForm] = useState(emptyArticleForm());
    const [editingArticleId, setEditingArticleId] = useState(null);
    const [selectedArticleId, setSelectedArticleId] = useState(null);
    const [sourceForm, setSourceForm] = useState(emptySourceForm());
    const [editingSourceId, setEditingSourceId] = useState(null);
    const [sourceAuditDetails, setSourceAuditDetails] = useState({});
    const [isGeneratingDraft, setIsGeneratingDraft] = useState(false);
    const [fetchingArticleContentId, setFetchingArticleContentId] = useState(null);
    const [selectedArticleIds, setSelectedArticleIds] = useState([]);
    const [isPublishingArticleId, setIsPublishingArticleId] = useState(null);
    const [approvingClassificationId, setApprovingClassificationId] = useState(null);
    const [approvingMultipleClassifications, setApprovingMultipleClassifications] = useState(false);
    const [savingArticleStatus, setSavingArticleStatus] = useState(null);
    const [deletingArticleId, setDeletingArticleId] = useState(null);
    const [deletingArticles, setDeletingArticles] = useState(false);
    const [researchSourceArticleId, setResearchSourceArticleId] = useState(null);
    const [researchResult, setResearchResult] = useState(null);
    const [researchLoading, setResearchLoading] = useState(false);
    const [researchState, setResearchState] = useState("idle");
    const [researchError, setResearchError] = useState(null);
    const [isResearchPanelOpen, setIsResearchPanelOpen] = useState(false);
    const [researchTab, setResearchTab] = useState("original");
    const [classification, setClassification] = useState(null);
    const [selectedClassificationIds, setSelectedClassificationIds] = useState([]);
    const [aiClassificationStatus, setAiClassificationStatus] = useState("idle");
    const loadData = async () => {
        try {
            setIsLoading(true);
            const [articleData, sourceData, rssSourceData, generatedFeedData, sportData, countryData, competitionData, teamData, hostData, matchData] = await Promise.all([
                apiClient.listNewsArticles(),
                apiClient.listNewsSources(),
                apiClient.listNewsRssSources(accessToken),
                apiClient.listGeneratedNewsRssFeeds(accessToken),
                apiClient.listSports(),
                apiClient.listCountries(),
                apiClient.listCompetitions(),
                apiClient.listTeams(),
                apiClient.listHosts(),
                apiClient.listMatches()
            ]);
            setArticles(articleData);
            setSources(sourceData);
            setRssSources(rssSourceData);
            setGeneratedFeeds(generatedFeedData);
            setSports(sportData);
            setCountries(countryData);
            setCompetitions(competitionData);
            setTeams(teamData);
            setHosts(hostData);
            setMatches(matchData);
            setStatusMessage("News data loaded.");
        }
        catch (error) {
            const message = error instanceof Error ? error.message : "Unable to load news data.";
            setStatusMessage(message);
        }
        finally {
            setIsLoading(false);
        }
    };
    useEffect(() => {
        void loadData();
    }, []);
    useEffect(() => {
        if (!researchSourceArticleId) {
            setResearchResult(null);
            setResearchState("idle");
            setResearchLoading(false);
            return;
        }
        let cancelled = false;
        setResearchState("idle");
        setResearchLoading(false);
        setResearchError(null);
        void apiClient.getNewsResearchResult(researchSourceArticleId, accessToken)
            .then((result) => {
            if (cancelled)
                return;
            setResearchResult(result);
            setResearchState("success");
        })
            .catch((error) => {
            if (cancelled)
                return;
            const message = error instanceof Error ? error.message : "Research is not available yet.";
            const missingResearchResult = /research_result_not_found|not_found|404|unavailable/i.test(message);
            setResearchResult(null);
            setResearchState(missingResearchResult ? "idle" : "failed");
            setResearchError(missingResearchResult ? null : message);
        });
        return () => {
            cancelled = true;
        };
    }, [accessToken, researchSourceArticleId]);
    useEffect(() => {
        if (!selectedArticleId || !accessToken) {
            setClassification(null);
            setSelectedClassificationIds([]);
            return;
        }
        void apiClient.getNewsClassification(selectedArticleId, accessToken).then((result) => {
            setClassification(result);
            setSelectedClassificationIds([]);
        }).catch(() => setClassification(null));
    }, [accessToken, selectedArticleId]);
    useEffect(() => {
        const selectedCompetitionId = getSelectedCategoryEntityId(articleForm.categories, "competition");
        if (!selectedCompetitionId || competitionTeamIds[selectedCompetitionId]) {
            return;
        }
        void (async () => {
            try {
                const competitionTeams = await apiClient.listCompetitionTeams(selectedCompetitionId);
                setCompetitionTeamIds((current) => ({
                    ...current,
                    [selectedCompetitionId]: competitionTeams.map((team) => team.id)
                }));
            }
            catch {
                setCompetitionTeamIds((current) => ({
                    ...current,
                    [selectedCompetitionId]: []
                }));
            }
        })();
    }, [articleForm.categories, competitionTeamIds]);
    const summary = useMemo(() => {
        const totalArticles = articles.length;
        const drafts = articles.filter((article) => article.status === "draft").length;
        const awaitingReview = articles.filter((article) => article.status === "review").length;
        const published = articles.filter((article) => article.status === "published").length;
        const enabledSources = sources.filter((source) => source.enabled).length;
        return {
            totalArticles,
            drafts,
            awaitingReview,
            published,
            enabledSources
        };
    }, [articles, sources]);
    const filteredArticles = useMemo(() => {
        return filterNewsArticles(articles, articleFilters);
    }, [articleFilters, articles]);
    const incomingArticles = useMemo(() => {
        return filteredArticles.filter((article) => article.status !== "published" && article.status !== "archived");
    }, [filteredArticles]);
    const publishedArticles = useMemo(() => {
        return articles.filter((article) => article.status === "published");
    }, [articles]);
    const selectedArticle = useMemo(() => {
        if (!selectedArticleId) {
            return incomingArticles[0] ?? null;
        }
        return articles.find((article) => article.id === selectedArticleId) ?? null;
    }, [articles, incomingArticles, selectedArticleId]);
    const researchSourceArticle = useMemo(() => {
        if (!researchSourceArticleId) {
            return null;
        }
        return articles.find((article) => article.id === researchSourceArticleId) ?? null;
    }, [articles, researchSourceArticleId]);
    const selectedArticleIsRss = Boolean(selectedArticle?.sourceId && rssSources.some((source) => source.id === selectedArticle.sourceId));
    const resetArticleForm = (article) => {
        setEditingArticleId(article?.id ?? null);
        setArticleForm({
            title: article?.title ?? "",
            summary: article?.summary ?? "",
            body: article?.body ?? "",
            bodyBlocks: article?.bodyBlocks ?? [],
            sourceId: article?.source?.id ?? "",
            sourceName: article?.sourceName ?? "",
            sourceUrl: article?.sourceUrl ?? "",
            tags: (article?.tags ?? []).join(", "),
            mediaReferences: (article?.media ?? []).map((media) => media.url).join("\n") ?? "",
            outboundLinks: (article?.links ?? []).map((link) => link.url).join("\n") ?? "",
            status: article?.status ?? "draft",
            categories: (article?.categories ?? []).map((category) => ({
                id: `${category.categoryType}:${category.entityId}`,
                categoryType: category.categoryType,
                entityId: category.entityId
            }))
        });
    };
    const handleArticleSubmit = async (nextStatus) => {
        if (!articleForm.title.trim()) {
            setStatusMessage("A title is required before saving an article.");
            return;
        }
        setSavingArticleStatus(nextStatus);
        try {
            const resolvedCategoryRows = articleForm.categories.filter((category) => category.entityId);
            const categoryMap = new Map();
            for (const category of resolvedCategoryRows) {
                if (!categoryMap.has(category.categoryType)) {
                    categoryMap.set(category.categoryType, category.entityId);
                }
            }
            const payload = {
                title: articleForm.title.trim(),
                slug: createSlug(articleForm.title.trim() || "article"),
                summary: articleForm.summary || null,
                body: articleForm.body || null,
                bodyBlocks: articleForm.bodyBlocks,
                status: nextStatus,
                sportId: categoryMap.get("sport") ?? null,
                competitionId: categoryMap.get("competition") ?? null,
                teamId: categoryMap.get("team") ?? null,
                countryId: categoryMap.get("country") ?? null,
                matchId: categoryMap.get("match") ?? null,
                sourceId: articleForm.sourceId || null,
                sourceName: articleForm.sourceName || null,
                sourceUrl: articleForm.sourceUrl || null,
                tags: articleForm.tags.split(/,|\n/).map((tag) => tag.trim()).filter(Boolean),
                categories: resolvedCategoryRows.map((category) => ({ categoryType: category.categoryType, entityId: category.entityId }))
            };
            let article;
            if (editingArticleId) {
                article = await apiClient.updateNewsArticle(editingArticleId, payload, accessToken);
            }
            else {
                article = await apiClient.createNewsArticle(payload, accessToken);
            }
            const mediaReferences = articleForm.mediaReferences
                .split(/\n|,/)
                .map((value) => value.trim())
                .filter(Boolean);
            const outboundLinks = articleForm.outboundLinks
                .split(/\n|,/)
                .map((value) => value.trim())
                .filter(Boolean);
            for (const url of mediaReferences) {
                await apiClient.addNewsArticleMedia(article.id, url, "image", accessToken);
            }
            for (const url of outboundLinks) {
                await apiClient.addNewsArticleLink(article.id, url, undefined, accessToken);
            }
            if (nextStatus === "published") {
                article = await apiClient.publishNewsArticle(article.id, accessToken);
            }
            else if (nextStatus === "archived") {
                article = await apiClient.archiveNewsArticle(article.id, accessToken);
            }
            setStatusMessage(`Article ${nextStatus === "published" ? "published" : nextStatus === "archived" ? "archived" : "saved"}.`);
            setEditingArticleId(article.id);
            setSelectedArticleId(article.id);
            setActiveSection("articles");
            await loadData();
        }
        catch (error) {
            const message = error instanceof Error ? error.message : "Unable to save article.";
            setStatusMessage(message);
        }
        finally {
            setSavingArticleStatus(null);
        }
    };
    const handlePublishArticle = async (articleId) => {
        setIsPublishingArticleId(articleId);
        try {
            await apiClient.publishNewsArticle(articleId, accessToken);
            setStatusMessage("Article published.");
            await loadData();
        }
        catch (error) {
            const message = error instanceof Error ? error.message : "Unable to publish article.";
            setStatusMessage(message);
        }
        finally {
            setIsPublishingArticleId(null);
        }
    };
    const handleArchiveArticle = async (articleId) => {
        try {
            await apiClient.archiveNewsArticle(articleId, accessToken);
            setStatusMessage("Article archived.");
            await loadData();
        }
        catch (error) {
            const message = error instanceof Error ? error.message : "Unable to archive article.";
            setStatusMessage(message);
        }
    };
    const handleFetchArticleContent = async (articleId) => {
        if (fetchingArticleContentId) {
            return;
        }
        setFetchingArticleContentId(articleId);
        setStatusMessage("Fetching article content…");
        try {
            const result = await apiClient.fetchNewsArticleContent(articleId, accessToken);
            setStatusMessage(result.message || (result.success ? "Article content fetched." : "Article content fetch failed."));
            await loadData();
        }
        catch (error) {
            const message = error instanceof Error ? error.message : "Unable to fetch article content.";
            setStatusMessage(message);
        }
        finally {
            setFetchingArticleContentId(null);
        }
    };
    const handleSelectIncomingArticle = (articleId) => {
        setSelectedArticleId(articleId);
        setResearchSourceArticleId(articleId);
        setResearchTab("original");
    };
    const handleResearchArticle = async () => {
        if (!researchSourceArticleId) {
            return;
        }
        setResearchLoading(true);
        setResearchState("loading");
        setResearchError(null);
        setStatusMessage("Researching story…");
        try {
            const result = await apiClient.researchNewsArticle(researchSourceArticleId, accessToken);
            setResearchResult(result);
            setResearchState("success");
            setIsResearchPanelOpen(false);
            setResearchTab("research");
            setStatusMessage(result.researchStatus === "insufficient_evidence" ? "Research completed with insufficient evidence." : "Research complete.");
        }
        catch (error) {
            const message = error instanceof Error ? error.message : "Research failed.";
            setResearchResult(null);
            setResearchState("failed");
            setResearchError(message);
            setStatusMessage(/401|unauthorized|forbidden/i.test(message) ? "You are not authorized to research this story." : "Research failed. Retry when ready.");
        }
        finally {
            setResearchLoading(false);
        }
    };
    const handleGenerateOriginalStory = async () => {
        if (!researchSourceArticleId || !researchResult || researchResult.researchStatus === "insufficient_evidence") {
            return;
        }
        try {
            setIsGeneratingDraft(true);
            const draft = await apiClient.generateGiTOOriginalStory(researchSourceArticleId, researchResult, accessToken);
            setStatusMessage("GiTO original story created. Review before publishing.");
            setEditingArticleId(draft.id);
            setSelectedArticleId(draft.id);
            resetArticleForm(draft);
            setResearchTab("draft");
            setActiveSection("articles");
            await loadData();
        }
        catch (error) {
            const message = error instanceof Error ? error.message : "Unable to generate GiTO original story.";
            setStatusMessage(/401|unauthorized|forbidden/i.test(message) ? "You are not authorized to generate this story." : message);
        }
        finally {
            setIsGeneratingDraft(false);
        }
    };
    const classificationLabel = (category) => {
        const collections = {
            team: teams,
            sport: sports,
            country: countries,
            host: hosts.map((host) => ({ id: host.id, name: `${host.name} (${host.type})` })),
            competition: competitions,
            match: matches.map((match) => ({ id: match.id, name: `${match.homeTeamId} vs ${match.awayTeamId}` }))
        };
        return collections[category.categoryType]?.find((entity) => entity.id === category.entityId)?.name ?? category.entityId;
    };
    const refreshClassification = async (articleId) => {
        const result = await apiClient.getNewsClassification(articleId, accessToken);
        setClassification(result);
        setSelectedClassificationIds([]);
    };
    const rerunClassification = async () => {
        if (!selectedArticleId)
            return;
        try {
            await apiClient.rerunNewsClassification(selectedArticleId, accessToken);
            await refreshClassification(selectedArticleId);
            setStatusMessage("Classification suggestions refreshed. Approved relationships were preserved.");
        }
        catch (error) {
            setStatusMessage(error instanceof Error ? error.message : "Classification rerun failed.");
        }
    };
    const aiClassifySelectedArticle = async () => {
        if (!selectedArticleId)
            return;
        setAiClassificationStatus("running");
        try {
            const result = await apiClient.aiClassifyNewsArticle(selectedArticleId, accessToken);
            setClassification(result);
            setSelectedClassificationIds([]);
            setAiClassificationStatus("success");
            setStatusMessage("AI suggestions added. Editorial approval is still required.");
        }
        catch (error) {
            setAiClassificationStatus("unavailable");
            setStatusMessage(error instanceof Error ? error.message : "AI classification is temporarily unavailable.");
        }
    };
    const approveClassification = async (categoryId) => {
        if (!selectedArticleId)
            return;
        setApprovingClassificationId(categoryId);
        try {
            await apiClient.approveNewsClassification(selectedArticleId, categoryId, accessToken);
            await refreshClassification(selectedArticleId);
            await loadData();
            setStatusMessage("Classification approved.");
        }
        catch (error) {
            setStatusMessage(error instanceof Error ? error.message : "Unable to approve classification.");
        }
        finally {
            setApprovingClassificationId(null);
        }
    };
    const rejectClassification = async (categoryId) => {
        if (!selectedArticleId)
            return;
        try {
            await apiClient.rejectNewsClassification(selectedArticleId, categoryId, accessToken);
            await refreshClassification(selectedArticleId);
            setStatusMessage("Classification rejected.");
        }
        catch (error) {
            setStatusMessage(error instanceof Error ? error.message : "Unable to reject classification.");
        }
    };
    const approveSelectedClassifications = async () => {
        if (!selectedArticleId || !selectedClassificationIds.length)
            return;
        setApprovingMultipleClassifications(true);
        try {
            await apiClient.approveNewsClassifications(selectedArticleId, selectedClassificationIds, accessToken);
            await refreshClassification(selectedArticleId);
            await loadData();
            setStatusMessage("Selected classifications approved.");
        }
        catch (error) {
            setStatusMessage(error instanceof Error ? error.message : "Unable to approve classifications.");
        }
        finally {
            setApprovingMultipleClassifications(false);
        }
    };
    const refreshSelectedClassification = async () => {
        if (!selectedArticleId)
            return;
        const result = await apiClient.getNewsClassification(selectedArticleId, accessToken);
        setClassification(result);
        setSelectedClassificationIds([]);
    };
    const addManualClassification = async (categoryType, entityId) => {
        if (!selectedArticleId)
            return;
        try {
            await apiClient.addManualNewsClassification(selectedArticleId, categoryType, entityId, accessToken);
            await refreshSelectedClassification();
            await loadData();
            setStatusMessage("Editorial relationship added.");
        }
        catch (error) {
            setStatusMessage(error instanceof Error ? error.message : "Unable to add relationship.");
        }
    };
    const removeApprovedClassification = async (categoryId) => {
        if (!selectedArticleId)
            return;
        try {
            await apiClient.removeNewsClassification(selectedArticleId, categoryId, accessToken);
            await refreshSelectedClassification();
            await loadData();
            setStatusMessage("Editorial relationship removed.");
        }
        catch (error) {
            setStatusMessage(error instanceof Error ? error.message : "Unable to remove relationship.");
        }
    };
    const handleDeleteArticle = async (articleId) => {
        if (deletingArticleId || deletingArticles || !window.confirm("Delete this article?")) {
            return;
        }
        setDeletingArticleId(articleId);
        setStatusMessage("Deleting…");
        try {
            await apiClient.deleteNewsArticle(articleId, accessToken);
            setStatusMessage("Article deleted.");
            if (selectedArticleId === articleId) {
                setSelectedArticleId(null);
            }
            if (editingArticleId === articleId) {
                setEditingArticleId(null);
                setArticleForm(emptyArticleForm());
            }
            setSelectedArticleIds((current) => current.filter((id) => id !== articleId));
            if (researchSourceArticleId === articleId) {
                setResearchSourceArticleId(null);
                setResearchResult(null);
                setResearchState("idle");
            }
            await loadData();
        }
        catch (error) {
            const message = error instanceof Error ? error.message : "Unable to delete article.";
            setStatusMessage(message);
        }
        finally {
            setDeletingArticleId(null);
        }
    };
    const handleBulkDeleteArticles = async () => {
        if (!selectedArticleIds.length || deletingArticleId || deletingArticles) {
            setStatusMessage("Select one or more articles before bulk deleting.");
            return;
        }
        if (!window.confirm(`Delete ${selectedArticleIds.length} selected articles?\n\nThese articles and their News-related data will be permanently removed.`)) {
            return;
        }
        try {
            setDeletingArticles(true);
            setStatusMessage("Deleting…");
            const result = await apiClient.bulkDeleteNewsArticles(selectedArticleIds, accessToken);
            setStatusMessage(`${result.deletedCount} article(s) deleted.`);
            if (shouldClearEditingArticleAfterDelete(editingArticleId, selectedArticleIds)) {
                setEditingArticleId(null);
                setArticleForm(emptyArticleForm());
            }
            if (shouldClearSelectedArticleAfterDelete(selectedArticleId, selectedArticleIds)) {
                setSelectedArticleId(null);
            }
            setSelectedArticleIds([]);
            if (selectedArticleIds.includes(researchSourceArticleId ?? "")) {
                setResearchSourceArticleId(null);
                setResearchResult(null);
                setResearchState("idle");
            }
            await loadData();
        }
        catch (error) {
            const message = error instanceof Error ? error.message : "Unable to delete selected articles.";
            setStatusMessage(message);
        }
        finally {
            setDeletingArticles(false);
        }
    };
    const handleGenerateGiTONewsDraft = async (article) => {
        try {
            setIsGeneratingDraft(true);
            const draft = await apiClient.generateGiTONewsDraft(article.id, accessToken);
            setStatusMessage("GiTO draft created. Review before publishing.");
            setEditingArticleId(draft.id);
            setSelectedArticleId(draft.id);
            resetArticleForm(draft);
            setActiveSection("articles");
            await loadData();
        }
        catch (error) {
            const message = error instanceof Error ? error.message : "Unable to generate GiTO draft.";
            setStatusMessage(message);
        }
        finally {
            setIsGeneratingDraft(false);
        }
    };
    const handleSourceSubmit = async () => {
        if (!sourceForm.name.trim()) {
            setStatusMessage("A source name is required.");
            return;
        }
        try {
            const payload = {
                name: sourceForm.name.trim(),
                sourceType: sourceForm.sourceType,
                baseUrl: sourceForm.baseUrl || null,
                feedUrl: sourceForm.feedUrl || null,
                enabled: sourceForm.enabled
            };
            if (editingSourceId) {
                await apiClient.updateNewsSource(editingSourceId, payload, accessToken);
            }
            else {
                await apiClient.createNewsSource(payload, accessToken);
            }
            setSourceForm(emptySourceForm());
            setEditingSourceId(null);
            setStatusMessage("Source saved.");
            await loadData();
        }
        catch (error) {
            const message = error instanceof Error ? error.message : "Unable to save source.";
            setStatusMessage(message);
        }
    };
    const handleToggleSource = async (source) => {
        try {
            await apiClient.updateNewsSource(source.id, { enabled: !source.enabled }, accessToken);
            setStatusMessage(`Source ${source.enabled ? "disabled" : "enabled"}.`);
            await loadData();
        }
        catch (error) {
            const message = error instanceof Error ? error.message : "Unable to update source.";
            setStatusMessage(message);
        }
    };
    const handleDeleteSource = async (sourceId) => {
        if (!window.confirm("Delete this source?")) {
            return;
        }
        try {
            await apiClient.deleteNewsSource(sourceId, accessToken);
            setStatusMessage("Source deleted.");
            await loadData();
        }
        catch (error) {
            const message = error instanceof Error ? error.message : "Unable to delete source.";
            setStatusMessage(message);
        }
    };
    const handleCollectSource = async (source) => {
        try {
            const result = await apiClient.collectNewsSource(source.id, accessToken);
            setStatusMessage(`Collected ${result.imported} article(s) from ${source.name}.`);
            await loadData();
        }
        catch (error) {
            const message = error instanceof Error ? error.message : "Unable to collect news source.";
            setStatusMessage(message);
        }
    };
    const handleAuditSourceRights = async (source) => {
        try {
            const audit = await apiClient.auditNewsSourcePublishingRights(source.id, accessToken);
            const auditRecord = audit;
            setSourceAuditDetails((current) => ({ ...current, [source.id]: auditRecord }));
            setStatusMessage(`Rights status for ${source.name}: ${rightsStatusLabels[auditRecord.status] ?? auditRecord.status}.`);
            await loadData();
        }
        catch (error) {
            const message = error instanceof Error ? error.message : "Unable to audit source rights.";
            setStatusMessage(message);
        }
    };
    const handleCreateRssSource = async () => {
        try {
            const source = await apiClient.createNewsRssSource(rssSourceName.trim(), rssFeedUrl.trim(), accessToken);
            setRssSources((current) => [...current, source].sort((left, right) => left.name.localeCompare(right.name)));
            setRssSourceName("");
            setRssFeedUrl("");
            setStatusMessage("RSS source added.");
        }
        catch (error) {
            setStatusMessage(error instanceof Error ? error.message : "GiTO could not add this RSS source.");
        }
    };
    const handleFetchRssSource = async (source) => {
        try {
            const result = await apiClient.fetchNewsRssSource(source.id, accessToken);
            setRssFetchResult((current) => ({ ...current, [source.id]: result }));
            setStatusMessage(`Feed checked successfully: ${result.fetchedItems} items found · ${result.importedItems} new · ${result.skippedDuplicates} already imported.`);
            await loadData();
        }
        catch (error) {
            setStatusMessage(error instanceof Error ? "GiTO couldn't read this feed. Check the URL and try again." : "GiTO couldn't read this feed. Check the URL and try again.");
        }
    };
    const handleDeleteRssSource = async (sourceId) => {
        if (!window.confirm("Delete this RSS source? Previously imported articles will remain."))
            return;
        try {
            await apiClient.deleteNewsRssSource(sourceId, accessToken);
            setRssSources((current) => current.filter((source) => source.id !== sourceId));
            setStatusMessage("RSS source deleted.");
        }
        catch (error) {
            setStatusMessage(error instanceof Error ? error.message : "Unable to delete RSS source.");
        }
    };
    const handleCreateWebRss = async () => {
        try {
            setWebRssLoading(true);
            setStatusMessage("Analyzing webpage…");
            const feed = await apiClient.createGeneratedNewsRssFeed(webRssName.trim(), webRssUrl.trim(), accessToken);
            setGeneratedFeeds((current) => [feed, ...current]);
            setWebRssName("");
            setWebRssUrl("");
            setStatusMessage(feed.crawlerTier === "browser" ? "Browser-rendered page analyzed. RSS feed ready." : "Standard web crawl completed. RSS feed ready.");
        }
        catch (error) {
            setStatusMessage(error instanceof Error ? error.message : "GiTO could not access this webpage.");
        }
        finally {
            setWebRssLoading(false);
        }
    };
    const handleRefreshWebRss = async (feedId) => {
        try {
            setWebRssLoading(true);
            setStatusMessage("Analyzing webpage…");
            const feed = await apiClient.refreshGeneratedNewsRssFeed(feedId, accessToken);
            setGeneratedFeeds((current) => current.map((item) => item.id === feed.id ? feed : item));
            setStatusMessage(feed.crawlerTier === "browser" ? "Browser-rendered page analyzed. Feed refreshed successfully." : "Standard web crawl completed. Feed refreshed successfully.");
        }
        catch (error) {
            setStatusMessage(error instanceof Error ? error.message : "GiTO could not access this webpage.");
        }
        finally {
            setWebRssLoading(false);
        }
    };
    const handlePreviewWebRss = async (feedId) => {
        try {
            const articles = await apiClient.listGeneratedNewsRssArticles(feedId, accessToken);
            setWebRssPreview((current) => ({ ...current, [feedId]: articles }));
        }
        catch {
            setStatusMessage("Unable to preview discovered articles.");
        }
    };
    const handleDeleteWebRss = async (feedId) => {
        if (!window.confirm("Delete this generated RSS feed?"))
            return;
        try {
            await apiClient.deleteGeneratedNewsRssFeed(feedId, accessToken);
            setGeneratedFeeds((current) => current.filter((feed) => feed.id !== feedId));
            setStatusMessage("Generated RSS feed deleted.");
        }
        catch {
            setStatusMessage("Unable to delete generated RSS feed.");
        }
    };
    const rssPublisherUrl = `${window.location.origin}/news/rss.xml`;
    return (_jsxs("section", { className: "news-workspace-screen", children: [_jsxs("header", { className: "console-panel news-workspace-header", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "News Workspace" }), _jsx("h2", { children: "News" }), _jsx("p", { children: "Manage editorial content independently from IPTV and live operations." })] }), _jsxs("div", { className: "news-summary-grid", children: [_jsxs("div", { className: "news-summary-item", children: [_jsx("strong", { children: summary.totalArticles }), _jsx("span", { children: "Total articles" })] }), _jsxs("div", { className: "news-summary-item", children: [_jsx("strong", { children: summary.drafts }), _jsx("span", { children: "Drafts" })] }), _jsxs("div", { className: "news-summary-item", children: [_jsx("strong", { children: summary.awaitingReview }), _jsx("span", { children: "Awaiting review" })] }), _jsxs("div", { className: "news-summary-item", children: [_jsx("strong", { children: summary.published }), _jsx("span", { children: "Published" })] }), _jsxs("div", { className: "news-summary-item", children: [_jsx("strong", { children: summary.enabledSources }), _jsx("span", { children: "Enabled sources" })] })] })] }), _jsx("div", { className: "console-panel news-section-nav", children: sectionItems.map((item) => (_jsx("button", { type: "button", className: activeSection === item.key ? "news-section-button active" : "news-section-button", onClick: () => setActiveSection(item.key), children: item.label }, item.key))) }), _jsx("div", { className: "news-status-row", children: _jsx("span", { children: isLoading ? "Loading news workspace…" : statusMessage }) }), activeSection === "overview" ? (_jsxs("div", { className: "news-grid", children: [_jsxs("section", { className: "console-panel news-panel", children: [_jsxs("div", { className: "news-panel-header", children: [_jsx("h3", { children: "Overview" }), _jsx("p", { children: "Simple editorial snapshot for the current workspace." })] }), _jsxs("div", { className: "news-card-grid", children: [_jsxs("div", { className: "news-card", children: [summary.totalArticles, " total articles"] }), _jsxs("div", { className: "news-card", children: [summary.drafts, " drafts"] }), _jsxs("div", { className: "news-card", children: [summary.awaitingReview, " awaiting review"] }), _jsxs("div", { className: "news-card", children: [summary.published, " published"] }), _jsxs("div", { className: "news-card", children: [summary.enabledSources, " enabled sources"] })] })] }), _jsxs("section", { className: "console-panel news-panel", children: [_jsxs("div", { className: "news-panel-header", children: [_jsx("h3", { children: "Incoming items" }), _jsx("p", { children: "Latest draft and review articles ready for action." })] }), _jsx("ul", { className: "news-list", children: incomingArticles.slice(0, 6).map((article) => (_jsxs("li", { children: [_jsx("strong", { children: article.title }), _jsxs("span", { children: [statusLabels[article.status], " \u00B7 ", article.source?.name ?? article.sourceName ?? "Unassigned"] })] }, article.id))) })] })] })) : null, activeSection === "incoming" ? (_jsxs("div", { className: "news-grid", children: [_jsxs("section", { className: "console-panel news-panel", children: [_jsxs("div", { className: "news-panel-header", children: [_jsx("h3", { children: "Incoming News" }), _jsx("p", { children: "Review incoming content and prepare it for the editorial queue." })] }), _jsxs("div", { className: "news-filter-row", children: [_jsx("input", { type: "search", "aria-label": "Search titles", placeholder: "Search titles", value: articleFilters.search, onChange: (event) => setArticleFilters((current) => ({ ...current, search: event.target.value })) }), _jsxs("select", { "aria-label": "Filter by status", value: articleFilters.status, onChange: (event) => setArticleFilters((current) => ({ ...current, status: event.target.value })), children: [_jsx("option", { value: "", children: "All statuses" }), Object.entries(statusLabels).map(([value, label]) => (_jsx("option", { value: value, children: label }, value)))] }), _jsxs("select", { "aria-label": "Filter by source", value: articleFilters.source, onChange: (event) => setArticleFilters((current) => ({ ...current, source: event.target.value })), children: [_jsx("option", { value: "", children: "All sources" }), sources.map((source) => _jsx("option", { value: source.id, children: source.name }, source.id))] }), _jsxs("label", { className: "news-filter-checkbox", children: [_jsx("input", { type: "checkbox", checked: articleFilters.generatedOnly, onChange: (event) => setArticleFilters((current) => ({ ...current, generatedOnly: event.target.checked })) }), "GiTO generated"] }), _jsxs("label", { className: "news-filter-checkbox", children: [_jsx("input", { type: "checkbox", checked: articleFilters.factCheckOnly, onChange: (event) => setArticleFilters((current) => ({ ...current, factCheckOnly: event.target.checked })) }), "Fact-check only"] }), _jsxs("label", { className: "news-filter-checkbox", children: [_jsx("input", { type: "checkbox", checked: articleFilters.insufficientOnly, onChange: (event) => setArticleFilters((current) => ({ ...current, insufficientOnly: event.target.checked })) }), "Insufficient source"] }), _jsxs("label", { className: "news-filter-checkbox", children: [_jsx("input", { type: "checkbox", checked: articleFilters.researchCompletedOnly, onChange: (event) => setArticleFilters((current) => ({ ...current, researchCompletedOnly: event.target.checked })) }), "Research complete"] }), _jsxs("label", { className: "news-filter-checkbox", children: [_jsx("input", { type: "checkbox", checked: articleFilters.researchFailedOnly, onChange: (event) => setArticleFilters((current) => ({ ...current, researchFailedOnly: event.target.checked })) }), "Research failed"] }), _jsx("button", { type: "button", onClick: () => setArticleFilters({
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
                                        }), children: "Clear filters" })] }), _jsxs("div", { className: "news-bulk-action-bar", children: [_jsx("button", { type: "button", onClick: () => setSelectedArticleIds(incomingArticles.map((article) => article.id)), children: "Select visible" }), _jsx("button", { type: "button", onClick: () => setSelectedArticleIds([]), children: "Clear selection" }), _jsx("button", { type: "button", onClick: () => void handleBulkDeleteArticles(), disabled: !selectedArticleIds.length || deletingArticles || deletingArticleId !== null, children: deletingArticles ? "Deleting…" : "Delete selected" }), _jsxs("span", { children: [selectedArticleIds.length, " article", selectedArticleIds.length === 1 ? "" : "s", " selected"] })] }), _jsx("div", { className: "news-list-stack", children: incomingArticles.map((article) => {
                                    const isChecked = selectedArticleIds.includes(article.id);
                                    return (_jsxs("div", { className: selectedArticle?.id === article.id ? "news-item-card active" : "news-item-card", children: [_jsx("label", { className: "news-row-checkbox", children: _jsx("input", { type: "checkbox", checked: isChecked, onChange: () => setSelectedArticleIds((current) => current.includes(article.id)
                                                        ? current.filter((id) => id !== article.id)
                                                        : [...current, article.id]) }) }), _jsxs("button", { type: "button", className: "news-item-card-button", onClick: () => handleSelectIncomingArticle(article.id), children: [getArticleThumbnail(article) ? (_jsx("img", { className: "news-article-thumbnail", src: getArticleThumbnail(article) ?? undefined, alt: "" })) : null, _jsxs("div", { className: "news-item-title-row", children: [_jsx("strong", { children: article.title }), _jsx("span", { children: statusLabels[article.status] })] }), _jsx("span", { children: article.source?.name ?? article.sourceName ?? "Unassigned" }), _jsxs("small", { children: ["Category: ", getArticleCategories(article)] }), _jsxs("small", { children: ["Content: ", getContentAvailability(article)] }), _jsxs("small", { children: ["Origin: ", article.contentOrigin ?? "Unknown"] }), isGiTOInsufficientSourceMaterial(article) ? _jsx("small", { className: "news-insufficient-source-label", children: "INSUFFICIENT SOURCE MATERIAL" }) : null, _jsxs("small", { children: [article.sport?.name ?? "—", " \u00B7 ", article.competition?.name ?? "—", " \u00B7 ", article.team?.name ?? "—"] }), _jsx("small", { children: formatDate(article.createdAt) })] })] }, article.id));
                                }) })] }), _jsxs("section", { className: "console-panel news-panel", children: [_jsxs("div", { className: "news-panel-header", children: [_jsx("h3", { children: "Review" }), _jsx("p", { children: "Open a selected article for review or editing." })] }), selectedArticle ? (_jsxs("div", { className: "news-detail-card", children: [_jsxs("div", { className: "news-detail-badge-row", children: [selectedArticleIsRss ? _jsx("span", { className: "news-badge", children: "RSS source" }) : null, isGiTOGeneratedArticle(selectedArticle) ? (_jsx("span", { className: "news-badge ai-generated", children: "GiTO AI-ASSISTED" })) : null, isGiTOGeneratedArticle(selectedArticle) ? (_jsx("span", { className: "news-badge review-required", children: "REVIEW REQUIRED" })) : null, isGiTOFactCheckRequired(selectedArticle) ? (_jsx("span", { className: "news-badge fact-check-required", children: "FACT-CHECK REQUIRED" })) : null, isGiTOInsufficientSourceMaterial(selectedArticle) ? (_jsx("span", { className: "news-badge insufficient-source", children: "INSUFFICIENT SOURCE MATERIAL" })) : null] }), _jsx("h4", { children: selectedArticle.title }), _jsxs("div", { className: "news-detail-summary", children: [_jsx("strong", { children: "Summary" }), _jsx("p", { children: selectedArticle.summary || "No summary yet." })] }), selectedArticle.body ? (_jsxs("div", { className: "news-detail-body", children: [_jsx("strong", { children: "Body" }), _jsx("p", { children: selectedArticle.body })] })) : null, _jsxs("div", { className: "news-detail-meta", children: [_jsxs("span", { children: ["Source: ", selectedArticle.source?.name ?? selectedArticle.sourceName ?? "Unassigned"] }), selectedArticle.sourceId === null && selectedArticle.sourceName ? _jsx("span", { children: "Source configuration: Removed" }) : null, _jsxs("span", { children: ["Sport: ", selectedArticle.sport?.name ?? "—"] }), _jsxs("span", { children: ["Competition: ", selectedArticle.competition?.name ?? "—"] }), _jsxs("span", { children: ["Team: ", selectedArticle.team?.name ?? "—"] }), _jsxs("span", { children: ["Status: ", statusLabels[selectedArticle.status]] }), _jsxs("span", { children: ["Content origin: ", selectedArticle.contentOrigin ?? "Unknown"] }), _jsxs("span", { children: ["Availability: ", getContentAvailability(selectedArticle)] })] }), _jsx(NewsClassificationPanel, { classification: classification, labelFor: classificationLabel, selectedIds: selectedClassificationIds, onToggle: (categoryId) => setSelectedClassificationIds((current) => current.includes(categoryId) ? current.filter((id) => id !== categoryId) : [...current, categoryId]), onApprove: (categoryId) => void approveClassification(categoryId), onReject: (categoryId) => void rejectClassification(categoryId), onApproveSelected: () => void approveSelectedClassifications(), onRerun: () => void rerunClassification(), approvingCategoryId: approvingClassificationId, approvingMultiple: approvingMultipleClassifications, aiStatus: aiClassificationStatus, onAiClassify: () => void aiClassifySelectedArticle(), entities: {
                                            team: teams.map((team) => ({ id: team.id, name: team.name })),
                                            competition: competitions.map((competition) => ({ id: competition.id, name: competition.name })),
                                            country: countries.map((country) => ({ id: country.id, name: country.name })),
                                            host: hosts.filter((host) => !selectedArticle.sportId || host.sportId === selectedArticle.sportId).map((host) => ({ id: host.id, name: `${host.name} (${host.type} · ${sports.find((sport) => sport.id === host.sportId)?.name ?? "Sport"})` })),
                                            sport: sports.map((sport) => ({ id: sport.id, name: sport.name })),
                                            match: matches.map((match) => ({ id: match.id, name: `${match.homeTeamId} vs ${match.awayTeamId}` }))
                                        }, onAddManual: (categoryType, entityId) => void addManualClassification(categoryType, entityId), onRemoveApproved: (categoryId) => void removeApprovedClassification(categoryId) }), selectedArticle.fetchedBody ? (_jsxs("div", { className: "news-detail-original-source", children: [_jsx("strong", { children: "Original source preview" }), _jsx("pre", { children: normalizeFetchedSourceBody(selectedArticle.fetchedBody) })] })) : null, researchSourceArticle && researchSourceArticle.id === selectedArticle.id ? (_jsxs("div", { className: "news-research-panel", children: [_jsxs("div", { className: "news-panel-header", children: [_jsx("h4", { children: "AI-assisted research" }), _jsx("p", { children: "GiTO will gather supporting information and build an evidence set before generating an original story. The source article will not be modified." })] }), (researchLoading || researchState === "loading") ? (_jsxs("div", { role: "status", className: "news-research-loading", children: [_jsx("strong", { children: "Researching story\u2026" }), _jsx("span", { children: "Finding relevant sources\u2026" }), _jsx("span", { children: "Checking facts\u2026" })] })) : null, researchState === "failed" ? (_jsxs("div", { role: "alert", className: "news-research-error", children: [_jsx("strong", { children: "Research failed" }), _jsx("span", { children: researchError || "GiTO could not complete the research request." }), _jsx("button", { type: "button", disabled: researchLoading, onClick: () => void handleResearchArticle(), children: "Retry research" })] })) : null, researchState === "idle" ? (_jsx("button", { type: "button", disabled: researchLoading, onClick: () => void handleResearchArticle(), children: "Research this story" })) : null, researchState === "success" && researchResult ? (_jsxs(_Fragment, { children: [_jsxs("div", { className: "news-research-summary", children: [_jsx("strong", { children: "Research complete" }), _jsxs("span", { children: ["Research confidence: ", researchResult.confidence.toUpperCase()] }), _jsxs("span", { children: ["Sources consulted: ", researchResult.sources.length] }), _jsxs("span", { children: ["Verified facts: ", researchResult.verifiedFacts.length] }), _jsxs("span", { children: ["Conflicting facts: ", researchResult.disputedFacts.length] }), _jsxs("span", { children: ["Claims requiring review: ", researchResult.unsupportedClaims.length] })] }), researchResult.researchStatus === "insufficient_evidence" ? (_jsxs("div", { role: "alert", className: "news-research-warning", children: [_jsx("strong", { children: "\u26A0 Insufficient source material" }), _jsx("p", { children: "GiTO could not establish enough reliable information to safely expand this story." }), _jsx("button", { type: "button", disabled: researchLoading, onClick: () => void handleResearchArticle(), children: "Retry research" })] })) : null, _jsx("button", { type: "button", onClick: () => setIsResearchPanelOpen((open) => !open), children: isResearchPanelOpen ? "Hide research" : "View research" }), isResearchPanelOpen ? (_jsxs("div", { className: "news-research-details", children: [_jsxs("div", { className: "news-research-tabs", children: [_jsx("button", { type: "button", className: researchTab === "original" ? "active" : "", onClick: () => setResearchTab("original"), children: "Original source" }), _jsx("button", { type: "button", className: researchTab === "research" ? "active" : "", onClick: () => setResearchTab("research"), children: "Research findings" }), _jsx("button", { type: "button", className: researchTab === "draft" ? "active" : "", onClick: () => setResearchTab("draft"), children: "GiTO draft" })] }), researchTab === "original" ? (_jsxs("div", { className: "news-detail-original-source", children: [_jsx("strong", { children: "Original source" }), _jsx("p", { children: researchSourceArticle.title }), _jsx("p", { children: researchSourceArticle.summary || "No summary available." }), researchSourceArticle.sourceUrl ? _jsx("a", { href: researchSourceArticle.sourceUrl, target: "_blank", rel: "noreferrer", children: "Open source article" }) : null] })) : null, researchTab === "research" ? (_jsxs("div", { children: [_jsx("h5", { children: "Verified facts" }), researchResult.verifiedFacts.map((fact) => (_jsxs("div", { className: "news-research-fact", children: [_jsx("strong", { children: "\u2705 Verified" }), _jsx("p", { children: fact.statement }), _jsxs("small", { children: ["Sources: ", fact.sources.join(", "), " \u00B7 Confidence: ", fact.confidence] })] }, fact.id))), _jsx("h5", { children: "Conflicting information" }), researchResult.disputedFacts.map((fact) => (_jsxs("div", { className: "news-research-fact", children: [_jsx("strong", { children: "\u26A0 Conflicting information" }), _jsx("p", { children: fact.statement }), _jsxs("small", { children: ["Sources: ", fact.sources.join(", ")] })] }, fact.id))), _jsx("h5", { children: "Needs fact-check" }), researchResult.unsupportedClaims.length ? _jsx("ul", { children: researchResult.unsupportedClaims.map((claim) => _jsx("li", { children: claim }, claim)) }) : _jsx("p", { children: "No additional claims require review." }), _jsx("h5", { children: "Sources consulted" }), researchResult.sources.map((source) => _jsxs("div", { className: "news-research-source", children: [_jsx("strong", { children: source.publisher || source.domain }), _jsxs("span", { children: [source.title || source.domain, " \u00B7 ", source.sourceType] }), _jsx("a", { href: source.url, target: "_blank", rel: "noreferrer", children: source.url }), _jsxs("small", { children: ["Authority ", source.authorityLevel, "/5 \u00B7 Relevance ", Math.round(source.relevance * 100), "%"] })] }, source.id))] })) : null, researchTab === "draft" ? _jsx("p", { children: "Generate a GiTO original story to open it in the existing editor." }) : null] })) : null, _jsx("p", { className: "news-rights-warning", children: "Publisher rights have not been confirmed for direct republication. This research can be used to help create an independent GiTO story, but it does not itself grant republication permission." }), _jsx("p", { children: "Generate an original editorial draft from the researched facts. The source article will not be modified." }), _jsx("button", { type: "button", disabled: researchLoading || isGeneratingDraft, onClick: () => void handleGenerateOriginalStory(), children: isGeneratingDraft ? "Generating original story…" : "Generate GiTO Original Story" })] })) : null] })) : null, _jsxs("div", { className: "news-action-row", children: [_jsx("button", { type: "button", onClick: () => { resetArticleForm(selectedArticle); setActiveSection("articles"); }, children: "Edit article" }), _jsx("button", { type: "button", disabled: fetchingArticleContentId === selectedArticle.id, onClick: () => void handleFetchArticleContent(selectedArticle.id), children: fetchingArticleContentId === selectedArticle.id ? "Fetching article content…" : "Fetch article content" }), _jsx("button", { type: "button", disabled: isGeneratingDraft, onClick: () => void handleGenerateGiTONewsDraft(selectedArticle), children: isGeneratingDraft ? "Generating draft…" : "Generate GiTO draft" }), _jsx("button", { type: "button", disabled: isPublishingArticleId === selectedArticle.id, onClick: () => void handlePublishArticle(selectedArticle.id), children: isPublishingArticleId === selectedArticle.id ? "Publishing…" : "Publish" }), _jsx("button", { type: "button", onClick: () => void handleArchiveArticle(selectedArticle.id), children: "Archive" }), _jsx("button", { type: "button", onClick: () => void handleDeleteArticle(selectedArticle.id), disabled: deletingArticleId !== null || deletingArticles, children: deletingArticleId === selectedArticle.id ? "Deleting…" : "Delete" })] })] })) : (_jsx("p", { children: "No article selected." }))] })] })) : null, activeSection === "articles" ? (_jsxs("div", { className: "news-grid", children: [_jsxs("section", { className: "console-panel news-panel", children: [_jsxs("div", { className: "news-panel-header", children: [_jsx("h3", { children: "Articles" }), _jsx("p", { children: "Create, edit, review, publish, and archive news articles." })] }), selectedArticle && isGiTOGeneratedArticle(selectedArticle) ? (_jsxs("div", { className: "news-detail-badge-row", children: [_jsx("span", { className: "news-badge ai-generated", children: "GiTO AI-ASSISTED" }), _jsx("span", { className: "news-badge review-required", children: "REVIEW REQUIRED" }), isGiTOFactCheckRequired(selectedArticle) ? _jsx("span", { className: "news-badge fact-check-required", children: "FACT-CHECK REQUIRED" }) : null] })) : null, researchSourceArticle && selectedArticle?.id !== researchSourceArticle.id ? (_jsxs("div", { className: "news-research-comparison", children: [_jsxs("div", { className: "news-research-tabs", children: [_jsx("button", { type: "button", className: researchTab === "original" ? "active" : "", onClick: () => setResearchTab("original"), children: "Original source" }), _jsx("button", { type: "button", className: researchTab === "research" ? "active" : "", onClick: () => setResearchTab("research"), children: "Research findings" }), _jsx("button", { type: "button", className: researchTab === "draft" ? "active" : "", onClick: () => setResearchTab("draft"), children: "GiTO draft" })] }), researchTab === "original" ? _jsxs("p", { children: [_jsx("strong", { children: "Original source:" }), " ", researchSourceArticle.title, " remains unchanged."] }) : null, researchTab === "research" && researchResult ? _jsxs("p", { children: [_jsx("strong", { children: "Research confidence:" }), " ", researchResult.confidence.toUpperCase(), " \u00B7 ", researchResult.verifiedFacts.length, " verified facts"] }) : null, researchTab === "draft" ? _jsxs("p", { children: [_jsx("strong", { children: "GiTO draft:" }), " review the generated title, summary, and body below before publishing."] }) : null] })) : null, _jsxs("div", { className: "news-action-row", children: [_jsx("button", { type: "button", onClick: () => { setEditingArticleId(null); setArticleForm(emptyArticleForm()); setSelectedArticleId(null); }, children: "New article" }), _jsx("button", { type: "button", disabled: savingArticleStatus === "draft", onClick: () => void handleArticleSubmit("draft"), children: savingArticleStatus === "draft" ? "Saving…" : "Save draft" }), _jsx("button", { type: "button", disabled: savingArticleStatus === "review", onClick: () => void handleArticleSubmit("review"), children: savingArticleStatus === "review" ? "Sending…" : "Send for review" }), _jsx("button", { type: "button", disabled: savingArticleStatus === "published", onClick: () => void handleArticleSubmit("published"), children: savingArticleStatus === "published" ? "Publishing…" : "Publish" }), _jsx("button", { type: "button", disabled: savingArticleStatus === "archived", onClick: () => void handleArticleSubmit("archived"), children: savingArticleStatus === "archived" ? "Archiving…" : "Archive" })] }), _jsxs("form", { className: "news-editor-form", onSubmit: (event) => { event.preventDefault(); void handleArticleSubmit(articleForm.status); }, children: [_jsxs("label", { children: ["Title", _jsx("input", { value: articleForm.title, onChange: (event) => setArticleForm((current) => ({ ...current, title: event.target.value })) })] }), _jsxs("label", { children: ["Summary", _jsx("textarea", { value: articleForm.summary, onChange: (event) => setArticleForm((current) => ({ ...current, summary: event.target.value })), rows: 3 })] }), _jsxs("label", { children: ["Body", _jsx("textarea", { value: articleForm.body, onChange: (event) => setArticleForm((current) => ({ ...current, body: event.target.value })), rows: 8 })] }), _jsxs("div", { className: "news-editor-category-section", children: [_jsxs("div", { className: "news-panel-header", children: [_jsx("h4", { children: "Article body media" }), _jsxs("div", { className: "news-action-row", children: [_jsx("button", { type: "button", onClick: () => setArticleForm((current) => ({ ...current, bodyBlocks: [...current.bodyBlocks, { type: "paragraph", text: "" }] })), children: "Add paragraph" }), _jsx("button", { type: "button", onClick: () => setArticleForm((current) => ({ ...current, bodyBlocks: [...current.bodyBlocks, { type: "image", url: "", altText: "", caption: "" }] })), children: "Add image" }), _jsx("button", { type: "button", onClick: () => setArticleForm((current) => ({ ...current, bodyBlocks: [...current.bodyBlocks, { type: "video", url: "", platform: "youtube", caption: "" }] })), children: "Add video" }), _jsx("button", { type: "button", onClick: () => setArticleForm((current) => ({ ...current, bodyBlocks: [...current.bodyBlocks, { type: "social", url: "", platform: "x", caption: "", enabled: true }] })), children: "Add social post" })] })] }), articleForm.bodyBlocks.map((block, index) => (_jsxs("div", { className: "news-edit-category-row", children: [_jsx("strong", { children: block.type }), block.type === "paragraph" ? (_jsx("textarea", { value: block.text, rows: 3, onChange: (event) => setArticleForm((current) => ({ ...current, bodyBlocks: current.bodyBlocks.map((item, itemIndex) => itemIndex === index ? { ...block, text: event.target.value } : item) })) })) : (_jsxs(_Fragment, { children: [_jsx("input", { value: block.url, placeholder: "https://...", onChange: (event) => setArticleForm((current) => ({ ...current, bodyBlocks: current.bodyBlocks.map((item, itemIndex) => itemIndex === index ? { ...block, url: event.target.value } : item) })) }), block.type === "social" ? _jsx("input", { value: block.platform, placeholder: "Platform", onChange: (event) => setArticleForm((current) => ({ ...current, bodyBlocks: current.bodyBlocks.map((item, itemIndex) => itemIndex === index ? { ...block, platform: event.target.value } : item) })) }) : null, _jsx("input", { value: block.caption ?? "", placeholder: "Optional caption", onChange: (event) => setArticleForm((current) => ({ ...current, bodyBlocks: current.bodyBlocks.map((item, itemIndex) => itemIndex === index ? { ...block, caption: event.target.value } : item) })) })] })), _jsx("button", { type: "button", disabled: index === 0, onClick: () => setArticleForm((current) => ({ ...current, bodyBlocks: current.bodyBlocks.map((item, itemIndex, blocks) => itemIndex === index - 1 ? blocks[index] : itemIndex === index ? blocks[index - 1] : item) })), children: "Move up" }), _jsx("button", { type: "button", disabled: index === articleForm.bodyBlocks.length - 1, onClick: () => setArticleForm((current) => ({ ...current, bodyBlocks: current.bodyBlocks.map((item, itemIndex, blocks) => itemIndex === index ? blocks[index + 1] : itemIndex === index + 1 ? blocks[index] : item) })), children: "Move down" }), _jsx("button", { type: "button", onClick: () => setArticleForm((current) => ({ ...current, bodyBlocks: current.bodyBlocks.filter((_, itemIndex) => itemIndex !== index) })), children: "Remove" })] }, `${block.type}-${index}`)))] }), _jsxs("div", { className: "news-form-grid", children: [_jsxs("label", { children: ["Source name", _jsx("input", { value: articleForm.sourceName, onChange: (event) => setArticleForm((current) => ({ ...current, sourceName: event.target.value })) })] }), _jsxs("label", { children: ["Source URL", _jsx("input", { value: articleForm.sourceUrl, onChange: (event) => setArticleForm((current) => ({ ...current, sourceUrl: event.target.value })) })] })] }), _jsxs("div", { className: "news-editor-category-section", children: [_jsxs("div", { className: "news-panel-header", children: [_jsx("h4", { children: "Categories" }), _jsx("button", { type: "button", onClick: () => setArticleForm((current) => ({
                                                            ...current,
                                                            categories: [...current.categories, { id: crypto.randomUUID(), categoryType: "sport", entityId: "" }]
                                                        })), children: "Add category" })] }), articleForm.categories.length === 0 ? _jsx("p", { children: "No categories selected." }) : null, articleForm.categories.map((category, index) => {
                                                const options = getFilteredCategoryOptions({
                                                    categoryType: category.categoryType,
                                                    rows: articleForm.categories,
                                                    sports,
                                                    countries,
                                                    competitions,
                                                    teams,
                                                    matches,
                                                    hosts,
                                                    competitionTeamIds
                                                });
                                                const emptyLabel = category.categoryType === "sport"
                                                    ? "No sports available"
                                                    : category.categoryType === "country"
                                                        ? "No countries available"
                                                        : category.categoryType === "team"
                                                            ? "No teams available"
                                                            : category.categoryType === "competition"
                                                                ? "No competitions available"
                                                                : "No matches available";
                                                return (_jsxs("div", { className: "news-edit-category-row", children: [_jsxs("select", { value: category.categoryType, onChange: (event) => setArticleForm((current) => {
                                                                const nextCategories = current.categories.map((row, rowIndex) => rowIndex === index ? {
                                                                    ...row,
                                                                    categoryType: event.target.value,
                                                                    entityId: ""
                                                                } : row);
                                                                return {
                                                                    ...current,
                                                                    categories: sanitizeNewsCategoryRows(nextCategories, {
                                                                        sports,
                                                                        countries,
                                                                        hosts,
                                                                        competitions,
                                                                        teams,
                                                                        matches,
                                                                        competitionTeamIds
                                                                    })
                                                                };
                                                            }), children: [_jsx("option", { value: "sport", children: "Sport" }), _jsx("option", { value: "country", children: "Country" }), _jsx("option", { value: "host", children: "Host" }), _jsx("option", { value: "team", children: "Team" }), _jsx("option", { value: "competition", children: "Competition" }), _jsx("option", { value: "match", children: "Match" })] }), _jsxs("select", { value: category.entityId, onChange: (event) => setArticleForm((current) => {
                                                                const nextCategories = current.categories.map((row, rowIndex) => rowIndex === index ? { ...row, entityId: event.target.value } : row);
                                                                return {
                                                                    ...current,
                                                                    categories: sanitizeNewsCategoryRows(nextCategories, {
                                                                        sports,
                                                                        countries,
                                                                        hosts,
                                                                        competitions,
                                                                        teams,
                                                                        matches,
                                                                        competitionTeamIds
                                                                    })
                                                                };
                                                            }), children: [_jsx("option", { value: "", children: options.length > 0 ? "Choose" : emptyLabel }), options.map((option) => (_jsx("option", { value: option.id, children: option.name }, option.id)))] }), _jsx("button", { type: "button", onClick: () => setArticleForm((current) => ({
                                                                ...current,
                                                                categories: current.categories.filter((_, rowIndex) => rowIndex !== index)
                                                            })), children: "Remove" })] }, category.id));
                                            })] }), _jsxs("label", { children: ["Tags", _jsx("input", { value: articleForm.tags, onChange: (event) => setArticleForm((current) => ({ ...current, tags: event.target.value })), placeholder: "Add tags separated by commas" })] }), _jsxs("label", { children: ["Source", _jsxs("select", { value: articleForm.sourceId, onChange: (event) => setArticleForm((current) => ({ ...current, sourceId: event.target.value })), children: [_jsx("option", { value: "", children: "Choose a source" }), sources.map((source) => (_jsx("option", { value: source.id, children: source.name }, source.id)))] })] }), _jsxs("label", { children: ["Media references", _jsx("textarea", { value: articleForm.mediaReferences, onChange: (event) => setArticleForm((current) => ({ ...current, mediaReferences: event.target.value })), rows: 4, placeholder: "One image URL per line" })] }), _jsxs("label", { children: ["Outbound links", _jsx("textarea", { value: articleForm.outboundLinks, onChange: (event) => setArticleForm((current) => ({ ...current, outboundLinks: event.target.value })), rows: 4, placeholder: "One URL per line" })] }), _jsxs("label", { children: ["Status", _jsx("select", { value: articleForm.status, onChange: (event) => setArticleForm((current) => ({ ...current, status: event.target.value })), children: Object.entries(statusLabels).map(([value, label]) => (_jsx("option", { value: value, children: label }, value))) })] })] })] }), _jsxs("section", { className: "console-panel news-panel", children: [_jsxs("div", { className: "news-panel-header", children: [_jsx("h3", { children: "Manage" }), _jsx("p", { children: "Load an existing article from the list to edit it." })] }), _jsx("div", { className: "news-list-stack", children: articles.map((article) => (_jsxs("button", { type: "button", className: "news-item-card", onClick: () => {
                                        resetArticleForm(article);
                                        setSelectedArticleId(article.id);
                                        setActiveSection("articles");
                                    }, children: [getArticleThumbnail(article) ? (_jsx("img", { className: "news-article-thumbnail", src: getArticleThumbnail(article) ?? undefined, alt: "" })) : null, _jsxs("div", { className: "news-item-title-row", children: [_jsx("strong", { children: article.title }), _jsx("span", { children: statusLabels[article.status] })] }), _jsx("span", { children: article.source?.name ?? article.sourceName ?? "Unassigned" }), _jsxs("small", { children: ["Category: ", getArticleCategories(article)] }), _jsxs("small", { children: ["Status: ", statusLabels[article.status]] }), _jsxs("small", { children: ["Content: ", getContentAvailability(article)] }), _jsxs("small", { children: ["Origin: ", article.contentOrigin ?? "Unknown"] }), _jsx("small", { children: formatDate(article.updatedAt) })] }, article.id))) })] })] })) : null, activeSection === "sources" ? (_jsxs("div", { className: "news-grid", children: [_jsxs("section", { className: "console-panel news-panel", children: [_jsxs("div", { className: "news-panel-header", children: [_jsx("h3", { children: "News Sources" }), _jsx("p", { children: "List, add, edit, enable, and disable the configured news sources." })] }), _jsxs("div", { className: "news-action-row", children: [_jsx("button", { type: "button", onClick: () => { setSourceForm(emptySourceForm()); setEditingSourceId(null); }, children: "New source" }), _jsx("button", { type: "button", onClick: () => void handleSourceSubmit(), children: "Save source" })] }), _jsxs("form", { className: "news-editor-form", onSubmit: (event) => { event.preventDefault(); void handleSourceSubmit(); }, children: [_jsxs("label", { children: ["Name", _jsx("input", { value: sourceForm.name, onChange: (event) => setSourceForm((current) => ({ ...current, name: event.target.value })) })] }), _jsxs("label", { children: ["Type", _jsx("select", { value: sourceForm.sourceType, onChange: (event) => setSourceForm((current) => ({ ...current, sourceType: event.target.value })), children: Object.entries(sourceTypeLabels).map(([value, label]) => (_jsx("option", { value: value, children: label }, value))) })] }), _jsxs("label", { children: ["Base URL", _jsx("input", { value: sourceForm.baseUrl, onChange: (event) => setSourceForm((current) => ({ ...current, baseUrl: event.target.value })) })] }), _jsxs("label", { children: ["Feed URL", _jsx("input", { value: sourceForm.feedUrl, onChange: (event) => setSourceForm((current) => ({ ...current, feedUrl: event.target.value })) })] }), _jsxs("label", { children: ["Enabled", _jsx("input", { type: "checkbox", checked: sourceForm.enabled, onChange: (event) => setSourceForm((current) => ({ ...current, enabled: event.target.checked })) })] })] })] }), _jsxs("section", { className: "console-panel news-panel", children: [_jsxs("div", { className: "news-panel-header", children: [_jsx("h3", { children: "Configured sources" }), _jsx("p", { children: "Manage the active source inventory." })] }), _jsx("div", { className: "news-list-stack", children: sources.map((source) => (_jsxs("div", { className: "news-source-card", children: [_jsxs("div", { className: "news-item-title-row", children: [_jsx("strong", { children: source.name }), _jsx("span", { children: source.enabled ? "Enabled" : "Disabled" })] }), _jsx("small", { children: sourceTypeLabels[source.sourceType] }), _jsx("small", { children: source.feedUrl ? `Feed: ${source.feedUrl}` : "No feed URL configured" }), _jsx("small", { children: source.lastCollectionStatus ? `Last collection: ${source.lastCollectionStatus}` : "No collection run yet" }), _jsxs("small", { children: ["Publishing rights: ", rightsStatusLabels[source.rightsStatus ?? "unknown"] ?? "Unknown"] }), _jsx("small", { children: source.rightsAuditSummary ?? "No rights audit summary recorded yet." }), sourceAuditDetails[source.id] ? ((() => {
                                            const audit = sourceAuditDetails[source.id];
                                            return (_jsxs("div", { className: "news-audit-summary-block", children: [_jsx("strong", { children: "Last local audit" }), _jsx("span", { children: rightsStatusLabels[audit.status] ?? audit.status }), _jsx("span", { children: audit.summary ?? "No summary provided." }), _jsxs("div", { className: "news-audit-evidence-list", children: [_jsx("strong", { children: "Evidence" }), audit.evidence.map((evidence) => (_jsxs("div", { className: "news-audit-evidence-item", children: [_jsx("a", { href: evidence.evidenceUrl, target: "_blank", rel: "noreferrer", children: evidence.pageTitle ?? evidence.evidenceUrl }), _jsxs("span", { children: ["Origin: ", evidence.evidenceOrigin ?? "unknown"] }), _jsxs("span", { children: ["Type: ", rightsEvidenceTypeLabels[evidence.evidenceType] ?? evidence.evidenceType] }), _jsx("p", { children: evidence.snippet ?? "No snippet available." })] }, evidence.id)))] }), _jsxs("div", { className: "news-audit-permissions-list", children: [_jsx("strong", { children: "Permissions" }), audit.permissions.map((permission) => (_jsxs("div", { className: "news-audit-permission-item", children: [_jsx("span", { children: rightsPermissionLabels[permission.permission] ?? permission.permission }), _jsx("span", { children: permission.allowed ? "Allowed" : "Not allowed" }), _jsx("small", { children: permission.notes ?? "No detail" })] }, permission.id)))] })] }));
                                        })()) : null, _jsxs("div", { className: "news-action-row", children: [_jsx("button", { type: "button", onClick: () => { setSourceForm({ id: source.id, name: source.name, sourceType: source.sourceType, baseUrl: source.baseUrl ?? "", feedUrl: source.feedUrl ?? "", enabled: source.enabled }); setEditingSourceId(source.id); }, children: "Edit" }), _jsx("button", { type: "button", onClick: () => void handleCollectSource(source), children: "Collect now" }), _jsx("button", { type: "button", onClick: () => void handleAuditSourceRights(source), children: "Check publishing rights" }), _jsx("button", { type: "button", onClick: () => void handleToggleSource(source), children: source.enabled ? "Disable" : "Enable" }), _jsx("button", { type: "button", onClick: () => void handleDeleteSource(source.id), children: "Delete" })] })] }, source.id))) })] })] })) : null, activeSection === "rss" ? (_jsxs("div", { className: "news-grid", children: [_jsxs("section", { className: "console-panel news-panel", children: [_jsxs("div", { className: "news-panel-header", children: [_jsx("h3", { children: "Add RSS source" }), _jsx("p", { children: "Bring RSS or Atom items into Incoming News for editorial review. Nothing is published automatically." })] }), _jsxs("form", { className: "news-editor-form", onSubmit: (event) => { event.preventDefault(); void handleCreateRssSource(); }, children: [_jsxs("label", { children: ["Feed URL", _jsx("input", { required: true, type: "url", placeholder: "https://example.com/feed.xml", value: rssFeedUrl, onChange: (event) => setRssFeedUrl(event.target.value) })] }), _jsxs("label", { children: ["Source name", _jsx("input", { required: true, placeholder: "BBC Sport", value: rssSourceName, onChange: (event) => setRssSourceName(event.target.value) })] }), _jsx("button", { type: "submit", children: "Add source" })] })] }), _jsxs("section", { className: "console-panel news-panel", children: [_jsxs("div", { className: "news-panel-header", children: [_jsx("h3", { children: "GiTO News RSS" }), _jsx("p", { children: "This feed contains published GiTO News articles only." })] }), _jsxs("div", { className: "news-action-row", children: [_jsx("input", { "aria-label": "GiTO News RSS URL", readOnly: true, value: rssPublisherUrl }), _jsx("button", { type: "button", onClick: () => void navigator.clipboard?.writeText(rssPublisherUrl), children: "Copy feed URL" })] })] }), _jsxs("section", { className: "console-panel news-panel", children: [_jsxs("div", { className: "news-panel-header", children: [_jsx("h3", { children: "Configured RSS sources" }), _jsx("p", { children: "Fetch manually when you are ready to check for new source material." })] }), _jsxs("div", { className: "news-list-stack", children: [rssSources.map((source) => {
                                        const result = rssFetchResult[source.id];
                                        return (_jsxs("div", { className: "news-source-card", children: [_jsxs("div", { className: "news-item-title-row", children: [_jsx("strong", { children: source.name }), _jsx("span", { children: source.enabled ? "Active" : "Disabled" })] }), _jsx("a", { href: source.feedUrl ?? undefined, target: "_blank", rel: "noreferrer", children: source.feedUrl }), result ? _jsxs("small", { children: ["Feed checked successfully \u00B7 ", result.fetchedItems, " items found \u00B7 ", result.importedItems, " new \u00B7 ", result.skippedDuplicates, " already imported"] }) : null, _jsxs("div", { className: "news-action-row", children: [_jsx("button", { type: "button", onClick: () => void handleFetchRssSource(source), children: "Fetch now" }), _jsx("button", { type: "button", onClick: () => void handleDeleteRssSource(source.id), children: "Delete" })] })] }, source.id));
                                    }), !rssSources.length ? _jsx("p", { children: "No RSS sources configured." }) : null] })] })] })) : null, activeSection === "web-rss" ? (_jsxs("div", { className: "news-grid", children: [_jsxs("section", { className: "console-panel news-panel", children: [_jsxs("div", { className: "news-panel-header", children: [_jsx("h3", { children: "Create RSS from Web Page" }), _jsx("p", { children: "Turn a webpage into a reusable RSS feed for GiTO." })] }), _jsxs("form", { className: "news-editor-form", onSubmit: (event) => { event.preventDefault(); void handleCreateWebRss(); }, children: [_jsxs("label", { children: ["Website URL", _jsx("input", { required: true, type: "url", placeholder: "https://example.com/sports", value: webRssUrl, onChange: (event) => setWebRssUrl(event.target.value) })] }), _jsxs("label", { children: ["Feed name", _jsx("input", { required: true, placeholder: "My Sports Feed", value: webRssName, onChange: (event) => setWebRssName(event.target.value) })] }), _jsx("button", { type: "submit", disabled: webRssLoading, children: webRssLoading ? "Analyzing webpage…" : "Generate RSS Feed" })] }), _jsxs("details", { children: [_jsx("summary", { children: "How this works" }), _jsx("p", { children: "GiTO analyzes the supplied webpage, discovers article links, and creates an RSS feed from the content it can identify." })] })] }), _jsxs("section", { className: "console-panel news-panel", children: [_jsxs("div", { className: "news-panel-header", children: [_jsx("h3", { children: "Generated feeds" }), _jsx("p", { children: "Discovered articles remain source material. GiTO does not generate or publish stories automatically." })] }), _jsxs("div", { className: "news-list-stack", children: [generatedFeeds.map((feed) => (_jsxs("div", { className: "news-source-card", children: [_jsxs("div", { className: "news-item-title-row", children: [_jsx("strong", { children: feed.name }), _jsx("span", { children: feed.status === "ready" || feed.status === "partial" ? "RSS feed ready" : feed.status })] }), _jsxs("small", { children: ["Source: ", feed.sourceUrl] }), _jsxs("small", { children: ["Articles discovered: ", feed.discoveredArticleCount] }), feed.crawlerTier ? _jsxs("small", { children: ["Crawler method: ", feed.crawlerTier === "browser" ? "Browser-rendered" : "Standard web crawl"] }) : null, feed.status === "failed" && feed.errorMessage ? _jsx("p", { role: "alert", children: feed.errorMessage }) : null, _jsxs("a", { href: feed.feedUrl, target: "_blank", rel: "noreferrer", children: ["RSS Feed URL: ", feed.feedUrl] }), _jsxs("div", { className: "news-action-row", children: [_jsx("button", { type: "button", onClick: () => void navigator.clipboard?.writeText(feed.feedUrl), children: "Copy RSS URL" }), _jsx("button", { type: "button", disabled: webRssLoading, onClick: () => void handleRefreshWebRss(feed.id), children: "Refresh feed" }), feed.status === "failed" ? _jsx("button", { type: "button", disabled: webRssLoading, onClick: () => void handleRefreshWebRss(feed.id), children: "Try again" }) : null, _jsx("button", { type: "button", onClick: () => void handlePreviewWebRss(feed.id), children: "Preview articles" }), _jsx("button", { type: "button", onClick: () => void handleDeleteWebRss(feed.id), children: "Delete feed" })] }), webRssPreview[feed.id] ? _jsx("div", { className: "news-list-stack", children: (webRssPreview[feed.id] ?? []).map((article) => _jsxs("div", { className: "news-source-card", children: [_jsx("strong", { children: article.title }), _jsx("small", { children: article.sourceName }), _jsx("a", { href: article.articleUrl, target: "_blank", rel: "noreferrer", children: article.articleUrl }), _jsxs("small", { children: [article.publishedAt ? formatDate(article.publishedAt) : "Publication date unavailable", " \u00B7 Discovered"] })] }, article.id)) }) : null] }, feed.id))), !generatedFeeds.length ? _jsx("p", { children: "No generated webpage feeds yet." }) : null] })] })] })) : null, activeSection === "published" ? (_jsxs("section", { className: "console-panel news-panel", children: [_jsxs("div", { className: "news-panel-header", children: [_jsx("h3", { children: "Published" }), _jsx("p", { children: "Review published articles and their current publishing state." })] }), _jsx("div", { className: "news-list-stack", children: publishedArticles.map((article) => (_jsxs("div", { className: "news-source-card", children: [_jsxs("div", { className: "news-item-title-row", children: [_jsx("strong", { children: article.title }), _jsx("span", { children: statusLabels[article.status] })] }), _jsx("small", { children: article.source?.name ?? article.sourceName ?? "Unassigned" }), _jsxs("small", { children: ["Published ", formatDate(article.publishedAt)] }), _jsx("div", { className: "news-action-row", children: _jsx("button", { type: "button", onClick: () => { setSelectedArticleId(article.id); setActiveSection("incoming"); }, children: "Open article" }) })] }, article.id))) })] })) : null] }));
}
