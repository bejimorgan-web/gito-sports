const path = require('path');
const { app, BrowserWindow } = require('electron');
app.whenReady().then(async () => {
  const preload = path.resolve('apps/desktop/dist/electron/preload.cjs');
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><html><body><script>window.__probe = { platform: window.gito?.platform, desktopStorage: !!window.gito?.desktopStorage, desktopCredentials: !!window.gito?.desktopCredentials, desktopIptv: !!window.gito?.desktopIptv, desktopPlayback: !!window.gito?.desktopPlayback, providerAccountsCreate: typeof window.gito?.desktopStorage?.providerAccounts?.create, startOperation: typeof window.gito?.desktopIptv?.startOperation };</script></body></html>'));
  const result = await win.webContents.executeJavaScript('window.__probe');
  console.log(JSON.stringify(result, null, 2));
  win.destroy();
  app.exit(0);
});
