import { useEffect, useMemo, useState } from "react";
import type { ClubDetail, Competition, Season, Team } from "@gito/shared";
import { apiClient } from "../../services/api-client";

interface Props { accessToken: string; }

export function ClubManagementScreen({ accessToken }: Props) {
  const [clubs, setClubs] = useState<Team[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<any>(null);
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [competitionId, setCompetitionId] = useState("");
  const [seasonId, setSeasonId] = useState("");
  const [status, setStatus] = useState("Ready");

  const load = async () => {
    try {
      const [clubData, competitionData] = await Promise.all([apiClient.listClubs(), apiClient.listCompetitions()]);
      setClubs(clubData); setCompetitions(competitionData);
      if (selectedId) setDetail((await apiClient.getClub(selectedId)).data);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Unable to load clubs."); }
  };
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    void apiClient.getClub(selectedId).then((result) => setDetail(result.data)).catch(() => setStatus("Unable to load club detail."));
  }, [selectedId]);
  useEffect(() => {
    if (!competitionId) { setSeasons([]); return; }
    void apiClient.listSeasons(competitionId).then(setSeasons).catch(() => setStatus("Unable to load seasons."));
  }, [competitionId]);

  const filteredFixtures = useMemo(() => {
    const fixtures = detail?.fixtures ?? [];
    return seasonId ? fixtures.filter((fixture: any) => fixture.seasonId === seasonId) : fixtures;
  }, [detail, seasonId]);

  const addMembership = async () => {
    if (!selectedId || !competitionId || !seasonId) return;
    try {
      await apiClient.addSeasonTeam(competitionId, seasonId, selectedId, accessToken);
      setStatus("Season membership added."); await load();
    } catch (error) { setStatus(error instanceof Error ? error.message : "Unable to add membership."); }
  };

  return <section className="screen-stack">
    <header className="screen-header"><p className="eyebrow">Clubs</p><h2>Club & Season Workspace</h2><span>Manage canonical clubs, memberships, fixtures, News, and live availability.</span></header>
    <section className="console-panel">
      <div className="panel-heading"><h3>Club</h3><span className="status-pill">{status}</span></div>
      <label>Club<select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}><option value="">Select club</option>{clubs.map((club) => <option key={club.id} value={club.id}>{club.name}</option>)}</select></label>
    </section>
    {detail ? <>
      <section className="console-panel">
        <div className="panel-heading"><h3>{detail.club.name}</h3><span>{detail.club.status}</span></div>
        <div className="dashboard-summary-grid"><article className="dashboard-metric-card"><span>Sport</span><strong>{detail.club.sport?.name ?? detail.club.sportId}</strong></article><article className="dashboard-metric-card"><span>Country</span><strong>{detail.club.country?.name ?? detail.club.countryId ?? "—"}</strong></article><article className="dashboard-metric-card"><span>Fixtures</span><strong>{detail.fixtures?.length ?? 0}</strong></article><article className="dashboard-metric-card"><span>News</span><strong>{detail.news?.length ?? 0}</strong></article></div>
        <p>Slug: {detail.club.slug ?? "—"} · Short name: {detail.club.shortName ?? "—"}</p>
      </section>
      <section className="console-panel"><div className="panel-heading"><h3>Competition memberships</h3></div><div className="form-grid two-column"><label>Competition<select value={competitionId} onChange={(event) => { setCompetitionId(event.target.value); setSeasonId(""); }}><option value="">Select competition</option>{competitions.filter((competition) => competition.sportId === detail.club.sportId).map((competition) => <option key={competition.id} value={competition.id}>{competition.name}</option>)}</select></label><label>Season<select value={seasonId} onChange={(event) => setSeasonId(event.target.value)}><option value="">Select season</option>{seasons.map((season) => <option key={season.id} value={season.id}>{season.name}</option>)}</select></label></div><button type="button" onClick={() => void addMembership()} disabled={!competitionId || !seasonId}>Add season membership</button><div className="entity-list">{(detail.seasons ?? []).map((season: Season) => <div className="entity-list-item" key={season.id}><strong>{season.name}</strong><span>{season.competitionId}</span></div>)}</div></section>
      <section className="console-panel"><div className="panel-heading"><h3>Fixtures & results</h3><span>{filteredFixtures.length} canonical fixtures</span></div><div className="entity-list">{filteredFixtures.map((fixture: any) => <div className="entity-list-item" key={fixture.id}><strong>{fixture.homeTeam?.name ?? fixture.homeTeamId} vs {fixture.awayTeam?.name ?? fixture.awayTeamId}</strong><span>{fixture.startsAt} · {fixture.status}</span><small>{fixture.competition?.name ?? fixture.competitionId} · {fixture.season?.name ?? fixture.seasonId ?? "No season"} · Streams: {fixture.streams?.length ?? 0}</small></div>)}</div></section>
      <section className="console-panel"><div className="panel-heading"><h3>Approved News</h3><span>{detail.news?.length ?? 0} articles</span></div><div className="entity-list">{(detail.news ?? []).map((article: any) => <div className="entity-list-item" key={article.id}><strong>{article.title}</strong><span>{article.status}</span></div>)}</div></section>
    </> : <section className="console-panel"><p>Select a canonical club to view its detail.</p></section>}
  </section>;
}
