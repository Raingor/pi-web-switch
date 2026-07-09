import { readFileSync, readdirSync, existsSync, statSync, unlinkSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join, resolve } from "path";

const PI_DIR = join(homedir(), ".pi", "agent");

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
    const backup = existsSync(path) ? readFileSync(path, "utf-8") : null;
    const raw = JSON.stringify(settings, null, 2);
    writeFileSync(path, raw, "utf-8");
    return true;
  } catch {
    return false;
  }
}

import { writeFileSync } from "fs";

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
          const d = new Date(timestamp);
          const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
          const hour = d.getHours();

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

export function readAllUsage(): UsageRecord[] {
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
  return allRecords;
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
  const projectName = segments.length > 0 ? segments[segments.length - 1] : dirName;
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
      group.lastActive = group.sessions[0].timestamp; // already sorted newest-first
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
