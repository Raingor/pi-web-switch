import type { PiConfig, ExportPayload } from "@/types";
import { DEFAULT_PI_CONFIG } from "@/data/mock-config";

const STORAGE_KEY = "pi-web-switch-config";

export function loadConfig(): PiConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PiConfig;
      return parsed;
    }
  } catch {
    // ignore
  }
  return structuredClone(DEFAULT_PI_CONFIG);
}

export function saveConfig(config: PiConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config, null, 2));
}

export function exportConfig(config: PiConfig): ExportPayload {
  return {
    version: "0.1.0",
    exportedAt: new Date().toISOString(),
    config,
  };
}

export function downloadConfig(config: PiConfig): void {
  const payload = exportConfig(config);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `pi-web-switch-config-${new Date().toISOString().split("T")[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function importConfig(json: string): PiConfig | null {
  try {
    const payload = JSON.parse(json) as ExportPayload;
    if (payload.config?.settings && payload.config?.auth) {
      saveConfig(payload.config);
      return payload.config;
    }
    // Try raw config
    if (json.includes("defaultProvider")) {
      const config = JSON.parse(json) as PiConfig;
      saveConfig(config);
      return config;
    }
    return null;
  } catch {
    return null;
  }
}

export function resetConfig(): PiConfig {
  const config = structuredClone(DEFAULT_PI_CONFIG);
  saveConfig(config);
  return config;
}