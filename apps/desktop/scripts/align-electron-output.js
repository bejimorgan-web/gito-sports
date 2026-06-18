import fs from "node:fs";
import path from "node:path";

const buildDir = path.resolve("./dist");
const sourceDir = path.join(buildDir, "apps", "desktop", "electron");
const targetDir = path.join(buildDir, "electron");
const electronFiles = [
  { source: "main.js", target: "main.js" }
];

const preloadContent = `const { contextBridge, ipcRenderer } = require("electron");

// Collect runtime errors and forward to main for debugging
window.__collectedErrors__ = window.__collectedErrors__ || [];

window.addEventListener('error', (e) => {
  try {
    const payload = { type: 'error', message: e.message, filename: e.filename, lineno: e.lineno, colno: e.colno };
    window.__collectedErrors__.push(payload);
    ipcRenderer.send('renderer-error', payload);
  } catch (err) {}
});

window.addEventListener('unhandledrejection', (ev) => {
  try {
    const payload = { type: 'unhandledrejection', reason: (ev.reason && (ev.reason.message || String(ev.reason))) };
    window.__collectedErrors__.push(payload);
    ipcRenderer.send('renderer-error', payload);
  } catch (err) {}
});

const _origConsoleError = console.error.bind(console);
console.error = function(...args) {
  try {
    window.__collectedErrors__.push({ type: 'console.error', args });
    ipcRenderer.send('renderer-console-error', args);
  } catch (err) {}
  _origConsoleError(...args);
};

contextBridge.exposeInMainWorld("gito", {
  platform: "desktop"
});
`;

fs.mkdirSync(targetDir, { recursive: true });

for (const file of electronFiles) {
  const sourceFile = path.join(sourceDir, file.source);
  const targetFile = path.join(targetDir, file.target);

  if (!fs.existsSync(sourceFile)) {
    throw new Error(`Missing compiled Electron file: ${sourceFile}`);
  }

  fs.copyFileSync(sourceFile, targetFile);
}

fs.writeFileSync(path.join(targetDir, "preload.cjs"), preloadContent, "utf8");
