import test from "node:test";
import assert from "node:assert/strict";

import { mapIptvChannelRow, mapIptvProviderRow } from "./iptv-shape.js";

test("maps IPTV provider rows to the shared UI DTO shape", () => {
  const provider = mapIptvProviderRow({
    id: "prov_1",
    name: "Example",
    type: "m3u",
    server_url: "https://example.com/playlist.m3u",
    encrypted_credentials: null,
    expires_at: null,
    enabled: 1,
    health_status: "unknown",
    last_refresh_at: null,
    total_channels: 2,
    created_at: "2024-01-01T00:00:00.000Z",
    updated_at: "2024-01-01T00:00:00.000Z"
  });

  assert.equal(provider.baseUrl, "https://example.com/playlist.m3u");
  assert.equal(provider.type, "m3u");
  assert.equal(provider.status, "active");
  assert.equal(provider.availabilityStatus, "unknown");
});

test("maps IPTV channel rows to the shared UI channel shape", () => {
  const channel = mapIptvChannelRow({
    id: "chan_1",
    provider_id: "prov_1",
    provider_channel_id: "ext-1",
    name: "News",
    logo_url: null,
    category: "News",
    language: null,
    country: null,
    resolution: null,
    stream_url: "https://example.com/live.m3u8",
    checksum: "abc",
    created_at: "2024-01-01T00:00:00.000Z",
    updated_at: "2024-01-01T00:00:00.000Z"
  });

  assert.equal(channel.providerId, "prov_1");
  assert.equal(channel.url, "https://example.com/live.m3u8");
  assert.equal(channel.groupName, "News");
  assert.equal(channel.externalRef, "ext-1");
});
