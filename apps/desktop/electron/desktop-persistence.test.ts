import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MemoryCredentialStore } from "./credential-store.js";
import { createDesktopPersistenceHandlers } from "./desktop-persistence-handlers.js";
import {
  DesktopSqliteStore,
  validateChannelInput,
  validateOperationInput,
  validateProviderAccountInput,
  validatePublicationSourceInput
} from "./desktop-storage.js";

function temporaryDatabasePath() {
  return path.join(os.tmpdir(), `gito-desktop-storage-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
}

test("Desktop SQLite initializes idempotently and persists metadata across reopen", () => {
  const databasePath = temporaryDatabasePath();
  try {
    const first = new DesktopSqliteStore(databasePath);
    const provider = first.createProviderAccount({
      name: "Synthetic Provider",
      type: "xtream",
      baseUrl: "https://provider.example",
      credentialStoreRef: "credential-provider-1"
    });
    const channel = first.upsertChannel({
      providerAccountId: provider.id,
      name: "Synthetic Channel",
      playbackUrl: "https://provider.example/live/user/password/1.m3u8"
    });
    const operation = first.upsertOperation({
      providerAccountId: provider.id,
      operationType: "synthetic_validation",
      status: "running",
      checkpoint: "phase-1"
    });
    first.close();

    const second = new DesktopSqliteStore(databasePath);
    assert.equal(second.getProviderAccount(provider.id)?.name, "Synthetic Provider");
    assert.equal(second.getChannel(channel.id)?.playbackUrl, "https://provider.example/live/user/password/1.m3u8");
    assert.equal(second.getOperation(operation.id)?.checkpoint, "phase-1");
    second.close();
  } finally {
    fs.rmSync(databasePath, { force: true });
    for (const suffix of ["-wal", "-shm"]) fs.rmSync(`${databasePath}${suffix}`, { force: true });
  }
});

test("credentials are separate from provider metadata and support deletion", () => {
  const credentialStore = new MemoryCredentialStore();
  credentialStore.set("credential-provider-1", "test-user", "test-password");
  assert.deepEqual(credentialStore.get("credential-provider-1"), { username: "test-user", password: "test-password" });
  credentialStore.delete("credential-provider-1");
  assert.equal(credentialStore.get("credential-provider-1"), null);

  const metadata = {
    id: "provider-1",
    name: "Synthetic Provider",
    credentialStoreRef: "credential-provider-1"
  };
  assert.equal(JSON.stringify(metadata).includes("test-password"), false);
  assert.equal("password" in metadata, false);
});

test("storage and IPC input validators reject unexpected fields", () => {
  assert.throws(() => validateProviderAccountInput({
    name: "Provider",
    type: "m3u",
    baseUrl: "https://provider.example",
    credentialStoreRef: "credential-1",
    password: "unexpected"
  } as never), /desktop_storage_field_not_allowed/);
  assert.throws(() => validateChannelInput({
    providerAccountId: "provider-1",
    name: "Channel",
    playbackUrl: "https://provider.example/live/1.m3u8",
    sql: "DROP TABLE channels"
  } as never), /desktop_storage_field_not_allowed/);
  assert.throws(() => validateOperationInput({
    operationType: "validation",
    sql: "SELECT * FROM provider_accounts"
  } as never), /desktop_storage_field_not_allowed/);
  assert.throws(() => validatePublicationSourceInput({
    publicationId: "publication-1",
    sourceReference: "https://provider.example/live/1.m3u8"
  } as never), /publication_source_reference_invalid/);
  assert.throws(() => validatePublicationSourceInput({
    publicationId: "",
    sourceReference: "source-1"
  } as never), /publication_id_invalid|publication_id_required/);
});

test("publication sources persist, survive reopen, and support historical replacement", () => {
  const databasePath = temporaryDatabasePath();
  const store = new DesktopSqliteStore(databasePath);
  try {
    const provider = store.createProviderAccount({
      name: "Synthetic Provider",
      type: "xtream",
      baseUrl: "https://provider.example",
      credentialStoreRef: "credential-provider-2"
    });
    const channel = store.upsertChannel({
      providerAccountId: provider.id,
      name: "Synthetic Channel",
      playbackUrl: "https://provider.example/live/user/password/1.m3u8"
    });

    const mappingA = store.upsertPublicationSource({
      publicationId: "publication-A",
      sourceReference: "source-A",
      providerAccountId: provider.id,
      channelId: channel.id
    });
    const mappingB = store.upsertPublicationSource({
      publicationId: "publication-B",
      sourceReference: "source-B",
      providerAccountId: provider.id,
      channelId: channel.id
    });

    assert.equal(store.getPublicationSource("publication-A")?.sourceReference, "source-A");
    assert.equal(store.getPublicationSource("publication-B")?.sourceReference, "source-B");
    assert.equal(store.listPublicationSources().length, 2);

    store.close();

    const reopened = new DesktopSqliteStore(databasePath);
    assert.deepEqual(reopened.getPublicationSource("publication-A"), mappingA);
    assert.deepEqual(reopened.getPublicationSource("publication-B"), mappingB);

    reopened.deletePublicationSource("publication-A");
    assert.equal(reopened.getPublicationSource("publication-A"), null);
    assert.equal(reopened.getPublicationSource("publication-B")?.sourceReference, "source-B");
    reopened.close();
  } finally {
    fs.rmSync(databasePath, { force: true });
    for (const suffix of ["-wal", "-shm"]) fs.rmSync(`${databasePath}${suffix}`, { force: true });
  }
});

test("EPG relationships reject cross-provider parents", () => {
  const databasePath = temporaryDatabasePath();
  const store = new DesktopSqliteStore(databasePath);
  try {
    const providerA = store.createProviderAccount({ name: "Provider A", type: "xtream", baseUrl: "https://a.example", credentialStoreRef: "epg-a" });
    const providerB = store.createProviderAccount({ name: "Provider B", type: "xtream", baseUrl: "https://b.example", credentialStoreRef: "epg-b" });
    const channelA = store.upsertChannel({ providerAccountId: providerA.id, externalReference: "channel-1", name: "Channel A", playbackUrl: "https://a.example/live" });
    const epgChannelA = store.upsertEpgChannel({ providerAccountId: providerA.id, externalReference: "epg-1", channelId: channelA.id, name: "EPG A" });
    assert.throws(() => store.upsertEpgChannel({ providerAccountId: providerB.id, externalReference: "epg-1", channelId: channelA.id, name: "EPG B" }), /epg_channel_provider_mismatch/);
    assert.throws(() => store.upsertEpgProgramme({ providerAccountId: providerB.id, epgChannelId: epgChannelA.id, externalReference: "programme-1", title: "Programme", startAt: "2023-01-01T00:00:00.000Z", endAt: "2023-01-01T01:00:00.000Z" }), /epg_programme_provider_mismatch/);
  } finally {
    store.close();
    fs.rmSync(databasePath, { force: true });
    for (const suffix of ["-wal", "-shm"]) fs.rmSync(`${databasePath}${suffix}`, { force: true });
  }
});

test("IPC handler surface is explicit and cannot execute arbitrary SQL or filesystem access", () => {
  const databasePath = temporaryDatabasePath();
  const store = new DesktopSqliteStore(databasePath);
  const credentials = new MemoryCredentialStore();
  try {
    const handlers = createDesktopPersistenceHandlers(store, credentials);
    assert.deepEqual(Object.keys(handlers).sort(), [
      "cancelOperation",
      "categoriesArchive",
      "categoriesDelete",
      "categoriesGet",
      "categoriesList",
      "categoriesUpsert",
      "channelsGet",
      "channelsList",
      "channelsUpsert",
      "credentialsDelete",
      "credentialsSet",
      "epgChannelsArchive",
      "epgChannelsDelete",
      "epgChannelsGet",
      "epgChannelsList",
      "epgChannelsUpsert",
      "epgProgrammesArchive",
      "epgProgrammesDelete",
      "epgProgrammesGet",
      "epgProgrammesList",
      "epgProgrammesUpsert",
      "episodesArchive",
      "episodesDelete",
      "episodesGet",
      "episodesList",
      "episodesUpsert",
      "getOperation",
      "moviesArchive",
      "moviesDelete",
      "moviesGet",
      "moviesList",
      "moviesUpsert",
      "operationsGet",
      "operationsList",
      "operationsUpsert",
      "playbackCancel",
      "playbackRead",
      "playbackStart",
      "providerAccountsCreate",
      "providerAccountsDelete",
      "providerAccountsGet",
      "providerAccountsList",
      "providerAccountsUpdate",
      "publicationSourcesDelete",
      "publicationSourcesGet",
      "publicationSourcesList",
      "publicationSourcesUpsert",
      "seasonsArchive",
      "seasonsDelete",
      "seasonsGet",
      "seasonsList",
      "seasonsUpsert",
      "seriesArchive",
      "seriesDelete",
      "seriesGet",
      "seriesList",
      "seriesUpsert",
      "startEpgSync",
      "startM3uCatalogueSync",
      "startOperation",
      "startXtreamCatalogueSync",
      "validateProvider",
      "validateProviderById"
    ]);
    assert.equal("executeSql" in handlers, false);
    assert.equal("readFile" in handlers, false);
    const provider = handlers.providerAccountsCreate({ name: "IPC Provider", type: "m3u", baseUrl: "https://provider.example", credentialStoreRef: "credential-ipc" });
    assert.equal(handlers.providerAccountsGet(provider.id)?.credentialStoreRef, "credential-ipc");
    handlers.credentialsSet("credential-ipc", "test-user", "test-password");
    assert.deepEqual(credentials.get("credential-ipc"), { username: "test-user", password: "test-password" });
  } finally {
    store.close();
    fs.rmSync(databasePath, { force: true });
  }
});
