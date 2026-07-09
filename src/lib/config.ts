// ─── Config persistence helpers ──────────────────────────
// Pi config is now read/written directly to ~/.pi/agent/ via the API.
// This file provides localStorage-based import/export for backup.

import type { PiConfig, ExportPayload } from "@/types";

const STORAGE_KEY = "pi-web-switch-config";

export function saveLocalBackup(config: PiConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config, null, 2));
  } catch {
    // localStorage might be full
  }
}

export function loadLocalBackup(): PiConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as PiConfig;
  } catch {
    // ignore
  }
  return null;
}

export function exportConfig(config: PiConfig, filename?: string): void {
  const payload: ExportPayload = {
    version: "0.1.0",
    exportedAt: new Date().toISOString(),
    config,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename ?? `pi-web-switch-config-${new Date().toISOString().split("T")[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function parseImportFile(json: string): PiConfig | null {
  try {
    const payload = JSON.parse(json) as ExportPayload;
    if (payload.config?.settings && payload.config?.auth) {
      return payload.config;
    }
    // Try raw config
    if (json.includes("defaultProvider")) {
      return JSON.parse(json) as PiConfig;
    }
    return null;
  } catch {
    return null;
  }
}
