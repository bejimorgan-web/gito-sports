import { getDatabase } from "../db/connection";
import { listMatchStreamAssignments } from "../repositories/match-streams-repository";
import { validateHttpStreamUrl } from "../services/url-validation";

type AssignmentRow = Awaited<ReturnType<typeof listMatchStreamAssignments>>[0];

function providerRow(providerId: string) {
  return getDatabase()
    .prepare("SELECT id, status, availability_status, deleted FROM providers WHERE id = ?")
    .get(providerId) as { id: string; status: string; availability_status: string; deleted: number } | undefined;
}

export function getAllValidStreams(matchId: string) {
  const rows = listMatchStreamAssignments(matchId);

  const evaluated = rows.map((r) => {
    const assignment = r.assignment;
    const channel = r.channel;
    const provider = providerRow(assignment.providerId);

    const reasons: string[] = [];

    if (!assignment.isActive) reasons.push("assignment_inactive");
    if (!provider) reasons.push("provider_not_found");
    else if (provider.deleted === 1) reasons.push("provider_deleted");
    else if (provider.status !== "active") reasons.push("provider_not_active");

    if (!channel) reasons.push("channel_not_found");
    else if (channel.status !== "active") reasons.push("channel_not_active");

    const urlError = validateHttpStreamUrl(channel.url);
    if (urlError) reasons.push(urlError);

    const valid = reasons.length === 0;

    return {
      assignment,
      channel,
      provider: provider ? { id: provider.id, status: provider.status, availabilityStatus: provider.availability_status } : undefined,
      valid,
      reasons
    };
  });

  return evaluated;
}

export function resolveActiveStream(matchId: string) {
  const all = getAllValidStreams(matchId).filter((a) => a.assignment.isActive);

  const candidates = all;

  if (candidates.length === 0) return null;

  candidates.sort((l, r) => {
    if (r.assignment.priority !== l.assignment.priority) return r.assignment.priority - l.assignment.priority;
    // newest wins
    return new Date(r.assignment.createdAt).getTime() - new Date(l.assignment.createdAt).getTime();
  });

  return candidates[0];
}

export function computeStreamFailoverChain(matchId: string) {
  const all = getAllValidStreams(matchId).filter((a) => a.assignment.isActive);

  const valid = all;
  valid.sort((l, r) => {
    if (r.assignment.priority !== l.assignment.priority) return r.assignment.priority - l.assignment.priority;
    return new Date(r.assignment.createdAt).getTime() - new Date(l.assignment.createdAt).getTime();
  });

  const invalid = all.filter((a) => !a.valid);

  return { chain: valid, invalid };
}

export function detectInvalidStreams(matchId: string) {
  const all = getAllValidStreams(matchId);
  return all.filter((a) => !a.valid).map((a) => ({ assignment: a.assignment, reasons: a.reasons }));
}

export default {
  getAllValidStreams,
  resolveActiveStream,
  computeStreamFailoverChain,
  detectInvalidStreams
};
