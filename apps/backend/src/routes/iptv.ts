import { Router } from "express";

import type { CreateProviderRequest } from "@gito/shared";

import { IPTVService } from "../services/iptv-service";
import { parseM3uPlaylist, M3uParseError } from "../services/m3u-parser";
import { fetchXtreamChannels, testXtreamConnection, XtreamParseError } from "../services/xtream-codes";
import { validateHttpStreamUrl } from "../services/url-validation";
import { logChannelSyncTrace } from "../services/iptv-trace";

type ChannelListMode = "active" | "includeInactive" | "debug" | "raw";

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

iptvRouter.post("/providers", (request, response) => {
  const body = request.body as CreateProviderRequest;

  if (!body.name || !body.baseUrl || !body.type) {
    response.status(400).json({ error: "provider_name_base_url_and_type_required" });
    return;
  }

  const provider = IPTVService.createProvider(body);

  // Created providers start in pending state and must be tested explicitly.
  response.status(201).json({ data: provider });
});

iptvRouter.put("/providers/:providerId", (request, response) => {
  const input = request.body as Partial<CreateProviderRequest>;

  const updated = IPTVService.updateProvider(request.params.providerId, input);

  if (!updated) {
    response.status(404).json({ error: "provider_not_found" });
    return;
  }

  response.json({ data: updated });
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

iptvRouter.post("/providers/test", async (request, response) => {
  const { baseUrl, username, password, type } = request.body as {
    baseUrl?: string;
    username?: string;
    password?: string;
    type?: string;
  };

  if (!baseUrl) {
    response.status(400).json({ error: "base_url_required" });
    return;
  }

  if (type === "xtream") {
    if (!username || !password) {
      response.status(400).json({ error: "xtream_credentials_required" });
      return;
    }

    response.json({
      data: await testXtreamConnection(baseUrl, username, password)
    });
    return;
  }

  try {
    const testResponse = await fetch(baseUrl, { method: "GET" });

    if (!testResponse.ok) {
      response.json({
        data: {
          ok: false,
          statusCode: testResponse.status,
          message: "Provider returned an error."
        }
      });
      return;
    }

    if (type === "m3u") {
      const body = await testResponse.text();
      const invalidEntries: M3uParseError[] = [];
      const parsed = parseM3uPlaylist(body, (entry) => invalidEntries.push(entry));

      for (const invalid of invalidEntries) {
        logChannelSyncTrace({
          providerMode: "partial",
          syncPhase: "parse",
          action: "reject",
          reason: invalid.reason,
          payload: invalid
        });
      }

      if (parsed.length === 0) {
        response.json({
          data: {
            ok: false,
            statusCode: testResponse.status,
            message: "Provider responded but playlist is empty or invalid."
          }
        });
        return;
      }

      response.json({
        data: {
          ok: true,
          statusCode: testResponse.status,
          message: `Provider validated and ${parsed.length} channels were found.`
        }
      });
      return;
    }

    response.json({
      data: {
        ok: true,
        statusCode: testResponse.status,
        message: "Provider responded."
      }
    });
  } catch (error) {
    response.json({
      data: {
        ok: false,
        message: error instanceof Error ? error.message : "Provider connection failed."
      }
    });
  }
});

// Test a stored provider and re-sync channels on success/failure
iptvRouter.post("/providers/:providerId/test", async (request, response) => {
  const provider = IPTVService.getProviderCredentials(request.params.providerId);

  if (!provider) {
    response.status(404).json({ error: "provider_not_found" });
    return;
  }

  const { base_url: baseUrl, credential_username: username, credential_password: password, type } = provider;

  // Run appropriate test
  try {
    let testResult;

    if (type === "xtream") {
      if (!username || !password) {
        response.status(400).json({ error: "stored_xtream_credentials_required" });
        return;
      }

      testResult = await testXtreamConnection(baseUrl, username, password);

      if (testResult.ok) {
        // fetch channels and sync
        const parsed = await fetchXtreamChannels(baseUrl, username, password);
        const validChannels: typeof parsed = [];
        const invalidChannels: { name: string; url: string; error: string }[] = [];

        for (const ch of parsed) {
          const error = validateHttpStreamUrl(ch.url);
          if (error) {
            invalidChannels.push({ name: ch.name, url: ch.url, error });
          } else {
            validChannels.push(ch);
          }
        }

        const channels = validChannels.length > 0 ? IPTVService.syncProviderChannels(request.params.providerId, validChannels) : [];
        IPTVService.setProviderStatus(request.params.providerId, channels.length > 0 ? 'active' : 'failed');

        response.json({ 
          data: { 
            test: testResult, 
            channelsCreated: channels.length,
            channelsParsed: parsed.length,
            channelsRejected: invalidChannels.length,
            rejectedChannels: invalidChannels.slice(0, 10)
          } 
        });
        return;
      }

      IPTVService.setProviderStatus(request.params.providerId, 'failed');
      response.json({ data: { test: testResult } });
      return;
    }

    // generic http test for m3u/manual
    try {
      const r = await fetch(baseUrl, { method: "GET" });

      if (r.ok) {
        if (type === "m3u") {
          const body = await r.text();
          const invalidEntries: M3uParseError[] = [];
          const parsed = parseM3uPlaylist(body, (entry) => invalidEntries.push(entry));

          for (const invalid of invalidEntries) {
            logChannelSyncTrace({
              providerId: request.params.providerId,
              providerMode: provider.sync_mode ?? "partial",
              syncPhase: "parse",
              action: "reject",
              reason: invalid.reason,
              payload: invalid
            });
          }

          if (parsed.length === 0) {
            IPTVService.setProviderStatus(request.params.providerId, 'failed');
            response.status(400).json({
              error: "playlist_contains_invalid_or_empty_m3u",
              message: "Provider responded but playlist is empty or invalid."
            });
            return;
          }

          const validChannels: typeof parsed = [];
          const invalidChannels: { name: string; url: string; error: string }[] = [];

          for (const ch of parsed) {
            const error = validateHttpStreamUrl(ch.url);
            if (error) {
              invalidChannels.push({ name: ch.name, url: ch.url, error });
            } else {
              validChannels.push(ch);
            }
          }

          const channels = validChannels.length > 0 ? IPTVService.syncProviderChannels(request.params.providerId, validChannels) : [];
          IPTVService.setProviderStatus(request.params.providerId, channels.length > 0 ? 'active' : 'failed');
          response.json({ 
            data: { 
              ok: channels.length > 0, 
              statusCode: r.status, 
              channelsCreated: channels.length,
              channelsParsed: parsed.length,
              channelsRejected: invalidChannels.length,
              categories: Array.from(new Set(channels.map((channel) => channel.groupName).filter(Boolean))),
              rejectedChannels: invalidChannels.slice(0, 10)
            } 
          });
          return;
        }

        response.json({ data: { ok: true, statusCode: r.status, message: "Provider responded." } });
        return;
      }

      IPTVService.setProviderStatus(request.params.providerId, 'failed');
      response.json({ data: { ok: false, statusCode: r.status } });
    } catch (error) {
      IPTVService.setProviderStatus(request.params.providerId, 'failed');
      response.json({ data: { ok: false, message: error instanceof Error ? error.message : "Provider connection failed." } });
    }
  } catch (error) {
    response.status(500).json({ error: "provider_test_failed", message: error instanceof Error ? error.message : String(error) });
  }
});

iptvRouter.post("/providers/:providerId/m3u", (request, response) => {
  const { playlist } = request.body as { playlist?: string };

  if (!playlist) {
    response.status(400).json({ error: "playlist_required" });
    return;
  }

  const invalidEntries: M3uParseError[] = [];
  const parsedChannels = parseM3uPlaylist(playlist, (entry) => invalidEntries.push(entry));
  const validChannels: typeof parsedChannels = [];
  const invalidChannels: { name: string; url: string; error: string }[] = [];

  for (const invalid of invalidEntries) {
    logChannelSyncTrace({
      providerId: request.params.providerId,
      providerMode: (IPTVService.getProvider(request.params.providerId) as any)?.syncMode ?? "partial",
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

  const channels = validChannels.length > 0 ? IPTVService.syncProviderChannels(request.params.providerId, validChannels) : [];

  response.status(201).json({
    data: {
      channelsCreated: channels.length,
      channelsParsed: parsedChannels.length,
      channelsRejected: invalidChannels.length,
      categories: Array.from(new Set(channels.map((channel) => channel.groupName).filter(Boolean))),
      rejectedChannels: invalidChannels.slice(0, 10)
    }
  });
});

// Allow operator to manually set provider status (active, inactive, failed, pending, invalid)
iptvRouter.post("/providers/:providerId/status", (request, response) => {
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

  // Persist status
  IPTVService.setProviderStatus(request.params.providerId, status as any);

  response.json({ data: IPTVService.getProvider(request.params.providerId) });
});

iptvRouter.post("/providers/:providerId/xtream/sync", async (request, response) => {
  const provider = IPTVService.getProviderCredentials(request.params.providerId);

  if (!provider?.credential_username || !provider.credential_password) {
    response.status(400).json({ error: "stored_xtream_credentials_required" });
    return;
  }

  const invalidEntries: XtreamParseError[] = [];
  const parsedChannels = await fetchXtreamChannels(
    provider.base_url,
    provider.credential_username,
    provider.credential_password,
    (entry) => invalidEntries.push(entry)
  );

  for (const invalid of invalidEntries) {
    logChannelSyncTrace({
      providerId: request.params.providerId,
      providerMode: provider.sync_mode ?? "partial",
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
      categories: Array.from(new Set(channels.map((channel) => channel.groupName).filter(Boolean))),
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