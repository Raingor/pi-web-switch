// Chat API Plugin for Vite — exposes agent session management endpoints.
// This is the server-side bridge between the React chat UI and the pi SDK.

import type { Plugin } from "vite";
import type { Connect } from "vite";
import { existsSync } from "fs";
import { resolve } from "path";
import { homedir } from "os";
import {
  startRpcSession,
  getRpcSession,
  getRunningRpcSessionIds,
  listAllSessions,
  getSessionData,
  resolveSessionPath,
  cacheSessionPath,
  invalidateSessionListCache,
  loadModels,
  type AgentEvent,
} from "./agent-session-manager";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { unlinkSync, readdirSync, readFileSync, writeFileSync, statSync } from "fs";
import { dirname, join } from "path";

// ─── Helpers ─────────────────────────────────────────────

function parseBody(req: Connect.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: string) => (body += chunk));
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function sendJSON(res: any, data: any, status = 200) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}

const OMITTED_EVENT_TYPES = new Set(["turn_start", "turn_end", "tool_execution_update"]);

function toClientEvent(event: AgentEvent): AgentEvent | null {
  if (OMITTED_EVENT_TYPES.has(event.type)) return null;
  if (event.type === "message_update") {
    const clientEvent = { ...event };
    delete (clientEvent as any).assistantMessageEvent;
    return clientEvent;
  }
  if (event.type === "agent_end") return { type: "agent_end" };
  return event;
}

// ─── Chat API Plugin ────────────────────────────────────

export function chatApiPlugin(): Plugin {
  return {
    name: "chat-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const method = req.method!;
        const url = req.url!;
        if (!url.startsWith("/api/chat/")) return next();

        const pathOnly = url.split("?")[0];
        const searchParams = new URL(url, "http://localhost").searchParams;

        try {
          // ─── POST /api/chat/agent/new ───────────────────
          // Create a new agent session
          if (method === "POST" && pathOnly === "/api/chat/agent/new") {
            const body = await parseBody(req);
            const { cwd, ...command } = body;
            if (!cwd || typeof cwd !== "string") {
              return sendJSON(res, { error: "cwd is required" }, 400);
            }
            if (!existsSync(cwd)) {
              return sendJSON(res, { error: `Directory does not exist: ${cwd}` }, 400);
            }

            const { provider, modelId, toolNames, thinkingLevel, ...promptCommand } = command;
            const tempKey = `__new__${Date.now()}-${Math.random().toString(36).slice(2)}`;
            const { session, realSessionId } = await startRpcSession(tempKey, "", cwd, {
              ...(toolNames ? { toolNames } : {}),
              ...(provider && modelId ? { initialModel: { provider, modelId } } : {}),
              ...(thinkingLevel ? { thinkingLevel } : {}),
            });

            allowFileRoot(cwd);
            invalidateSessionListCache();

            const state = await session.send({ type: "get_state" }) as any;

            if (promptCommand.type === "ensure_session") {
              return sendJSON(res, {
                success: true,
                sessionId: realSessionId,
                data: null,
                model: state.model ? { provider: state.model.provider, modelId: state.model.id } : null,
                thinkingLevel: state.thinkingLevel,
              });
            }

            const result = await session.send(promptCommand);
            return sendJSON(res, {
              success: true,
              sessionId: realSessionId,
              data: result,
              model: state.model ? { provider: state.model.provider, modelId: state.model.id } : null,
              thinkingLevel: state.thinkingLevel,
            });
          }

          // ─── POST /api/chat/agent/:id ───────────────────
          // Send a command to an existing session
          const agentCommandMatch = pathOnly.match(/^\/api\/chat\/agent\/([^/]+)$/);
          if (agentCommandMatch && method === "POST") {
            const id = decodeURIComponent(agentCommandMatch[1]);
            const body = await parseBody(req);

            const existing = getRpcSession(id);
            if (existing?.isAlive()) {
              const result = await existing.send(body);
              return sendJSON(res, { success: true, data: result });
            }

            const filePath = await resolveSessionPath(id);
            if (!filePath) {
              return sendJSON(res, { error: "Session not found" }, 404);
            }

            const { session } = await startRpcSession(id, filePath, undefined);
            const result = await session.send(body);
            return sendJSON(res, { success: true, data: result });
          }

          // ─── GET /api/chat/agent/:id ────────────────────
          // Get current agent state
          if (agentCommandMatch && method === "GET") {
            const id = decodeURIComponent(agentCommandMatch[1]);
            const session = getRpcSession(id);
            if (!session || !session.isAlive()) {
              return sendJSON(res, { running: false });
            }
            const state = await session.send({ type: "get_state" });
            return sendJSON(res, { running: true, state });
          }

          // ─── GET /api/chat/agent/:id/events ─────────────
          // SSE stream of agent events
          const eventsMatch = pathOnly.match(/^\/api\/chat\/agent\/([^/]+)\/events$/);
          if (eventsMatch && method === "GET") {
            const id = decodeURIComponent(eventsMatch[1]);

            let session = getRpcSession(id);
            if (!session || !session.isAlive()) {
              const filePath = await resolveSessionPath(id);
              if (!filePath) {
                res.statusCode = 404;
                return res.end("Session not found");
              }
              try {
                ({ session } = await startRpcSession(id, filePath, undefined));
              } catch (error) {
                res.statusCode = 500;
                return res.end(`Failed to start agent: ${error}`);
              }
            }

            res.setHeader("Content-Type", "text/event-stream");
            res.setHeader("Cache-Control", "no-cache");
            res.setHeader("Connection", "keep-alive");
            res.writeHead(200);

            const encoder = new TextEncoder();
            const encode = (data: unknown) => {
              const text = `data: ${JSON.stringify(data)}\n\n`;
              res.write(text);
            };

            // Send initial connected event
            encode({ type: "connected", sessionId: id });

            const unsubscribe = session.onEvent((event) => {
              const clientEvent = toClientEvent(event);
              if (clientEvent) encode(clientEvent);
            });

            // Heartbeat every 30s
            const heartbeat = setInterval(() => {
              try {
                res.write(":\n\n");
              } catch {
                // controller already closed
              }
            }, 30_000);

            // Cleanup on disconnect
            const cleanup = () => {
              clearInterval(heartbeat);
              unsubscribe();
              try { res.end(); } catch { /* already closed */ }
            };

            req.on("close", cleanup);
            req.on("error", cleanup);
            return;
          }

          // ─── GET /api/chat/sessions ─────────────────────
          // List all sessions
          if (method === "GET" && pathOnly === "/api/chat/sessions") {
            const sessions = await listAllSessions();
            return sendJSON(res, { sessions, runningSessionIds: getRunningRpcSessionIds() });
          }

          // ─── GET /api/chat/sessions/:id ─────────────────
          // Get session data (messages, tree, context)
          const sessionMatch = pathOnly.match(/^\/api\/chat\/sessions\/([^/]+)$/);
          if (sessionMatch && method === "GET") {
            const id = decodeURIComponent(sessionMatch[1]);
            const data = await getSessionData(id);
            if (!data) {
              return sendJSON(res, { error: "Session not found" }, 404);
            }
            return sendJSON(res, data);
          }

          // ─── PATCH /api/chat/sessions/:id ───────────────
          // Rename session
          if (sessionMatch && method === "PATCH") {
            const id = decodeURIComponent(sessionMatch[1]);
            const { name } = await parseBody(req);
            if (typeof name !== "string") {
              return sendJSON(res, { error: "name is required" }, 400);
            }
            const filePath = await resolveSessionPath(id);
            if (!filePath) {
              return sendJSON(res, { error: "Session not found" }, 404);
            }
            const sm = SessionManager.open(filePath);
            sm.appendSessionInfo(name.trim());
            invalidateSessionListCache();
            return sendJSON(res, { ok: true });
          }

          // ─── DELETE /api/chat/sessions/:id ──────────────
          // Delete session
          if (sessionMatch && method === "DELETE") {
            const id = decodeURIComponent(sessionMatch[1]);
            const filePath = await resolveSessionPath(id);
            if (!filePath) {
              return sendJSON(res, { error: "Session not found" }, 404);
            }
            // Re-attach children to parent
            const dir = dirname(filePath);
            try {
              const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl") && join(dir, f) !== filePath);
              for (const file of files) {
                const childPath = join(dir, file);
                try {
                  const content = readFileSync(childPath, "utf8");
                  const lines = content.split("\n");
                  const header = JSON.parse(lines[0]);
                  if (header.type === "session" && header.parentSession === filePath) {
                    header.parentSession = undefined;
                    lines[0] = JSON.stringify(header);
                    writeFileSync(childPath, lines.join("\n"));
                  }
                } catch { /* skip malformed */ }
              }
            } catch { /* skip if dir unreadable */ }

            await getRpcSession(id)?.shutdown();
            unlinkSync(filePath);
            invalidateSessionListCache();
            return sendJSON(res, { ok: true });
          }

          // ─── GET /api/chat/sessions/:id/context ─────────
          // Get session context (branch navigation)
          const contextMatch = pathOnly.match(/^\/api\/chat\/sessions\/([^/]+)\/context$/);
          if (contextMatch && method === "GET") {
            const id = decodeURIComponent(contextMatch[1]);
            const leafId = searchParams.get("leafId");
            const filePath = await resolveSessionPath(id);
            if (!filePath) {
              return sendJSON(res, { error: "Session not found" }, 404);
            }
            const sm = SessionManager.open(filePath);
            const entries = sm.getEntries();
            const { buildContextEntries } = await import("@earendil-works/pi-coding-agent");
            const byId = new Map<string, any>();
            for (const e of entries) byId.set(e.id, e);
            const contextEntries = buildContextEntries(entries, leafId, byId);
            const messages = contextEntries.filter((e: any) => e.type === "message").map((e: any) => e.message);
            const entryIds = contextEntries.filter((e: any) => e.type === "message").map((e: any) => e.id);
            return sendJSON(res, { context: { messages, entryIds } });
          }

          // ─── GET /api/chat/sessions/:id/state ───────────
          // Get live agent state for a session
          const stateMatch = pathOnly.match(/^\/api\/chat\/sessions\/([^/]+)\/state$/);
          if (stateMatch && method === "GET") {
            const id = decodeURIComponent(stateMatch[1]);
            const session = getRpcSession(id);
            if (!session || !session.isAlive()) {
              return sendJSON(res, { running: false });
            }
            const state = await session.send({ type: "get_state" });
            return sendJSON(res, { running: true, state });
          }

          // ─── POST /api/chat/sessions/:id/auto-name ──────
          // Auto-generate session name (simplified — just uses first message)
          const autoNameMatch = pathOnly.match(/^\/api\/chat\/sessions\/([^/]+)\/auto-name$/);
          if (autoNameMatch && method === "POST") {
            const id = decodeURIComponent(autoNameMatch[1]);
            const filePath = await resolveSessionPath(id);
            if (!filePath) {
              return sendJSON(res, { error: "Session not found" }, 404);
            }
            const sm = SessionManager.open(filePath);
            const entries = sm.getEntries();
            const firstUserMsg = entries.find((e: any) => e.type === "message" && e.message?.role === "user");
            let title = "New Session";
            if (firstUserMsg) {
              const content = firstUserMsg.message.content;
              title = typeof content === "string"
                ? content.slice(0, 60)
                : Array.isArray(content)
                  ? (content.find((b: any) => b.type === "text")?.text ?? "New Session").slice(0, 60)
                  : "New Session";
            }
            sm.appendSessionInfo(title);
            invalidateSessionListCache();
            return sendJSON(res, { title });
          }

          // ─── GET /api/chat/models ───────────────────────
          // Get available models for a cwd
          if (method === "GET" && pathOnly === "/api/chat/models") {
            const cwd = searchParams.get("cwd") || process.cwd();
            const resolved = resolve(cwd);
            if (!existsSync(resolved)) {
              return sendJSON(res, { error: `Directory does not exist: ${resolved}` }, 400);
            }
            try {
              const data = await loadModels(resolved);
              return sendJSON(res, data);
            } catch (error) {
              console.error("[chat-api] loadModels error:", error);
              return sendJSON(res, {
                models: {},
                modelList: [],
                defaultModel: null,
                thinkingLevels: {},
                modelError: String(error),
              });
            }
          }

          // ─── GET /api/chat/default-cwd ──────────────────
          // Get the default working directory
          if (method === "GET" && pathOnly === "/api/chat/default-cwd") {
            const home = homedir();
            return sendJSON(res, { cwd: home });
          }

          // ─── GET /api/chat/home ─────────────────────────
          // Get user home directory
          if (method === "GET" && pathOnly === "/api/chat/home") {
            return sendJSON(res, { home: homedir() });
          }

          // ─── POST /api/chat/cwd/validate ────────────────
          // Validate a working directory
          if (method === "POST" && pathOnly === "/api/chat/cwd/validate") {
            const { cwd } = await parseBody(req);
            if (!cwd || typeof cwd !== "string") {
              return sendJSON(res, { error: "cwd is required" }, 400);
            }
            const resolved = resolve(cwd);
            if (!existsSync(resolved)) {
              return sendJSON(res, { error: `Directory does not exist: ${resolved}` }, 400);
            }
            try {
              const stat = statSync(resolved);
              if (!stat.isDirectory()) {
                return sendJSON(res, { error: `Not a directory: ${resolved}` }, 400);
              }
              return sendJSON(res, { cwd: resolved });
            } catch {
              return sendJSON(res, { error: `Cannot access: ${resolved}` }, 400);
            }
          }

          // ─── GET /api/chat/cwd/browse ───────────────────
          // Browse directory listing
          if (method === "GET" && pathOnly === "/api/chat/cwd/browse") {
            const dirPath = searchParams.get("path") || homedir();
            const resolved = resolve(dirPath);
            if (!existsSync(resolved)) {
              return sendJSON(res, { error: "Directory not found" }, 404);
            }
            try {
              const entries = readdirSync(resolved, { withFileTypes: true });
              const items = entries
                .filter((e) => !e.name.startsWith("."))
                .map((e) => ({
                  name: e.name,
                  isDirectory: e.isDirectory(),
                  path: join(resolved, e.name),
                }))
                .sort((a, b) => {
                  if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
                  return a.name.localeCompare(b.name);
                });
              return sendJSON(res, { path: resolved, items });
            } catch {
              return sendJSON(res, { error: "Cannot read directory" }, 400);
            }
          }

          // ─── GET /api/chat/files/* ──────────────────────
          // Read file content
          const filesMatch = pathOnly.match(/^\/api\/chat\/files\/(.+)$/);
          if (filesMatch && method === "GET") {
            const filePath = decodeURIComponent(filesMatch[1]);
            if (!existsSync(filePath)) {
              return sendJSON(res, { error: "File not found" }, 404);
            }
            try {
              const content = readFileSync(filePath, "utf8");
              const stat = statSync(filePath);
              return sendJSON(res, {
                path: filePath,
                content,
                size: stat.size,
                modified: stat.mtime.toISOString(),
              });
            } catch {
              return sendJSON(res, { error: "Cannot read file" }, 400);
            }
          }

          // ─── GET /api/chat/running ──────────────────────
          // Get list of running session IDs
          if (method === "GET" && pathOnly === "/api/chat/running") {
            return sendJSON(res, { ids: getRunningRpcSessionIds() });
          }

          // Not found
          return sendJSON(res, { error: "Not found" }, 404);
        } catch (error) {
          console.error("[chat-api] Error:", error);
          return sendJSON(res, { error: String(error) }, 500);
        }
      });
    },
  };
}

// ─── File Access Control ────────────────────────────────

const allowedRoots = new Set<string>();

function allowFileRoot(root: string) {
  allowedRoots.add(resolve(root));
}
