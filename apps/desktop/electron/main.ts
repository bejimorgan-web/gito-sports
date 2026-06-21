import { app, BrowserWindow, ipcMain } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
// Respect the explicit environment-provided dev server URL. Fallback to
// http://localhost:4200 when not provided.
const devServerUrl = process.env.VITE_DEV_SERVER_URL ? String(process.env.VITE_DEV_SERVER_URL) : "http://localhost:4200";
const isDev = typeof process.env.VITE_DEV_SERVER_URL !== "undefined";

// Diagnostic: log which URL Electron will attempt to load in dev.
console.log("ELECTRON MODE", process.env.NODE_ENV ?? "(unset)");
console.log("ELECTRON: using VITE_DEV_SERVER_URL=", process.env.VITE_DEV_SERVER_URL ?? "(unset)");
console.log("ELECTRON: effective devServerUrl=", devServerUrl);
const productionIndexFile = fileURLToPath(new URL("../index.html", import.meta.url));
const errorHtml = `data:text/html,<html><body style="font-family:system-ui, sans-serif; display:flex; align-items:center; justify-content:center; height:100vh; margin:0; background:#1a1a1a; color:#fff;"><div style="max-width:760px; text-align:center;"><h1>Application Load Error</h1><p>The application could not load the frontend content.</p><p>Please ensure the app was built successfully or start the development server.</p><pre style="text-align:left; margin-top:24px; padding:16px; background:#111; color:#f66; border-radius:8px;">${productionIndexFile.replace(/&/g, "%26").replace(/</g, "%3C").replace(/>/g, "%3E")}</pre></div></body></html>`;

function loadErrorScreen(window: BrowserWindow) {
  void window.loadURL(errorHtml);
}

function createMainWindow() {
  const preloadScript = path.join(currentDirectory, "preload.cjs");
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1180,
    minHeight: 760,
    title: "GiTO Live Sports",
    webPreferences: {
      preload: preloadScript,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Enable DevTools only in development mode
  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  // Capture console messages
  mainWindow.webContents.on("console-message", (level, message, line, sourceId) => {
    console.log(`[RENDERER CONSOLE ${level}] ${sourceId}:${line} - ${message}`);
  });

  // Capture render process gone (crash/termination)
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error(`[RENDERER CRASH] ${details.reason}`);
  });

  // Log when content finishes loading
  mainWindow.webContents.on("did-finish-load", () => {
    console.log("[RENDERER] Content finished loading");
    // Check DOM and script loading status inside renderer
    void mainWindow.webContents
      .executeJavaScript(`({
        hasRoot: !!document.getElementById('root'),
        rootHtml: document.getElementById('root')?.innerHTML || null,
        scripts: Array.from(document.scripts).map(s => s.src || s.getAttribute('src')),
        errors: (window.__collectedErrors__ && window.__collectedErrors__.slice(0,20)) || null
      })`)
      .then((info: any) => {
        console.log('[RENDERER REPORT]', JSON.stringify(info));
      })
      .catch((err: any) => {
        console.error('[RENDERER REPORT ERROR]', err);
      });
  });

  // Capture network request failures from the renderer session
  try {
    const ses = mainWindow.webContents.session;
    const allUrlsFilter = { urls: ["*://*/*"] };
    ses.webRequest.onErrorOccurred(allUrlsFilter, (details) => {
      console.error(`[NETWORK ERROR] ${details.url} - ${details.error}`);
    });
    ses.webRequest.onCompleted(allUrlsFilter, (details) => {
      if (details.statusCode >= 400) {
        console.error(`[NETWORK STATUS ${details.statusCode}] ${details.url}`);
      }
    });
  } catch (e) {
    console.error('[NETWORK LISTENER ERROR]', e);
  }

  if (isDev) {
    void mainWindow.loadURL(devServerUrl).catch(() => loadErrorScreen(mainWindow));
    return;
  }

  if (!fs.existsSync(productionIndexFile)) {
    loadErrorScreen(mainWindow);
    return;
  }

  void mainWindow.loadFile(productionIndexFile).catch(() => loadErrorScreen(mainWindow));
}

app.whenReady().then(createMainWindow);

// Receive forwarded renderer errors
ipcMain.on('renderer-error', (_event, data) => {
  console.error('[RENDERER IPC ERROR]', data);
});
ipcMain.on('renderer-console-error', (_event, args) => {
  console.error('[RENDERER IPC CONSOLE ERROR]', args);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});
