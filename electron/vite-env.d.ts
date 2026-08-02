/// <reference types="vite/client" />

interface PiAPI {
  getSettings: () => Promise<any>;
  setSettings: (data: any) => Promise<boolean>;
  getAuth: () => Promise<any>;
  setAuth: (data: any) => Promise<boolean>;
  getModels: () => Promise<any>;
  setModels: (data: any) => Promise<boolean>;
}

declare global {
  interface Window {
    piAPI: PiAPI;
  }
}

export {};
