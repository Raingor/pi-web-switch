import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('piAPI', {
  // Settings
  getSettings: () => ipcRenderer.invoke('pi:settings:get'),
  setSettings: (data: any) => ipcRenderer.invoke('pi:settings:set', data),
  
  // Auth
  getAuth: () => ipcRenderer.invoke('pi:auth:get'),
  setAuth: (data: any) => ipcRenderer.invoke('pi:auth:set', data),
  
  // Models
  getModels: () => ipcRenderer.invoke('pi:models:get'),
  setModels: (data: any) => ipcRenderer.invoke('pi:models:set', data),
});
