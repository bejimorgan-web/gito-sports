import { Router } from "express";
import type { CreateProviderRequest } from "@gito/shared";
import { IPTVService } from "../services/iptv-service.js";
import { parseM3uPlaylist, M3uParseError } from "../services/m3u-parser.js";
import { fetchXtreamChannels, testXtreamConnection, XtreamParseError } from "../services/xtream-codes.js";
import { validateHttpStreamUrl } from "../services/url-validation.js";
import { logChannelSyncTrace } from "../services/iptv-trace.js";

type ChannelListMode = "active" | "includeInactive" | "debug" | "raw";

async function validateProviderConnection(input: {
  baseUrl?: string;
  username?: string;
  password?: string;
  type?: string;
  providerId?: string;
}) {
  const { baseUrl, type, providerId } = input;
  const storedCredentials = providerId ? IPTVService.getProviderCredentials(providerId) : undefined;
  const username = input.username ?? (storedCredentials as any)?.credential_username ?? undefined;
  const password = input.password ?? (storedCredentials as any)?.credential_password ?? undefined;

  if (!baseUrl) {
    return { ok: false, message: "Base URL is required." };
  }

  if (type === "xtream") {
    if (!username || !password) {
      return { ok: false, message: "Xtream providers require both username and password." };
    }

    const testResult = await testXtreamConnection(baseUrl, username, password);
    if (!testResult.ok) {
      return {
        ...testResult,
        channels: [] as any[]
      };
    }

    const invalidEntries: XtreamParseError[] = [];
    const channels = await fetchXtreamChannels(baseUrl, username, password, (entry) => invalidEntries.push(entry));

    return {
      ok: channels.length > 0,
      statusCode: testResult.statusCode,
      message: channels.length > 0 ? "Xtream provider connection is valid." : "No channels were returned for this Xtream account.",
      channels,
      channelsParsed: channels.length,
      channelsRejected: invalidEntries.length,
      categories: Array.from(new Set(channels.map((channel) => channel.groupName).filter(Boolean) as string[])),
      rejectedChannels: invalidEntries.slice(0, 10)
    };
  }

  try {
    const testResponse = await fetch(baseUrl, { method: "GET" });

    if (!testResponse.ok) {
      return {
        ok: false,
        statusCode: testResponse.status,
        message: "Provider returned an error."
      };
    }

    const bodyText = await testResponse.text();
    const invalidEntries: M3uParseError[] = [];
    const parsed = parseM3uPlaylist(bodyText, (entry) => invalidEntries.push(entry));

    if (parsed.length === 0) {
      return {
        ok: false,
        statusCode: testResponse.status,
        message: "Provider responded but playlist is empty or invalid."
      };
    }

    const validChannels: Array<{ name: string; url: string; externalRef?: string; groupName?: string }> = [];
    const invalidChannels: Array<{ name: string; url: string; error: string }> = [];

    for (const ch of parsed) {
      const error = validateHttpStreamUrl(ch.url);
      if (error) {
        invalidChannels.push({ name: ch.name, url: ch.url, error });
      } else {
        validChannels.push(ch);
      }
    }

    return {
      ok: validChannels.length > 0,
      statusCode: testResponse.status,
      message: validChannels.length > 0 ? "Provider connection is valid." : "No valid channels could be parsed from the playlist.",
      channels: validChannels,
      channelsParsed: parsed.length,
      channelsRejected: invalidChannels.length,
      categories: Array.from(new Set(validChannels.map((channel) => channel.groupName).filter(Boolean) as string[])),
      rejectedChannels: invalidChannels.slice(0, 10)
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Provider connection failed."
    };
  }
}

async function persistValidatedProvider(providerId: string, validation: Awaited<ReturnType<typeof validateProviderConnection>>, input: { type?: string }) {
  if (!validation.ok) {
    return false;
  }

  if (input.type && input.type !== "manual" && Array.isArray(validation.channels) && validation.channels.length > 0) {
    IPTVService.syncProviderChannels(providerId, validation.channels as any[]);
  }

  IPTVService.setProviderStatus(providerId, "active");
  return true;
}

export const iptvRouter = Router();

iptvRouter.get("/providers", (_request, response) => {
  response.json({
    data: IPTVService.listProviders()
  });
});

iptvRouter.get("/providers/:providerId", (request, response) => {
  const provider = IPTVService.getProvider(request.params.providerId);

  if (!provider) {
    response.status(404).json({ error: "provider_not_found" });
    return;
  }

  response.json({ data: provider });
});

iptvRouter.post("/providers", async (request, response) => {
  const body = request.body as CreateProviderRequest;

  if (!body.name || !body.baseUrl || !body.type) {
    response.status(400).json({ error: "provider_name_base_url_and_type_required" });
    return;
  }

  const validation = await validateProviderConnection(body);
  if (!validation.ok) {
    response.status(400).json({ error: "provider_validation_failed", message: validation.message });
    return;
  }

  const provider = IPTVService.createProvider(body);
  if (provider) {
    try {
      await persistValidatedProvider(provider.id, validation, body);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/foreign key|constraint/i.test(message)) {
        IPTVService.setProviderStatus(provider.id, "failed");
        response.status(201).json({
          data: IPTVService.getProvider(provider.id) ?? provider,
          meta: {
            warning: "provider_saved_without_channels",
            message: "The provider record was saved, but the channel import could not be completed because the database rejected the channel link."
          }
        });
        return;
      }
      throw error;
    }
  }

  response.status(201).json({ data: provider ? IPTVService.getProvider(provider.id) ?? provider : provider });
});

iptvRouter.put("/providers/:providerId", async (request, response) => {
  const input = request.body as Partial<CreateProviderRequest>;
  const existing = IPTVService.getProvider(request.params.providerId);

  if (!existing) {
    response.status(404).json({ error: "provider_not_found" });
    return;
  }

  const validation = await validateProviderConnection({
    baseUrl: input.baseUrl ?? existing.baseUrl,
    username: input.username ?? undefined,
    password: input.password ?? undefined,
    type: input.type ?? existing.type,
    providerId: request.params.providerId
  });

  if (!validation.ok) {
    response.status(400).json({ error: "provider_validation_failed", message: validation.message });
    return;
  }

  const updated = IPTVService.updateProvider(request.params.providerId, input);

  if (!updated) {
    response.status(404).json({ error: "provider_not_found" });
    return;
  }

  try {
    await persistValidatedProvider(updated.id, validation, updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/foreign key|constraint/i.test(message)) {
      IPTVService.setProviderStatus(updated.id, "failed");
      response.json({
        data: IPTVService.getProvider(updated.id) ?? updated,
        meta: {
          warning: "provider_saved_without_channels",
          message: "The provider was updated, but the channel import could not be completed because the database rejected the channel link."
        }
      });
      return;
    }
    throw error;
  }

  response.json({ data: IPTVService.getProvider(updated.id) ?? updated });
});

iptvRouter.delete("/providers/:providerId", (request, response) => {
  const ok = IPTVService.deleteProvider(request.params.providerId);

  if (!ok) {
    response.status(404).json({ error: "provider_not_found" });
    return;
  }

  response.status(204).send();
});

iptvRouter.get("/channels", (request, response) => {
  const providerId = typeof request.query.providerId === "string" ? request.query.providerId : undefined;
  const q = typeof request.query.q === "string" ? request.query.q.trim() : undefined;
  const category = typeof request.query.category === "string" ? request.query.category : undefined;
  const mode = typeof request.query.mode === "string" ? request.query.mode : undefined;
  const debug = request.query.debug === "true";
  const includeInactive = request.query.includeInactive === "true";

  const opts: { providerId?: string; q?: string; category?: string } = {};
  if (providerId) opts.providerId = providerId;
  if (q) opts.q = q;
  if (category) opts.category = category;

  const allowedModes = new Set(["active", "includeInactive", "debug", "raw"] as const);
  let channelMode: ChannelListMode = "active";

  if (typeof mode === "string") {
    if (!allowedModes.has(mode as any)) {
      response.status(400).json({ error: "invalid_mode_value", message: "mode must be one of active, includeInactive, debug, or raw." });
      return;
    }
    channelMode = mode as ChannelListMode;
  } else if (debug) {
    channelMode = "debug";
  } else if (includeInactive) {
    channelMode = "includeInactive";
  }

  response.json({
    data: IPTVService.listChannels(opts, channelMode)
  });
});

iptvRouter.get("/channels/debug", (request, response) => {
  const providerId = typeof request.query.providerId === "string" ? request.query.providerId : undefined;
  const q = typeof request.query.q === "string" ? request.query.q.trim() : undefined;
  const category = typeof request.query.category === "string" ? request.query.category : undefined;

  const opts: { providerId?: string; q?: string; category?: string } = {};
  if (providerId) opts.providerId = providerId;
  if (q) opts.q = q;
  if (category) opts.category = category;

  response.json({
    data: IPTVService.listChannelsDebug(opts)
  });
});

iptvRouter.get("/providers/:providerId/diagnostics", (request, response) => {
  const providerId = request.params.providerId;
  const diagnostics = IPTVService.getProviderChannelDiagnostics(providerId);

  if (!diagnostics) {
    response.status(404).json({ error: "provider_not_found" });
    return;
  }

  response.json({ data: diagnostics });
});

iptvRouter.get("/categories", (request, response) => {
  const providerId = typeof request.query.providerId === "string" ? request.query.providerId : undefined;

  response.json({
    data: IPTVService.listCategories(providerId)
  });
});

iptvRouter.post("/providers/test", async (request: any, response: any) => {
  const { baseUrl, username, password, type } = request.body as {
    baseUrl?: string;
    username?: string;
    password?: string;
    type?: string;
  };

  const providerId = String(request.params?.providerId ?? request.body?.providerId ?? "");

  const validation = await validateProviderConnection({ baseUrl, username, password, type, providerId });
  if (!validation.ok) {
    if (providerId) {
      IPTVService.setProviderStatus(providerId, 'failed');
    }
    response.status(400).json({
      error: "provider_validation_failed",
      message: validation.message
    });
    return;
  }

  if (providerId) {
    await persistValidatedProvider(providerId, validation, { type });
  }

  response.json({
    data: {
      ok: true,
      statusCode: (validation as any).statusCode,
      message: validation.message,
      channelsCreated: Array.isArray(validation.channels) ? validation.channels.length : 0,
      channelsParsed: (validation as any).channelsParsed ?? 0,
      channelsRejected: (validation as any).channelsRejected ?? 0,
      categories: (validation as any).categories ?? [],
      rejectedChannels: (validation as any).rejectedChannels ?? []
    }
  });
});

iptvRouter.post("/providers/:providerId/test", async (request, response) => {
  const provider = IPTVService.getProvider(request.params.providerId);

  if (!provider) {
    response.status(404).json({ error: "provider_not_found" });
    return;
  }

  const validation = await validateProviderConnection({
    baseUrl: provider.baseUrl,
    username: undefined,
    password: undefined,
    type: provider.type,
    providerId: provider.id
  });

  if (!validation.ok) {
    IPTVService.setProviderStatus(provider.id, 'failed');
    response.status(400).json({ error: "provider_validation_failed", message: validation.message });
    return;
  }

  await persistValidatedProvider(provider.id, validation, provider);

  response.json({
    data: {
      ok: true,
      statusCode: (validation as any).statusCode,
      message: validation.message,
      channelsCreated: Array.isArray(validation.channels) ? validation.channels.length : 0,
      channelsParsed: (validation as any).channelsParsed ?? 0,
      channelsRejected: (validation as any).channelsRejected ?? 0,
      categories: (validation as any).categories ?? [],
      rejectedChannels: (validation as any).rejectedChannels ?? []
    }
  });
});

iptvRouter.post("/providers/:providerId/m3u", (request, response) => {
  const { playlist } = request.body as { playlist?: string };
  const providerId = request.params.providerId;

  if (!playlist) {
    response.status(400).json({ error: "playlist_required" });
    return;
  }

  const provider = IPTVService.getProvider(providerId);
  if (!provider) {
    response.status(404).json({ error: "provider_not_found" });
    return;
  }

  const invalidEntries: M3uParseError[] = [];
  const parsedChannels = parseM3uPlaylist(playlist, (entry) => invalidEntries.push(entry));
  const validChannels: typeof parsedChannels = [];
  const invalidChannels: { name: string; url: string; error: string }[] = [];

  for (const invalid of invalidEntries) {
    logChannelSyncTrace({
      providerId,
      providerMode: (provider as any)?.syncMode ?? "partial",
      syncPhase: "parse",
      action: "reject",
      reason: invalid.reason,
      payload: invalid
    });
  }

  for (const ch of parsedChannels) {
    const error = validateHttpStreamUrl(ch.url);
    if (error) {
      invalidChannels.push({ name: ch.name, url: ch.url, error });
    } else {
      validChannels.push(ch);
    }
  }

  const channels = validChannels.length > 0 ? IPTVService.syncProviderChannels(providerId, validChannels) : [];

  response.status(201).json({
    data: {
      channelsCreated: channels.length,
      channelsParsed: parsedChannels.length,
      channelsRejected: invalidChannels.length,
      categories: Array.from(new Set(channels.map((channel) => (channel as any).category).filter(Boolean))),
      rejectedChannels: invalidChannels.slice(0, 10)
    }
  });
});

// Allow operator to manually set provider status (active, inactive, failed, pending, invalid)
iptvRouter.post("/providers/:providerId/status", async (request, response) => {
  const { status } = request.body as { status?: string };
  const allowed = new Set(["active", "inactive", "failed", "pending", "invalid"]);

  if (!status || typeof status !== "string" || !allowed.has(status)) {
    response.status(400).json({ error: "invalid_status_value" });
    return;
  }

  const provider = IPTVService.getProvider(request.params.providerId);

  if (!provider) {
    response.status(404).json({ error: "provider_not_found" });
    return;
  }

  if (status === "active") {
    const provider = IPTVService.getProvider(request.params.providerId);
    if (!provider) {
      response.status(404).json({ error: "provider_not_found" });
      return;
    }

    const validation = await validateProviderConnection({
      baseUrl: provider.baseUrl,
      username: undefined,
      password: undefined,
      type: provider.type,
      providerId: provider.id
    });

    if (!validation.ok) {
      IPTVService.setProviderStatus(request.params.providerId, 'failed');
      response.status(400).json({ error: "provider_validation_failed", message: validation.message });
      return;
    }

    await persistValidatedProvider(provider.id, validation, provider);
  } else {
    IPTVService.setProviderStatus(request.params.providerId, status as any);
  }

  response.json({ data: IPTVService.getProvider(request.params.providerId) });
});

iptvRouter.post("/providers/:providerId/xtream/sync", async (request, response) => {
  const provider = IPTVService.getProviderCredentials(request.params.providerId);

  if (!provider) {
    response.status(404).json({ error: "provider_not_found" });
    return;
  }

  if (provider.type !== "xtream") {
    response.status(400).json({ error: "provider_not_xtream" });
    return;
  }

  const username = (provider as any).credential_username ?? (provider as any).username ?? null;
  const password = (provider as any).credential_password ?? (provider as any).password ?? null;
  const serverUrl = (provider as any).server_url ?? (provider as any).base_url ?? (provider as any).baseUrl ?? null;

  if (!username || !password) {
    response.status(400).json({ error: "stored_xtream_credentials_required" });
    return;
  }

  if (!serverUrl) {
    response.status(400).json({ error: "stored_xtream_server_url_required" });
    return;
  }

  const invalidEntries: XtreamParseError[] = [];
  const parsedChannels = await fetchXtreamChannels(
    serverUrl,
    username,
    password,
    (entry) => invalidEntries.push(entry)
  );

  for (const invalid of invalidEntries) {
    logChannelSyncTrace({
      providerId: request.params.providerId,
      providerMode: (provider as any).syncMode ?? (provider as any).sync_mode ?? "partial",
      syncPhase: "parse",
      action: "reject",
      reason: invalid.reason,
      payload: invalid
    });
  }
  const validChannels: typeof parsedChannels = [];
  const invalidChannels: { name: string; url: string; error: string }[] = [];

  for (const ch of parsedChannels) {
    const error = validateHttpStreamUrl(ch.url);
    if (error) {
      invalidChannels.push({ name: ch.name, url: ch.url, error });
    } else {
      validChannels.push(ch);
    }
  }

  const channels = validChannels.length > 0 ? IPTVService.syncProviderChannels(request.params.providerId, validChannels) : [];

  response.status(201).json({
    data: {
      channelsCreated: channels.length,
      channelsParsed: parsedChannels.length,
      channelsRejected: invalidChannels.length,
      categories: Array.from(new Set(channels.map((channel) => (channel as any).category).filter(Boolean))),
      rejectedChannels: invalidChannels.slice(0, 10)
    }
  });
});

// IPTV parity diagnostic endpoint: compares external expectations vs GiTO storage
iptvRouter.get("/parity/:providerId", (request, response) => {
  const diagnostic = IPTVService.getParityDiagnostics(request.params.providerId);

  if (!diagnostic) {
    response.status(404).json({ error: "provider_not_found" });
    return;
  }

  response.json({ data: diagnostic });
});

export default iptvRouter;
