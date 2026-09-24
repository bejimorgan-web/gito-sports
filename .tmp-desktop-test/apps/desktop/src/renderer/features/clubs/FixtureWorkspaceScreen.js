import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { apiClient } from "../../services/api-client";
import { formatFixtureDateTime, localDateTimeToUtc, utcToOperatorKickoff, } from "./fixture-time";
import { FootballLineupEditor } from "./FootballLineupEditor";
export function FixtureWorkspaceScreen({ accessToken, }) {
    const [competitions, setCompetitions] = useState([]);
    const [seasons, setSeasons] = useState([]);
    const [clubs, setClubs] = useState([]);
    const [fixtures, setFixtures] = useState([]);
    const [competitionId, setCompetitionId] = useState("");
    const [seasonId, setSeasonId] = useState("");
    const [teamFilterId, setTeamFilterId] = useState("");
    const [homeTeamId, setHomeTeamId] = useState("");
    const [awayTeamId, setAwayTeamId] = useState("");
    const [kickoff, setKickoff] = useState("");
    const [venueName, setVenueName] = useState("");
    const [status, setStatus] = useState("Ready");
    const [selectedFixture, setSelectedFixture] = useState(null);
    const [fixtureStreams, setFixtureStreams] = useState([]);
    const [providers, setProviders] = useState([]);
    const [channels, setChannels] = useState([]);
    const [providerId, setProviderId] = useState("");
    const [channelId, setChannelId] = useState("");
    const [deletingFixtureId, setDeletingFixtureId] = useState(null);
    const [editingFixtureId, setEditingFixtureId] = useState(null);
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
        else
            setSeasons([]);
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
            const createdFixture = await apiClient.createFixture({
                competitionId,
                seasonId,
                homeTeamId,
                awayTeamId,
                startsAt,
                venueName: venueName || null,
                status: "scheduled",
            }, accessToken);
            setStatus("Created");
            setHomeTeamId("");
            setAwayTeamId("");
            setKickoff("");
            setVenueName("");
            await loadFixtures();
            if (createdFixture?.id) {
                await openFixture(createdFixture.id);
            }
        }
        catch (error) {
            setStatus(error instanceof Error ? error.message : "Unable to create fixture.");
        }
    };
    const beginEditFixture = (fixture) => {
        setEditingFixtureId(fixture.id);
        setEditingKickoff(utcToOperatorKickoff(fixture.startsAt));
        setEditingVenue(fixture.venueName ?? "");
        setEditingStatus(fixture.status ?? "scheduled");
    };
    const saveFixture = async () => {
        if (!editingFixtureId || isSavingFixture)
            return;
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
            setStatus(editingStatus === "postponed"
                ? "Postponed"
                : editingStatus === "cancelled"
                    ? "Cancelled"
                    : "Rescheduled");
        }
        catch (error) {
            if (error instanceof Error && /fixture_in_use|streams/i.test(error.message)) {
                setStatus("Fixture cannot be deleted because streams are assigned to it.");
            }
            else {
                setStatus(error instanceof Error ? error.message : "Unable to update fixture.");
            }
        }
        finally {
            setIsSavingFixture(false);
        }
    };
    const openFixture = async (fixtureId) => {
        try {
            const [fixture, streams] = await Promise.all([
                apiClient.getFixture(fixtureId),
                apiClient.listFixtureStreams(fixtureId),
            ]);
            setSelectedFixture(fixture);
            setFixtureStreams(streams);
            setStatus("Fixture stream details loaded.");
        }
        catch (error) {
            setStatus(error instanceof Error
                ? error.message
                : "Unable to load fixture streams.");
        }
    };
    const assignStream = async () => {
        if (!selectedFixture || !channelId)
            return;
        try {
            await apiClient.assignFixtureStream(selectedFixture.id, channelId, accessToken);
            await openFixture(selectedFixture.id);
            setStatus("Canonical stream assigned.");
        }
        catch (error) {
            setStatus(error instanceof Error ? error.message : "Stream assignment failed.");
        }
    };
    const removeStream = async (streamId) => {
        if (!selectedFixture)
            return;
        try {
            await apiClient.deleteFixtureStream(selectedFixture.id, streamId, accessToken);
            await openFixture(selectedFixture.id);
            setStatus("Stream removed.");
        }
        catch (error) {
            setStatus(error instanceof Error ? error.message : "Stream removal failed.");
        }
    };
    const deleteFixture = async (fixtureId) => {
        if (deletingFixtureId || !window.confirm("Delete this fixture?"))
            return;
        setDeletingFixtureId(fixtureId);
        setStatus("Deleting...");
        try {
            await apiClient.deleteFixture(fixtureId, accessToken);
            if (selectedFixture?.id === fixtureId)
                setSelectedFixture(null);
            await loadFixtures();
            setStatus("Deleted");
        }
        catch (error) {
            if (error instanceof Error && /fixture_in_use|streams/i.test(error.message)) {
                setStatus("Fixture cannot be deleted because streams are assigned to it.");
            }
            else {
                setStatus(error instanceof Error ? error.message : "Fixture deletion failed.");
            }
        }
        finally {
            setDeletingFixtureId(null);
        }
    };
    return (_jsxs("section", { className: "screen-stack", children: [_jsxs("header", { className: "screen-header", children: [_jsx("p", { className: "eyebrow", children: "Fixtures" }), _jsx("h2", { children: "Canonical Season Fixtures" }), _jsx("span", { children: "Competition \u2192 season \u2192 canonical matches. Legacy scheduler records are preserved." })] }), _jsxs("section", { className: "console-panel", children: [_jsxs("div", { className: "panel-heading", children: [_jsx("h3", { children: "Create canonical fixture" }), _jsx("span", { className: "status-pill", children: status })] }), _jsxs("div", { className: "form-grid two-column", children: [_jsxs("label", { children: ["Competition", _jsxs("select", { value: competitionId, onChange: (event) => {
                                            setCompetitionId(event.target.value);
                                            setSeasonId("");
                                        }, children: [_jsx("option", { value: "", children: "Select competition" }), competitions.map((competition) => (_jsx("option", { value: competition.id, children: competition.name }, competition.id)))] })] }), _jsxs("label", { children: ["Season", _jsxs("select", { value: seasonId, onChange: (event) => setSeasonId(event.target.value), children: [_jsx("option", { value: "", children: "Select season" }), seasons.map((season) => (_jsx("option", { value: season.id, children: season.name }, season.id)))] })] }), _jsxs("label", { children: ["Home club", _jsxs("select", { value: homeTeamId, onChange: (event) => setHomeTeamId(event.target.value), children: [_jsx("option", { value: "", children: "Select home club" }), clubs.map((club) => (_jsx("option", { value: club.id, children: club.name }, club.id)))] })] }), _jsxs("label", { children: ["Away club", _jsxs("select", { value: awayTeamId, onChange: (event) => setAwayTeamId(event.target.value), children: [_jsx("option", { value: "", children: "Select away club" }), clubs.map((club) => (_jsx("option", { value: club.id, children: club.name }, club.id)))] })] }), _jsxs("label", { children: ["Club filter", _jsxs("select", { value: teamFilterId, onChange: (event) => setTeamFilterId(event.target.value), children: [_jsx("option", { value: "", children: "All clubs" }), clubs.map((club) => (_jsx("option", { value: club.id, children: club.name }, club.id)))] })] }), _jsxs("label", { children: ["Kickoff", _jsx("input", { value: kickoff, onChange: (event) => setKickoff(event.target.value), inputMode: "numeric", type: "datetime-local" })] }), _jsxs("label", { children: ["Venue", _jsx("input", { value: venueName, onChange: (event) => setVenueName(event.target.value) })] })] }), _jsx("button", { type: "button", onClick: () => void createFixture(), children: "Create fixture" })] }), _jsxs("section", { className: "console-panel", children: [_jsxs("div", { className: "panel-heading", children: [_jsx("h3", { children: "Canonical fixtures" }), _jsx("span", { children: fixtures.length })] }), _jsx("div", { className: "entity-list", children: fixtures.map((fixture) => (_jsxs("div", { className: "entity-list-item", children: [_jsxs("strong", { children: [fixture.homeTeam?.name ?? fixture.homeTeamId, " vs", " ", fixture.awayTeam?.name ?? fixture.awayTeamId] }), _jsxs("span", { children: [formatFixtureDateTime(fixture.startsAt), " \u00B7 ", fixture.status] }), _jsxs("small", { children: [fixture.competition?.name, " \u00B7", " ", fixture.season?.name ?? fixture.seasonId, " \u00B7 Streams:", " ", fixture.streams?.length ?? 0] }), _jsx("button", { type: "button", onClick: () => void openFixture(fixture.id), children: "Open streams" }), _jsx("button", { type: "button", onClick: () => beginEditFixture(fixture), children: "Edit fixture" }), _jsx("button", { type: "button", className: "secondary", onClick: () => void deleteFixture(fixture.id), disabled: Boolean(deletingFixtureId), children: deletingFixtureId === fixture.id ? "Deleting…" : "Delete" })] }, fixture.id))) })] }), editingFixtureId ? (_jsxs("section", { className: "console-panel", children: [_jsxs("div", { className: "panel-heading", children: [_jsx("h3", { children: "Edit / Reschedule Fixture" }), _jsx("span", { className: "status-pill", children: status })] }), _jsxs("div", { className: "form-grid two-column", children: [_jsxs("label", { children: ["Kickoff", _jsx("input", { type: "datetime-local", value: editingKickoff, onChange: (event) => setEditingKickoff(event.target.value) })] }), _jsxs("label", { children: ["Venue", _jsx("input", { value: editingVenue, onChange: (event) => setEditingVenue(event.target.value) })] }), _jsxs("label", { children: ["Status", _jsxs("select", { value: editingStatus, onChange: (event) => setEditingStatus(event.target.value), children: [_jsx("option", { value: "scheduled", children: "Scheduled" }), _jsx("option", { value: "postponed", children: "Postponed" }), _jsx("option", { value: "cancelled", children: "Cancelled" }), _jsx("option", { value: "completed", children: "Completed" })] })] })] }), _jsxs("div", { className: "button-row", children: [_jsx("button", { type: "button", onClick: () => void saveFixture(), disabled: isSavingFixture, children: isSavingFixture ? "Saving..." : "Save fixture" }), _jsx("button", { type: "button", className: "secondary", onClick: () => setEditingStatus("postponed"), disabled: isSavingFixture, children: "Postpone" }), _jsx("button", { type: "button", className: "secondary", onClick: () => {
                                    if (window.confirm("Cancel this fixture?")) {
                                        setEditingStatus("cancelled");
                                        void saveFixture();
                                    }
                                }, disabled: isSavingFixture, children: "Cancel fixture" }), _jsx("button", { type: "button", className: "secondary", onClick: () => setEditingFixtureId(null), disabled: isSavingFixture, children: "Close" })] })] })) : null, selectedFixture ? (_jsx(FootballLineupEditor, { fixture: selectedFixture, accessToken: accessToken })) : null, selectedFixture ? (_jsxs("section", { className: "console-panel", children: [_jsxs("div", { className: "panel-heading", children: [_jsx("h3", { children: "Fixture streams" }), _jsxs("span", { children: [selectedFixture.homeTeam?.name, " vs", " ", selectedFixture.awayTeam?.name] })] }), _jsxs("div", { className: "form-grid two-column", children: [_jsxs("label", { children: ["Provider", _jsxs("select", { value: providerId, onChange: (event) => {
                                            setProviderId(event.target.value);
                                            setChannelId("");
                                        }, children: [_jsx("option", { value: "", children: "Select provider" }), providers.map((provider) => (_jsx("option", { value: provider.id, children: provider.name }, provider.id)))] })] }), _jsxs("label", { children: ["Channel", _jsxs("select", { value: channelId, onChange: (event) => setChannelId(event.target.value), children: [_jsx("option", { value: "", children: "Select channel" }), channels
                                                .filter((channel) => !providerId || channel.providerId === providerId)
                                                .map((channel) => (_jsx("option", { value: channel.id, children: channel.name }, channel.id)))] })] })] }), _jsx("button", { type: "button", onClick: () => void assignStream(), disabled: !channelId, children: "Assign channel" }), fixtureStreams.length === 0 ? (_jsx("p", { children: "No streams assigned." })) : (_jsx("div", { className: "entity-list", children: fixtureStreams.map((stream) => (_jsxs("div", { className: "entity-list-item", children: [_jsx("strong", { children: stream.channelId }), _jsxs("span", { children: [stream.status, " \u00B7 ", stream.healthStatus] }), _jsx("button", { type: "button", className: "secondary", onClick: () => void removeStream(stream.id), children: "Remove" })] }, stream.id))) }))] })) : null] }));
}
