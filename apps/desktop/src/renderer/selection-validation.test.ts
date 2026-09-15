import assert from "node:assert/strict";
import test from "node:test";
import type { Channel, IPTVProvider } from "@gito/shared";
import { isSelectedChannelAuthoritativelyDeleted, isSelectedChannelProviderValid } from "./selection-validation";

const channel: Channel = {
  id: "A",
  providerId: "X",
  name: "Channel A",
  url: "https://example.test/a.m3u8",
  contentType: "live",
  status: "active",
  createdAt: "",
  updatedAt: ""
};

const provider = (id: string, deleted = 0): IPTVProvider => ({
  id,
  name: id,
  baseUrl: `https://${id}.example`,
  type: "m3u",
  authType: "none",
  status: "active",
  availabilityStatus: "online",
  failedChannelLoads: 0,
  healthScore: 100,
  username: null,
  password: null,
  expiresAt: null,
  createdAt: "",
  updatedAt: "",
  ...(deleted ? { deleted } : {})
});

test("routine refresh preserves selected channel by provider identity", () => {
  assert.equal(isSelectedChannelProviderValid(channel, [provider("X")]), true);
  assert.equal(isSelectedChannelProviderValid(channel, [provider("X"), provider("Y")]), true);
});

test("refreshed page absence does not invalidate selected channel", () => {
  const refreshedPage: Channel[] = [];
  assert.equal(refreshedPage.some((item) => item.id === channel.id), false);
  assert.equal(isSelectedChannelProviderValid(channel, [provider("X")]), true);
  assert.equal(isSelectedChannelAuthoritativelyDeleted(channel, undefined), false);
});

test("authoritative deletion and intentional provider change invalidate selection", () => {
  assert.equal(isSelectedChannelAuthoritativelyDeleted(channel, false), true);
  assert.equal(isSelectedChannelProviderValid(channel, [provider("Y")]), false);
  assert.equal(isSelectedChannelProviderValid({ ...channel }, [provider("X")]), true);
});