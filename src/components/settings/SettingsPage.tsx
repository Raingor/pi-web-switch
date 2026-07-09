import { useState, useRef } from "react";
import { useConfigStore } from "@/store/config-store";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { exportConfig, parseImportFile, saveLocalBackup } from "@/lib/config";
import type { PiConfig } from "@/types";
import { cn } from "@/lib/utils";
import {
  Settings,
  Download,
  Upload,
  RotateCcw,
  Sun,
  Moon,
  Monitor,
  Package,
  Plus,
  Trash2,
  CheckCircle2,
} from "lucide-react";

export function SettingsPage() {
  const { settings, auth, modelsJson, allProviders, allModels, updateSettings, setTheme, addPackage, removePackage, importConfig: importConfigAction, resetToDefaults } = useConfigStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [newPackage, setNewPackage] = useState("");
  const [importError, setImportError] = useState("");
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const result = parseImportFile(ev.target?.result as string);
      if (result) {
        await importConfigAction(result);
        setImportError("");
      } else {
        setImportError("Invalid config file format");
      }
    };
    reader.readAsText(file);
  };

  const buildConfigForExport = (): PiConfig => ({
    settings: settings ?? { theme: "dark", packages: [], enabledModels: [] },
    auth: auth ?? {},
    modelsJson: modelsJson ?? { providers: {} },
  });

  const handleExport = () => {
    const cfg = buildConfigForExport();
    saveLocalBackup(cfg);
    exportConfig(cfg);
  };

  const providerOptions = allProviders.map((p) => ({
    value: p.id,
    label: p.name,
  }));

  const modelOptions = allModels.map((m) => ({
    value: `${m.providerId}/${m.id}`,
    label: `${m.providerName} / ${m.name || m.id}`,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="mt-1 text-sm text-gray-400">Configure pi agent preferences</p>
      </div>

      {/* Default Provider/Model */}
      <section className="rounded-xl border border-gray-800 bg-gray-900/50">
        <div className="border-b border-gray-800 px-6 py-4">
          <h2 className="text-sm font-semibold text-gray-300">Defaults</h2>
        </div>
        <div className="space-y-4 p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-gray-400">Default Provider</label>
              <select
                value={settings?.defaultProvider ?? ""}
                onChange={(e) => updateSettings({ defaultProvider: e.target.value })}
                className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
              >
                <option value="">— None —</option>
                {providerOptions.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400">Default Model</label>
              <select
                value={settings?.defaultModel ?? ""}
                onChange={(e) => updateSettings({ defaultModel: e.target.value })}
                className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
              >
                <option value="">— None —</option>
                {modelOptions.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-gray-400">Default Thinking Level</label>
              <select
                value={settings?.defaultThinkingLevel ?? "medium"}
                onChange={(e) => updateSettings({ defaultThinkingLevel: e.target.value })}
                className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
              >
                {["off", "minimal", "low", "medium", "high", "xhigh"].map((l) => (
                  <option key={l} value={l}>{l.charAt(0).toUpperCase() + l.slice(1)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400">Project Trust</label>
              <select
                value={settings?.defaultProjectTrust ?? "prompt"}
                onChange={(e) => updateSettings({ defaultProjectTrust: e.target.value })}
                className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
              >
                {["prompt", "always", "never"].map((t) => (
                  <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </section>

      {/* Theme */}
      <section className="rounded-xl border border-gray-800 bg-gray-900/50">
        <div className="border-b border-gray-800 px-6 py-4">
          <h2 className="text-sm font-semibold text-gray-300">Appearance</h2>
        </div>
        <div className="p-6">
          <div className="flex gap-3">
            {[
              { value: "light" as const, icon: Sun, label: "Light" },
              { value: "dark" as const, icon: Moon, label: "Dark" },
              { value: "light/dark" as const, icon: Monitor, label: "System" },
            ].map(({ value, icon: Icon, label }) => {
              const active = (settings?.theme ?? "light/dark") === value;
              return (
                <button
                  key={value}
                  onClick={() => setTheme(value)}
                  className={cn(
                    "flex items-center gap-2 rounded-lg border px-4 py-3 text-sm transition-all",
                    active
                      ? "border-blue-500 bg-blue-500/10 text-blue-400"
                      : "border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-600"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                  {active && <CheckCircle2 className="h-3.5 w-3.5 ml-1" />}
                </button>
              );
            })}
          </div>
          <div className="mt-4 flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-gray-400">
              <input
                type="checkbox"
                checked={settings?.hideThinkingBlock ?? false}
                onChange={(e) => updateSettings({ hideThinkingBlock: e.target.checked })}
                className="rounded border-gray-600 bg-gray-800 text-blue-500"
              />
              Hide thinking blocks
            </label>
          </div>
        </div>
      </section>

      {/* Enabled Models */}
      <section className="rounded-xl border border-gray-800 bg-gray-900/50">
        <div className="border-b border-gray-800 px-6 py-4">
          <h2 className="text-sm font-semibold text-gray-300">Enabled Models</h2>
        </div>
        <div className="p-6">
          <div className="space-y-2">
            {(settings?.enabledModels ?? []).length === 0 ? (
              <p className="text-sm text-gray-500">No models enabled. Enable models from the Models page.</p>
            ) : (
              (settings?.enabledModels ?? []).map((ref) => (
                <div key={ref} className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-800/30 px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                    <span className="text-sm text-gray-200">{ref}</span>
                  </div>
                  <button
                    onClick={() => useConfigStore.getState().removeEnabledModel(ref)}
                    className="rounded p-1 text-gray-500 hover:bg-gray-700 hover:text-red-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      {/* Packages */}
      <section className="rounded-xl border border-gray-800 bg-gray-900/50">
        <div className="border-b border-gray-800 px-6 py-4">
          <h2 className="text-sm font-semibold text-gray-300">Extensions & Packages</h2>
        </div>
        <div className="p-6 space-y-4">
          <div className="flex gap-2">
            <input
              type="text"
              value={newPackage}
              onChange={(e) => setNewPackage(e.target.value)}
              placeholder="npm:package-name"
              className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500"
              onKeyDown={(e) => {
                if (e.key === "Enter" && newPackage) {
                  addPackage(newPackage);
                  setNewPackage("");
                }
              }}
            />
            <button
              onClick={() => {
                if (newPackage) {
                  addPackage(newPackage);
                  setNewPackage("");
                }
              }}
              className="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-500"
            >
              <Plus className="h-4 w-4" />
              Add
            </button>
          </div>
          <div className="space-y-2">
            {(settings?.packages ?? []).length === 0 ? (
              <p className="text-sm text-gray-500">No packages installed</p>
            ) : (
              (settings?.packages ?? []).map((pkg) => (
                <div key={pkg} className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-800/30 px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <Package className="h-4 w-4 text-blue-400" />
                    <span className="text-sm text-gray-200">{pkg}</span>
                  </div>
                  <button
                    onClick={() => removePackage(pkg)}
                    className="rounded p-1 text-gray-500 hover:bg-gray-700 hover:text-red-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      {/* Import/Export */}
      <section className="rounded-xl border border-gray-800 bg-gray-900/50">
        <div className="border-b border-gray-800 px-6 py-4">
          <h2 className="text-sm font-semibold text-gray-300">Import & Export</h2>
        </div>
        <div className="p-6 space-y-4">
          <div className="flex flex-wrap gap-3">
            <button
              onClick={handleExport}
              className="flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 text-sm text-gray-300 hover:bg-gray-700"
            >
              <Download className="h-4 w-4" />
              Export Config
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 text-sm text-gray-300 hover:bg-gray-700"
            >
              <Upload className="h-4 w-4" />
              Import Config
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={handleImport}
            />
          </div>
          {importError && <p className="text-sm text-red-400">{importError}</p>}
        </div>
      </section>

      {/* Danger Zone */}
      <section className="rounded-xl border border-red-900/30 bg-red-950/20">
        <div className="border-b border-red-900/30 px-6 py-4">
          <h2 className="text-sm font-semibold text-red-400">Danger Zone</h2>
        </div>
        <div className="p-6">
          <button
            onClick={() => setShowResetConfirm(true)}
            className="flex items-center gap-2 rounded-lg border border-red-700 bg-red-900/30 px-4 py-2 text-sm text-red-400 hover:bg-red-900/50"
          >
            <RotateCcw className="h-4 w-4" />
            Reset to Defaults
          </button>
        </div>
      </section>

      {/* Reset Confirm */}
      <Modal
        open={showResetConfirm}
        onClose={() => setShowResetConfirm(false)}
        title="Reset Configuration?"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-400">
            This will reset all settings, auth keys, and custom providers to defaults.
            Changes are written directly to your pi config files (~/.pi/agent/).
            This action cannot be undone.
          </p>
          <div className="flex justify-end gap-3">
            <button
              onClick={() => setShowResetConfirm(false)}
              className="rounded-lg px-4 py-2 text-sm text-gray-400 hover:bg-gray-800"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                resetToDefaults();
                setShowResetConfirm(false);
              }}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500"
            >
              Reset
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}