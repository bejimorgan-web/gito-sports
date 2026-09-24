import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { apiClient } from "../../services/api-client";
import { getBrowserTimeZone, localDateTimeToUtc } from "../clubs/fixture-time";
import StreamStatusPanel from "./StreamStatusPanel";
export function MatchSchedulerScreen({ selectedMatchId: externalSelectedMatchId, accessToken = "" }) {
    const [competitions, setCompetitions] = useState([]);
    const [sports, setSports] = useState([]);
    const [countries, setCountries] = useState([]);
    const [teams, setTeams] = useState([]);
    const [selectedSport, setSelectedSport] = useState("");
    const [selectedCountry, setSelectedCountry] = useState("");
    const [selectedCompetition, setSelectedCompetition] = useState("");
    const [homeTeam, setHomeTeam] = useState("");
    const [awayTeam, setAwayTeam] = useState("");
    const [kickoff, setKickoff] = useState("");
    const timeZone = getBrowserTimeZone();
    const [matches, setMatches] = useState([]);
    const [status, setStatus] = useState("Ready");
    const [selectedMatchId, setSelectedMatchId] = useState(externalSelectedMatchId);
    const [reconciliation, setReconciliation] = useState(null);
    const [reconciliationStatus, setReconciliationStatus] = useState("Not inspected");
    const load = async () => {
        try {
            const [competitionData, sportData, countryData, matchData] = await Promise.all([
                apiClient.listCompetitions(),
                apiClient.listSports(),
                apiClient.listCountries(),
                apiClient.listMatches()
            ]);
            setCompetitions(competitionData);
            setSports(sportData);
            setCountries(countryData);
            setMatches(matchData);
        }
        catch {
            setStatus("Unable to load data");
        }
    };
    useEffect(() => {
        void load();
    }, []);
    const selectedCompetitionObject = competitions.find((competition) => competition.id === selectedCompetition);
    const filteredCompetitions = competitions.filter((competition) => {
        if (selectedSport && competition.sportId !== selectedSport) {
            return false;
        }
        if (selectedCountry && competition.countryId !== selectedCountry) {
            return false;
        }
        return true;
    });
    const teamOptions = selectedCompetitionObject
        ? teams.filter((team) => selectedCompetitionObject.participantType === "nationalTeams"
            ? team.type === "national"
            : team.type === "club")
        : teams;
    useEffect(() => {
        if (!selectedCompetition) {
            setTeams([]);
            return;
        }
        void apiClient.listCompetitionTeams(selectedCompetition).then(setTeams).catch(() => setTeams([]));
    }, [selectedCompetition]);
    useEffect(() => {
        if (externalSelectedMatchId) {
            setSelectedMatchId(externalSelectedMatchId);
        }
    }, [externalSelectedMatchId]);
    const createMatch = async () => {
        if (!selectedCompetition || !homeTeam || !awayTeam || !kickoff) {
            setStatus("All fields are required");
            return;
        }
        if (homeTeam === awayTeam) {
            setStatus("Home and away must differ");
            return;
        }
        const startsAt = localDateTimeToUtc(kickoff);
        if (!startsAt) {
            setStatus("Kickoff time could not be interpreted for your timezone.");
            return;
        }
        try {
            setStatus("Creating...");
            await apiClient.createMatch({ competitionId: selectedCompetition, homeTeamId: homeTeam, awayTeamId: awayTeam, kickoffTime: startsAt });
            setStatus("Created");
            setKickoff("");
            void load();
        }
        catch (err) {
            setStatus(err instanceof Error ? err.message : "Create failed");
        }
    };
    const previewReconciliation = async () => {
        if (!accessToken) {
            setReconciliationStatus("Sign in as an administrator to inspect legacy fixture identity.");
            return;
        }
        try {
            const result = await apiClient.previewFixtureReconciliation(accessToken);
            setReconciliation(result.data);
            setReconciliationStatus("Preview loaded. No links were changed.");
        }
        catch (error) {
            setReconciliationStatus(error instanceof Error ? error.message : "Unable to load reconciliation preview.");
        }
    };
    const applyReconciliation = async () => {
        if (!accessToken)
            return;
        try {
            const result = await apiClient.applyFixtureReconciliation(accessToken);
            setReconciliation(result.data.preview);
            setReconciliationStatus(`${result.data.applied.length} high-confidence link(s) applied; ${result.data.skipped.length} skipped.`);
        }
        catch (error) {
            setReconciliationStatus(error instanceof Error ? error.message : "Unable to apply reconciliation.");
        }
    };
    return (_jsxs("section", { className: "screen-stack", children: [_jsxs("header", { className: "screen-header", children: [_jsx("p", { className: "eyebrow", children: "Matches" }), _jsx("h2", { children: "Match Scheduler" }), _jsx("span", { children: "Schedule matches using existing competitions and teams." })] }), _jsxs("div", { style: { display: "grid", gridTemplateColumns: "1fr 380px", gap: 16 }, children: [_jsxs("div", { children: [_jsxs("section", { className: "console-panel", children: [_jsxs("div", { className: "panel-heading", children: [_jsx("h3", { children: "Create Match" }), _jsx("span", { className: "status-pill", children: status })] }), _jsxs("div", { className: "hierarchy-steps", children: [_jsx("span", { children: "Sport" }), _jsx("span", { children: "Country" }), _jsx("span", { children: "Competition" }), _jsx("span", { children: "Participants" })] }), _jsxs("div", { className: "form-grid two-column", children: [_jsxs("label", { children: ["Sport", _jsxs("select", { value: selectedSport, onChange: (e) => {
                                                            setSelectedSport(e.target.value);
                                                            setSelectedCompetition("");
                                                            setHomeTeam("");
                                                            setAwayTeam("");
                                                        }, children: [_jsx("option", { value: "", children: "All sports" }), sports.map((sport) => (_jsx("option", { value: sport.id, children: sport.name }, sport.id)))] })] }), _jsxs("label", { children: ["Country", _jsxs("select", { value: selectedCountry, onChange: (e) => {
                                                            setSelectedCountry(e.target.value);
                                                            setSelectedCompetition("");
                                                            setHomeTeam("");
                                                            setAwayTeam("");
                                                        }, children: [_jsx("option", { value: "", children: "All countries" }), countries.map((country) => (_jsx("option", { value: country.id, children: country.name }, country.id)))] })] }), _jsxs("label", { children: ["Competition", _jsxs("select", { value: selectedCompetition, onChange: (e) => {
                                                            setSelectedCompetition(e.target.value);
                                                            setHomeTeam("");
                                                            setAwayTeam("");
                                                        }, children: [_jsx("option", { value: "", children: "Select competition" }), filteredCompetitions.map((c) => (_jsxs("option", { value: c.id, children: [c.name, " (", c.participantType === "clubs" ? "Clubs" : "National Teams", ")"] }, c.id)))] })] }), _jsxs("label", { children: ["Home Team", _jsxs("select", { value: homeTeam, onChange: (e) => setHomeTeam(e.target.value), children: [_jsx("option", { value: "", children: "Select home team" }), teamOptions.map((t) => (_jsx("option", { value: t.id, children: t.name }, t.id)))] })] }), _jsxs("label", { children: ["Away Team", _jsxs("select", { value: awayTeam, onChange: (e) => setAwayTeam(e.target.value), children: [_jsx("option", { value: "", children: "Select away team" }), teamOptions.map((t) => (_jsx("option", { value: t.id, children: t.name }, t.id)))] })] }), _jsxs("label", { children: ["Kickoff", _jsx("input", { type: "datetime-local", value: kickoff, onChange: (e) => setKickoff(e.target.value) }), _jsxs("small", { children: ["Timezone: ", timeZone] })] })] }), _jsx("div", { className: "button-row", children: _jsx("button", { type: "button", onClick: createMatch, children: "Create Match" }) })] }), _jsxs("section", { className: "console-panel", style: { marginTop: 16 }, children: [_jsxs("div", { className: "panel-heading", children: [_jsx("h3", { children: "Matches" }), _jsxs("span", { children: [matches.length, " matches"] })] }), _jsx("div", { className: "entity-table", children: _jsxs("table", { children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Competition" }), _jsx("th", { children: "Home" }), _jsx("th", { children: "Away" }), _jsx("th", { children: "Kickoff" }), _jsx("th", { children: "Status" }), _jsx("th", { children: "Stream" })] }) }), _jsx("tbody", { children: matches.map((m) => (_jsxs("tr", { children: [_jsx("td", { children: m.competition?.name ?? m.competitionId }), _jsx("td", { children: m.homeTeam?.name ?? m.homeTeamId }), _jsx("td", { children: m.awayTeam?.name ?? m.awayTeamId }), _jsx("td", { children: m.startsAt ?? m.kickoffTime }), _jsx("td", { children: m.status }), _jsx("td", { children: _jsx("button", { onClick: async () => {
                                                                        setSelectedMatchId(m.id);
                                                                    }, children: "Open" }) })] }, m.id))) })] }) })] }), _jsxs("section", { className: "console-panel", style: { marginTop: 16 }, children: [_jsxs("div", { className: "panel-heading", children: [_jsx("h3", { children: "Fixture identity" }), _jsx("span", { className: "status-pill", children: reconciliationStatus })] }), _jsxs("div", { className: "button-row", children: [_jsx("button", { type: "button", onClick: () => void previewReconciliation(), children: "Preview legacy links" }), reconciliation?.summary?.highConfidence > 0 ? _jsx("button", { type: "button", onClick: () => void applyReconciliation(), children: "Apply high-confidence links" }) : null] }), reconciliation?.decisions?.length === 0 ? _jsx("p", { className: "field-note", children: "No legacy scheduled fixtures require reconciliation." }) : null, reconciliation?.decisions?.map((decision) => (_jsxs("article", { className: "entity-list-item", children: [_jsx("strong", { children: decision.schedulingMatchId }), _jsxs("span", { children: [decision.linkStatus, " \u00B7 ", decision.confidence] }), _jsx("small", { children: decision.reasons.join("; ") })] }, decision.schedulingMatchId)))] })] }), _jsx("div", { children: _jsx(StreamStatusPanel, { matchId: selectedMatchId }) })] })] }));
}
