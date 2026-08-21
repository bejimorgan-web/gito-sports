import { useEffect, useState } from "react";
import type { Competition, Season, Team } from "@gito/shared";
import { apiClient } from "../../services/api-client";

export function FixtureWorkspaceScreen({ accessToken }: { accessToken: string }) {
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [clubs, setClubs] = useState<Team[]>([]);
  const [fixtures, setFixtures] = useState<any[]>([]);
  const [competitionId, setCompetitionId] = useState("");
  const [seasonId, setSeasonId] = useState("");
  const [homeTeamId, setHomeTeamId] = useState("");
  const [awayTeamId, setAwayTeamId] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [venueName, setVenueName] = useState("");
  const [status, setStatus] = useState("Ready");
  const [selectedFixture, setSelectedFixture] = useState<any | null>(null);
  const [fixtureStreams, setFixtureStreams] = useState<any[]>([]);
  const [providers, setProviders] = useState<any[]>([]);
  const [channels, setChannels] = useState<any[]>([]);
  const [providerId, setProviderId] = useState("");
  const [channelId, setChannelId] = useState("");
  const [deletingFixtureId, setDeletingFixtureId] = useState<string | null>(null);

  const loadFixtures = async () => { if (competitionId) { const filters = seasonId ? { competitionId, seasonId } : { competitionId }; setFixtures(await apiClient.listFixtures(filters)); } };
  useEffect(() => { void Promise.all([apiClient.listCompetitions(), apiClient.listClubs(), apiClient.listProviders(), apiClient.listChannels()]).then(([competitionData, clubData, providerData, channelData]) => { setCompetitions(competitionData); setClubs(clubData); setProviders(providerData); setChannels(channelData); }); }, []);
  useEffect(() => { if (competitionId) void apiClient.listSeasons(competitionId).then(setSeasons); else setSeasons([]); }, [competitionId]);
  useEffect(() => { void loadFixtures(); }, [competitionId, seasonId]);

  const createFixture = async () => {
    if (!competitionId || !seasonId || !homeTeamId || !awayTeamId || !startsAt) { setStatus("Competition, season, clubs, and kickoff are required."); return; }
    try { await apiClient.createFixture({ competitionId, seasonId, homeTeamId, awayTeamId, startsAt, venueName: venueName || null, status: "scheduled" }, accessToken); setStatus("Canonical fixture created."); setHomeTeamId(""); setAwayTeamId(""); setStartsAt(""); setVenueName(""); await loadFixtures(); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Unable to create fixture."); }
  };

  const openFixture = async (fixtureId: string) => {
    try {
      const [fixture, streams] = await Promise.all([apiClient.getFixture(fixtureId), apiClient.listFixtureStreams(fixtureId)]);
      setSelectedFixture(fixture);
      setFixtureStreams(streams);
      setStatus("Fixture stream details loaded.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Unable to load fixture streams."); }
  };

  const assignStream = async () => {
    if (!selectedFixture || !channelId) return;
    try { await apiClient.assignFixtureStream(selectedFixture.id, channelId, accessToken); await openFixture(selectedFixture.id); setStatus("Canonical stream assigned."); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Stream assignment failed."); }
  };

  const removeStream = async (streamId: string) => {
    if (!selectedFixture) return;
    try { await apiClient.deleteFixtureStream(selectedFixture.id, streamId, accessToken); await openFixture(selectedFixture.id); setStatus("Stream removed."); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Stream removal failed."); }
  };

  const deleteFixture = async (fixtureId: string) => {
    if (deletingFixtureId || !window.confirm("Delete this fixture?")) return;
    setDeletingFixtureId(fixtureId);
    setStatus("Deleting…");
    try {
      await apiClient.deleteFixture(fixtureId, accessToken);
      if (selectedFixture?.id === fixtureId) setSelectedFixture(null);
      await loadFixtures();
      setStatus("Fixture deleted.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Fixture deletion failed.");
    } finally {
      setDeletingFixtureId(null);
    }
  };

  return <section className="screen-stack"><header className="screen-header"><p className="eyebrow">Fixtures</p><h2>Canonical Season Fixtures</h2><span>Competition → season → canonical matches. Legacy scheduler records are preserved.</span></header><section className="console-panel"><div className="panel-heading"><h3>Create canonical fixture</h3><span className="status-pill">{status}</span></div><div className="form-grid two-column"><label>Competition<select value={competitionId} onChange={(event) => { setCompetitionId(event.target.value); setSeasonId(""); }}><option value="">Select competition</option>{competitions.map((competition) => <option key={competition.id} value={competition.id}>{competition.name}</option>)}</select></label><label>Season<select value={seasonId} onChange={(event) => setSeasonId(event.target.value)}><option value="">Select season</option>{seasons.map((season) => <option key={season.id} value={season.id}>{season.name}</option>)}</select></label><label>Home club<select value={homeTeamId} onChange={(event) => setHomeTeamId(event.target.value)}><option value="">Select home club</option>{clubs.map((club) => <option key={club.id} value={club.id}>{club.name}</option>)}</select></label><label>Away club<select value={awayTeamId} onChange={(event) => setAwayTeamId(event.target.value)}><option value="">Select away club</option>{clubs.map((club) => <option key={club.id} value={club.id}>{club.name}</option>)}</select></label><label>Kickoff<input value={startsAt} onChange={(event) => setStartsAt(event.target.value)} placeholder="2026-08-20T15:00:00Z" /></label><label>Venue<input value={venueName} onChange={(event) => setVenueName(event.target.value)} /></label></div><button type="button" onClick={() => void createFixture()}>Create fixture</button></section><section className="console-panel"><div className="panel-heading"><h3>Canonical fixtures</h3><span>{fixtures.length}</span></div><div className="entity-list">{fixtures.map((fixture) => <div className="entity-list-item" key={fixture.id}><strong>{fixture.homeTeam?.name ?? fixture.homeTeamId} vs {fixture.awayTeam?.name ?? fixture.awayTeamId}</strong><span>{fixture.startsAt} · {fixture.status}</span><small>{fixture.competition?.name} · {fixture.season?.name ?? fixture.seasonId} · Streams: {fixture.streams?.length ?? 0}</small><button type="button" onClick={() => void openFixture(fixture.id)}>Open streams</button></div>)}</div></section>{selectedFixture ? <section className="console-panel"><div className="panel-heading"><h3>Fixture streams</h3><span>{selectedFixture.homeTeam?.name} vs {selectedFixture.awayTeam?.name}</span></div><div className="form-grid two-column"><label>Provider<select value={providerId} onChange={(event) => { setProviderId(event.target.value); setChannelId(""); }}><option value="">Select provider</option>{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select></label><label>Channel<select value={channelId} onChange={(event) => setChannelId(event.target.value)}><option value="">Select channel</option>{channels.filter((channel) => !providerId || channel.providerId === providerId).map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></label></div><button type="button" onClick={() => void assignStream()} disabled={!channelId}>Assign channel</button>{fixtureStreams.length === 0 ? <p>No streams assigned.</p> : <div className="entity-list">{fixtureStreams.map((stream) => <div className="entity-list-item" key={stream.id}><strong>{stream.channelId}</strong><span>{stream.status} · {stream.healthStatus}</span><button type="button" className="secondary" onClick={() => void removeStream(stream.id)}>Remove</button></div>)}</div>}</section> : null}</section>;
}
