'use strict';
/*
 * Electron shell: starts the companion server in-process and shows the UI in
 * a frameless, transparent window shaped like a wrist computer.
 */
const { app, BrowserWindow, ipcMain, shell, screen } = require('electron');
const path = require('path');
const { PipServer } = require('../server/server');

let win = null;
let server = null;

// UI sounds are synthesized with WebAudio; let them play from the boot screen.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

async function createWindow() {
  server = new PipServer({ dataDir: path.join(app.getPath('userData'), 'data') });
  const url = await server.start();

  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  const width = Math.min(1440, Math.round(sw * 0.8));
  const height = Math.min(Math.round(width * 0.66), Math.round(sh * 0.9));

  win = new BrowserWindow({
    width,
    height,
    minWidth: 720,
    minHeight: 480,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    title: 'PIP-PILOT 3000',
    icon: path.join(__dirname, '..', 'web', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadURL(`${url}/?app=1`);
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    shell.openExternal(target);
    return { action: 'deny' };
  });
  win.on('closed', () => { win = null; });
}

ipcMain.on('win', (_e, action) => {
  if (!win) return;
  if (action === 'close') win.close();
  else if (action === 'minimize') win.minimize();
  else if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize();
  else if (action === 'fullscreen') win.setFullScreen(!win.isFullScreen());
  else if (action === 'top') win.setAlwaysOnTop(!win.isAlwaysOnTop(), 'floating');
});

app.whenReady().then(createWindow);

app.on('window-all-closed', async () => {
  if (server) await server.stop();
  app.quit();
});
