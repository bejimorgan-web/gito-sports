import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const workspaceRoot = process.cwd();
const validationDataDir = path.resolve(workspaceRoot, "data");
const validationDatabasePath = path.join(validationDataDir, `enforcement-validation-${Date.now()}.sqlite`);

fs.mkdirSync(validationDataDir, { recursive: true });
process.env.DATABASE_PATH = validationDatabasePath;
process.env.JWT_SECRET = "validation-enforcement-secret";

let createApp: typeof import("../apps/backend/src/app").createApp;
let getDatabase: typeof import("../apps/backend/src/db/connection").getDatabase;
let server: http.Server | undefined;

async function listen(): Promise<string> {
  return new Promise((resolve) => {
    if (!server) {
      throw new Error("Validation server was not initialized.");
    }

    server.listen(0, "127.0.0.1", () => {
      const address = server.address();

      if (!address || typeof address === "string") {
        throw new Error("Validation server did not bind to a TCP address.");
      }

      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function toJson(value: unknown) {
  return typeof value === "string" ? value : JSON.stringify(value);
}

async function request<T>(context: { baseUrl: string }, pathName: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${context.baseUrl}${pathName}`, {
    ...init,
    signal: AbortSignal.timeout(15000),
    headers: {
      "content-type": "application/json",
      ...(init?.headers as Record<string, string> | undefined)
    }
  });

  if (!response.ok) {
    const body = await response.text();
    let parsed: any;
    try {
      parsed = JSON.parse(body);
    } catch {
      parsed = { body };
    }
    throw new Error(
      `Request ${pathName} failed ${response.status}: ${parsed.error ?? parsed.message ?? JSON.stringify(parsed)}`
    );
  }

  return response.json() as Promise<T>;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function randomSuffix() {
  return crypto.randomUUID().slice(0, 8);
}

function playlist(name: string) {
  return [
    "#EXTM3U",
    `#EXTINF:-1 tvg-id=\"${name}-1\" group-title=\"Validation\",${name} Channel 1`,
    `https://streams.example/${name.toLowerCase()}-1.m3u8`
  ].join("\n");
}

async function login(baseUrl: string): Promise<string> {
  const session = await request<{ accessToken: string }>({ baseUrl }, "/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "operator@gito.local" })
  });
  return session.accessToken;
}

async function createProvider(context: { baseUrl: string }, name: string) {
  return request<{ data: { id: string } }>(context, "/iptv/providers", {
    method: "POST",
    body: JSON.stringify({ name, baseUrl: "https://provider.example/stream", type: "m3u" })
  });
}

async function ingestPlaylist(context: { baseUrl: string }, providerId: string, playlistText: string) {
  return request<{ data: { channelsCreated: number } }>(context, `/iptv/providers/${providerId}/m3u`, {
    method: "POST",
    body: JSON.stringify({ playlist: playlistText })
  });
}

async function activateProvider(context: { baseUrl: string }, providerId: string) {
  return request<{ data: unknown }>(context, `/iptv/providers/${providerId}/status`, {
    method: "POST",
    body: JSON.stringify({ status: "active" })
  });
}

async function getChannels(context: { baseUrl: string }, providerId: string) {
  return request<{ data: Array<{ id: string }> }>(context, `/iptv/channels?providerId=${encodeURIComponent(providerId)}`);
}

async function createSport(context: { baseUrl: string }, name: string) {
  return request<{ data: { id: string } }>(context, "/sports", {
    method: "POST",
    body: JSON.stringify({ name })
  });
}

async function createCountry(context: { baseUrl: string }, name: string, iso2: string, iso3: string) {
  return request<{ data: { id: string } }>(context, "/countries", {
    method: "POST",
    body: JSON.stringify({ name, iso2Code: iso2, iso3Code: iso3 })
  });
}

async function createCompetition(context: { baseUrl: string }, sportId: string, name: string, countryId?: string) {
  return request<{ data: { id: string } }>(context, "/competitions", {
    method: "POST",
    body: JSON.stringify({ sportId, name, scope: "national", type: "league", participantType: "clubs", countryId })
  });
}

async function createTeam(context: { baseUrl: string }, sportId: string, name: string, type: "club" | "national", countryId?: string) {
  return request<{ data: { id: string } }>(context, "/teams", {
    method: "POST",
    body: JSON.stringify({ sportId, name, type, countryId })
  });
}

async function assignTeam(context: { baseUrl: string }, competitionId: string, teamId: string) {
  return request<{ data: { competitionId: string; teamId: string } }>(context, `/competitions/${competitionId}/teams`, {
    method: "POST",
    body: JSON.stringify({ teamId })
  });
}

async function createSchedulingMatch(context: { baseUrl: string }, input: { competitionId: string; homeTeamId: string; awayTeamId: string; kickoffTime: string; countryId?: string; sportId?: string }) {
  return request<{ data: { id: string } }>(context, "/matches", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

async function assignStreamToSchedulingMatch(context: { baseUrl: string }, matchId: string, channelId: string) {
  return request<{ data: unknown }>(context, `/matches/${matchId}/streams`, {
    method: "POST",
    body: JSON.stringify({ channelId })
  });
}

async function assignStreamToLegacyMatch(context: { baseUrl: string }, input: { sportName: string; competitionName: string; homeTeamName: string; awayTeamName: string; startsAt: string; channelId: string }) {
  return request<{ data: { match: { id: string }; stream: { id: string } } }>(context, "/matches/assign-stream", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

async function getAll(context: { baseUrl: string }, path: string) {
  return request<{ data: unknown }>(context, path, { method: "GET" });
}

async function deleteEntity(context: { baseUrl: string }, path: string) {
  const response = await fetch(`${context.baseUrl}${path}`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(15000)
  });

  if (response.status >= 400) {
    const body = await response.text();
    console.error(`DELETE ${path} failed ${response.status}: ${body}`);
  }

  return response.status;
}

function query<T>(queryText: string, params: string[] = []): T[] {
  const db = getDatabase();
  return db.prepare(queryText).all(...params) as T[];
}

function queryOne<T>(queryText: string, params: string[] = []) {
  const db = getDatabase();
  return db.prepare(queryText).get(...params) as T | undefined;
}

function count(table: string) {
  const row = queryOne<{ count: number }>(`SELECT COUNT(1) AS count FROM ${table}`);
  return row?.count ?? 0;
}

function orphanCount(table: string, fk: string, parentTable: string, parentKey = "id") {
  const row = queryOne<{ count: number }>(
    `SELECT COUNT(1) AS count FROM ${table} t LEFT JOIN ${parentTable} p ON t.${fk} = p.${parentKey} WHERE p.${parentKey} IS NULL`
  );
  return row?.count ?? 0;
}

function detectOrphans() {
  return {
    sportCountriesMissingSport: orphanCount("sport_countries", "sport_id", "sports"),
    sportCountriesMissingCountry: orphanCount("sport_countries", "country_id", "countries"),
    sportHostLinksMissingSport: orphanCount("sport_host_links", "sport_id", "sports"),
    sportHostLinksMissingHost: orphanCount("sport_host_links", "host_id", "countries"),
    sportClubLinksMissingSport: orphanCount("sport_club_links", "sport_id", "sports"),
    sportClubLinksMissingClub: orphanCount("sport_club_links", "club_id", "teams"),
    sportNationalTeamLinksMissingSport: orphanCount("sport_national_team_links", "sport_id", "sports"),
    sportNationalTeamLinksMissingNationalTeam: orphanCount("sport_national_team_links", "national_team_id", "teams"),
    competitionClubLinksMissingCompetition: orphanCount("competition_club_links", "competition_id", "competitions"),
    competitionClubLinksMissingClub: orphanCount("competition_club_links", "club_id", "teams"),
    competitionNationalTeamLinksMissingCompetition: orphanCount("competition_national_team_links", "competition_id", "competitions"),
    competitionNationalTeamLinksMissingNationalTeam: orphanCount("competition_national_team_links", "national_team_id", "teams"),
    hostCompetitionLinksMissingHost: orphanCount("host_competition_links", "host_id", "countries"),
    hostCompetitionLinksMissingCompetition: orphanCount("host_competition_links", "competition_id", "competitions"),
    competitionTeamsMissingCompetition: orphanCount("competition_teams", "competition_id", "competitions"),
    competitionTeamsMissingTeam: orphanCount("competition_teams", "team_id", "teams"),
    matchStreamsMissingMatch: orphanCount("match_streams", "match_id", "scheduling_matches"),
    streamsMissingMatch: orphanCount("streams", "match_id", "matches"),
    schedulingMatchesMissingCompetition: orphanCount("scheduling_matches", "competition_id", "competitions"),
    schedulingMatchesMissingHomeTeam: orphanCount("scheduling_matches", "home_team_id", "teams"),
    schedulingMatchesMissingAwayTeam: orphanCount("scheduling_matches", "away_team_id", "teams")
  };
}

function entityCountsSnapshot() {
  return {
    sports: count("sports"),
    countries: count("countries"),
    competitions: count("competitions"),
    teams: count("teams"),
    competitionTeams: count("competition_teams"),
    sportCountries: count("sport_countries"),
    sportHostLinks: count("sport_host_links"),
    sportClubLinks: count("sport_club_links"),
    sportNationalTeamLinks: count("sport_national_team_links"),
    competitionClubLinks: count("competition_club_links"),
    competitionNationalTeamLinks: count("competition_national_team_links"),
    hostCompetitionLinks: count("host_competition_links"),
    schedulingMatches: count("scheduling_matches"),
    matchStreams: count("match_streams"),
    matches: count("matches"),
    streams: count("streams"),
    providers: count("providers"),
    channels: count("channels"),
    deletionLogs: count("entity_deletion_log")
  };
}

function summarizeCounts(label: string, snapshot: ReturnType<typeof entityCountsSnapshot>) {
  return `${label}: sports=${snapshot.sports}, countries=${snapshot.countries}, competitions=${snapshot.competitions}, teams=${snapshot.teams}, competition_teams=${snapshot.competitionTeams}, scheduling_matches=${snapshot.schedulingMatches}, match_streams=${snapshot.matchStreams}, matches=${snapshot.matches}, streams=${snapshot.streams}, deletion_logs=${snapshot.deletionLogs}`;
}

async function scenarioSport(context: { baseUrl: string }, suffix: string) {
  const sport = await createSport(context, `Sport Validation ${suffix}`);
  const country = await createCountry(context, `Host Country ${suffix}`, `HC${suffix.slice(0, 2)}`, `HCO${suffix.slice(0, 3)}`);
  const competition = await createCompetition(context, sport.data.id, `Competition ${suffix}`, country.data.id);

  const homeTeam = await createTeam(context, sport.data.id, `Club Home ${suffix}`, "club", country.data.id);
  const awayTeam = await createTeam(context, sport.data.id, `Club Away ${suffix}`, "club", country.data.id);

  await assignTeam(context, competition.data.id, homeTeam.data.id);
  await assignTeam(context, competition.data.id, awayTeam.data.id);

  const provider = await createProvider(context, `Provider Sport ${suffix}`);
  await ingestPlaylist(context, provider.data.id, playlist(`ProviderSport${suffix}`));
  await activateProvider(context, provider.data.id);
  const channels = await getChannels(context, provider.data.id);
  assert(channels.data.length > 0, "Provider Sport should have agency channels.");

  const scheduleMatch = await createSchedulingMatch(context, {
    competitionId: competition.data.id,
    homeTeamId: homeTeam.data.id,
    awayTeamId: awayTeam.data.id,
    kickoffTime: new Date(Date.now() + 60_000).toISOString(),
    countryId: country.data.id,
    sportId: sport.data.id
  });

  await assignStreamToSchedulingMatch(context, scheduleMatch.data.id, channels.data[0].id);

  const legacy = await assignStreamToLegacyMatch(context, {
    sportName: `Sport Validation ${suffix}`,
    competitionName: `Competition ${suffix}`,
    homeTeamName: `Club Home ${suffix}`,
    awayTeamName: `Club Away ${suffix}`,
    startsAt: new Date(Date.now() + 120_000).toISOString(),
    channelId: channels.data[0].id
  });

  const before = entityCountsSnapshot();
  const status = await deleteEntity(context, `/sports/${sport.data.id}`);
  const after = entityCountsSnapshot();
  const orphans = detectOrphans();
  return {
    type: "sport",
    status,
    before,
    after,
    orphans,
    deletedId: sport.data.id,
    providerCountIntact: after.providers === before.providers,
    channelCountIntact: after.channels === before.channels,
    matchIntegrity: orphans.matchStreamsMissingMatch === 0 && orphans.streamsMissingMatch === 0 && orphans.schedulingMatchesMissingCompetition === 0
  };
}

async function scenarioHost(context: { baseUrl: string }, suffix: string) {
  const sport = await createSport(context, `HostSport ${suffix}`);
  const country = await createCountry(context, `Host Country ${suffix}`, `HC${suffix.slice(0, 2)}`, `HCO${suffix.slice(0, 3)}`);
  const competition = await createCompetition(context, sport.data.id, `Host Competition ${suffix}`, country.data.id);

  const homeTeam = await createTeam(context, sport.data.id, `Host Club Home ${suffix}`, "club", country.data.id);
  const awayTeam = await createTeam(context, sport.data.id, `Host Club Away ${suffix}`, "club", country.data.id);

  await assignTeam(context, competition.data.id, homeTeam.data.id);
  await assignTeam(context, competition.data.id, awayTeam.data.id);

  const provider = await createProvider(context, `Provider Host ${suffix}`);
  await ingestPlaylist(context, provider.data.id, playlist(`ProviderHost${suffix}`));
  await activateProvider(context, provider.data.id);
  const channels = await getChannels(context, provider.data.id);
  assert(channels.data.length > 0, "Provider Host should have channels.");

  const scheduleMatch = await createSchedulingMatch(context, {
    competitionId: competition.data.id,
    homeTeamId: homeTeam.data.id,
    awayTeamId: awayTeam.data.id,
    kickoffTime: new Date(Date.now() + 60_000).toISOString(),
    countryId: country.data.id,
    sportId: sport.data.id
  });

  await assignStreamToSchedulingMatch(context, scheduleMatch.data.id, channels.data[0].id);
  await assignStreamToLegacyMatch(context, {
    sportName: `HostSport ${suffix}`,
    competitionName: `Host Competition ${suffix}`,
    homeTeamName: `Host Club Home ${suffix}`,
    awayTeamName: `Host Club Away ${suffix}`,
    startsAt: new Date(Date.now() + 120_000).toISOString(),
    channelId: channels.data[0].id
  });

  const before = entityCountsSnapshot();
  const status = await deleteEntity(context, `/countries/${country.data.id}`);
  const after = entityCountsSnapshot();
  const orphans = detectOrphans();
  return {
    type: "host",
    status,
    before,
    after,
    orphans,
    deletedId: country.data.id,
    providerCountIntact: after.providers === before.providers,
    channelCountIntact: after.channels === before.channels,
    matchIntegrity: orphans.matchStreamsMissingMatch === 0 && orphans.streamsMissingMatch === 0
  };
}

async function scenarioCompetition(context: { baseUrl: string }, suffix: string) {
  const sport = await createSport(context, `CompSport ${suffix}`);
  const country = await createCountry(context, `Comp Host Country ${suffix}`, `HC${suffix.slice(0, 2)}`, `HCO${suffix.slice(0, 3)}`);
  const competition = await createCompetition(context, sport.data.id, `CompetitionToDelete ${suffix}`, country.data.id);

  const homeTeam = await createTeam(context, sport.data.id, `Comp Club Home ${suffix}`, "club", country.data.id);
  const awayTeam = await createTeam(context, sport.data.id, `Comp Club Away ${suffix}`, "club", country.data.id);

  await assignTeam(context, competition.data.id, homeTeam.data.id);
  await assignTeam(context, competition.data.id, awayTeam.data.id);

  const provider = await createProvider(context, `Provider Comp ${suffix}`);
  await ingestPlaylist(context, provider.data.id, playlist(`ProviderComp${suffix}`));
  await activateProvider(context, provider.data.id);
  const channels = await getChannels(context, provider.data.id);
  assert(channels.data.length > 0, "Provider Comp should have channels.");

  const scheduleMatch = await createSchedulingMatch(context, {
    competitionId: competition.data.id,
    homeTeamId: homeTeam.data.id,
    awayTeamId: awayTeam.data.id,
    kickoffTime: new Date(Date.now() + 60_000).toISOString(),
    countryId: country.data.id,
    sportId: sport.data.id
  });

  await assignStreamToSchedulingMatch(context, scheduleMatch.data.id, channels.data[0].id);
  await assignStreamToLegacyMatch(context, {
    sportName: `CompSport ${suffix}`,
    competitionName: `CompetitionToDelete ${suffix}`,
    homeTeamName: `Comp Club Home ${suffix}`,
    awayTeamName: `Comp Club Away ${suffix}`,
    startsAt: new Date(Date.now() + 120_000).toISOString(),
    channelId: channels.data[0].id
  });

  const before = entityCountsSnapshot();
  const status = await deleteEntity(context, `/competitions/${competition.data.id}`);
  const after = entityCountsSnapshot();
  const orphans = detectOrphans();
  return {
    type: "competition",
    status,
    before,
    after,
    orphans,
    deletedId: competition.data.id,
    providerCountIntact: after.providers === before.providers,
    channelCountIntact: after.channels === before.channels,
    matchIntegrity: orphans.matchStreamsMissingMatch === 0 && orphans.streamsMissingMatch === 0 && orphans.schedulingMatchesMissingCompetition === 0
  };
}

async function scenarioTeam(context: { baseUrl: string }, suffix: string, teamType: "club" | "national") {
  const sport = await createSport(context, `TeamSport ${suffix}`);
  const country = await createCountry(context, `Team Host Country ${suffix}`, `HC${suffix.slice(0, 2)}`, `HCO${suffix.slice(0, 3)}`);
  const competition = await createCompetition(context, sport.data.id, `Team Competition ${suffix}`, country.data.id);

  const primaryTeam = await createTeam(context, sport.data.id, `${teamType === "club" ? "Club" : "National"} Primary ${suffix}`, teamType, country.data.id);
  const counterTeam = await createTeam(context, sport.data.id, `${teamType === "club" ? "Club" : "National"} Opponent ${suffix}`, teamType, country.data.id);

  await assignTeam(context, competition.data.id, primaryTeam.data.id);
  await assignTeam(context, competition.data.id, counterTeam.data.id);

  const provider = await createProvider(context, `Provider Team ${suffix}`);
  await ingestPlaylist(context, provider.data.id, playlist(`ProviderTeam${suffix}`));
  await activateProvider(context, provider.data.id);
  const channels = await getChannels(context, provider.data.id);
  assert(channels.data.length > 0, "Provider Team should have channels.");

  const scheduleMatch = await createSchedulingMatch(context, {
    competitionId: competition.data.id,
    homeTeamId: primaryTeam.data.id,
    awayTeamId: counterTeam.data.id,
    kickoffTime: new Date(Date.now() + 60_000).toISOString(),
    countryId: country.data.id,
    sportId: sport.data.id
  });

  await assignStreamToSchedulingMatch(context, scheduleMatch.data.id, channels.data[0].id);
  await assignStreamToLegacyMatch(context, {
    sportName: `TeamSport ${suffix}`,
    competitionName: `Team Competition ${suffix}`,
    homeTeamName: `${teamType === "club" ? "Club" : "National"} Primary ${suffix}`,
    awayTeamName: `${teamType === "club" ? "Club" : "National"} Opponent ${suffix}`,
    startsAt: new Date(Date.now() + 120_000).toISOString(),
    channelId: channels.data[0].id
  });

  const before = entityCountsSnapshot();
  const status = await deleteEntity(context, `/teams/${primaryTeam.data.id}`);
  const after = entityCountsSnapshot();
  const orphans = detectOrphans();
  return {
    type: `${teamType}Team`,
    status,
    before,
    after,
    orphans,
    deletedId: primaryTeam.data.id,
    providerCountIntact: after.providers === before.providers,
    channelCountIntact: after.channels === before.channels,
    matchIntegrity: orphans.matchStreamsMissingMatch === 0 && orphans.streamsMissingMatch === 0 && orphans.schedulingMatchesMissingHomeTeam === 0 && orphans.schedulingMatchesMissingAwayTeam === 0
  };
}

async function main() {
  const appModule = await import("../apps/backend/src/app");
  const dbModule = await import("../apps/backend/src/db/connection");
  createApp = appModule.createApp;
  getDatabase = dbModule.getDatabase;

  server = http.createServer(createApp());
  const baseUrl = await listen();
  const token = await login(baseUrl);
  const context = { baseUrl };

  const results = [] as Array<Record<string, unknown>>;
  try {
    console.log("Running enforcement integrity validation...");

    results.push(await scenarioSport(context, randomSuffix()));
    results.push(await scenarioHost(context, randomSuffix()));
    results.push(await scenarioCompetition(context, randomSuffix()));
    results.push(await scenarioTeam(context, randomSuffix(), "club"));
    results.push(await scenarioTeam(context, randomSuffix(), "national"));

    const validationLog = results.map((result) => JSON.stringify(result, null, 2)).join("\n\n");
    fs.writeFileSync(path.join(workspaceRoot, "PHASE7_ENFORCEMENT_INTEGRITY_REPORT.md"), `# PHASE7 ENFORCEMENT INTEGRITY VALIDATION REPORT\n\n${validationLog}\n`);
    console.log("Validation complete. Report written to PHASE7_ENFORCEMENT_INTEGRITY_REPORT.md");
  } finally {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
