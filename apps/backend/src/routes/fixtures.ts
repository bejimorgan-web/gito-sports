import { Router } from "express";
import { createCanonicalFixture, deleteCanonicalFixture, getCanonicalFixtureById, listCanonicalFixtures, updateCanonicalFixture } from "../repositories/fixtures-repository.js";
import { protectedRoute } from "../middleware/protected.js";
import { createCanonicalStream, deleteCanonicalStream, listStreams, updateCanonicalStream } from "../repositories/streams-repository.js";

export const fixturesRouter = Router();

fixturesRouter.get("/", (request, response) => {
  response.json({ data: listCanonicalFixtures({
    competitionId: typeof request.query.competitionId === "string" ? request.query.competitionId : undefined,
    seasonId: typeof request.query.seasonId === "string" ? request.query.seasonId : undefined
  }) });
});

fixturesRouter.get("/:fixtureId", (request, response) => {
  const fixture = getCanonicalFixtureById(String(request.params.fixtureId ?? ""));
  if (!fixture) { response.status(404).json({ error: "fixture_not_found" }); return; }
  response.json({ data: fixture });
});

fixturesRouter.post("/", protectedRoute, (request, response) => {
  try { response.status(201).json({ data: createCanonicalFixture(request.body) }); }
  catch (error) { response.status(409).json({ error: error instanceof Error ? error.message : String(error) }); }
});

fixturesRouter.put("/:fixtureId", protectedRoute, (request, response) => {
  try {
    const fixture = updateCanonicalFixture(String(request.params.fixtureId ?? ""), request.body);
    if (!fixture) { response.status(404).json({ error: "fixture_not_found" }); return; }
    response.json({ data: fixture });
  } catch (error) { response.status(409).json({ error: error instanceof Error ? error.message : String(error) }); }
});

fixturesRouter.get("/:fixtureId/streams", (request, response) => {
  const fixture = getCanonicalFixtureById(String(request.params.fixtureId ?? ""));
  if (!fixture) { response.status(404).json({ error: "fixture_not_found" }); return; }
  response.json({ data: listStreams({ matchId: fixture.id }) });
});

fixturesRouter.post("/:fixtureId/streams", protectedRoute, (request, response) => {
  try {
    const stream = createCanonicalStream(String(request.params.fixtureId ?? ""), String(request.body?.channelId ?? ""), request.body?.protocol ?? "hls");
    response.status(201).json({ data: stream });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    response.status(message === "fixture_not_found" || message === "channel_not_found" || message === "provider_not_found" ? 404 : 409).json({ error: message });
  }
});

fixturesRouter.put("/:fixtureId/streams/:streamId", protectedRoute, (request, response) => {
  try {
    const stream = updateCanonicalStream(String(request.params.fixtureId ?? ""), String(request.params.streamId ?? ""), request.body ?? {});
    if (!stream) { response.status(404).json({ error: "stream_not_found" }); return; }
    response.json({ data: stream });
  } catch (error) { response.status(409).json({ error: error instanceof Error ? error.message : String(error) }); }
});

fixturesRouter.delete("/:fixtureId/streams/:streamId", protectedRoute, (request, response) => {
  try {
    if (!deleteCanonicalStream(String(request.params.fixtureId ?? ""), String(request.params.streamId ?? ""))) { response.status(404).json({ error: "stream_not_found" }); return; }
    response.status(204).send();
  } catch (error) { response.status(404).json({ error: error instanceof Error ? error.message : String(error) }); }
});

fixturesRouter.delete("/:fixtureId", protectedRoute, (request, response) => {
  try {
    if (!deleteCanonicalFixture(String(request.params.fixtureId ?? ""))) {
      response.status(404).json({ error: "fixture_not_found" });
      return;
    }
    response.status(204).send();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    response.status(message === "fixture_in_use" ? 409 : 400).json({ error: message, message });
  }
});