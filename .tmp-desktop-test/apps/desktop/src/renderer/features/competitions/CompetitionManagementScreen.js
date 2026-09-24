import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
export function CompetitionManagementScreen({ previewConfirmed, selectedChannel, onAssignMatch }) {
    const [sportName, setSportName] = useState("Football");
    const [competitionName, setCompetitionName] = useState("GiTO Test League");
    const [homeTeamName, setHomeTeamName] = useState("Home Club");
    const [awayTeamName, setAwayTeamName] = useState("Away Club");
    const [startsAt, setStartsAt] = useState(new Date().toISOString().slice(0, 16));
    const [status, setStatus] = useState("Ready");
    async function handleAssign() {
        if (!selectedChannel) {
            setStatus("Select an IPTV channel first.");
            return;
        }
        if (!previewConfirmed) {
            setStatus("Preview the selected channel before assignment.");
            return;
        }
        setStatus("Assigning stream...");
        await onAssignMatch({
            sportName,
            competitionName,
            homeTeamName,
            awayTeamName,
            startsAt: new Date(startsAt).toISOString(),
            channelId: selectedChannel.id
        });
        setStatus("Match stream assigned for review.");
    }
    return (_jsxs("section", { className: "screen-stack", children: [_jsxs("header", { className: "screen-header", children: [_jsx("p", { className: "eyebrow", children: "Scheduling" }), _jsx("h2", { children: "Match Assignment" }), _jsx("span", { children: "Attach match metadata to the selected IPTV channel." })] }), _jsxs("section", { className: "console-panel", children: [_jsxs("div", { className: "panel-heading", children: [_jsx("h3", { children: "Assignment Form" }), _jsx("span", { className: "status-pill", children: status })] }), _jsxs("div", { className: "form-grid two-column", children: [_jsxs("label", { children: ["Sport", _jsx("input", { value: sportName, onChange: (event) => setSportName(event.target.value) })] }), _jsxs("label", { children: ["Competition", _jsx("input", { value: competitionName, onChange: (event) => setCompetitionName(event.target.value) })] }), _jsxs("label", { children: ["Home Team", _jsx("input", { value: homeTeamName, onChange: (event) => setHomeTeamName(event.target.value) })] }), _jsxs("label", { children: ["Away Team", _jsx("input", { value: awayTeamName, onChange: (event) => setAwayTeamName(event.target.value) })] }), _jsxs("label", { children: ["Kickoff", _jsx("input", { type: "datetime-local", value: startsAt, onChange: (event) => setStartsAt(event.target.value) })] }), _jsxs("label", { children: ["IPTV Channel", _jsx("input", { readOnly: true, value: selectedChannel?.name ?? "No channel selected" })] })] }), _jsx("button", { type: "button", disabled: !selectedChannel || !previewConfirmed, onClick: handleAssign, children: "Assign Match Stream" })] })] }));
}
