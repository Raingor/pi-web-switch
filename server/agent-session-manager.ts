// Agent Session Manager — Vite middleware compatible port of pi-web's rpc-manager.
// Manages pi AgentSession lifecycle, command dispatch, and SSE event streaming.

import { createAgentSessionFromServices, createAgentSessionServices, getAgentDir, initTheme, SessionManager } from "@earendil-works/pi-coding-agent";
import { randomUUID } from "crypto";
import { existsSync, realpathSync, writeFileSync } from "fs";
import { resolve } from "path";

// ─── Types ──────────────────────────────────────────────

export interface AgentEvent {
  type: string;
  [key: string]: unknown;
}

type EventListener = (event: AgentEvent) => void;

export interface RpcSessionStartOptions {
  toolNames?: string[];
  initialModel?: { provider: string; modelId: string };
  thinkingLevel?: string;
}

const CODING_TOOL_NAMES = ["read", "bash", "edit", "write", "grep", "find", "ls"];

function withExtensionTools(session: any, toolNames: string[]): string[] {
  if (toolNames.length === 0) return [];
  const codingToolNames = new Set(CODING_TOOL_NAMES);
  const extensionToolNames = session
    .getAllTools()
    .map((t: any) => t.name)
    .filter((name: string) => !codingToolNames.has(name));
  return [...new Set([...toolNames, ...extensionToolNames])];
}

// ─── Session Path Cache ─────────────────────────────────

declare global {
  // eslint-disable-next-line no-var
  var __piSessions: Map<string, AgentSessionWrapper> | undefined;
  // eslint-disable-next-line no-var
  var __piStartLocks: Map<string, Promise<{ session: AgentSessionWrapper; realSessionId: string }>> | undefined;
  // eslint-disable-next-line no-var
  var __piSessionPathCache: Map<string, string> | undefined;
  // eslint-disable-next-line no-var
  var __piSessionListCache: { data: any[]; ts: number } | undefined;
}

function getRegistry(): Map<string, AgentSessionWrapper> {
  if (!globalThis.__piSessions) {
    globalThis.__piSessions = new Map();
    const cleanup = () => globalThis.__piSessions?.forEach((s) => s.destroy());
    process.once("exit", cleanup);
    process.once("SIGINT", cleanup);
    process.once("SIGTERM", cleanup);
  }
  return globalThis.__piSessions;
}

function getLocks(): Map<string, Promise<{ session: AgentSessionWrapper; realSessionId: string }>> {
  if (!globalThis.__piStartLocks) globalThis.__piStartLocks = new Map();
  return globalThis.__piStartLocks;
}

function getPathCache(): Map<string, string> {
  if (!globalThis.__piSessionPathCache) globalThis.__piSessionPathCache = new Map();
  return globalThis.__piSessionPathCache;
}

export function cacheSessionPath(sessionId: string, filePath: string): void {
  getPathCache().set(sessionId, filePath);
}

export function invalidateSessionListCache(): void {
  globalThis.__piSessionListCache = undefined;
}

function normalizeRpcCwd(cwd: string): string {
  const resolvedCwd = resolve(cwd);
  try {
    return realpathSync(resolvedCwd);
  } catch {
    return resolvedCwd;
  }
}

// ─── AgentSessionWrapper ────────────────────────────────
// Wraps AgentSession with event subscription and command dispatch.

export class AgentSessionWrapper {
  private listeners: EventListener[] = [];
  private promptRunning = false;
  private unsubscribe: (() => void) | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private _alive = true;

  constructor(public readonly inner: any) {}

  get sessionId(): string {
    return this.inner.sessionId;
  }

  get sessionFile(): string {
    return this.inner.sessionFile ?? "";
  }

  get cwd(): string {
    return this.inner.sessionManager?.getCwd?.() ?? "";
  }

  isAlive(): boolean {
    return this._alive;
  }

  isRunning(): boolean {
    return this._alive && (this.promptRunning || this.inner.isStreaming || this.inner.isCompacting || this.inner.isBashRunning);
  }

  start(): void {
    this.unsubscribe = this.inner.subscribe((event: AgentEvent) => {
      if (event.type === "agent_end") {
        invalidateSessionListCache();
      }
      this.emit(event);
    });
    this.resetIdleTimer();
  }

  onEvent(listener: EventListener): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i !== -1) this.listeners.splice(i, 1);
    };
  }

  private emit(event: AgentEvent): void {
    for (const l of this.listeners) l(event);
  }

  private resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (this.isRunning()) {
        this.resetIdleTimer();
        return;
      }
      void this.shutdown().catch(() => {});
    }, 10 * 60 * 1000);
  }

  async send(command: Record<string, unknown>): Promise<unknown> {
    this.resetIdleTimer();
    const type = command.type as string;

    switch (type) {
      case "prompt": {
        if (this.inner.isBashRunning) {
          throw new Error("Cannot send a prompt while a shell command is running");
        }
        const promptImages = command.images as any[] | undefined;
        this.promptRunning = true;
        this.inner.prompt(command.message as string, {
          ...(promptImages?.length ? { images: promptImages } : {}),
          source: "rpc",
        }).then(() => {
          this.promptRunning = false;
          this.resetIdleTimer();
          this.emit({ type: "prompt_done" });
        }).catch((error: any) => {
          this.promptRunning = false;
          this.resetIdleTimer();
          invalidateSessionListCache();
          this.emit({
            type: "prompt_error",
            errorMessage: error instanceof Error ? error.message : String(error),
          });
          this.emit({ type: "prompt_done" });
        });
        return null;
      }

      case "abort":
        await this.inner.abort();
        return null;

      case "get_state": {
        const model = this.inner.model;
        const contextUsage = this.inner.getContextUsage();
        return {
          sessionId: this.inner.sessionId,
          sessionFile: this.inner.sessionFile ?? "",
          isStreaming: this.inner.isStreaming,
          isPromptRunning: this.promptRunning,
          isBashRunning: this.inner.isBashRunning,
          isCompacting: this.inner.isCompacting,
          model: model ? { id: model.id, provider: model.provider } : undefined,
          contextUsage: contextUsage
            ? { percent: contextUsage.percent, contextWindow: contextUsage.contextWindow, tokens: contextUsage.tokens }
            : null,
          systemPrompt: this.inner.agent?.state?.systemPrompt ?? "",
          thinkingLevel: this.inner.agent?.state?.thinkingLevel ?? "off",
        };
      }

      case "set_model": {
        const { provider, modelId } = command as { provider: string; modelId: string };
        let model = this.inner.modelRuntime.getModel(provider, modelId);
        if (!model) {
          await this.inner.modelRuntime.refresh({ allowNetwork: false });
          model = this.inner.modelRuntime.getModel(provider, modelId);
        }
        if (!model) throw new Error(`Model not found: ${provider}/${modelId}`);
        await this.inner.setModel(model);
        invalidateSessionListCache();
        return { id: model.id, provider: model.provider };
      }

      case "fork": {
        const entryId = command.entryId as string;
        const sessionManager = this.inner.sessionManager;
        const currentSessionFile = this.inner.sessionFile;
        if (!sessionManager.isPersisted()) return { cancelled: true };
        if (!currentSessionFile) throw new Error("Persisted session is missing a session file");
        const entry = sessionManager.getEntry(entryId);
        if (!entry) throw new Error("Invalid entry ID for forking");
        const sessionDir = sessionManager.getSessionDir();
        let newSessionFile: string;
        if (!entry.parentId) {
          const newManager = SessionManager.create(sessionManager.getCwd(), sessionDir);
          newManager.newSession({ parentSession: currentSessionFile });
          newSessionFile = newManager.getSessionFile() as string;
        } else {
          const sourceManager = SessionManager.open(currentSessionFile, sessionDir);
          const forkedPath = sourceManager.createBranchedSession(entry.parentId);
          if (!forkedPath) throw new Error("Failed to create forked session");
          newSessionFile = forkedPath;
        }
        const newSessionId = SessionManager.open(newSessionFile, sessionDir).getSessionId();
        cacheSessionPath(newSessionId, newSessionFile);
        invalidateSessionListCache();
        await this.shutdown();
        return { cancelled: false, newSessionId };
      }

      case "navigate_tree": {
        const result = await this.inner.navigateTree(command.targetId as string, {});
        return { cancelled: result.cancelled };
      }

      case "set_thinking_level": {
        this.inner.setThinkingLevel(command.level as string);
        invalidateSessionListCache();
        return null;
      }

      case "compact": {
        try {
          return await this.inner.compact(command.customInstructions as string | undefined);
        } finally {
          invalidateSessionListCache();
        }
      }

      case "set_session_name": {
        const name = (command.name as string | undefined)?.trim();
        if (!name) throw new Error("Session name cannot be empty");
        this.inner.setSessionName(name);
        invalidateSessionListCache();
        return null;
      }

      case "get_session_stats": {
        return {
          ...this.inner.getSessionStats(),
          sessionName: this.inner.sessionManager?.getSessionName?.() ?? "",
        };
      }

      case "get_last_assistant_text": {
        return { text: this.inner.getLastAssistantText() ?? "" };
      }

      case "steer": {
        const steerImages = command.images as any[] | undefined;
        await this.inner.steer(command.message as string, steerImages?.length ? steerImages : undefined);
        return null;
      }

      case "follow_up": {
        const followImages = command.images as any[] | undefined;
        await this.inner.followUp(command.message as string, followImages?.length ? followImages : undefined);
        return null;
      }

      case "get_tools": {
        const all: any[] = this.inner.getAllTools();
        const active = new Set<string>(this.inner.getActiveToolNames());
        return all.map((t) => ({
          name: t.name,
          description: t.description,
          active: active.has(t.name),
        }));
      }

      case "get_commands": {
        const commands: any[] = [];
        for (const registered of this.inner.extensionRunner?.getRegisteredCommands?.() ?? []) {
          commands.push({
            name: registered.invocationName,
            description: registered.description,
            source: "extension",
          });
        }
        for (const template of this.inner.promptTemplates ?? []) {
          commands.push({
            name: template.name,
            description: template.description,
            source: "prompt",
          });
        }
        return { commands };
      }

      case "set_tools": {
        const toolNames = command.toolNames as string[];
        this.inner.setActiveToolsByName(withExtensionTools(this.inner, toolNames));
        return null;
      }

      case "reload": {
        await this.inner.reload();
        return { success: true };
      }

      case "abort_compaction": {
        this.inner.abortCompaction();
        return null;
      }

      case "bash": {
        const execution = this.inner.executeBash(
          command.command as string,
          undefined,
          { excludeFromContext: command.excludeFromContext as boolean | undefined },
        );
        try {
          const result = await execution;
          return result;
        } finally {
          this.resetIdleTimer();
          invalidateSessionListCache();
        }
      }

      case "abort_bash": {
        this.inner.abortBash();
        return null;
      }

      case "clear_queue": {
        return this.inner.clearQueue();
      }

      default:
        throw new Error(`Unsupported command: ${type}`);
    }
  }

  destroy(): void {
    if (!this._alive) return;
    this._alive = false;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.inner.isBashRunning) this.inner.abortBash();
    this.unsubscribe?.();
    try {
      this.inner.dispose();
    } catch {
      // ignore
    }
  }

  async shutdown(): Promise<void> {
    if (!this._alive) return;
    this.destroy();
  }
}

// ─── Session Management ─────────────────────────────────

export function getRpcSession(sessionId: string): AgentSessionWrapper | undefined {
  return getRegistry().get(sessionId);
}

export function getRunningRpcSessionIds(): string[] {
  const ids = new Set<string>();
  for (const [sessionId, session] of getRegistry()) {
    if (session.isRunning()) ids.add(session.sessionId || sessionId);
  }
  return [...ids];
}

export async function startRpcSession(
  sessionId: string,
  sessionFile: string,
  cwd: string | undefined,
  options: RpcSessionStartOptions = {},
): Promise<{ session: AgentSessionWrapper; realSessionId: string }> {
  const { toolNames, initialModel, thinkingLevel } = options;
  const registry = getRegistry();
  const locks = getLocks();

  const existing = registry.get(sessionId);
  if (existing?.isAlive()) return { session: existing, realSessionId: sessionId };

  const inflight = locks.get(sessionId);
  if (inflight) return inflight;

  let sessionManager: any;
  if (sessionFile) {
    sessionManager = SessionManager.open(sessionFile, undefined);
  } else {
    if (!cwd) throw new Error("cwd is required for a new session");
    sessionManager = SessionManager.create(cwd, undefined);
  }
  const sessionCwd = sessionManager.getCwd();

  const starting = (async () => {
    initTheme();
    const agentDir = getAgentDir();

    let toolsOption: string[] | undefined;
    if (toolNames !== undefined) {
      toolsOption = toolNames.length === 0 ? [] : undefined;
    }

    const services = await createAgentSessionServices({
      cwd: sessionCwd,
      agentDir,
    });

    const { session: inner } = await createAgentSessionFromServices({
      services,
      sessionManager,
      ...(initialModel ? { model: initialModel as any } : {}),
      ...(thinkingLevel ? { thinkingLevel: thinkingLevel as any } : {}),
      ...(toolsOption !== undefined ? { tools: toolsOption } : {}),
    });

    if (toolNames && toolNames.length > 0) {
      inner.setActiveToolsByName(withExtensionTools(inner, toolNames));
    }

    const wrapper = new AgentSessionWrapper(inner);
    wrapper.start();

    const realSessionId = inner.sessionId as string;
    const realSessionFile = inner.sessionFile as string | undefined;
    if (realSessionFile) cacheSessionPath(realSessionId, realSessionFile);

    registry.set(realSessionId, wrapper);
    return { session: wrapper, realSessionId };
  })().finally(() => {
    locks.delete(sessionId);
  });

  locks.set(sessionId, starting);
  return starting;
}

// ─── Session Listing ────────────────────────────────────

export async function listAllSessions(): Promise<any[]> {
  if (globalThis.__piSessionListCache && Date.now() - globalThis.__piSessionListCache.ts < 30_000) {
    return globalThis.__piSessionListCache.data;
  }

  const piSessions: any[] = await SessionManager.listAll();
  const result = piSessions.map((s) => {
    cacheSessionPath(s.id, s.path);
    return {
      path: s.path,
      id: s.id,
      cwd: s.cwd,
      name: s.name,
      created: s.created instanceof Date ? s.created.toISOString() : String(s.created),
      modified: s.modified instanceof Date ? s.modified.toISOString() : String(s.modified),
      messageCount: s.messageCount,
      firstMessage: s.firstMessage || "(no messages)",
    };
  });

  globalThis.__piSessionListCache = { data: result, ts: Date.now() };
  return result;
}

export async function resolveSessionPath(sessionId: string): Promise<string | null> {
  const cached = getPathCache().get(sessionId);
  if (cached) return cached;
  await listAllSessions();
  return getPathCache().get(sessionId) ?? null;
}

// ─── Session Context Builder ────────────────────────────

/**
 * Safely build the session path from leaf to root, detecting circular
 * parent references that would cause the SDK's buildSessionPath to overflow
 * the stack. Falls back to returning all entries as a flat list.
 */
function safeBuildSessionPath(entries: any[], leafId: string | null, byId: Map<string, any>): any[] {
  if (!leafId) {
    // No leaf — return last 100 entries as a safe fallback
    return entries.slice(-100);
  }
  const leaf = byId.get(leafId) ?? entries[entries.length - 1];
  if (!leaf) return entries.slice(-100);

  const path: any[] = [];
  const visited = new Set<string>();
  let current: any = leaf;
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    path.push(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  path.reverse();
  return path;
}

/**
 * Extract messages from a path of entries (mirrors SDK's sessionEntryToContextMessages
 * for the types we care about). Pure fallback — no SDK dependency.
 */
function safeExtractMessages(path: any[]): { messages: any[]; entryIds: string[] } {
  const messages: any[] = [];
  const entryIds: string[] = [];
  for (const entry of path) {
    if (entry.type === "message") {
      const msg = entry.message;
      // Guard against null content from corrupted files
      if ((msg.role === "user" || msg.role === "assistant" || msg.role === "toolResult") && msg.content == null) {
        messages.push({ ...msg, content: [] });
      } else {
        messages.push(msg);
      }
      entryIds.push(entry.id);
    }
  }
  return { messages, entryIds };
}

/**
 * Flatten the session tree into a list of { id, parentId, type, label } nodes.
 * The SDK's tree can be extremely deep (2000+ levels in a single chain),
 * which crashes JSON.stringify's recursive traversal. Converting to a flat
 * list with parentId references is both JSON-safe and preserves the structure
 * for the frontend to reconstruct if needed.
 */
function flattenTree(tree: any): any[] {
  if (!tree) return [];
  const nodes: any[] = [];
  const stack: { node: any; parentId: string | null }[] = [];
  // Initialize with roots
  const roots = Array.isArray(tree) ? tree : [tree];
  for (const root of roots) {
    stack.push({ node: root, parentId: null });
  }
  const seen = new Set<string>();
  while (stack.length > 0) {
    const { node, parentId } = stack.pop();
    if (!node) continue;
    const id = node.entry?.id ?? node.id;
    if (id) {
      if (seen.has(id)) continue; // skip cycles
      seen.add(id);
      nodes.push({
        id,
        parentId,
        type: node.entry?.type ?? node.type,
        label: node.label ?? null,
      });
    }
    if (node.children) {
      for (const child of node.children) {
        stack.push({ node: child, parentId: id ?? null });
      }
    }
  }
  return nodes;
}

export async function getSessionData(sessionId: string) {
  const filePath = await resolveSessionPath(sessionId);
  if (!filePath) return null;

  try {
    const sm = SessionManager.open(filePath);
    const entries = sm.getEntries();
    const leafId = sm.getLeafId();
    const tree = flattenTree(sm.getTree());
    const header = sm.getHeader();

    const byId = new Map<string, any>();
    for (const e of entries) byId.set(e.id, e);

    // Try the SDK's build functions first; if they fail (e.g. circular parent
    // references → "Maximum call stack size exceeded"), fall back to a safe
    // manual implementation with cycle detection.
    let messages: any[] = [];
    let entryIds: string[] = [];
    let thinkingLevel = "off";
    let model: any = null;

    try {
      const { buildSessionContext: piBuildSessionContext, buildContextEntries: piBuildContextEntries } = await import("@earendil-works/pi-coding-agent");
      const piCtx = piBuildSessionContext(entries, leafId, byId);
      const contextEntries = piBuildContextEntries(entries, leafId, byId);
      for (const entry of contextEntries) {
        if (entry.type === "message") {
          messages.push(entry.message);
          entryIds.push(entry.id);
        }
      }
      thinkingLevel = piCtx.thinkingLevel;
      model = piCtx.model;
    } catch {
      // SDK failed (stack overflow from circular refs, etc.) — use safe fallback
      const path = safeBuildSessionPath(entries, leafId, byId);
      const extracted = safeExtractMessages(path);
      messages = extracted.messages;
      entryIds = extracted.entryIds;

      // Derive thinkingLevel/model from the path
      for (const entry of path) {
        if (entry.type === "thinking_level_change") thinkingLevel = entry.thinkingLevel;
        else if (entry.type === "model_change") model = { provider: entry.provider, modelId: entry.modelId };
        else if (entry.type === "message" && entry.message?.role === "assistant") {
          model = { provider: entry.message.provider, modelId: entry.message.model };
        }
      }
    }

    return {
      sessionId,
      filePath,
      leafId,
      tree,
      info: header ? {
        path: filePath,
        id: header.id,
        cwd: header.cwd ?? "",
        name: sm.getSessionName(),
        created: header.timestamp,
        messageCount: messages.length,
        firstMessage: messages.find((m: any) => m.role === "user")
          ? (typeof messages.find((m: any) => m.role === "user")?.content === "string"
            ? messages.find((m: any) => m.role === "user").content
            : "(no messages)")
          : "(no messages)",
      } : null,
      context: {
        messages,
        entryIds,
        thinkingLevel,
        model,
      },
    };
  } catch (e: any) {
    // SessionManager.open / getEntries / getTree failed (e.g. corrupted file,
    // circular refs in tree building). Return a minimal stub so the UI can
    // still display the session name without crashing.
    console.error(`[getSessionData] Failed to load session ${sessionId}:`, e?.message ?? e);
    return {
      sessionId,
      filePath,
      leafId: null,
      tree: null,
      info: {
        path: filePath,
        id: sessionId,
        cwd: "",
        name: filePath.split("/").pop()?.replace(/\.jsonl$/, "") || sessionId,
        created: "",
        messageCount: 0,
        firstMessage: "(session unavailable: " + (e?.message ?? "unknown error") + ")",
      },
      context: {
        messages: [],
        entryIds: [],
        thinkingLevel: "off",
        model: null,
      },
    };
  }
}

/** Compact form: getSessionData but only for the sidebar (no context messages). */
export async function getSessionSummary(sessionId: string): Promise<{ id: string; filePath: string; header: any } | null> {
  const filePath = await resolveSessionPath(sessionId);
  if (!filePath) return null;

  const sm = SessionManager.open(filePath);
  const header = sm.getHeader();
  const entries = sm.getEntries();

  // Count messages without building full context
  let messageCount = 0;
  let firstUserMessage = "";
  for (const e of entries) {
    if (e.type === "message") {
      messageCount++;
      if (!firstUserMessage && e.message?.role === "user") {
        firstUserMessage = typeof e.message.content === "string"
          ? e.message.content.slice(0, 100)
          : "(no messages)";
      }
    }
  }

  return {
    id: sessionId,
    filePath,
    header: header ? {
      path: filePath,
      id: header.id,
      cwd: header.cwd ?? "",
      name: sm.getSessionName(),
      created: header.timestamp,
      messageCount,
      firstMessage: firstUserMessage || "(no messages)",
    } : null,
  };
}

// ─── Models Loader ──────────────────────────────────────

export async function loadModels(cwd: string): Promise<any> {
  const { getSupportedThinkingLevels } = await import("@earendil-works/pi-ai");
  const agentDir = getAgentDir();

  console.log("[loadModels] Creating services for cwd:", cwd, "agentDir:", agentDir);

  const services = await createAgentSessionServices({
    cwd,
    agentDir,
  });

  console.log("[loadModels] Services created. Available keys:", Object.keys(services));

  const settings = services.settingsManager;
  const enabledModels = settings?.getEnabledModels?.() ?? [];
  console.log("[loadModels] enabledModels:", enabledModels);

  const modelRuntime = services.modelRuntime;
  console.log("[loadModels] modelRuntime exists:", !!modelRuntime);
  console.log("[loadModels] modelRuntime methods:", modelRuntime ? Object.keys(modelRuntime) : "N/A");

  // Get all models - ModelRuntime uses getModels() not getAllModels()
  // getModels() returns models from the underlying Models collection
  let allModels = modelRuntime?.getModels?.() ?? [];
  console.log("[loadModels] allModels count before refresh:", allModels?.length);

  if (allModels.length === 0 && modelRuntime?.refresh) {
    console.log("[loadModels] No models found, attempting to refresh...");
    try {
      await modelRuntime.refresh({ allowNetwork: false });
      allModels = modelRuntime?.getModels?.() ?? [];
      console.log("[loadModels] allModels count after refresh:", allModels?.length);
    } catch (refreshError) {
      console.error("[loadModels] Refresh failed:", refreshError);
    }
  }

  // Also try to get available models if still empty
  if (allModels.length === 0) {
    console.log("[loadModels] Trying getAvailableSnapshot...");
    try {
      const available = modelRuntime?.getAvailableSnapshot?.() ?? [];
      console.log("[loadModels] Available models count:", available?.length);
      if (available.length > 0) {
        allModels = available;
      }
    } catch (e) {
      console.error("[loadModels] getAvailableSnapshot failed:", e);
    }
  }

  console.log("[loadModels] allModels:", allModels?.map((m: any) => ({ id: m.id, name: m.name, provider: m.provider })));
  
  const visible = enabledModels && enabledModels.length > 0
    ? allModels.filter((m: any) => {
        return enabledModels.some((pattern: string) => {
          if (pattern.includes("/")) {
            const [p, mId] = pattern.split("/");
            return p === m.provider && (mId === "*" || mId === m.id);
          }
          return pattern === m.id || pattern === "*";
        });
      })
    : allModels;

  const models: Record<string, string> = {};
  const modelList: { id: string; name: string; provider: string }[] = [];
  const thinkingLevels: Record<string, string[]> = {};

  for (const m of visible) {
    const key = `${m.provider}:${m.id}`;
    models[key] = m.name;
    modelList.push({ id: m.id, name: m.name, provider: m.provider });
    thinkingLevels[key] = getSupportedThinkingLevels(m);
  }

  const defaultProvider = settings.getDefaultProvider();
  const defaultModelId = settings.getDefaultModel();
  const defaultModel = defaultProvider && defaultModelId
    ? { provider: defaultProvider, modelId: defaultModelId }
    : null;

  return {
    models,
    modelList: modelList.sort((a, b) => a.name.localeCompare(b.name)),
    defaultModel,
    thinkingLevels,
    modelError: services.modelRuntime.getError(),
  };
}
