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
          const date = new Date(timestamp).toISOString().split("T")[0] || "unknown";

          records.push({
            date,
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
