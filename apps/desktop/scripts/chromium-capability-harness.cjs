const { app, BrowserWindow } = require("electron");

app.disableHardwareAcceleration();

function finish(window, result, exitCode = 0) {
  console.log(JSON.stringify(result, null, 2));
  window?.destroy();
  app.exit(exitCode);
}

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  try {
    await window.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(`
      <!doctype html>
      <html><body><video id="video" muted></video><script>
        window.runCapabilityProbe = async () => {
          const video = document.getElementById("video");
          const candidates = [
            "video/mp4",
            "video/mp4; codecs=\\\"avc1.42E01E,mp4a.40.2\\\"",
            "video/webm",
            "video/webm; codecs=\\\"vp8,vorbis\\\""
          ];
          const supportedMimeTypes = candidates.filter((mime) => MediaSource.isTypeSupported(mime));
          const result = {
            userAgent: navigator.userAgent,
            mediaSourceAvailable: typeof MediaSource !== "undefined",
            sourceBufferAvailable: typeof SourceBuffer !== "undefined",
            supportedMimeTypes,
            mediaSourceCreated: false,
            sourceBufferCreated: false,
            appendBuffer: "NOT_RUN",
            updateend: false,
            cleanup: false,
            error: null
          };
          if (!result.mediaSourceAvailable || !result.sourceBufferAvailable || !supportedMimeTypes.length) return result;
          const mediaSource = new MediaSource();
          result.mediaSourceCreated = true;
          const objectUrl = URL.createObjectURL(mediaSource);
          video.src = objectUrl;
          await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error("mediasource_open_timeout")), 5000);
            mediaSource.addEventListener("sourceopen", () => { clearTimeout(timeout); resolve(); }, { once: true });
            mediaSource.addEventListener("error", () => { clearTimeout(timeout); reject(new Error("mediasource_error")); }, { once: true });
          });
          const sourceBuffer = mediaSource.addSourceBuffer(supportedMimeTypes[0]);
          result.sourceBufferCreated = true;
          await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error("sourcebuffer_update_timeout")), 5000);
            sourceBuffer.addEventListener("updateend", () => { clearTimeout(timeout); result.updateend = true; resolve(); }, { once: true });
            sourceBuffer.addEventListener("error", () => { clearTimeout(timeout); reject(new Error("sourcebuffer_error")); }, { once: true });
            try {
              // Empty append verifies the live Chromium SourceBuffer update lifecycle.
              sourceBuffer.appendBuffer(new Uint8Array(0));
              result.appendBuffer = "PASS";
            } catch (error) {
              clearTimeout(timeout);
              reject(error);
            }
          });
          if (mediaSource.readyState === "open") mediaSource.endOfStream();
          video.removeAttribute("src");
          video.load();
          URL.revokeObjectURL(objectUrl);
          result.cleanup = true;
          return result;
        };
      </script></body></html>
    `));
    const result = await window.webContents.executeJavaScript("window.runCapabilityProbe()", true);
    finish(window, result, result.error ? 1 : 0);
  } catch (error) {
    finish(window, { error: error instanceof Error ? error.message : String(error) }, 1);
  }
});

app.on("window-all-closed", () => app.quit());
