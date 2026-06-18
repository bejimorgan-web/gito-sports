import Hls from "hls.js";
import { memo, useCallback, useEffect, useRef, useState } from "react";

import type { Channel } from "@gito/shared";
import { getEventClient, getStreamStateGuard } from "@gito/shared";
import { apiClient } from "../../services/api-client";

interface StreamPreviewPanelProps {
  channel: Channel | undefined;
  compact?: boolean;
  onPreviewReady: (channelId: string) => void;
  onHealthChange?: (status: "active" | "degraded" | "failed" | "unknown", reason?: string) => void;
  apiBaseUrl?: string;
}

type PlaybackState = "idle" | "playing" | "buffering" | "recovering" | "failed";

export const StreamPreviewPanel = memo(function StreamPreviewPanel({
  channel,
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
    const video = videoRef.current;
    let stallTimer: number | undefined;

    const previewTrace = (type: string, detail?: string) => {
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
      updateStatus("No channel selected");
      onHealthChange?.("unknown", "No channel selected.");
      return undefined;
    }

    const activeVideo = video;
    const activeChannelId = channel.id;
    const activeChannelName = channel.name;

    previewTrace("preview started", `channel id=${activeChannelId} name=${activeChannelName}`);
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
      markFailed(errorMessage);
    }

    function handleLoadedMetadata() {
      previewTrace("metadata loaded", `duration=${activeVideo.duration}`);
    }

    function handleLoadedData() {
      previewTrace("data loaded");
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
        previewTrace("retry aborted", `max retries reached for url=${url}`);
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
          // Self-healing: fetch latest channel URL from API before retrying
          let latestUrl = url;
          if (apiBaseUrl && activeChannelId) {
            try {
              const channels = await apiClient.listChannels();
              const updatedChannel = channels.find((ch: any) => ch.id === activeChannelId);
              if (updatedChannel?.url) {
                latestUrl = updatedChannel.url;
                if (latestUrl !== url) {
                  previewTrace("auto-rebind stream", `old=${url} new=${latestUrl}`);
                  currentStreamUrlRef.current = latestUrl;
                }
              }
            } catch (error) {
              previewTrace("auto-rebind failed", `error=${String(error)}, using cached url`);
              // Fall back to cached URL if API fetch fails
            }
          }
          previewTrace("retrying stream", `attempt=${retryAttemptRef.current} url=${latestUrl}`);
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
        previewTrace("mounting HLS stream", url);
        cleanupHls();
        const hls = new Hls({
          backBufferLength: 30,
          lowLatencyMode: true,
          maxBufferLength: 10
        });
        hlsRef.current = hls;
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
          void activeVideo.play().catch(() => updateStatus("Preview ready. Press play to start."));
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
        previewTrace("mounting direct video src", url);
        cleanupHls();
        if (restoreTime !== undefined) {
          activeVideo.currentTime = restoreTime;
        }
        activeVideo.src = url;
        previewTrace("video source assigned");
        updateStatus("Preview ready");
        previewTrace("onPreviewReady fired", `channel id=${channelId}`);
        onPreviewReady(channelId);
        void activeVideo.play().catch((error) => {
          previewTrace("playback start failed", String(error));
          updateStatus("Preview ready. Press play to start.");
        });
      }
    }

    function cleanupHls() {
      if (hlsRef.current) {
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
      // Reset state guard for next preview session
      stateGuardRef.current.reset();

      // Cleanup event subscriptions
      for (const unsub of eventUnsubscribesRef.current) {
        unsub();
      }
      eventUnsubscribesRef.current = [];

      window.clearTimeout(stallTimer);
      window.clearTimeout(retryTimerRef.current);
      cleanupHls();
      video.removeEventListener("playing", markActive);
      video.removeEventListener("canplay", markActive);
      video.removeEventListener("timeupdate", handleTimeUpdate);
      video.removeEventListener("waiting", handleWaiting);
      video.removeEventListener("stalled", handleWaiting);
      video.removeEventListener("ended", handleEnded);
      video.removeEventListener("error", handleError);
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("loadeddata", handleLoadedData);
    };
  }, [channel, onHealthChange, onPreviewReady, retryRequestKey, updateStatus, apiBaseUrl]);

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
          {channel ? (
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
            <dd>{channel?.name ?? "Not selected"}</dd>
            <dt>Category</dt>
            <dd>{channel?.groupName ?? "Not selected"}</dd>
            <dt>Playback URL</dt>
            <dd className="break-word">{channel?.url ?? "Not selected"}</dd>
          </dl>
        </aside>
      </div>
    </section>
  );
});
