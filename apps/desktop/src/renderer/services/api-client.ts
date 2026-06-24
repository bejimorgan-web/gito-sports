import type {
  Channel,
  ChannelDebug,
  ChannelListMode,
  Competition,
  CreateCompetitionRequest,
  CreateCountryRequest,
  CreateProviderRequest,
  CreateSportRequest,
  CreateTeamRequest,
  Country,
  IPTVProvider,
  MatchAssignmentRequest,
  MatchAssignmentResult,
  ProviderChannelDiagnostics,
  ProviderConnectionTest,
  PublishedLiveMatch,
  Sport,
  Stream,
  Team
} from "@gito/shared";

// Prefer the standardized `VITE_API_URL` but keep backwards compatibility
// with the older `VITE_GITO_API_BASE_URL` name.
let API_BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? (import.meta.env.VITE_GITO_API_BASE_URL as string | undefined);
const DEV_API_BASE_URL = ["http://", "localhost", ":4100"].join("");

if (!API_BASE_URL) {
  API_BASE_URL = (import.meta as any).env?.MODE === "production"
    ? "https://gito-sports.onrender.com"
    : DEV_API_BASE_URL;
}

API_BASE_URL = API_BASE_URL.replace(/\/$/, "");

console.log('[api-client] API_BASE_URL=', API_BASE_URL);

export { API_BASE_URL };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
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

  const body = (await response.json()) as { data: T };
  return body.data;
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
    return request<{ channelsCreated: number; categories: string[] }>(
      `/iptv/providers/${providerId}/m3u`,
      {
        method: "POST",
        body: JSON.stringify({ playlist })
      }
    );
  },
  syncXtream(providerId: string) {
    return request<{ channelsCreated: number; categories: string[] }>(
      `/iptv/providers/${providerId}/xtream/sync`,
      {
        method: "POST"
      }
    );
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
  listSports() {
    return request<Sport[]>('/sports');
  },
  getSport(sportId: string) {
    return request<Sport>(`/sports/${sportId}`);
  },
  createSport(input: CreateSportRequest) {
    return request<Sport>('/sports', {
      method: 'POST',
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
  updateSport(sportId: string, input: Partial<CreateSportRequest>) {
    return request<Sport>(`/sports/${sportId}`, {
      method: 'PUT',
      body: JSON.stringify(input)
    });
  },
  deleteSport(sportId: string) {
    return request<void>(`/sports/${sportId}`, { method: 'DELETE' });
  },
  listCountries(mode?: 'legacy' | 'catalog') {
    const path = buildApiPath('/countries', { mode });
    return request<Country[]>(path);
  },
  getCountry(countryId: string, mode?: 'legacy' | 'catalog') {
    const path = buildApiPath(`/countries/${countryId}`, { mode });
    return request<Country>(path);
  },
  createCountry(input: CreateCountryRequest) {
    return request<Country>('/countries', {
      method: 'POST',
      body: JSON.stringify(input)
    });
  },
  updateCountry(countryId: string, input: Partial<CreateCountryRequest>) {
    return request<Country>(`/countries/${countryId}`, {
      method: 'PUT',
      body: JSON.stringify(input)
    });
  },
  deleteCountry(countryId: string) {
    return request<void>(`/countries/${countryId}`, { method: 'DELETE' });
  },
  listCompetitions(mode?: 'legacy' | 'catalog') {
    const path = buildApiPath('/competitions', { mode });
    return request<Competition[]>(path);
  },
  getCompetition(competitionId: string, mode?: 'legacy' | 'catalog') {
    const path = buildApiPath(`/competitions/${competitionId}`, { mode });
    return request<Competition>(path);
  },
  createCompetition(input: CreateCompetitionRequest) {
    return request<Competition>('/competitions', {
      method: 'POST',
      body: JSON.stringify(input)
    });
  },
  updateCompetition(competitionId: string, input: Partial<CreateCompetitionRequest>) {
    return request<Competition>(`/competitions/${competitionId}`, {
      method: 'PUT',
      body: JSON.stringify(input)
    });
  },
  deleteCompetition(competitionId: string) {
    return request<void>(`/competitions/${competitionId}`, { method: 'DELETE' });
  },
  addTeamToCompetition(competitionId: string, teamId: string) {
    return request(`/competitions/${competitionId}/teams`, {
      method: 'POST',
      body: JSON.stringify({ teamId })
    });
  },
  listCompetitionTeams(competitionId: string) {
    return request<Team[]>(`/competitions/${competitionId}/teams`);
  },
  removeTeamFromCompetition(competitionId: string, teamId: string) {
    return request<void>(`/competitions/${competitionId}/teams/${teamId}`, { method: 'DELETE' });
  },
  listTeams(mode?: 'legacy' | 'catalog') {
    const path = buildApiPath('/teams', { mode });
    return request<Team[]>(path);
  },
  getTeam(teamId: string, mode?: 'legacy' | 'catalog') {
    const path = buildApiPath(`/teams/${teamId}`, { mode });
    return request<Team>(path);
  },
  createTeam(input: CreateTeamRequest) {
    return request<Team>('/teams', {
      method: 'POST',
      body: JSON.stringify(input)
    });
  },
  updateTeam(teamId: string, input: Partial<CreateTeamRequest>) {
    return request<Team>(`/teams/${teamId}`, {
      method: 'PUT',
      body: JSON.stringify(input)
    });
  },
  deleteTeam(teamId: string) {
    return request<void>(`/teams/${teamId}`, { method: 'DELETE' });
  },
  // Matches scheduling API
  listMatches(opts?: { competitionId?: string }) {
    const query = opts?.competitionId ? `?competitionId=${encodeURIComponent(opts.competitionId)}` : "";
    return request<PublishedLiveMatch[] | any[]>(`/matches${query}`);
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
  deleteMatch(matchId: string) {
    return request<void>(`/matches/${matchId}`, { method: 'DELETE' });
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
  getMobileFeatures() {
    return request<{
      navigation: {
        liveScores: { enabled: boolean; message: string | null };
        sports: { enabled: boolean; message: string | null };
        live: { enabled: boolean; message: string | null };
      };
      timestamp: string;
    }>("/mobile/features");
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
