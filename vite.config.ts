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
          res.end(JSON.stringify(builtins.getBuiltinProviders()));
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
      };

      // Middleware: match API routes
      server.middlewares.use((req, res, next) => {
        const method = req.method!;
        const url = req.url!;
        // Only handle /api/pi/* paths
        if (!url.startsWith("/api/pi/")) return next();

        // Strip query string
        const pathOnly = url.split("?")[0];

        // Handle DELETE /api/pi/session?path=...
        if (method === "DELETE" && pathOnly === "/api/pi/session") {
          const parsedUrl = new URL(url, "http://localhost");
          const filePath = parsedUrl.searchParams.get("path");
          if (!filePath) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            return res.end(JSON.stringify({ success: false, error: "Missing path" }));
          }
          const decodedPath = decodeURIComponent(filePath);
          const ok = pi.deleteSessionFile(decodedPath);
          res.setHeader("Content-Type", "application/json");
          return res.end(JSON.stringify({ success: ok }));
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
  plugins: [react(), tailwindcss(), piApiPlugin()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});