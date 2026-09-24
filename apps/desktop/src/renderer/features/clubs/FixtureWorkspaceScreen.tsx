import { useEffect, useMemo, useState } from "react";
import type { Competition, Host, Season, Sport, Team } from "@gito/shared";
import { apiClient } from "../../services/api-client";
import {
  formatFixtureDateTime,
  localDateTimeToUtc,
  utcToOperatorKickoff,
} from "./fixture-time";
import { FootballLineupEditor } from "./FootballLineupEditor";

function getParticipantLabel(participantType?: string) {
  if (participantType === "nationalTeams") return "National Team";
  return "Club";
}

export function FixtureWorkspaceScreen({
  accessToken,
}: {
  accessToken: string;
}) {
  const [sports, setSports] = useState<Sport[]>([]);
  const [hosts, setHosts] = useState<Host[]>([]);
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [participants, setParticipants] = useState<Team[]>([]);
  const [fixtures, setFixtures] = useState<any[]>([]);
  const [selectedSportId, setSelectedSportId] = useState("");
  const [selectedHostId, setSelectedHostId] = useState("");
  const [selectedCompetitionId, setSelectedCompetitionId] = useState("");
  const [selectedSeasonId, setSelectedSeasonId] = useState("");
  const [selectedParticipantId, setSelectedParticipantId] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [showCreatePanel, setShowCreatePanel] = useState(true);
  const [status, setStatus] = useState("Ready");
  const [selectedFixture, setSelectedFixture] = useState<any | null>(null);
  const [fixtureStreams, setFixtureStreams] = useState<any[]>([]);
  const [providers, setProviders] = useState<any[]>([]);
  const [channels, setChannels] = useState<any[]>([]);
  const [providerId, setProviderId] = useState("");
  const [channelId, setChannelId] = useState("");
  const [deletingFixtureId, setDeletingFixtureId] = useState<string | null>(null);
  const [editingFixtureId, setEditingFixtureId] = useState<string | null>(null);
  const [editingKickoff, setEditingKickoff] = useState("");
  const [editingVenue, setEditingVenue] = useState("");
  const [editingStatus, setEditingStatus] = useState("scheduled");
  const [isSavingFixture, setIsSavingFixture] = useState(false);
  const [createHomeTeamId, setCreateHomeTeamId] = useState("");
  const [createAwayTeamId, setCreateAwayTeamId] = useState("");
  const [createKickoff, setCreateKickoff] = useState("");
  const [createVenueName, setCreateVenueName] = useState("");

  const selectedSport = sports.find((sport) => sport.id === selectedSportId) ?? null;
  const selectedHost = hosts.find((host) => host.id === selectedHostId) ?? null;
  const selectedCompetition = competitions.find((competition) => competition.id === selectedCompetitionId) ?? null;
  const selectedSeason = seasons.find((season) => season.id === selectedSeasonId) ?? null;

  const visibleHosts = useMemo(() =>
    selectedSportId ? hosts.filter((host) => host.sportId === selectedSportId) : hosts,
  [hosts, selectedSportId]);

  const visibleCompetitions = useMemo(() =>
    competitions.filter((competition) => {
      const matchesSport = !selectedSportId || competition.sportId === selectedSportId;
      const matchesHost = !selectedHostId || competition.hostId === selectedHostId;
      return matchesSport && matchesHost;
    }),
  [competitions, selectedHostId, selectedSportId]);

  const visibleParticipants = useMemo(() => {
    if (!selectedCompetitionId) return [];
    return participants;
  }, [participants, selectedCompetitionId]);

  useEffect(() => {
    void Promise.all([
      apiClient.listSports(),
      apiClient.listCompetitions(),
      window.gito?.desktopStorage?.providerAccounts.list(),
      window.gito?.desktopStorage?.channels.list(),
    ]).then(([sportData, competitionData, providerData, channelData]) => {
      setSports(sportData);
      setCompetitions(competitionData);
      setProviders((providerData ?? []).map((provider) => ({ id: provider.id, name: provider.name })));
      setChannels((channelData ?? []).map((channel) => ({
        id: channel.id,
        providerId: channel.providerAccountId,
        name: channel.name,
      })));
    }).catch((error) => {
      setStatus(error instanceof Error ? error.message : "Unable to load sports and competitions.");
    });
  }, []);

  useEffect(() => {
    if (!selectedSportId) {
      setHosts([]);
      setSelectedHostId("");
      return;
    }
    void apiClient.listHosts(selectedSportId).then(setHosts).catch(() => setHosts([]));
  }, [selectedSportId]);

  useEffect(() => {
    if (!selectedCompetitionId) {
      setSeasons([]);
      setSelectedSeasonId("");
      return;
    }
    void apiClient.listSeasons(selectedCompetitionId).then(setSeasons).catch(() => setSeasons([]));
  }, [selectedCompetitionId]);

  useEffect(() => {
    if (!selectedCompetitionId) {
      setParticipants([]);
      setSelectedParticipantId("");
      return;
    }

    const loadParticipants = async () => {
      try {
        const competitionParticipants = await apiClient.listCompetitionTeams(selectedCompetitionId);
        if (!selectedSeasonId) {
          setParticipants(competitionParticipants);
          if (selectedParticipantId && !competitionParticipants.some((team) => team.id === selectedParticipantId)) {
            setSelectedParticipantId("");
          }
          return;
        }

        const seasonParticipants = await apiClient.listSeasonTeams(selectedCompetitionId, selectedSeasonId);
        const participantIds = new Set(seasonParticipants.map((entry) => entry.teamId));
        const nextParticipants = competitionParticipants.filter((team) => participantIds.has(team.id));
        setParticipants(nextParticipants);
        if (selectedParticipantId && !participantIds.has(selectedParticipantId)) {
          setSelectedParticipantId("");
        }
      } catch (error) {
        setParticipants([]);
        setStatus(error instanceof Error ? error.message : "Unable to load competition participants.");
      }
    };

    void loadParticipants();
  }, [selectedCompetitionId, selectedSeasonId, selectedParticipantId]);

  useEffect(() => {
    if (!selectedSportId) {
      setSelectedHostId("");
      setSelectedCompetitionId("");
      setSelectedSeasonId("");
      setSelectedParticipantId("");
      return;
    }
    setSelectedHostId((current) => current && !hosts.some((host) => host.id === current) ? "" : current);
  }, [hosts, selectedSportId]);

  useEffect(() => {
    if (selectedHostId && !visibleCompetitions.some((competition) => competition.hostId === selectedHostId)) {
      setSelectedCompetitionId("");
      setSelectedSeasonId("");
      setSelectedParticipantId("");
    }
  }, [selectedHostId, visibleCompetitions]);

  useEffect(() => {
    if (selectedCompetitionId && !seasons.some((season) => season.id === selectedSeasonId)) {
      setSelectedSeasonId("");
      setSelectedParticipantId("");
    }
  }, [seasons, selectedCompetitionId, selectedSeasonId]);

  useEffect(() => {
    if (selectedParticipantId && !participants.some((team) => team.id === selectedParticipantId)) {
      setSelectedParticipantId("");
    }
  }, [participants, selectedParticipantId]);

  const loadFixtures = async () => {
    const query: {
      sportId?: string;
      competitionId?: string;
      seasonId?: string;
      teamId?: string;
      limit: number;
    } = { limit: 200 };

    if (selectedSportId) query.sportId = selectedSportId;
    if (selectedCompetitionId) query.competitionId = selectedCompetitionId;
    if (selectedSeasonId) query.seasonId = selectedSeasonId;
    if (selectedParticipantId) query.teamId = selectedParticipantId;

    try {
      const rows = await apiClient.listFixtures(query);
      setFixtures(rows);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to load fixtures.");
    }
  };

  useEffect(() => {
    if (!selectedSportId && !selectedCompetitionId && !selectedSeasonId && !selectedParticipantId) {
      setFixtures([]);
      return;
    }
    void loadFixtures();
  }, [selectedSportId, selectedCompetitionId, selectedSeasonId, selectedParticipantId]);

  const visibleFixtures = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();
    if (!search) return fixtures;

    return fixtures.filter((fixture) => {
      const text = [
        fixture.homeTeam?.name,
        fixture.awayTeam?.name,
        fixture.competition?.name,
        fixture.season?.name,
        fixture.venueName,
        fixture.status,
        formatFixtureDateTime(fixture.startsAt),
      ].filter(Boolean).join(" ").toLowerCase();
      return text.includes(search);
    });
  }, [fixtures, searchTerm]);

  const createFixture = async () => {
    const competitionId = selectedCompetitionId || undefined;
    const seasonId = selectedSeasonId || undefined;
    const homeTeamId = createHomeTeamId || undefined;
    const awayTeamId = createAwayTeamId || undefined;

    if (!competitionId || !seasonId || !homeTeamId || !awayTeamId) {
      setStatus("Select a competition, season, home participant, and away participant.");
      return;
    }
    if (homeTeamId === awayTeamId) {
      setStatus("Home and away participants must be different.");
      return;
    }
    if (!createKickoff.trim()) {
      setStatus("Choose a kickoff date and time.");
      return;
    }

    const startsAt = localDateTimeToUtc(createKickoff);
    if (!startsAt) {
      setStatus("Kickoff time could not be interpreted for the selected timezone.");
      return;
    }

    try {
      setStatus("Creating fixture...");
      const createdFixture = await apiClient.createFixture(
        {
          competitionId,
          seasonId,
          homeTeamId,
          awayTeamId,
          startsAt,
          venueName: createVenueName || null,
          status: "scheduled",
        },
        accessToken,
      );

      setCreateHomeTeamId("");
      setCreateAwayTeamId("");
      setCreateKickoff("");
      setCreateVenueName("");
      setStatus("Fixture created.");
      await loadFixtures();
      if (createdFixture?.id) {
        await openFixture(createdFixture.id);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to create fixture.");
    }
  };

  const beginEditFixture = (fixture: any) => {
    setEditingFixtureId(fixture.id);
    setEditingKickoff(utcToOperatorKickoff(fixture.startsAt));
    setEditingVenue(fixture.venueName ?? "");
    setEditingStatus(fixture.status ?? "scheduled");
  };

  const saveFixture = async () => {
    if (!editingFixtureId || isSavingFixture) return;
    const startsAt = localDateTimeToUtc(editingKickoff);
    if (!startsAt) {
      setStatus("Kickoff time could not be interpreted for your timezone.");
      return;
    }

    setIsSavingFixture(true);
    setStatus(editingStatus === "postponed" ? "Rescheduling..." : editingStatus === "cancelled" ? "Cancelling..." : "Saving...");

    try {
      const updatedFixture = await apiClient.updateFixture(
        editingFixtureId,
        { startsAt, venueName: editingVenue || null, status: editingStatus },
        accessToken,
      );

      setEditingFixtureId(null);
      setFixtures((currentFixtures) => currentFixtures.map((fixture) => fixture.id === editingFixtureId ? { ...fixture, ...updatedFixture } : fixture));
      if (selectedFixture?.id === editingFixtureId) {
        setSelectedFixture((currentFixture: any) => (currentFixture && currentFixture.id === editingFixtureId ? { ...currentFixture, ...updatedFixture } : currentFixture));
      }
      await loadFixtures();
      if (selectedFixture?.id === editingFixtureId) {
        await openFixture(editingFixtureId);
      }
      setStatus(
        editingStatus === "postponed"
          ? "Fixture postponed."
          : editingStatus === "cancelled"
            ? "Fixture cancelled."
            : "Fixture updated.",
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to update fixture.");
    } finally {
      setIsSavingFixture(false);
    }
  };

  const openFixture = async (fixtureId: string) => {
    try {
      const [fixture, streams] = await Promise.all([
        apiClient.getFixture(fixtureId),
        apiClient.listFixtureStreams(fixtureId),
      ]);
      setSelectedFixture(fixture);
      setFixtureStreams(streams);
      setStatus("Fixture details loaded.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to load fixture details.");
    }
  };

  const assignStream = async () => {
    if (!selectedFixture || !channelId) return;
    try {
      await apiClient.assignFixtureStream(selectedFixture.id, channelId, accessToken);
      await openFixture(selectedFixture.id);
      setStatus("Canonical stream assigned.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Stream assignment failed.");
    }
  };

  const removeStream = async (streamId: string) => {
    if (!selectedFixture) return;
    try {
      await apiClient.deleteFixtureStream(selectedFixture.id, streamId, accessToken);
      await openFixture(selectedFixture.id);
      setStatus("Stream removed.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Stream removal failed.");
    }
  };

  const deleteFixture = async (fixtureId: string) => {
    if (deletingFixtureId || !window.confirm("Delete this canonical fixture?")) return;
    setDeletingFixtureId(fixtureId);
    setStatus("Deleting fixture...");
    try {
      await apiClient.deleteFixture(fixtureId, accessToken);
      setFixtures((currentFixtures) => currentFixtures.filter((fixture) => fixture.id !== fixtureId));
      if (selectedFixture?.id === fixtureId) setSelectedFixture(null);
      await loadFixtures();
      setStatus("Fixture deleted.");
    } catch (error) {
      if (error instanceof Error && /fixture_in_use|streams/i.test(error.message)) {
        setStatus("Fixture cannot be deleted because streams are assigned to it.");
      } else {
        setStatus(error instanceof Error ? error.message : "Fixture deletion failed.");
      }
    } finally {
      setDeletingFixtureId(null);
    }
  };

  const selectedParticipantLabel = selectedCompetition
    ? getParticipantLabel(selectedCompetition.participantType)
    : "Club / National Team";

  return (
    <section className="screen-stack">
      <header className="screen-header">
        <p className="eyebrow">Fixtures</p>
        <h2>Canonical Fixtures</h2>
        <span>Manage and organize canonical fixture records.</span>
      </header>

      <section className="console-panel">
        <div className="panel-heading">
          <h3>Canonical fixtures</h3>
          <div className="button-row">
            <span className="status-pill">{status}</span>
            <button type="button" onClick={() => setShowCreatePanel((value) => !value)}>
              {showCreatePanel ? "Hide form" : "+ Create canonical fixture"}
            </button>
          </div>
        </div>

        {showCreatePanel ? (
          <div className="console-panel" style={{ marginTop: 16 }}>
            <div className="panel-heading">
              <h3>Create canonical fixture</h3>
            </div>
            <div className="form-grid two-column">
              <label>
                Sport
                <select
                  value={selectedSportId}
                  onChange={(event) => {
                    const nextSportId = event.target.value;
                    setSelectedSportId(nextSportId);
                    setSelectedHostId("");
                    setSelectedCompetitionId("");
                    setSelectedSeasonId("");
                    setSelectedParticipantId("");
                  }}
                >
                  <option value="">Select sport</option>
                  {sports.map((sport) => (
                    <option key={sport.id} value={sport.id}>{sport.name}</option>
                  ))}
                </select>
              </label>

              <label>
                Host
                <select
                  value={selectedHostId}
                  onChange={(event) => {
                    const nextHostId = event.target.value;
                    setSelectedHostId(nextHostId);
                    setSelectedCompetitionId("");
                    setSelectedSeasonId("");
                    setSelectedParticipantId("");
                  }}
                  disabled={!selectedSportId}
                >
                  <option value="">Select host</option>
                  {visibleHosts.map((host) => (
                    <option key={host.id} value={host.id}>{host.name}</option>
                  ))}
                </select>
              </label>

              <label>
                Competition
                <select
                  value={selectedCompetitionId}
                  onChange={(event) => {
                    const nextCompetitionId = event.target.value;
                    setSelectedCompetitionId(nextCompetitionId);
                    setSelectedSeasonId("");
                    setSelectedParticipantId("");
                  }}
                  disabled={!selectedSportId || !selectedHostId}
                >
                  <option value="">Select competition</option>
                  {visibleCompetitions.map((competition) => (
                    <option key={competition.id} value={competition.id}>{competition.name}</option>
                  ))}
                </select>
              </label>

              <label>
                Season
                <select
                  value={selectedSeasonId}
                  onChange={(event) => {
                    const nextSeasonId = event.target.value;
                    setSelectedSeasonId(nextSeasonId);
                    setSelectedParticipantId("");
                  }}
                  disabled={!selectedCompetitionId}
                >
                  <option value="">Select season</option>
                  {seasons.map((season) => (
                    <option key={season.id} value={season.id}>{season.name}</option>
                  ))}
                </select>
              </label>

              <label>
                Home {selectedParticipantLabel}
                <select
                  value={createHomeTeamId}
                  onChange={(event) => setCreateHomeTeamId(event.target.value)}
                  disabled={!selectedCompetitionId || !selectedSeasonId}
                >
                  <option value="">Select home participant</option>
                  {participants.map((participant) => (
                    <option key={participant.id} value={participant.id}>{participant.name}</option>
                  ))}
                </select>
              </label>

              <label>
                Away {selectedParticipantLabel}
                <select
                  value={createAwayTeamId}
                  onChange={(event) => setCreateAwayTeamId(event.target.value)}
                  disabled={!selectedCompetitionId || !selectedSeasonId}
                >
                  <option value="">Select away participant</option>
                  {participants.map((participant) => (
                    <option key={participant.id} value={participant.id}>{participant.name}</option>
                  ))}
                </select>
              </label>

              <label>
                Kickoff
                <input
                  type="datetime-local"
                  value={createKickoff}
                  onChange={(event) => setCreateKickoff(event.target.value)}
                />
              </label>

              <label>
                Venue
                <input
                  value={createVenueName}
                  onChange={(event) => setCreateVenueName(event.target.value)}
                  placeholder="Venue name"
                />
              </label>
            </div>

            <div className="button-row">
              <button type="button" onClick={() => void createFixture()}>Create canonical fixture</button>
              <button type="button" className="secondary" onClick={() => {
                setCreateHomeTeamId("");
                setCreateAwayTeamId("");
                setCreateKickoff("");
                setCreateVenueName("");
              }}>
                Clear
              </button>
            </div>
          </div>
        ) : null}

        <div className="button-row" style={{ marginTop: 16 }}>
          <label className="search-field" style={{ flex: 1, minWidth: 220 }}>
            {selectedParticipantLabel}
            <select
              value={selectedParticipantId}
              onChange={(event) => setSelectedParticipantId(event.target.value)}
              disabled={!selectedCompetitionId}
            >
              <option value="">All {selectedParticipantLabel.toLowerCase()}s</option>
              {participants.map((participant) => (
                <option key={participant.id} value={participant.id}>{participant.name}</option>
              ))}
            </select>
          </label>

          <label className="search-field" style={{ flex: 1, minWidth: 220 }}>
            Search
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search fixtures"
            />
          </label>
        </div>

        <div className="entity-list" style={{ marginTop: 16 }}>
          {!selectedSportId && !selectedCompetitionId && !selectedSeasonId ? (
            <div className="entity-list-item">
              <strong>Select a sport and competition context to view saved canonical fixtures.</strong>
              <span>Use the hierarchy above to narrow the fixture list.</span>
            </div>
          ) : visibleFixtures.length === 0 ? (
            <div className="entity-list-item">
              <strong>No canonical fixtures found.</strong>
              <span>Try a different sport, host, competition, or participant filter.</span>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {visibleFixtures.map((fixture) => {
                const streamCount = Array.isArray(fixture.streams) ? fixture.streams.length : 0;
                const homeName = fixture.homeTeam?.name ?? fixture.homeTeamId ?? "Unknown home";
                const awayName = fixture.awayTeam?.name ?? fixture.awayTeamId ?? "Unknown away";
                return (
                  <div
                    key={fixture.id}
                    className="entity-list-item"
                    role="button"
                    tabIndex={0}
                    onClick={() => void openFixture(fixture.id)}
                    onDoubleClick={() => void openFixture(fixture.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        void openFixture(fixture.id);
                      }
                    }}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(140px, 1.2fr) minmax(200px, 2.1fr) minmax(150px, 1.6fr) minmax(120px, 0.9fr) minmax(90px, 0.7fr) minmax(110px, 0.8fr)",
                      gap: 12,
                      alignItems: "center",
                      cursor: "pointer",
                      padding: "12px 14px",
                      width: "100%",
                      textAlign: "left",
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 12, opacity: 0.8, textTransform: "uppercase", letterSpacing: 0.6 }}>Kickoff</div>
                      <strong>{formatFixtureDateTime(fixture.startsAt)}</strong>
                    </div>
                    <div>
                      <div style={{ fontSize: 12, opacity: 0.8, textTransform: "uppercase", letterSpacing: 0.6 }}>Fixture</div>
                      <strong>{homeName} vs {awayName}</strong>
                    </div>
                    <div>
                      <div style={{ fontSize: 12, opacity: 0.8, textTransform: "uppercase", letterSpacing: 0.6 }}>Competition</div>
                      <span>{fixture.competition?.name ?? fixture.competitionId ?? "—"}</span>
                    </div>
                    <div>
                      <div style={{ fontSize: 12, opacity: 0.8, textTransform: "uppercase", letterSpacing: 0.6 }}>Status</div>
                      <span>{fixture.status ?? "scheduled"}</span>
                    </div>
                    <div>
                      <div style={{ fontSize: 12, opacity: 0.8, textTransform: "uppercase", letterSpacing: 0.6 }}>Streams</div>
                      <span>{streamCount} assigned</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                      <button
                        type="button"
                        className="secondary"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          void deleteFixture(fixture.id);
                        }}
                        disabled={deletingFixtureId === fixture.id}
                      >
                        {deletingFixtureId === fixture.id ? "Deleting…" : "Delete"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {editingFixtureId ? (
        <section className="console-panel">
          <div className="panel-heading">
            <h3>Edit fixture</h3>
            <span className="status-pill">{status}</span>
          </div>
          <div className="form-grid two-column">
            <label>
              Kickoff
              <input type="datetime-local" value={editingKickoff} onChange={(event) => setEditingKickoff(event.target.value)} />
            </label>
            <label>
              Venue
              <input value={editingVenue} onChange={(event) => setEditingVenue(event.target.value)} />
            </label>
            <label>
              Status
              <select value={editingStatus} onChange={(event) => setEditingStatus(event.target.value)}>
                <option value="scheduled">Scheduled</option>
                <option value="postponed">Postponed</option>
                <option value="cancelled">Cancelled</option>
                <option value="completed">Completed</option>
              </select>
            </label>
          </div>
          <div className="button-row">
            <button type="button" onClick={() => void saveFixture()} disabled={isSavingFixture}>
              {isSavingFixture ? "Saving..." : "Save fixture"}
            </button>
            <button type="button" className="secondary" onClick={() => setEditingFixtureId(null)} disabled={isSavingFixture}>
              Close
            </button>
          </div>
        </section>
      ) : null}

      {selectedFixture ? (
        <div style={{ position: "fixed", inset: 0, background: "rgba(8, 12, 20, 0.7)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 50 }} onClick={() => setSelectedFixture(null)}>
          <section className="console-panel" style={{ width: "min(960px, 100%)", maxHeight: "85vh", overflowY: "auto" }} onClick={(event) => event.stopPropagation()}>
            <div className="panel-heading">
              <h3>Fixture details</h3>
              <span>{selectedFixture.status}</span>
            </div>
            <div className="dashboard-summary-grid">
              <article className="dashboard-metric-card">
                <span>Sport</span>
                <strong>{selectedSport?.name ?? selectedFixture.sport?.name ?? "—"}</strong>
              </article>
              <article className="dashboard-metric-card">
                <span>Host</span>
                <strong>{selectedHost?.name ?? "—"}</strong>
              </article>
              <article className="dashboard-metric-card">
                <span>Competition</span>
                <strong>{selectedFixture.competition?.name ?? selectedCompetition?.name ?? "—"}</strong>
              </article>
              <article className="dashboard-metric-card">
                <span>Season</span>
                <strong>{selectedFixture.season?.name ?? selectedSeason?.name ?? "—"}</strong>
              </article>
            </div>
            <p><strong>Fixture:</strong> {selectedFixture.homeTeam?.name ?? selectedFixture.homeTeamId} vs {selectedFixture.awayTeam?.name ?? selectedFixture.awayTeamId}</p>
            <p><strong>Kickoff:</strong> {formatFixtureDateTime(selectedFixture.startsAt)}</p>
            <p><strong>Venue:</strong> {selectedFixture.venueName ?? "TBD"}</p>
            <div className="button-row">
              <button type="button" onClick={() => beginEditFixture(selectedFixture)}>Edit</button>
              <button type="button" className="secondary" onClick={() => void deleteFixture(selectedFixture.id)} disabled={deletingFixtureId === selectedFixture.id}>Delete</button>
              <button type="button" className="secondary" onClick={() => setSelectedFixture(null)}>Close</button>
            </div>

            <FootballLineupEditor fixture={selectedFixture} accessToken={accessToken} />

            <section className="console-panel" style={{ marginTop: 16 }}>
              <div className="panel-heading">
                <h3>Fixture streams</h3>
                <span>{selectedFixture.homeTeam?.name} vs {selectedFixture.awayTeam?.name}</span>
              </div>
              <div className="form-grid two-column">
                <label>
                  Provider
                  <select
                    value={providerId}
                    onChange={(event) => {
                      setProviderId(event.target.value);
                      setChannelId("");
                    }}
                  >
                    <option value="">Select provider</option>
                    {providers.map((provider) => (
                      <option key={provider.id} value={provider.id}>{provider.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Channel
                  <select
                    value={channelId}
                    onChange={(event) => setChannelId(event.target.value)}
                  >
                    <option value="">Select channel</option>
                    {channels
                      .filter((channel) => !providerId || channel.providerId === providerId)
                      .map((channel) => (
                        <option key={channel.id} value={channel.id}>{channel.name}</option>
                      ))}
                  </select>
                </label>
              </div>
              <button type="button" onClick={() => void assignStream()} disabled={!channelId}>Assign channel</button>
              {fixtureStreams.length === 0 ? (
                <p>No streams assigned.</p>
              ) : (
                <div className="entity-list">
                  {fixtureStreams.map((stream) => (
                    <div className="entity-list-item" key={stream.id}>
                      <strong>{stream.channelId}</strong>
                      <span>{stream.status} · {stream.healthStatus}</span>
                      <button type="button" className="secondary" onClick={() => void removeStream(stream.id)}>Remove</button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </section>
        </div>
      ) : null}
    </section>
  );
}
