import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { streamSimple as piStreamSimple } from "@earendil-works/pi-ai/compat";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PI_SWITCH_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let serverProcess: ReturnType<typeof spawn> | null = null;

function getPackageManager(): "npm" | "pnpm" | "yarn" {
  if (existsSync(join(PI_SWITCH_DIR, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(PI_SWITCH_DIR, "yarn.lock"))) return "yarn";
  return "npm";
}

/**
 * AgentRouter/DeepSeek V4 can stream reasoning as content blocks instead of
 * OpenAI's top-level `reasoning_content` field. Pi's OpenAI adapter only
 * persists the latter, so normalize the response before the adapter consumes
 * it. This keeps the thinking block in the session and lets the next tool turn
 * replay it as required by the provider.
 */
function normalizeAgentRouterPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") return payload;
  const root = payload as Record<string, unknown>;
  const choices = Array.isArray(root.choices) ? root.choices : undefined;
  if (!choices) return payload;

  let changed = false;
  const normalizedChoices = choices.map((choice) => {
    if (!choice || typeof choice !== "object") return choice;
    const current = choice as Record<string, unknown>;
    const delta = current.delta;
    const message = current.message;
    const target = delta && typeof delta === "object"
      ? { key: "delta", value: delta as Record<string, unknown> }
      : message && typeof message === "object"
        ? { key: "message", value: message as Record<string, unknown> }
        : undefined;
    if (!target || !Array.isArray(target.value.content)) return choice;

    const blocks = target.value.content as unknown[];
    const thinking = blocks
      .filter((block): block is Record<string, unknown> =>
        Boolean(block && typeof block === "object" && (block as Record<string, unknown>).type === "thinking")
      )
      .map((block) => typeof block.thinking === "string" ? block.thinking : "")
      .join("");
    const text = blocks
      .filter((block): block is Record<string, unknown> =>
        Boolean(block && typeof block === "object" && (block as Record<string, unknown>).type !== "thinking")
      )
      .map((block) => {
        if (typeof block.text === "string") return block.text;
        if (typeof block.output === "string") return block.output;
        return "";
      })
      .join("");

    if (!thinking && !text) return choice;
    changed = true;
    const nextTarget: Record<string, unknown> = { ...target.value };
    delete nextTarget.content;
    if (text) nextTarget.content = text;
    if (thinking) nextTarget.reasoning_content = thinking;
    return { ...current, [target.key]: nextTarget };
  });

  return changed ? { ...root, choices: normalizedChoices } : payload;
}

function createAgentRouterFetch(baseFetch: typeof globalThis.fetch): typeof globalThis.fetch {
  return async (input, init) => {
    const response = await baseFetch(input, init);
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.body || (!contentType.includes("text/event-stream") && !contentType.includes("application/json"))) {
      return response;
    }

    if (contentType.includes("application/json")) {
      const payload = await response.json();
      const normalized = normalizeAgentRouterPayload(payload);
      return new Response(JSON.stringify(normalized), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }

    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let pending = "";
    const transform = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        pending += decoder.decode(chunk, { stream: true });
        const lines = pending.split("\\n");
        pending = lines.pop() ?? "";
        for (const line of lines) {
          controller.enqueue(encoder.encode(normalizeAgentRouterSseLine(line)));
        }
      },
      flush(controller) {
        pending += decoder.decode();
        if (pending) controller.enqueue(encoder.encode(normalizeAgentRouterSseLine(pending)));
      },
    });

    response.body.pipeTo(transform.writable).catch(() => undefined);
    return new Response(transform.readable, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}

function normalizeAgentRouterSseLine(line: string): string {
  if (!line.startsWith("data:")) return `${line}\\n`;
  const raw = line.slice(5).trim();
  if (!raw || raw === "[DONE]") return `${line}\\n`;
  try {
    const normalized = normalizeAgentRouterPayload(JSON.parse(raw));
    return `data: ${JSON.stringify(normalized)}\\n`;
  } catch {
    return `${line}\\n`;
  }
}

function registerAgentRouterThinkingCompatibility(pi: ExtensionAPI): void {
  const modelsPath = join(getAgentDir(), "models.json");
  try {
    const config = JSON.parse(readFileSync(modelsPath, "utf8")) as { providers?: Record<string, unknown> };
    if (!config.providers?.agentrouter) return;
  } catch {
    return;
  }

  pi.registerProvider("agentrouter", {
    api: "openai-completions",
    streamSimple: (model, context, options) => piStreamSimple(model, context, {
      ...options,
      fetch: createAgentRouterFetch(options?.fetch ?? globalThis.fetch),
    }),
  });
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

// ─── Extension entry ─────────────────────────────────────

export default function (pi: ExtensionAPI) {
  registerAgentRouterThinkingCompatibility(pi);

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

  // Key-pool selection remains manual. The former automatic-failover runtime
  // is intentionally not registered: saved autoFailover fields are ignored so
  // upgrading cannot silently start switching a user's keys again.
}
