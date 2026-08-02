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
  if (/[-_](1m|1024k|1048576)\b/i.test(k)) contextWindow = 1_048_576;
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
