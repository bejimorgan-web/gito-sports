import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("gito", {
  platform: "desktop",
  onNavigateToScreen: (callback: (screen: string) => void) => {
    const listener = (_event: unknown, screen: string) => callback(screen);
    ipcRenderer.on("navigate-to-screen", listener);
    return () => ipcRenderer.removeListener("navigate-to-screen", listener);
  },
  sendRendererError: (error: unknown) => {
    try {
      ipcRenderer.send('renderer-error', {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : null,
        timestamp: new Date().toISOString(),
      });
    } catch {
      // best effort
    }
  },
  sendRendererConsoleError: (args: unknown) => {
    try {
      ipcRenderer.send('renderer-console-error', args);
    } catch {
      // best effort
    }
  }
});

