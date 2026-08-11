import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { execSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PI_SWITCH_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PI_DIR = join(homedir(), ".pi", "agent");

let serverProcess: ReturnType<typeof spawn> | null = null;

function getPackageManager(): "npm" | "pnpm" | "yarn" {
  if (existsSync(join(PI_SWITCH_DIR, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(PI_SWITCH_DIR, "yarn.lock"))) return "yarn";
  return "npm";
}

// ─── Usage reader ────────────────────────────────────────
// Reads ~/.pi/agent/sessions/*.jsonl directly and aggregates today / 7d stats,
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
  const sessionsPath = join(PI_DIR, "sessions");
  const { readdirSync, existsSync: exists, statSync } = require("node:fs");
  if (!exists(sessionsPath)) return [];

  const dirs = readdirSync(sessionsPath)
    .filter((name: string) => name.startsWith("--"))
    .map((name: string) => join(sessionsPath, name))
    .filter((dir: string) => statSync(dir).isDirectory());

  const allRecords: UsageRecord[] = [];
  for (const dir of dirs) {
    try {
      const files = readdirSync(dir).filter((f: string) => f.endsWith(".jsonl"));
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
  const cnDate = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
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

export default function (api: ExtensionAPI, ctx: ExtensionContext) {
  // /pi-switch start|stop|status — launch the dashboard web UI
  api.registerCommand({
    name: "pi-switch",
    description: "Start or stop the pi-web-switch dashboard",
    params: Type.Object({
      action: Type.Enum({ start: "start", stop: "stop", status: "status" }),
      port: Type.Optional(Type.Number({ default: 5173 })),
    }),
    execute: async (params) => {
      const { action, port = 5173 } = params;

      if (action === "status") {
        if (serverProcess && !serverProcess.killed) {
          return ctx.say(
            <Box borderStyle="round" borderColor="green" paddingLeft={1} paddingRight={1}>
              <Text>pi-web-switch is running at http://localhost:{port}</Text>
            </Box>
          );
        } else {
          serverProcess = null;
          return ctx.say(
            <Box borderStyle="round" borderColor="yellow" paddingLeft={1} paddingRight={1}>
              <Text>pi-web-switch is not running.</Text>
              <Text>Use `/pi-switch start` to launch the dashboard.</Text>
            </Box>
          );
        }
      }

      if (action === "stop") {
        if (serverProcess && !serverProcess.killed) {
          serverProcess.kill();
          serverProcess = null;
          return ctx.say(
            <Box borderStyle="round" borderColor="green" paddingLeft={1} paddingRight={1}>
              <Text>pi-web-switch stopped.</Text>
            </Box>
          );
        }
        return ctx.say(
          <Box borderStyle="round" borderColor="yellow" paddingLeft={1} paddingRight={1}>
            <Text>pi-web-switch is not running.</Text>
          </Box>
        );
      }

      if (action === "start") {
        if (serverProcess && !serverProcess.killed) {
          return ctx.say(
            <Box borderStyle="round" borderColor="yellow" paddingLeft={1} paddingRight={1}>
              <Text>pi-web-switch is already running at http://localhost:{port}</Text>
            </Box>
          );
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

        return ctx.say(
          <Box borderStyle="round" borderColor="green" paddingLeft={1} paddingRight={1}>
            <Text>pi-web-switch started!</Text>
            <Text>Dashboard: http://localhost:{port}</Text>
            <Text>Use `/pi-switch stop` to stop the server.</Text>
          </Box>
        );
      }
    },
  });

  // /pi-usage — quick usage summary (today + 7d) in the terminal
  api.registerCommand({
    name: "pi-usage",
    description: "Show pi usage summary (today / 7 days) without launching the dashboard",
    params: Type.Object({}),
    execute: async () => {
      try {
        const s = aggregateSummary();
        const spark = s.daily
          .map((d) => {
            const max = Math.max(1, ...s.daily.map((x) => x.tokens));
            const bars = Math.round((d.tokens / max) * 8);
            return `${shortDate(d.date)} ${"█".repeat(bars)}${"░".repeat(8 - bars)} ${formatTokens(d.tokens)}`;
          })
          .join("\n");

        return ctx.say(
          <Box borderStyle="round" borderColor="green" paddingLeft={1} paddingRight={1}>
            <Text bold>📊 pi usage summary</Text>
            <Text> </Text>
            <Text bold>Today ({new Date().toISOString().slice(0, 10)})</Text>
            <Text>  Tokens:   {formatTokens(s.today.tokens)}</Text>
            <Text>  Cost:     {formatCost(s.today.cost)}</Text>
            <Text>  Requests: {s.today.requests}</Text>
            <Text> </Text>
            <Text bold>Last 7 days</Text>
            <Text>  Tokens:   {formatTokens(s.sevenDays.tokens)}</Text>
            <Text>  Cost:     {formatCost(s.sevenDays.cost)}</Text>
            <Text>  Requests: {s.sevenDays.requests}</Text>
            <Text> </Text>
            <Text bold>Daily trend</Text>
            <Text>{spark}</Text>
          </Box>
        );
      } catch (err) {
        return ctx.say(
          <Box borderStyle="round" borderColor="red" paddingLeft={1} paddingRight={1}>
            <Text>Failed to read usage: {String(err)}</Text>
          </Box>
        );
      }
    },
  });
}
