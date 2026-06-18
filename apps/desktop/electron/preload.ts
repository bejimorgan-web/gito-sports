import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("gito", {
  platform: "desktop"
});

