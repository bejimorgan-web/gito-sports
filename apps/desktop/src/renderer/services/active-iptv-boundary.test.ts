import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rendererDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readRendererFile(relativePath: string) {
  return fs.readFileSync(path.join(rendererDirectory, relativePath), "utf8");
}

test("active Desktop IPTV workflow has no Render IPTV call sites", () => {
  const productionSources = [
    readRendererFile("App.tsx"),
    readRendererFile("features/broadcast/BroadcastConsoleScreen.tsx"),
    readRendererFile("features/clubs/FixtureWorkspaceScreen.tsx")
  ];
  const forbiddenCalls = [
    "getProviderDiagnostics",
    "listProviders",
    "listChannels",
    "testProvider",
    "testProviderById",
    "startIptvOperation",
    "getIptvOperation",
    "cancelIptvOperation",
    "listIptvCatalogueCategories",
    "listIptvChannels",
    "listIptvMovies",
    "listIptvSeries",
    "listIptvSeasons",
    "listIptvEpisodes",
    "listIptvEpgChannels",
    "listIptvEpgProgrammes"
  ];

  for (const source of productionSources) {
    for (const method of forbiddenCalls) {
      assert.equal(new RegExp(`apiClient\\.${method}\\s*\\(`).test(source), false, `active Render IPTV call remains: ${method}`);
    }
  }
});