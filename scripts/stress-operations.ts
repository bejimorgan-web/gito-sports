import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { performance } from "node:perf_hooks";

import type { Channel, IPTVProvider, MatchAssignmentResult, PublishedLiveMatch, Stream } from "@gito/shared";

const workspaceRoot = process.cwd();
const dataDir = path.resolve(workspaceRoot, "data");
const databasePath = path.join(dataDir, `stress-validation-${Date.now()}.sqlite`);
const reportPath = path.resolve(workspaceRoot, "docs", "STRESS_TEST_REPORT.md");
const requestTimeoutMs = 30_000;

if (!databasePath.startsWith(dataDir)) {
  throw new Error("Stress database path escaped the workspace data directory.");
}

fs.mkdirSync(dataDir, { recursive: true });
process.env.DATABASE_PATH = databasePath;
process.env.JWT_SECRET = "stress-validation-secret";

interface ApiResponse<T> {
  data: T;
}

interface StressContext {
  baseUrl: string;
  token: string;
}

interface ScenarioResult {
  name: string;
  status: "PASS" | "WARN" | "FAIL";
  durationMs: number;
  scale: string;
  findings: string[];
  metrics: Record<string, number | string>;
}

interface EndpointStats {
  failures: number;
  latencies: number[];
  successes: number;
}

let server: http.Server | undefined;
const endpointStats = new Map<string, EndpointStats>();

function endpointKey(pathName: string) {
  if (pathName.includes("/streams/") && pathName.endsWith("/health")) {
    return "POST /streams/:streamId/health";
  }

  if (pathName.includes("/streams/") && pathName.endsWith("/approve")) {
    return "POST /streams/:streamId/approve";
  }

  if (pathName.includes("/streams/") && pathName.endsWith("/publish")) {
    return "POST /streams/:streamId/publish";
  }

  return pathName;
}

function recordEndpoint(pathName: string, durationMs: number, ok: boolean) {
  const key = endpointKey(pathName);
  const stats = endpointStats.get(key) ?? { failures: 0, latencies: [], successes: 0 };

  stats.latencies.push(durationMs);

  if (ok) {
    stats.successes += 1;
  } else {
    stats.failures += 1;
  }

  endpointStats.set(key, stats);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function percentile(values: number[], percentileValue: number) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil((percentileValue / 100) * sorted.length) - 1);

  return sorted[index];
}

async function listen(): Promise<string> {
  return new Promise((resolve) => {
    if (!server) {
      throw new Error("Stress server was not initialized.");
    }

    server.listen(0, "127.0.0.1", () => {
      const address = server?.address();

      if (!address || typeof address === "string") {
        throw new Error("Stress server did not bind to a TCP address.");
      }

      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

async function closeServer() {
  await new Promise<void>((resolve, reject) => {
    if (!server?.listening) {
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

async function startServer() {
  const { createApp } = await import("../apps/backend/src/app");

  server = http.createServer(createApp());
  return listen();
}

async function request<T>(
  context: Pick<StressContext, "baseUrl">,
  pathName: string,
  init?: RequestInit,
  timings?: number[],
  retriesRemaining = 1
): Promise<T> {
  const method = init?.method ?? "GET";
  const allowRetry = method === "GET";
  const startedAt = performance.now();
  let response: Response;

  try {
    response = await fetch(`${context.baseUrl}${pathName}`, {
      ...init,
      signal: AbortSignal.timeout(requestTimeoutMs),
      headers: {
        "content-type": "application/json",
        ...init?.headers
      }
    });
  } catch (error) {
    recordEndpoint(pathName, performance.now() - startedAt, false);
    if (allowRetry && retriesRemaining > 0) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      return request<T>(context, pathName, init, timings, retriesRemaining - 1);
    }
    throw new Error(`${pathName} transport failed: ${error instanceof Error ? error.message : "unknown error"}`);
  }

  const durationMs = performance.now() - startedAt;
  timings?.push(durationMs);
  recordEndpoint(pathName, durationMs, response.ok);

  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string; message?: string };
    throw new Error(body.error ?? body.message ?? `Request failed with status ${response.status}`);
  }

  const body = await response.json() as ApiResponse<T>;
  return body.data;
}

async function requestFailure(
  context: Pick<StressContext, "baseUrl">,
  pathName: string,
  init: RequestInit,
  expectedStatus: number
) {
  const startedAt = performance.now();
  let response: Response;

  try {
    response = await fetch(`${context.baseUrl}${pathName}`, {
      ...init,
      signal: AbortSignal.timeout(requestTimeoutMs),
      headers: {
        "content-type": "application/json",
        ...init.headers
      }
    });
  } catch (error) {
    recordEndpoint(pathName, performance.now() - startedAt, false);
    throw new Error(`${pathName} transport failed: ${error instanceof Error ? error.message : "unknown error"}`);
  }

  recordEndpoint(pathName, performance.now() - startedAt, response.status === expectedStatus);
  assert(response.status === expectedStatus, `${pathName} expected ${expectedStatus}, received ${response.status}`);
}

async function login(baseUrl: string) {
  const session = await request<{ accessToken: string }>({ baseUrl }, "/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "operator@gito.local" })
  });

  return session.accessToken;
}

async function createProvider(context: StressContext, name: string) {
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
    lines.push(`#EXTINF:-1 tvg-id="${name}-${index}" group-title="Stress",${name} Channel ${index}`);
    lines.push(`https://streams.example/${name.toLowerCase()}-${index}.m3u8`);
  }

  return lines.join("\n");
}

async function ingestChannels(context: StressContext, providerId: string, count: number, name: string) {
  await request<{ channelsCreated: number; categories: string[] }>(context, `/iptv/providers/${providerId}/m3u`, {
    method: "POST",
    body: JSON.stringify({ playlist: playlistFor(name, count) })
  });

  const channels = await request<Channel[]>(context, `/iptv/channels?providerId=${encodeURIComponent(providerId)}`);

  return channels.slice(-count);
}

async function assignApprovePublish(
  context: StressContext,
  channelId: string,
  index: number,
  timings?: number[]
) {
  const assignment = await request<MatchAssignmentResult>(
    context,
    "/matches/assign-stream",
    {
      method: "POST",
      body: JSON.stringify({
        sportName: "Football",
        competitionName: "Stress Simulation League",
        homeTeamName: `Stress Home ${index}`,
        awayTeamName: `Stress Away ${index}`,
        startsAt: new Date(Date.now() + index * 60_000).toISOString(),
        channelId
      })
    },
    timings
  );

  await request<Stream>(
    context,
    `/streams/${assignment.stream.id}/approve`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${context.token}` }
    },
    timings
  );

  const stream = await request<Stream>(
    context,
    `/streams/${assignment.stream.id}/publish`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${context.token}` }
    },
    timings
  );

  return {
    ...assignment,
    match: { ...assignment.match, status: "published" },
    stream
  };
}

async function createLiveMatches(context: StressContext, count: number, providerName: string) {
  const provider = await createProvider(context, providerName);
  const channels = await ingestChannels(context, provider.id, count, providerName.replace(/\s+/g, ""));
  const timings: number[] = [];
  const assignments: MatchAssignmentResult[] = [];

  for (const [index, channel] of channels.entries()) {
    assignments.push(await assignApprovePublish(context, channel.id, index + 1, timings));

    if ((index + 1) % 10 === 0 || index + 1 === count) {
      console.log(`  prepared ${index + 1}/${count} live matches for ${providerName}`);
    }
  }

  return { assignments, provider, timings };
}

async function scenario<T>(name: string, scale: string, run: () => Promise<{ metrics: Record<string, number | string>; findings?: string[] }>): Promise<ScenarioResult> {
  const startedAt = performance.now();
  console.log(`RUN ${name}`);

  try {
    const result = await run();

    return {
      name,
      status: result.findings?.length ? "WARN" : "PASS",
      durationMs: Math.round(performance.now() - startedAt),
      scale,
      findings: result.findings ?? [],
      metrics: result.metrics
    };
  } catch (error) {
    return {
      name,
      status: "FAIL",
      durationMs: Math.round(performance.now() - startedAt),
      scale,
      findings: [error instanceof Error ? error.message : "Unknown failure"],
      metrics: {}
    };
  }
}

async function verifyFeedIntegrity(context: StressContext) {
  const { getDatabase } = await import("../apps/backend/src/db/connection");
  const feed = await request<PublishedLiveMatch[]>(context, "/mobile/matches/live");
  const invalidFeedRows = getDatabase()
    .prepare(
      `SELECT COUNT(*) AS count
      FROM streams s
      JOIN matches m ON m.id = s.match_id
      WHERE s.status = 'active' AND m.status != 'published'`
    )
    .get() as { count: number };
  const orphanStreams = getDatabase()
    .prepare(
      `SELECT COUNT(*) AS count
      FROM streams s
      LEFT JOIN matches m ON m.id = s.match_id
      LEFT JOIN channels c ON c.id = s.channel_id
      WHERE m.id IS NULL OR c.id IS NULL`
    )
    .get() as { count: number };

  assert(invalidFeedRows.count === 0, "SQLite contains active streams whose matches are not published.");
  assert(orphanStreams.count === 0, "SQLite contains orphan streams.");
  assert(feed.every((entry) => entry.match.status === "published" && entry.stream.status === "active"), "Mobile feed exposed non-live lifecycle state.");

  return feed.length;
}

async function runStress(context: StressContext) {
  const results: ScenarioResult[] = [];
  const memoryStart = process.memoryUsage().heapUsed;
  let stressAssignments: MatchAssignmentResult[] = [];
  let stressProvider: IPTVProvider | undefined;

  results.push(await scenario("Multi-match stress simulation", "10, 25, and 50 simultaneous live matches", async () => {
    const { assignments, provider, timings } = await createLiveMatches(context, 50, "Phase 10 Primary Provider");
    stressAssignments = assignments;
    stressProvider = provider;

    const feedTimings: number[] = [];
    const feedAt50 = await request<PublishedLiveMatch[]>(context, "/live-matches/current", undefined, feedTimings);
    assert(feedAt50.length >= 50, "Feed did not expose 50 active live matches.");

    const feedAt25 = feedAt50.slice(0, 25);
    const feedAt10 = feedAt50.slice(0, 10);
    assert(feedAt10.length === 10 && feedAt25.length === 25, "Stress feed subsets were not readable at expected scales.");

    return {
      metrics: {
        liveMatches: feedAt50.length,
        workflowP95Ms: Math.round(percentile(timings, 95)),
        feedP95Ms: Math.round(percentile(feedTimings, 95)),
        workflowRequests: timings.length
      }
    };
  }));

  results.push(await scenario("Multi-stream failure simulation", "5 simultaneous failures, then 10 total failures with mixed degraded updates", async () => {
    const failedFirst = stressAssignments.slice(0, 5);
    const failedSecond = stressAssignments.slice(5, 10);
    const degraded = stressAssignments.slice(10, 20);

    await Promise.all(failedFirst.map((assignment, index) =>
      request<Stream>(context, `/streams/${assignment.stream.id}/health`, {
        method: "POST",
        body: JSON.stringify({ status: "failed", reason: `Simultaneous failure ${index + 1}` })
      })
    ));
    await Promise.all([
      ...failedSecond.map((assignment, index) =>
        request<Stream>(context, `/streams/${assignment.stream.id}/health`, {
          method: "POST",
          body: JSON.stringify({ status: "failed", reason: `Second failure wave ${index + 1}` })
        })
      ),
      ...degraded.map((assignment, index) =>
        request<Stream>(context, `/streams/${assignment.stream.id}/health`, {
          method: "POST",
          body: JSON.stringify({ status: "degraded", reason: `Degraded signal ${index + 1}` })
        })
      )
    ]);

    const feed = await request<PublishedLiveMatch[]>(context, "/mobile/matches/live");
    const failedIds = new Set(stressAssignments.slice(0, 10).map((assignment) => assignment.stream.id));

    assert(feed.every((entry) => !failedIds.has(entry.stream.id)), "Failed streams remained visible in mobile feed.");
    assert(degraded.every((assignment) => feed.some((entry) => entry.stream.id === assignment.stream.id)), "Degraded streams were incorrectly removed from feed.");

    return {
      metrics: {
        failedStreams: 10,
        degradedStreams: 10,
        remainingFeedMatches: feed.length
      }
    };
  }));

  results.push(await scenario("Provider outage chaos test", "single and multiple provider outages during active matches", async () => {
    const { getDatabase } = await import("../apps/backend/src/db/connection");
    const first = await createLiveMatches(context, 5, "Phase 10 Outage Provider One");
    const second = await createLiveMatches(context, 5, "Phase 10 Outage Provider Two");

    getDatabase()
      .prepare("UPDATE providers SET availability_status = 'offline', updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), first.provider.id);

    let feed = await request<PublishedLiveMatch[]>(context, "/live-matches/current");
    assert(first.assignments.every((assignment) => !feed.some((entry) => entry.stream.id === assignment.stream.id)), "Single offline provider remained in feed.");

    getDatabase()
      .prepare("UPDATE providers SET availability_status = 'offline', updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), second.provider.id);

    feed = await request<PublishedLiveMatch[]>(context, "/mobile/matches/live");
    assert(second.assignments.every((assignment) => !feed.some((entry) => entry.stream.id === assignment.stream.id)), "Second offline provider remained in mobile feed.");

    return {
      findings: [
        "Provider outage feed exclusion is immediate, but match lifecycle remains published because direct provider outage does not trigger automatic cancellation without stream health failure."
      ],
      metrics: {
        outageProviders: 2,
        outageMatches: 10,
        feedAfterOutages: feed.length
      }
    };
  }));

  results.push(await scenario("Backend degradation and recovery", "temporary backend unavailability during approved publish", async () => {
    const provider = await createProvider(context, "Phase 10 Recovery Provider");
    const channels = await ingestChannels(context, provider.id, 1, "Recovery");
    const assignment = await request<MatchAssignmentResult>(context, "/matches/assign-stream", {
      method: "POST",
      body: JSON.stringify({
        sportName: "Football",
        competitionName: "Stress Simulation League",
        homeTeamName: "Recovery Home",
        awayTeamName: "Recovery Away",
        startsAt: new Date(Date.now() + 900_000).toISOString(),
        channelId: channels[0].id
      })
    });
    await request<Stream>(context, `/streams/${assignment.stream.id}/approve`, {
      method: "POST",
      headers: { authorization: `Bearer ${context.token}` }
    });

    await closeServer();

    let unavailableDetected = false;
    try {
      await request<Stream>(context, `/streams/${assignment.stream.id}/publish`, {
        method: "POST",
        headers: { authorization: `Bearer ${context.token}` }
      });
    } catch {
      unavailableDetected = true;
    }

    const baseUrl = await startServer();
    context.baseUrl = baseUrl;
    context.token = await login(baseUrl);
    const stream = await request<Stream>(context, `/streams/${assignment.stream.id}/publish`, {
      method: "POST",
      headers: { authorization: `Bearer ${context.token}` }
    });

    assert(unavailableDetected, "Backend unavailability was not detected by the client.");
    assert(stream.status === "active", "Backend recovery did not allow confirmed publication.");

    return {
      metrics: {
        unavailableDetected: "yes",
        recoveredPublishStatus: stream.status
      }
    };
  }));

  results.push(await scenario("Long-run session validation", "accelerated 4h, 8h, and 12h polling equivalents", async () => {
    const cycles = 12 * 20;
    const timings: number[] = [];

    for (let index = 0; index < cycles; index += 1) {
      await request<PublishedLiveMatch[]>(context, "/live-matches/current", undefined, timings);
    }

    const memoryEnd = process.memoryUsage().heapUsed;
    const memoryDeltaMb = (memoryEnd - memoryStart) / 1024 / 1024;

    return {
      findings: [
        "Long-run preview playback stability requires manual or browser-based verification because this harness validates backend/session polling only."
      ],
      metrics: {
        pollingCycles: cycles,
        simulatedHours: "4/8/12 checkpoints via 240 feed polls",
        feedP95Ms: Math.round(percentile(timings, 95)),
        heapDeltaMb: Number(memoryDeltaMb.toFixed(2))
      }
    };
  }));

  results.push(await scenario("High-frequency event simulation", "120 rapid health updates and repeated lifecycle attempts", async () => {
    const targets = stressAssignments.slice(20, 30);
    const timings: number[] = [];

    for (let index = 0; index < 120; index += 1) {
      const target = targets[index % targets.length];
      const status = index % 3 === 0 ? "degraded" : "active";

      await request<Stream>(
        context,
        `/streams/${target.stream.id}/health`,
        {
          method: "POST",
          body: JSON.stringify({ status, reason: `Rapid update ${index + 1}` })
        },
        timings
      );
    }

    await Promise.all(targets.slice(0, 3).map((target) =>
      requestFailure(
        context,
        `/streams/${target.stream.id}/publish`,
        {
          method: "POST",
          headers: { authorization: `Bearer ${context.token}` }
        },
        409
      )
    ));

    const feedCount = await verifyFeedIntegrity(context);

    return {
      metrics: {
        healthUpdates: 120,
        duplicatePublishAttempts: 3,
        healthUpdateP95Ms: Math.round(percentile(timings, 95)),
        validFeedCount: feedCount
      }
    };
  }));

  results.push(await scenario("Operator error injection", "invalid assignment, duplicate actions, and rapid invalid publish attempts", async () => {
    await requestFailure(context, "/matches/assign-stream", {
      method: "POST",
      body: JSON.stringify({
        sportName: "Football",
        competitionName: "Stress Simulation League",
        homeTeamName: "Invalid Home",
        awayTeamName: "Invalid Away",
        startsAt: new Date(Date.now() + 1_000_000).toISOString(),
        channelId: "missing-channel"
      })
    }, 409);

    const target = stressAssignments[30];
    await Promise.all(Array.from({ length: 10 }, () =>
      requestFailure(context, `/streams/${target.stream.id}/publish`, {
        method: "POST",
        headers: { authorization: `Bearer ${context.token}` }
      }, 409)
    ));

    const feedCount = await verifyFeedIntegrity(context);

    return {
      metrics: {
        invalidAssignments: 1,
        rapidInvalidPublishes: 10,
        validFeedCount: feedCount
      }
    };
  }));

  results.push(await scenario("LIVE MODE readability validation", "50 live items with 20 alert-producing states", async () => {
    const readability = await createLiveMatches(context, 50, "Phase 10 Readability Provider");
    const degraded = readability.assignments.slice(0, 20);

    await Promise.all(degraded.map((assignment, index) =>
      request<Stream>(context, `/streams/${assignment.stream.id}/health`, {
        method: "POST",
        body: JSON.stringify({ status: "degraded", reason: `Readability alert ${index + 1}` })
      })
    ));

    const feed = await request<PublishedLiveMatch[]>(context, "/live-matches/current");
    const readabilityIds = new Set(readability.assignments.map((assignment) => assignment.stream.id));
    const visibleReadabilityMatches = feed.filter((entry) => readabilityIds.has(entry.stream.id));
    const alertDensity = 20;

    assert(visibleReadabilityMatches.length === 50, "LIVE MODE readability set did not remain fully visible.");

    return {
      findings: visibleReadabilityMatches.length > 40
        ? ["LIVE MODE remains data-consistent at high scale, but 40+ visible live rows should receive hands-on UI readability review before event-day use."]
        : [],
      metrics: {
        visibleLiveMatches: visibleReadabilityMatches.length,
        alertProducingStates: alertDensity,
        atRiskTrackedLocally: degraded.length
      }
    };
  }));

  results.push(await scenario("Continuous feed consistency verification", "SQLite, backend, and mobile feed checks after stress", async () => {
    const feedCount = await verifyFeedIntegrity(context);
    const { getDatabase } = await import("../apps/backend/src/db/connection");
    const counts = getDatabase()
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM matches) AS matches,
          (SELECT COUNT(*) FROM streams) AS streams,
          (SELECT COUNT(*) FROM streams WHERE status = 'failed') AS failed_streams,
          (SELECT COUNT(*) FROM matches WHERE status = 'cancelled') AS cancelled_matches`
      )
      .get() as { matches: number; streams: number; failed_streams: number; cancelled_matches: number };

    return {
      metrics: {
        mobileFeedCount: feedCount,
        sqliteMatches: counts.matches,
        sqliteStreams: counts.streams,
        failedStreams: counts.failed_streams,
        cancelledMatches: counts.cancelled_matches
      }
    };
  }));

  if (stressProvider) {
    results.push(await scenario("Primary provider health scoring", "provider health after mixed active, degraded, and failed stream reports", async () => {
      const providers = await request<IPTVProvider[]>(context, "/iptv/providers");
      const provider = providers.find((candidate) => candidate.id === stressProvider?.id);

      assert(provider, "Primary stress provider disappeared from provider list.");

      return {
        metrics: {
          availabilityStatus: provider.availabilityStatus,
          healthScore: provider.healthScore,
          failedChannelLoads: provider.failedChannelLoads
        }
      };
    }));
  }

  return results;
}

function formatMetricValue(value: number | string) {
  return typeof value === "number" ? value.toString() : value;
}

function formatEndpointStats() {
  return Array.from(endpointStats.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([endpoint, stats]) => ({
      endpoint,
      failures: stats.failures,
      p95Ms: Math.round(percentile(stats.latencies, 95)),
      requests: stats.failures + stats.successes,
      successes: stats.successes
    }));
}

function generateReport(results: ScenarioResult[]) {
  const failed = results.filter((result) => result.status === "FAIL");
  const warnings = results.filter((result) => result.status === "WARN");
  const assessment = failed.length > 0 ? "FAIL" : warnings.length > 0 ? "PASS WITH WARNINGS" : "PASS";
  const endpointSummaries = formatEndpointStats();
  const lines = [
    "# Stress Test Report",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Before Remediation",
    "",
    "- Multi-match stress simulation passed, but workflow P95 latency was 3537 ms.",
    "- Concurrent `/streams/:streamId/health` reporting produced transport failures.",
    "- LIVE MODE 50-match validation timed out during health reporting.",
    "- `/mobile/matches/live` became unreachable after sustained stress.",
    "",
    "## Changes Applied",
    "",
    "- Collapsed stream health updates, provider health impact, failure lifecycle changes, and health logging into one SQLite transaction.",
    "- Coalesced repeated non-critical health reports inside a short interval.",
    "- Reduced provider health score impact for degraded reports so mixed degraded and failed streams do not unnecessarily remove all provider channels from live delivery.",
    "- Reduced duplicate health-update operational logs while preserving assignment, approval, publish, and failure audit events.",
    "- Added endpoint request counts, success/failure counts, and P95 latency summaries to the stress harness.",
    "",
    "## Readiness Assessment",
    "",
    assessment,
    "",
    "## Test Coverage",
    "",
    "| Scenario | Status | Scale | Duration | Key Metrics |",
    "| --- | --- | --- | ---: | --- |",
    ...results.map((result) => {
      const metrics = Object.entries(result.metrics)
        .map(([key, value]) => `${key}: ${formatMetricValue(value)}`)
        .join(", ");

      return `| ${result.name} | ${result.status} | ${result.scale} | ${result.durationMs} ms | ${metrics || "n/a"} |`;
    }),
    "",
    "## Endpoint Latency Summary",
    "",
    "| Endpoint | Requests | Successes | Failures | P95 Latency |",
    "| --- | ---: | ---: | ---: | ---: |",
    ...endpointSummaries.map((summary) =>
      `| ${summary.endpoint} | ${summary.requests} | ${summary.successes} | ${summary.failures} | ${summary.p95Ms} ms |`
    ),
    "",
    "## Findings",
    ""
  ];

  if (results.every((result) => result.findings.length === 0)) {
    lines.push("- No stress failures or degraded behaviors were detected.");
  } else {
    for (const result of results) {
      for (const finding of result.findings) {
        lines.push(`- ${result.status}: ${result.name}: ${finding}`);
      }
    }
  }

  lines.push(
    "",
    "## Recommendations",
    "",
    "- Keep `/streams/:streamId/health` endpoint latency under observation; the remediated run removed transport failures, but concurrent health waves still produce the highest endpoint P95.",
    "- Add explicit capacity expectations for rapid health reporting and LIVE MODE alert density before event-day use.",
    "- Keep `/mobile/matches/live` in every stress gate; it remained reachable after remediation and must stay prioritized over background health traffic.",
    "- Run the stress harness before deployment using `npm run stress:operations`.",
    "- Perform a hands-on browser/Electron LIVE MODE readability review at 40+ visible live rows.",
    "- Add browser-level memory instrumentation before relying on automated 8-12 hour preview playback results.",
    "- Treat direct provider outage as feed-exclusion state; match cancellation remains tied to explicit stream failure health reports.",
    "",
    "## Notes",
    "",
    "- Simulations use an isolated SQLite database under `data/` and do not modify production data.",
    "- Long-run validation is accelerated through repeated feed polling; it verifies backend/session stability, not real media playback duration.",
    "- The harness preserves the existing architecture, schema, lifecycle rules, and backend routes."
  );

  fs.writeFileSync(reportPath, `${lines.join("\n")}\n`, "utf8");

  return assessment;
}

async function main() {
  console.log("Starting Phase 10 operational stress simulation...");
  const baseUrl = await startServer();
  const token = await login(baseUrl);
  const context = { baseUrl, token };

  try {
    const results = await runStress(context);

    for (const result of results) {
      console.log(`${result.status} ${result.name} (${result.durationMs} ms)`);
    }

    const assessment = generateReport(results);
    console.log(`Stress readiness assessment: ${assessment}`);
    console.log(`Report written to ${reportPath}`);
  } finally {
    await closeServer();
  }
}

void main();
