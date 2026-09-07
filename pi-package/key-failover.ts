/**
 * Provider API-key automatic failover for pi-web-switch.
 *
 * When a custom provider (relay) has an opted-in key pool and the active key
 * hits a rate limit (HTTP 429) or runs out of balance, retry the request with
 * the next healthy key inside a single provider stream call. Works for the
 * terminal Pi CLI and Web Chat alike because both run requests through the
 * Pi model runtime, which dispatches to the provider's `streamSimple`.
 *
 * Registration contract (see pi provider-composer): the extension registers
 * `registerProvider(id, { api, streamSimple })` WITHOUT models/baseUrl/apiKey,
 * so models.json stays the source of truth for config and the wrapper only
 * intercepts models whose `model.api` matches the registered `api`.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  createAssistantMessageEventStream,
  lazyStream,
} from "@earendil-works/pi-ai";
import { getApiProvider } from "@earendil-works/pi-ai/compat";
import type {
  Api,
  AssistantMessage,
  AssistantMessageEvent,
  AssistantMessageEventStream,
  Context,
  Model,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// ─── Types ───────────────────────────────────────────────

export interface KeyPoolEntry {
  /** Stable id from models.json `apiKeys[].id`, or a hash of the raw key. */
  id: string;
  /** Raw value from models.json (may be an env reference; resolved per request). */
  value: string;
  /** Resolved concrete key, or undefined when it cannot be resolved. */
  resolved?: string;
}

export type KeyHealthStatus = "cooldown" | "paused";

export interface KeyHealthEntry {
  status: KeyHealthStatus;
  /** Epoch ms until which a cooldown key stays skipped. */
  until?: number;
  /** Human-readable, credential-free reason. */
  reason: string;
}

/** providerId → keyId → health entry. Persisted without raw key material. */
export type KeyHealthState = Record<string, Record<string, KeyHealthEntry>>;

export interface ProviderPoolConfig {
  autoFailover?: boolean;
  oauth?: unknown;
  baseUrl?: string;
  api?: string;
  apiKey?: string;
  apiKeys?: Array<{ id?: string; key?: string } | string>;
}

export interface EligibilityResult {
  eligible: boolean;
  reason?: string;
}

export type ErrorClass =
  | { kind: "abort" }
  | { kind: "rate-limit" }
  | { kind: "insufficient-balance" }
  | { kind: "other" };

/** Injectable dependencies so tests never touch the real filesystem. */
export interface FailoverDeps {
  loadProviderConfig: (providerId: string) => ProviderPoolConfig | undefined;
  loadHealthState: () => KeyHealthState;
  saveHealthState: (state: KeyHealthState) => void;
  /** Underlying stream the composer would have used. */
  fallbackStream: (
    model: Model<Api>,
    context: Context,
    options?: SimpleStreamOptions
  ) => AssistantMessageEventStream;
  now?: () => number;
  /** Credential-free diagnostic log. */
  log?: (message: string) => void;
}

/** Default cooldown after a 429 before the key is retried (ms). */
export const RATE_LIMIT_COOLDOWN_MS = 60_000;

// ─── Config value semantics (documented Pi behavior) ─────
// `!command` values are NOT executed here — providers using them are
// ineligible for failover. Env references use the documented
// `$VAR` / `${VAR}` interpolation with `$$` and `$!` escapes.

export function isCommandConfigValue(value: string): boolean {
  return value.startsWith("!");
}

/** Resolve `$VAR` / `${VAR}` / `$$` / `$!` semantics; undefined when unresolvable. */
export function resolveEnvConfigValue(
  value: string,
  env: Record<string, string | undefined> = process.env
): string | undefined {
  let out = "";
  let i = 0;
  while (i < value.length) {
    const ch = value[i];
    if (ch !== "$") {
      out += ch;
      i++;
      continue;
    }
    if (value[i + 1] === "$") {
      out += "$";
      i += 2;
      continue;
    }
    if (value[i + 1] === "!") {
      out += "!";
      i += 2;
      continue;
    }
    if (value[i + 1] === "{") {
      const end = value.indexOf("}", i + 2);
      if (end === -1) return undefined;
      const name = value.slice(i + 2, end);
      const v = env[name];
      if (v === undefined) return undefined;
      out += v;
      i = end + 1;
      continue;
    }
    // bare $VAR
    const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(value.slice(i + 1));
    if (!m) return undefined;
    const v = env[m[0]];
    if (v === undefined) return undefined;
    out += v;
    i += 1 + m[0].length;
  }
  return out;
}

// ─── Pool normalization ──────────────────────────────────

function hashKeyId(value: string): string {
  return `k_${createHash("sha256").update(value).digest("hex").slice(0, 12)}`;
}

/** Normalize models.json apiKeys/apiKey into entries with stable ids. */
export function normalizePool(cfg: ProviderPoolConfig): KeyPoolEntry[] {
  const out: KeyPoolEntry[] = [];
  const seen = new Set<string>();
  const push = (value: string, id?: string) => {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    out.push({ id: id?.trim() || hashKeyId(trimmed), value: trimmed });
  };
  const pool = Array.isArray(cfg.apiKeys) ? cfg.apiKeys : [];
  for (const entry of pool) {
    if (typeof entry === "string") push(entry);
    else if (entry && typeof entry.key === "string") push(entry.key, entry.id);
  }
  if (typeof cfg.apiKey === "string" && cfg.apiKey.trim()) push(cfg.apiKey);
  return out;
}

/** Resolve pool values; unresolvable/command entries are marked unresolved. */
export function resolvePool(
  pool: KeyPoolEntry[],
  env?: Record<string, string | undefined>
): KeyPoolEntry[] {
  return pool.map((entry) => {
    if (isCommandConfigValue(entry.value)) return { ...entry, resolved: undefined };
    return { ...entry, resolved: resolveEnvConfigValue(entry.value, env) };
  });
}

// ─── Eligibility ─────────────────────────────────────────

export function checkEligibility(cfg: ProviderPoolConfig | undefined): EligibilityResult {
  if (!cfg) return { eligible: false, reason: "not-found" };
  if (cfg.autoFailover !== true) return { eligible: false, reason: "disabled" };
  if (cfg.oauth) return { eligible: false, reason: "oauth" };
  if (!cfg.baseUrl) return { eligible: false, reason: "no-base-url" };
  if (!cfg.api) return { eligible: false, reason: "no-api" };
  const pool = resolvePool(normalizePool(cfg));
  if (pool.length < 2) return { eligible: false, reason: "needs-two-keys" };
  if (pool.some((k) => k.resolved === undefined)) {
    return { eligible: false, reason: "unresolvable-key" };
  }
  return { eligible: true };
}

// ─── Error classification ────────────────────────────────
// Order matters: quota/balance patterns must win over generic 429 because
// OpenAI-style relays report `429 ... insufficient_quota`. Bare 403 without
// balance wording is NOT treated as insufficient balance.

const ABORT_PATTERNS = [/request was aborted/i, /\baborted\b/i];
const BALANCE_PATTERNS = [
  // Matches insufficient_quota / insufficient_user_quota / insufficient balance,
  // e.g. relays returning 403 {"code":"insufficient_user_quota"} with
  // "pre-consume quota failed, user quota: $X, need quota: $Y".
  /insufficient[a-z_\s-]{0,20}(quota|balance|fund|credit)/i,
  /pre[-_\s]?consume\s+quota\s+failed/i,
  /exceeded your current quota/i,
  /quota[_\s-]?exceeded/i,
  /credit balance is too low/i,
  /billing[_\s-]?(?:limit|exceed|balance)/i,
  /余额不足|额度不足|欠费|账户余额/,
  /^\s*402[:\s]/,
];
const RATE_LIMIT_PATTERNS = [
  /^\s*429[:\s]/,
  /\b429\b/,
  /rate.?limit/i,
  /too many requests/i,
  /请求过于频繁|请求频率/,
];

export function classifyError(input: {
  reason?: string;
  errorMessage?: string;
  aborted?: boolean;
}): ErrorClass {
  if (input.aborted) return { kind: "abort" };
  const message = input.errorMessage ?? "";
  const reason = input.reason ?? "";
  if (reason === "aborted" || ABORT_PATTERNS.some((p) => p.test(message))) {
    return { kind: "abort" };
  }
  if (BALANCE_PATTERNS.some((p) => p.test(message))) {
    return { kind: "insufficient-balance" };
  }
  if (RATE_LIMIT_PATTERNS.some((p) => p.test(message))) {
    return { kind: "rate-limit" };
  }
  return { kind: "other" };
}

// ─── Health state persistence ────────────────────────────

export function readHealthState(path: string): KeyHealthState {
  try {
    if (!existsSync(path)) return {};
    return JSON.parse(readFileSync(path, "utf-8")) as KeyHealthState;
  } catch {
    return {};
  }
}

export function writeHealthState(path: string, state: KeyHealthState): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify(state, null, 2), "utf-8");
    renameSync(tmp, path);
  } catch {
    // Best-effort persistence; a lost update only delays cooldown tracking.
  }
}

export function resetProviderHealth(state: KeyHealthState, providerId: string, keyId?: string): KeyHealthState {
  const next: KeyHealthState = JSON.parse(JSON.stringify(state));
  if (!keyId) {
    delete next[providerId];
    return next;
  }
  const provider = next[providerId];
  if (provider) {
    delete provider[keyId];
    if (Object.keys(provider).length === 0) delete next[providerId];
  }
  return next;
}

// ─── Candidate ordering ──────────────────────────────────

/** Ordered candidate keys: active key first, then the rest; unhealthy skipped. */
export function pickCandidates(
  pool: KeyPoolEntry[],
  health: Record<string, KeyHealthEntry> | undefined,
  now: number,
  activeKeyId?: string
): { candidates: KeyPoolEntry[]; blocked: Array<{ entry: KeyPoolEntry; health: KeyHealthEntry }> } {
  const entries = [...pool];
  entries.sort((a, b) => {
    if (a.id === activeKeyId) return -1;
    if (b.id === activeKeyId) return 1;
    return 0;
  });
  const candidates: KeyPoolEntry[] = [];
  const blocked: Array<{ entry: KeyPoolEntry; health: KeyHealthEntry }> = [];
  for (const entry of entries) {
    const h = health?.[entry.id];
    if (h && (h.status === "paused" || (h.status === "cooldown" && (h.until ?? 0) > now))) {
      blocked.push({ entry, health: h });
      continue;
    }
    candidates.push(entry);
  }
  return { candidates, blocked };
}

// ─── Stream wrapper ──────────────────────────────────────

function describeKey(entry: KeyPoolEntry): string {
  const label = entry.value.length > 10 ? `${entry.value.slice(0, 4)}…${entry.value.slice(-4)}` : "key";
  return label;
}

/**
 * Build a `streamSimple` that retries rate-limited / out-of-balance keys.
 * Events before the first content event are buffered so a failed attempt is
 * invisible to the consumer (exactly-once delivery, no replay of partial
 * output). Once content starts, errors propagate unchanged.
 */
export function createFailoverStreamSimple(providerId: string, deps: FailoverDeps) {
  const now = deps.now ?? Date.now;

  async function* failoverIterator(
    model: Model<Api>,
    context: Context,
    options?: SimpleStreamOptions
  ): AsyncGenerator<AssistantMessageEvent> {
    const cfg = deps.loadProviderConfig(providerId);
    const eligibility = checkEligibility(cfg);
    if (!eligibility.eligible) {
      // Opted out or no longer eligible: pass through untouched.
      const stream = deps.fallbackStream(model, context, options);
      for await (const event of stream) yield event;
      return;
    }

    const pool = resolvePool(normalizePool(cfg ?? {}));
    // models.json `apiKey` mirrors the active pool entry — start there.
    const activeKey = typeof cfg?.apiKey === "string" ? cfg.apiKey.trim() : undefined;
    const activeId = pool.find((k) => k.value === activeKey)?.id;
    const state = deps.loadHealthState();
    const { candidates } = pickCandidates(pool, state[providerId], now(), activeId);
    if (candidates.length === 0) {
      // Every key is paused/cooldown: surface the original behavior via the
      // active key so the native error (and pi's retry logic) stays intact.
      const entry = pool.find((k) => k.value === activeKey) ?? pool[0];
      const stream = deps.fallbackStream(model, context, {
        ...options,
        apiKey: entry?.resolved ?? entry?.value,
      });
      for await (const event of stream) yield event;
      return;
    }

    let lastErrorEvent:
      | { type: "error"; reason: "error" | "aborted"; error: AssistantMessage }
      | undefined;

    for (let attempt = 0; attempt < candidates.length; attempt++) {
      const entry = candidates[attempt];
      if (!entry) break;
      const attemptOptions: SimpleStreamOptions | undefined = {
        ...options,
        apiKey: entry.resolved ?? entry.value,
      };

      const buffered: AssistantMessageEvent[] = [];
      let dirty = false; // true once any non-"start" event was produced
      let failoverClass: "rate-limit" | "insufficient-balance" | undefined;

      try {
        const stream = deps.fallbackStream(model, context, attemptOptions);
        for await (const event of stream) {
          if (event.type === "error") {
            const cls = classifyError({
              reason: event.reason,
              errorMessage: event.error?.errorMessage,
              aborted: options?.signal?.aborted === true,
            });
            if (!dirty && (cls.kind === "rate-limit" || cls.kind === "insufficient-balance")) {
              failoverClass = cls.kind;
              lastErrorEvent = event;
              break;
            }
            for (const bufferedEvent of buffered) yield bufferedEvent;
            yield event;
            return;
          }
          if (event.type === "done") {
            // Success: clear any stale cooldown on this key (keep paused).
            const fresh = deps.loadHealthState();
            const provider = fresh[providerId];
            if (provider?.[entry.id]?.status === "cooldown") {
              delete provider[entry.id];
              if (Object.keys(provider).length === 0) delete fresh[providerId];
              deps.saveHealthState(fresh);
            }
            for (const bufferedEvent of buffered) yield bufferedEvent;
            yield event;
            return;
          }
          if (event.type !== "start") dirty = true;
          if (dirty) {
            for (const bufferedEvent of buffered) yield bufferedEvent;
            buffered.length = 0;
            yield event;
          } else {
            buffered.push(event);
          }
        }
        if (!failoverClass) {
          // Stream ended without done/error — surface as an error like pi-ai would.
          for (const bufferedEvent of buffered) yield bufferedEvent;
          yield {
            type: "error",
            reason: "error",
            error: { stopReason: "error", errorMessage: "Stream ended without a terminal event" } as AssistantMessage,
          };
          return;
        }
      } catch (error) {
        const cls = classifyError({
          errorMessage: error instanceof Error ? error.message : String(error),
          aborted: options?.signal?.aborted === true,
        });
        if (!dirty && (cls.kind === "rate-limit" || cls.kind === "insufficient-balance")) {
          failoverClass = cls.kind;
          lastErrorEvent = {
            type: "error",
            reason: "error",
            error: {
              stopReason: "error",
              errorMessage: error instanceof Error ? error.message : String(error),
            } as AssistantMessage,
          };
        } else {
          throw error;
        }
      }

      if (failoverClass) {
        // Record health and move to the next key.
        const fresh = deps.loadHealthState();
        const provider = (fresh[providerId] ??= {});
        if (failoverClass === "insufficient-balance") {
          provider[entry.id] = { status: "paused", reason: "insufficient-balance" };
          deps.log?.(
            `[pi-web-switch] ${providerId}: key ${describeKey(entry)} paused (insufficient balance), switching key`
          );
        } else {
          provider[entry.id] = {
            status: "cooldown",
            until: now() + RATE_LIMIT_COOLDOWN_MS,
            reason: "rate-limit",
          };
          deps.log?.(
            `[pi-web-switch] ${providerId}: key ${describeKey(entry)} rate-limited, cooling down and switching key`
          );
        }
        deps.saveHealthState(fresh);
        continue;
      }
    }

    // All candidates exhausted: propagate the last original error unchanged so
    // pi's native retry-with-backoff semantics stay intact.
    if (lastErrorEvent) {
      yield lastErrorEvent;
      return;
    }
    yield {
      type: "error",
      reason: "error",
      error: { stopReason: "error", errorMessage: "All pool keys failed" } as AssistantMessage,
    };
  }

  return function failoverStreamSimple(
    model: Model<Api>,
    context: Context,
    options?: SimpleStreamOptions
  ): AssistantMessageEventStream {
    return lazyStream(model, async () => failoverIterator(model, context, options));
  };
}

// ─── Registration sync (used by the extension entry) ─────

export interface FailoverRuntime {
  /** ids currently registered by this extension instance. */
  registered: Set<string>;
  sync: () => void;
}

export function createFailoverRuntime(
  pi: ExtensionAPI,
  deps: {
    loadModelsJson: () => { providers?: Record<string, ProviderPoolConfig> } | undefined;
    healthStatePath: string;
  }
): FailoverRuntime {
  const registered = new Set<string>();

  const loadProviderConfig = (providerId: string): ProviderPoolConfig | undefined =>
    deps.loadModelsJson()?.providers?.[providerId];

  const sync = () => {
    const modelsJson = deps.loadModelsJson();
    const providers = modelsJson?.providers ?? {};
    const eligibleIds = new Set<string>();
    for (const [id, cfg] of Object.entries(providers)) {
      if (checkEligibility(cfg).eligible) eligibleIds.add(id);
    }
    // Drop registrations that are no longer eligible (disabled, single key, …).
    for (const id of [...registered]) {
      if (!eligibleIds.has(id)) {
        try {
          pi.unregisterProvider(id);
        } catch {
          // Not registered in this phase — nothing to undo.
        }
        registered.delete(id);
      }
    }
    for (const id of eligibleIds) {
      const cfg = providers[id];
      const streamSimple = createFailoverStreamSimple(id, {
        loadProviderConfig,
        loadHealthState: () => readHealthState(deps.healthStatePath),
        saveHealthState: (state) => writeHealthState(deps.healthStatePath, state),
        fallbackStream: (model, context, options) => {
          const api = getApiProvider(model.api);
          if (!api) {
            const stream = createAssistantMessageEventStream();
            stream.push({
              type: "error",
              reason: "error",
              error: {
                stopReason: "error",
                errorMessage: `No API provider registered for api: ${model.api}`,
              } as AssistantMessage,
            });
            stream.end();
            return stream;
          }
          return api.streamSimple(model, context, options);
        },
        log: (message) => console.error(message),
      });
      pi.registerProvider(id, { api: cfg?.api as Api, streamSimple });
      registered.add(id);
    }
  };

  return { registered, sync };
}
