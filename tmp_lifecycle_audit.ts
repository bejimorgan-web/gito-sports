import { getDatabase } from "./apps/backend/src/db/connection";
import { assignChannelToMatch, approveStream, publishStream } from "./apps/backend/src/repositories/operations-repository";

function getRow(query: string, params: any[] = []) {
  return getDatabase().prepare(query).get(...params);
}

function allRows(query: string, params: any[] = []) {
  return getDatabase().prepare(query).all(...params);
}

function log(item: string, value: unknown) {
  console.log(`${item}:`, JSON.stringify(value, null, 2));
}

function findActiveChannel() {
  return getRow(
    `SELECT c.id, c.url, c.provider_id, p.status AS provider_status, p.deleted AS provider_deleted, p.availability_status
       FROM channels c
       JOIN providers p ON p.id = c.provider_id
       WHERE c.status = 'active' AND p.status = 'active' AND p.deleted = 0
       LIMIT 1`
  );
}

function findSportId() {
  const row = getRow("SELECT id FROM sports LIMIT 1");
  return row?.id;
}

async function run() {
  const db = getDatabase();
  const channel = findActiveChannel();
  if (!channel) {
    throw new Error("No active channel/provider available for test");
  }

  const sportId = findSportId();
  if (!sportId) {
    throw new Error("No sport row available in DB");
  }

  log("selectedChannel", channel);
  log("sportId", sportId);

  const payload = {
    sportName: "Lifecycle Audit Sport",
    competitionName: "Lifecycle Audit Competition",
    homeTeamName: "Lifecycle Audit Home",
    awayTeamName: "Lifecycle Audit Away",
    startsAt: new Date().toISOString(),
    channelId: channel.id
  };

  log("assignPayload", payload);

  const assignment = assignChannelToMatch(payload as any);
  log("assignmentResponse", assignment);

  const beforeMatch = getRow("SELECT * FROM matches WHERE id = ?", [assignment.match.id]);
  const beforeStream = getRow("SELECT * FROM streams WHERE id = ?", [assignment.stream.id]);
  log("beforeMatchRow", beforeMatch);
  log("beforeStreamRow", beforeStream);

  const approved = approveStream(assignment.stream.id, "audit-operator");
  log("approveApiResponse", approved);

  const afterApproveStream = getRow("SELECT * FROM streams WHERE id = ?", [assignment.stream.id]);
  const afterApproveMatch = getRow("SELECT * FROM matches WHERE id = ?", [assignment.match.id]);
  log("afterApproveStreamRow", afterApproveStream);
  log("afterApproveMatchRow", afterApproveMatch);

  const published = publishStream(assignment.stream.id);
  log("publishApiResponse", published);

  const afterPublishStream = getRow("SELECT * FROM streams WHERE id = ?", [assignment.stream.id]);
  const afterPublishMatch = getRow("SELECT * FROM matches WHERE id = ?", [assignment.match.id]);
  log("afterPublishStreamRow", afterPublishStream);
  log("afterPublishMatchRow", afterPublishMatch);
}

run().catch((error) => {
  console.error("ERROR", error instanceof Error ? error.message : error);
  process.exit(1);
});
