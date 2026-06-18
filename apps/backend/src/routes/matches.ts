import { Router } from "express";

import type {
  CreateMatchRequest,
  MatchAssignmentRequest,
  MatchStreamAssignmentRequest,
  UpdateMatchRequest
} from "@gito/shared";
import { teamAssignedToCompetition } from "../repositories/competition-teams-repository.js";
import { MatchService } from "../services/match-service.js";
import {
  assignChannelToSchedulingMatch,
  deleteMatchStreamAssignment,
  getMatchStreamAssignmentById,
  listMatchStreamAssignments,
  updateMatchStreamAssignment
} from "../repositories/match-streams-repository.js";
import streamResolutionService from "../services/stream-resolution-service.js";

export const matchesRouter = Router();

matchesRouter.post("/assign-stream", (request, response) => {
  const body = request.body as MatchAssignmentRequest;

  if (
    !body.sportName ||
    !body.competitionName ||
    !body.homeTeamName ||
    !body.awayTeamName ||
    !body.startsAt ||
    !body.channelId
  ) {
    response.status(400).json({ error: "match_assignment_fields_required" });
    return;
  }

  response.status(201).json({
    data: MatchService.assignChannelToMatch(body)
  });
});

matchesRouter.post("/:matchId/streams", (request, response) => {
  const matchId = request.params.matchId;
  const body = request.body as MatchStreamAssignmentRequest;

  if (!body.channelId) {
    response.status(400).json({ error: "channel_id_required" });
    return;
  }

  try {
    const data = assignChannelToSchedulingMatch(matchId, body);
    response.status(201).json({ data });
  } catch (error) {
    if (error instanceof Error && "statusCode" in error) {
      const statusCode = (error as any).statusCode ?? 400;
      response.status(statusCode).json({ error: (error as any).code ?? "match_stream_assignment_failed" });
      return;
    }

    response.status(500).json({ error: "match_stream_assignment_failed" });
  }
});

matchesRouter.get("/:matchId/streams", (request, response) => {
  const matchId = request.params.matchId;
  const match = MatchService.getMatchById(matchId);

  if (!match) {
    response.status(404).json({ error: "match_not_found" });
    return;
  }

  response.json({ data: listMatchStreamAssignments(matchId) });
});

matchesRouter.patch("/:matchId/streams/:assignmentId", (request, response) => {
  const matchId = request.params.matchId;
  const assignmentId = request.params.assignmentId;
  const body = request.body as Partial<MatchStreamAssignmentRequest>;

  const assignment = getMatchStreamAssignmentById(assignmentId);
  if (!assignment || assignment.assignment.matchId !== matchId) {
    response.status(404).json({ error: "match_stream_assignment_not_found" });
    return;
  }

  const updated = updateMatchStreamAssignment(assignmentId, {
    ...(body.priority !== undefined ? { priority: body.priority } : {}),
    ...(body.isActive !== undefined ? { isActive: body.isActive } : {})
  });

  if (!updated) {
    response.status(404).json({ error: "match_stream_assignment_not_found" });
    return;
  }

  response.json({ data: { assignment: updated, channel: assignment.channel } });
});

matchesRouter.delete("/:matchId/streams/:assignmentId", (request, response) => {
  const matchId = request.params.matchId;
  const assignmentId = request.params.assignmentId;
  const assignment = getMatchStreamAssignmentById(assignmentId);

  if (!assignment || assignment.assignment.matchId !== matchId) {
    response.status(404).json({ error: "match_stream_assignment_not_found" });
    return;
  }

  const ok = deleteMatchStreamAssignment(assignmentId);
  if (!ok) {
    response.status(404).json({ error: "match_stream_assignment_not_found" });
    return;
  }

  response.status(204).send();
});

// Phase 5: Stream resolution endpoints (read-only decision logic)
matchesRouter.get("/:matchId/active-stream", (request, response) => {
  const matchId = request.params.matchId;
  const resolved = streamResolutionService.resolveActiveStream(matchId);

  if (!resolved) {
    response.status(200).json({ data: null });
    return;
  }

  response.json({ data: resolved });
});

matchesRouter.get("/:matchId/stream-options", (request, response) => {
  const matchId = request.params.matchId;
  const { chain } = streamResolutionService.computeStreamFailoverChain(matchId);

  response.json({ data: chain });
});

matchesRouter.get("/:matchId/stream-status", (request, response) => {
  const matchId = request.params.matchId;
  const active = streamResolutionService.resolveActiveStream(matchId);
  const { chain } = streamResolutionService.computeStreamFailoverChain(matchId);
  const invalids = streamResolutionService.detectInvalidStreams(matchId);

  response.json({ data: { active, fallback: chain, invalid: invalids } });
});

function isValidIsoDateTime(value: string) {
  const isoDateTimeRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
  if (!isoDateTimeRegex.test(value)) {
    return false;
  }

  const date = new Date(value);
  return !Number.isNaN(date.getTime());
}

matchesRouter.get("/", (request, response) => {
  const competitionId = typeof request.query.competitionId === "string" ? request.query.competitionId : undefined;
  response.json({ data: MatchService.listMatches(competitionId ? { competitionId } : undefined) });
});

matchesRouter.post("/", (request, response) => {
  const body = request.body as CreateMatchRequest;

  if (!body.competitionId || !body.homeTeamId || !body.awayTeamId || !body.kickoffTime) {
    response.status(400).json({ error: "competition_home_away_kickoff_required" });
    return;
  }

  if (body.homeTeamId === body.awayTeamId) {
    response.status(400).json({ error: "home_and_away_must_differ" });
    return;
  }

  if (!isValidIsoDateTime(body.kickoffTime)) {
    response.status(400).json({ error: "invalid_kickoff_time" });
    return;
  }

  if (!teamAssignedToCompetition(body.competitionId, body.homeTeamId)) {
    response.status(400).json({ error: "home_team_not_assigned_to_competition" });
    return;
  }

  if (!teamAssignedToCompetition(body.competitionId, body.awayTeamId)) {
    response.status(400).json({ error: "away_team_not_assigned_to_competition" });
    return;
  }

  const createPayload: any = {
    competitionId: body.competitionId,
    homeTeamId: body.homeTeamId,
    awayTeamId: body.awayTeamId,
    kickoffTime: body.kickoffTime
  };

  if (body.countryId) createPayload.countryId = body.countryId;
  if (body.sportId) createPayload.sportId = body.sportId;

  const match = MatchService.createMatch(createPayload);
  response.status(201).json({ data: match });
});

matchesRouter.get("/:matchId", (request, response) => {
  const match = MatchService.getMatchById(request.params.matchId);

  if (!match) {
    response.status(404).json({ error: "match_not_found" });
    return;
  }

  response.json({ data: match });
});

matchesRouter.put("/:matchId", (request, response) => {
  const body = request.body as UpdateMatchRequest;

  if (body.kickoffTime && !isValidIsoDateTime(body.kickoffTime)) {
    response.status(400).json({ error: "invalid_kickoff_time" });
    return;
  }

  const updatePayload: any = {};
  if (body.kickoffTime) updatePayload.kickoffTime = body.kickoffTime;
  if (body.status) updatePayload.status = body.status;

  const updated = MatchService.updateMatch(request.params.matchId, updatePayload);

  if (!updated) {
    response.status(404).json({ error: "match_not_found" });
    return;
  }

  response.json({ data: updated });
});

matchesRouter.delete("/:matchId", (request, response) => {
  const ok = MatchService.deleteMatch(request.params.matchId);

  if (!ok) {
    response.status(404).json({ error: "match_not_found" });
    return;
  }

  response.status(204).send();
});
