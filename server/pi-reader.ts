import { readFileSync, readdirSync, existsSync, statSync, unlinkSync, writeFileSync, mkdirSync, renameSync, chmodSync } from "fs";
import { homedir, platform } from "os";
import { join, resolve, dirname, relative, sep } from "path";
import { spawnSync } from "child_process";
import { DatabaseSync } from "node:sqlite";

const PI_DIR = join(homedir(), ".pi", "agent");
const CODEX_DIR = join(homedir(), ".codex");

// ─── Cindy Pi-Agent Sessions ───────────────────────────
// When Cindy (the AI assistant) delegates to a pi coding agent, sessions
// are stored under its own data directory instead of ~/.pi/agent/sessions.

function getCindySessionsDir(): string {
  const home = homedir();
  if (platform() === "darwin") {
    return join(home, "Library", "Application Support", "Cindy", "pi-agent-home", "sessions");
  }
  // Linux / Windows fallback
  return join(home, ".config", "cindy", "pi-agent-home", "sessions");
}

// ─── Config File Paths ───────────────────────────────────

function piPath(filename: string): string {
  return join(PI_DIR, filename);
}

function readJson<T>(filename: string): T | null {
  const path = piPath(filename);
  try {
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// ─── Settings ───────────────────────────────────────────

export function readSettings() {
  return readJson<any>("settings.json");
}

export function writeSettings(settings: any): boolean {
  try {
    const path = piPath("settings.json");
    const raw = JSON.stringify(settings, null, 2);
    writeFileSync(path, raw, "utf-8");
    return true;
  } catch {
    return false;
  }
}

// ─── Official Usage Query ──────────────────────────────

export type OfficialUsageAuthMode = "auto" | "bearer" | "x-api-key" | "api-key";

export interface OfficialUsageConfig {
  endpoint: string;
  apiKeys: string[];
  authMode: OfficialUsageAuthMode;
}

export interface OfficialUsageSummary {
  total: number;
  used: number;
  remaining: number;
  remainingPercent: number;
  unit: string;
  source: string;
  checkedAt: string;
}

const OFFICIAL_USAGE_CONFIG_FILE = "official-usage.json";

function officialUsagePath(): string {
  return piPath(OFFICIAL_USAGE_CONFIG_FILE);
}

function normalizeOfficialUsageConfig(value: any): OfficialUsageConfig {
  const endpoint = typeof value?.endpoint === "string" ? value.endpoint.trim() : "";
  const apiKeys = Array.isArray(value?.apiKeys)
    ? value.apiKeys.filter((key: unknown): key is string => typeof key === "string").map((key) => key.trim()).filter(Boolean)
    : typeof value?.apiKey === "string" && value.apiKey.trim()
      ? [value.apiKey.trim()]
      : [];
  const authMode: OfficialUsageAuthMode = ["auto", "bearer", "x-api-key", "api-key"].includes(value?.authMode)
    ? value.authMode
    : "auto";
  return { endpoint, apiKeys: Array.from(new Set(apiKeys)), authMode };
}

export function readOfficialUsageConfig(): OfficialUsageConfig {
  try {
    if (!existsSync(officialUsagePath())) return { endpoint: "", apiKeys: [], authMode: "auto" };
    return normalizeOfficialUsageConfig(JSON.parse(readFileSync(officialUsagePath(), "utf-8")));
  } catch {
    return { endpoint: "", apiKeys: [], authMode: "auto" };
  }
}

export function writeOfficialUsageConfig(config: OfficialUsageConfig): boolean {
  try {
    const normalized = normalizeOfficialUsageConfig(config);
    if (!normalized.endpoint || normalized.apiKeys.length === 0) return false;
    const url = new URL(normalized.endpoint);
    if (!/^https?:$/.test(url.protocol)) return false;
    mkdirSync(PI_DIR, { recursive: true });
    writeFileSync(officialUsagePath(), JSON.stringify(normalized, null, 2), { encoding: "utf-8", mode: 0o600 });
    chmodSync(officialUsagePath(), 0o600);
    return true;
  } catch {
    return false;
  }
}

function officialNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value.replace(/[, ]/g, "")))) return Number(value.replace(/[, ]/g, ""));
  return null;
}

function findOfficialMetric(root: unknown, names: string[]): { value: number; unit?: string } | null {
  const wanted = new Set(names.map((name) => name.toLowerCase().replace(/[^a-z0-9]/g, "")));
  const queue: Array<{ value: unknown; path: string[] }> = [{ value: root, path: [] }];
  while (queue.length) {
    const current = queue.shift()!;
    if (!current.value || typeof current.value !== "object") continue;
    for (const [key, value] of Object.entries(current.value as Record<string, unknown>)) {
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
      const number = officialNumber(value);
      if (number !== null && wanted.has(normalizedKey)) {
        const parent = current.value as Record<string, unknown>;
        const unit = typeof parent.unit === "string"
          ? parent.unit
          : typeof parent.currency === "string"
            ? parent.currency
            : normalizedKey.includes("usd") ? "USD" : undefined;
        return { value: number, unit };
      }
      if (value && typeof value === "object") queue.push({ value, path: [...current.path, key] });
    }
  }
  return null;
}

function parseOfficialUsagePayload(payload: unknown, endpoint: string): OfficialUsageSummary {
  const total = findOfficialMetric(payload, ["total", "totalquota", "quota", "limit", "usagelimit", "monthlylimit", "included"])?.value ?? null;
  const used = findOfficialMetric(payload, ["used", "usage", "currentusage", "consumed", "spend", "spent", "utilized"])?.value ?? null;
  const explicitRemaining = findOfficialMetric(payload, ["remaining", "remainingquota", "balance", "available", "left"])?.value ?? null;
  const resolvedTotal = total !== null && (used !== null || explicitRemaining !== null)
    ? total
    : used !== null && explicitRemaining !== null
      ? used + explicitRemaining
      : Number.NaN;
  const resolvedUsed = used ?? (resolvedTotal - (explicitRemaining ?? 0));
  const resolvedRemaining = explicitRemaining ?? Math.max(resolvedTotal - resolvedUsed, 0);
  if (!Number.isFinite(resolvedTotal) || resolvedTotal <= 0 || !Number.isFinite(resolvedUsed) || !Number.isFinite(resolvedRemaining)) {
    throw new Error("Unable to find total/used/remaining quota fields in the response");
  }
  const remainingPercent = Math.min(100, Math.max(0, (resolvedRemaining / resolvedTotal) * 100));
  return {
    total: resolvedTotal,
    used: Math.max(0, resolvedUsed),
    remaining: Math.max(0, resolvedRemaining),
    remainingPercent,
    unit: findOfficialMetric(payload, ["total", "totalquota", "quota", "limit", "usagelimit", "monthlylimit", "included"])?.unit ?? "units",
    source: endpoint,
    checkedAt: new Date().toISOString(),
  };
}

function officialEndpoint(endpoint: string, apiKey: string): string {
  return endpoint.replace(/\{apiKey\}/gi, encodeURIComponent(apiKey));
}

export async function queryOfficialUsage(configInput: OfficialUsageConfig): Promise<OfficialUsageSummary> {
  const config = normalizeOfficialUsageConfig(configInput);
  if (!config.endpoint || config.apiKeys.length === 0) throw new Error("Endpoint and at least one API key are required");
  const errors: string[] = [];
  const results: OfficialUsageSummary[] = [];
  for (const apiKey of config.apiKeys) {
    const modes: OfficialUsageAuthMode[] = config.authMode === "auto" ? ["bearer", "x-api-key", "api-key"] : [config.authMode];
    let keySucceeded = false;
    for (const mode of modes) {
      try {
        const headers: Record<string, string> = { Accept: "application/json" };
        if (mode === "bearer") headers.Authorization = `Bearer ${apiKey}`;
        if (mode === "x-api-key") headers["x-api-key"] = apiKey;
        if (mode === "api-key") headers["api-key"] = apiKey;
        const response = await fetch(officialEndpoint(config.endpoint, apiKey), { headers, signal: AbortSignal.timeout(15_000) });
        const text = await response.text();
        let payload: unknown;
        try { payload = JSON.parse(text); } catch { payload = text; }
        if (!response.ok) {
          errors.push(`${response.status} ${response.statusText}`);
          continue;
        }
        results.push(parseOfficialUsagePayload(payload, config.endpoint));
        keySucceeded = true;
        break;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "request failed");
      }
    }
    if (!keySucceeded) continue;
  }
  if (results.length === 0) throw new Error(errors[0] || "Official usage query failed");
  const total = results.reduce((sum, result) => sum + result.total, 0);
  const used = results.reduce((sum, result) => sum + result.used, 0);
  const remaining = results.reduce((sum, result) => sum + result.remaining, 0);
  return {
    total,
    used,
    remaining,
    remainingPercent: total > 0 ? Math.min(100, Math.max(0, (remaining / total) * 100)) : 0,
    unit: results.find((result) => result.unit)?.unit ?? "units",
    source: config.endpoint,
    checkedAt: new Date().toISOString(),
  };
}

// ─── Auth ───────────────────────────────────────────────

export function readAuth() {
  return readJson<any>("auth.json");
}

export function writeAuth(auth: any): boolean {
  try {
    const path = piPath("auth.json");
    writeFileSync(path, JSON.stringify(auth, null, 2), "utf-8");
    return true;
  } catch {
    return false;
  }
}

// ─── Models (custom providers) ──────────────────────────

export function readModels() {
  return readJson<{ providers: Record<string, any> }>("models.json");
}

export function writeModels(models: any): boolean {
  try {
    const path = piPath("models.json");
    writeFileSync(path, JSON.stringify(models, null, 2), "utf-8");
    return true;
  } catch {
    return false;
  }
}

// ─── Session Usage Parser ───────────────────────────────

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

interface UsageEvent {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens?: number;
  cost?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    total?: number;
  };
}

function getSessionDirs(): string[] {
  const sessionsPath = join(PI_DIR, "sessions");
  if (!existsSync(sessionsPath)) return [];
  return readdirSync(sessionsPath)
    .filter((name) => name.startsWith("--"))
    .map((name) => join(sessionsPath, name))
    .filter((dir) => statSync(dir).isDirectory());
}

// Usage stats are bucketed in China time (UTC+8) regardless of the machine's
// system timezone, so daily totals stay consistent for a Beijing-based user.
const CN_TZ = "Asia/Shanghai";

function cnDateParts(ts: string | number): { date: string; hour: number } {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return { date: "unknown", hour: 0 };
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: CN_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d); // "2026-08-06"
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
          const usage: UsageEvent | undefined = obj.message.usage;
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

// Scanned session usage is cached briefly: the same 150MB+ of JSONL gets
// re-read on every dashboard request otherwise, which stalls the page.
const USAGE_CACHE_TTL_MS = 30_000;
let usageCache: { records: UsageRecord[]; at: number } | null = null;

/** Drop cached session usage — called when the UI requests a forced refresh. */
export function clearUsageCache(): void {
  usageCache = null;
}

export function readAllUsage(): UsageRecord[] {
  if (usageCache && Date.now() - usageCache.at < USAGE_CACHE_TTL_MS) {
    return usageCache.records;
  }
  const allRecords: UsageRecord[] = [];
  const dirs = getSessionDirs();

  for (const dir of dirs) {
    try {
      const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
      for (const file of files) {
        const filePath = join(dir, file);
        const records = parseSessionFile(filePath);
        allRecords.push(...records);
      }
    } catch {
      // skip unreadable directories
    }
  }

  // Sort by date ascending
  allRecords.sort((a, b) => a.date.localeCompare(b.date));
  usageCache = { records: allRecords, at: Date.now() };
  return allRecords;
}

// ─── Cindy Pi-Agent Usage ──────────────────────────────

/**
 * Read usage records from Cindy's pi-agent sessions.
 * Cindy stores pi-agent sessions in its own data directory
 * (~/Library/Application Support/Cindy/pi-agent-home/sessions/)
 * rather than ~/.pi/agent/sessions/. The JSONL format is identical,
 * so we reuse the same parseSessionFile() function.
 */
export function readCindyUsage(): UsageRecord[] {
  const allRecords: UsageRecord[] = [];
  const cindyDir = getCindySessionsDir();

  if (!existsSync(cindyDir)) return allRecords;

  try {
    // Cindy's sessions are flat (no subdirectory per project)
    const files = readdirSync(cindyDir).filter((f) => f.endsWith(".jsonl"));
    for (const file of files) {
      const filePath = join(cindyDir, file);
      if (!statSync(filePath).isFile()) continue;
      const records = parseSessionFile(filePath);
      allRecords.push(...records);
    }
  } catch {
    // skip unreadable directory
  }

  // Sort by date ascending
  allRecords.sort((a, b) => a.date.localeCompare(b.date));
  return allRecords;
}

// ─── Claude Usage (from Cindy SQLite) ──────────────────

/**
 * Find all Cindy SQLite database files that may contain usage data.
 * Cindy stores session/usage data in cindy-cms*.db files under its
 * application support directory.
 */
function getCindyDbPaths(): string[] {
  const home = homedir();
  let cindyAppDir: string;
  if (platform() === "darwin") {
    cindyAppDir = join(home, "Library", "Application Support", "Cindy");
  } else if (platform() === "win32") {
    cindyAppDir = join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), "Cindy");
  } else {
    cindyAppDir = join(home, ".config", "Cindy");
  }

  if (!existsSync(cindyAppDir)) return [];

  try {
    return readdirSync(cindyAppDir)
      .filter((f) => f.startsWith("cindy-cms") && f.endsWith(".db"))
      .map((f) => join(cindyAppDir, f));
  } catch {
    return [];
  }
}

/**
 * Read Claude usage records from Cindy's daily_model_usage table.
 * Cindy tracks every agent_kind (claude-code, pi, codex) in the same
 * table; we filter to agent_kind = 'claude-code' for Claude stats.
 */
export function readClaudeUsage(): UsageRecord[] {
  const allRecords: UsageRecord[] = [];
  const dbPaths = getCindyDbPaths();
  if (dbPaths.length === 0) return allRecords;

  for (const dbPath of dbPaths) {
    try {
      const query = "SELECT day, model, cost_usd, input_tokens, output_tokens, cache_read_tokens, cache_create_tokens FROM daily_model_usage WHERE agent_kind = 'claude-code' ORDER BY day";
      const result = spawnSync("sqlite3", [dbPath, "-json", query], {
        encoding: "utf8",
        timeout: 10000,
      });

      if (result.status !== 0) continue;
      const output = result.stdout?.trim();
      if (!output) continue;

      const rows = JSON.parse(output) as Array<{
        day: string;
        model: string;
        cost_usd: number;
        input_tokens: number;
        output_tokens: number;
        cache_read_tokens: number;
        cache_create_tokens: number;
      }>;

      for (const row of rows) {
        allRecords.push({
          date: row.day,
          providerId: "claude",
          modelId: row.model,
          inputTokens: row.input_tokens ?? 0,
          outputTokens: row.output_tokens ?? 0,
          cacheReadTokens: row.cache_read_tokens ?? 0,
          cacheWriteTokens: row.cache_create_tokens ?? 0,
          requests: 1,
          cost: row.cost_usd ?? 0,
        });
      }
    } catch {
      // skip this db
    }
  }

  // Sort by date ascending
  allRecords.sort((a, b) => a.date.localeCompare(b.date));
  return allRecords;
}

/**
 * Read Codex usage records from Cindy's daily_model_usage table.
 * Filters to agent_kind = 'codex'.
 */
export function readCodexUsage(): UsageRecord[] {
  const allRecords: UsageRecord[] = [];
  const dbPaths = getCindyDbPaths();
  if (dbPaths.length === 0) return allRecords;

  for (const dbPath of dbPaths) {
    try {
      const query = "SELECT day, model, cost_usd, input_tokens, output_tokens, cache_read_tokens, cache_create_tokens FROM daily_model_usage WHERE agent_kind = 'codex' ORDER BY day";
      const result = spawnSync("sqlite3", [dbPath, "-json", query], {
        encoding: "utf8",
        timeout: 10000,
      });

      if (result.status !== 0) continue;
      const output = result.stdout?.trim();
      if (!output) continue;

      const rows = JSON.parse(output) as Array<{
        day: string;
        model: string;
        cost_usd: number;
        input_tokens: number;
        output_tokens: number;
        cache_read_tokens: number;
        cache_create_tokens: number;
      }>;

      for (const row of rows) {
        allRecords.push({
          date: row.day,
          providerId: "codex",
          modelId: row.model,
          inputTokens: row.input_tokens ?? 0,
          outputTokens: row.output_tokens ?? 0,
          cacheReadTokens: row.cache_read_tokens ?? 0,
          cacheWriteTokens: row.cache_create_tokens ?? 0,
          requests: 1,
          cost: row.cost_usd ?? 0,
        });
      }
    } catch {
      // skip this db
    }
  }

  allRecords.sort((a, b) => a.date.localeCompare(b.date));
  return allRecords;
}

// ─── ChatGPT / Codex Desktop Usage ─────────────────────

/**
 * ChatGPT/Codex Desktop stores local rollout sessions as JSONL under
 * ~/.codex/sessions and ~/.codex/archived_sessions. Each `token_count` event
 * contains the usage for the latest model response, so it can be normalized
 * into the same UsageRecord shape used by Pi sessions.
 */
function collectJsonlFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  try {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      try {
        if (statSync(path).isDirectory()) collectJsonlFiles(path, out);
        else if (name.endsWith(".jsonl")) out.push(path);
      } catch {
        // Ignore files that disappear while the desktop app is writing.
      }
    }
  } catch {
    // Ignore inaccessible directories.
  }
  return out;
}

function numericUsage(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function modelFromCodexPayload(payload: any): string | undefined {
  const candidates = [
    payload?.model,
    payload?.model_id,
    payload?.modelId,
    payload?.state?.model,
    payload?.thread_settings?.model,
    payload?.thread_settings?.collaboration_mode?.settings?.model,
    payload?.collaboration_mode?.settings?.model,
    payload?.item?.model,
    payload?.item?.content?.model,
    payload?.base_instructions?.provenance?.model,
  ];
  return candidates.find((value) => typeof value === "string" && value.trim())?.trim();
}

function parseCodexSessionFile(filePath: string): UsageRecord[] {
  const records: UsageRecord[] = [];
  let currentModel = "chatgpt";
  try {
    for (const line of readFileSync(filePath, "utf-8").split("\n")) {
      if (!line.trim()) continue;
      let envelope: any;
      try {
        envelope = JSON.parse(line);
      } catch {
        continue;
      }

      const payload = envelope?.payload;
      if (!payload || typeof payload !== "object") continue;
      currentModel = modelFromCodexPayload(payload) || currentModel;
      if (payload.type !== "token_count") continue;

      const usage = payload.info?.last_token_usage;
      if (!usage || typeof usage !== "object") continue;
      const timestamp = typeof envelope.timestamp === "string" ? envelope.timestamp : "";
      if (!timestamp) continue;
      const { date, hour } = cnDateParts(timestamp);
      const rawInputTokens = numericUsage(usage.input_tokens);
      const cachedInputTokens = numericUsage(usage.cached_input_tokens);
      const cacheWriteTokens = numericUsage(usage.cache_write_input_tokens);
      // Codex reports cached/cache-write tokens as subsets of input_tokens.
      // Split them out so the dashboard total remains raw input + output,
      // rather than counting cached context twice.
      const inputTokens = Math.max(rawInputTokens - cachedInputTokens - cacheWriteTokens, 0);
      // reasoning_output_tokens is informational and already included in
      // output_tokens (total_tokens = input_tokens + output_tokens).
      const outputTokens = numericUsage(usage.output_tokens);

      // The local format has no per-call price. Keep cost at zero rather than
      // inventing a price for a ChatGPT subscription/Codex plan.
      records.push({
        date,
        hour,
        providerId: "chatgpt",
        modelId: currentModel,
        inputTokens,
        outputTokens,
        cacheReadTokens: cachedInputTokens,
        cacheWriteTokens,
        requests: 1,
        cost: 0,
      });
    }
  } catch {
    // Ignore unreadable or partially-written rollout files.
  }
  return records;
}

const CODEX_USAGE_TTL_MS = 30_000;
let codexUsageCache: { records: UsageRecord[]; at: number } | null = null;

export function readChatgptUsage(): UsageRecord[] {
  if (codexUsageCache && Date.now() - codexUsageCache.at < CODEX_USAGE_TTL_MS) {
    return codexUsageCache.records;
  }
  const files = [
    ...collectJsonlFiles(join(CODEX_DIR, "sessions")),
    ...collectJsonlFiles(join(CODEX_DIR, "archived_sessions")),
  ];
  const records = files.flatMap(parseCodexSessionFile).sort((a, b) => a.date.localeCompare(b.date));
  codexUsageCache = { records, at: Date.now() };
  return records;
}

export function clearChatgptUsageCache(): void {
  codexUsageCache = null;
}

// ─── AtomCode Usage ────────────────────────────────────

const ATOMCODE_DIR = join(homedir(), ".atomcode");

/**
 * Read usage records from AtomCode sessions under ~/.atomcode/sessions.
 * Each JSONL line carries an optional usage object:
 *   { prompt, completion, cached } — mapped to input/output/cacheRead.
 * Model id is sniffed from the snapshot system prompt (e.g.
 * "running the deepseek-v4-flash model"), defaulting to "atomcode".
 */
export function readAtomcodeUsage(): UsageRecord[] {
  const allRecords: UsageRecord[] = [];
  const sessionsDir = join(ATOMCODE_DIR, "sessions");
  if (!existsSync(sessionsDir)) return allRecords;

  let sessionDirs: string[] = [];
  try {
    sessionDirs = readdirSync(sessionsDir)
      .map((name) => join(sessionsDir, name))
      .filter((dir) => statSync(dir).isDirectory());
  } catch {
    return allRecords;
  }

  for (const dir of sessionDirs) {
    const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
    for (const file of files) {
      const filePath = join(dir, file);
      try {
        const raw = readFileSync(filePath, "utf-8");
        const model = sniffAtomcodeModel(join(dir, file.replace(/\.jsonl$/, ".snapshot")));
        for (const line of raw.split("\n").filter((l) => l.trim())) {
          try {
            const obj = JSON.parse(line);
            const usage = obj.usage;
            if (!usage || typeof usage.prompt !== "number") continue;
            const { date, hour } = cnDateParts(obj.iso ?? obj.ts ?? "");
            allRecords.push({
              date,
              hour,
              providerId: "atomcode",
              modelId: model,
              inputTokens: usage.prompt ?? 0,
              outputTokens: usage.completion ?? 0,
              cacheReadTokens: usage.cached ?? 0,
              cacheWriteTokens: 0,
              requests: 1,
              cost: 0,
            });
          } catch {
            // skip malformed lines
          }
        }
      } catch {
        // skip unreadable files
      }
    }
  }

  allRecords.sort((a, b) => a.date.localeCompare(b.date));
  return allRecords;
}

/** Extract the model name from an AtomCode snapshot system prompt. */
function sniffAtomcodeModel(snapshotPath: string): string {
  try {
    if (!existsSync(snapshotPath)) return "atomcode";
    const txt = readFileSync(snapshotPath, "utf-8");
    const m = txt.match(/running the ([\w.-]+) model/i);
    return m?.[1] ?? "atomcode";
  } catch {
    return "atomcode";
  }
}

// ─── Copilot Usage (Local session-store.db) ────────────
//
// The Copilot CLI records every assistant turn's token usage in a local
// SQLite database (~/.copilot/session-store.db, table
// assistant_usage_events). We read it directly — no GitHub Billing REST
// API or PAT required, and it works even when the account isn't on the
// enhanced billing platform.

const COPILOT_CONFIG_PATH = join(PI_DIR, "copilot.json");

interface CopilotConfig {
  username?: string;
  token?: string;
}

export function readCopilotConfig(): CopilotConfig {
  try {
    if (!existsSync(COPILOT_CONFIG_PATH)) return {};
    const raw = readFileSync(COPILOT_CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw) as CopilotConfig;
    return {
      username: typeof parsed.username === "string" ? parsed.username : undefined,
      token: typeof parsed.token === "string" ? parsed.token : undefined,
    };
  } catch {
    return {};
  }
}

export function writeCopilotConfig(cfg: CopilotConfig): boolean {
  try {
    const clean: CopilotConfig = {
      username: cfg.username?.trim() || undefined,
      token: cfg.token?.trim() || undefined,
    };
    writeFileSync(COPILOT_CONFIG_PATH, JSON.stringify(clean, null, 2), "utf-8");
    return true;
  } catch {
    return false;
  }
}

const COPILOT_STORE_PATH = join(homedir(), ".copilot", "session-store.db");

function copilotNum(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * Read all usage events from the local Copilot session-store.db and map them
 * to UsageRecords bucketed in China time (UTC+8) like every other source.
 * Each event = one assistant turn → one request. Local DB has no cost info,
 * so cost is always 0 (token counts are still fully populated).
 */
function readCopilotStore(): UsageRecord[] {
  const records: UsageRecord[] = [];
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(COPILOT_STORE_PATH, { readOnly: true });
    const rows = db
      .prepare(
        `SELECT model, input_tokens, output_tokens, cache_read_tokens,
                cache_write_tokens, created_at
         FROM assistant_usage_events`
      )
      .all() as Array<Record<string, unknown>>;

    for (const row of rows) {
      const ts = row.created_at;
      if (typeof ts !== "string" || !ts) continue;
      const { date, hour } = cnDateParts(ts);
      records.push({
        date,
        hour,
        providerId: "copilot",
        modelId: typeof row.model === "string" && row.model ? row.model : "copilot",
        inputTokens: copilotNum(row.input_tokens),
        outputTokens: copilotNum(row.output_tokens),
        cacheReadTokens: copilotNum(row.cache_read_tokens),
        cacheWriteTokens: copilotNum(row.cache_write_tokens),
        requests: 1,
        cost: 0,
      });
    }
  } catch {
    // DB missing, locked by a running Copilot CLI, or node:sqlite not
    // available — report zero usage instead of failing the dashboard.
  } finally {
    try {
      db?.close();
    } catch {
      /* ignore */
    }
  }

  records.sort((a, b) => a.date.localeCompare(b.date));
  return records;
}

// Brief cache so the dashboard's auto-refresh doesn't re-open the SQLite DB
// on every request. Reads are cheap (~700 rows), so a short TTL is fine.
const COPILOT_USAGE_TTL_MS = 30_000;
let copilotUsageCache: { records: UsageRecord[]; at: number } | null = null;

/**
 * Synchronous accessor used by the combined view and the Copilot tab.
 * Returns the latest local Copilot records, re-reading the DB when stale.
 */
export function readCopilotUsage(): UsageRecord[] {
  if (copilotUsageCache && Date.now() - copilotUsageCache.at < COPILOT_USAGE_TTL_MS) {
    return copilotUsageCache.records;
  }
  const records = readCopilotStore();
  copilotUsageCache = { records, at: Date.now() };
  return records;
}

/** Drop cached Copilot data — called after config changes so usage refetches. */
export function clearCopilotCaches(): void {
  copilotUsageCache = null;
}

// ─── Provider-Based Filtering ──────────────────────────

/**
 * Provider filter patterns. Each provider has a list of regex patterns
 * that match against providerId and modelId to classify records.
 */
export interface ProviderFilter {
  id: string;
  label: string;
  patterns: RegExp[];
}

export const PROVIDER_FILTERS: ProviderFilter[] = [
  {
    id: "chatgpt",
    label: "ChatGPT",
    // ChatGPT/OpenAI model calls can be recorded under a direct OpenAI
    // provider or behind a compatible gateway. Match provider and model names
    // so the dashboard can surface them as one source without changing the
    // original records used by the default Pi view.
    patterns: [/^(openai|chatgpt|openai-chatgpt)$/i, /chatgpt/i, /openai/i, /^gpt[-_]/i, /^o[1345](?:[-_]|$)/i],
  },
  {
    id: "atomcode",
    label: "AtomCode",
    patterns: [/^atomcode$/i],
  },
  {
    id: "opencode",
    label: "OpenCode",
    patterns: [/^opencode$/, /^opencode-go$/i],
  },
  {
    id: "gemini",
    label: "Gemini",
    patterns: [/^google$/, /gemini/i],
  },
  {
    id: "grok",
    label: "Grok",
    patterns: [/^xai$/, /grok/i],
  },
];

/**
 * Filter usage records by provider. Matches against both providerId and modelId.
 */
export function filterByProvider(records: UsageRecord[], providerId: string): UsageRecord[] {
  const filter = PROVIDER_FILTERS.find((f) => f.id === providerId);
  if (!filter) return records;
  return records.filter((r) =>
    filter.patterns.some((p) => p.test(r.providerId) || p.test(r.modelId))
  );
}

// ─── Aggregation Helpers ────────────────────────────────

export function getDailyAggregates(records: UsageRecord[]) {
  const daily = new Map<
    string,
    {
      totalTokens: number;
      totalCost: number;
      totalRequests: number;
      inputTokens: number;
      outputTokens: number;
    }
  >();

  for (const r of records) {
    const d = daily.get(r.date) ?? {
      totalTokens: 0,
      totalCost: 0,
      totalRequests: 0,
      inputTokens: 0,
      outputTokens: 0,
    };
    d.totalTokens += r.inputTokens + r.outputTokens + r.cacheReadTokens + r.cacheWriteTokens;
    d.totalCost += r.cost;
    d.totalRequests += r.requests;
    d.inputTokens += r.inputTokens;
    d.outputTokens += r.outputTokens;
    daily.set(r.date, d);
  }

  return Array.from(daily.entries())
    .map(([date, agg]) => ({ date, ...agg }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function getProviderSummaries(records: UsageRecord[]) {
  const sums = new Map<
    string,
    { totalTokens: number; totalCost: number; totalRequests: number }
  >();

  for (const r of records) {
    const s = sums.get(r.providerId) ?? {
      totalTokens: 0,
      totalCost: 0,
      totalRequests: 0,
    };
    s.totalTokens += r.inputTokens + r.outputTokens + r.cacheReadTokens + r.cacheWriteTokens;
    s.totalCost += r.cost;
    s.totalRequests += r.requests;
    sums.set(r.providerId, s);
  }

  return Array.from(sums.entries()).map(([providerId, s]) => ({
    providerId,
    ...s,
  }));
}

export function getModelSummaries(records: UsageRecord[]) {
  const sums = new Map<
    string,
    {
      providerId: string;
      totalTokens: number;
      totalCost: number;
      totalRequests: number;
      count: number;
    }
  >();

  for (const r of records) {
    const key = `${r.providerId}/${r.modelId}`;
    const s = sums.get(key) ?? {
      providerId: r.providerId,
      totalTokens: 0,
      totalCost: 0,
      totalRequests: 0,
      count: 0,
    };
    s.totalTokens += r.inputTokens + r.outputTokens + r.cacheReadTokens + r.cacheWriteTokens;
    s.totalCost += r.cost;
    s.totalRequests += r.requests;
    s.count++;
    sums.set(key, s);
  }

  return Array.from(sums.entries()).map(([key, s]) => {
    const [providerId, modelId] = key.split("/");
    return {
      modelId: modelId!,
      providerId: s.providerId,
      totalTokens: s.totalTokens,
      totalCost: s.totalCost,
      totalRequests: s.totalRequests,
      avgTokensPerRequest: s.totalRequests > 0 ? Math.round(s.totalTokens / s.totalRequests) : 0,
    };
  });
}

export function getTotals(records: UsageRecord[]) {
  let totalTokens = 0;
  let totalCost = 0;
  let totalRequests = 0;

  for (const r of records) {
    totalTokens += r.inputTokens + r.outputTokens + r.cacheReadTokens + r.cacheWriteTokens;
    totalCost += r.cost;
    totalRequests += r.requests;
  }

  return { totalTokens, totalCost, totalRequests };
}

// ─── Date-Range Usage ───────────────────────────────────

export function getUsageByRange(records: UsageRecord[], fromDate: string, toDate: string) {
  const filtered = records.filter((r) => r.date >= fromDate && r.date <= toDate);

  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  let totalCacheWrite = 0;
  let totalCost = 0;
  let totalRequests = 0;

  for (const r of filtered) {
    totalInput += r.inputTokens;
    totalOutput += r.outputTokens;
    totalCacheRead += r.cacheReadTokens;
    totalCacheWrite += r.cacheWriteTokens;
    totalCost += r.cost;
    totalRequests += r.requests;
  }

  // totalTokens counts all processed tokens including cached context reads.
  // Cache hits are billed at a lower rate, but they still count as usage.
  const totalTokens = totalInput + totalOutput + totalCacheRead + totalCacheWrite;
  const cacheHitRate = totalTokens > 0 ? ((totalCacheRead + totalCacheWrite) / totalTokens) * 100 : 0;

  // Per-day breakdown for the trend chart
  const daily = new Map<string, {
    input: number; output: number; cacheRead: number; cacheWrite: number;
    cost: number; requests: number;
  }>();

  for (const r of filtered) {
    const d = daily.get(r.date) ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, requests: 0 };
    d.input += r.inputTokens;
    d.output += r.outputTokens;
    d.cacheRead += r.cacheReadTokens;
    d.cacheWrite += r.cacheWriteTokens;
    d.cost += r.cost;
    d.requests += r.requests;
    daily.set(r.date, d);
  }

  // Hourly breakdown for "today" view
  const hourly = new Map<string, {
    hour: string;
    input: number; output: number; cacheRead: number; cacheWrite: number;
    cost: number; requests: number;
  }>();

  for (const r of filtered) {
    if (r.hour !== undefined) {
      const hKey = `${r.date} ${String(r.hour).padStart(2, "0")}:00`;
      const h = hourly.get(hKey) ?? {
        hour: hKey, input: 0, output: 0, cacheRead: 0, cacheWrite: 0,
        cost: 0, requests: 0,
      };
      h.input += r.inputTokens;
      h.output += r.outputTokens;
      h.cacheRead += r.cacheReadTokens;
      h.cacheWrite += r.cacheWriteTokens;
      h.cost += r.cost;
      h.requests += r.requests;
      hourly.set(hKey, h);
    }
  }

  // Build request log entries from filtered records
  // Each record represents one assistant message with usage data
  // Group by (date, providerId, modelId) to form log entries
  const requestLog = new Map<string, {
    timestamp: string;
    providerId: string;
    modelId: string;
    input: number;
    output: number;
    cost: number;
    requests: number;
  }>();

  for (const r of filtered) {
    const key = `${r.date}|${r.providerId}|${r.modelId}`;
    const existing = requestLog.get(key) ?? {
      timestamp: r.date,
      providerId: r.providerId,
      modelId: r.modelId,
      input: 0,
      output: 0,
      cost: 0,
      requests: 0,
    };
    existing.input += r.inputTokens;
    existing.output += r.outputTokens;
    existing.cost += r.cost;
    existing.requests += r.requests;
    requestLog.set(key, existing);
  }

  // Build provider stats
  const providerStats = new Map<string, {
    providerId: string;
    totalTokens: number;
    totalInput: number;
    totalOutput: number;
    totalCost: number;
    totalRequests: number;
    modelCount: Set<string>;
  }>();

  // Build model stats
  const modelStats = new Map<string, {
    modelId: string;
    providerId: string;
    totalTokens: number;
    totalInput: number;
    totalOutput: number;
    totalCost: number;
    totalRequests: number;
  }>();

  for (const r of filtered) {
    // Provider stats
    const ps = providerStats.get(r.providerId) ?? {
      providerId: r.providerId,
      totalTokens: 0,
      totalInput: 0,
      totalOutput: 0,
      totalCost: 0,
      totalRequests: 0,
      modelCount: new Set<string>(),
    };
    ps.totalTokens += r.inputTokens + r.outputTokens + r.cacheReadTokens + r.cacheWriteTokens;
    ps.totalInput += r.inputTokens;
    ps.totalOutput += r.outputTokens;
    ps.totalCost += r.cost;
    ps.totalRequests += r.requests;
    ps.modelCount.add(r.modelId);
    providerStats.set(r.providerId, ps);

    // Model stats
    const mk = `${r.providerId}/${r.modelId}`;
    const ms = modelStats.get(mk) ?? {
      modelId: r.modelId,
      providerId: r.providerId,
      totalTokens: 0,
      totalInput: 0,
      totalOutput: 0,
      totalCost: 0,
      totalRequests: 0,
    };
    ms.totalTokens += r.inputTokens + r.outputTokens + r.cacheReadTokens + r.cacheWriteTokens;
    ms.totalInput += r.inputTokens;
    ms.totalOutput += r.outputTokens;
    ms.totalCost += r.cost;
    ms.totalRequests += r.requests;
    modelStats.set(mk, ms);
  }

  return {
    totalTokens,
    totalInput,
    totalOutput,
    totalCacheRead,
    totalCacheWrite,
    totalCost,
    totalRequests,
    cacheHitRate: Math.round(cacheHitRate * 10) / 10,
    dailyBreakdown: Array.from(daily.entries())
      .map(([date, d]) => ({ date, ...d }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    hourlyBreakdown: Array.from(hourly.entries())
      .map(([, h]) => ({ hour: h.hour, input: h.input, output: h.output, cacheRead: h.cacheRead, cacheWrite: h.cacheWrite, cost: h.cost, requests: h.requests }))
      .sort((a, b) => a.hour.localeCompare(b.hour)),
    requestLog: Array.from(requestLog.values())
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp)),
    providerStats: Array.from(providerStats.values())
      .map((ps) => ({ ...ps, modelCount: ps.modelCount.size }))
      .sort((a, b) => b.totalCost - a.totalCost),
    modelStats: Array.from(modelStats.values())
      .sort((a, b) => b.totalCost - a.totalCost),
  };
}

// ─── Hermes Memory Reader ───────────────────────────────

const HERMES_DIR = join(PI_DIR, "pi-hermes-memory");

interface MemoryFile {
  name: string;
  filename: string;
  content: string;
  updatedAt: string;
}

export function readMemoryFiles(): MemoryFile[] {
  const files = [
    { name: "Project Memories", filename: "MEMORY.md" },
    { name: "User Profile", filename: "USER.md" },
    { name: "Failure Records", filename: "failures.md" },
  ];

  return files.map(({ name, filename }) => {
    const filePath = join(HERMES_DIR, filename);
    let content = "";
    let updatedAt = "";
    try {
      if (existsSync(filePath)) {
        content = readFileSync(filePath, "utf-8");
        const stat = statSync(filePath);
        updatedAt = stat.mtime.toISOString();
      }
    } catch {
      content = "// Error reading file";
    }
    return { name, filename, content, updatedAt };
  });
}

// ─── Session Listing ────────────────────────────────────

interface SessionFileInfo {
  id: string;
  fileName: string;
  filePath: string;
  timestamp: string;
  lastActive: string;
  name?: string;
  provider?: string;
  model?: string;
  messageCount: number;
  duration?: number;
}

interface ProjectGroup {
  projectPath: string;
  projectName: string;
  sessions: SessionFileInfo[];
  totalSessions: number;
  lastActive: string;
}

function decodeProjectName(dirName: string): { projectPath: string; projectName: string } {
  // dirName: "--Users-a123--workspace-wwwroot-X-xenicalofficial-official-v1--"
  // Replace "--" with "/", trim leading/trailing "/" and "-"
  let decoded = dirName.replace(/^--|--$/g, "").replace(/--/g, "/");
  // Remove leading "/Users/a123" or similar home path prefix for display
  const home = homedir();
  let displayName = decoded;
  if (displayName.startsWith(home)) {
    displayName = "~" + displayName.slice(home.length);
  }
  // Use the last 1-2 path segments as the project name
  const segments = displayName.split("/").filter(Boolean);
  const projectName = segments.length > 0 ? (segments[segments.length - 1] ?? dirName) : dirName;
  return { projectPath: decoded, projectName };
}

export function listSessions(): ProjectGroup[] {
  const dirs = getSessionDirs();
  const groups = new Map<string, ProjectGroup>();

  for (const dir of dirs) {
    const dirName = dir.split("/").pop() || dir;
    const { projectPath, projectName } = decodeProjectName(dirName);

    if (!groups.has(projectPath)) {
      groups.set(projectPath, {
        projectPath,
        projectName,
        sessions: [],
        totalSessions: 0,
        lastActive: "",
      });
    }

    const group = groups.get(projectPath)!;
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".jsonl"))
      .sort()
      .reverse(); // newest first

    for (const file of files) {
      const filePath = join(dir, file);
      const session = parseSessionFileInfo(filePath);
      if (session) {
        group.sessions.push(session);
      }
    }

    group.totalSessions = group.sessions.length;
    if (group.sessions.length > 0) {
      group.lastActive = group.sessions[0]?.timestamp ?? ""; // already sorted newest-first
    }
  }

  // Sort groups by lastActive descending
  return Array.from(groups.values())
    .filter((g) => g.sessions.length > 0)
    .sort((a, b) => b.lastActive.localeCompare(a.lastActive));
}

function parseSessionFileInfo(filePath: string): SessionFileInfo | null {
  try {
    const raw = readFileSync(filePath, "utf-8");
    const lines = raw.split("\n").filter((l) => l.trim());

    let id = "";
    let timestamp = "";
    let name: string | undefined;
    let provider = "unknown";
    let model = "unknown";
    let messageCount = 0;
    let firstTs = 0;
    let lastTs = 0;

    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        const type = obj.type;

        if (type === "session") {
          id = obj.id || "";
          timestamp = obj.timestamp || "";
          const ts = new Date(timestamp).getTime();
          firstTs = ts;
          lastTs = ts;
        } else if (type === "session_info") {
          name = obj.name || name;
        } else if (type === "model_change") {
          provider = obj.provider || provider;
          model = obj.modelId || model;
        } else if (type === "message") {
          messageCount++;
          const ts = new Date(obj.timestamp).getTime();
          if (ts > lastTs) lastTs = ts;
          if (firstTs === 0) firstTs = ts;
        }
      } catch {
        // skip
      }
    }

    const duration = lastTs > firstTs ? lastTs - firstTs : undefined;
    const fileName = filePath.split("/").pop() || filePath;

    return {
      id,
      fileName,
      filePath,
      timestamp,
      lastActive: lastTs > 0 ? new Date(lastTs).toISOString() : timestamp,
      name,
      provider,
      model,
      messageCount,
      duration,
    };
  } catch {
    return null;
  }
}

// ─── Delete Session ─────────────────────────────────────

export function deleteSessionFile(filePath: string): boolean {
  try {
    // Security: only allow deleting files within the sessions directory
    const sessionsPath = join(PI_DIR, "sessions");
    if (!filePath.startsWith(sessionsPath)) return false;
    if (!filePath.endsWith(".jsonl")) return false;
    if (!existsSync(filePath)) return false;

    unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
}

// ─── Session Trash (shared with pi-desktop: ~/.pi/agent/.trash) ───

const SESSIONS_DIR = join(PI_DIR, "sessions");
const TRASH_DIR = join(PI_DIR, ".trash");

export interface TrashEntry {
  trashPath: string;
  originalPath: string;
  fileName: string;
  trashedAt: string;
  sessionId: string;
  sessionName: string;
  lastActive: string;
  messageCount: number;
}

function walkJsonl(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const p = join(dir, name);
    try {
      if (statSync(p).isDirectory()) walkJsonl(p, out);
      else if (name.endsWith(".jsonl")) out.push(p);
    } catch {
      // skip
    }
  }
}

const STALE_SESSION_DAYS = 14;

/**
 * Move sessions with no activity for more than 14 days into the recoverable
 * trash. The last message/session timestamp is preferred; file mtime is the
 * fallback for malformed or very old session files without timestamps.
 */
export function autoTrashStaleSessions(maxAgeDays = STALE_SESSION_DAYS): { moved: number; paths: string[] } {
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const files: string[] = [];
  walkJsonl(SESSIONS_DIR, files);
  const moved: string[] = [];

  for (const filePath of files) {
    let lastActiveMs = 0;
    const info = parseSessionFileInfo(filePath);
    if (info?.lastActive) lastActiveMs = new Date(info.lastActive).getTime();
    if (!Number.isFinite(lastActiveMs) || lastActiveMs <= 0) {
      try {
        lastActiveMs = statSync(filePath).mtimeMs;
      } catch {
        continue;
      }
    }
    if (lastActiveMs >= cutoff) continue;
    if (trashSessionFile(filePath)) moved.push(filePath);
  }

  return { moved: moved.length, paths: moved };
}

/** Move a session file into the trash, preserving its path relative to the sessions dir. */
export function trashSessionFile(filePath: string): boolean {
  try {
    const resolved = resolve(filePath);
    if (!resolved.startsWith(SESSIONS_DIR + sep)) return false;
    if (!resolved.endsWith(".jsonl") || !existsSync(resolved)) return false;
    const rel = relative(SESSIONS_DIR, resolved);
    const trashPath = join(TRASH_DIR, rel);
    mkdirSync(dirname(trashPath), { recursive: true });
    renameSync(resolved, trashPath);
    return true;
  } catch {
    return false;
  }
}

export function listTrash(): TrashEntry[] {
  const files: string[] = [];
  walkJsonl(TRASH_DIR, files);
  const entries: TrashEntry[] = [];
  for (const trashPath of files) {
    const info = parseSessionFileInfo(trashPath);
    let trashedAt = "";
    try {
      // ctime updates on rename — reflects when the file entered the trash
      trashedAt = statSync(trashPath).ctime.toISOString();
    } catch {
      // keep empty
    }
    const rel = relative(TRASH_DIR, trashPath);
    entries.push({
      trashPath,
      originalPath: join(SESSIONS_DIR, rel),
      fileName: trashPath.split("/").pop() || trashPath,
      trashedAt,
      sessionId: info?.id || "",
      sessionName: info?.name || "",
      lastActive: info?.lastActive || "",
      messageCount: info?.messageCount || 0,
    });
  }
  return entries.sort((a, b) => b.trashedAt.localeCompare(a.trashedAt));
}

export function restoreFromTrash(trashPath: string): boolean {
  try {
    const resolved = resolve(trashPath);
    if (!resolved.startsWith(TRASH_DIR + sep) || !existsSync(resolved)) return false;
    const rel = relative(TRASH_DIR, resolved);
    const original = join(SESSIONS_DIR, rel);
    mkdirSync(dirname(original), { recursive: true });
    renameSync(resolved, original);
    return true;
  } catch {
    return false;
  }
}

export function permanentlyDeleteTrash(trashPath: string): boolean {
  try {
    const resolved = resolve(trashPath);
    if (!resolved.startsWith(TRASH_DIR + sep) || !existsSync(resolved)) return false;
    unlinkSync(resolved);
    return true;
  } catch {
    return false;
  }
}

// ─── Session Preview ────────────────────────────────

export interface SessionPreviewMessage {
  role: string;
  text: string;
  timestamp: string;
}

/** Read the first user/assistant messages of a session file (text parts only). */
export function readSessionPreview(filePath: string, limit = 20): { messages: SessionPreviewMessage[]; total: number } | null {
  try {
    const resolved = resolve(filePath);
    const inSessions = resolved.startsWith(SESSIONS_DIR + sep);
    const inTrash = resolved.startsWith(TRASH_DIR + sep);
    if ((!inSessions && !inTrash) || !resolved.endsWith(".jsonl") || !existsSync(resolved)) return null;

    const lines = readFileSync(resolved, "utf-8").split("\n").filter((l) => l.trim());
    const messages: SessionPreviewMessage[] = [];
    let total = 0;
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        if (obj.type !== "message") continue;
        const msg = obj.message || {};
        const role = msg.role || "";
        if (role !== "user" && role !== "assistant") continue;
        total++;
        if (messages.length >= limit) continue;
        // Extract text parts; fall back to a tool-call marker for pure tool turns
        let text = "";
        if (typeof msg.content === "string") {
          text = msg.content;
        } else if (Array.isArray(msg.content)) {
          text = msg.content
            .filter((c: any) => c?.type === "text" && c.text)
            .map((c: any) => c.text)
            .join("\n");
          if (!text) {
            const tools = msg.content.filter((c: any) => c?.type === "toolCall").length;
            if (tools > 0) text = `[${tools} tool call${tools > 1 ? "s" : ""}]`;
          }
        }
        text = text.trim();
        if (text.length > 400) text = text.slice(0, 400) + "…";
        messages.push({ role, text, timestamp: obj.timestamp || "" });
      } catch {
        // skip
      }
    }
    return { messages, total };
  } catch {
    return null;
  }
}

// ─── Memory Entry Deletion ───────────────────────────

const MEMORY_FILENAMES = ["MEMORY.md", "USER.md", "failures.md"];

// ─── Hermes Memory Config (auto-write model + optimize) ──
// The pi-hermes-memory extension reads ~/.pi/agent/hermes-memory-config.json
// to decide which model performs automatic memory writes and consolidation
// (`llmModelOverride`, `llmThinkingOverride`) and how long a consolidation run
// may take (`consolidationTimeoutMs`). We read/merge-write just those keys so
// unrelated fields the extension may add later are preserved.
const HERMES_MEMORY_CONFIG_PATH = join(PI_DIR, "hermes-memory-config.json");
const HERMES_EXTENSION_ENTRY = join(
  PI_DIR, "npm", "node_modules", "pi-hermes-memory", "src", "index.ts"
);
const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;
type ThinkingLevel = (typeof THINKING_LEVELS)[number];
const OVERFLOW_STRATEGIES = ["auto-consolidate", "reject", "fifo-evict"] as const;
type OverflowStrategy = (typeof OVERFLOW_STRATEGIES)[number];

// Mirror pi-hermes-memory's own defaults (src/constants.ts) so the panel shows
// the same effective limits the extension enforces when the keys are unset.
const DEFAULT_MEMORY_CHAR_LIMIT = 5000;
const DEFAULT_USER_CHAR_LIMIT = 5000;

export interface HermesMemoryConfig {
  llmModelOverride?: string;
  llmThinkingOverride?: ThinkingLevel;
  consolidationTimeoutMs?: number;
  memoryCharLimit?: number;
  userCharLimit?: number;
  memoryOverflowStrategy?: OverflowStrategy;
}

export function readHermesMemoryConfig(): HermesMemoryConfig {
  try {
    if (!existsSync(HERMES_MEMORY_CONFIG_PATH)) return {};
    const parsed = JSON.parse(readFileSync(HERMES_MEMORY_CONFIG_PATH, "utf-8")) as Record<string, unknown>;
    const out: HermesMemoryConfig = {};
    if (typeof parsed.llmModelOverride === "string" && parsed.llmModelOverride.trim()) {
      out.llmModelOverride = parsed.llmModelOverride.trim();
    }
    if (typeof parsed.llmThinkingOverride === "string" && (THINKING_LEVELS as readonly string[]).includes(parsed.llmThinkingOverride)) {
      out.llmThinkingOverride = parsed.llmThinkingOverride as ThinkingLevel;
    }
    if (typeof parsed.consolidationTimeoutMs === "number" && Number.isFinite(parsed.consolidationTimeoutMs)) {
      out.consolidationTimeoutMs = parsed.consolidationTimeoutMs;
    }
    if (typeof parsed.memoryCharLimit === "number" && Number.isFinite(parsed.memoryCharLimit) && parsed.memoryCharLimit > 0) {
      out.memoryCharLimit = parsed.memoryCharLimit;
    }
    if (typeof parsed.userCharLimit === "number" && Number.isFinite(parsed.userCharLimit) && parsed.userCharLimit > 0) {
      out.userCharLimit = parsed.userCharLimit;
    }
    if (typeof parsed.memoryOverflowStrategy === "string" && (OVERFLOW_STRATEGIES as readonly string[]).includes(parsed.memoryOverflowStrategy)) {
      out.memoryOverflowStrategy = parsed.memoryOverflowStrategy as OverflowStrategy;
    }
    return out;
  } catch {
    return {};
  }
}

/** Merge-write the auto-write model settings, preserving any other keys. */
export function writeHermesMemoryConfig(patch: HermesMemoryConfig): boolean {
  try {
    let existing: Record<string, unknown> = {};
    if (existsSync(HERMES_MEMORY_CONFIG_PATH)) {
      try {
        existing = JSON.parse(readFileSync(HERMES_MEMORY_CONFIG_PATH, "utf-8")) as Record<string, unknown>;
      } catch {
        existing = {};
      }
    }
    // Empty string clears the override so the extension falls back to defaults.
    if (patch.llmModelOverride !== undefined) {
      const v = patch.llmModelOverride.trim();
      if (v) existing.llmModelOverride = v;
      else delete existing.llmModelOverride;
    }
    if (patch.llmThinkingOverride !== undefined) {
      if ((THINKING_LEVELS as readonly string[]).includes(patch.llmThinkingOverride)) {
        existing.llmThinkingOverride = patch.llmThinkingOverride;
      }
    }
    if (patch.consolidationTimeoutMs !== undefined && Number.isFinite(patch.consolidationTimeoutMs)) {
      existing.consolidationTimeoutMs = patch.consolidationTimeoutMs;
    }
    if (patch.memoryCharLimit !== undefined && Number.isFinite(patch.memoryCharLimit) && patch.memoryCharLimit > 0) {
      existing.memoryCharLimit = patch.memoryCharLimit;
    }
    if (patch.userCharLimit !== undefined && Number.isFinite(patch.userCharLimit) && patch.userCharLimit > 0) {
      existing.userCharLimit = patch.userCharLimit;
    }
    if (patch.memoryOverflowStrategy !== undefined && (OVERFLOW_STRATEGIES as readonly string[]).includes(patch.memoryOverflowStrategy)) {
      existing.memoryOverflowStrategy = patch.memoryOverflowStrategy;
    }
    writeFileSync(HERMES_MEMORY_CONFIG_PATH, JSON.stringify(existing, null, 2), "utf-8");
    return true;
  } catch {
    return false;
  }
}

/**
 * Lightweight capacity snapshot for the memory page. Reports per-target usage
 * against the effective char limits the extension enforces (failure gets 2x the
 * memory limit). The extension measures capacity in CHARACTERS, not bytes, so
 * we read each file and use its character length — byte size (statSync) would
 * over-count ~3x for CJK text and show false "over limit" bars.
 */
export function readMemoryStatus(): {
  targets: { filename: string; target: "memory" | "user" | "failure"; chars: number; limit: number }[];
} {
  const cfg = readHermesMemoryConfig();
  const memLimit = cfg.memoryCharLimit ?? DEFAULT_MEMORY_CHAR_LIMIT;
  const userLimit = cfg.userCharLimit ?? DEFAULT_USER_CHAR_LIMIT;
  const map: { filename: string; target: "memory" | "user" | "failure"; limit: number }[] = [
    { filename: "MEMORY.md", target: "memory", limit: memLimit },
    { filename: "USER.md", target: "user", limit: userLimit },
    { filename: "failures.md", target: "failure", limit: memLimit * 2 },
  ];
  return {
    targets: map.map(({ filename, target, limit }) => {
      const p = join(HERMES_DIR, filename);
      let chars = 0;
      try {
        chars = existsSync(p) ? readFileSync(p, "utf-8").length : 0;
      } catch {
        chars = 0;
      }
      return { filename, target, chars, limit };
    }),
  };
}

/** Resolve a usable `pi` binary: PI_BINARY env → PATH → known install dirs. */
function resolvePiBin(): string | null {
  const home = homedir();
  const candidates = [
    process.env.PI_BINARY,
    "pi",
    `${home}/.npm-global/bin/pi`,
    `${home}/.local/share/pnpm/pi`,
  ].filter(Boolean) as string[];
  for (const bin of candidates) {
    try {
      const out = spawnSync(bin, ["--version"], { encoding: "utf8", timeout: 15000 });
      if (out.status === 0 && out.stdout.trim()) return bin;
    } catch {
      // try next
    }
  }
  // Fall back to `which pi`
  try {
    const which = spawnSync("which", ["pi"], { encoding: "utf8", timeout: 5000 });
    if (which.status === 0 && which.stdout.trim()) return which.stdout.trim();
  } catch {
    // ignore
  }
  return null;
}

function memoryFileSizes(): Record<string, number> {
  const sizes: Record<string, number> = {};
  for (const name of MEMORY_FILENAMES) {
    const p = join(HERMES_DIR, name);
    try {
      sizes[name] = existsSync(p) ? statSync(p).size : 0;
    } catch {
      sizes[name] = 0;
    }
  }
  return sizes;
}

export interface OptimizeMemoryResult {
  success: boolean;
  before: Record<string, number>;
  after: Record<string, number>;
  freedBytes: number;
  message?: string;
}

/**
 * One-click memory optimization. Runs pi's `/memory-consolidate` command in a
 * headless child process with the pi-hermes-memory extension loaded, using the
 * configured auto-write model override. Reports the byte delta across the three
 * memory files. Long-running (the command spawns an LLM turn), so the caller
 * should surface a spinner.
 */
export async function optimizeMemory(): Promise<OptimizeMemoryResult> {
  const before = memoryFileSizes();
  const bin = resolvePiBin();
  if (!bin) {
    return { success: false, before, after: before, freedBytes: 0, message: "pi binary not found" };
  }
  if (!existsSync(HERMES_EXTENSION_ENTRY)) {
    return { success: false, before, after: before, freedBytes: 0, message: "pi-hermes-memory extension not found" };
  }

  const cfg = readHermesMemoryConfig();
  const args = ["-p", "--no-session", "-e", HERMES_EXTENSION_ENTRY];
  if (cfg.llmModelOverride) args.push("--model", cfg.llmModelOverride);
  args.push("--thinking", cfg.llmThinkingOverride ?? "off");

  // Compute per-target capacity so the prompt can name the over-limit targets
  // explicitly. Weak/free models are conservative and skip merging when told
  // only "merge duplicates"; giving them a concrete goal ("USER is at 105%,
  // get it under the limit") is what actually makes them shrink memory.
  const status = readMemoryStatus();
  const capacityLines = status.targets.map((tg) => {
    const pct = tg.limit > 0 ? Math.round((tg.chars / tg.limit) * 100) : 0;
    const over = tg.chars > tg.limit;
    return `- target "${tg.target}" (${tg.filename}): ${tg.chars}/${tg.limit} chars (${pct}%)${over ? " — OVER LIMIT, must shrink below the limit" : ""}`;
  });
  const overTargets = status.targets.filter((tg) => tg.chars > tg.limit).map((tg) => `"${tg.target}"`);

  // Direct consolidation prompt rather than the /memory-consolidate slash
  // command: the slash command spawns a *nested* child pi process per target
  // (memory/user/failure/project), which routinely runs for 10+ minutes.
  // Driving the memory tools directly in this single child is far faster.
  args.push(
    [
      "Consolidate my long-term memory to reduce redundancy WITHOUT losing important facts.",
      "Current capacity per target:",
      ...capacityLines,
      overTargets.length > 0
        ? `The following targets are OVER their limit and MUST be reduced below it: ${overTargets.join(", ")}. This is the primary goal — you must actually remove or merge entries so each over-limit target ends up under its char limit.`
        : "No target is over its limit; still merge any obvious duplicates and drop clearly stale entries.",
      "For EACH target: call memory_search (with an empty or broad query) to list its current entries, then use memory_remove to drop outdated/superseded/duplicate entries and memory_replace/memory_add to merge related entries into fewer, more concise ones.",
      "Always preserve user preferences and explicit corrections (highest priority). Prefer merging several similar entries into one tight entry over deleting unique facts.",
      "Do not stop until every over-limit target is under its limit. When finished, reply with a one-line summary of what changed per target.",
    ].join("\n")
  );

  const timeoutMs = cfg.consolidationTimeoutMs && cfg.consolidationTimeoutMs > 0
    ? cfg.consolidationTimeoutMs
    : 600000;

  try {
    const out = spawnSync(bin, args, {
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024 * 8,
    });
    const after = memoryFileSizes();
    const freedBytes = Object.values(before).reduce((a, b) => a + b, 0)
      - Object.values(after).reduce((a, b) => a + b, 0);
    if (out.error) {
      const killed = (out.error as NodeJS.ErrnoException).code === "ETIMEDOUT";
      return {
        success: false,
        before,
        after,
        freedBytes,
        message: killed ? `consolidation timed out after ${Math.round(timeoutMs / 1000)}s` : String(out.error.message),
      };
    }
    return { success: out.status === 0, before, after, freedBytes, message: out.status === 0 ? undefined : `exit ${out.status}` };
  } catch (e) {
    const after = memoryFileSizes();
    return { success: false, before, after, freedBytes: 0, message: e instanceof Error ? e.message : String(e) };
  }
}


/** Strip the trailing `<!-- created=..., last=... -->` marker from a § section. */
function sectionText(section: string): string {
  return section.replace(/<!--\s*created\s*=[^>]*-->\s*$/, "").trim();
}

/** Delete one §-separated entry (matched by its text) and write the file back. */
export function deleteMemoryEntry(filename: string, entryText: string): boolean {
  try {
    if (!MEMORY_FILENAMES.includes(filename)) return false;
    const filePath = join(HERMES_DIR, filename);
    if (!existsSync(filePath)) return false;

    const content = readFileSync(filePath, "utf-8");
    const sections = content.split("§");
    const target = entryText.trim();
    const idx = sections.findIndex((s) => s.trim().length > 0 && sectionText(s) === target);
    if (idx === -1) return false;

    sections.splice(idx, 1);
    writeFileSync(filePath, sections.join("§"));
    return true;
  } catch {
    return false;
  }
}

// ─── Update Check (npm registry) ────────────────────────

/** npm package that ships the pi binary (bin/pi → its dist/cli.js). */
const PI_CORE_PACKAGE = "@earendil-works/pi-coding-agent";

const REGISTRY_TIMEOUT_MS = 8000;

export interface UpdateItem {
  name: string;
  installed: string;
  latest: string | null; // null → registry lookup failed
  hasUpdate: boolean;
}

export interface UpdateCheckResult {
  pi: UpdateItem | null; // null → pi version unknown (binary missing)
  extensions: UpdateItem[];
  checkedAt: number;
}

/** Discover the installed pi version: PI_BINARY env → PATH → known locations. */
function getPiVersion(): string | null {
  const home = homedir();
  const candidates = [
    process.env.PI_BINARY,
    "pi",
    `${home}/.npm-global/bin/pi`,
    `${home}/.npm-packages/bin/pi`,
    `${home}/.config/yarn/global/node_modules/.bin/pi`,
    `${home}/.local/share/pnpm/pi`,
  ].filter(Boolean) as string[];

  for (const bin of candidates) {
    try {
      const out = spawnSync(bin, ["--version"], { encoding: "utf8", timeout: 15000 });
      if (out.status === 0) {
        const v = out.stdout.trim();
        if (v) return v;
      }
    } catch {
      // try next candidate
    }
  }
  return null;
}

function readJsonFile<T>(filePath: string): T | null {
  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as T;
  } catch {
    return null;
  }
}

/** Numeric segment-wise semver comparison; returns true when latest > installed. */
function isNewerVersion(installed: string, latest: string): boolean {
  const parse = (v: string) =>
    (v.replace(/^v/, "").split("-")[0] ?? "").split(".").map((s) => parseInt(s, 10) || 0);
  const a = parse(installed);
  const b = parse(latest);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    if (bi > ai) return true;
    if (bi < ai) return false;
  }
  return false;
}

// ─── Outbound fetch with local proxy support ───────────
// Node's fetch ignores the OS proxy, so requests to some provider hosts fail
// on machines that rely on a local proxy (e.g. Clash). Detect a proxy from
// env vars or macOS system settings and route through it via undici's
// ProxyAgent; fall back to a direct request when no proxy or the proxy fails.

let undiciPromise: Promise<typeof import("undici") | null> | null = null;
function getUndici(): Promise<typeof import("undici") | null> {
  // Dynamic import: require() of bare packages breaks inside Vite's bundled
  // config (esbuild rewrites it to a throwing __require shim in ESM output).
  if (!undiciPromise) {
    undiciPromise = import("undici").catch(() => null);
  }
  return undiciPromise;
}

let proxyCache: { url: string | null; at: number } | null = null;

function detectProxyUrl(): string | null {
  if (proxyCache && Date.now() - proxyCache.at < 60000) return proxyCache.url;
  let found: string | null =
    process.env.https_proxy ||
    process.env.HTTPS_PROXY ||
    process.env.http_proxy ||
    process.env.HTTP_PROXY ||
    null;
  if (found && !found.startsWith("http")) found = null; // ProxyAgent needs an HTTP proxy
  if (!found && process.platform === "darwin") {
    try {
      const out = spawnSync("scutil", ["--proxy"], { encoding: "utf8", timeout: 3000 }).stdout || "";
      const get = (k: string) => out.match(new RegExp(`${k} : (\\S+)`))?.[1];
      if (get("HTTPSEnable") === "1" && get("HTTPSProxy")) {
        found = `http://${get("HTTPSProxy")}:${get("HTTPSPort") ?? "80"}`;
      } else if (get("HTTPEnable") === "1" && get("HTTPProxy")) {
        found = `http://${get("HTTPProxy")}:${get("HTTPPort") ?? "80"}`;
      }
    } catch {
      /* scutil unavailable — ignore */
    }
  }
  proxyCache = { url: found, at: Date.now() };
  return found;
}

const proxyAgents = new Map<string, import("undici").ProxyAgent>();

async function fetchExternal(
  url: string | URL,
  init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }
): Promise<Response> {
  const target = url instanceof URL ? url.toString() : url;
  const proxy = detectProxyUrl();
  const undici = proxy ? await getUndici() : null;
  if (proxy && undici) {
    try {
      let agent = proxyAgents.get(proxy);
      if (!agent) {
        agent = new undici.ProxyAgent(proxy);
        proxyAgents.set(proxy, agent);
      }
      // Node's built-in fetch rejects a foreign dispatcher — use undici's fetch
      return (await undici.fetch(target, { ...init, dispatcher: agent })) as unknown as Response;
    } catch {
      /* proxy failed — fall through to a direct request */
    }
  }
  return await fetch(target, init);
}

async function fetchLatestVersion(pkgName: string): Promise<string | null> {
  try {
    const res = await fetchExternal(`https://registry.npmjs.org/${encodeURIComponent(pkgName)}/latest`, {
      signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    return typeof data.version === "string" ? data.version : null;
  } catch {
    return null;
  }
}

/** Installed extensions: names from ~/.pi/agent/npm/package.json deps, versions from node_modules. */
function listInstalledExtensions(): { name: string; installed: string }[] {
  const dir = join(PI_DIR, "npm");
  const manifest = readJsonFile<{ dependencies?: Record<string, string> }>(join(dir, "package.json"));
  if (!manifest?.dependencies) return [];
  return Object.keys(manifest.dependencies).map((name) => {
    const pkg = readJsonFile<{ version?: string }>(join(dir, "node_modules", name, "package.json"));
    return { name, installed: pkg?.version ?? "unknown" };
  });
}

/**
 * Check pi core and every installed extension against the npm registry.
 * Registry lookups run in parallel; individual failures degrade to latest=null
 * instead of failing the whole check.
 */
export async function checkUpdates(): Promise<UpdateCheckResult> {
  const piVersion = getPiVersion();
  const extensions = listInstalledExtensions();

  const toItem = async (name: string, installed: string): Promise<UpdateItem> => {
    const latest = await fetchLatestVersion(name);
    return {
      name,
      installed,
      latest,
      hasUpdate: latest !== null && installed !== "unknown" && isNewerVersion(installed, latest),
    };
  };

  const [piItem, ...extItems] = await Promise.all([
    piVersion ? toItem(PI_CORE_PACKAGE, piVersion) : Promise.resolve(null),
    ...extensions.map((e) => toItem(e.name, e.installed)),
  ]);

  return { pi: piItem as UpdateItem | null, extensions: extItems as UpdateItem[], checkedAt: Date.now() };
}

export interface ApplyUpdateResult {
  name: string;
  success: boolean;
  message?: string;
}

/**
 * One-click update: npm install <name>@latest inside ~/.pi/agent/npm.
 * Only packages already installed there are accepted (pi core is excluded —
 * its install method is unknown, so it must be updated via its installer).
 */
export function applyExtensionUpdates(names: string[]): ApplyUpdateResult[] {
  const dir = join(PI_DIR, "npm");
  const installed = new Set(listInstalledExtensions().map((e) => e.name));

  return names.map((name) => {
    if (!installed.has(name)) {
      return { name, success: false, message: "not an installed extension" };
    }
    try {
      // --legacy-peer-deps: peer deps (e.g. pi core) are provided by the pi host,
      // not installed here — strict resolution would fail with ERESOLVE.
      const out = spawnSync(
        "npm",
        ["install", `${name}@latest`, "--no-audit", "--no-fund", "--legacy-peer-deps"],
        {
          cwd: dir,
          encoding: "utf8",
          timeout: 120000,
        }
      );
      if (out.status === 0) return { name, success: true };
      const stderr = (out.stderr || "").trim().split("\n").slice(-3).join(" ");
      return { name, success: false, message: stderr || `npm exited with ${out.status}` };
    } catch (e) {
      return { name, success: false, message: String(e) };
    }
  });
}

// ─── Provider Connection Test ────────────────────────────

export interface ProviderTestResult {
  success: boolean;
  status?: number;
  latencyMs?: number;
  message?: string;
}

/**
 * Test connectivity of a provider endpoint server-side (avoids browser CORS).
 * Requests GET {baseUrl}/models with an optional Bearer key; any HTTP response
 * counts as reachable — 2xx additionally means the key was accepted.
 */
export async function testProviderConnection(
  baseUrl: string,
  apiKey?: string
): Promise<ProviderTestResult> {
  let url: URL;
  try {
    url = new URL(baseUrl.replace(/\/+$/, "") + "/models");
  } catch {
    return { success: false, message: "invalid URL" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { success: false, message: "invalid URL" };
  }

  // Resolve $ENV_VAR style keys the same way pi does
  let key = apiKey ?? "";
  if (key.startsWith("$")) key = process.env[key.slice(1)] ?? "";

  const headers: Record<string, string> = {};
  if (key) headers["Authorization"] = `Bearer ${key}`;

  const started = Date.now();
  try {
    const res = await fetchExternal(url, {
      headers,
      signal: AbortSignal.timeout(10000),
    });
    const latencyMs = Date.now() - started;
    if (res.ok) return { success: true, status: res.status, latencyMs };
    return { success: false, status: res.status, latencyMs, message: `HTTP ${res.status}` };
  } catch (e: any) {
    const latencyMs = Date.now() - started;
    const msg = e?.name === "TimeoutError" ? "timeout" : e?.cause?.code || e?.message || String(e);
    return { success: false, latencyMs, message: msg };
  }
}


/**
 * Fetch the model list from a provider's endpoint server-side.
 * Supports multiple source types:
 *   - OpenAI-compatible /models (default)
 *   - OpenRouter /models (returns pricing, modality, context_length, top_provider.max_completion_tokens)
 *   - Ollama /api/tags (returns model names + capabilities via /api/show)
 *
 * Returns full model metadata so the frontend can prefill the add-model form:
 *   { id, name, contextWindow, maxTokens, reasoning, vision, cost }
 *
 * Reasoning / vision / contextWindow are also heuristically inferred from
 * the model id when the endpoint doesn't report them.
 */
export interface FetchedModel {
  id: string;
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  vision?: boolean;
  audio?: boolean;
  cost?: { input: number; output: number; cacheRead?: number; cacheWrite?: number };
  source: string; // "openai" | "openrouter" | "ollama" | "heuristic"
}

// Parse a numeric value, handling K/M suffixes (e.g. "128k" → 128000)
function toNum(v: any): number | undefined {
  if (typeof v === "number") return v;
  if (typeof v !== "string") return undefined;
  const m = v.match(/^([0-9]+)([KkMm]?)$/);
  if (!m) return undefined;
  const n = parseInt(m[1] ?? "0", 10);
  const u = (m[2] ?? "").toUpperCase();
  return u === "K" ? n * 1000 : u === "M" ? n * 1_000_000 : n;
}

// Heuristic reasoning detection (server-side; mirrors client guessModelMeta)
const REASONING_RE = /(^|[/_\-])(r1|o1|o3|o4|z1|reasoner|reasoning|qwq|deepseek-r|think)([/_\-:]|$)/i;
const VISION_RE = /(vision|[-_]vl\b|multimodal|gpt-4o|gpt-5|claude-(sonnet|opus)|gemini|llama-.*vision|qwen.*vl|glm-.*v\b)/i;
const AUDIO_RE = /(audio|whisper|tts|speech)/i;
function heuristicFlags(id: string): { reasoning?: boolean; vision?: boolean; audio?: boolean; contextWindow?: number } {
  const k = id.toLowerCase();
  const reasoning = REASONING_RE.test(k);
  const vision = VISION_RE.test(k);
  const audio = AUDIO_RE.test(k);
  let contextWindow: number | undefined;
  if (/deepseek[-_]v4[-_](flash|chat)(?:[-_:]|$)/i.test(k)) contextWindow = 1_048_576;
  else if (/[-_](1m|1024k|1048576)\b/i.test(k)) contextWindow = 1_048_576;
  else if (/[-_](256k)\b/i.test(k)) contextWindow = 262_144;
  else if (/[-_](128k)\b/i.test(k)) contextWindow = 131_072;
  else if (/[-_](64k)\b/i.test(k)) contextWindow = 65_536;
  else if (/[-_](32k)\b/i.test(k)) contextWindow = 32_768;
  else if (/[-_](16k)\b/i.test(k)) contextWindow = 16_384;
  else if (/[-_](8k)\b/i.test(k)) contextWindow = 8192;
  return { reasoning, vision, audio, contextWindow };
}

function isOpenRouter(baseUrl: string, host: string): boolean {
  return host === "openrouter.ai" || host.endsWith(".openrouter.ai") ||
    baseUrl.includes("openrouter.ai");
}

async function fetchJson(url: URL, headers: Record<string, string>, timeoutMs = 15000) {
  const res = await fetchExternal(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  const trimmed = text.trimStart();
  const ctype = res.headers.get("content-type") ?? "";
  if (trimmed.startsWith("<") || ctype.includes("text/html")) {
    // The endpoint returned an HTML page (often a site root / 404 served as 200)
    // instead of JSON — almost always a wrong base URL (missing /v1 prefix, etc.).
    throw new Error(`endpoint returned HTML, not JSON (check base URL): ${url.toString()}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`invalid JSON from ${url.toString()}`);
  }
}

function makeHeaders(key: string, providerId?: string, host?: string): Record<string, string> {
  const headers: Record<string, string> = {};
  if (!key) return headers;
  if (providerId === "anthropic" || (host && host.endsWith("api.anthropic.com"))) {
    headers["x-api-key"] = key;
    headers["anthropic-version"] = "2023-06-01";
  } else if (providerId === "google" || (host && host.endsWith("generativelanguage.googleapis.com"))) {
    // Google uses query param; caller handles it
  } else {
    headers["Authorization"] = `Bearer ${key}`;
  }
  return headers;
}

export async function fetchProviderModels(
  baseUrl: string,
  apiKey?: string,
  providerId?: string
): Promise<{ models: FetchedModel[]; error?: string }> {
  let key = apiKey ?? "";
  if (key.startsWith("$")) key = process.env[key.slice(1)] ?? "";

  let base: URL;
  try {
    base = new URL(baseUrl.replace(/\/+$/, ""));
  } catch {
    return { models: [], error: "invalid URL" };
  }
  if (base.protocol !== "http:" && base.protocol !== "https:") {
    return { models: [], error: "invalid URL" };
  }
  const host = base.hostname;

  try {
    // ── Ollama: /api/tags (no /models) ──────────────────
    // Heuristic: local port 11434 or hostname "localhost" + path includes ollama
    const isOllama = host === "localhost" && base.port === "11434";
    if (isOllama) {
      const tagsUrl = new URL("/api/tags", base);
      const data = await fetchJson(tagsUrl, {});
      const models: FetchedModel[] = [];
      const models_ = data?.models ?? [];
      for (const m of models_) {
        const id = typeof m === "string" ? m : m.name ?? m.model ?? "";
        if (!id) continue;
        const flags = heuristicFlags(id);
        // Ollama details: try /api/show for richer info (best-effort, ignore errors)
        let cw: number | undefined = flags.contextWindow;
        let mt: number | undefined;
        try {
          const showUrl = new URL("/api/show", base);
          const show = await fetch(showUrl.toString(), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: id }),
            signal: AbortSignal.timeout(5000),
          }).then((r) => r.json());
          cw = toNum(show?.model_info?.[`${show?.modelfile?.split("\n").find((l: string) => l.startsWith("FROM")) ?? ""}`]) ?? cw;
          if (show?.context_length) cw = toNum(show.context_length) ?? cw;
        } catch { /* ignore */ }
        models.push({
          id,
          contextWindow: cw,
          maxTokens: mt,
          reasoning: flags.reasoning,
          vision: flags.vision,
          audio: flags.audio,
          source: "ollama",
        });
      }
      return { models };
    }

    // ── OpenRouter /models returns rich metadata ────────
    // Append to the full base path (preserve prefixes like /v1 or /v1beta).
    // Using new URL("/models", base) would resolve against the origin and drop the prefix.
    const modelsUrl = new URL(base.toString().replace(/\/+$/, "") + "/models");
    if (providerId === "google" || host.endsWith("generativelanguage.googleapis.com")) {
      if (key) modelsUrl.searchParams.set("key", key);
    }
    const headers = makeHeaders(key, providerId, host);
    const data = await fetchJson(modelsUrl, headers, isOpenRouter(baseUrl, host) ? 20000 : 15000);

    const seen = new Set<string>();
    const models: FetchedModel[] = [];
    const pushModel = (m: FetchedModel) => {
      const v = (m.id ?? "").trim();
      if (!v || seen.has(v)) return;
      seen.add(v);
      // Apply heuristic defaults for fields the endpoint didn't provide
      const flags = heuristicFlags(v);
      m.reasoning = m.reasoning ?? flags.reasoning;
      m.vision = m.vision ?? flags.vision;
      m.audio = m.audio ?? flags.audio;
      m.contextWindow = m.contextWindow ?? flags.contextWindow;
      models.push(m);
    };

    // Vision / modality detectors (vendor-specific shapes)
    const visionOf = (item: any): boolean | undefined => {
      if (!item || typeof item !== "object") return undefined;
      if (typeof item.capabilities?.vision === "boolean") return item.capabilities.vision;
      if (item.supports_vision === true || item.vision === true) return true;
      const mods = item.architecture?.input_modalities ?? item.input_modalities ?? item.modalities;
      if (Array.isArray(mods)) return mods.includes("image");
      const modality = item.architecture?.modality;
      if (typeof modality === "string") {
        return (modality.split("->")[0] ?? "").includes("image");
      }
      return undefined;
    };
    const audioOf = (item: any): boolean | undefined => {
      const mods = item.architecture?.input_modalities ?? item.input_modalities ?? item.modalities;
      if (Array.isArray(mods)) return mods.includes("audio");
      return undefined;
    };
    const reasoningOf = (item: any): boolean | undefined => {
      // OpenRouter doesn't directly expose a reasoning flag, but some providers
      // indicate it via architecture or the id contains reasoner/r1/o1/o3.
      if (item?.reasoning === true || item?.supports_reasoning === true) return true;
      return undefined;
    };
    const parseCost = (pricing: any): FetchedModel["cost"] | undefined => {
      if (!pricing) return undefined;
      // OpenRouter: pricing.prompt, pricing.completion, pricing.cache_read, pricing.cache_write
      // Values are per-token; multiply by 1e6 for $/M.
      const toDollar = (v: any) => typeof v === "string" ? parseFloat(v) * 1_000_000 : (typeof v === "number" ? v * 1_000_000 : undefined);
      const input = toDollar(pricing.prompt ?? pricing.input);
      const output = toDollar(pricing.completion ?? pricing.output);
      const cacheRead = toDollar(pricing.cache_read ?? pricing.cacheRead);
      const cacheWrite = toDollar(pricing.cache_write ?? pricing.cacheWrite);
      if (input === undefined && output === undefined) return undefined;
      return { input: input ?? 0, output: output ?? 0, cacheRead, cacheWrite };
    };

    const parseItem = (item: any) => {
      const rawId = typeof item === "string" ? item : item?.id ?? item?.model ?? item?.name ?? "";
      const id = typeof rawId === "string" ? rawId.replace(/^models\//, "") : "";
      if (!id) return;
      const name = typeof item?.name === "string" ? item.name : undefined;
      const cw =
        toNum(item?.context_length) ??
        toNum(item?.max_context) ??
        toNum(item?.context_window) ??
        toNum(item?.inputTokenLimit) ??
        toNum(item?.max_tokens) ??
        undefined;
      const mt =
        toNum(item?.max_output_tokens) ??
        toNum(item?.top_provider?.max_completion_tokens) ??
        toNum(item?.max_completion_tokens) ??
        toNum(item?.outputTokenLimit) ??
        toNum(item?.max_tokens) ??
        undefined;
      const isOR = isOpenRouter(baseUrl, host);
      pushModel({
        id,
        name: name !== id ? name : undefined,
        contextWindow: cw,
        maxTokens: mt,
        reasoning: reasoningOf(item),
        vision: visionOf(item),
        audio: audioOf(item),
        cost: isOR ? parseCost(item.pricing) : undefined,
        source: isOR ? "openrouter" : "openai",
      });
    };

    if (Array.isArray(data)) {
      data.forEach(parseItem);
    } else if (data && typeof data === "object") {
      const dataArr = data.data ?? data.models ?? data.models_list ?? null;
      if (Array.isArray(dataArr)) dataArr.forEach(parseItem);
    }

    return { models };
  } catch (e: any) {
    const msg = e?.name === "TimeoutError" ? "timeout" : e?.cause?.code || e?.message || String(e);
    return { models: [], error: msg };
  }
}


/**
 * Send a minimal /chat/completions request with a specific model ID to verify
 * the model is usable. Returns { success, latencyMs, message }.
 */
export async function testModel(
  baseUrl: string,
  modelId: string,
  apiKey?: string,
  apiType: string = "openai-completions"
): Promise<ProviderTestResult> {
  let url: URL;
  try {
    url = new URL(baseUrl.replace(/\/+$/, "") + "/chat/completions");
  } catch {
    return { success: false, message: "invalid URL" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { success: false, message: "invalid URL" };
  }

  let key = apiKey ?? "";
  if (key.startsWith("$")) key = process.env[key.slice(1)] ?? "";

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (key) headers["Authorization"] = `Bearer ${key}`;

  // Build a minimal, lightweight completion payload
  const body: Record<string, any> = {
    model: modelId,
    messages: [{ role: "user", content: "Reply with a single word: ok" }],
    max_tokens: 4,
    temperature: 0,
  };

  const started = Date.now();
  try {
    const res = await fetchExternal(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const latencyMs = Date.now() - started;
    if (res.ok) {
      // Validate response — accept if we got valid JSON back
      const data = await res.json();
      const choice = data?.choices?.[0];
      const hasContent = choice && (choice.message?.content || choice.delta?.content);
      if (hasContent) {
        return { success: true, latencyMs };
      }
      // Got valid JSON but no choice content — check for alternative response formats
      const hasUsage = !!data?.usage;
      if (hasUsage) {
        return { success: true, latencyMs, message: "response received (no content)" };
      }
      return { success: false, latencyMs, message: "invalid response: " + JSON.stringify(data).slice(0, 150) };
    }
    // Capture the status line from the body if possible
    try {
      const d = await res.json();
      return { success: false, status: res.status, latencyMs, message: d?.error?.message || `HTTP ${res.status}` };
    } catch {
      return { success: false, status: res.status, latencyMs, message: `HTTP ${res.status}` };
    }
  } catch (e: any) {
    const latencyMs = Date.now() - started;
    const msg = e?.name === "TimeoutError" ? "timeout" : e?.message || String(e);
    return { success: false, latencyMs, message: msg };
  }
}

// ─── Subagents ────────────────────────────────────────────

const AGENTS_DIR = join(PI_DIR, "agents");
const CHAINS_DIR = join(PI_DIR, "chains");
const RUN_HISTORY_PATH = join(PI_DIR, "run-history.jsonl");

/** Parse YAML frontmatter from an agent/chain .md file. */
function parseFrontmatter(raw: string): { frontmatter: Record<string, any>; body: string } {
  const frontmatter: Record<string, any> = {};
  const first = raw.indexOf("---");
  if (first !== 0) return { frontmatter, body: raw };
  const second = raw.indexOf("---", 3);
  if (second === -1) return { frontmatter, body: raw };
  const yamlLines = raw.slice(3, second).trim().split("\n");
  const body = raw.slice(second + 3).trim();

  for (const line of yamlLines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value: any = line.slice(colonIdx + 1).trim();

    // Array value: "[item1, item2]" or multiline "key:\n  - item"
    if (value.startsWith("[") && value.endsWith("]")) {
      value = value.slice(1, -1).split(",").map((s: string) => s.trim().replace(/^["']|["']$/g, ""));
    } else if (value === "true" || value === "false") {
      value = value === "true";
    } else if (/^\d+$/.test(value)) {
      value = parseInt(value, 10);
    } else if (/^\d+\.\d+$/.test(value)) {
      value = parseFloat(value);
    } else {
      value = value.replace(/^["']|["']$/g, "");
    }

    frontmatter[key] = value;
  }

  return { frontmatter, body };
}

export interface AgentDef {
  name: string;
  fileName: string;
  filePath: string;
  package: string;
  description: string;
  model?: string;
  tools?: string[];
  thinking?: string;
  systemPromptMode?: string;
  inheritProjectContext?: boolean;
  inheritSkills?: boolean;
  input?: string[];
  body: string;
}

export function listAgents(): AgentDef[] {
  try {
    if (!existsSync(AGENTS_DIR)) return [];
    const files = readdirSync(AGENTS_DIR).filter((f) => f.endsWith(".md"));
    return files.map((fileName) => {
      const filePath = join(AGENTS_DIR, fileName);
      try {
        const raw = readFileSync(filePath, "utf-8");
        const { frontmatter, body } = parseFrontmatter(raw);
        function splitMaybe(val: unknown): string[] | undefined {
          if (Array.isArray(val)) return val.map(String);
          if (typeof val === "string" && val.trim()) return val.split(/\s*,\s*/).filter(Boolean);
          return undefined;
        }
        return {
          name: frontmatter.name || fileName.replace(/\.md$/, ""),
          fileName,
          filePath,
          package: frontmatter.package || "custom",
          description: frontmatter.description || "",
          model: frontmatter.model,
          tools: splitMaybe(frontmatter.tools),
          thinking: frontmatter.thinking,
          systemPromptMode: frontmatter.systemPromptMode,
          inheritProjectContext: frontmatter.inheritProjectContext,
          inheritSkills: frontmatter.inheritSkills,
          input: splitMaybe(frontmatter.input),
          body: body.slice(0, 500),
        };
      } catch {
        return null;
      }
    }).filter(Boolean) as AgentDef[];
  } catch {
    return [];
  }
}

export interface ChainStep {
  agent: string;
  phase?: string;
  label?: string;
  output?: string;
  as?: string;
  task?: string;
}

export interface ChainDef {
  name: string;
  fileName: string;
  filePath: string;
  description: string;
  steps: ChainStep[];
  body: string;
}

export function listChains(): ChainDef[] {
  try {
    if (!existsSync(CHAINS_DIR)) return [];
    const files = readdirSync(CHAINS_DIR).filter((f) => f.endsWith(".chain.md"));
    return files.map((fileName) => {
      const filePath = join(CHAINS_DIR, fileName);
      try {
        const raw = readFileSync(filePath, "utf-8");
        const { frontmatter, body } = parseFrontmatter(raw);
        const steps: ChainStep[] = [];

        // Parse chain steps: "## agent-name" blocks
        const stepRegex = /##\s+(\([^)]+\)\s*\|[^\n]+|[^\n]+)/g;
        let match;
        while ((match = stepRegex.exec(body)) !== null) {
          const header = match[1]!.trim();
          // "## (web-agents.前端 | web-agents.后端)" parallel steps
          // "## web-agents.需求" single step
          // "## web-agents.测试" single step
          // Extract agent name(s) from header
          const parallelMatch = header.match(/^\(([^)]+)\)/);
          if (parallelMatch) {
            const agents = parallelMatch[1]!.split("|").map((s) => s.trim());
            agents.forEach((agent) => steps.push({ agent }));
          } else {
            steps.push({ agent: header });
          }
        }

        return {
          name: frontmatter.name || fileName.replace(/\.chain\.md$/, ""),
          fileName,
          filePath,
          description: frontmatter.description || "",
          steps,
          body: raw.slice(0, 300),
        };
      } catch {
        return null;
      }
    }).filter(Boolean) as ChainDef[];
  } catch {
    return [];
  }
}

export interface RunRecord {
  agent: string;
  ts: number;
  status: string;
  duration?: number;
  exit?: number;
  taskHash?: string;
}

export function readRunHistory(limit = 100): RunRecord[] {
  try {
    if (!existsSync(RUN_HISTORY_PATH)) return [];
    const raw = readFileSync(RUN_HISTORY_PATH, "utf-8");
    const lines = raw.split("\n").filter(Boolean);
    return lines
      .slice(-limit)
      .map((line) => {
        try {
          return JSON.parse(line) as RunRecord;
        } catch {
          return null;
        }
      })
      .filter((r): r is RunRecord => r !== null)
      .reverse();
  } catch {
    return [];
  }
}

export interface SubagentsData {
  agents: AgentDef[];
  chains: ChainDef[];
  runHistory: RunRecord[];
}

export function readSubagents(): SubagentsData {
  return {
    agents: listAgents(),
    chains: listChains(),
    runHistory: readRunHistory(),
  };
}

// ─── Built-in Provider Catalog (from the local pi install) ───
// pi ships its full model catalog (same source as pi.dev/models) inside
// @earendil-works/pi-ai as dist/providers/data/*.json. Reading it locally
// keeps the builtin provider list in sync with the installed pi version
// instead of maintaining a hand-written copy.

interface CatalogModel {
  id: string;
  name?: string;
  reasoning?: boolean;
  input?: string[];
  contextWindow?: number;
  maxTokens?: number;
  cost?: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

interface CatalogProvider {
  id: string;
  name: string;
  type: "builtin";
  api?: string;
  baseUrl?: string;
  hasAuth: boolean;
  authMethod: "env";
  models: CatalogModel[];
}

/** Locate @earendil-works/pi-ai's dist/providers directory of the active pi install. */
function findPiAiProvidersDir(): string | null {
  const home = homedir();
  const roots: string[] = [];

  // Resolve the pi binary symlink → .../pi-coding-agent/dist/cli.js
  const which = spawnSync("which", ["pi"], { encoding: "utf8", timeout: 5000 });
  const bin = which.status === 0 ? which.stdout.trim() : "";
  if (bin) {
    const real = spawnSync("readlink", ["-f", bin], { encoding: "utf8", timeout: 5000 });
    const cli = real.status === 0 ? real.stdout.trim() : "";
    if (cli) roots.push(resolve(dirname(cli), "..")); // package root
  }

  // Known install locations as fallback
  const piNode = join(home, ".local", "share", "pi-node");
  try {
    for (const v of readdirSync(piNode)) {
      roots.push(join(piNode, v, "lib", "node_modules", PI_CORE_PACKAGE));
    }
  } catch {
    // pi-node dir absent
  }

  for (const root of roots) {
    const dir = join(root, "node_modules", "@earendil-works", "pi-ai", "dist", "providers");
    if (existsSync(join(dir, "data"))) return dir;
  }
  return null;
}

let catalogCache: { providers: CatalogProvider[]; at: number } | null = null;

export function readBuiltinCatalog(): CatalogProvider[] | null {
  if (catalogCache && Date.now() - catalogCache.at < 300000) return catalogCache.providers;
  const dir = findPiAiProvidersDir();
  if (!dir) return null;

  const providers: CatalogProvider[] = [];
  let files: string[];
  try {
    files = readdirSync(join(dir, "data")).filter(
      (f) => f.endsWith(".json") && !f.startsWith(".")
    );
  } catch {
    return null;
  }

  for (const file of files) {
    const id = file.replace(/\.json$/, "");
    const data = readJsonFile<Record<string, Record<string, any>>>(join(dir, "data", file));
    if (!data) continue;

    const models: CatalogModel[] = [];
    let baseUrl: string | undefined;
    let api: string | undefined;
    for (const apiKey of Object.keys(data)) {
      for (const m of Object.values(data[apiKey] ?? {})) {
        if (!m?.id) continue;
        baseUrl = baseUrl ?? m.baseUrl;
        api = api ?? m.api;
        models.push({
          id: m.id,
          name: m.name,
          reasoning: !!m.reasoning,
          input: Array.isArray(m.input) ? m.input : ["text"],
          contextWindow: m.contextWindow,
          maxTokens: m.maxTokens,
          cost: m.cost,
        });
      }
    }
    if (models.length === 0) continue;

    // Display name lives in dist/providers/<id>.js: createProvider({ id: "…", name: "…" }).
    // Anchor on the id to avoid matching auth-method names like "Anthropic API key".
    let name = "";
    try {
      const src = readFileSync(join(dir, `${id}.js`), "utf-8");
      const esc = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      name =
        src.match(new RegExp(`id:\\s*"${esc}",\\s*name:\\s*"([^"]+)"`))?.[1] ??
        src.match(/createProvider\(\{[^}]*?name:\s*"([^"]+)"/)?.[1] ??
        "";
    } catch {
      // provider module absent — derive from id
    }
    if (!name) {
      name = id
        .split("-")
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
        .join(" ");
    }

    providers.push({
      id,
      name,
      type: "builtin",
      api,
      baseUrl,
      hasAuth: false,
      authMethod: "env",
      models: models.sort((a, b) => a.id.localeCompare(b.id)),
    });
  }

  if (providers.length === 0) return null;
  providers.sort((a, b) => a.id.localeCompare(b.id));
  catalogCache = { providers, at: Date.now() };
  return providers;
}
