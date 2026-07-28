import { readFileSync, readdirSync, existsSync, statSync, unlinkSync, writeFileSync, mkdirSync, renameSync } from "fs";
import { homedir } from "os";
import { join, resolve, dirname, relative, sep } from "path";
import { spawnSync } from "child_process";

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

async function fetchLatestVersion(pkgName: string): Promise<string | null> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(pkgName)}/latest`, {
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
    const res = await fetch(url, {
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
