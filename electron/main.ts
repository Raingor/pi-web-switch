// Electron main process
// Use process.mainModule.require to access electron module within Electron
const { app, BrowserWindow, Menu, ipcMain, nativeImage } = (process as any).mainModule?.require('electron') || require('electron');
// Type-only import (erased at compile time) — does not affect the runtime require workaround above.
import type { BrowserWindow as BrowserWindowType, IpcMainInvokeEvent } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import * as piReader from '../server/pi-reader';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Keep a global reference of the window object to prevent garbage collection
let mainWindow: BrowserWindowType | null = null;

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'pi-web-switch',
    icon: path.join(__dirname, '../../public/icon-512.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow = win;

  // In development, load the Vite dev server
  // In production, load the built files
  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Open DevTools in development
  if (process.env.NODE_ENV === 'development') {
    win.webContents.openDevTools();
  }

  win.on('closed', () => {
    mainWindow = null;
  });
}

// Create application menu
function createMenu() {
  const template: any = [
    {
      label: 'Application',
      submenu: [
        { label: 'About Application', selector: 'orderFrontStandardAboutPanel:' },
        { type: 'separator' },
        { label: 'Quit', accelerator: 'Command+Q', click: () => app.quit() },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', selector: 'undo:' },
        { label: 'Redo', accelerator: 'Shift+CmdOrCtrl+Z', selector: 'redo:' },
        { type: 'separator' },
        { label: 'Cut', accelerator: 'CmdOrCtrl+X', selector: 'cut:' },
        { label: 'Copy', accelerator: 'CmdOrCtrl+C', selector: 'copy:' },
        { label: 'Paste', accelerator: 'CmdOrCtrl+V', selector: 'paste:' },
        { label: 'Select All', accelerator: 'CmdOrCtrl+A', selector: 'selectAll:' },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// IPC handlers for pi API routes
function setupIPC() {
  // Settings
  ipcMain.handle('pi:settings:get', () => {
    return piReader.readSettings();
  });

  ipcMain.handle('pi:settings:set', (_event: IpcMainInvokeEvent, data: any) => {
    return piReader.writeSettings(data);
  });

  // Auth
  ipcMain.handle('pi:auth:get', () => {
    return piReader.readAuth();
  });

  ipcMain.handle('pi:auth:set', (_event: IpcMainInvokeEvent, data: any) => {
    return piReader.writeAuth(data);
  });

  // Models
  ipcMain.handle('pi:models:get', () => {
    return piReader.readModels();
  });

  ipcMain.handle('pi:models:set', (_event: IpcMainInvokeEvent, data: any) => {
    return piReader.writeModels(data);
  });
}

// Set the macOS dock icon while running from source. In packaged builds the
// .icns embedded by electron-builder (build/icon.icns) provides the dock icon,
// so this is guarded to only act when the dev PNG actually exists.
function setDockIcon() {
  if (process.platform !== 'darwin' || !app.dock) return;
  const iconPath = path.join(__dirname, '../../public/icon-512.png');
  if (fs.existsSync(iconPath)) {
    try {
      app.dock.setIcon(nativeImage.createFromPath(iconPath));
    } catch {
      /* dock icon is cosmetic — ignore failures */
    }
  }
}

app.whenReady().then(() => {
  setDockIcon();
  createMenu();
  setupIPC();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
