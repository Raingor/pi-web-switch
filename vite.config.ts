import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import type { Connect } from "vite";

// ─── Pi Config API Plugin ───────────────────────────────

function piApiPlugin(): Plugin {
  // Lazy-load the server-side module (Node.js only)
  let pi: typeof import("./server/pi-reader");
  let builtins: typeof import("./src/data/builtin-providers");

  return {
    name: "pi-api",
    configureServer(server) {
      // Load server-side modules
      pi = require("./server/pi-reader");
      builtins = require("./src/data/builtin-providers");

      // Warm the usage cache in the background so the dashboard's first
      // request doesn't block on scanning ~150MB of session JSONL.
      setTimeout(() => {
        try {
          pi.readAllUsage();
        } catch {
          /* ignore warm-up failure */
        }
        try {
          pi.readCopilotUsage();
        } catch {
          /* ignore warm-up failure */
        }
      }, 0);

      const routes: Record<string, (req: Connect.IncomingMessage, res: any) => void> = {
        "GET /api/pi/settings"(_, res) {
          const data = pi.readSettings();
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(data ?? {}));
        },
        "POST /api/pi/settings"(req, res) {
          let body = "";
          req.on("data", (chunk: string) => (body += chunk));
          req.on("end", () => {
            const ok = pi.writeSettings(JSON.parse(body));
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ success: ok }));
          });
        },
        "GET /api/pi/auth"(_, res) {
          const data = pi.readAuth();
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(data ?? {}));
        },
        "POST /api/pi/auth"(req, res) {
          let body = "";
          req.on("data", (chunk: string) => (body += chunk));
          req.on("end", () => {
            const ok = pi.writeAuth(JSON.parse(body));
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ success: ok }));
          });
        },
        "GET /api/pi/models"(_, res) {
          const data = pi.readModels();
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(data ?? { providers: {} }));
        },
        "POST /api/pi/models"(req, res) {
          let body = "";
          req.on("data", (chunk: string) => (body += chunk));
          req.on("end", () => {
            const ok = pi.writeModels(JSON.parse(body));
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ success: ok }));
          });
        },
        "GET /api/pi/builtin-providers"(_, res) {
          res.setHeader("Content-Type", "application/json");
          // Prefer the live catalog from the local pi install; fall back to
          // the hand-written static list when pi isn't found on this machine.
          const catalog = pi.readBuiltinCatalog();
          res.end(JSON.stringify(catalog ?? builtins.getBuiltinProviders()));
        },
        "GET /api/pi/usage"(_, res) {
          const records = pi.readAllUsage();
          const usage = {
            records,
            dailyAggregates: pi.getDailyAggregates(records),
            providerSummaries: pi.getProviderSummaries(records),
            modelSummaries: pi.getModelSummaries(records),
            totals: pi.getTotals(records),
          };
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(usage));
        },
        "GET /api/pi/sessions"(_, res) {
          const sessions = pi.listSessions();
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(sessions));
        },
        "GET /api/pi/memory"(_, res) {
          const memory = pi.readMemoryFiles();
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(memory));
        },
        "GET /api/pi/subagents"(_, res) {
          const data = pi.readSubagents();
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(data));
        },
        "POST /api/pi/memory/delete-entry"(req, res) {
          let body = "";
          req.on("data", (chunk: string) => (body += chunk));
          req.on("end", () => {
            try {
              const { filename, text } = JSON.parse(body) as { filename: string; text: string };
              const ok = pi.deleteMemoryEntry(filename, text);
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ success: ok }));
            } catch {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ success: false, error: "Invalid request body" }));
            }
          });
        },
        "GET /api/pi/trash"(_, res) {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(pi.listTrash()));
        },
        "GET /api/pi/copilot-config"(_, res) {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(pi.readCopilotConfig() ?? {}));
        },
        "POST /api/pi/copilot-config"(req, res) {
          let body = "";
          req.on("data", (chunk: string) => (body += chunk));
          req.on("end", () => {
            try {
              const cfg = JSON.parse(body) as { username?: string; token?: string };
              const ok = pi.writeCopilotConfig(cfg);
              // Config changed → drop cached usage so the next view refetches.
              pi.clearCopilotCaches();
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ success: ok }));
            } catch {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ success: false, error: "Invalid request body" }));
            }
          });
        },
        "POST /api/pi/session/trash"(req, res) {
          let body = "";
          req.on("data", (chunk: string) => (body += chunk));
          req.on("end", () => {
            try {
              const { path: p } = JSON.parse(body) as { path: string };
              const ok = pi.trashSessionFile(p);
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ success: ok }));
            } catch {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ success: false, error: "Invalid request body" }));
            }
          });
        },
        "POST /api/pi/session/restore"(req, res) {
          let body = "";
          req.on("data", (chunk: string) => (body += chunk));
          req.on("end", () => {
            try {
              const { trashPath } = JSON.parse(body) as { trashPath: string };
              const ok = pi.restoreFromTrash(trashPath);
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ success: ok }));
            } catch {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ success: false, error: "Invalid request body" }));
            }
          });
        },
        "GET /api/pi/session-preview"(req, res) {
          const parsedUrl = new URL(req.url!, "http://localhost");
          const p = parsedUrl.searchParams.get("path") || "";
          const preview = pi.readSessionPreview(decodeURIComponent(p));
          if (!preview) {
            res.statusCode = 404;
            res.setHeader("Content-Type", "application/json");
            return res.end(JSON.stringify({ error: "Session not found" }));
          }
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(preview));
        },
        "GET /api/pi/check-updates"(_, res) {
          pi.checkUpdates()
            .then((result) => {
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify(result));
            })
            .catch(() => {
              res.statusCode = 500;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: "Update check failed" }));
            });
        },
        "POST /api/pi/apply-updates"(req, res) {
          let body = "";
          req.on("data", (chunk: string) => (body += chunk));
          req.on("end", () => {
            try {
              const { names } = JSON.parse(body) as { names: string[] };
              const results = pi.applyExtensionUpdates(Array.isArray(names) ? names : []);
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ results }));
            } catch {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: "Invalid request body" }));
            }
          });
        },
        "POST /api/pi/provider-models"(req, res) {
          let body = "";
          req.on("data", (chunk: string) => (body += chunk));
          req.on("end", () => {
            try {
              const { baseUrl, apiKey, providerId } = JSON.parse(body) as {
                baseUrl: string;
                apiKey?: string;
                providerId?: string;
              };
              if (!baseUrl) throw new Error("missing baseUrl");
              pi.fetchProviderModels(baseUrl, apiKey, providerId).then((result) => {
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify(result));
              });
            } catch {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ models: [], error: "Invalid request body" }));
            }
          });
        },
        "POST /api/pi/model-test"(req, res) {
          let body = "";
          req.on("data", (chunk: string) => (body += chunk));
          req.on("end", () => {
            try {
              const { baseUrl, modelId, apiKey, apiType } = JSON.parse(body) as { baseUrl: string; modelId: string; apiKey?: string; apiType?: string };
              if (!baseUrl || !modelId) throw new Error("missing baseUrl or modelId");
              pi.testModel(baseUrl, modelId, apiKey, apiType ?? "openai-completions").then((result) => {
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify(result));
              });
            } catch {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ success: false, message: "Invalid request body" }));
            }
          });
        },
        "POST /api/pi/provider-test"(req, res) {
          let body = "";
          req.on("data", (chunk: string) => (body += chunk));
          req.on("end", () => {
            try {
              const { baseUrl, apiKey } = JSON.parse(body) as { baseUrl: string; apiKey?: string };
              if (!baseUrl) throw new Error("missing baseUrl");
              pi.testProviderConnection(baseUrl, apiKey).then((result) => {
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify(result));
              });
            } catch {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ success: false, message: "Invalid request body" }));
            }
          });
        },
      };

      // Middleware: match API routes
      server.middlewares.use((req, res, next) => {
        const method = req.method!;
        const url = req.url!;
        // Only handle /api/pi/* paths
        if (!url.startsWith("/api/pi/")) return next();

        // Strip query string
        const pathOnly = url.split("?")[0];

        // Handle DELETE /api/pi/session?path=... (move to trash) and /api/pi/trash?path=... (permanent)
        if (method === "DELETE" && (pathOnly === "/api/pi/session" || pathOnly === "/api/pi/trash")) {
          const parsedUrl = new URL(url, "http://localhost");
          const filePath = parsedUrl.searchParams.get("path");
          if (!filePath) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            return res.end(JSON.stringify({ success: false, error: "Missing path" }));
          }
          const decodedPath = decodeURIComponent(filePath);
          const ok = pathOnly === "/api/pi/session"
            ? pi.trashSessionFile(decodedPath)
            : pi.permanentlyDeleteTrash(decodedPath);
          res.setHeader("Content-Type", "application/json");
          return res.end(JSON.stringify({ success: ok }));
        }

        // Handle GET /api/pi/usage-range?range=today|7d|30d|custom&from=...&to=...
        if (method === "GET" && pathOnly === "/api/pi/usage-range") {
          const parsedUrl = new URL(url, "http://localhost");
          const range = parsedUrl.searchParams.get("range") || "today";
          const fromParam = parsedUrl.searchParams.get("from") || "";
          const toParam = parsedUrl.searchParams.get("to") || "";

          const now = new Date();
          // Date buckets follow China time (UTC+8) regardless of system timezone
          const localDateStr = (dt: Date) =>
            new Intl.DateTimeFormat("en-CA", {
              timeZone: "Asia/Shanghai",
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
            }).format(dt);
          let fromDate: string;
          let toDate = localDateStr(now);

          if (range === "today") {
            fromDate = toDate;
          } else if (range === "7d") {
            const d = new Date(now); d.setDate(d.getDate() - 6); fromDate = localDateStr(d);
          } else if (range === "30d") {
            const d = new Date(now); d.setDate(d.getDate() - 29); fromDate = localDateStr(d);
          } else if (range === "custom" && fromParam) {
            fromDate = fromParam;
            if (toParam) toDate = toParam;
          } else {
            fromDate = toDate;
          }

          const allRecords = pi.readAllUsage();
          const usage = pi.getUsageByRange(allRecords, fromDate, toDate);
          res.setHeader("Content-Type", "application/json");
          return res.end(JSON.stringify(usage));
        }

        // Handle GET /api/pi/cindy-usage-range?range=today|7d|30d|custom&from=...&to=...
        if (method === "GET" && pathOnly === "/api/pi/cindy-usage-range") {
          const parsedUrl = new URL(url, "http://localhost");
          const range = parsedUrl.searchParams.get("range") || "today";
          const fromParam = parsedUrl.searchParams.get("from") || "";
          const toParam = parsedUrl.searchParams.get("to") || "";

          const now = new Date();
          // Date buckets follow China time (UTC+8) regardless of system timezone
          const localDateStr = (dt: Date) =>
            new Intl.DateTimeFormat("en-CA", {
              timeZone: "Asia/Shanghai",
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
            }).format(dt);
          let fromDate: string;
          let toDate = localDateStr(now);

          if (range === "today") {
            fromDate = toDate;
          } else if (range === "7d") {
            const d = new Date(now); d.setDate(d.getDate() - 6); fromDate = localDateStr(d);
          } else if (range === "30d") {
            const d = new Date(now); d.setDate(d.getDate() - 29); fromDate = localDateStr(d);
          } else if (range === "custom" && fromParam) {
            fromDate = fromParam;
            if (toParam) toDate = toParam;
          } else {
            fromDate = toDate;
          }

          const allRecords = pi.readCindyUsage();
          const usage = pi.getUsageByRange(allRecords, fromDate, toDate);
          res.setHeader("Content-Type", "application/json");
          return res.end(JSON.stringify(usage));
        }

        // Handle GET /api/pi/claude-usage-range?range=today|7d|30d|custom&from=...&to=...
        if (method === "GET" && pathOnly === "/api/pi/claude-usage-range") {
          const parsedUrl = new URL(url, "http://localhost");
          const range = parsedUrl.searchParams.get("range") || "today";
          const fromParam = parsedUrl.searchParams.get("from") || "";
          const toParam = parsedUrl.searchParams.get("to") || "";

          const now = new Date();
          // Date buckets follow China time (UTC+8) regardless of system timezone
          const localDateStr = (dt: Date) =>
            new Intl.DateTimeFormat("en-CA", {
              timeZone: "Asia/Shanghai",
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
            }).format(dt);
          let fromDate: string;
          let toDate = localDateStr(now);

          if (range === "today") {
            fromDate = toDate;
          } else if (range === "7d") {
            const d = new Date(now); d.setDate(d.getDate() - 6); fromDate = localDateStr(d);
          } else if (range === "30d") {
            const d = new Date(now); d.setDate(d.getDate() - 29); fromDate = localDateStr(d);
          } else if (range === "custom" && fromParam) {
            fromDate = fromParam;
            if (toParam) toDate = toParam;
          } else {
            fromDate = toDate;
          }

          const allRecords = pi.readClaudeUsage();
          const usage = pi.getUsageByRange(allRecords, fromDate, toDate);
          res.setHeader("Content-Type", "application/json");
          return res.end(JSON.stringify(usage));
        }

        // Handle GET /api/pi/codex-usage-range?range=today|7d|30d|custom&from=...&to=...
        if (method === "GET" && pathOnly === "/api/pi/codex-usage-range") {
          const parsedUrl = new URL(url, "http://localhost");
          const range = parsedUrl.searchParams.get("range") || "today";
          const fromParam = parsedUrl.searchParams.get("from") || "";
          const toParam = parsedUrl.searchParams.get("to") || "";

          const now = new Date();
          // Date buckets follow China time (UTC+8) regardless of system timezone
          const localDateStr = (dt: Date) =>
            new Intl.DateTimeFormat("en-CA", {
              timeZone: "Asia/Shanghai",
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
            }).format(dt);
          let fromDate: string;
          let toDate = localDateStr(now);

          if (range === "today") {
            fromDate = toDate;
          } else if (range === "7d") {
            const d = new Date(now); d.setDate(d.getDate() - 6); fromDate = localDateStr(d);
          } else if (range === "30d") {
            const d = new Date(now); d.setDate(d.getDate() - 29); fromDate = localDateStr(d);
          } else if (range === "custom" && fromParam) {
            fromDate = fromParam;
            if (toParam) toDate = toParam;
          } else {
            fromDate = toDate;
          }

          const allRecords = pi.readCodexUsage();
          const usage = pi.getUsageByRange(allRecords, fromDate, toDate);
          res.setHeader("Content-Type", "application/json");
          return res.end(JSON.stringify(usage));
        }

        // Helper: resolve date range params
        const resolveDateRange = (range: string, fromParam: string, toParam: string) => {
          const now = new Date();
          // Date buckets follow China time (UTC+8) regardless of system timezone
          const localDateStr = (dt: Date) =>
            new Intl.DateTimeFormat("en-CA", {
              timeZone: "Asia/Shanghai",
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
            }).format(dt);
          let fromDate: string;
          let toDate = localDateStr(now);
          if (range === "today") fromDate = toDate;
          else if (range === "7d") { const d = new Date(now); d.setDate(d.getDate() - 6); fromDate = localDateStr(d); }
          else if (range === "30d") { const d = new Date(now); d.setDate(d.getDate() - 29); fromDate = localDateStr(d); }
          else if (range === "custom" && fromParam) { fromDate = fromParam; if (toParam) toDate = toParam; }
          else fromDate = toDate;
          return { fromDate, toDate };
        };

        // Handle GET /api/pi/all-usage-range
        if (method === "GET" && pathOnly === "/api/pi/all-usage-range") {
          const parsedUrl = new URL(url, "http://localhost");
          const range = parsedUrl.searchParams.get("range") || "today";
          const fromParam = parsedUrl.searchParams.get("from") || "";
          const toParam = parsedUrl.searchParams.get("to") || "";
          const { fromDate, toDate } = resolveDateRange(range, fromParam, toParam);
          const allRecords = pi.readAllCombinedUsage();
          const usage = pi.getUsageByRange(allRecords, fromDate, toDate);
          res.setHeader("Content-Type", "application/json");
          return res.end(JSON.stringify(usage));
        }

        // Handle GET /api/pi/copilot-usage-range?range=today|7d|30d|custom&from=...&to=...
        // Unlike the local sources, Copilot data comes from the GitHub REST
        // API, so this handler is async and may take a few seconds on a cold
        // cache. `notice` carries a stable code for the dashboard to i18n:
        //   no-config  → token/username not set (see Settings → Advanced)
        //   api-error  → GitHub returned 4xx/5xx (bad token, wrong billing platform)
        if (method === "GET" && pathOnly === "/api/pi/copilot-usage-range") {
          const parsedUrl = new URL(url, "http://localhost");
          const range = parsedUrl.searchParams.get("range") || "today";
          const fromParam = parsedUrl.searchParams.get("from") || "";
          const toParam = parsedUrl.searchParams.get("to") || "";
          const { fromDate, toDate } = resolveDateRange(range, fromParam, toParam);

          pi.fetchCopilotUsageForRange(fromDate, toDate)
            .then(({ records, configured, errors }) => {
              const usage = pi.getUsageByRange(records, fromDate, toDate);
              const payload =
                !configured
                  ? { ...usage, notice: "no-config" }
                  : errors > 0
                    ? { ...usage, notice: "api-error" }
                    : usage;
              res.setHeader("Content-Type", "application/json");
              return res.end(JSON.stringify(payload));
            })
            .catch(() => {
              res.statusCode = 500;
              res.setHeader("Content-Type", "application/json");
              return res.end(JSON.stringify({ error: "Copilot fetch failed" }));
            });
          return;
        }

        // Handle provider-filtered endpoints: /api/pi/{provider}-usage-range
        const providerMatch = pathOnly.match(/^\/api\/pi\/(atomcode|opencode|gemini|grok)-usage-range$/);
        if (method === "GET" && providerMatch) {
          const providerId = providerMatch[1]!;
          const parsedUrl = new URL(url, "http://localhost");
          const range = parsedUrl.searchParams.get("range") || "today";
          const fromParam = parsedUrl.searchParams.get("from") || "";
          const toParam = parsedUrl.searchParams.get("to") || "";
          const { fromDate, toDate } = resolveDateRange(range, fromParam, toParam);
          const allRecords = pi.filterByProvider(pi.readAllCombinedUsage(), providerId);
          const usage = pi.getUsageByRange(allRecords, fromDate, toDate);
          res.setHeader("Content-Type", "application/json");
          return res.end(JSON.stringify(usage));
        }

        const key = `${method} ${pathOnly}`;
        const handler = routes[key];
        if (handler) {
          handler(req, res);
        } else {
          res.statusCode = 404;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Not found" }));
        }
      });
    },
  };
}

// ─── Vite Config ────────────────────────────────────────

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    piApiPlugin(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    port: 5176,
    strictPort: true,
  },
});