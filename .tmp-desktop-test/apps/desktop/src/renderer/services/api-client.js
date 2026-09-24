// Prefer the standardized `VITE_API_URL` but keep backwards compatibility
// with the older `VITE_GITO_API_BASE_URL` name.
const runtimeEnv = typeof import.meta !== "undefined" && typeof import.meta.env !== "undefined"
    ? import.meta.env
    : process.env;
const configuredApiBaseUrl = runtimeEnv?.VITE_API_URL ?? runtimeEnv?.VITE_GITO_API_BASE_URL;
const DEV_API_BASE_URL = "http://localhost:4100";
const isDevelopmentMode = String(runtimeEnv?.MODE) === "development" || runtimeEnv?.DEV === true || runtimeEnv?.DEV === "true";
let API_BASE_URL = configuredApiBaseUrl?.trim() || "";
if (!API_BASE_URL) {
    API_BASE_URL = isDevelopmentMode ? DEV_API_BASE_URL : "https://gito-sports.onrender.com";
}
API_BASE_URL = API_BASE_URL.replace(/\/$/, "");
console.log('[api-client] API_BASE_URL=', API_BASE_URL);
export { API_BASE_URL };
const REQUEST_TIMEOUT_MS = 35_000;
let currentAccessToken = null;
export function setAccessToken(nextToken) {
    currentAccessToken = nextToken && nextToken.trim() ? nextToken.trim() : null;
}
export async function request(path, init) {
    const headers = {
        ...(init?.headers ?? {})
    };
    if (currentAccessToken && !headers.authorization) {
        headers.authorization = `Bearer ${currentAccessToken}`;
    }
    if (!(init?.body instanceof FormData)) {
        headers["content-type"] = "application/json";
    }
    const method = init?.method?.toUpperCase() ?? "GET";
    const canRetry = method === "GET" || (method === "DELETE" && path.startsWith("/iptv/providers/"));
    const requestTimeoutMs = path.startsWith("/iptv/providers") && ["POST", "PUT"].includes(method)
        ? 120_000
        : REQUEST_TIMEOUT_MS;
    let response;
    let lastNetworkError;
    for (let attempt = 0; attempt < (canRetry ? 3 : 1); attempt += 1) {
        const controller = new AbortController();
        const abortFromCaller = () => controller.abort();
        init?.signal?.addEventListener("abort", abortFromCaller, { once: true });
        const timeout = globalThis.setTimeout(() => controller.abort(), requestTimeoutMs);
        try {
            response = await fetch(`${API_BASE_URL}${path}`, {
                ...init,
                cache: "no-store",
                headers,
                signal: controller.signal
            });
            if (response.ok || !canRetry || ![502, 503, 504].includes(response.status) || attempt === 2)
                break;
        }
        catch (fetchError) {
            lastNetworkError = fetchError;
            if (!canRetry || attempt === 2 || controller.signal.aborted)
                break;
        }
        finally {
            globalThis.clearTimeout(timeout);
            init?.signal?.removeEventListener("abort", abortFromCaller);
        }
        await new Promise((resolve) => globalThis.setTimeout(resolve, 500 * (attempt + 1)));
    }
    if (!response) {
        if (lastNetworkError && String(lastNetworkError).toLowerCase().includes("abort")) {
            throw new Error(`Request to ${path} timed out. Retry the validation.`);
        }
        const message = lastNetworkError instanceof Error ? lastNetworkError.message : String(lastNetworkError ?? "unknown network error");
        throw new Error(`Network request to ${API_BASE_URL}${path} failed: ${message}`);
    }
    if (!response.ok) {
        let message = `Request failed with status ${response.status}`;
        try {
            const errorBody = (await response.json());
            message = errorBody.message ?? errorBody.error ?? message;
        }
        catch {
            // Keep the status message when the backend cannot return JSON.
        }
        throw new Error(message);
    }
    if (response.status === 204) {
        return undefined;
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
        const body = await response.json();
        if (body && typeof body === "object" && "data" in body && body.data !== undefined) {
            return body.data;
        }
        return body;
    }
    return (await response.text());
}
function buildApiPath(path, query) {
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
        return (await response.json());
    },
    async systemStatus() {
        return request("/system/status");
    },
    async createBackup() {
        return request("/system/backup", {
            method: "POST"
        });
    },
    async listBackups() {
        return request("/system/backups");
    },
    async restoreApply(filename, force = false) {
        return request("/system/restore/apply", {
            method: "POST",
            body: JSON.stringify({ filename, force })
        });
    },
    login(email, password) {
        return request("/auth/login", {
            method: "POST",
            body: JSON.stringify({ email, password })
        });
    },
    listProviders() {
        return request("/iptv/providers");
    },
    createProvider(input) {
        return request("/iptv/providers", {
            method: "POST",
            body: JSON.stringify(input)
        });
    },
    updateProvider(providerId, input) {
        return request(`/iptv/providers/${providerId}`, {
            method: "PUT",
            body: JSON.stringify(input)
        });
    },
    deleteProvider(providerId) {
        return request(`/iptv/providers/${providerId}`, { method: "DELETE" });
    },
    testProvider(input) {
        return request("/iptv/providers/test", {
            method: "POST",
            body: JSON.stringify(input)
        });
    },
    testProviderById(providerId) {
        return request(`/iptv/providers/${providerId}/test`, { method: "POST" });
    },
    ingestM3u(providerId, playlist) {
        return request("/iptv/operations", {
            method: "POST",
            body: JSON.stringify({ type: "m3u_import", providerId, playlist })
        });
    },
    syncXtream(providerId) {
        return request("/iptv/operations", {
            method: "POST",
            body: JSON.stringify({ type: "xtream_channel_sync", providerId })
        });
    },
    startIptvOperation(type, input = {}) {
        return request("/iptv/operations", {
            method: "POST",
            body: JSON.stringify({ type, ...input })
        });
    },
    getIptvOperation(operationId) {
        return request(`/iptv/operations/${encodeURIComponent(operationId)}`);
    },
    cancelIptvOperation(operationId) {
        return request(`/iptv/operations/${encodeURIComponent(operationId)}/cancel`, { method: "POST" });
    },
    listChannels(providerId, opts) {
        const params = new URLSearchParams();
        if (providerId)
            params.set("providerId", providerId);
        if (opts?.q)
            params.set("q", opts.q);
        if (opts?.category)
            params.set("category", opts.category);
        if (opts?.mode)
            params.set("mode", opts.mode);
        if (!opts?.mode && opts?.includeInactive)
            params.set("includeInactive", "true");
        const query = params.toString() ? `?${params.toString()}` : "";
        return request(`/iptv/channels${query}`);
    },
    listChannelPage(providerId, opts) {
        const params = new URLSearchParams();
        if (providerId)
            params.set("providerId", providerId);
        if (opts?.q)
            params.set("q", opts.q);
        if (opts?.category)
            params.set("category", opts.category);
        if (opts?.mode)
            params.set("mode", opts.mode);
        if (!opts?.mode && opts?.includeInactive)
            params.set("includeInactive", "true");
        params.set("page", String(opts?.page ?? 1));
        params.set("pageSize", String(opts?.pageSize ?? 100));
        return request(`/iptv/channels?${params.toString()}`);
    },
    getProviderDiagnostics(providerId) {
        return request(`/iptv/providers/${encodeURIComponent(providerId)}/diagnostics`);
    },
    listCategories(providerId) {
        const query = providerId ? `?providerId=${encodeURIComponent(providerId)}` : "";
        return request(`/iptv/categories${query}`);
    },
    listIptvCatalogueCategories(providerId, contentType) {
        return request(`/iptv/providers/${encodeURIComponent(providerId)}/categories?contentType=${contentType}&pageSize=100`);
    },
    listIptvChannels(providerId, categoryId) {
        const params = new URLSearchParams({ page: "1", pageSize: "100" });
        if (categoryId)
            params.set("categoryId", categoryId);
        return request(`/iptv/providers/${encodeURIComponent(providerId)}/channels?${params}`);
    },
    listIptvMovies(providerId, categoryId, search) {
        const params = new URLSearchParams({ page: "1", pageSize: "100" });
        if (categoryId)
            params.set("categoryId", categoryId);
        if (search)
            params.set("search", search);
        return request(`/iptv/providers/${encodeURIComponent(providerId)}/movies?${params}`);
    },
    listIptvSeries(providerId, categoryId) {
        const params = new URLSearchParams({ page: "1", pageSize: "100" });
        if (categoryId)
            params.set("categoryId", categoryId);
        return request(`/iptv/providers/${encodeURIComponent(providerId)}/series?${params}`);
    },
    listIptvSeasons(providerId, seriesId) {
        return request(`/iptv/providers/${encodeURIComponent(providerId)}/series/${encodeURIComponent(seriesId)}/seasons`);
    },
    listIptvEpisodes(providerId, seasonId) {
        return request(`/iptv/providers/${encodeURIComponent(providerId)}/seasons/${encodeURIComponent(seasonId)}/episodes?page=1&pageSize=100`);
    },
    listIptvEpgChannels(providerId) {
        return request(`/iptv/providers/${encodeURIComponent(providerId)}/epg/channels?pageSize=100`);
    },
    listIptvEpgProgrammes(providerId, epgChannelId, current = false, upcoming = false, channelExternalRef) {
        const params = new URLSearchParams({ page: "1", pageSize: "20", epgChannelId });
        if (channelExternalRef)
            params.set("channelExternalRef", channelExternalRef);
        if (current)
            params.set("current", "true");
        if (upcoming)
            params.set("upcoming", "true");
        return request(`/iptv/providers/${encodeURIComponent(providerId)}/epg/programmes?${params}`);
    },
    setProviderStatus(providerId, status) {
        return request(`/iptv/providers/${providerId}/status`, {
            method: "POST",
            body: JSON.stringify({ status })
        });
    },
    listNewsArticles() {
        return request("/news/articles");
    },
    createNewsArticle(input, accessToken) {
        return request("/news/articles", {
            method: "POST",
            headers: { authorization: `Bearer ${accessToken}` },
            body: JSON.stringify(input)
        });
    },
    updateNewsArticle(articleId, input, accessToken) {
        return request(`/news/articles/${articleId}`, {
            method: "PUT",
            headers: { authorization: `Bearer ${accessToken}` },
            body: JSON.stringify(input)
        });
    },
    publishNewsArticle(articleId, accessToken) {
        return request(`/news/articles/${articleId}/publish`, {
            method: "POST",
            headers: { authorization: `Bearer ${accessToken}` }
        });
    },
    archiveNewsArticle(articleId, accessToken) {
        return request(`/news/articles/${articleId}/archive`, {
            method: "POST",
            headers: { authorization: `Bearer ${accessToken}` }
        });
    },
    generateGiTONewsDraft(articleId, accessToken) {
        return request(`/news/articles/${articleId}/generate-gito-draft`, {
            method: "POST",
            headers: { authorization: `Bearer ${accessToken}` }
        });
    },
    researchNewsArticle(articleId, accessToken) {
        return request(`/news/articles/${articleId}/research`, {
            method: "POST",
            headers: { authorization: `Bearer ${accessToken}` }
        });
    },
    getNewsResearchResult(articleId, accessToken) {
        return request(`/news/articles/${articleId}/research`, {
            headers: { authorization: `Bearer ${accessToken}` }
        });
    },
    getNewsClassification(articleId, accessToken) {
        return request(`/news/articles/${articleId}/classification`, { headers: { authorization: `Bearer ${accessToken}` } });
    },
    rerunNewsClassification(articleId, accessToken) {
        return request(`/news/articles/${articleId}/classification/rerun`, { method: "POST", headers: { authorization: `Bearer ${accessToken}` } });
    },
    aiClassifyNewsArticle(articleId, accessToken) {
        return request(`/news/articles/${articleId}/classification/ai`, { method: "POST", headers: { authorization: `Bearer ${accessToken}` } });
    },
    approveNewsClassification(articleId, categoryId, accessToken) {
        return request(`/news/articles/${articleId}/classification/${categoryId}/approve`, { method: "POST", headers: { authorization: `Bearer ${accessToken}` } });
    },
    rejectNewsClassification(articleId, categoryId, accessToken) {
        return request(`/news/articles/${articleId}/classification/${categoryId}/reject`, { method: "POST", headers: { authorization: `Bearer ${accessToken}` } });
    },
    approveNewsClassifications(articleId, categoryIds, accessToken) {
        return request(`/news/articles/${articleId}/classification/approve`, { method: "POST", headers: { authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ categoryIds }) });
    },
    addManualNewsClassification(articleId, categoryType, entityId, accessToken) {
        return request(`/news/articles/${articleId}/classification/manual`, { method: "POST", headers: { authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ categoryType, entityId }) });
    },
    removeNewsClassification(articleId, categoryId, accessToken) {
        return request(`/news/articles/${articleId}/classification/${categoryId}`, { method: "DELETE", headers: { authorization: `Bearer ${accessToken}` } });
    },
    listNewsRssSources(accessToken) {
        return request("/news/rss-sources", {
            headers: { authorization: `Bearer ${accessToken}` }
        });
    },
    createNewsRssSource(name, feedUrl, accessToken) {
        return request("/news/rss-sources", {
            method: "POST",
            headers: { authorization: `Bearer ${accessToken}` },
            body: JSON.stringify({ name, feedUrl })
        });
    },
    deleteNewsRssSource(sourceId, accessToken) {
        return request(`/news/rss-sources/${sourceId}`, { method: "DELETE", headers: { authorization: `Bearer ${accessToken}` } });
    },
    fetchNewsRssSource(sourceId, accessToken) {
        return request(`/news/rss-sources/${sourceId}/fetch`, {
            method: "POST",
            headers: { authorization: `Bearer ${accessToken}` }
        });
    },
    listGeneratedNewsRssFeeds(accessToken) {
        return request("/news/generated-rss-sources", { headers: { authorization: `Bearer ${accessToken}` } });
    },
    createGeneratedNewsRssFeed(name, sourceUrl, accessToken) {
        return request("/news/generated-rss-sources", { method: "POST", headers: { authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ name, sourceUrl }) });
    },
    refreshGeneratedNewsRssFeed(feedId, accessToken) {
        return request(`/news/generated-rss-sources/${feedId}/refresh`, { method: "POST", headers: { authorization: `Bearer ${accessToken}` } });
    },
    listGeneratedNewsRssArticles(feedId, accessToken) {
        return request(`/news/generated-rss-sources/${feedId}/articles`, { headers: { authorization: `Bearer ${accessToken}` } });
    },
    deleteGeneratedNewsRssFeed(feedId, accessToken) {
        return request(`/news/generated-rss-sources/${feedId}`, { method: "DELETE", headers: { authorization: `Bearer ${accessToken}` } });
    },
    generateGiTOOriginalStory(articleId, researchResult, accessToken) {
        return request(`/news/articles/${articleId}/generate-original`, {
            method: "POST",
            headers: { authorization: `Bearer ${accessToken}` },
            body: JSON.stringify({ researchResult })
        });
    },
    deleteNewsArticle(articleId, accessToken) {
        return request(`/news/articles/${articleId}`, {
            method: "DELETE",
            headers: { authorization: `Bearer ${accessToken}` }
        });
    },
    bulkDeleteNewsArticles(articleIds, accessToken) {
        return request("/news/articles/bulk-delete", {
            method: "POST",
            headers: { authorization: `Bearer ${accessToken}` },
            body: JSON.stringify({ ids: articleIds })
        });
    },
    listNewsSources() {
        return request("/news/sources");
    },
    createNewsSource(input, accessToken) {
        return request("/news/sources", {
            method: "POST",
            headers: { authorization: `Bearer ${accessToken}` },
            body: JSON.stringify(input)
        });
    },
    updateNewsSource(sourceId, input, accessToken) {
        return request(`/news/sources/${sourceId}`, {
            method: "PUT",
            headers: { authorization: `Bearer ${accessToken}` },
            body: JSON.stringify(input)
        });
    },
    deleteNewsSource(sourceId, accessToken) {
        return request(`/news/sources/${sourceId}`, {
            method: "DELETE",
            headers: { authorization: `Bearer ${accessToken}` }
        });
    },
    collectNewsSource(sourceId, accessToken) {
        return request(`/news/sources/${sourceId}/collect`, {
            method: "POST",
            headers: { authorization: `Bearer ${accessToken}` }
        });
    },
    auditNewsSourcePublishingRights(sourceId, accessToken) {
        return request(`/news/sources/${sourceId}/audit-rights`, {
            method: "POST",
            headers: { authorization: `Bearer ${accessToken}` }
        });
    },
    fetchNewsArticleContent(articleId, accessToken) {
        return request(`/news/articles/${articleId}/fetch-content`, {
            method: "POST",
            headers: { authorization: `Bearer ${accessToken}` }
        });
    },
    addNewsArticleMedia(articleId, url, mediaType = "image", accessToken) {
        return request(`/news/articles/${articleId}/media`, {
            method: "POST",
            headers: { authorization: `Bearer ${accessToken}` },
            body: JSON.stringify({ url, mediaType, altText: "" })
        });
    },
    addNewsArticleLink(articleId, url, label, accessToken) {
        return request(`/news/articles/${articleId}/links`, {
            method: "POST",
            headers: { authorization: `Bearer ${accessToken}` },
            body: JSON.stringify({ url, label })
        });
    },
    listSports() {
        return request('/sports');
    },
    getSport(sportId) {
        return request(`/sports/${sportId}`);
    },
    createSport(input, accessToken) {
        return request('/sports', {
            method: 'POST',
            headers: { authorization: `Bearer ${accessToken}` },
            body: JSON.stringify(input)
        });
    },
    async uploadImage(file) {
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
                    const errorBody = (await response.json());
                    message = errorBody.message ?? errorBody.error ?? message;
                }
                catch {
                    if (response.status === 413) {
                        message = "Logo upload is too large. Please choose a smaller image.";
                    }
                }
                throw new Error(message);
            }
            const body = (await response.json());
            const url = body.data.url;
            return url.startsWith("/uploads/") || url.startsWith("uploads/") ? (url.startsWith("/") ? url : `/${url}`) : url;
        }
        catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") {
                throw new Error("Logo upload timed out. Please check the backend server and try again.");
            }
            if (error instanceof TypeError) {
                throw new Error(`Unable to reach the backend at ${API_BASE_URL}. Please make sure the server is running and try again.`);
            }
            throw error;
        }
        finally {
            window.clearTimeout(timeoutId);
        }
    },
    updateSport(sportId, input, accessToken) {
        return request(`/sports/${sportId}`, {
            method: 'PUT',
            headers: { authorization: `Bearer ${accessToken}` },
            body: JSON.stringify(input)
        });
    },
    deleteSport(sportId, accessToken) {
        return request(`/sports/${sportId}`, { method: 'DELETE', headers: { authorization: `Bearer ${accessToken}` } });
    },
    listCountries(mode) {
        const path = buildApiPath('/countries', { mode });
        return request(path);
    },
    getCountry(countryId, mode) {
        const path = buildApiPath(`/countries/${countryId}`, { mode });
        return request(path);
    },
    createCountry(input, accessToken) {
        return request('/countries', {
            method: 'POST',
            headers: { authorization: `Bearer ${accessToken}` },
            body: JSON.stringify(input)
        });
    },
    updateCountry(countryId, input, accessToken) {
        return request(`/countries/${countryId}`, {
            method: 'PUT',
            headers: { authorization: `Bearer ${accessToken}` },
            body: JSON.stringify(input)
        });
    },
    deleteCountry(countryId, accessToken) {
        return request(`/countries/${countryId}`, { method: 'DELETE', headers: { authorization: `Bearer ${accessToken}` } });
    },
    listHosts(sportId) {
        const path = buildApiPath('/hosts', sportId ? { sportId } : undefined);
        return request(path);
    },
    addHostToSport(hostId, sportId, accessToken) {
        return request(`/hosts/${hostId}/sports/${sportId}`, { method: 'POST', headers: { authorization: `Bearer ${accessToken}` } });
    },
    removeHostFromSport(hostId, sportId, accessToken) {
        return request(`/hosts/${hostId}/sports/${sportId}`, { method: 'DELETE', headers: { authorization: `Bearer ${accessToken}` } });
    },
    createHost(input, accessToken) {
        return request('/hosts', {
            method: 'POST',
            headers: { authorization: `Bearer ${accessToken}` },
            body: JSON.stringify(input)
        });
    },
    updateHost(hostId, input, accessToken) {
        return request(`/hosts/${hostId}`, {
            method: 'PUT',
            headers: { authorization: `Bearer ${accessToken}` },
            body: JSON.stringify(input)
        });
    },
    deleteHost(hostId, accessToken) {
        return request(`/hosts/${hostId}`, { method: 'DELETE', headers: { authorization: `Bearer ${accessToken}` } });
    },
    listCompetitions(mode, hostId) {
        const path = buildApiPath('/competitions', { mode, ...(hostId ? { hostId } : {}) });
        return request(path);
    },
    getCompetition(competitionId, mode) {
        const path = buildApiPath(`/competitions/${competitionId}`, { mode });
        return request(path);
    },
    createCompetition(input, accessToken) {
        return request('/competitions', {
            method: 'POST',
            headers: { authorization: `Bearer ${accessToken}` },
            body: JSON.stringify(input)
        });
    },
    updateCompetition(competitionId, input, accessToken) {
        return request(`/competitions/${competitionId}`, {
            method: 'PUT',
            headers: { authorization: `Bearer ${accessToken}` },
            body: JSON.stringify(input)
        });
    },
    deleteCompetition(competitionId, accessToken) {
        return request(`/competitions/${competitionId}`, { method: 'DELETE', headers: { authorization: `Bearer ${accessToken}` } });
    },
    addTeamToCompetition(competitionId, teamId, accessToken) {
        return request(`/competitions/${competitionId}/teams`, {
            method: 'POST',
            headers: { authorization: `Bearer ${accessToken}` },
            body: JSON.stringify({ teamId })
        });
    },
    listCompetitionTeams(competitionId) {
        return request(`/competitions/${competitionId}/teams`);
    },
    removeTeamFromCompetition(competitionId, teamId, accessToken) {
        return request(`/competitions/${competitionId}/teams/${teamId}`, { method: 'DELETE', headers: { authorization: `Bearer ${accessToken}` } });
    },
    listTeams(mode, filters) {
        const path = buildApiPath('/teams', { mode, ...filters });
        return request(path);
    },
    getTeam(teamId, mode) {
        const path = buildApiPath(`/teams/${teamId}`, { mode });
        return request(path);
    },
    createTeam(input, accessToken) {
        return request('/teams', {
            method: 'POST',
            headers: { authorization: `Bearer ${accessToken}` },
            body: JSON.stringify(input)
        });
    },
    updateTeam(teamId, input, accessToken) {
        return request(`/teams/${teamId}`, {
            method: 'PUT',
            headers: { authorization: `Bearer ${accessToken}` },
            body: JSON.stringify(input)
        });
    },
    listClubs() {
        return request('/clubs');
    },
    getClub(clubId) {
        return request(`/clubs/${clubId}`);
    },
    createSeason(competitionId, input, accessToken) {
        return request(`/competitions/${competitionId}/seasons`, { method: 'POST', headers: { authorization: `Bearer ${accessToken}` }, body: JSON.stringify(input) });
    },
    listSeasons(competitionId) {
        return request(`/competitions/${competitionId}/seasons`);
    },
    getSeason(seasonId) {
        return request(`/seasons/${seasonId}`);
    },
    updateSeason(seasonId, input, accessToken) {
        return request(`/seasons/${seasonId}`, { method: 'PUT', headers: { authorization: `Bearer ${accessToken}` }, body: JSON.stringify(input) });
    },
    listSeasonTeams(competitionId, seasonId) {
        return request(`/competitions/${competitionId}/seasons/${seasonId}/teams`);
    },
    addSeasonTeam(competitionId, seasonId, teamId, accessToken) {
        return request(`/competitions/${competitionId}/seasons/${seasonId}/teams`, { method: 'POST', headers: { authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ teamId }) });
    },
    removeSeasonTeam(competitionId, seasonId, teamId, accessToken) {
        return request(`/competitions/${competitionId}/seasons/${seasonId}/teams/${teamId}`, { method: 'DELETE', headers: { authorization: `Bearer ${accessToken}` } });
    },
    listPlayers(filters) {
        return request(buildApiPath('/catalog/players', filters));
    },
    createPlayer(input, accessToken) {
        return request('/catalog/players', { method: 'POST', headers: { authorization: `Bearer ${accessToken}` }, body: JSON.stringify(input) });
    },
    getPlayer(playerId) {
        return request(`/catalog/players/${playerId}`);
    },
    updatePlayer(playerId, input, accessToken) {
        return request(`/catalog/players/${playerId}`, { method: 'PUT', headers: { authorization: `Bearer ${accessToken}` }, body: JSON.stringify(input) });
    },
    listSeasonSquads(filters) {
        return request(buildApiPath('/catalog/season-squads', filters));
    },
    createSeasonSquad(input, accessToken) {
        return request('/catalog/season-squads', { method: 'POST', headers: { authorization: `Bearer ${accessToken}` }, body: JSON.stringify(input) });
    },
    updateSeasonSquad(squadId, input, accessToken) {
        return request(`/catalog/season-squads/${squadId}`, { method: 'PUT', headers: { authorization: `Bearer ${accessToken}` }, body: JSON.stringify(input) });
    },
    listSquadPlayers(squadId) {
        return request(`/catalog/season-squads/${squadId}/players`);
    },
    createSquadPlayer(squadId, input, accessToken) {
        return request(`/catalog/season-squads/${squadId}/players`, { method: 'POST', headers: { authorization: `Bearer ${accessToken}` }, body: JSON.stringify(input) });
    },
    updateSquadPlayer(memberId, input, accessToken) {
        return request(`/catalog/season-squad-players/${memberId}`, { method: 'PUT', headers: { authorization: `Bearer ${accessToken}` }, body: JSON.stringify(input) });
    },
    removeSquadPlayer(memberId, accessToken) {
        return request(`/catalog/season-squad-players/${memberId}`, { method: 'DELETE', headers: { authorization: `Bearer ${accessToken}` } });
    },
    listFormationTemplates(filters) {
        return request(buildApiPath('/catalog/formation-templates', filters));
    },
    createFormationTemplate(input, accessToken) {
        return request('/catalog/formation-templates', { method: 'POST', headers: { authorization: `Bearer ${accessToken}` }, body: JSON.stringify(input) });
    },
    updateFormationTemplate(templateId, input, accessToken) {
        return request(`/catalog/formation-templates/${templateId}`, { method: 'PUT', headers: { authorization: `Bearer ${accessToken}` }, body: JSON.stringify(input) });
    },
    listFixtureLineups(fixtureId) {
        return request(`/fixtures/${fixtureId}/lineups`);
    },
    saveFixtureLineup(fixtureId, input, accessToken) {
        return request(`/fixtures/${fixtureId}/lineups`, { method: 'PUT', headers: { authorization: `Bearer ${accessToken}` }, body: JSON.stringify(input) });
    },
    deleteTeam(teamId, accessToken) {
        return request(`/teams/${teamId}`, { method: 'DELETE', headers: { authorization: `Bearer ${accessToken}` } });
    },
    // Matches scheduling API
    listMatches(opts) {
        const query = opts?.competitionId ? `?competitionId=${encodeURIComponent(opts.competitionId)}` : "";
        return request(`/matches${query}`);
    },
    previewFixtureReconciliation(accessToken) {
        return request("/api/admin/fixture-reconciliation/preview", { method: "POST", headers: { authorization: `Bearer ${accessToken}` } });
    },
    applyFixtureReconciliation(accessToken) {
        return request("/api/admin/fixture-reconciliation/apply", { method: "POST", headers: { authorization: `Bearer ${accessToken}` } });
    },
    getMatch(matchId) {
        return request(`/matches/${matchId}`);
    },
    createMatch(input) {
        return request('/matches', {
            method: 'POST',
            body: JSON.stringify(input)
        });
    },
    updateMatch(matchId, input) {
        return request(`/matches/${matchId}`, {
            method: 'PUT',
            body: JSON.stringify(input)
        });
    },
    deleteMatch(matchId, accessToken) {
        return request(`/matches/${matchId}`, { method: 'DELETE', headers: { authorization: `Bearer ${accessToken}` } });
    },
    listFixtures(opts) {
        const params = new URLSearchParams();
        if (opts?.sportId)
            params.set('sportId', opts.sportId);
        if (opts?.competitionId)
            params.set('competitionId', opts.competitionId);
        if (opts?.seasonId)
            params.set('seasonId', opts.seasonId);
        if (opts?.teamId)
            params.set('teamId', opts.teamId);
        if (opts?.status)
            params.set('status', opts.status);
        if (opts?.from)
            params.set('from', opts.from);
        if (opts?.to)
            params.set('to', opts.to);
        if (opts?.limit !== undefined)
            params.set('limit', String(opts.limit));
        if (opts?.offset !== undefined)
            params.set('offset', String(opts.offset));
        return request(`/fixtures${params.toString() ? `?${params.toString()}` : ''}`);
    },
    listFixtureStreams(fixtureId) {
        return request(`/fixtures/${fixtureId}/streams`);
    },
    assignFixtureStream(fixtureId, channelId, accessToken) {
        return request(`/fixtures/${fixtureId}/streams`, { method: "POST", headers: { authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ channelId }) });
    },
    updateFixtureStream(fixtureId, streamId, input, accessToken) {
        return request(`/fixtures/${fixtureId}/streams/${streamId}`, { method: "PUT", headers: { authorization: `Bearer ${accessToken}` }, body: JSON.stringify(input) });
    },
    deleteFixtureStream(fixtureId, streamId, accessToken) {
        return request(`/fixtures/${fixtureId}/streams/${streamId}`, { method: "DELETE", headers: { authorization: `Bearer ${accessToken}` } });
    },
    getFixture(fixtureId) {
        return request(`/fixtures/${fixtureId}`);
    },
    createFixture(input, accessToken) {
        return request('/fixtures', { method: 'POST', headers: { authorization: `Bearer ${accessToken}` }, body: JSON.stringify(input) });
    },
    updateFixture(fixtureId, input, accessToken) {
        return request(`/fixtures/${fixtureId}`, { method: 'PUT', headers: { authorization: `Bearer ${accessToken}` }, body: JSON.stringify(input) });
    },
    deleteFixture(fixtureId, accessToken) {
        return request(`/fixtures/${fixtureId}`, { method: 'DELETE', headers: { authorization: `Bearer ${accessToken}` } });
    },
    assignStream(input) {
        return request("/matches/assign-stream", {
            method: "POST",
            body: JSON.stringify(input)
        });
    },
    getActiveStream(matchId) {
        return request(`/matches/${encodeURIComponent(matchId)}/active-stream`);
    },
    getStreamOptions(matchId) {
        return request(`/matches/${encodeURIComponent(matchId)}/stream-options`);
    },
    getStreamStatus(matchId) {
        return request(`/matches/${encodeURIComponent(matchId)}/stream-status`);
    },
    approveStream(streamId, accessToken) {
        return request(`/streams/${streamId}/approve`, {
            method: "POST",
            headers: {
                authorization: `Bearer ${accessToken}`
            }
        });
    },
    publishStream(streamId, accessToken) {
        return request(`/streams/${streamId}/publish`, {
            method: "POST",
            headers: {
                authorization: `Bearer ${accessToken}`
            }
        });
    },
    reassignStream(streamId, channelId, accessToken) {
        return request(`/streams/${streamId}/reassign`, {
            method: "POST",
            headers: {
                authorization: `Bearer ${accessToken}`
            },
            body: JSON.stringify({ channelId })
        });
    },
    deleteStream(streamId, accessToken) {
        return request(`/streams/${streamId}`, {
            method: "DELETE",
            headers: {
                authorization: `Bearer ${accessToken}`
            }
        });
    },
    bindPublicationArtifact(publicationId, matchId, accessToken) {
        return request(`/publication-artifacts/${publicationId}/bind`, {
            method: "POST",
            headers: {
                authorization: `Bearer ${accessToken}`
            },
            body: JSON.stringify({ matchId })
        });
    },
    approvePublicationArtifact(publicationId, accessToken) {
        return request(`/publication-artifacts/${publicationId}/approve`, {
            method: "POST",
            headers: {
                authorization: `Bearer ${accessToken}`
            }
        });
    },
    publishPublicationArtifact(publicationId, accessToken) {
        return request(`/publication-artifacts/${publicationId}/publish`, {
            method: "POST",
            headers: {
                authorization: `Bearer ${accessToken}`
            }
        });
    },
    revokePublicationArtifact(publicationId, accessToken) {
        return request(`/publication-artifacts/${publicationId}/revoke`, {
            method: "POST",
            headers: {
                authorization: `Bearer ${accessToken}`
            }
        });
    },
    updatePublicationAvailability(publicationId, availability, accessToken) {
        return request(`/publication-artifacts/${publicationId}/availability`, {
            method: "POST",
            ...(accessToken ? {
                headers: { authorization: `Bearer ${accessToken}` }
            } : {}),
            body: JSON.stringify({ availability })
        });
    },
    reportStreamHealth(streamId, input) {
        return request(`/streams/${streamId}/health`, {
            method: "POST",
            body: JSON.stringify(input)
        });
    },
    listLiveMatches() {
        return request("/live-matches/current");
    },
    submitPublicationArtifact(input) {
        return request("/publication-artifacts", {
            method: "POST",
            body: JSON.stringify(input)
        });
    },
    listPublishedPublicationFeed() {
        return request("/publication-artifacts/published");
    },
    async getMobileFeatures() {
        let response;
        try {
            response = await fetch(`${API_BASE_URL}/mobile/features`, {
                cache: "no-store",
                headers: {
                    "content-type": "application/json"
                }
            });
        }
        catch (fetchError) {
            const message = fetchError instanceof Error ? fetchError.message : String(fetchError);
            throw new Error(`Network request to ${API_BASE_URL}/mobile/features failed: ${message}`);
        }
        if (!response.ok) {
            let message = `Request failed with status ${response.status}`;
            try {
                const errorBody = (await response.json());
                message = errorBody.message ?? errorBody.error ?? message;
            }
            catch {
                // Keep the status message when the backend cannot return JSON.
            }
            throw new Error(message);
        }
        const body = (await response.json());
        return body;
    },
    async updateMobileFeatures(navigation, accessToken) {
        const updates = Object.entries(navigation).filter((entry) => typeof entry[1] === "boolean");
        await Promise.all(updates.map(([key, enabled]) => this.updateMobileFeature(`navigation.${key}`, enabled, null, accessToken)));
        return this.getMobileFeatures();
    },
    updateMobileFeature(featureKey, enabled, message, accessToken) {
        return request("/api/admin/mobile/features", {
            method: "PUT",
            headers: {
                authorization: `Bearer ${accessToken}`
            },
            body: JSON.stringify({ featureKey, enabled, message })
        });
    }
};
