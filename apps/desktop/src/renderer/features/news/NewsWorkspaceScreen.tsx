import React, { useEffect, useMemo, useState } from "react";

import { createSlug } from "@gito/shared";
import type {
  CreateNewsArticleRequest,
  CreateNewsSourceRequest,
  Competition,
  Country,
  Match,
  NewsArticle,
  NewsArticleCategory,
  NewsArticleCategoryType,
  NewsArticleStatus,
  NewsResearchResult,
  NewsSource,
  NewsSourceRightsAudit,
  NewsSourceType,
  Sport,
  Team
} from "@gito/shared";

import { apiClient } from "../../services/api-client";
import {
  getFilteredCategoryOptions,
  getSelectedCategoryEntityId,
  sanitizeNewsCategoryRows,
  type NewsCategoryFormRow
} from "./news-category-filters";
import {
  filterNewsArticles,
  getNormalizedFetchedSourcePreview,
  isGiTOFactCheckRequired,
  isGiTOGeneratedArticle,
  isGiTOInsufficientSourceMaterial,
  shouldClearEditingArticleAfterDelete,
  shouldClearSelectedArticleAfterDelete,
  type NewsArticleFilters
} from "./news-workspace-helpers";
import { NewsClassificationPanel } from "./NewsClassificationPanel";

type NewsSection = "overview" | "incoming" | "articles" | "sources" | "rss" | "web-rss" | "published";

type CategoryRow = {
  id: string;
  categoryType: NewsArticleCategoryType;
  entityId: string;
};

type ArticleFormState = {
  title: string;
  summary: string;
  body: string;
  sourceId: string;
  sourceName: string;
  sourceUrl: string;
  tags: string;
  mediaReferences: string;
  outboundLinks: string;
  status: NewsArticleStatus;
  categories: CategoryRow[];
};

type SourceFormState = {
  id: string;
  name: string;
  sourceType: NewsSourceType;
  baseUrl: string;
  feedUrl: string;
  enabled: boolean;
};

type ResearchState = "idle" | "loading" | "success" | "failed" | "unavailable";
type ResearchTab = "original" | "research" | "draft";

const sectionItems: Array<{ key: NewsSection; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "incoming", label: "Incoming News" },
  { key: "articles", label: "Articles" },
  { key: "sources", label: "Sources" },
  { key: "rss", label: "RSS Sources" },
  { key: "web-rss", label: "Web Page → RSS" },
  { key: "published", label: "Published" }
];

const statusLabels: Record<NewsArticleStatus, string> = {
  draft: "Draft",
  review: "Review",
  published: "Published",
  archived: "Archived"
};

const sourceTypeLabels: Record<NewsSourceType, string> = {
  external: "External",
  partner: "Partner",
  wire: "Wire",
  internal: "Internal"
};

const rightsStatusLabels: Record<string, string> = {
  unknown: "Unknown",
  full_republication_permitted: "Full republication permitted",
  republication_permitted_with_conditions: "Permitted with conditions",
  limited_use_only: "Limited use only",
  republication_not_permitted: "Not permitted",
  review_required: "Review required"
};

const rightsEvidenceTypeLabels: Record<string, string> = {
  rss_terms: "RSS / feed terms",
  terms_of_use: "Terms of use",
  copyright_policy: "Copyright policy",
  republication_policy: "Republication policy",
  syndication: "Syndication policy",
  licensing: "Licensing",
  other: "Other"
};

const rightsPermissionLabels: Record<string, string> = {
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

const emptyArticleForm = (): ArticleFormState => ({
  title: "",
  summary: "",
  body: "",
  sourceId: "",
  sourceName: "",
  sourceUrl: "",
  tags: "",
  mediaReferences: "",
  outboundLinks: "",
  status: "draft",
  categories: []
});

const emptySourceForm = (): SourceFormState => ({
  id: "",
  name: "",
  sourceType: "external",
  baseUrl: "",
  feedUrl: "",
  enabled: true
});

function formatDate(value?: string | null) {
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

function getArticleThumbnail(article: NewsArticle): string | null {
  return article.media?.find((media) => media.mediaType === "image")?.url ?? null;
}

function getArticleCategories(article: NewsArticle): string {
  return article.categories?.map((category) => `${category.categoryType}:${category.entityId}`).join(", ") || "Uncategorized";
}


function normalizeFetchedSourceBody(input: string): string {
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

function getContentAvailability(article: NewsArticle | null): string {
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

export function NewsWorkspaceScreen({ accessToken }: { accessToken: string }) {
  const [activeSection, setActiveSection] = useState<NewsSection>("overview");
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [sources, setSources] = useState<NewsSource[]>([]);
  const [rssSources, setRssSources] = useState<NewsSource[]>([]);
  const [rssSourceName, setRssSourceName] = useState("");
  const [rssFeedUrl, setRssFeedUrl] = useState("");
  const [rssFetchResult, setRssFetchResult] = useState<Record<string, { fetchedItems: number; importedItems: number; skippedDuplicates: number; failedItems: number }>>({});
  const [generatedFeeds, setGeneratedFeeds] = useState<any[]>([]);
  const [webRssUrl, setWebRssUrl] = useState("");
  const [webRssName, setWebRssName] = useState("");
  const [webRssLoading, setWebRssLoading] = useState(false);
  const [webRssPreview, setWebRssPreview] = useState<Record<string, any[]>>({});
  const [sports, setSports] = useState<Sport[]>([]);
  const [countries, setCountries] = useState<Country[]>([]);
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [competitionTeamIds, setCompetitionTeamIds] = useState<Record<string, string[]>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [statusMessage, setStatusMessage] = useState("News workspace ready.");
  const [articleFilters, setArticleFilters] = useState<NewsArticleFilters>({
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
  const [articleForm, setArticleForm] = useState<ArticleFormState>(emptyArticleForm());
  const [editingArticleId, setEditingArticleId] = useState<string | null>(null);
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null);
  const [sourceForm, setSourceForm] = useState<SourceFormState>(emptySourceForm());
  const [editingSourceId, setEditingSourceId] = useState<string | null>(null);
  const [sourceAuditDetails, setSourceAuditDetails] = useState<Record<string, NewsSourceRightsAudit>>({});
  const [isGeneratingDraft, setIsGeneratingDraft] = useState(false);
  const [selectedArticleIds, setSelectedArticleIds] = useState<string[]>([]);
  const [isPublishingArticleId, setIsPublishingArticleId] = useState<string | null>(null);
  const [approvingClassificationId, setApprovingClassificationId] = useState<string | null>(null);
  const [approvingMultipleClassifications, setApprovingMultipleClassifications] = useState(false);
  const [savingArticleStatus, setSavingArticleStatus] = useState<NewsArticleStatus | null>(null);
  const [researchSourceArticleId, setResearchSourceArticleId] = useState<string | null>(null);
  const [researchResult, setResearchResult] = useState<NewsResearchResult | null>(null);
  const [researchLoading, setResearchLoading] = useState(false);
  const [researchState, setResearchState] = useState<ResearchState>("idle");
  const [researchError, setResearchError] = useState<string | null>(null);
  const [isResearchPanelOpen, setIsResearchPanelOpen] = useState(false);
  const [researchTab, setResearchTab] = useState<ResearchTab>("original");
  const [classification, setClassification] = useState<{ approved: NewsArticleCategory[]; suggestions: NewsArticleCategory[] } | null>(null);
  const [selectedClassificationIds, setSelectedClassificationIds] = useState<string[]>([]);
  const [aiClassificationStatus, setAiClassificationStatus] = useState<"idle" | "running" | "success" | "unavailable" | "failed">("idle");

  const loadData = async () => {
    try {
      setIsLoading(true);
      const [articleData, sourceData, rssSourceData, generatedFeedData, sportData, countryData, competitionData, teamData, matchData] = await Promise.all([
        apiClient.listNewsArticles(),
        apiClient.listNewsSources(),
        apiClient.listNewsRssSources(accessToken),
        apiClient.listGeneratedNewsRssFeeds(accessToken),
        apiClient.listSports(),
        apiClient.listCountries(),
        apiClient.listCompetitions(),
        apiClient.listTeams(),
        apiClient.listMatches()
      ] as const);
      setArticles(articleData);
      setSources(sourceData);
      setRssSources(rssSourceData);
      setGeneratedFeeds(generatedFeedData);
      setSports(sportData);
      setCountries(countryData);
      setCompetitions(competitionData);
      setTeams(teamData);
      setMatches(matchData as Match[]);
      setStatusMessage("News data loaded.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load news data.";
      setStatusMessage(message);
    } finally {
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
        if (cancelled) return;
        setResearchResult(result);
        setResearchState("success");
      })
      .catch((error) => {
        if (cancelled) return;
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
      } catch {
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

  const resetArticleForm = (article?: NewsArticle) => {
    setEditingArticleId(article?.id ?? null);
    setArticleForm({
      title: article?.title ?? "",
      summary: article?.summary ?? "",
      body: article?.body ?? "",
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

  const handleArticleSubmit = async (nextStatus: NewsArticleStatus) => {
    if (!articleForm.title.trim()) {
      setStatusMessage("A title is required before saving an article.");
      return;
    }

    setSavingArticleStatus(nextStatus);
    try {
      const resolvedCategoryRows = articleForm.categories.filter((category) => category.entityId);
      const categoryMap = new Map<NewsArticleCategoryType, string>();
      for (const category of resolvedCategoryRows) {
        if (!categoryMap.has(category.categoryType)) {
          categoryMap.set(category.categoryType, category.entityId);
        }
      }

      const payload: CreateNewsArticleRequest = {
        title: articleForm.title.trim(),
        slug: createSlug(articleForm.title.trim() || "article"),
        summary: articleForm.summary || null,
        body: articleForm.body || null,
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

      let article: NewsArticle;
      if (editingArticleId) {
        article = await apiClient.updateNewsArticle(editingArticleId, payload, accessToken);
      } else {
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
      } else if (nextStatus === "archived") {
        article = await apiClient.archiveNewsArticle(article.id, accessToken);
      }

      setStatusMessage(`Article ${nextStatus === "published" ? "published" : nextStatus === "archived" ? "archived" : "saved"}.`);
      setEditingArticleId(article.id);
      setSelectedArticleId(article.id);
      setActiveSection("articles");
      await loadData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save article.";
      setStatusMessage(message);
    } finally {
      setSavingArticleStatus(null);
    }
  };

  const handlePublishArticle = async (articleId: string) => {
    setIsPublishingArticleId(articleId);
    try {
      await apiClient.publishNewsArticle(articleId, accessToken);
      setStatusMessage("Article published.");
      await loadData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to publish article.";
      setStatusMessage(message);
    } finally {
      setIsPublishingArticleId(null);
    }
  };

  const handleArchiveArticle = async (articleId: string) => {
    try {
      await apiClient.archiveNewsArticle(articleId, accessToken);
      setStatusMessage("Article archived.");
      await loadData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to archive article.";
      setStatusMessage(message);
    }
  };

  const handleFetchArticleContent = async (articleId: string) => {
    try {
      const result = await apiClient.fetchNewsArticleContent(articleId, accessToken);
      setStatusMessage(result.message || (result.success ? "Article content fetched." : "Article content fetch failed."));
      await loadData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to fetch article content.";
      setStatusMessage(message);
    }
  };

  const handleSelectIncomingArticle = (articleId: string) => {
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
    } catch (error) {
      const message = error instanceof Error ? error.message : "Research failed.";
      setResearchResult(null);
      setResearchState("failed");
      setResearchError(message);
      setStatusMessage(/401|unauthorized|forbidden/i.test(message) ? "You are not authorized to research this story." : "Research failed. Retry when ready.");
    } finally {
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
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to generate GiTO original story.";
      setStatusMessage(/401|unauthorized|forbidden/i.test(message) ? "You are not authorized to generate this story." : message);
    } finally {
      setIsGeneratingDraft(false);
    }
  };

  const classificationLabel = (category: NewsArticleCategory) => {
    const collections: Record<string, Array<{ id: string; name: string }>> = {
      team: teams,
      sport: sports,
      country: countries,
      competition: competitions,
      match: matches.map((match) => ({ id: match.id, name: `${match.homeTeamId} vs ${match.awayTeamId}` }))
    };
    return collections[category.categoryType]?.find((entity) => entity.id === category.entityId)?.name ?? category.entityId;
  };

  const refreshClassification = async (articleId: string) => {
    const result = await apiClient.getNewsClassification(articleId, accessToken);
    setClassification(result);
    setSelectedClassificationIds([]);
  };

  const rerunClassification = async () => {
    if (!selectedArticleId) return;
    try { await apiClient.rerunNewsClassification(selectedArticleId, accessToken); await refreshClassification(selectedArticleId); setStatusMessage("Classification suggestions refreshed. Approved relationships were preserved."); }
    catch (error) { setStatusMessage(error instanceof Error ? error.message : "Classification rerun failed."); }
  };

  const aiClassifySelectedArticle = async () => {
    if (!selectedArticleId) return;
    setAiClassificationStatus("running");
    try {
      const result = await apiClient.aiClassifyNewsArticle(selectedArticleId, accessToken);
      setClassification(result);
      setSelectedClassificationIds([]);
      setAiClassificationStatus("success");
      setStatusMessage("AI suggestions added. Editorial approval is still required.");
    } catch (error) {
      setAiClassificationStatus("unavailable");
      setStatusMessage(error instanceof Error ? error.message : "AI classification is temporarily unavailable.");
    }
  };

  const approveClassification = async (categoryId: string) => {
    if (!selectedArticleId) return;
    setApprovingClassificationId(categoryId);
    try {
      await apiClient.approveNewsClassification(selectedArticleId, categoryId, accessToken);
      await refreshClassification(selectedArticleId);
      await loadData();
      setStatusMessage("Classification approved.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Unable to approve classification.");
    } finally {
      setApprovingClassificationId(null);
    }
  };

  const rejectClassification = async (categoryId: string) => {
    if (!selectedArticleId) return;
    try { await apiClient.rejectNewsClassification(selectedArticleId, categoryId, accessToken); await refreshClassification(selectedArticleId); setStatusMessage("Classification rejected."); }
    catch (error) { setStatusMessage(error instanceof Error ? error.message : "Unable to reject classification."); }
  };

  const approveSelectedClassifications = async () => {
    if (!selectedArticleId || !selectedClassificationIds.length) return;
    setApprovingMultipleClassifications(true);
    try {
      await apiClient.approveNewsClassifications(selectedArticleId, selectedClassificationIds, accessToken);
      await refreshClassification(selectedArticleId);
      await loadData();
      setStatusMessage("Selected classifications approved.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Unable to approve classifications.");
    } finally {
      setApprovingMultipleClassifications(false);
    }
  };

  const refreshSelectedClassification = async () => {
    if (!selectedArticleId) return;
    const result = await apiClient.getNewsClassification(selectedArticleId, accessToken);
    setClassification(result);
    setSelectedClassificationIds([]);
  };

  const addManualClassification = async (categoryType: NewsArticleCategoryType, entityId: string) => {
    if (!selectedArticleId) return;
    try {
      await apiClient.addManualNewsClassification(selectedArticleId, categoryType, entityId, accessToken);
      await refreshSelectedClassification();
      await loadData();
      setStatusMessage("Editorial relationship added.");
    } catch (error) { setStatusMessage(error instanceof Error ? error.message : "Unable to add relationship."); }
  };

  const removeApprovedClassification = async (categoryId: string) => {
    if (!selectedArticleId) return;
    try {
      await apiClient.removeNewsClassification(selectedArticleId, categoryId, accessToken);
      await refreshSelectedClassification();
      await loadData();
      setStatusMessage("Editorial relationship removed.");
    } catch (error) { setStatusMessage(error instanceof Error ? error.message : "Unable to remove relationship."); }
  };

  const handleDeleteArticle = async (articleId: string) => {
    if (!window.confirm("Delete this article?")) {
      return;
    }

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
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to delete article.";
      setStatusMessage(message);
    }
  };

  const handleBulkDeleteArticles = async () => {
    if (!selectedArticleIds.length) {
      setStatusMessage("Select one or more articles before bulk deleting.");
      return;
    }

    if (!window.confirm(`Delete ${selectedArticleIds.length} selected articles?\n\nThese articles and their News-related data will be permanently removed.`)) {
      return;
    }

    try {
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
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to delete selected articles.";
      setStatusMessage(message);
    }
  };

  const handleGenerateGiTONewsDraft = async (article: NewsArticle) => {
    try {
      setIsGeneratingDraft(true);
      const draft = await apiClient.generateGiTONewsDraft(article.id, accessToken);
      setStatusMessage("GiTO draft created. Review before publishing.");
      setEditingArticleId(draft.id);
      setSelectedArticleId(draft.id);
      resetArticleForm(draft);
      setActiveSection("articles");
      await loadData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to generate GiTO draft.";
      setStatusMessage(message);
    } finally {
      setIsGeneratingDraft(false);
    }
  };

  const handleSourceSubmit = async () => {
    if (!sourceForm.name.trim()) {
      setStatusMessage("A source name is required.");
      return;
    }

    try {
      const payload: CreateNewsSourceRequest = {
        name: sourceForm.name.trim(),
        sourceType: sourceForm.sourceType,
        baseUrl: sourceForm.baseUrl || null,
        feedUrl: sourceForm.feedUrl || null,
        enabled: sourceForm.enabled
      };

      if (editingSourceId) {
        await apiClient.updateNewsSource(editingSourceId, payload, accessToken);
      } else {
        await apiClient.createNewsSource(payload, accessToken);
      }

      setSourceForm(emptySourceForm());
      setEditingSourceId(null);
      setStatusMessage("Source saved.");
      await loadData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save source.";
      setStatusMessage(message);
    }
  };

  const handleToggleSource = async (source: NewsSource) => {
    try {
      await apiClient.updateNewsSource(source.id, { enabled: !source.enabled }, accessToken);
      setStatusMessage(`Source ${source.enabled ? "disabled" : "enabled"}.`);
      await loadData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to update source.";
      setStatusMessage(message);
    }
  };

  const handleDeleteSource = async (sourceId: string) => {
    if (!window.confirm("Delete this source?")) {
      return;
    }

    try {
      await apiClient.deleteNewsSource(sourceId, accessToken);
      setStatusMessage("Source deleted.");
      await loadData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to delete source.";
      setStatusMessage(message);
    }
  };

  const handleCollectSource = async (source: NewsSource) => {
    try {
      const result = await apiClient.collectNewsSource(source.id, accessToken);
      setStatusMessage(`Collected ${result.imported} article(s) from ${source.name}.`);
      await loadData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to collect news source.";
      setStatusMessage(message);
    }
  };

  const handleAuditSourceRights = async (source: NewsSource) => {
    try {
      const audit = await apiClient.auditNewsSourcePublishingRights(source.id, accessToken);
      const auditRecord = audit as NewsSourceRightsAudit;
      setSourceAuditDetails((current) => ({ ...current, [source.id]: auditRecord }));
      setStatusMessage(`Rights status for ${source.name}: ${rightsStatusLabels[auditRecord.status] ?? auditRecord.status}.`);
      await loadData();
    } catch (error) {
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
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "GiTO could not add this RSS source.");
    }
  };

  const handleFetchRssSource = async (source: NewsSource) => {
    try {
      const result = await apiClient.fetchNewsRssSource(source.id, accessToken);
      setRssFetchResult((current) => ({ ...current, [source.id]: result }));
      setStatusMessage(`Feed checked successfully: ${result.fetchedItems} items found · ${result.importedItems} new · ${result.skippedDuplicates} already imported.`);
      await loadData();
    } catch (error) {
      setStatusMessage(error instanceof Error ? "GiTO couldn't read this feed. Check the URL and try again." : "GiTO couldn't read this feed. Check the URL and try again.");
    }
  };

  const handleDeleteRssSource = async (sourceId: string) => {
    if (!window.confirm("Delete this RSS source? Previously imported articles will remain.")) return;
    try {
      await apiClient.deleteNewsRssSource(sourceId, accessToken);
      setRssSources((current) => current.filter((source) => source.id !== sourceId));
      setStatusMessage("RSS source deleted.");
    } catch (error) {
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
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "GiTO could not access this webpage.");
    } finally {
      setWebRssLoading(false);
    }
  };

  const handleRefreshWebRss = async (feedId: string) => {
    try {
      setWebRssLoading(true);
      setStatusMessage("Analyzing webpage…");
      const feed = await apiClient.refreshGeneratedNewsRssFeed(feedId, accessToken);
      setGeneratedFeeds((current) => current.map((item) => item.id === feed.id ? feed : item));
      setStatusMessage(feed.crawlerTier === "browser" ? "Browser-rendered page analyzed. Feed refreshed successfully." : "Standard web crawl completed. Feed refreshed successfully.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "GiTO could not access this webpage.");
    } finally {
      setWebRssLoading(false);
    }
  };

  const handlePreviewWebRss = async (feedId: string) => {
    try {
      const articles = await apiClient.listGeneratedNewsRssArticles(feedId, accessToken);
      setWebRssPreview((current) => ({ ...current, [feedId]: articles }));
    } catch {
      setStatusMessage("Unable to preview discovered articles.");
    }
  };

  const handleDeleteWebRss = async (feedId: string) => {
    if (!window.confirm("Delete this generated RSS feed?")) return;
    try {
      await apiClient.deleteGeneratedNewsRssFeed(feedId, accessToken);
      setGeneratedFeeds((current) => current.filter((feed) => feed.id !== feedId));
      setStatusMessage("Generated RSS feed deleted.");
    } catch {
      setStatusMessage("Unable to delete generated RSS feed.");
    }
  };

  const rssPublisherUrl = `${window.location.origin}/news/rss.xml`;

  return (
    <section className="news-workspace-screen">
      <header className="console-panel news-workspace-header">
        <div>
          <p className="eyebrow">News Workspace</p>
          <h2>News</h2>
          <p>Manage editorial content independently from IPTV and live operations.</p>
        </div>
        <div className="news-summary-grid">
          <div className="news-summary-item">
            <strong>{summary.totalArticles}</strong>
            <span>Total articles</span>
          </div>
          <div className="news-summary-item">
            <strong>{summary.drafts}</strong>
            <span>Drafts</span>
          </div>
          <div className="news-summary-item">
            <strong>{summary.awaitingReview}</strong>
            <span>Awaiting review</span>
          </div>
          <div className="news-summary-item">
            <strong>{summary.published}</strong>
            <span>Published</span>
          </div>
          <div className="news-summary-item">
            <strong>{summary.enabledSources}</strong>
            <span>Enabled sources</span>
          </div>
        </div>
      </header>

      <div className="console-panel news-section-nav">
        {sectionItems.map((item) => (
          <button
            key={item.key}
            type="button"
            className={activeSection === item.key ? "news-section-button active" : "news-section-button"}
            onClick={() => setActiveSection(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="news-status-row">
        <span>{isLoading ? "Loading news workspace…" : statusMessage}</span>
      </div>

      {activeSection === "overview" ? (
        <div className="news-grid">
          <section className="console-panel news-panel">
            <div className="news-panel-header">
              <h3>Overview</h3>
              <p>Simple editorial snapshot for the current workspace.</p>
            </div>
            <div className="news-card-grid">
              <div className="news-card">{summary.totalArticles} total articles</div>
              <div className="news-card">{summary.drafts} drafts</div>
              <div className="news-card">{summary.awaitingReview} awaiting review</div>
              <div className="news-card">{summary.published} published</div>
              <div className="news-card">{summary.enabledSources} enabled sources</div>
            </div>
          </section>
          <section className="console-panel news-panel">
            <div className="news-panel-header">
              <h3>Incoming items</h3>
              <p>Latest draft and review articles ready for action.</p>
            </div>
            <ul className="news-list">
              {incomingArticles.slice(0, 6).map((article) => (
                <li key={article.id}>
                  <strong>{article.title}</strong>
                  <span>{statusLabels[article.status]} · {article.source?.name ?? article.sourceName ?? "Unassigned"}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      ) : null}

      {activeSection === "incoming" ? (
        <div className="news-grid">
          <section className="console-panel news-panel">
            <div className="news-panel-header">
              <h3>Incoming News</h3>
              <p>Review incoming content and prepare it for the editorial queue.</p>
            </div>
            <div className="news-filter-row">
              <input
                type="search"
                aria-label="Search titles"
                placeholder="Search titles"
                value={articleFilters.search}
                onChange={(event) => setArticleFilters((current) => ({ ...current, search: event.target.value }))}
              />
              <select
                aria-label="Filter by status"
                value={articleFilters.status}
                onChange={(event) => setArticleFilters((current) => ({ ...current, status: event.target.value }))}
              >
                <option value="">All statuses</option>
                {Object.entries(statusLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <select
                aria-label="Filter by source"
                value={articleFilters.source}
                onChange={(event) => setArticleFilters((current) => ({ ...current, source: event.target.value }))}
              >
                <option value="">All sources</option>
                {sources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}
              </select>
              <label className="news-filter-checkbox">
                <input
                  type="checkbox"
                  checked={articleFilters.generatedOnly}
                  onChange={(event) => setArticleFilters((current) => ({ ...current, generatedOnly: event.target.checked }))}
                />
                GiTO generated
              </label>
              <label className="news-filter-checkbox">
                <input
                  type="checkbox"
                  checked={articleFilters.factCheckOnly}
                  onChange={(event) => setArticleFilters((current) => ({ ...current, factCheckOnly: event.target.checked }))}
                />
                Fact-check only
              </label>
              <label className="news-filter-checkbox">
                <input
                  type="checkbox"
                  checked={articleFilters.insufficientOnly}
                  onChange={(event) => setArticleFilters((current) => ({ ...current, insufficientOnly: event.target.checked }))}
                />
                Insufficient source
              </label>
              <label className="news-filter-checkbox">
                <input
                  type="checkbox"
                  checked={articleFilters.researchCompletedOnly}
                  onChange={(event) => setArticleFilters((current) => ({ ...current, researchCompletedOnly: event.target.checked }))}
                />
                Research complete
              </label>
              <label className="news-filter-checkbox">
                <input
                  type="checkbox"
                  checked={articleFilters.researchFailedOnly}
                  onChange={(event) => setArticleFilters((current) => ({ ...current, researchFailedOnly: event.target.checked }))}
                />
                Research failed
              </label>
              <button
                type="button"
                onClick={() => setArticleFilters({
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
                })}
              >
                Clear filters
              </button>
            </div>
            <div className="news-bulk-action-bar">
              <button type="button" onClick={() => setSelectedArticleIds(incomingArticles.map((article) => article.id))}>
                Select visible
              </button>
              <button type="button" onClick={() => setSelectedArticleIds([])}>
                Clear selection
              </button>
              <button type="button" onClick={() => void handleBulkDeleteArticles()} disabled={!selectedArticleIds.length}>
                Delete selected
              </button>
              <span>{selectedArticleIds.length} article{selectedArticleIds.length === 1 ? "" : "s"} selected</span>
            </div>
            <div className="news-list-stack">
              {incomingArticles.map((article) => {
                const isChecked = selectedArticleIds.includes(article.id);
                return (
                  <div key={article.id} className={selectedArticle?.id === article.id ? "news-item-card active" : "news-item-card"}>
                    <label className="news-row-checkbox">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => setSelectedArticleIds((current) => current.includes(article.id)
                          ? current.filter((id) => id !== article.id)
                          : [...current, article.id])}
                      />
                    </label>
                    <button type="button" className="news-item-card-button" onClick={() => handleSelectIncomingArticle(article.id)}>
                      {getArticleThumbnail(article) ? (
                        <img className="news-article-thumbnail" src={getArticleThumbnail(article) ?? undefined} alt="" />
                      ) : null}
                      <div className="news-item-title-row">
                        <strong>{article.title}</strong>
                        <span>{statusLabels[article.status]}</span>
                      </div>
                      <span>{article.source?.name ?? article.sourceName ?? "Unassigned"}</span>
                      <small>Category: {getArticleCategories(article)}</small>
                      <small>Content: {getContentAvailability(article)}</small>
                      <small>Origin: {article.contentOrigin ?? "Unknown"}</small>
                      {isGiTOInsufficientSourceMaterial(article) ? <small className="news-insufficient-source-label">INSUFFICIENT SOURCE MATERIAL</small> : null}
                      <small>{article.sport?.name ?? "—"} · {article.competition?.name ?? "—"} · {article.team?.name ?? "—"}</small>
                      <small>{formatDate(article.createdAt)}</small>
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
          <section className="console-panel news-panel">
            <div className="news-panel-header">
              <h3>Review</h3>
              <p>Open a selected article for review or editing.</p>
            </div>
            {selectedArticle ? (
              <div className="news-detail-card">
                <div className="news-detail-badge-row">
                  {selectedArticleIsRss ? <span className="news-badge">RSS source</span> : null}
                  {isGiTOGeneratedArticle(selectedArticle) ? (
                    <span className="news-badge ai-generated">GiTO AI-ASSISTED</span>
                  ) : null}
                  {isGiTOGeneratedArticle(selectedArticle) ? (
                    <span className="news-badge review-required">REVIEW REQUIRED</span>
                  ) : null}
                  {isGiTOFactCheckRequired(selectedArticle) ? (
                    <span className="news-badge fact-check-required">FACT-CHECK REQUIRED</span>
                  ) : null}
                  {isGiTOInsufficientSourceMaterial(selectedArticle) ? (
                    <span className="news-badge insufficient-source">INSUFFICIENT SOURCE MATERIAL</span>
                  ) : null}
                </div>
                <h4>{selectedArticle.title}</h4>
                <div className="news-detail-summary">
                  <strong>Summary</strong>
                  <p>{selectedArticle.summary || "No summary yet."}</p>
                </div>
                {selectedArticle.body ? (
                  <div className="news-detail-body">
                    <strong>Body</strong>
                    <p>{selectedArticle.body}</p>
                  </div>
                ) : null}
                <div className="news-detail-meta">
                  <span>Source: {selectedArticle.source?.name ?? selectedArticle.sourceName ?? "Unassigned"}</span>
                  {selectedArticle.sourceId === null && selectedArticle.sourceName ? <span>Source configuration: Removed</span> : null}
                  <span>Sport: {selectedArticle.sport?.name ?? "—"}</span>
                  <span>Competition: {selectedArticle.competition?.name ?? "—"}</span>
                  <span>Team: {selectedArticle.team?.name ?? "—"}</span>
                  <span>Status: {statusLabels[selectedArticle.status]}</span>
                  <span>Content origin: {selectedArticle.contentOrigin ?? "Unknown"}</span>
                  <span>Availability: {getContentAvailability(selectedArticle)}</span>
                </div>
                <NewsClassificationPanel
                  classification={classification}
                  labelFor={classificationLabel}
                  selectedIds={selectedClassificationIds}
                  onToggle={(categoryId) => setSelectedClassificationIds((current) => current.includes(categoryId) ? current.filter((id) => id !== categoryId) : [...current, categoryId])}
                  onApprove={(categoryId) => void approveClassification(categoryId)}
                  onReject={(categoryId) => void rejectClassification(categoryId)}
                  onApproveSelected={() => void approveSelectedClassifications()}
                  onRerun={() => void rerunClassification()}
                  approvingCategoryId={approvingClassificationId}
                  approvingMultiple={approvingMultipleClassifications}
                  aiStatus={aiClassificationStatus}
                  onAiClassify={() => void aiClassifySelectedArticle()}
                  entities={{
                    team: teams.map((team) => ({ id: team.id, name: team.name })),
                    competition: competitions.map((competition) => ({ id: competition.id, name: competition.name })),
                    country: countries.map((country) => ({ id: country.id, name: country.name })),
                    sport: sports.map((sport) => ({ id: sport.id, name: sport.name })),
                    match: matches.map((match) => ({ id: match.id, name: `${match.homeTeamId} vs ${match.awayTeamId}` }))
                  }}
                  onAddManual={(categoryType, entityId) => void addManualClassification(categoryType, entityId)}
                  onRemoveApproved={(categoryId) => void removeApprovedClassification(categoryId)}
                />
                {selectedArticle.fetchedBody ? (
                  <div className="news-detail-original-source">
                    <strong>Original source preview</strong>
                    <pre>{normalizeFetchedSourceBody(selectedArticle.fetchedBody)}</pre>
                  </div>
                ) : null}
                {researchSourceArticle && researchSourceArticle.id === selectedArticle.id ? (
                  <div className="news-research-panel">
                    <div className="news-panel-header">
                      <h4>AI-assisted research</h4>
                      <p>GiTO will gather supporting information and build an evidence set before generating an original story. The source article will not be modified.</p>
                    </div>
                    {(researchLoading || researchState === "loading") ? (
                      <div role="status" className="news-research-loading">
                        <strong>Researching story…</strong>
                        <span>Finding relevant sources…</span>
                        <span>Checking facts…</span>
                      </div>
                    ) : null}
                    {researchState === "failed" ? (
                      <div role="alert" className="news-research-error">
                        <strong>Research failed</strong>
                        <span>{researchError || "GiTO could not complete the research request."}</span>
                        <button type="button" disabled={researchLoading} onClick={() => void handleResearchArticle()}>Retry research</button>
                      </div>
                    ) : null}
                    {researchState === "idle" ? (
                      <button type="button" disabled={researchLoading} onClick={() => void handleResearchArticle()}>Research this story</button>
                    ) : null}
                    {researchState === "success" && researchResult ? (
                      <>
                        <div className="news-research-summary">
                          <strong>Research complete</strong>
                          <span>Research confidence: {researchResult.confidence.toUpperCase()}</span>
                          <span>Sources consulted: {researchResult.sources.length}</span>
                          <span>Verified facts: {researchResult.verifiedFacts.length}</span>
                          <span>Conflicting facts: {researchResult.disputedFacts.length}</span>
                          <span>Claims requiring review: {researchResult.unsupportedClaims.length}</span>
                        </div>
                        {researchResult.researchStatus === "insufficient_evidence" ? (
                          <div role="alert" className="news-research-warning">
                            <strong>⚠ Insufficient source material</strong>
                            <p>GiTO could not establish enough reliable information to safely expand this story.</p>
                            <button type="button" disabled={researchLoading} onClick={() => void handleResearchArticle()}>Retry research</button>
                          </div>
                        ) : null}
                        <button type="button" onClick={() => setIsResearchPanelOpen((open) => !open)}>
                          {isResearchPanelOpen ? "Hide research" : "View research"}
                        </button>
                        {isResearchPanelOpen ? (
                          <div className="news-research-details">
                            <div className="news-research-tabs">
                              <button type="button" className={researchTab === "original" ? "active" : ""} onClick={() => setResearchTab("original")}>Original source</button>
                              <button type="button" className={researchTab === "research" ? "active" : ""} onClick={() => setResearchTab("research")}>Research findings</button>
                              <button type="button" className={researchTab === "draft" ? "active" : ""} onClick={() => setResearchTab("draft")}>GiTO draft</button>
                            </div>
                            {researchTab === "original" ? (
                              <div className="news-detail-original-source">
                                <strong>Original source</strong>
                                <p>{researchSourceArticle.title}</p>
                                <p>{researchSourceArticle.summary || "No summary available."}</p>
                                {researchSourceArticle.sourceUrl ? <a href={researchSourceArticle.sourceUrl} target="_blank" rel="noreferrer">Open source article</a> : null}
                              </div>
                            ) : null}
                            {researchTab === "research" ? (
                              <div>
                                <h5>Verified facts</h5>
                                {researchResult.verifiedFacts.map((fact) => (
                                  <div key={fact.id} className="news-research-fact"><strong>✅ Verified</strong><p>{fact.statement}</p><small>Sources: {fact.sources.join(", ")} · Confidence: {fact.confidence}</small></div>
                                ))}
                                <h5>Conflicting information</h5>
                                {researchResult.disputedFacts.map((fact) => (
                                  <div key={fact.id} className="news-research-fact"><strong>⚠ Conflicting information</strong><p>{fact.statement}</p><small>Sources: {fact.sources.join(", ")}</small></div>
                                ))}
                                <h5>Needs fact-check</h5>
                                {researchResult.unsupportedClaims.length ? <ul>{researchResult.unsupportedClaims.map((claim) => <li key={claim}>{claim}</li>)}</ul> : <p>No additional claims require review.</p>}
                                <h5>Sources consulted</h5>
                                {researchResult.sources.map((source) => <div key={source.id} className="news-research-source"><strong>{source.publisher || source.domain}</strong><span>{source.title || source.domain} · {source.sourceType}</span><a href={source.url} target="_blank" rel="noreferrer">{source.url}</a><small>Authority {source.authorityLevel}/5 · Relevance {Math.round(source.relevance * 100)}%</small></div>)}
                              </div>
                            ) : null}
                            {researchTab === "draft" ? <p>Generate a GiTO original story to open it in the existing editor.</p> : null}
                          </div>
                        ) : null}
                        <p className="news-rights-warning">Publisher rights have not been confirmed for direct republication. This research can be used to help create an independent GiTO story, but it does not itself grant republication permission.</p>
                        <p>Generate an original editorial draft from the researched facts. The source article will not be modified.</p>
                        <button type="button" disabled={researchLoading || isGeneratingDraft} onClick={() => void handleGenerateOriginalStory()}>
                          {isGeneratingDraft ? "Generating original story…" : "Generate GiTO Original Story"}
                        </button>
                      </>
                    ) : null}
                  </div>
                ) : null}
                <div className="news-action-row">
                  <button type="button" onClick={() => { resetArticleForm(selectedArticle); setActiveSection("articles"); }}>
                    Edit article
                  </button>
                  <button type="button" onClick={() => void handleFetchArticleContent(selectedArticle.id)}>
                    Fetch article content
                  </button>
                  <button
                    type="button"
                    disabled={isGeneratingDraft}
                    onClick={() => void handleGenerateGiTONewsDraft(selectedArticle)}
                  >
                    {isGeneratingDraft ? "Generating draft…" : "Generate GiTO draft"}
                  </button>
                  <button type="button" disabled={isPublishingArticleId === selectedArticle.id} onClick={() => void handlePublishArticle(selectedArticle.id)}>
                    {isPublishingArticleId === selectedArticle.id ? "Publishing…" : "Publish"}
                  </button>
                  <button type="button" onClick={() => void handleArchiveArticle(selectedArticle.id)}>
                    Archive
                  </button>
                  <button type="button" onClick={() => void handleDeleteArticle(selectedArticle.id)}>
                    Delete
                  </button>
                </div>
              </div>
            ) : (
              <p>No article selected.</p>
            )}
          </section>
        </div>
      ) : null}

      {activeSection === "articles" ? (
        <div className="news-grid">
          <section className="console-panel news-panel">
            <div className="news-panel-header">
              <h3>Articles</h3>
              <p>Create, edit, review, publish, and archive news articles.</p>
            </div>
            {selectedArticle && isGiTOGeneratedArticle(selectedArticle) ? (
              <div className="news-detail-badge-row">
                <span className="news-badge ai-generated">GiTO AI-ASSISTED</span>
                <span className="news-badge review-required">REVIEW REQUIRED</span>
                {isGiTOFactCheckRequired(selectedArticle) ? <span className="news-badge fact-check-required">FACT-CHECK REQUIRED</span> : null}
              </div>
            ) : null}
            {researchSourceArticle && selectedArticle?.id !== researchSourceArticle.id ? (
              <div className="news-research-comparison">
                <div className="news-research-tabs">
                  <button type="button" className={researchTab === "original" ? "active" : ""} onClick={() => setResearchTab("original")}>Original source</button>
                  <button type="button" className={researchTab === "research" ? "active" : ""} onClick={() => setResearchTab("research")}>Research findings</button>
                  <button type="button" className={researchTab === "draft" ? "active" : ""} onClick={() => setResearchTab("draft")}>GiTO draft</button>
                </div>
                {researchTab === "original" ? <p><strong>Original source:</strong> {researchSourceArticle.title} remains unchanged.</p> : null}
                {researchTab === "research" && researchResult ? <p><strong>Research confidence:</strong> {researchResult.confidence.toUpperCase()} · {researchResult.verifiedFacts.length} verified facts</p> : null}
                {researchTab === "draft" ? <p><strong>GiTO draft:</strong> review the generated title, summary, and body below before publishing.</p> : null}
              </div>
            ) : null}
            <div className="news-action-row">
              <button type="button" onClick={() => { setEditingArticleId(null); setArticleForm(emptyArticleForm()); setSelectedArticleId(null); }}>
                New article
              </button>
              <button type="button" disabled={savingArticleStatus === "draft"} onClick={() => void handleArticleSubmit("draft")}>{savingArticleStatus === "draft" ? "Saving…" : "Save draft"}</button>
              <button type="button" disabled={savingArticleStatus === "review"} onClick={() => void handleArticleSubmit("review")}>{savingArticleStatus === "review" ? "Sending…" : "Send for review"}</button>
              <button type="button" disabled={savingArticleStatus === "published"} onClick={() => void handleArticleSubmit("published")}>{savingArticleStatus === "published" ? "Publishing…" : "Publish"}</button>
              <button type="button" disabled={savingArticleStatus === "archived"} onClick={() => void handleArticleSubmit("archived")}>{savingArticleStatus === "archived" ? "Archiving…" : "Archive"}</button>
            </div>
            <form className="news-editor-form" onSubmit={(event) => { event.preventDefault(); void handleArticleSubmit(articleForm.status); }}>
              <label>
                Title
                <input value={articleForm.title} onChange={(event) => setArticleForm((current) => ({ ...current, title: event.target.value }))} />
              </label>
              <label>
                Summary
                <textarea value={articleForm.summary} onChange={(event) => setArticleForm((current) => ({ ...current, summary: event.target.value }))} rows={3} />
              </label>
              <label>
                Body
                <textarea value={articleForm.body} onChange={(event) => setArticleForm((current) => ({ ...current, body: event.target.value }))} rows={8} />
              </label>
              <div className="news-form-grid">
                <label>
                  Source name
                  <input value={articleForm.sourceName} onChange={(event) => setArticleForm((current) => ({ ...current, sourceName: event.target.value }))} />
                </label>
                <label>
                  Source URL
                  <input value={articleForm.sourceUrl} onChange={(event) => setArticleForm((current) => ({ ...current, sourceUrl: event.target.value }))} />
                </label>
              </div>

              <div className="news-editor-category-section">
                <div className="news-panel-header">
                  <h4>Categories</h4>
                  <button
                    type="button"
                    onClick={() => setArticleForm((current) => ({
                      ...current,
                      categories: [...current.categories, { id: crypto.randomUUID(), categoryType: "sport", entityId: "" }]
                    }))}
                  >
                    Add category
                  </button>
                </div>
                {articleForm.categories.length === 0 ? <p>No categories selected.</p> : null}
                {articleForm.categories.map((category, index) => {
                  const options = getFilteredCategoryOptions({
                    categoryType: category.categoryType,
                    rows: articleForm.categories,
                    sports,
                    countries,
                    competitions,
                    teams,
                    matches,
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

                  return (
                    <div key={category.id} className="news-edit-category-row">
                      <select
                        value={category.categoryType}
                        onChange={(event) => setArticleForm((current) => {
                          const nextCategories = current.categories.map((row, rowIndex) => rowIndex === index ? {
                            ...row,
                            categoryType: event.target.value as NewsArticleCategoryType,
                            entityId: ""
                          } : row);

                          return {
                            ...current,
                            categories: sanitizeNewsCategoryRows(nextCategories, {
                              sports,
                              countries,
                              competitions,
                              teams,
                              matches,
                              competitionTeamIds
                            })
                          };
                        })}
                      >
                        <option value="sport">Sport</option>
                        <option value="country">Country</option>
                        <option value="team">Team</option>
                        <option value="competition">Competition</option>
                        <option value="match">Match</option>
                      </select>
                      <select
                        value={category.entityId}
                        onChange={(event) => setArticleForm((current) => {
                          const nextCategories = current.categories.map((row, rowIndex) => rowIndex === index ? { ...row, entityId: event.target.value } : row);

                          return {
                            ...current,
                            categories: sanitizeNewsCategoryRows(nextCategories, {
                              sports,
                              countries,
                              competitions,
                              teams,
                              matches,
                              competitionTeamIds
                            })
                          };
                        })}
                      >
                        <option value="">{options.length > 0 ? "Choose" : emptyLabel}</option>
                        {options.map((option) => (
                          <option key={option.id} value={option.id}>{option.name}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => setArticleForm((current) => ({
                          ...current,
                          categories: current.categories.filter((_, rowIndex) => rowIndex !== index)
                        }))}
                      >
                        Remove
                      </button>
                    </div>
                  );
                })}
              </div>
              <label>
                Tags
                <input value={articleForm.tags} onChange={(event) => setArticleForm((current) => ({ ...current, tags: event.target.value }))} placeholder="Add tags separated by commas" />
              </label>
              <label>
                Source
                <select value={articleForm.sourceId} onChange={(event) => setArticleForm((current) => ({ ...current, sourceId: event.target.value }))}>
                  <option value="">Choose a source</option>
                  {sources.map((source) => (
                    <option key={source.id} value={source.id}>{source.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Media references
                <textarea value={articleForm.mediaReferences} onChange={(event) => setArticleForm((current) => ({ ...current, mediaReferences: event.target.value }))} rows={4} placeholder="One image URL per line" />
              </label>
              <label>
                Outbound links
                <textarea value={articleForm.outboundLinks} onChange={(event) => setArticleForm((current) => ({ ...current, outboundLinks: event.target.value }))} rows={4} placeholder="One URL per line" />
              </label>
              <label>
                Status
                <select value={articleForm.status} onChange={(event) => setArticleForm((current) => ({ ...current, status: event.target.value as NewsArticleStatus }))}>
                  {Object.entries(statusLabels).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
            </form>
          </section>
          <section className="console-panel news-panel">
            <div className="news-panel-header">
              <h3>Manage</h3>
              <p>Load an existing article from the list to edit it.</p>
            </div>
            <div className="news-list-stack">
              {articles.map((article) => (
                <button
                  key={article.id}
                  type="button"
                  className="news-item-card"
                  onClick={() => {
                    resetArticleForm(article);
                    setSelectedArticleId(article.id);
                    setActiveSection("articles");
                  }}
                >
                  {getArticleThumbnail(article) ? (
                    <img className="news-article-thumbnail" src={getArticleThumbnail(article) ?? undefined} alt="" />
                  ) : null}
                  <div className="news-item-title-row">
                    <strong>{article.title}</strong>
                    <span>{statusLabels[article.status]}</span>
                  </div>
                  <span>{article.source?.name ?? article.sourceName ?? "Unassigned"}</span>
                  <small>Category: {getArticleCategories(article)}</small>
                  <small>Status: {statusLabels[article.status]}</small>
                  <small>Content: {getContentAvailability(article)}</small>
                  <small>Origin: {article.contentOrigin ?? "Unknown"}</small>
                  <small>{formatDate(article.updatedAt)}</small>
                </button>
              ))}
            </div>
          </section>
        </div>
      ) : null}

      {activeSection === "sources" ? (
        <div className="news-grid">
          <section className="console-panel news-panel">
            <div className="news-panel-header">
              <h3>News Sources</h3>
              <p>List, add, edit, enable, and disable the configured news sources.</p>
            </div>
            <div className="news-action-row">
              <button type="button" onClick={() => { setSourceForm(emptySourceForm()); setEditingSourceId(null); }}>
                New source
              </button>
              <button type="button" onClick={() => void handleSourceSubmit()}>Save source</button>
            </div>
            <form className="news-editor-form" onSubmit={(event) => { event.preventDefault(); void handleSourceSubmit(); }}>
              <label>
                Name
                <input value={sourceForm.name} onChange={(event) => setSourceForm((current) => ({ ...current, name: event.target.value }))} />
              </label>
              <label>
                Type
                <select value={sourceForm.sourceType} onChange={(event) => setSourceForm((current) => ({ ...current, sourceType: event.target.value as NewsSourceType }))}>
                  {Object.entries(sourceTypeLabels).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
              <label>
                Base URL
                <input value={sourceForm.baseUrl} onChange={(event) => setSourceForm((current) => ({ ...current, baseUrl: event.target.value }))} />
              </label>
              <label>
                Feed URL
                <input value={sourceForm.feedUrl} onChange={(event) => setSourceForm((current) => ({ ...current, feedUrl: event.target.value }))} />
              </label>
              <label>
                Enabled
                <input type="checkbox" checked={sourceForm.enabled} onChange={(event) => setSourceForm((current) => ({ ...current, enabled: event.target.checked }))} />
              </label>
            </form>
          </section>
          <section className="console-panel news-panel">
            <div className="news-panel-header">
              <h3>Configured sources</h3>
              <p>Manage the active source inventory.</p>
            </div>
            <div className="news-list-stack">
              {sources.map((source) => (
                <div key={source.id} className="news-source-card">
                  <div className="news-item-title-row">
                    <strong>{source.name}</strong>
                    <span>{source.enabled ? "Enabled" : "Disabled"}</span>
                  </div>
                  <small>{sourceTypeLabels[source.sourceType]}</small>
                  <small>{source.feedUrl ? `Feed: ${source.feedUrl}` : "No feed URL configured"}</small>
                  <small>{source.lastCollectionStatus ? `Last collection: ${source.lastCollectionStatus}` : "No collection run yet"}</small>
                  <small>Publishing rights: {rightsStatusLabels[source.rightsStatus ?? "unknown"] ?? "Unknown"}</small>
                  <small>{source.rightsAuditSummary ?? "No rights audit summary recorded yet."}</small>
                  {sourceAuditDetails[source.id] ? (
                    (() => {
                      const audit = sourceAuditDetails[source.id]!;
                      return (
                        <div className="news-audit-summary-block">
                          <strong>Last local audit</strong>
                          <span>{rightsStatusLabels[audit.status] ?? audit.status}</span>
                          <span>{audit.summary ?? "No summary provided."}</span>
                          <div className="news-audit-evidence-list">
                            <strong>Evidence</strong>
                            {audit.evidence.map((evidence) => (
                              <div key={evidence.id} className="news-audit-evidence-item">
                                <a href={evidence.evidenceUrl} target="_blank" rel="noreferrer">{evidence.pageTitle ?? evidence.evidenceUrl}</a>
                                <span>Origin: {evidence.evidenceOrigin ?? "unknown"}</span>
                                <span>Type: {rightsEvidenceTypeLabels[evidence.evidenceType] ?? evidence.evidenceType}</span>
                                <p>{evidence.snippet ?? "No snippet available."}</p>
                              </div>
                            ))}
                          </div>
                          <div className="news-audit-permissions-list">
                            <strong>Permissions</strong>
                            {audit.permissions.map((permission) => (
                              <div key={permission.id} className="news-audit-permission-item">
                                <span>{rightsPermissionLabels[permission.permission] ?? permission.permission}</span>
                                <span>{permission.allowed ? "Allowed" : "Not allowed"}</span>
                                <small>{permission.notes ?? "No detail"}</small>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })()
                  ) : null}
                  <div className="news-action-row">
                    <button type="button" onClick={() => { setSourceForm({ id: source.id, name: source.name, sourceType: source.sourceType, baseUrl: source.baseUrl ?? "", feedUrl: source.feedUrl ?? "", enabled: source.enabled }); setEditingSourceId(source.id); }}>
                      Edit
                    </button>
                    <button type="button" onClick={() => void handleCollectSource(source)}>
                      Collect now
                    </button>
                    <button type="button" onClick={() => void handleAuditSourceRights(source)}>
                      Check publishing rights
                    </button>
                    <button type="button" onClick={() => void handleToggleSource(source)}>
                      {source.enabled ? "Disable" : "Enable"}
                    </button>
                    <button type="button" onClick={() => void handleDeleteSource(source.id)}>
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      ) : null}

      {activeSection === "rss" ? (
        <div className="news-grid">
          <section className="console-panel news-panel">
            <div className="news-panel-header">
              <h3>Add RSS source</h3>
              <p>Bring RSS or Atom items into Incoming News for editorial review. Nothing is published automatically.</p>
            </div>
            <form className="news-editor-form" onSubmit={(event) => { event.preventDefault(); void handleCreateRssSource(); }}>
              <label>Feed URL<input required type="url" placeholder="https://example.com/feed.xml" value={rssFeedUrl} onChange={(event) => setRssFeedUrl(event.target.value)} /></label>
              <label>Source name<input required placeholder="BBC Sport" value={rssSourceName} onChange={(event) => setRssSourceName(event.target.value)} /></label>
              <button type="submit">Add source</button>
            </form>
          </section>
          <section className="console-panel news-panel">
            <div className="news-panel-header">
              <h3>GiTO News RSS</h3>
              <p>This feed contains published GiTO News articles only.</p>
            </div>
            <div className="news-action-row">
              <input aria-label="GiTO News RSS URL" readOnly value={rssPublisherUrl} />
              <button type="button" onClick={() => void navigator.clipboard?.writeText(rssPublisherUrl)}>Copy feed URL</button>
            </div>
          </section>
          <section className="console-panel news-panel">
            <div className="news-panel-header">
              <h3>Configured RSS sources</h3>
              <p>Fetch manually when you are ready to check for new source material.</p>
            </div>
            <div className="news-list-stack">
              {rssSources.map((source) => {
                const result = rssFetchResult[source.id];
                return (
                  <div key={source.id} className="news-source-card">
                    <div className="news-item-title-row"><strong>{source.name}</strong><span>{source.enabled ? "Active" : "Disabled"}</span></div>
                    <a href={source.feedUrl ?? undefined} target="_blank" rel="noreferrer">{source.feedUrl}</a>
                    {result ? <small>Feed checked successfully · {result.fetchedItems} items found · {result.importedItems} new · {result.skippedDuplicates} already imported</small> : null}
                    <div className="news-action-row">
                      <button type="button" onClick={() => void handleFetchRssSource(source)}>Fetch now</button>
                      <button type="button" onClick={() => void handleDeleteRssSource(source.id)}>Delete</button>
                    </div>
                  </div>
                );
              })}
              {!rssSources.length ? <p>No RSS sources configured.</p> : null}
            </div>
          </section>
        </div>
      ) : null}

      {activeSection === "web-rss" ? (
        <div className="news-grid">
          <section className="console-panel news-panel">
            <div className="news-panel-header">
              <h3>Create RSS from Web Page</h3>
              <p>Turn a webpage into a reusable RSS feed for GiTO.</p>
            </div>
            <form className="news-editor-form" onSubmit={(event) => { event.preventDefault(); void handleCreateWebRss(); }}>
              <label>Website URL<input required type="url" placeholder="https://example.com/sports" value={webRssUrl} onChange={(event) => setWebRssUrl(event.target.value)} /></label>
              <label>Feed name<input required placeholder="My Sports Feed" value={webRssName} onChange={(event) => setWebRssName(event.target.value)} /></label>
              <button type="submit" disabled={webRssLoading}>{webRssLoading ? "Analyzing webpage…" : "Generate RSS Feed"}</button>
            </form>
            <details>
              <summary>How this works</summary>
              <p>GiTO analyzes the supplied webpage, discovers article links, and creates an RSS feed from the content it can identify.</p>
            </details>
          </section>
          <section className="console-panel news-panel">
            <div className="news-panel-header"><h3>Generated feeds</h3><p>Discovered articles remain source material. GiTO does not generate or publish stories automatically.</p></div>
            <div className="news-list-stack">
              {generatedFeeds.map((feed) => (
                <div key={feed.id} className="news-source-card">
                  <div className="news-item-title-row"><strong>{feed.name}</strong><span>{feed.status === "ready" || feed.status === "partial" ? "RSS feed ready" : feed.status}</span></div>
                  <small>Source: {feed.sourceUrl}</small>
                  <small>Articles discovered: {feed.discoveredArticleCount}</small>
                  {feed.crawlerTier ? <small>Crawler method: {feed.crawlerTier === "browser" ? "Browser-rendered" : "Standard web crawl"}</small> : null}
                  {feed.status === "failed" && feed.errorMessage ? <p role="alert">{feed.errorMessage}</p> : null}
                  <a href={feed.feedUrl} target="_blank" rel="noreferrer">RSS Feed URL: {feed.feedUrl}</a>
                  <div className="news-action-row">
                    <button type="button" onClick={() => void navigator.clipboard?.writeText(feed.feedUrl)}>Copy RSS URL</button>
                    <button type="button" disabled={webRssLoading} onClick={() => void handleRefreshWebRss(feed.id)}>Refresh feed</button>
                    {feed.status === "failed" ? <button type="button" disabled={webRssLoading} onClick={() => void handleRefreshWebRss(feed.id)}>Try again</button> : null}
                    <button type="button" onClick={() => void handlePreviewWebRss(feed.id)}>Preview articles</button>
                    <button type="button" onClick={() => void handleDeleteWebRss(feed.id)}>Delete feed</button>
                  </div>
                  {webRssPreview[feed.id] ? <div className="news-list-stack">{(webRssPreview[feed.id] ?? []).map((article) => <div key={article.id} className="news-source-card"><strong>{article.title}</strong><small>{article.sourceName}</small><a href={article.articleUrl} target="_blank" rel="noreferrer">{article.articleUrl}</a><small>{article.publishedAt ? formatDate(article.publishedAt) : "Publication date unavailable"} · Discovered</small></div>)}</div> : null}
                </div>
              ))}
              {!generatedFeeds.length ? <p>No generated webpage feeds yet.</p> : null}
            </div>
          </section>
        </div>
      ) : null}

      {activeSection === "published" ? (
        <section className="console-panel news-panel">
          <div className="news-panel-header">
            <h3>Published</h3>
            <p>Review published articles and their current publishing state.</p>
          </div>
          <div className="news-list-stack">
            {publishedArticles.map((article) => (
              <div key={article.id} className="news-source-card">
                <div className="news-item-title-row">
                  <strong>{article.title}</strong>
                  <span>{statusLabels[article.status]}</span>
                </div>
                <small>{article.source?.name ?? article.sourceName ?? "Unassigned"}</small>
                <small>Published {formatDate(article.publishedAt)}</small>
                <div className="news-action-row">
                  <button type="button" onClick={() => { setSelectedArticleId(article.id); setActiveSection("incoming"); }}>
                    Open article
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </section>
  );
}
