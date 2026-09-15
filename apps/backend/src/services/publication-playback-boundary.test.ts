import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const backendSource = path.resolve(process.cwd(), "src");

function source(relativePath: string) {
  return fs.readFileSync(path.join(backendSource, relativePath), "utf8");
}

test("mobile fixture playback is publication-delivery-only", () => {
  const mobileReadModel = source("services/mobile-read-model-service.ts");
  assert.match(mobileReadModel, /getPublishedPublicationDeliveryByMatchId/);
  assert.doesNotMatch(mobileReadModel, /FROM streams|JOIN channels|JOIN providers|match_streams/);
  assert.doesNotMatch(mobileReadModel, /streamUrl|channelUrl|providerUrl/);
});

test("startup and health no longer require IPTV playback tables or recovery", () => {
  const connection = source("db/connection.ts");
  const health = source("routes/health.ts");
  const server = source("server.ts");
  assert.doesNotMatch(connection, /rehydrate-providers|rehydrateSyncStateOnStartup/);
  assert.doesNotMatch(server, /IptvOperationManager|recoverInterrupted/);
  assert.doesNotMatch(health, /requiredTables[\s\S]*providers|requiredTables[\s\S]*channels|requiredTables[\s\S]*streams/);
});

test("sports deletion no longer performs IPTV stream cleanup", () => {
  const entityDeletion = source("services/entityDeleteService.ts");
  assert.doesNotMatch(entityDeletion, /match_streams|DELETE FROM streams/);
});

test("migration imports no longer accept provider/channel/stream tables", () => {
  const importer = source("db/migration-import.ts");
  const route = source("routes/migration.routes.ts");
  for (const table of ["providers", "channels", "match_streams", "streams"]) {
    assert.doesNotMatch(importer, new RegExp(`^[ \\t]*[\"']${table}[\"'],?$`, "m"));
    assert.doesNotMatch(route, new RegExp(`^[ \\t]*[\"']${table}[\"'],?$`, "m"));
  }
});