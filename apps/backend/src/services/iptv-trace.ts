export type ProviderSyncMode = "partial" | "full";
export type ChannelSyncTracePhase = "parse" | "dedupe" | "persist" | "finalize";
export type ChannelSyncTraceAction = "insert" | "update" | "skip" | "reject" | "stale" | "complete";

export interface ChannelSyncTracePayload {
  providerId?: string;
  providerMode: ProviderSyncMode;
  syncPhase: ChannelSyncTracePhase;
  action: ChannelSyncTraceAction;
  reason?: string | null;
  channel?: {
    externalRef?: string | null;
    normalizedUrl?: string;
    originalName?: string;
    groupName?: string | null;
  };
  payload?: unknown;
  timestamp?: string;
}

export function logChannelSyncTrace(trace: ChannelSyncTracePayload) {
  const timestamp = trace.timestamp ?? new Date().toISOString();
  console.log(JSON.stringify({
    event: "channel_sync_trace",
    providerId: trace.providerId ?? null,
    providerMode: trace.providerMode,
    syncPhase: trace.syncPhase,
    action: trace.action,
    reason: trace.reason ?? null,
    channel: trace.channel ?? null,
    payload: trace.payload ?? null,
    timestamp
  }));
}
