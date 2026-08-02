import { app, BrowserWindow, ipcMain, Menu } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import * as piReader from '../server/pi-reader';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Keep a global reference of the window object to prevent garbage collection
let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'pi-web-switch',
    icon: path.join(__dirname, '../public/pi.svg'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // In development, load the Vite dev server
  // In production, load the built files
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Open DevTools in development
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
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

  ipcMain.handle('pi:settings:set', (_event, data: any) => {
    return piReader.writeSettings(data);
  });

  // Auth
  ipcMain.handle('pi:auth:get', () => {
    return piReader.readAuth();
  });

  ipcMain.handle('pi:auth:set', (_event, data: any) => {
    return piReader.writeAuth(data);
  });

  // Models
  ipcMain.handle('pi:models:get', () => {
    return piReader.readModels();
  });

  ipcMain.handle('pi:models:set', (_event, data: any) => {
    return piReader.writeModels(data);
  });
}

app.whenReady().then(() => {
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
