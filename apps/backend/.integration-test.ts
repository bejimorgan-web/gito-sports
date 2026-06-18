import http from "node:http";
import { once } from "node:events";

const backendPort = 4100;
const playlistPort = 42010;
const apiBase = `http://127.0.0.1:${backendPort}`;
const playlistUrl = `http://127.0.0.1:${playlistPort}/playlist.m3u`;

const playlistContent = `#EXTM3U
#EXTINF:-1 tvg-id="chan-01" group-title="Sports",Test Channel 1
http://example.com/stream1.m3u8
#EXTINF:-1 tvg-id="chan-02" group-title="Sports",Test Channel 2
http://example.com/stream2.m3u8
`;

async function startPlaylistServer() {
  const server = http.createServer((req, res) => {
    if (req.url === "/playlist.m3u") {
      res.writeHead(200, { "Content-Type": "audio/x-mpegurl" });
      res.end(playlistContent);
      return;
    }
    res.writeHead(404);
    res.end("Not found");
  });

  server.listen(playlistPort);
  await once(server, "listening");
  return server;
}

async function fetchJson(path: string, options: RequestInit = {}) {
  const response = await fetch(`${apiBase}${path}`, options);
  const body = await response.text();
  let parsed: unknown = null;

  try {
    parsed = body ? JSON.parse(body) : null;
  } catch {
    parsed = body;
  }

  return { status: response.status, body: parsed };
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function log(message: string) {
  process.stdout.write(`${message}\n`);
}

async function run() {
  const playlistServer = await startPlaylistServer();
  log("Playlist server running.");

  log("Creating operator token...");
  const login = await fetchJson("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "integration@test.local" })
  });
  assert(login.status === 200, "Auth login should return 200");
  const token = (login.body as any).data?.accessToken;
  assert(typeof token === "string", "Auth token should be provided");

  log("Creating IPTV provider...");
  const createProvider = await fetchJson("/iptv/providers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Integration Test M3U Provider",
      baseUrl: playlistUrl,
      type: "m3u",
      authType: "none"
    })
  });
  assert(createProvider.status === 201, "Provider creation should return 201");
  const providerId = (createProvider.body as any).data?.id;
  assert(typeof providerId === "string", "Provider ID should be returned");

  log("Running provider test endpoint with playlist sync...");
  const testResponse = await fetchJson(`/iptv/providers/${providerId}/test?trySync=1`, {
    method: "POST",
    headers: { "Content-Type": "application/json" }
  });
  assert(testResponse.status === 200, "Provider test should return 200");
  const testResult = (testResponse.body as any).data;
  assert(testResult?.ok === true, "Provider test should succeed");
  assert(testResult?.channelsCreated === 2, "Provider test should create 2 channels");

  log("Verifying provider status is active...");
  const providerDetails = await fetchJson(`/iptv/providers/${providerId}`);
  assert(providerDetails.status === 200, "Provider details should be retrievable");
  assert((providerDetails.body as any).data?.status === "active", "Provider should be active after successful test");

  log("Fetching provider channels...");
  const channelsResponse = await fetchJson(`/iptv/channels?providerId=${providerId}`);
  assert(channelsResponse.status === 200, "Channel listing should return 200");
  const channels = (channelsResponse.body as any).data;
  assert(Array.isArray(channels) && channels.length === 2, "Exactly 2 channels should be listed for the provider");
  const channelIds = channels.map((c: any) => c.id);
  assert(new Set(channelIds).size === 2, "Channel IDs should be unique");
  assert(channels.every((c: any) => c.providerId === providerId), "Channels should be linked to the correct provider");
  assert(channels.every((c: any) => c.status === "active"), "Channels should be active after sync");

  log("Re-running provider test to confirm no duplicate channel creation...");
  const testResponse2 = await fetchJson(`/iptv/providers/${providerId}/test?trySync=1`, {
    method: "POST",
    headers: { "Content-Type": "application/json" }
  });
  assert(testResponse2.status === 200, "Second provider test should return 200");
  assert((testResponse2.body as any).data?.channelsCreated === 2, "Second sync should still report 2 channels created/updated");

  log("Assigning a match to a valid active channel...");
  const channelId = channels[0].id;
  const futureStartsAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const assignResponse = await fetchJson("/matches/assign-stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sportName: "Soccer",
      competitionName: "Integration Cup",
      homeTeamName: "Team Alpha",
      awayTeamName: "Team Beta",
      startsAt: futureStartsAt,
      channelId
    })
  });
  assert(assignResponse.status === 201, "Match assignment should return 201");
  const assignment = (assignResponse.body as any).data;
  assert(assignment?.match?.status === "assigned", "Match should be in assigned status");
  assert(assignment?.stream?.status === "assigned", "Stream should be in assigned status");
  assert(assignment?.channel?.id === channelId, "Assigned channel should match selected channel");

  const streamId = assignment.stream.id;

  log("Approving the assigned stream...");
  const approveResponse = await fetchJson(`/streams/${streamId}/approve`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    }
  });
  assert(approveResponse.status === 200, "Stream approval should return 200");
  assert((approveResponse.body as any).data?.status === "approved", "Stream should be approved");

  log("Publishing the approved stream...");
  const publishResponse = await fetchJson(`/streams/${streamId}/publish`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    }
  });
  assert(publishResponse.status === 200, "Stream publish should return 200");
  assert((publishResponse.body as any).data?.status === "active", "Stream should be active after publishing");

  log("Fetching mobile live feed to verify published match appears...");
  const liveFeed1 = await fetchJson("/mobile/matches/live");
  assert(liveFeed1.status === 200, "Mobile live feed should return 200");
  const liveMatches1 = (liveFeed1.body as any).data;
  assert(Array.isArray(liveMatches1) && liveMatches1.length >= 1, "Published match should appear in the live feed");
  assert(liveMatches1.some((item: any) => item.stream?.id === streamId), "Published stream should be present in the live feed");

  log("Simulating failure by marking stream health as failed...");
  const healthResponse = await fetchJson(`/streams/${streamId}/health`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "failed", reason: "simulated_failure" })
  });
  assert(healthResponse.status === 200, "Health report should return 200");
  assert((healthResponse.body as any).data?.status === "failed", "Stream should be marked failed");

  log("Verifying failed stream is excluded from mobile live feed...");
  const liveFeed2 = await fetchJson("/mobile/matches/live");
  assert(liveFeed2.status === 200, "Mobile live feed should return 200 after failure");
  const liveMatches2 = (liveFeed2.body as any).data;
  assert(!liveMatches2.some((item: any) => item.stream?.id === streamId), "Failed stream should be excluded from live feed");

  log("Completed initial integration checks. Recording results for persistence restart test.");
  const resultSummary = {
    providerId,
    channelIds,
    streamId,
    assignStatus: assignment.match.status,
    providerStatus: (providerDetails.body as any).data?.status
  };

  playlistServer.close();
  log("Playlist server stopped.");
  process.stdout.write(JSON.stringify(resultSummary));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
