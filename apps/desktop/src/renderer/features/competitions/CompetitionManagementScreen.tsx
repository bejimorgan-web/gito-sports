import { useState } from "react";

import type { Channel, MatchAssignmentRequest, MatchAssignmentResult } from "@gito/shared";

interface CompetitionManagementScreenProps {
  previewConfirmed: boolean;
  selectedChannel: Channel | undefined;
  onAssignMatch: (input: MatchAssignmentRequest) => Promise<MatchAssignmentResult>;
}

export function CompetitionManagementScreen({
  previewConfirmed,
  selectedChannel,
  onAssignMatch
}: CompetitionManagementScreenProps) {
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

  return (
    <section className="screen-stack">
      <header className="screen-header">
        <p className="eyebrow">Scheduling</p>
        <h2>Match Assignment</h2>
        <span>Attach match metadata to the selected IPTV channel.</span>
      </header>
      <section className="console-panel">
        <div className="panel-heading">
          <h3>Assignment Form</h3>
          <span className="status-pill">{status}</span>
        </div>
        <div className="form-grid two-column">
          <label>
            Sport
            <input value={sportName} onChange={(event) => setSportName(event.target.value)} />
          </label>
          <label>
            Competition
            <input value={competitionName} onChange={(event) => setCompetitionName(event.target.value)} />
          </label>
          <label>
            Home Team
            <input value={homeTeamName} onChange={(event) => setHomeTeamName(event.target.value)} />
          </label>
          <label>
            Away Team
            <input value={awayTeamName} onChange={(event) => setAwayTeamName(event.target.value)} />
          </label>
          <label>
            Kickoff
            <input
              type="datetime-local"
              value={startsAt}
              onChange={(event) => setStartsAt(event.target.value)}
            />
          </label>
          <label>
            IPTV Channel
            <input readOnly value={selectedChannel?.name ?? "No channel selected"} />
          </label>
        </div>
        <button type="button" disabled={!selectedChannel || !previewConfirmed} onClick={handleAssign}>
          Assign Match Stream
        </button>
      </section>
    </section>
  );
}
