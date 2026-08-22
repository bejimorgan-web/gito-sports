import { Router } from "express";
import { createCanonicalFixture, deleteCanonicalFixture, getCanonicalFixtureById, listCanonicalFixtures, updateCanonicalFixture } from "../repositories/fixtures-repository.js";
import { protectedRoute } from "../middleware/protected.js";
import { createCanonicalStream, deleteCanonicalStream, listStreams, updateCanonicalStream } from "../repositories/streams-repository.js";
import { clearFixtureLineup, getFixtureLineups, saveFixtureLineup } from "../repositories/fixture-lineups-repository.js";

export const fixturesRouter = Router();

fixturesRouter.get("/", (request, response) => {
  response.json({ data: listCanonicalFixtures({
    sportId: typeof request.query.sportId === "string" ? request.query.sportId : undefined,
    competitionId: typeof request.query.competitionId === "string" ? request.query.competitionId : undefined,
    seasonId: typeof request.query.seasonId === "string" ? request.query.seasonId : undefined,
    teamId: typeof request.query.teamId === "string" ? request.query.teamId : undefined,
    status: typeof request.query.status === "string" ? request.query.status : undefined,
    from: typeof request.query.from === "string" ? request.query.from : undefined,
    to: typeof request.query.to === "string" ? request.query.to : undefined,
    limit: typeof request.query.limit === "string" ? Number(request.query.limit) : undefined,
    offset: typeof request.query.offset === "string" ? Number(request.query.offset) : undefined
  }) });
});

fixturesRouter.get("/:fixtureId", (request, response) => {
  const fixture = getCanonicalFixtureById(String(request.params.fixtureId ?? ""));
  if (!fixture) { response.status(404).json({ error: "fixture_not_found" }); return; }
  response.json({ data: fixture });
});

fixturesRouter.post("/", protectedRoute, (request, response) => {
  try { response.status(201).json({ data: createCanonicalFixture(request.body) }); }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = (error as { code?: string }).code ?? message;
    response.status(code === "invalid_starts_at" ? 400 : 409).json({ error: code, message });
  }
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

fixturesRouter.get("/:fixtureId/lineups", (request, response) => {
  const fixtureId = String(request.params.fixtureId ?? "");
  if (!getCanonicalFixtureById(fixtureId)) { response.status(404).json({ error: "fixture_not_found" }); return; }
  response.json({ data: getFixtureLineups(fixtureId) });
});

fixturesRouter.put("/:fixtureId/lineups", protectedRoute, (request, response) => {
  try {
    response.json({ data: saveFixtureLineup(String(request.params.fixtureId ?? ""), request.body) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const notFound = ["fixture_not_found", "season_squad_not_found", "formation_template_not_found"].includes(message);
    response.status(notFound ? 404 : 409).json({ error: message, message });
  }
});

fixturesRouter.delete("/:fixtureId/lineups/:teamId", protectedRoute, (request, response) => {
  const removed = clearFixtureLineup(String(request.params.fixtureId ?? ""), String(request.params.teamId ?? ""));
  if (!removed) { response.status(404).json({ error: "lineup_not_found" }); return; }
  response.status(204).send();
});