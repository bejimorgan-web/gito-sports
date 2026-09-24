import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from "react";
import { apiClient } from "../../services/api-client";
export function ClubManagementScreen({ accessToken }) {
    const [clubs, setClubs] = useState([]);
    const [selectedId, setSelectedId] = useState("");
    const [detail, setDetail] = useState(null);
    const [competitions, setCompetitions] = useState([]);
    const [seasons, setSeasons] = useState([]);
    const [competitionId, setCompetitionId] = useState("");
    const [seasonId, setSeasonId] = useState("");
    const [status, setStatus] = useState("Ready");
    const load = async () => {
        try {
            const [clubData, competitionData] = await Promise.all([apiClient.listClubs(), apiClient.listCompetitions()]);
            setClubs(clubData);
            setCompetitions(competitionData);
            if (selectedId)
                setDetail((await apiClient.getClub(selectedId)).data);
        }
        catch (error) {
            setStatus(error instanceof Error ? error.message : "Unable to load clubs.");
        }
    };
    useEffect(() => { void load(); }, []);
    useEffect(() => {
        if (!selectedId) {
            setDetail(null);
            return;
        }
        void apiClient.getClub(selectedId).then((result) => setDetail(result.data)).catch(() => setStatus("Unable to load club detail."));
    }, [selectedId]);
    useEffect(() => {
        if (!competitionId) {
            setSeasons([]);
            return;
        }
        void apiClient.listSeasons(competitionId).then(setSeasons).catch(() => setStatus("Unable to load seasons."));
    }, [competitionId]);
    const filteredFixtures = useMemo(() => {
        const fixtures = detail?.fixtures ?? [];
        return seasonId ? fixtures.filter((fixture) => fixture.seasonId === seasonId) : fixtures;
    }, [detail, seasonId]);
    const addMembership = async () => {
        if (!selectedId || !competitionId || !seasonId)
            return;
        try {
            await apiClient.addSeasonTeam(competitionId, seasonId, selectedId, accessToken);
            setStatus("Season membership added.");
            await load();
        }
        catch (error) {
            setStatus(error instanceof Error ? error.message : "Unable to add membership.");
        }
    };
    return _jsxs("section", { className: "screen-stack", children: [_jsxs("header", { className: "screen-header", children: [_jsx("p", { className: "eyebrow", children: "Clubs" }), _jsx("h2", { children: "Club & Season Workspace" }), _jsx("span", { children: "Manage canonical clubs, memberships, fixtures, News, and live availability." })] }), _jsxs("section", { className: "console-panel", children: [_jsxs("div", { className: "panel-heading", children: [_jsx("h3", { children: "Club" }), _jsx("span", { className: "status-pill", children: status })] }), _jsxs("label", { children: ["Club", _jsxs("select", { value: selectedId, onChange: (event) => setSelectedId(event.target.value), children: [_jsx("option", { value: "", children: "Select club" }), clubs.map((club) => _jsx("option", { value: club.id, children: club.name }, club.id))] })] })] }), detail ? _jsxs(_Fragment, { children: [_jsxs("section", { className: "console-panel", children: [_jsxs("div", { className: "panel-heading", children: [_jsx("h3", { children: detail.club.name }), _jsx("span", { children: detail.club.status })] }), _jsxs("div", { className: "dashboard-summary-grid", children: [_jsxs("article", { className: "dashboard-metric-card", children: [_jsx("span", { children: "Sport" }), _jsx("strong", { children: detail.club.sport?.name ?? detail.club.sportId })] }), _jsxs("article", { className: "dashboard-metric-card", children: [_jsx("span", { children: "Country" }), _jsx("strong", { children: detail.club.country?.name ?? detail.club.countryId ?? "—" })] }), _jsxs("article", { className: "dashboard-metric-card", children: [_jsx("span", { children: "Fixtures" }), _jsx("strong", { children: detail.fixtures?.length ?? 0 })] }), _jsxs("article", { className: "dashboard-metric-card", children: [_jsx("span", { children: "News" }), _jsx("strong", { children: detail.news?.length ?? 0 })] })] }), _jsxs("p", { children: ["Slug: ", detail.club.slug ?? "—", " \u00B7 Short name: ", detail.club.shortName ?? "—"] })] }), _jsxs("section", { className: "console-panel", children: [_jsx("div", { className: "panel-heading", children: _jsx("h3", { children: "Competition memberships" }) }), _jsxs("div", { className: "form-grid two-column", children: [_jsxs("label", { children: ["Competition", _jsxs("select", { value: competitionId, onChange: (event) => { setCompetitionId(event.target.value); setSeasonId(""); }, children: [_jsx("option", { value: "", children: "Select competition" }), competitions.filter((competition) => competition.sportId === detail.club.sportId).map((competition) => _jsx("option", { value: competition.id, children: competition.name }, competition.id))] })] }), _jsxs("label", { children: ["Season", _jsxs("select", { value: seasonId, onChange: (event) => setSeasonId(event.target.value), children: [_jsx("option", { value: "", children: "Select season" }), seasons.map((season) => _jsx("option", { value: season.id, children: season.name }, season.id))] })] })] }), _jsx("button", { type: "button", onClick: () => void addMembership(), disabled: !competitionId || !seasonId, children: "Add season membership" }), _jsx("div", { className: "entity-list", children: (detail.seasons ?? []).map((season) => _jsxs("div", { className: "entity-list-item", children: [_jsx("strong", { children: season.name }), _jsx("span", { children: season.competitionId })] }, season.id)) })] }), _jsxs("section", { className: "console-panel", children: [_jsxs("div", { className: "panel-heading", children: [_jsx("h3", { children: "Fixtures & results" }), _jsxs("span", { children: [filteredFixtures.length, " canonical fixtures"] })] }), _jsx("div", { className: "entity-list", children: filteredFixtures.map((fixture) => _jsxs("div", { className: "entity-list-item", children: [_jsxs("strong", { children: [fixture.homeTeam?.name ?? fixture.homeTeamId, " vs ", fixture.awayTeam?.name ?? fixture.awayTeamId] }), _jsxs("span", { children: [fixture.startsAt, " \u00B7 ", fixture.status] }), _jsxs("small", { children: [fixture.competition?.name ?? fixture.competitionId, " \u00B7 ", fixture.season?.name ?? fixture.seasonId ?? "No season", " \u00B7 Streams: ", fixture.streams?.length ?? 0] })] }, fixture.id)) })] }), _jsxs("section", { className: "console-panel", children: [_jsxs("div", { className: "panel-heading", children: [_jsx("h3", { children: "Approved News" }), _jsxs("span", { children: [detail.news?.length ?? 0, " articles"] })] }), _jsx("div", { className: "entity-list", children: (detail.news ?? []).map((article) => _jsxs("div", { className: "entity-list-item", children: [_jsx("strong", { children: article.title }), _jsx("span", { children: article.status })] }, article.id)) })] })] }) : _jsx("section", { className: "console-panel", children: _jsx("p", { children: "Select a canonical club to view its detail." }) })] });
}
