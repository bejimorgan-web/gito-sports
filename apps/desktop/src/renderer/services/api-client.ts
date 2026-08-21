import type {
  Channel,
  ChannelDebug,
  ChannelListMode,
  IptvOperation,
  IptvOperationType,
  PaginatedChannels,
  Competition,
  CreateCompetitionRequest,
  CreateCountryRequest,
  CreateProviderRequest,
  CreateSportRequest,
  CreateTeamRequest,
  CreateHostRequest,
  CreateSeasonRequest,
  UpdateSeasonRequest,
  ClubDetail,
  Season,
  CompetitionSeasonTeam,
  Country,
  Host,
  IPTVProvider,
  MatchAssignmentRequest,
  MatchAssignmentResult,
  ProviderChannelDiagnostics,
  ProviderConnectionTest,
  PublishedLiveMatch,
  Sport,
  Stream,
  Team,
  UpdateHostRequest
} from "@gito/shared";

// Prefer the standardized `VITE_API_URL` but keep backwards compatibility
// with the older `VITE_GITO_API_BASE_URL` name.
const runtimeEnv = typeof import.meta !== "undefined" && typeof (import.meta as any).env !== "undefined"
  ? (import.meta as any).env as Record<string, string | boolean | undefined>
  : process.env as Record<string, string | undefined>;

const configuredApiBaseUrl = (runtimeEnv?.VITE_API_URL as string | undefined) ?? (runtimeEnv?.VITE_GITO_API_BASE_URL as string | undefined);
const DEV_API_BASE_URL = "http://localhost:4100";
const isDevelopmentMode = String(runtimeEnv?.MODE) === "development" || runtimeEnv?.DEV === true || runtimeEnv?.DEV === "true";

let API_BASE_URL = configuredApiBaseUrl?.trim() || "";

if (!API_BASE_URL) {
  API_BASE_URL = isDevelopmentMode ? DEV_API_BASE_URL : "https://gito-sports.onrender.com";
}

API_BASE_URL = API_BASE_URL.replace(/\/$/, "");

console.log('[api-client] API_BASE_URL=', API_BASE_URL);

export { API_BASE_URL };

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    ...((init?.headers as Record<string, string>) ?? {})
  };

  if (!(init?.body instanceof FormData)) {
    headers["content-type"] = "application/json";
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      cache: "no-store",
      headers
    });
  } catch (fetchError) {
    const message = fetchError instanceof Error ? fetchError.message : String(fetchError);
    throw new Error(`Network request to ${API_BASE_URL}${path} failed: ${message}`);
  }

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;

    try {
      const errorBody = (await response.json()) as { message?: string; error?: string };
      message = errorBody.message ?? errorBody.error ?? message;
    } catch {
      // Keep the status message when the backend cannot return JSON.
    }

    throw new Error(message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = await response.json();
    if (body && typeof body === "object" && "data" in body && body.data !== undefined) {
      return body.data as T;
    }
    return body as T;
  }

  return (await response.text()) as T;
}

function buildApiPath(path: string, query?: Record<string, string | undefined>) {
  const params = new URLSearchParams();
  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      if (value) {
        params.set(key, value);
      }
    });
  }

  return params.toString() ? `${path}?${params.toString()}` : path;
}

export const apiClient = {
  async health() {
    const response = await fetch(`${API_BASE_URL}/health`, { cache: "no-store" });

    if (!response.ok) {
      throw new Error(`Health check failed with status ${response.status}`);
    }

    return (await response.json()) as { status: string; service: string; database: string; timestamp: string };
  },
  async systemStatus() {
    return request<{
      backend: string;
      database: string;
      footballApi: string;
      analytics: string;
      uptime: number;
      timestamp: string;
    }>("/system/status");
  },
  async createBackup() {
    return request<{ backup: { filename: string; size: number; createdAt: string } }>("/system/backup", {
      method: "POST"
    });
  },
  async listBackups() {
    return request<{ backups: Array<{ filename: string; size: number; createdAt: string }> }>("/system/backups");
  },
  async restoreApply(filename: string, force = false) {
    return request<{ success: boolean; applied?: boolean; filename?: string; restartRequired?: boolean }>("/system/restore/apply", {
      method: "POST",
      body: JSON.stringify({ filename, force })
    });
  },
  login(email: string, password: string) {
    return request<{ accessToken: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password })
    });
  },
  listProviders() {
    return request<IPTVProvider[]>("/iptv/providers");
  },
  createProvider(input: CreateProviderRequest) {
    return request<IPTVProvider>("/iptv/providers", {
      method: "POST",
      body: JSON.stringify(input)
    });
  },
  updateProvider(providerId: string, input: Partial<CreateProviderRequest>) {
    return request<IPTVProvider>(`/iptv/providers/${providerId}`, {
      method: "PUT",
      body: JSON.stringify(input)
    });
  },
  deleteProvider(providerId: string) {
    return request<void>(`/iptv/providers/${providerId}`, { method: "DELETE" });
  },
  testProvider(input: CreateProviderRequest) {
    return request<ProviderConnectionTest>("/iptv/providers/test", {
      method: "POST",
      body: JSON.stringify(input)
    });
  },
  testProviderById(providerId: string) {
    return request(`/iptv/providers/${providerId}/test`, { method: "POST" });
  },
  ingestM3u(providerId: string, playlist: string) {
    return request<IptvOperation>(
      "/iptv/operations",
      {
        method: "POST",
        body: JSON.stringify({ type: "m3u_import", providerId, playlist })
      }
    );
  },
  syncXtream(providerId: string) {
    return request<IptvOperation>(
      "/iptv/operations",
      {
        method: "POST",
        body: JSON.stringify({ type: "xtream_channel_sync", providerId })
      }
    );
  },
  startIptvOperation(type: IptvOperationType, input: { providerId?: string; playlist?: string; baseUrl?: string; username?: string; password?: string } = {}) {
    return request<IptvOperation>("/iptv/operations", {
      method: "POST",
      body: JSON.stringify({ type, ...input })
    });
  },
  getIptvOperation(operationId: string) {
    return request<IptvOperation>(`/iptv/operations/${encodeURIComponent(operationId)}`);
  },
  cancelIptvOperation(operationId: string) {
    return request<IptvOperation>(`/iptv/operations/${encodeURIComponent(operationId)}/cancel`, { method: "POST" });
  },
  listChannels(providerId?: string, opts?: { q?: string; category?: string; includeInactive?: boolean; mode?: ChannelListMode }) {
    const params = new URLSearchParams();
    if (providerId) params.set("providerId", providerId);
    if (opts?.q) params.set("q", opts.q);
    if (opts?.category) params.set("category", opts.category);
    if (opts?.mode) params.set("mode", opts.mode);
    if (!opts?.mode && opts?.includeInactive) params.set("includeInactive", "true");
    const query = params.toString() ? `?${params.toString()}` : "";
    return request<Channel[] | ChannelDebug[]>(`/iptv/channels${query}`);
  },
  listChannelPage(providerId?: string, opts?: { q?: string; category?: string; includeInactive?: boolean; mode?: ChannelListMode; page?: number; pageSize?: number }) {
    const params = new URLSearchParams();
    if (providerId) params.set("providerId", providerId);
    if (opts?.q) params.set("q", opts.q);
    if (opts?.category) params.set("category", opts.category);
    if (opts?.mode) params.set("mode", opts.mode);
    if (!opts?.mode && opts?.includeInactive) params.set("includeInactive", "true");
    params.set("page", String(opts?.page ?? 1));
    params.set("pageSize", String(opts?.pageSize ?? 100));
    return request<PaginatedChannels<Channel>>(`/iptv/channels?${params.toString()}`);
  },
  getProviderDiagnostics(providerId: string) {
    return request<ProviderChannelDiagnostics>(`/iptv/providers/${encodeURIComponent(providerId)}/diagnostics`);
  },
  listCategories(providerId?: string) {
    const query = providerId ? `?providerId=${encodeURIComponent(providerId)}` : "";
    return request<string[]>(`/iptv/categories${query}`);
  },
  setProviderStatus(providerId: string, status: string) {
    return request<unknown>(`/iptv/providers/${providerId}/status`, {
      method: "POST",
      body: JSON.stringify({ status })
    });
  },
  listNewsArticles() {
    return request<Array<import("@gito/shared").NewsArticle>>("/news/articles");
  },
  createNewsArticle(input: import("@gito/shared").CreateNewsArticleRequest, accessToken: string) {
    return request<import("@gito/shared").NewsArticle>("/news/articles", {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(input)
    });
  },
  updateNewsArticle(articleId: string, input: import("@gito/shared").UpdateNewsArticleRequest, accessToken: string) {
    return request<import("@gito/shared").NewsArticle>(`/news/articles/${articleId}`, {
      method: "PUT",
      headers: { authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(input)
    });
  },
  publishNewsArticle(articleId: string, accessToken: string) {
    return request<import("@gito/shared").NewsArticle>(`/news/articles/${articleId}/publish`, {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}` }
    });
  },
  archiveNewsArticle(articleId: string, accessToken: string) {
    return request<import("@gito/shared").NewsArticle>(`/news/articles/${articleId}/archive`, {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}` }
    });
  },
  generateGiTONewsDraft(articleId: string, accessToken: string) {
    return request<import("@gito/shared").NewsArticle>(`/news/articles/${articleId}/generate-gito-draft`, {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}` }
    });
  },
  researchNewsArticle(articleId: string, accessToken: string) {
    return request<import("@gito/shared").NewsResearchResult>(`/news/articles/${articleId}/research`, {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}` }
    });
  },
  getNewsResearchResult(articleId: string, accessToken: string) {
    return request<import("@gito/shared").NewsResearchResult>(`/news/articles/${articleId}/research`, {
      headers: { authorization: `Bearer ${accessToken}` }
    });
  },
  getNewsClassification(articleId: string, accessToken: string) {
    return request<{ approved: import("@gito/shared").NewsArticleCategory[]; suggestions: import("@gito/shared").NewsArticleCategory[] }>(`/news/articles/${articleId}/classification`, { headers: { authorization: `Bearer ${accessToken}` } });
  },
  rerunNewsClassification(articleId: string, accessToken: string) {
    return request<{ approved: import("@gito/shared").NewsArticleCategory[]; suggestions: import("@gito/shared").NewsArticleCategory[] }>(`/news/articles/${articleId}/classification/rerun`, { method: "POST", headers: { authorization: `Bearer ${accessToken}` } });
  },
  aiClassifyNewsArticle(articleId: string, accessToken: string) {
    return request<{ approved: import("@gito/shared").NewsArticleCategory[]; suggestions: import("@gito/shared").NewsArticleCategory[] }>(`/news/articles/${articleId}/classification/ai`, { method: "POST", headers: { authorization: `Bearer ${accessToken}` } });
  },
  approveNewsClassification(articleId: string, categoryId: string, accessToken: string) {
    return request<import("@gito/shared").NewsArticleCategory>(`/news/articles/${articleId}/classification/${categoryId}/approve`, { method: "POST", headers: { authorization: `Bearer ${accessToken}` } });
  },
  rejectNewsClassification(articleId: string, categoryId: string, accessToken: string) {
    return request<import("@gito/shared").NewsArticleCategory>(`/news/articles/${articleId}/classification/${categoryId}/reject`, { method: "POST", headers: { authorization: `Bearer ${accessToken}` } });
  },
  approveNewsClassifications(articleId: string, categoryIds: string[], accessToken: string) {
    return request<import("@gito/shared").NewsArticleCategory[]>(`/news/articles/${articleId}/classification/approve`, { method: "POST", headers: { authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ categoryIds }) });
  },
  addManualNewsClassification(articleId: string, categoryType: string, entityId: string, accessToken: string) {
    return request<import("@gito/shared").NewsArticleCategory>(`/news/articles/${articleId}/classification/manual`, { method: "POST", headers: { authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ categoryType, entityId }) });
  },
  removeNewsClassification(articleId: string, categoryId: string, accessToken: string) {
    return request<void>(`/news/articles/${articleId}/classification/${categoryId}`, { method: "DELETE", headers: { authorization: `Bearer ${accessToken}` } });
  },
  listNewsRssSources(accessToken: string) {
    return request<Array<import("@gito/shared").NewsSource>>("/news/rss-sources", {
      headers: { authorization: `Bearer ${accessToken}` }
    });
  },
  createNewsRssSource(name: string, feedUrl: string, accessToken: string) {
    return request<import("@gito/shared").NewsSource>("/news/rss-sources", {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ name, feedUrl })
    });
  },
  deleteNewsRssSource(sourceId: string, accessToken: string) {
    return request<void>(`/news/rss-sources/${sourceId}`, { method: "DELETE", headers: { authorization: `Bearer ${accessToken}` } });
  },
  fetchNewsRssSource(sourceId: string, accessToken: string) {
    return request<{ sourceId: string; fetchedItems: number; importedItems: number; skippedDuplicates: number; failedItems: number }>(`/news/rss-sources/${sourceId}/fetch`, {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}` }
    });
  },
  listGeneratedNewsRssFeeds(accessToken: string) {
    return request<Array<any>>("/news/generated-rss-sources", { headers: { authorization: `Bearer ${accessToken}` } });
  },
  createGeneratedNewsRssFeed(name: string, sourceUrl: string, accessToken: string) {
    return request<any>("/news/generated-rss-sources", { method: "POST", headers: { authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ name, sourceUrl }) });
  },
  refreshGeneratedNewsRssFeed(feedId: string, accessToken: string) {
    return request<any>(`/news/generated-rss-sources/${feedId}/refresh`, { method: "POST", headers: { authorization: `Bearer ${accessToken}` } });
  },
  listGeneratedNewsRssArticles(feedId: string, accessToken: string) {
    return request<Array<any>>(`/news/generated-rss-sources/${feedId}/articles`, { headers: { authorization: `Bearer ${accessToken}` } });
  },
  deleteGeneratedNewsRssFeed(feedId: string, accessToken: string) {
    return request<void>(`/news/generated-rss-sources/${feedId}`, { method: "DELETE", headers: { authorization: `Bearer ${accessToken}` } });
  },
  generateGiTOOriginalStory(articleId: string, researchResult: import("@gito/shared").NewsResearchResult, accessToken: string) {
    return request<import("@gito/shared").NewsArticle>(`/news/articles/${articleId}/generate-original`, {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ researchResult })
    });
  },
  deleteNewsArticle(articleId: string, accessToken: string) {
    return request<void>(`/news/articles/${articleId}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${accessToken}` }
    });
  },
  bulkDeleteNewsArticles(articleIds: string[], accessToken: string) {
    return request<{ deletedCount: number }>("/news/articles/bulk-delete", {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ ids: articleIds })
    });
  },
  listNewsSources() {
    return request<Array<import("@gito/shared").NewsSource>>("/news/sources");
  },
  createNewsSource(input: import("@gito/shared").CreateNewsSourceRequest, accessToken: string) {
    return request<import("@gito/shared").NewsSource>("/news/sources", {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(input)
    });
  },
  updateNewsSource(sourceId: string, input: import("@gito/shared").UpdateNewsSourceRequest, accessToken: string) {
    return request<import("@gito/shared").NewsSource>(`/news/sources/${sourceId}`, {
      method: "PUT",
      headers: { authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(input)
    });
  },
  deleteNewsSource(sourceId: string, accessToken: string) {
    return request<void>(`/news/sources/${sourceId}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${accessToken}` }
    });
  },
  collectNewsSource(sourceId: string, accessToken: string) {
    return request<{ source: import("@gito/shared").NewsSource; imported: number; skipped: number }>(`/news/sources/${sourceId}/collect`, {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}` }
    });
  },
  auditNewsSourcePublishingRights(sourceId: string, accessToken: string) {
    return request<{
      id: string;
      sourceId: string;
      status: string;
      summary: string | null;
      reviewNotes: string | null;
      administratorDecision: string | null;
      checkedAt: string;
      createdAt: string;
      updatedAt: string;
      evidence: Array<{ id: string; evidenceUrl: string; pageTitle?: string | null; evidenceType: string; snippet?: string | null; checkedAt: string; createdAt: string }>;
      permissions: Array<{ id: string; permission: string; allowed: boolean; notes?: string | null; evidenceUrl?: string | null; createdAt: string }>;
    }>(`/news/sources/${sourceId}/audit-rights`, {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}` }
    });
  },
  fetchNewsArticleContent(articleId: string, accessToken: string) {
    return request<{
      success: boolean;
      article: import("@gito/shared").NewsArticle | null;
      body: string | null;
      summary: string | null;
      contentOrigin: import("@gito/shared").NewsArticle["contentOrigin"];
      fetchedAt: string | null;
      fetchStatus: import("@gito/shared").NewsArticle["fetchStatus"];
      fetchError: string | null;
      message: string;
    }>(`/news/articles/${articleId}/fetch-content`, {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}` }
    });
  },
  addNewsArticleMedia(articleId: string, url: string, mediaType: "image" | "video" | "embed" = "image", accessToken: string) {
    return request<unknown>(`/news/articles/${articleId}/media`, {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ url, mediaType, altText: "" })
    });
  },
  addNewsArticleLink(articleId: string, url: string, label: string | undefined, accessToken: string) {
    return request<unknown>(`/news/articles/${articleId}/links`, {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ url, label })
    });
  },
  listSports() {
    return request<Sport[]>('/sports');
  },
  getSport(sportId: string) {
    return request<Sport>(`/sports/${sportId}`);
  },
  createSport(input: CreateSportRequest, accessToken: string) {
    return request<Sport>('/sports', {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(input)
    });
  },
  async uploadImage(file: File) {
    const formData = new FormData();
    formData.append("file", file);

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 60000);

    try {
      const response = await fetch(`${API_BASE_URL}/upload/images`, {
        method: "POST",
        body: formData,
        cache: "no-store",
        signal: controller.signal
      });

      if (!response.ok) {
        let message = `Upload failed with status ${response.status}`;
        try {
          const errorBody = (await response.json()) as { message?: string; error?: string };
          message = errorBody.message ?? errorBody.error ?? message;
        } catch {
          if (response.status === 413) {
            message = "Logo upload is too large. Please choose a smaller image.";
          }
        }
        throw new Error(message);
      }

      const body = (await response.json()) as { data: { url: string } };
      const url = body.data.url;
      if (/^https?:\/\//i.test(url)) {
        return url;
      }
      return `${API_BASE_URL}${url}`;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error("Logo upload timed out. Please check the backend server and try again.");
      }
      if (error instanceof TypeError) {
        throw new Error(`Unable to reach the backend at ${API_BASE_URL}. Please make sure the server is running and try again.`);
      }
      throw error;
    } finally {
      window.clearTimeout(timeoutId);
    }
  },
  updateSport(sportId: string, input: Partial<CreateSportRequest>, accessToken: string) {
    return request<Sport>(`/sports/${sportId}`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(input)
    });
  },
  deleteSport(sportId: string, accessToken: string) {
    return request<void>(`/sports/${sportId}`, { method: 'DELETE', headers: { authorization: `Bearer ${accessToken}` } });
  },
  listCountries(mode?: 'legacy' | 'catalog') {
    const path = buildApiPath('/countries', { mode });
    return request<Country[]>(path);
  },
  getCountry(countryId: string, mode?: 'legacy' | 'catalog') {
    const path = buildApiPath(`/countries/${countryId}`, { mode });
    return request<Country>(path);
  },
  createCountry(input: CreateCountryRequest, accessToken: string) {
    return request<Country>('/countries', {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(input)
    });
  },
  updateCountry(countryId: string, input: Partial<CreateCountryRequest>, accessToken: string) {
    return request<Country>(`/countries/${countryId}`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(input)
    });
  },
  deleteCountry(countryId: string, accessToken: string) {
    return request<void>(`/countries/${countryId}`, { method: 'DELETE', headers: { authorization: `Bearer ${accessToken}` } });
  },
  listHosts(sportId?: string) {
    const path = buildApiPath('/hosts', sportId ? { sportId } : undefined);
    return request<Host[]>(path);
  },
  createHost(input: CreateHostRequest, accessToken: string) {
    return request<Host>('/hosts', {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(input)
    });
  },
  updateHost(hostId: string, input: UpdateHostRequest, accessToken: string) {
    return request<Host>(`/hosts/${hostId}`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(input)
    });
  },
  deleteHost(hostId: string, accessToken: string) {
    return request<void>(`/hosts/${hostId}`, { method: 'DELETE', headers: { authorization: `Bearer ${accessToken}` } });
  },
  listCompetitions(mode?: 'legacy' | 'catalog', hostId?: string) {
    const path = buildApiPath('/competitions', { mode, ...(hostId ? { hostId } : {}) });
    return request<Competition[]>(path);
  },
  getCompetition(competitionId: string, mode?: 'legacy' | 'catalog') {
    const path = buildApiPath(`/competitions/${competitionId}`, { mode });
    return request<Competition>(path);
  },
  createCompetition(input: CreateCompetitionRequest, accessToken: string) {
    return request<Competition>('/competitions', {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(input)
    });
  },
  updateCompetition(competitionId: string, input: Partial<CreateCompetitionRequest>, accessToken: string) {
    return request<Competition>(`/competitions/${competitionId}`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(input)
    });
  },
  deleteCompetition(competitionId: string, accessToken: string) {
    return request<void>(`/competitions/${competitionId}`, { method: 'DELETE', headers: { authorization: `Bearer ${accessToken}` } });
  },
  addTeamToCompetition(competitionId: string, teamId: string, accessToken: string) {
    return request(`/competitions/${competitionId}/teams`, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ teamId })
    });
  },
  listCompetitionTeams(competitionId: string) {
    return request<Team[]>(`/competitions/${competitionId}/teams`);
  },
  removeTeamFromCompetition(competitionId: string, teamId: string, accessToken: string) {
    return request<void>(`/competitions/${competitionId}/teams/${teamId}`, { method: 'DELETE', headers: { authorization: `Bearer ${accessToken}` } });
  },
  listTeams(mode?: 'legacy' | 'catalog') {
    const path = buildApiPath('/teams', { mode });
    return request<Team[]>(path);
  },
  getTeam(teamId: string, mode?: 'legacy' | 'catalog') {
    const path = buildApiPath(`/teams/${teamId}`, { mode });
    return request<Team>(path);
  },
  createTeam(input: CreateTeamRequest, accessToken: string) {
    return request<Team>('/teams', {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(input)
    });
  },
  updateTeam(teamId: string, input: Partial<CreateTeamRequest>, accessToken: string) {
    return request<Team>(`/teams/${teamId}`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(input)
    });
  },
  listClubs() {
    return request<Team[]>('/clubs');
  },
  getClub(clubId: string) {
    return request<{ data: ClubDetail }>(`/clubs/${clubId}`);
  },
  createSeason(competitionId: string, input: CreateSeasonRequest, accessToken: string) {
    return request<Season>(`/competitions/${competitionId}/seasons`, { method: 'POST', headers: { authorization: `Bearer ${accessToken}` }, body: JSON.stringify(input) });
  },
  listSeasons(competitionId: string) {
    return request<Season[]>(`/competitions/${competitionId}/seasons`);
  },
  getSeason(seasonId: string) {
    return request<Season>(`/seasons/${seasonId}`);
  },
  updateSeason(seasonId: string, input: UpdateSeasonRequest, accessToken: string) {
    return request<Season>(`/seasons/${seasonId}`, { method: 'PUT', headers: { authorization: `Bearer ${accessToken}` }, body: JSON.stringify(input) });
  },
  listSeasonTeams(competitionId: string, seasonId: string) {
    return request<Array<CompetitionSeasonTeam & { team?: Team }>>(`/competitions/${competitionId}/seasons/${seasonId}/teams`);
  },
  addSeasonTeam(competitionId: string, seasonId: string, teamId: string, accessToken: string) {
    return request<CompetitionSeasonTeam>(`/competitions/${competitionId}/seasons/${seasonId}/teams`, { method: 'POST', headers: { authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ teamId }) });
  },
  removeSeasonTeam(competitionId: string, seasonId: string, teamId: string, accessToken: string) {
    return request<void>(`/competitions/${competitionId}/seasons/${seasonId}/teams/${teamId}`, { method: 'DELETE', headers: { authorization: `Bearer ${accessToken}` } });
  },
  deleteTeam(teamId: string, accessToken: string) {
    return request<void>(`/teams/${teamId}`, { method: 'DELETE', headers: { authorization: `Bearer ${accessToken}` } });
  },
  // Matches scheduling API
  listMatches(opts?: { competitionId?: string }) {
    const query = opts?.competitionId ? `?competitionId=${encodeURIComponent(opts.competitionId)}` : "";
    return request<PublishedLiveMatch[] | any[]>(`/matches${query}`);
  },
  previewFixtureReconciliation(accessToken: string) {
    return request<any>("/api/admin/fixture-reconciliation/preview", { method: "POST", headers: { authorization: `Bearer ${accessToken}` } });
  },
  applyFixtureReconciliation(accessToken: string) {
    return request<any>("/api/admin/fixture-reconciliation/apply", { method: "POST", headers: { authorization: `Bearer ${accessToken}` } });
  },
  getMatch(matchId: string) {
    return request<any>(`/matches/${matchId}`);
  },
  createMatch(input: any) {
    return request<any>('/matches', {
      method: 'POST',
      body: JSON.stringify(input)
    });
  },
  updateMatch(matchId: string, input: Partial<any>) {
    return request<any>(`/matches/${matchId}`, {
      method: 'PUT',
      body: JSON.stringify(input)
    });
  },
  deleteMatch(matchId: string, accessToken: string) {
    return request<void>(`/matches/${matchId}`, { method: 'DELETE', headers: { authorization: `Bearer ${accessToken}` } });
  },
  listFixtures(opts?: { competitionId?: string; seasonId?: string }) {
    const params = new URLSearchParams();
    if (opts?.competitionId) params.set('competitionId', opts.competitionId);
    if (opts?.seasonId) params.set('seasonId', opts.seasonId);
    return request<any[]>(`/fixtures${params.toString() ? `?${params.toString()}` : ''}`);
  },
  listFixtureStreams(fixtureId: string) {
    return request<any[]>(`/fixtures/${fixtureId}/streams`);
  },
  assignFixtureStream(fixtureId: string, channelId: string, accessToken: string) {
    return request<any>(`/fixtures/${fixtureId}/streams`, { method: "POST", headers: { authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ channelId }) });
  },
  updateFixtureStream(fixtureId: string, streamId: string, input: { channelId?: string; protocol?: string }, accessToken: string) {
    return request<any>(`/fixtures/${fixtureId}/streams/${streamId}`, { method: "PUT", headers: { authorization: `Bearer ${accessToken}` }, body: JSON.stringify(input) });
  },
  deleteFixtureStream(fixtureId: string, streamId: string, accessToken: string) {
    return request<void>(`/fixtures/${fixtureId}/streams/${streamId}`, { method: "DELETE", headers: { authorization: `Bearer ${accessToken}` } });
  },
  getFixture(fixtureId: string) {
    return request<any>(`/fixtures/${fixtureId}`);
  },
  createFixture(input: any, accessToken: string) {
    return request<any>('/fixtures', { method: 'POST', headers: { authorization: `Bearer ${accessToken}` }, body: JSON.stringify(input) });
  },
  updateFixture(fixtureId: string, input: any, accessToken: string) {
    return request<any>(`/fixtures/${fixtureId}`, { method: 'PUT', headers: { authorization: `Bearer ${accessToken}` }, body: JSON.stringify(input) });
  },
  deleteFixture(fixtureId: string, accessToken: string) {
    return request<void>(`/fixtures/${fixtureId}`, { method: 'DELETE', headers: { authorization: `Bearer ${accessToken}` } });
  },
  assignStream(input: MatchAssignmentRequest) {
    return request<MatchAssignmentResult>("/matches/assign-stream", {
      method: "POST",
      body: JSON.stringify(input)
    });
  },
  getActiveStream(matchId: string) {
    return request<any>(`/matches/${encodeURIComponent(matchId)}/active-stream`);
  },
  getStreamOptions(matchId: string) {
    return request<any>(`/matches/${encodeURIComponent(matchId)}/stream-options`);
  },
  getStreamStatus(matchId: string) {
    return request<any>(`/matches/${encodeURIComponent(matchId)}/stream-status`);
  },
  approveStream(streamId: string, accessToken: string) {
    return request<Stream>(`/streams/${streamId}/approve`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
  },
  publishStream(streamId: string, accessToken: string) {
    return request<Stream>(`/streams/${streamId}/publish`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
  },
  reassignStream(streamId: string, channelId: string, accessToken: string) {
    return request<Stream>(`/streams/${streamId}/reassign`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify({ channelId })
    });
  },
  deleteStream(streamId: string, accessToken: string) {
    return request<void>(`/streams/${streamId}`, {
      method: "DELETE",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
  },
  reportStreamHealth(streamId: string, input: { status: Stream["healthStatus"]; reason?: string }) {
    return request<Stream>(`/streams/${streamId}/health`, {
      method: "POST",
      body: JSON.stringify(input)
    });
  },
  listLiveMatches() {
    return request<PublishedLiveMatch[]>("/live-matches/current");
  },
  async getMobileFeatures() {
    let response: Response;

    try {
      response = await fetch(`${API_BASE_URL}/mobile/features`, {
        cache: "no-store",
        headers: {
          "content-type": "application/json"
        }
      });
    } catch (fetchError) {
      const message = fetchError instanceof Error ? fetchError.message : String(fetchError);
      throw new Error(`Network request to ${API_BASE_URL}/mobile/features failed: ${message}`);
    }

    if (!response.ok) {
      let message = `Request failed with status ${response.status}`;

      try {
        const errorBody = (await response.json()) as { message?: string; error?: string };
        message = errorBody.message ?? errorBody.error ?? message;
      } catch {
        // Keep the status message when the backend cannot return JSON.
      }

      throw new Error(message);
    }

    const body = (await response.json()) as {
      data: {
        navigation: {
          liveScores: { enabled: boolean; message: string | null };
          sports: { enabled: boolean; message: string | null };
          live: { enabled: boolean; message: string | null };
        };
      };
      timestamp: string;
    };

    return body;
  },
  async updateMobileFeatures(navigation: { liveScores?: boolean; sports?: boolean; live?: boolean }, accessToken: string) {
    const updates = Object.entries(navigation).filter((entry): entry is ["liveScores" | "sports" | "live", boolean] => typeof entry[1] === "boolean");
    await Promise.all(updates.map(([key, enabled]) => this.updateMobileFeature(`navigation.${key}`, enabled, null, accessToken)));
    return this.getMobileFeatures();
  },
  updateMobileFeature(featureKey: string, enabled: boolean, message: string | null, accessToken: string) {
    return request<{ featureKey: string; enabled: boolean; message: string | null }>(
      "/api/admin/mobile/features",
      {
        method: "PUT",
        headers: {
          authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({ featureKey, enabled, message })
      }
    );
  }
};
