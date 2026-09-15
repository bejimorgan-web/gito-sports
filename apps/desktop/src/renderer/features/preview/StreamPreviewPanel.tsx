import Hls from "hls.js";
import { memo, useCallback, useEffect, useRef, useState } from "react";

import type { Channel, IPTVProvider } from "@gito/shared";
import { getEventClient, getStreamStateGuard } from "@gito/shared";
import { apiClient } from "../../services/api-client";
import { createDesktopPlaybackLoader } from "../../services/desktop-playback-hls-loader";
import { mountDesktopNonHlsPlayback } from "../../services/desktop-playback-media-source";

interface StreamPreviewPanelProps {
  channel: Channel | undefined;
  playbackEntity?: { entityType: "movie" | "episode"; entityId: string };
  providerType?: IPTVProvider["type"] | undefined;
  compact?: boolean;
  onPreviewReady: (channelId: string) => void;
  onHealthChange?: (status: "active" | "degraded" | "failed" | "unknown", reason?: string) => void;
  apiBaseUrl?: string;
}

type PlaybackState = "idle" | "playing" | "buffering" | "recovering" | "failed";

function redactPreviewUrl(value: string | null | undefined) {
  if (!value) return value ?? null;
  try {
    const url = new URL(value);
    for (const key of ["username", "user", "password", "pass", "token", "api_key", "apikey"]) {
      if (url.searchParams.has(key)) url.searchParams.set(key, "[REDACTED]");
    }
    const segments = url.pathname.split("/");
    const liveIndex = segments.findIndex((segment) => segment.toLowerCase() === "live");
    if (liveIndex >= 0 && segments.length > liveIndex + 2) {
      segments[liveIndex + 1] = "[REDACTED]";
      segments[liveIndex + 2] = "[REDACTED]";
      url.pathname = segments.join("/");
    }
    return url.toString();
  } catch {
    return "[REDACTED-URL]";
  }
}

function createPreviewSessionId() {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID().slice(0, 8)
    : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export const StreamPreviewPanel = memo(function StreamPreviewPanel({
  channel,
  playbackEntity,
  providerType,
  compact = false,
  onHealthChange,
  onPreviewReady,
  apiBaseUrl
}: StreamPreviewPanelProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const failureCountRef = useRef(0);
  const retryAttemptRef = useRef(0);
  const retryTimerRef = useRef<number | undefined>(undefined);
  const hlsRef = useRef<Hls | null>(null);
  const currentStreamUrlRef = useRef<string | null>(null);
  const lastHealthEmitRef = useRef(0);
  const lastTimeRef = useRef(0);
  const statusRef = useRef("No channel selected");
  const eventUnsubscribesRef = useRef<Array<() => void>>([]);
  const stateGuardRef = useRef(getStreamStateGuard());
  const lastChannelRef = useRef<Channel>();
  const previousPropChannelRef = useRef<Channel>();

  useEffect(() => {
    console.info("[GITO-SELECTION-TRACE] PREVIEW_PROP_CHANNEL", {
      time: new Date().toISOString(),
      previous: previousPropChannelRef.current ? { id: previousPropChannelRef.current.id, providerId: previousPropChannelRef.current.providerId, name: previousPropChannelRef.current.name } : null,
      next: channel ? { id: channel.id, providerId: channel.providerId, name: channel.name } : null,
      sameObjectReference: previousPropChannelRef.current === channel
    });
    previousPropChannelRef.current = channel;
  }, [channel]);
  const [status, setStatus] = useState("No channel selected");
  const [playbackState, setPlaybackState] = useState<PlaybackState>("idle");
  const [retryAvailable, setRetryAvailable] = useState(false);
  const [retryRequestKey, setRetryRequestKey] = useState(0);

  const updateStatus = useCallback((nextStatus: string) => {
    if (statusRef.current === nextStatus) {
      return;
    }

    statusRef.current = nextStatus;
    setStatus(nextStatus);
  }, []);

  useEffect(() => {
    if (playbackEntity) return undefined;
    const video = videoRef.current;
    let stallTimer: number | undefined;
    const sessionId = createPreviewSessionId();
    const sessionStartedAt = performance.now();
    const diagnosticsEnabled = typeof window !== "undefined" && window.localStorage.getItem("GITO_IPTV_DIAGNOSTICS") === "1";
    const previewLog = (event: string, detail?: Record<string, unknown>) => {
      if (!diagnosticsEnabled) return;
      const elapsedMs = Math.round(performance.now() - sessionStartedAt);
      console.info(`[GITO-PREVIEW][session=${sessionId}][time=${new Date().toISOString()}][elapsedMs=${elapsedMs}] ${event}`, detail ?? {});
    };
    const channelDetails = (value: Channel | undefined) => ({
      channelId: value?.id ?? null,
      providerId: value?.providerId ?? null,
      channelName: value?.name ?? null,
      contentType: value?.contentType ?? null,
      providerType: value ? providerType ?? null : null,
      hasUrl: Boolean(value?.url),
      url: redactPreviewUrl(value?.url)
    });

    previewLog("SESSION_START", channelDetails(channel));
    previewLog("CHANNEL_CHANGE", {
      previousChannelId: lastChannelRef.current?.id ?? null,
      newChannelId: channel?.id ?? null,
      previousProviderId: lastChannelRef.current?.providerId ?? null,
      newProviderId: channel?.providerId ?? null,
      previousUrl: redactPreviewUrl(lastChannelRef.current?.url),
      newUrl: redactPreviewUrl(channel?.url)
    });
    lastChannelRef.current = channel;

    const previewTrace = (type: string, detail?: string) => {
      if (!diagnosticsEnabled) return;
      const message = `GITO_PREVIEW_TRACE: ${type}${detail ? ` - ${detail}` : ""}`;
      // eslint-disable-next-line no-console
      console.info(message);
      const logs = (window as any).__GITO_PREVIEW_LOGS__ as string[] | undefined;
      if (Array.isArray(logs)) {
        logs.push(message);
      } else {
        (window as any).__GITO_PREVIEW_LOGS__ = [message];
      }
    };

    if (!video || !channel) {
      previewTrace("preview not started", "no channel selected");
      previewLog("PREVIEW_NOT_STARTED", { reason: "no channel selected" });
      updateStatus("No channel selected");
      onHealthChange?.("unknown", "No channel selected.");
      return undefined;
    }

    const activeVideo = video;
    const activeChannelId = channel.id;
    const activeChannelName = channel.name;

    previewTrace("preview started", `channel id=${activeChannelId} name=${activeChannelName}`);
    previewLog("COMPONENT_MOUNT", channelDetails(channel));
    failureCountRef.current = 0;
    retryAttemptRef.current = 0;
    lastHealthEmitRef.current = 0;
    lastTimeRef.current = 0;
    currentStreamUrlRef.current = channel.url;
    updateStatus("Loading stream...");
    onHealthChange?.("unknown", "Loading stream.");

    function markActive() {
      const now = Date.now();

      // Validate state transition: * → playing
      if (!stateGuardRef.current.canTransition("playing", "playback:active")) {
        previewTrace("state transition rejected", "cannot transition to playing");
        return;
      }

      failureCountRef.current = 0;
      retryAttemptRef.current = 0;
      setRetryAvailable(false);
      setPlaybackState("playing");
      updateStatus("Preview active");
      previewTrace("player active");

      if (now - lastHealthEmitRef.current > 5000) {
        lastHealthEmitRef.current = now;
        onHealthChange?.("active");
      }
    }

    function markDegraded(reason: string) {
      // Validate state transition: * → buffering
      if (!stateGuardRef.current.canTransition("buffering", "playback:degraded")) {
        previewTrace("state transition rejected", `cannot transition to buffering: ${reason}`);
        return;
      }

      setPlaybackState("buffering");
      updateStatus(reason);
      previewTrace("player degraded", reason);
      onHealthChange?.("degraded", reason);
    }

    function markFailed(reason: string) {
      // Validate state transition: * → failed or recovering
      const shouldRetry = retryAttemptRef.current < 3;
      const nextState = shouldRetry ? "recovering" : "failed";

      if (!stateGuardRef.current.canTransition(nextState, "playback:failed")) {
        previewTrace("state transition rejected", `cannot transition to ${nextState}: ${reason}`);
        return;
      }

      failureCountRef.current += 1;
      setPlaybackState(nextState);
      updateStatus(shouldRetry ? "Reconnecting stream..." : "Stream disconnected. Press reconnect to retry.");
      previewTrace("player failed", reason);
      onHealthChange?.("failed", reason);
      scheduleRetry(reason);
    }

    function handleWaiting() {
      previewTrace("player waiting");
      previewLog("VIDEO_WAITING");
      markDegraded("Buffering or waiting for stream data.");
      window.clearTimeout(stallTimer);
      stallTimer = window.setTimeout(() => {
        if (activeVideo.currentTime === lastTimeRef.current) {
          markFailed("Playback stalled for too long.");
        }
      }, 12000);
    }

    function handleEnded() {
      previewTrace("player ended");
      previewLog("VIDEO_ENDED");
      markFailed("Playback ended unexpectedly.");
    }

    function handleTimeUpdate() {
      lastTimeRef.current = activeVideo.currentTime;
      previewTrace("time update", `currentTime=${activeVideo.currentTime}`);
      markActive();
    }

    function handleError() {
      const errorMessage = activeVideo.error?.message ?? "Video playback error.";
      previewTrace("video error", errorMessage);
      previewLog("VIDEO_ERROR", { errorCode: activeVideo.error?.code ?? null, errorMessage });
      markFailed(errorMessage);
    }

    function handleLoadedMetadata() {
      previewTrace("metadata loaded", `duration=${activeVideo.duration}`);
    }

    function handleLoadedData() {
      previewTrace("data loaded");
    }

    const nativeDiagnosticEvents = ["loadstart", "loadedmetadata", "loadeddata", "canplay", "canplaythrough", "play", "pause", "suspend", "seeking", "seeked", "emptied", "durationchange", "progress", "abort"] as const;
    const nativeDiagnosticHandlers = new Map<string, EventListener>();
    for (const eventName of nativeDiagnosticEvents) {
      const handler = () => {
        const mediaError = activeVideo.error;
        previewLog(`VIDEO_${eventName.toUpperCase()}`, {
          currentTime: activeVideo.currentTime,
          duration: activeVideo.duration,
          readyState: activeVideo.readyState,
          networkState: activeVideo.networkState,
          paused: activeVideo.paused,
          ended: activeVideo.ended,
          hasSrc: Boolean(activeVideo.src || activeVideo.currentSrc),
          errorCode: mediaError?.code ?? null,
          errorMessage: mediaError?.message ?? null
        });
      };
      nativeDiagnosticHandlers.set(eventName, handler);
      video.addEventListener(eventName, handler);
    }

    video.addEventListener("playing", markActive);
    video.addEventListener("canplay", markActive);
    video.addEventListener("timeupdate", handleTimeUpdate);
    video.addEventListener("waiting", handleWaiting);
    video.addEventListener("stalled", handleWaiting);
    video.addEventListener("ended", handleEnded);
    video.addEventListener("error", handleError);
    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    video.addEventListener("loadeddata", handleLoadedData);

    async function scheduleRetry(reason: string) {
      const url = currentStreamUrlRef.current;
      if (!url) {
        return;
      }

      if (retryAttemptRef.current >= 3) {
        previewTrace("retry aborted", `max retries reached for url=${redactPreviewUrl(url)}`);
        setRetryAvailable(true);
        return;
      }

      retryAttemptRef.current += 1;
      const retryDelays = [3000, 6000, 12000];
      const delayMs = retryDelays[retryAttemptRef.current - 1] ?? 12000;
      previewTrace("scheduling retry", `attempt=${retryAttemptRef.current} delayMs=${delayMs} reason=${reason}`);
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = window.setTimeout(async () => {
        try {
          // Resolve the latest local channel playback URL from Desktop-local storage before retrying.
          let latestUrl = url;
          if (activeChannelId) {
            previewLog("CHANNEL_REFRESH_START", { channelId: activeChannelId, source: "preview_retry_desktop_local" });
            try {
              const latestChannel = await window.gito?.desktopStorage?.channels.get?.(activeChannelId);
              previewLog("CHANNEL_REFRESH_RESULT", {
                channelId: activeChannelId,
                found: Boolean(latestChannel),
                hasPlaybackUrl: Boolean(latestChannel?.playbackUrl)
              });
              if (latestChannel?.playbackUrl) {
                latestUrl = latestChannel.playbackUrl;
                if (latestUrl !== url) {
                  previewTrace("auto-rebind stream", `old=${redactPreviewUrl(url)} new=${redactPreviewUrl(latestUrl)}`);
                  currentStreamUrlRef.current = latestUrl;
                }
              }
            } catch (error) {
              previewLog("CHANNEL_REFRESH_FAILED", { channelId: activeChannelId, error: String(error) });
              previewTrace("auto-rebind failed", "using cached url");
            }
          }
          previewTrace("retrying stream", `attempt=${retryAttemptRef.current} url=${redactPreviewUrl(latestUrl)}`);
          setPlaybackState("recovering");
          updateStatus(`Retrying stream (${retryAttemptRef.current}/3)...`);
          mountStream(latestUrl, activeChannelId);
        } catch (error) {
          previewTrace("retry error", String(error));
          markFailed("Retry attempt failed.");
        }
      }, delayMs);
    }

    function mountStream(url: string, channelId: string) {
      window.clearTimeout(stallTimer);
      const restoreTime = activeVideo.currentTime > 0 ? activeVideo.currentTime : undefined;
      if (Hls.isSupported() && url.includes(".m3u8")) {
        previewTrace("mounting HLS stream", redactPreviewUrl(url) ?? "redacted-url");
        previewLog("HLS_CREATE", { channelId, url: redactPreviewUrl(url), config: { backBufferLength: 30, lowLatencyMode: true, maxBufferLength: 10 } });
        cleanupHls("replace_stream");
        const hls = new Hls({
          backBufferLength: 30,
          lowLatencyMode: true,
          maxBufferLength: 10
        });
        hlsRef.current = hls;
        const logHlsEvent = (eventName: string, data?: any) => {
          previewLog(`HLS_${eventName}`, {
            url: redactPreviewUrl(data?.url ?? data?.frag?.url),
            type: data?.type ?? null,
            details: data?.details ?? null,
            fatal: data?.fatal ?? null,
            level: data?.level ?? data?.frag?.level ?? null,
            sn: data?.frag?.sn ?? null,
            responseCode: data?.response?.code ?? data?.response?.status ?? null,
            stats: data?.stats ? { loading: data.stats.loading, loaded: data.stats.loaded, total: data.stats.total } : null
          });
        };
        for (const [eventName, eventKey] of [
          ["MEDIA_ATTACHING", Hls.Events.MEDIA_ATTACHING],
          ["MEDIA_ATTACHED", Hls.Events.MEDIA_ATTACHED],
          ["MEDIA_DETACHING", Hls.Events.MEDIA_DETACHING],
          ["MEDIA_DETACHED", Hls.Events.MEDIA_DETACHED],
          ["MANIFEST_LOADING", Hls.Events.MANIFEST_LOADING],
          ["MANIFEST_LOADED", Hls.Events.MANIFEST_LOADED],
          ["MANIFEST_PARSED", Hls.Events.MANIFEST_PARSED],
          ["LEVEL_LOADING", Hls.Events.LEVEL_LOADING],
          ["LEVEL_LOADED", Hls.Events.LEVEL_LOADED],
          ["FRAG_LOADING", Hls.Events.FRAG_LOADING],
          ["FRAG_LOADED", Hls.Events.FRAG_LOADED],
          ["FRAG_LOAD_EMERGENCY_ABORTED", Hls.Events.FRAG_LOAD_EMERGENCY_ABORTED],
          ["FRAG_BUFFERED", Hls.Events.FRAG_BUFFERED],
          ["ERROR", Hls.Events.ERROR]
        ] as const) {
          hls.on(eventKey, (_event: string, data: any) => logHlsEvent(eventName, data));
        }
        hls.loadSource(url);
        hls.attachMedia(activeVideo);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          previewTrace("HLS manifest parsed");
          if (restoreTime !== undefined) {
            activeVideo.currentTime = restoreTime;
          }
          updateStatus("Preview ready");
          previewTrace("onPreviewReady fired", `channel id=${channelId}`);
          onPreviewReady(channelId);
          previewLog("PLAY_REQUEST", { channelId });
          void activeVideo.play().then(() => previewLog("PLAY_RESOLVED", { channelId })).catch((error) => {
            previewLog("PLAY_REJECTED", { name: error?.name ?? null, message: error?.message ?? String(error) });
            updateStatus("Preview ready. Press play to start.");
          });
        });
        hls.on(Hls.Events.ERROR, (_event, data) => {
          const errorDetails = data.details ?? "HLS stream warning/error";
          previewTrace("HLS error", `${errorDetails} (${data.type})`);
          if (data.fatal) {
            markFailed(data.details ?? "HLS stream failed.");
            return;
          }

          markDegraded(data.details ?? "HLS stream warning.");
        });
      } else {
        previewTrace("mounting direct video src", redactPreviewUrl(url) ?? "redacted-url");
        previewLog("NATIVE_SOURCE_ASSIGN", { channelId, url: redactPreviewUrl(url) });
        cleanupHls("replace_stream");
        if (restoreTime !== undefined) {
          activeVideo.currentTime = restoreTime;
        }
        activeVideo.src = url;
        previewTrace("video source assigned");
        updateStatus("Preview ready");
        previewTrace("onPreviewReady fired", `channel id=${channelId}`);
        onPreviewReady(channelId);
        previewLog("PLAY_REQUEST", { channelId });
        void activeVideo.play().then(() => previewLog("PLAY_RESOLVED", { channelId })).catch((error) => {
          previewTrace("playback start failed", String(error));
          previewLog("PLAY_REJECTED", { name: error?.name ?? null, message: error?.message ?? String(error) });
          updateStatus("Preview ready. Press play to start.");
        });
      }
    }

    function cleanupHls(reason = "cleanup") {
      if (hlsRef.current) {
        previewLog("HLS_CLEANUP_DESTROY", { reason });
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      activeVideo.removeAttribute("src");
      activeVideo.load();
    }

    // Subscribe to stream recovery events from backend
    if (apiBaseUrl) {
      try {
        const eventClient = getEventClient(apiBaseUrl);
        const unsubStreamRecovered = eventClient.on("stream:recovered", (payload: any) => {
          previewTrace("stream:recovered event received", `context=${JSON.stringify(payload)}`);
          if (failureCountRef.current > 0 && retryAttemptRef.current > 0) {
            // Validate state transition to recovering (from failed state)
            if (!stateGuardRef.current.canTransition("recovering", "stream:recovered")) {
              previewTrace("state transition rejected", "cannot transition to recovering from stream:recovered event");
              return;
            }
            previewTrace("auto-rebinding after stream recovery signal", "");
            setPlaybackState("recovering");
            updateStatus("Stream recovered. Reconnecting...");
            // Trigger retry with auto-rebind to latest URL
            scheduleRetry("Stream recovery signal from backend");
          }
        });
        eventUnsubscribesRef.current.push(unsubStreamRecovered);

        const unsubStreamReconnected = eventClient.on("stream:reconnected", (payload: any) => {
          previewTrace("stream:reconnected event received", `context=${JSON.stringify(payload)}`);
          if (failureCountRef.current > 0) {
            previewTrace("detected upstream reconnection, resetting failure count", "");
            failureCountRef.current = 0;
            // Attempt transition to recovered state if in recovering state
            if (stateGuardRef.current.canTransition("recovered", "stream:reconnected")) {
              previewTrace("transitioning to recovered state", "");
            }
          }
        });
        eventUnsubscribesRef.current.push(unsubStreamReconnected);
      } catch (error) {
        previewTrace("event subscription failed", String(error));
      }
    }

    const activeUrl = currentStreamUrlRef.current;
    if (activeUrl) {
      mountStream(activeUrl, activeChannelId);
    }

    return () => {
      previewLog("COMPONENT_UNMOUNT", channelDetails(channel));
      // Reset state guard for next preview session
      stateGuardRef.current.reset();

      // Cleanup event subscriptions
      for (const unsub of eventUnsubscribesRef.current) {
        unsub();
      }
      eventUnsubscribesRef.current = [];

      window.clearTimeout(stallTimer);
      window.clearTimeout(retryTimerRef.current);
      cleanupHls("component_unmount");
      video.removeEventListener("playing", markActive);
      video.removeEventListener("canplay", markActive);
      video.removeEventListener("timeupdate", handleTimeUpdate);
      video.removeEventListener("waiting", handleWaiting);
      video.removeEventListener("stalled", handleWaiting);
      video.removeEventListener("ended", handleEnded);
      video.removeEventListener("error", handleError);
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("loadeddata", handleLoadedData);
      for (const [eventName, handler] of nativeDiagnosticHandlers) {
        video.removeEventListener(eventName, handler);
      }
    };
  }, [channel, onHealthChange, onPreviewReady, retryRequestKey, updateStatus, apiBaseUrl, providerType, playbackEntity]);

  useEffect(() => {
    const video = videoRef.current;
    if (!playbackEntity || !video || !window.gito?.desktopPlayback) return undefined;
    let disposed = false;
    let cleanupMedia: (() => void) | undefined;
    let hls: Hls | undefined;
    const playback = window.gito.desktopPlayback;
    const entityId = playbackEntity.entityId;
    const start = async () => {
      try {
        updateStatus("Loading secure playback...");
        onHealthChange?.("unknown", "Loading secure playback.");
        const session = await playback.start(playbackEntity);
        if (disposed) {
          await playback.cancel(session.sessionId);
          return;
        }
        try {
          const manifestProbe = await playback.read({ sessionId: session.sessionId, requestId: crypto.randomUUID(), resourceId: "resource-001", resourceType: "manifest" });
          if (disposed) return;
          const Loader = createDesktopPlaybackLoader(playback, session.sessionId);
          hls = new Hls({ loader: Loader as any, pLoader: Loader as any, fLoader: Loader as any });
          hls.loadSource("gito-resource://resource-001");
          hls.attachMedia(video);
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            if (disposed) return;
            updateStatus("Preview ready");
            onPreviewReady(entityId);
            onHealthChange?.("active");
            void video.play().catch(() => updateStatus("Preview ready. Press play to start."));
          });
          void manifestProbe;
        } catch (error) {
          if (disposed) return;
          cleanupMedia = mountDesktopNonHlsPlayback(video, playback, session.sessionId, () => {
            if (!disposed) {
              updateStatus("Preview ready");
              onPreviewReady(entityId);
              onHealthChange?.("active");
              void video.play().catch(() => updateStatus("Preview ready. Press play to start."));
            }
          }, (mediaError) => {
            if (!disposed) {
              updateStatus("Playback unavailable");
              onHealthChange?.("failed", mediaError instanceof Error ? mediaError.message : "Playback unavailable.");
            }
          });
        }
        (video as HTMLVideoElement & { __gitoPlaybackSessionId?: string }).__gitoPlaybackSessionId = session.sessionId;
      } catch (error) {
        if (!disposed) {
          updateStatus("Unable to start playback");
          onHealthChange?.("failed", error instanceof Error ? error.message : "Unable to start playback.");
        }
      }
    };
    void start();
    return () => {
      disposed = true;
      hls?.destroy();
      cleanupMedia?.();
      const sessionId = (video as HTMLVideoElement & { __gitoPlaybackSessionId?: string }).__gitoPlaybackSessionId;
      if (sessionId) void playback.cancel(sessionId);
      delete (video as HTMLVideoElement & { __gitoPlaybackSessionId?: string }).__gitoPlaybackSessionId;
    };
  }, [onHealthChange, onPreviewReady, playbackEntity, updateStatus]);

  return (
    <section className={compact ? "preview-panel compact-preview" : "screen-stack"}>
      {!compact ? (
        <header className="screen-header">
          <p className="eyebrow">Preview</p>
          <h2>Live Stream Preview</h2>
          <span>Switch channels and validate playback before approval.</span>
        </header>
      ) : null}
      <div className="preview-layout">
        <section className="video-shell">
          {channel || playbackEntity ? (
            <video ref={videoRef} controls playsInline preload="metadata" />
          ) : (
            <div className="video-placeholder">Select a channel to preview</div>
          )}
        </section>
        <aside className="console-panel">
          <div className="panel-heading">
            <h3>Stream Status</h3>
            <span className="status-pill">{status}</span>
          </div>
          {retryAvailable ? (
            <div className="retry-action">
              <button
                type="button"
                className="retry-button"
                onClick={() => {
                  setRetryAvailable(false);
                  setRetryRequestKey((current) => current + 1);
                  setPlaybackState("recovering");
                  updateStatus("Retrying stream...");
                }}
              >
                Reconnect stream
              </button>
            </div>
          ) : null}
          <dl>
            <dt>Channel</dt>
            <dd>{channel?.name ?? (playbackEntity ? `${playbackEntity.entityType} ${playbackEntity.entityId}` : "Not selected")}</dd>
            <dt>Category</dt>
            <dd>{channel?.groupName ?? (playbackEntity ? "Desktop playback" : "Not selected")}</dd>
            <dt>Playback URL</dt>
            <dd className="break-word">{channel ? channel.url : playbackEntity ? "Secure playback session" : "Not selected"}</dd>
          </dl>
        </aside>
      </div>
    </section>
  );
});
