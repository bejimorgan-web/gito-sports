import fs from "node:fs";
import path from "node:path";

const buildDir = path.resolve("./dist");
const sourceDir = path.join(buildDir, "apps", "desktop", "electron");
const targetDir = path.join(buildDir, "electron");
const sourcePreloadFile = path.join(sourceDir, "preload.js");
const targetPreloadFile = path.join(targetDir, "preload.cjs");
const electronFiles = fs
  .readdirSync(sourceDir)
  .filter((file) => file.endsWith(".js"))
  .map((file) => ({ source: file, target: file }));

fs.mkdirSync(targetDir, { recursive: true });

for (const file of electronFiles) {
  const sourceFile = path.join(sourceDir, file.source);
  const targetFile = path.join(targetDir, file.target);

  if (!fs.existsSync(sourceFile)) {
    throw new Error(`Missing compiled Electron file: ${sourceFile}`);
  }

  fs.copyFileSync(sourceFile, targetFile);
}

if (!fs.existsSync(sourcePreloadFile)) {
  throw new Error(`Missing compiled preload bridge: ${sourcePreloadFile}`);
}

const compiledPreload = fs.readFileSync(sourcePreloadFile, "utf8");
const preloadContent = compiledPreload.replace(
  'import { contextBridge, ipcRenderer } from "electron";',
  'const { contextBridge, ipcRenderer } = require("electron");'
);

fs.writeFileSync(targetPreloadFile, preloadContent, "utf8");
