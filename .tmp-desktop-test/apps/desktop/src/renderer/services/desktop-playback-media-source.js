const RANGE_SIZE = 1024 * 1024;
export function mountDesktopNonHlsPlayback(video, playback, sessionId, onReady, onError) {
    if (typeof MediaSource === "undefined") {
        onError(new Error("playback_unsupported_format"));
        return () => undefined;
    }
    const mediaSource = new MediaSource();
    const objectUrl = URL.createObjectURL(mediaSource);
    let sourceBuffer;
    let nextOffset = 0;
    let totalLength;
    let ended = false;
    let disposed = false;
    let reading = false;
    const queued = [];
    const appendNext = () => {
        if (disposed || !sourceBuffer || sourceBuffer.updating || !queued.length)
            return;
        sourceBuffer.appendBuffer(queued.shift());
        if (!queued.length && !ended)
            void readNext();
    };
    const readNext = async () => {
        if (disposed || reading || ended)
            return;
        reading = true;
        try {
            const response = await playback.read({
                sessionId,
                requestId: crypto.randomUUID(),
                resourceId: "resource-001",
                resourceType: "media",
                byteRange: { start: nextOffset, end: nextOffset + RANGE_SIZE - 1 }
            });
            if (disposed)
                return;
            if (response.contentType && !sourceBuffer) {
                sourceBuffer = mediaSource.addSourceBuffer(response.contentType);
                sourceBuffer.addEventListener("updateend", appendNext);
                onReady();
            }
            queued.push(response.data);
            appendNext();
            nextOffset += response.data.byteLength;
            totalLength = response.totalLength ?? totalLength;
            ended = response.done || (totalLength !== undefined && nextOffset >= totalLength);
            if (ended && mediaSource.readyState === "open" && !sourceBuffer?.updating && !queued.length)
                mediaSource.endOfStream();
        }
        catch (error) {
            if (!disposed)
                onError(error);
        }
        finally {
            reading = false;
        }
    };
    const sourceOpen = () => { void readNext(); };
    mediaSource.addEventListener("sourceopen", sourceOpen, { once: true });
    video.src = objectUrl;
    return () => {
        disposed = true;
        mediaSource.removeEventListener("sourceopen", sourceOpen);
        if (sourceBuffer)
            sourceBuffer.removeEventListener("updateend", appendNext);
        video.removeAttribute("src");
        video.load();
        URL.revokeObjectURL(objectUrl);
    };
}
