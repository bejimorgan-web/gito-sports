import { useEffect, useState } from "react";
import type { Competition, Season, Team } from "@gito/shared";
import { apiClient } from "../../services/api-client";
import {
  formatFixtureDateTime,
  localDateTimeToUtc,
  utcToOperatorKickoff,
} from "./fixture-time";
import { FootballLineupEditor } from "./FootballLineupEditor";

export function FixtureWorkspaceScreen({
  accessToken,
}: {
  accessToken: string;
}) {
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [clubs, setClubs] = useState<Team[]>([]);
  const [fixtures, setFixtures] = useState<any[]>([]);
  const [competitionId, setCompetitionId] = useState("");
  const [seasonId, setSeasonId] = useState("");
  const [teamFilterId, setTeamFilterId] = useState("");
  const [homeTeamId, setHomeTeamId] = useState("");
  const [awayTeamId, setAwayTeamId] = useState("");
  const [kickoff, setKickoff] = useState("");
  const [venueName, setVenueName] = useState("");
  const [status, setStatus] = useState("Ready");
  const [selectedFixture, setSelectedFixture] = useState<any | null>(null);
  const [fixtureStreams, setFixtureStreams] = useState<any[]>([]);
  const [providers, setProviders] = useState<any[]>([]);
  const [channels, setChannels] = useState<any[]>([]);
  const [providerId, setProviderId] = useState("");
  const [channelId, setChannelId] = useState("");
  const [deletingFixtureId, setDeletingFixtureId] = useState<string | null>(
    null,
  );
  const [editingFixtureId, setEditingFixtureId] = useState<string | null>(null);
  const [editingKickoff, setEditingKickoff] = useState("");
  const [editingVenue, setEditingVenue] = useState("");
  const [editingStatus, setEditingStatus] = useState("scheduled");
  const [isSavingFixture, setIsSavingFixture] = useState(false);

  const loadFixtures = async () => {
    if (competitionId) {
      const filters = seasonId
        ? { competitionId, seasonId, ...(teamFilterId ? { teamId: teamFilterId } : {}) }
        : { competitionId, ...(teamFilterId ? { teamId: teamFilterId } : {}) };
      setFixtures(await apiClient.listFixtures(filters));
    }
  };
  useEffect(() => {
    void Promise.all([
      apiClient.listCompetitions(),
      apiClient.listClubs(),
      apiClient.listProviders(),
      apiClient.listChannels(),
    ]).then(([competitionData, clubData, providerData, channelData]) => {
      setCompetitions(competitionData);
      setClubs(clubData);
      setProviders(providerData);
      setChannels(channelData);
    });
  }, []);
  useEffect(() => {
    if (competitionId)
      void apiClient.listSeasons(competitionId).then(setSeasons);
    else setSeasons([]);
  }, [competitionId]);
  useEffect(() => {
    void loadFixtures();
  }, [competitionId, seasonId, teamFilterId]);

  const createFixture = async () => {
    if (!kickoff.trim()) {
      setStatus("Choose a kickoff date and time.");
      return;
    }
    const startsAt = localDateTimeToUtc(kickoff);
    if (!startsAt) {
      setStatus("Kickoff time could not be interpreted for the selected timezone.");
      return;
    }
    if (!competitionId || !seasonId || !homeTeamId || !awayTeamId) {
      setStatus("Competition, season, home club, and away club are required.");
      return;
    }
    if (homeTeamId === awayTeamId) {
      setStatus("Home and away clubs must be different.");
      return;
    }
    try {
      setStatus("Creating...");
      const createdFixture = await apiClient.createFixture(
        {
          competitionId,
          seasonId,
          homeTeamId,
          awayTeamId,
          startsAt,
          venueName: venueName || null,
          status: "scheduled",
        },
        accessToken,
      );
      setStatus("Created");
      setHomeTeamId("");
      setAwayTeamId("");
      setKickoff("");
      setVenueName("");
      await loadFixtures();
      if (createdFixture?.id) {
        await openFixture(createdFixture.id);
      }
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Unable to create fixture.",
      );
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
      await apiClient.updateFixture(editingFixtureId, { startsAt, venueName: editingVenue || null, status: editingStatus }, accessToken);
      setEditingFixtureId(null);
      await loadFixtures();
      await openFixture(editingFixtureId);
      setStatus(
        editingStatus === "postponed"
          ? "Postponed"
          : editingStatus === "cancelled"
            ? "Cancelled"
            : "Rescheduled",
      );
    } catch (error) {
      if (error instanceof Error && /fixture_in_use|streams/i.test(error.message)) {
        setStatus("Fixture cannot be deleted because streams are assigned to it.");
      } else {
        setStatus(error instanceof Error ? error.message : "Unable to update fixture.");
      }
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
      setStatus("Fixture stream details loaded.");
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "Unable to load fixture streams.",
      );
    }
  };

  const assignStream = async () => {
    if (!selectedFixture || !channelId) return;
    try {
      await apiClient.assignFixtureStream(
        selectedFixture.id,
        channelId,
        accessToken,
      );
      await openFixture(selectedFixture.id);
      setStatus("Canonical stream assigned.");
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Stream assignment failed.",
      );
    }
  };

  const removeStream = async (streamId: string) => {
    if (!selectedFixture) return;
    try {
      await apiClient.deleteFixtureStream(
        selectedFixture.id,
        streamId,
        accessToken,
      );
      await openFixture(selectedFixture.id);
      setStatus("Stream removed.");
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Stream removal failed.",
      );
    }
  };

  const deleteFixture = async (fixtureId: string) => {
    if (deletingFixtureId || !window.confirm("Delete this fixture?")) return;
    setDeletingFixtureId(fixtureId);
    setStatus("Deleting...");
    try {
      await apiClient.deleteFixture(fixtureId, accessToken);
      if (selectedFixture?.id === fixtureId) setSelectedFixture(null);
      await loadFixtures();
      setStatus("Deleted");
    } catch (error) {
      if (error instanceof Error && /fixture_in_use|streams/i.test(error.message)) {
        setStatus("Fixture cannot be deleted because streams are assigned to it.");
      } else {
        setStatus(
          error instanceof Error ? error.message : "Fixture deletion failed.",
        );
      }
    } finally {
      setDeletingFixtureId(null);
    }
  };

  return (
    <section className="screen-stack">
      <header className="screen-header">
        <p className="eyebrow">Fixtures</p>
        <h2>Canonical Season Fixtures</h2>
        <span>
          Competition → season → canonical matches. Legacy scheduler records are
          preserved.
        </span>
      </header>
      <section className="console-panel">
        <div className="panel-heading">
          <h3>Create canonical fixture</h3>
          <span className="status-pill">{status}</span>
        </div>
        <div className="form-grid two-column">
          <label>
            Competition
            <select
              value={competitionId}
              onChange={(event) => {
                setCompetitionId(event.target.value);
                setSeasonId("");
              }}
            >
              <option value="">Select competition</option>
              {competitions.map((competition) => (
                <option key={competition.id} value={competition.id}>
                  {competition.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Season
            <select
              value={seasonId}
              onChange={(event) => setSeasonId(event.target.value)}
            >
              <option value="">Select season</option>
              {seasons.map((season) => (
                <option key={season.id} value={season.id}>
                  {season.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Home club
            <select
              value={homeTeamId}
              onChange={(event) => setHomeTeamId(event.target.value)}
            >
              <option value="">Select home club</option>
              {clubs.map((club) => (
                <option key={club.id} value={club.id}>
                  {club.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Away club
            <select
              value={awayTeamId}
              onChange={(event) => setAwayTeamId(event.target.value)}
            >
              <option value="">Select away club</option>
              {clubs.map((club) => (
                <option key={club.id} value={club.id}>
                  {club.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Club filter
            <select value={teamFilterId} onChange={(event) => setTeamFilterId(event.target.value)}>
              <option value="">All clubs</option>
              {clubs.map((club) => (
                <option key={club.id} value={club.id}>{club.name}</option>
              ))}
            </select>
          </label>
          <label>
            Kickoff
            <input
              value={kickoff}
              onChange={(event) => setKickoff(event.target.value)}
              inputMode="numeric"
              type="datetime-local"
            />
          </label>
          <label>
            Venue
            <input
              value={venueName}
              onChange={(event) => setVenueName(event.target.value)}
            />
          </label>
        </div>
        <button type="button" onClick={() => void createFixture()}>
          Create fixture
        </button>
      </section>
      <section className="console-panel">
        <div className="panel-heading">
          <h3>Canonical fixtures</h3>
          <span>{fixtures.length}</span>
        </div>
        <div className="entity-list">
          {fixtures.map((fixture) => (
            <div className="entity-list-item" key={fixture.id}>
              <strong>
                {fixture.homeTeam?.name ?? fixture.homeTeamId} vs{" "}
                {fixture.awayTeam?.name ?? fixture.awayTeamId}
              </strong>
              <span>
                {formatFixtureDateTime(fixture.startsAt)} · {fixture.status}
              </span>
              <small>
                {fixture.competition?.name} ·{" "}
                {fixture.season?.name ?? fixture.seasonId} · Streams:{" "}
                {fixture.streams?.length ?? 0}
              </small>
              <button
                type="button"
                onClick={() => void openFixture(fixture.id)}
              >
                Open streams
              </button>
              <button type="button" onClick={() => beginEditFixture(fixture)}>
                Edit fixture
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => void deleteFixture(fixture.id)}
                disabled={Boolean(deletingFixtureId)}
              >
                {deletingFixtureId === fixture.id ? "Deleting…" : "Delete"}
              </button>
            </div>
          ))}
        </div>
      </section>
      {editingFixtureId ? (
        <section className="console-panel">
          <div className="panel-heading">
            <h3>Edit / Reschedule Fixture</h3>
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
            <button type="button" className="secondary" onClick={() => setEditingStatus("postponed")} disabled={isSavingFixture}>
              Postpone
            </button>
            <button type="button" className="secondary" onClick={() => {
              if (window.confirm("Cancel this fixture?")) {
                setEditingStatus("cancelled");
                void saveFixture();
              }
            }} disabled={isSavingFixture}>
              Cancel fixture
            </button>
            <button type="button" className="secondary" onClick={() => setEditingFixtureId(null)} disabled={isSavingFixture}>
              Close
            </button>
          </div>
        </section>
      ) : null}
      {selectedFixture ? (
        <FootballLineupEditor fixture={selectedFixture} accessToken={accessToken} />
      ) : null}
      {selectedFixture ? (
        <section className="console-panel">
          <div className="panel-heading">
            <h3>Fixture streams</h3>
            <span>
              {selectedFixture.homeTeam?.name} vs{" "}
              {selectedFixture.awayTeam?.name}
            </span>
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
                  <option key={provider.id} value={provider.id}>
                    {provider.name}
                  </option>
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
                  .filter(
                    (channel) =>
                      !providerId || channel.providerId === providerId,
                  )
                  .map((channel) => (
                    <option key={channel.id} value={channel.id}>
                      {channel.name}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <button
            type="button"
            onClick={() => void assignStream()}
            disabled={!channelId}
          >
            Assign channel
          </button>
          {fixtureStreams.length === 0 ? (
            <p>No streams assigned.</p>
          ) : (
            <div className="entity-list">
              {fixtureStreams.map((stream) => (
                <div className="entity-list-item" key={stream.id}>
                  <strong>{stream.channelId}</strong>
                  <span>
                    {stream.status} · {stream.healthStatus}
                  </span>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => void removeStream(stream.id)}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}
    </section>
  );
}
