// Local HTTP API server for the packaged Electron app.
//
// The web frontend fetches data from relative `/api/pi/*` URLs. In dev that
// hits the Vite middleware plugin; in a packaged build there is no Vite, so
// this server serves both the static `dist/` bundle AND the same /api/pi/*
// routes (mirroring vite.config.ts) from the main process.

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as pi from '../server/pi-reader';
import { getBuiltinProviders } from '../src/data/builtin-providers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// dist/ sits next to dist-electron/ (packaged: app.asar/dist/...)
const DIST_DIR = path.join(__dirname, '../../dist');

// ─── Helpers ─────────────────────────────────────────────

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function sendJson(res: http.ServerResponse, status: number, data: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: Buffer | string) => (body += chunk));
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

// Date buckets follow China time (UTC+8) — mirrors vite.config.ts.
function localDateStr(dt: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(dt);
}

function resolveDateRange(range: string, fromParam: string, toParam: string) {
  const now = new Date();
  let fromDate: string;
  let toDate = localDateStr(now);
  if (range === 'today') fromDate = toDate;
  else if (range === '7d') { const d = new Date(now); d.setDate(d.getDate() - 6); fromDate = localDateStr(d); }
  else if (range === '30d') { const d = new Date(now); d.setDate(d.getDate() - 29); fromDate = localDateStr(d); }
  else if (range === 'custom' && fromParam) { fromDate = fromParam; if (toParam) toDate = toParam; }
  else fromDate = toDate;
  return { fromDate, toDate };
}

// ─── API routes (mirror of vite.config.ts piApiPlugin) ───

async function handleApi(
  method: string,
  pathOnly: string,
  parsedUrl: URL,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  // DELETE /api/pi/session?path=... (move to trash) and /api/pi/trash?path=... (permanent)
  if (method === 'DELETE' && (pathOnly === '/api/pi/session' || pathOnly === '/api/pi/trash')) {
    const filePath = parsedUrl.searchParams.get('path');
    if (!filePath) return sendJson(res, 400, { success: false, error: 'Missing path' });
    const decoded = decodeURIComponent(filePath);
    const ok = pathOnly === '/api/pi/session'
      ? pi.trashSessionFile(decoded)
      : pi.permanentlyDeleteTrash(decoded);
    return sendJson(res, 200, { success: ok });
  }

  // GET /api/pi/usage-range / cindy- / claude- / codex- / all- / {provider}-
  // Note: "usage-range" itself does NOT end with "-usage-range" (no leading
  // dash), so match on the shared "usage-range" suffix instead.
  // `refresh=1` forces a rescan (bypasses pi-reader's 30s session cache).
  if (method === 'GET' && pathOnly.endsWith('usage-range')) {
    if (parsedUrl.searchParams.get('refresh') === '1') {
      pi.clearUsageCache();
    }
    const range = parsedUrl.searchParams.get('range') || 'today';
    const fromParam = parsedUrl.searchParams.get('from') || '';
    const toParam = parsedUrl.searchParams.get('to') || '';
    const { fromDate, toDate } = resolveDateRange(range, fromParam, toParam);

  // UsageRecord is an internal (non-exported) type in pi-reader; derive it
  // from the return type of readAllUsage() instead of importing it.
  type UsageRecord = ReturnType<typeof pi.readAllUsage>[number];

  let records: UsageRecord[] | null = null;
    if (pathOnly === '/api/pi/usage-range') {
      records = pi.readAllUsage();
    } else if (pathOnly === '/api/pi/cindy-usage-range') {
      records = pi.readCindyUsage();
    } else if (pathOnly === '/api/pi/claude-usage-range') {
      records = pi.readClaudeUsage();
    } else if (pathOnly === '/api/pi/codex-usage-range') {
      records = pi.readCodexUsage();
    } else if (pathOnly === '/api/pi/all-usage-range') {
      records = pi.readAllCombinedUsage();
    } else {
      // /api/pi/{atomcode|copilot|opencode|gemini|grok}-usage-range
      const providerMatch = pathOnly.match(/^\/api\/pi\/(atomcode|copilot|opencode|gemini|grok)-usage-range$/);
      if (providerMatch) {
        records = pi.filterByProvider(pi.readAllCombinedUsage(), providerMatch[1]!);
      }
    }
    if (!records) return sendJson(res, 404, { error: 'Not found' });
    const usage = pi.getUsageByRange(records, fromDate, toDate);
    return sendJson(res, 200, usage);
  }

  // Static route table (mirror of vite.config.ts `routes`)
  const key = `${method} ${pathOnly}`;
  const body = await readBody(req).catch(() => '');

  try {
    switch (key) {
      case 'GET /api/pi/settings': return sendJson(res, 200, pi.readSettings() ?? {});
      case 'POST /api/pi/settings':
        return sendJson(res, 200, { success: pi.writeSettings(JSON.parse(body)) });
      case 'GET /api/pi/auth': return sendJson(res, 200, pi.readAuth() ?? {});
      case 'POST /api/pi/auth':
        return sendJson(res, 200, { success: pi.writeAuth(JSON.parse(body)) });
      case 'GET /api/pi/models': return sendJson(res, 200, pi.readModels() ?? { providers: {} });
      case 'POST /api/pi/models':
        return sendJson(res, 200, { success: pi.writeModels(JSON.parse(body)) });
      case 'GET /api/pi/builtin-providers': {
        const catalog = pi.readBuiltinCatalog();
        return sendJson(res, 200, catalog ?? getBuiltinProviders());
      }
      case 'GET /api/pi/usage': {
        const records = pi.readAllUsage();
        return sendJson(res, 200, {
          records,
          dailyAggregates: pi.getDailyAggregates(records),
          providerSummaries: pi.getProviderSummaries(records),
          modelSummaries: pi.getModelSummaries(records),
          totals: pi.getTotals(records),
        });
      }
      case 'GET /api/pi/sessions': return sendJson(res, 200, pi.listSessions());
      case 'GET /api/pi/memory': return sendJson(res, 200, pi.readMemoryFiles());
      case 'GET /api/pi/subagents': return sendJson(res, 200, pi.readSubagents());
      case 'POST /api/pi/memory/delete-entry': {
        const { filename, text } = JSON.parse(body) as { filename: string; text: string };
        return sendJson(res, 200, { success: pi.deleteMemoryEntry(filename, text) });
      }
      case 'GET /api/pi/trash': return sendJson(res, 200, pi.listTrash());
      case 'GET /api/pi/copilot-config': return sendJson(res, 200, pi.readCopilotConfig() ?? {});
      case 'POST /api/pi/copilot-config': {
        const cfg = JSON.parse(body) as { username?: string; token?: string };
        const ok = pi.writeCopilotConfig(cfg);
        pi.clearCopilotCaches();
        return sendJson(res, 200, { success: ok });
      }
      case 'POST /api/pi/session/trash': {
        const { path: p } = JSON.parse(body) as { path: string };
        return sendJson(res, 200, { success: pi.trashSessionFile(p) });
      }
      case 'POST /api/pi/session/restore': {
        const { trashPath } = JSON.parse(body) as { trashPath: string };
        return sendJson(res, 200, { success: pi.restoreFromTrash(trashPath) });
      }
      case 'GET /api/pi/session-preview': {
        const p = parsedUrl.searchParams.get('path') || '';
        const preview = pi.readSessionPreview(decodeURIComponent(p));
        if (!preview) return sendJson(res, 404, { error: 'Session not found' });
        return sendJson(res, 200, preview);
      }
      case 'GET /api/pi/check-updates': {
        try {
          const result = await pi.checkUpdates();
          return sendJson(res, 200, result);
        } catch {
          return sendJson(res, 500, { error: 'Update check failed' });
        }
      }
      case 'POST /api/pi/apply-updates': {
        const { names } = JSON.parse(body) as { names: string[] };
        return sendJson(res, 200, { results: pi.applyExtensionUpdates(Array.isArray(names) ? names : []) });
      }
      case 'POST /api/pi/provider-models': {
        const { baseUrl, apiKey, providerId } = JSON.parse(body) as {
          baseUrl: string; apiKey?: string; providerId?: string;
        };
        if (!baseUrl) throw new Error('missing baseUrl');
        const result = await pi.fetchProviderModels(baseUrl, apiKey, providerId);
        return sendJson(res, 200, result);
      }
      case 'POST /api/pi/model-test': {
        const { baseUrl, modelId, apiKey, apiType } = JSON.parse(body) as {
          baseUrl: string; modelId: string; apiKey?: string; apiType?: string;
        };
        if (!baseUrl || !modelId) throw new Error('missing baseUrl or modelId');
        const result = await pi.testModel(baseUrl, modelId, apiKey, apiType ?? 'openai-completions');
        return sendJson(res, 200, result);
      }
      case 'POST /api/pi/provider-test': {
        const { baseUrl, apiKey } = JSON.parse(body) as { baseUrl: string; apiKey?: string };
        if (!baseUrl) throw new Error('missing baseUrl');
        const result = await pi.testProviderConnection(baseUrl, apiKey);
        return sendJson(res, 200, result);
      }
      default:
        return sendJson(res, 404, { error: 'Not found' });
    }
  } catch {
    return sendJson(res, 400, { success: false, error: 'Invalid request body' });
  }
}

// ─── Static file serving (dist bundle) ───────────────────

function serveStatic(pathOnly: string, res: http.ServerResponse): void {
  // SPA fallback: unknown non-asset paths serve index.html
  let filePath = path.join(DIST_DIR, pathOnly === '/' ? 'index.html' : pathOnly);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(DIST_DIR, 'index.html');
  }
  const ext = path.extname(filePath).toLowerCase();
  res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream');
  fs.createReadStream(filePath).pipe(res);
}

// ─── Server lifecycle ────────────────────────────────────

export interface ApiServerHandle {
  server: http.Server;
  port: number;
  url: string;
}

export function startApiServer(): Promise<ApiServerHandle> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const method = req.method ?? 'GET';
      const url = req.url ?? '/';
      const parsedUrl = new URL(url, 'http://localhost');
      const pathOnly = parsedUrl.pathname;

      if (pathOnly.startsWith('/api/pi/')) {
        handleApi(method, pathOnly, parsedUrl, req, res).catch(() => {
          sendJson(res, 500, { error: 'Internal error' });
        });
      } else {
        serveStatic(pathOnly, res);
      }
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ server, port, url: `http://127.0.0.1:${port}` });
    });
  });
}
