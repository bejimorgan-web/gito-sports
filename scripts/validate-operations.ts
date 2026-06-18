import fs from "node:fs";
import http from "node:http";
import path from "node:path";

import type { Channel, IPTVProvider, MatchAssignmentResult, PublishedLiveMatch, Stream } from "@gito/shared";

const workspaceRoot = process.cwd();
const validationDataDir = path.resolve(workspaceRoot, "data");
const validationDatabasePath = path.join(validationDataDir, `production-validation-${Date.now()}.sqlite`);
const requestTimeoutMs = 15_000;

if (!validationDatabasePath.startsWith(validationDataDir)) {
  throw new Error("Validation database path escaped the workspace data directory.");
}

fs.mkdirSync(validationDataDir, { recursive: true });
process.env.DATABASE_PATH = validationDatabasePath;
process.env.JWT_SECRET = "production-validation-secret";

interface ApiResponse<T> {
  data: T;
}

interface ValidationContext {
  baseUrl: string;
  token: string;
}

let server: http.Server | undefined;

function listen(): Promise<string> {
  return new Promise((resolve) => {
    if (!server) {
      throw new Error("Validation server was not initialized.");
    }

    server.listen(0, "127.0.0.1", () => {
      const address = server.address();

      if (!address || typeof address === "string") {
        throw new Error("Validation server did not bind to a TCP address.");
      }

      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

async function request<T>(
  context: Pick<ValidationContext, "baseUrl">,
  pathName: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(`${context.baseUrl}${pathName}`, {
    ...init,
    signal: AbortSignal.timeout(requestTimeoutMs),
    headers: {
      "content-type": "application/json",
      ...init?.headers
    }
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string; message?: string };
    throw new Error(body.error ?? body.message ?? `Request failed with status ${response.status}`);
  }

  const body = await response.json() as ApiResponse<T>;
  return body.data;
}

async function requestFailure(
  context: Pick<ValidationContext, "baseUrl">,
  pathName: string,
  init: RequestInit,
  expectedStatus: number,
  expectedError: string
) {
  const response = await fetch(`${context.baseUrl}${pathName}`, {
    ...init,
    signal: AbortSignal.timeout(requestTimeoutMs),
    headers: {
      "content-type": "application/json",
      ...init.headers
    }
  });
  const body = await response.json().catch(() => ({})) as { error?: string };

  assert(
    response.status === expectedStatus,
    `${pathName} expected ${expectedStatus}, received ${response.status}`
  );
  assert(body.error === expectedError, `${pathName} expected ${expectedError}, received ${body.error ?? "none"}`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function createProvider(context: ValidationContext, name: string) {
  return request<IPTVProvider>(context, "/iptv/providers", {
    method: "POST",
    body: JSON.stringify({
      name,
      baseUrl: "https://provider.example/live",
      type: "m3u",
      authType: "none"
    })
  });
}

function playlistFor(name: string, count: number) {
  const lines = ["#EXTM3U"];

  for (let index = 1; index <= count; index += 1) {
    lines.push(`#EXTINF:-1 tvg-id="${name}-${index}" group-title="Validation",${name} Channel ${index}`);
    lines.push(`https://streams.example/${name.toLowerCase()}-${index}.m3u8`);
  }

  return lines.join("\n");
}

async function ingestChannels(context: ValidationContext, providerId: string, count: number, name = "Validation") {
  await request<{ channelsCreated: number; categories: string[] }>(
    context,
    `/iptv/providers/${providerId}/m3u`,
    {
      method: "POST",
      body: JSON.stringify({ playlist: playlistFor(name, count) })
    }
  );

  return request<Channel[]>(context, `/iptv/channels?providerId=${encodeURIComponent(providerId)}`);
}

async function assignApprovePublish(
  context: ValidationContext,
  channelId: string,
  label: string
): Promise<MatchAssignmentResult> {
  const assignment = await request<MatchAssignmentResult>(context, "/matches/assign-stream", {
    method: "POST",
    body: JSON.stringify({
      sportName: "Football",
      competitionName: "Production Validation League",
      homeTeamName: `${label} Home`,
      awayTeamName: `${label} Away`,
      startsAt: new Date(Date.now() + 60_000).toISOString(),
      channelId
    })
  });

  const approvedStream = await request<Stream>(context, `/streams/${assignment.stream.id}/approve`, {
    method: "POST",
    headers: { authorization: `Bearer ${context.token}` }
  });

  assert(approvedStream.status === "approved", "Approved stream did not enter approved state.");

  const activeStream = await request<Stream>(context, `/streams/${assignment.stream.id}/publish`, {
    method: "POST",
    headers: { authorization: `Bearer ${context.token}` }
  });

  assert(activeStream.status === "active", "Published stream did not enter active state.");

  return {
    ...assignment,
    match: { ...assignment.match, status: "published" },
    stream: activeStream
  };
}

async function login(baseUrl: string) {
  const session = await request<{ accessToken: string }>({ baseUrl }, "/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "operator@gito.local" })
  });

  return session.accessToken;
}

async function validateFullFlow(context: ValidationContext) {
  const provider = await createProvider(context, "Phase 9 Full Flow Provider");
  const channels = await ingestChannels(context, provider.id, 1, "FullFlow");
  assert(channels.length === 1, "M3U ingestion did not create the expected channel.");

  const assignment = await assignApprovePublish(context, channels[0].id, "Full Flow");
  const liveMatches = await request<PublishedLiveMatch[]>(context, "/mobile/matches/live");

  assert(liveMatches.some((entry) => entry.stream.id === assignment.stream.id), "Published stream missing from mobile feed.");
}

async function validatePrematurePublishBlocked(context: ValidationContext) {
  const provider = await createProvider(context, "Phase 9 Premature Publish Provider");
  const channels = await ingestChannels(context, provider.id, 1, "Premature");
  const assignment = await request<MatchAssignmentResult>(context, "/matches/assign-stream", {
    method: "POST",
    body: JSON.stringify({
      sportName: "Football",
      competitionName: "Production Validation League",
      homeTeamName: "Premature Home",
      awayTeamName: "Premature Away",
      startsAt: new Date(Date.now() + 120_000).toISOString(),
      channelId: channels[0].id
    })
  });

  await requestFailure(
    context,
    `/streams/${assignment.stream.id}/publish`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${context.token}` }
    },
    409,
    "invalid_stream_state_transition"
  );
}

async function validateStreamFailureRemovesFeed(context: ValidationContext) {
  const provider = await createProvider(context, "Phase 9 Failure Provider");
  const channels = await ingestChannels(context, provider.id, 1, "Failure");
  const assignment = await assignApprovePublish(context, channels[0].id, "Failure");
  const failedStream = await request<Stream>(context, `/streams/${assignment.stream.id}/health`, {
    method: "POST",
    body: JSON.stringify({ status: "failed", reason: "Playback stalled during validation." })
  });
  const liveMatches = await request<PublishedLiveMatch[]>(context, "/live-matches/current");

  assert(failedStream.status === "failed", "Failed health did not move the active stream to failed.");
  assert(!liveMatches.some((entry) => entry.stream.id === assignment.stream.id), "Failed stream remained in live feed.");
}

async function validateProviderFailureRemovesFeed(context: ValidationContext) {
  const { getDatabase } = await import("../apps/backend/src/db/connection");
  const provider = await createProvider(context, "Phase 9 Provider Outage Provider");
  const channels = await ingestChannels(context, provider.id, 1, "ProviderOutage");
  const assignment = await assignApprovePublish(context, channels[0].id, "Provider Outage");

  getDatabase()
    .prepare("UPDATE providers SET availability_status = 'offline', updated_at = ? WHERE id = ?")
    .run(new Date().toISOString(), provider.id);

  const liveMatches = await request<PublishedLiveMatch[]>(context, "/mobile/matches/live");

  assert(!liveMatches.some((entry) => entry.stream.id === assignment.stream.id), "Offline provider stream remained in mobile feed.");
}

async function validateEdgeCases(context: ValidationContext) {
  await requestFailure(
    context,
    "/matches/assign-stream",
    {
      method: "POST",
      body: JSON.stringify({
        sportName: "Football",
        competitionName: "Production Validation League",
        homeTeamName: "Missing Provider Home",
        awayTeamName: "Missing Provider Away",
        startsAt: new Date(Date.now() + 180_000).toISOString(),
        channelId: "missing-channel"
      })
    },
    409,
    "active_channel_required"
  );

  const provider = await createProvider(context, "Phase 9 Edge Provider");

  await requestFailure(
    context,
    `/iptv/providers/${provider.id}/m3u`,
    {
      method: "POST",
      body: JSON.stringify({ playlist: "#EXTM3U\n#EXTINF:-1,Bad Stream\nftp://bad.example/stream" })
    },
    400,
    "playlist_contains_invalid_stream_url"
  );

  const channels = await ingestChannels(context, provider.id, 2, "Edge");
  const assignment = await assignApprovePublish(context, channels[0].id, "Repeated Publish");

  await requestFailure(
    context,
    `/streams/${assignment.stream.id}/publish`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${context.token}` }
    },
    409,
    "invalid_stream_state_transition"
  );

  await request<Stream>(context, `/streams/${assignment.stream.id}/health`, {
    method: "POST",
    body: JSON.stringify({ status: "failed", reason: "Failure before stale update." })
  });
  const staleHealthStream = await request<Stream>(context, `/streams/${assignment.stream.id}/health`, {
    method: "POST",
    body: JSON.stringify({ status: "active", reason: "Late active health signal." })
  });
  const mobileFeed = await request<PublishedLiveMatch[]>(context, "/mobile/matches/live");

  assert(staleHealthStream.status === "failed", "Stale active health revived a failed stream lifecycle.");
  assert(!mobileFeed.some((entry) => entry.stream.id === assignment.stream.id), "Stale health revived mobile feed exposure.");
}

async function validateLiveModeStressFeed(context: ValidationContext) {
  const provider = await createProvider(context, "Phase 9 Live Mode Stress Provider");
  const channels = await ingestChannels(context, provider.id, 8, "Stress");
  const assignments: MatchAssignmentResult[] = [];

  for (const [index, channel] of channels.entries()) {
    assignments.push(await assignApprovePublish(context, channel.id, `Stress ${index + 1}`));
  }

  await Promise.all(
    assignments.slice(0, 3).map((assignment, index) =>
      request<Stream>(context, `/streams/${assignment.stream.id}/health`, {
        method: "POST",
        body: JSON.stringify({ status: "failed", reason: `Stress failure ${index + 1}` })
      })
    )
  );

  const liveFeed = await request<PublishedLiveMatch[]>(context, "/live-matches/current");
  const failedIds = new Set(assignments.slice(0, 3).map((assignment) => assignment.stream.id));

  assert(
    liveFeed.every((entry) => !failedIds.has(entry.stream.id)),
    "LIVE MODE feed includes failed streams under alert density."
  );
  assert(
    assignments.slice(3).every((assignment) => liveFeed.some((entry) => entry.stream.id === assignment.stream.id)),
    "LIVE MODE feed dropped valid active streams under stress."
  );
}

async function validateOperationalLogs(context: ValidationContext) {
  const logs = await request<Array<{ eventType: string }>>(context, "/operations/logs?limit=50", {
    headers: { authorization: `Bearer ${context.token}` }
  });
  const eventTypes = new Set(logs.map((log) => log.eventType));

  assert(eventTypes.has("stream_assigned"), "Operational logs missing assignment events.");
  assert(eventTypes.has("stream_approved"), "Operational logs missing approval events.");
  assert(eventTypes.has("stream_published"), "Operational logs missing publish events.");
  assert(eventTypes.has("stream_failure_detected"), "Operational logs missing stream failure events.");
}

async function closeServer() {
  await new Promise<void>((resolve, reject) => {
    if (!server) {
      resolve();
      return;
    }

    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

const scenarios: Array<[string, (context: ValidationContext) => Promise<void>]> = [
  ["full operational flow", validateFullFlow],
  ["premature publish rejection", validatePrematurePublishBlocked],
  ["stream failure feed removal", validateStreamFailureRemovesFeed],
  ["provider outage feed removal", validateProviderFailureRemovesFeed],
  ["edge case state validation", validateEdgeCases],
  ["LIVE MODE stress feed", validateLiveModeStressFeed],
  ["operational log coverage", validateOperationalLogs]
];

async function main() {
  const { createApp } = await import("../apps/backend/src/app");

  server = http.createServer(createApp());

  try {
    const baseUrl = await listen();
    const token = await login(baseUrl);
    const context = { baseUrl, token };

    for (const [name, scenario] of scenarios) {
      console.log(`RUN ${name}`);
      await scenario(context);
      console.log(`PASS ${name}`);
    }

    console.log(`Validated ${scenarios.length} production-readiness scenarios.`);
  } finally {
    await closeServer();
  }
}

void main();
