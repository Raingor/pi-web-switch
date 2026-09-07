import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createFailoverRuntime,
  readHealthState,
  resetProviderHealth,
  writeHealthState,
} from "./key-failover.ts";

const PI_SWITCH_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const KEY_STATE_FILENAME = "pi-web-switch-key-state.json";

let serverProcess: ReturnType<typeof spawn> | null = null;

function getPackageManager(): "npm" | "pnpm" | "yarn" {
  if (existsSync(join(PI_SWITCH_DIR, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(PI_SWITCH_DIR, "yarn.lock"))) return "yarn";
  return "npm";
}

// ─── Usage reader ────────────────────────────────────────
// Reads session JSONL files directly and aggregates today / 7d stats,
// so the user can see usage at a glance without launching the dashboard.

interface UsageRecord {
  date: string;
  hour?: number;
  providerId: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  requests: number;
  cost: number;
}

const CN_TZ = "Asia/Shanghai";

function cnDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: CN_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function cnDateParts(ts: string | number): { date: string; hour: number } {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return { date: "unknown", hour: 0 };
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: CN_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: CN_TZ,
      hour: "2-digit",
      hour12: false,
    }).format(d)
  );
  return { date, hour: hour === 24 ? 0 : hour };
}

function parseSessionFile(filePath: string): UsageRecord[] {
  const records: UsageRecord[] = [];
  try {
    const raw = readFileSync(filePath, "utf-8");
    const lines = raw.split("\n").filter((l) => l.trim());

    let currentProvider = "unknown";
    let currentModel = "unknown";

    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        const type = obj.type;

        if (type === "model_change") {
          currentProvider = obj.provider || currentProvider;
          currentModel = obj.modelId || currentModel;
          continue;
        }

        if (type === "message" && obj.message?.role === "assistant") {
          const usage = obj.message.usage;
          if (!usage || !usage.input) continue;

          const timestamp = obj.timestamp || obj.message.timestamp;
          const { date, hour } = cnDateParts(timestamp);

          records.push({
            date,
            hour,
            providerId: obj.message.provider || currentProvider,
            modelId: obj.message.model || currentModel,
            inputTokens: usage.input ?? 0,
            outputTokens: usage.output ?? 0,
            cacheReadTokens: usage.cacheRead ?? 0,
            cacheWriteTokens: usage.cacheWrite ?? 0,
            requests: 1,
            cost: usage.cost?.total ?? 0,
          });
        }
      } catch {
        // skip malformed lines
      }
    }
  } catch {
    // skip unreadable files
  }
  return records;
}

function readAllUsage(): UsageRecord[] {
  const sessionsPath = join(getAgentDir(), "sessions");
  if (!existsSync(sessionsPath)) return [];
  let dirs: string[] = [];
  try {
    dirs = readdirSync(sessionsPath)
      .filter((name) => name.startsWith("--"))
      .map((name) => join(sessionsPath, name))
      .filter((dir) => statSync(dir).isDirectory());
  } catch {
    return [];
  }

  const allRecords: UsageRecord[] = [];
  for (const dir of dirs) {
    try {
      const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
      for (const file of files) {
        const records = parseSessionFile(join(dir, file));
        allRecords.push(...records);
      }
    } catch {
      // skip unreadable directories
    }
  }
  return allRecords;
}

function aggregateSummary() {
  const records = readAllUsage();
  // pi-reader buckets dates in Asia/Shanghai (CN_TZ); use the same timezone
  // so "today" lines up with the session data around midnight UTC.
  const today = cnDate(new Date());
  const sevenDaysAgo = cnDate(new Date(Date.now() - 6 * 24 * 60 * 60 * 1000));

  const todayRecs = records.filter((r) => r.date === today);
  const sevenDayRecs = records.filter((r) => r.date >= sevenDaysAgo);

  const sum = (recs: UsageRecord[]) => {
    let tokens = 0,
      cost = 0,
      requests = 0;
    for (const r of recs) {
      tokens += r.inputTokens + r.outputTokens + r.cacheReadTokens + r.cacheWriteTokens;
      cost += r.cost;
      requests += r.requests;
    }
    return { tokens, cost, requests };
  };

  // Per-day breakdown for last 7 days
  const dailyMap = new Map<string, { tokens: number; cost: number; requests: number }>();
  for (const r of sevenDayRecs) {
    const d = dailyMap.get(r.date) ?? { tokens: 0, cost: 0, requests: 0 };
    d.tokens += r.inputTokens + r.outputTokens + r.cacheReadTokens + r.cacheWriteTokens;
    d.cost += r.cost;
    d.requests += r.requests;
    dailyMap.set(r.date, d);
  }
  const daily = Array.from(dailyMap.entries())
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    today: sum(todayRecs),
    sevenDays: sum(sevenDayRecs),
    daily,
  };
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatCost(n: number): string {
  if (n === 0) return "$0.00";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

function shortDate(iso: string): string {
  const parts = iso.split("-");
  if (parts.length !== 3) return iso;
  return `${parts[1]}/${parts[2]}`;
}

// ─── Key failover registration ───────────────────────────

function readModelsJsonSafe(): { providers?: Record<string, unknown> } | undefined {
  try {
    const path = join(getAgentDir(), "models.json");
    if (!existsSync(path)) return undefined;
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return undefined;
  }
}

function keyStatePath(): string {
  return join(getAgentDir(), KEY_STATE_FILENAME);
}

// ─── Extension entry ─────────────────────────────────────

export default function (pi: ExtensionAPI) {
  // /pi-switch start|stop|status — launch the dashboard web UI
  pi.registerCommand("pi-switch", {
    description: "Start or stop the pi-web-switch dashboard (start|stop|status [port])",
    handler: async (args, ctx) => {
      const [actionArg, portArg] = (args ?? "").trim().split(/\s+/).filter(Boolean);
      const action = actionArg ?? "status";
      const port = Number(portArg) || 5173;

      if (action === "status") {
        if (serverProcess && !serverProcess.killed) {
          ctx.ui.notify(`pi-web-switch is running at http://localhost:${port}`, "info");
        } else {
          serverProcess = null;
          ctx.ui.notify(`pi-web-switch is not running. Use '/pi-switch start' to launch the dashboard.`, "info");
        }
        return;
      }

      if (action === "stop") {
        if (serverProcess && !serverProcess.killed) {
          serverProcess.kill();
          serverProcess = null;
          ctx.ui.notify("pi-web-switch stopped.", "info");
        } else {
          ctx.ui.notify("pi-web-switch is not running.", "info");
        }
        return;
      }

      if (action === "start") {
        if (serverProcess && !serverProcess.killed) {
          ctx.ui.notify(`pi-web-switch is already running at http://localhost:${port}`, "info");
          return;
        }

        const pm = getPackageManager();
        const cmd = pm === "npm" ? "npx" : pm;

        serverProcess = spawn(cmd, ["vite", "--host", "--port", String(port)], {
          cwd: PI_SWITCH_DIR,
          stdio: "ignore",
          detached: true,
        });

        serverProcess.unref();

        await new Promise((r) => setTimeout(r, 2000));

        ctx.ui.notify(
          `pi-web-switch started! Dashboard: http://localhost:${port} — use '/pi-switch stop' to stop the server.`,
          "info"
        );
        return;
      }

      ctx.ui.notify(`Unknown action '${action}'. Use start, stop, or status.`, "error");
    },
  });

  // /pi-usage — quick usage summary (today + 7d) in the terminal
  pi.registerCommand("pi-usage", {
    description: "Show pi usage summary (today / 7 days) without launching the dashboard",
    handler: async (_args, ctx) => {
      try {
        const s = aggregateSummary();
        const today = cnDate(new Date());
        const spark = s.daily
          .map((d) => {
            const max = Math.max(1, ...s.daily.map((x) => x.tokens));
            const bars = Math.round((d.tokens / max) * 8);
            return `${shortDate(d.date)} ${"█".repeat(bars)}${"░".repeat(8 - bars)} ${formatTokens(d.tokens)}`;
          })
          .join("\n");

        ctx.ui.notify(
          [
            "📊 pi usage summary",
            "",
            `Today (${today})`,
            `  Tokens:   ${formatTokens(s.today.tokens)}`,
            `  Cost:     ${formatCost(s.today.cost)}`,
            `  Requests: ${s.today.requests}`,
            "",
            "Last 7 days",
            `  Tokens:   ${formatTokens(s.sevenDays.tokens)}`,
            `  Cost:     ${formatCost(s.sevenDays.cost)}`,
            `  Requests: ${s.sevenDays.requests}`,
            "",
            "Daily trend",
            spark,
          ].join("\n"),
          "info"
        );
      } catch (err) {
        ctx.ui.notify(`Failed to read usage: ${String(err)}`, "error");
      }
    },
  });

  // Key-pool automatic failover: register stream wrappers for every eligible
  // provider (opt-in via the web UI toggle). Pool and health state are reread
  // per request, so web-UI edits apply without re-registration. Re-synced on
  // session_start / model_select so api-type or eligibility changes are picked
  // up too. This covers the terminal Pi CLI and Web Chat (same runtime).
  const failover = createFailoverRuntime(pi, {
    loadModelsJson: () => readModelsJsonSafe() as never,
    healthStatePath: keyStatePath(),
  });
  const syncFailover = () => {
    try {
      failover.sync();
    } catch (err) {
      console.error(`[pi-web-switch] key failover sync failed: ${String(err)}`);
    }
  };
  syncFailover();
  pi.on("session_start", async () => syncFailover());
  pi.on("model_select", async () => syncFailover());

  // Expose key-health reset from the terminal: /pi-key-reset <providerId> [keyId]
  pi.registerCommand("pi-key-reset", {
    description: "Reset automatic-failover key health for a provider (paused/cooldown keys)",
    handler: async (args, ctx) => {
      const [providerId, keyId] = (args ?? "").trim().split(/\s+/).filter(Boolean);
      if (!providerId) {
        ctx.ui.notify("Usage: /pi-key-reset <providerId> [keyId]", "error");
        return;
      }
      const path = keyStatePath();
      const next = readHealthState(path);
      if (!next[providerId]) {
        ctx.ui.notify(`No key health state recorded for '${providerId}'.`, "info");
        return;
      }
      const updated = resetProviderHealth(next, providerId, keyId);
      writeHealthState(path, updated);
      ctx.ui.notify(keyId ? `Reset key ${keyId} of ${providerId}.` : `Reset all keys of ${providerId}.`, "info");
    },
  });
}
