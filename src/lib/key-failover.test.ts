/**
 * Unit tests for provider key-pool automatic failover.
 *
 * The stream wrapper is exercised against fake fallback streams so no real
 * HTTP is involved. Runtime integration (real pi CLI + fake relay) is covered
 * separately by the isolated e2e check described in the debug log.
 */
import { describe, expect, it } from "vitest";
import {
  checkEligibility,
  classifyError,
  createFailoverStreamSimple,
  isCommandConfigValue,
  normalizePool,
  pickCandidates,
  RATE_LIMIT_COOLDOWN_MS,
  resetProviderHealth,
  resolveEnvConfigValue,
  resolvePool,
  type FailoverDeps,
  type KeyHealthState,
  type ProviderPoolConfig,
} from "../../pi-package/key-failover.ts";
import type {
  Api,
  AssistantMessage,
  AssistantMessageEvent,
  AssistantMessageEventStream,
  Context,
  Model,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";

// ─── Test helpers ────────────────────────────────────────

type EventScript = Array<AssistantMessageEvent | Error>;

function scriptStream(script: EventScript): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  (async () => {
    for (const item of script) {
      if (item instanceof Error) throw item;
      stream.push(item);
    }
  })();
  return stream;
}

/** A leading Error means the api's streamSimple throws synchronously (like getClientApiKey). */
function scriptThrowsFirst(script: EventScript): boolean {
  return script[0] instanceof Error;
}

const fakeModel = { id: "m1", provider: "relay", api: "openai-completions" } as unknown as Model<Api>;
const fakeContext = {} as Context;

const startEvent: AssistantMessageEvent = { type: "start", partial: {} as AssistantMessage };
const textEvent: AssistantMessageEvent = {
  type: "text_delta",
  contentIndex: 0,
  delta: "hi",
  partial: {} as AssistantMessage,
};
function errorEvent(errorMessage: string, reason: "error" | "aborted" = "error"): AssistantMessageEvent {
  return {
    type: "error",
    reason,
    error: { stopReason: "error", errorMessage } as AssistantMessage,
  };
}
function doneEvent(): AssistantMessageEvent {
  return { type: "done", reason: "stop", message: {} as AssistantMessage };
}

interface Harness {
  events: AssistantMessageEvent[];
  scriptsByKey: Record<string, EventScript>;
  usedKeys: (string | undefined)[];
  health: KeyHealthState;
  logs: string[];
}

function makeHarness(cfg: ProviderPoolConfig, scriptsByKey: Harness["scriptsByKey"]): { harness: Harness; stream: ReturnType<typeof createFailoverStreamSimple> } {
  const harness: Harness = {
    events: [],
    scriptsByKey,
    usedKeys: [],
    health: {},
    logs: [],
  };
  const deps: FailoverDeps = {
    loadProviderConfig: () => cfg,
    loadHealthState: () => JSON.parse(JSON.stringify(harness.health)),
    saveHealthState: (state) => {
      harness.health = JSON.parse(JSON.stringify(state));
    },
    fallbackStream: (model, context, options) => {
      const key = options?.apiKey;
      harness.usedKeys.push(key);
      const script = scriptsByKey[String(key)] ?? scriptsByKey["*"] ?? [];
      if (scriptThrowsFirst(script)) throw script[0];
      return scriptStream(script);
    },
    now: () => 1_000_000,
    log: (message) => harness.logs.push(message),
  };
  return { harness, stream: createFailoverStreamSimple("relay", deps) };
}

async function collect(stream: AssistantMessageEventStream): Promise<{ events: AssistantMessageEvent[]; error?: unknown }> {
  const events: AssistantMessageEvent[] = [];
  try {
    for await (const event of stream) events.push(event);
    return { events };
  } catch (error) {
    return { events, error };
  }
}

// ─── Config value semantics ──────────────────────────────

describe("config value semantics", () => {
  it("detects command values", () => {
    expect(isCommandConfigValue("!echo hi")).toBe(true);
    expect(isCommandConfigValue("sk-literal")).toBe(false);
    expect(isCommandConfigValue("$VAR")).toBe(false);
  });

  it("resolves literals, env refs and escapes", () => {
    const env = { MY_KEY: "sk-abc", OTHER: "x" };
    expect(resolveEnvConfigValue("sk-literal", env)).toBe("sk-literal");
    expect(resolveEnvConfigValue("$MY_KEY", env)).toBe("sk-abc");
    expect(resolveEnvConfigValue("${MY_KEY}-suffix", env)).toBe("sk-abc-suffix");
    expect(resolveEnvConfigValue("a$$b", env)).toBe("a$b");
    expect(resolveEnvConfigValue("a$!b", env)).toBe("a!b");
    expect(resolveEnvConfigValue("$MISSING", env)).toBeUndefined();
    expect(resolveEnvConfigValue("trailing$", env)).toBeUndefined();
  });
});

// ─── Eligibility ─────────────────────────────────────────

describe("checkEligibility", () => {
  const base: ProviderPoolConfig = {
    autoFailover: true,
    baseUrl: "https://relay.example/v1",
    api: "openai-completions",
    apiKey: "sk-1",
    apiKeys: [{ id: "k1", key: "sk-1" }, { id: "k2", key: "sk-2" }],
  };

  it("accepts an opted-in two-key relay", () => {
    expect(checkEligibility(base).eligible).toBe(true);
  });
  it("rejects opt-out", () => {
    expect(checkEligibility({ ...base, autoFailover: false }).reason).toBe("disabled");
  });
  it("rejects oauth", () => {
    expect(checkEligibility({ ...base, oauth: {} }).reason).toBe("oauth");
  });
  it("rejects missing baseUrl/api", () => {
    expect(checkEligibility({ ...base, baseUrl: undefined }).reason).toBe("no-base-url");
    expect(checkEligibility({ ...base, api: undefined }).reason).toBe("no-api");
  });
  it("rejects single-key pools", () => {
    expect(checkEligibility({ ...base, apiKeys: [{ id: "k1", key: "sk-1" }] }).reason).toBe("needs-two-keys");
  });
  it("rejects command or unresolvable keys", () => {
    expect(
      checkEligibility({ ...base, apiKeys: [{ id: "k1", key: "!get-key" }, { id: "k2", key: "sk-2" }] }).reason
    ).toBe("unresolvable-key");
    expect(
      checkEligibility({ ...base, apiKeys: [{ id: "k1", key: "$MISSING" }, { id: "k2", key: "sk-2" }] }).reason
    ).toBe("unresolvable-key");
  });
});

// ─── Error classification ────────────────────────────────

describe("classifyError", () => {
  it("treats abort as abort", () => {
    expect(classifyError({ reason: "aborted" }).kind).toBe("abort");
    expect(classifyError({ errorMessage: "Request was aborted" }).kind).toBe("abort");
    expect(classifyError({ errorMessage: "429: too many", aborted: true }).kind).toBe("abort");
  });
  it("classifies quota before generic 429 (OpenAI insufficient_quota)", () => {
    expect(
      classifyError({ errorMessage: "429: You exceeded your current quota, please check your plan and billing details." }).kind
    ).toBe("insufficient-balance");
  });
  it("classifies balance wordings incl. Chinese and 402", () => {
    expect(classifyError({ errorMessage: "403: 余额不足，请充值" }).kind).toBe("insufficient-balance");
    expect(classifyError({ errorMessage: "credit balance is too low" }).kind).toBe("insufficient-balance");
    expect(classifyError({ errorMessage: "402: payment required" }).kind).toBe("insufficient-balance");
  });
  it("classifies relay pre-consume quota failures (403 insufficient_user_quota)", () => {
    const relayMessage =
      '403: {"message":"pre-consume quota failed, user quota: ＄0.799672, need quota: ＄0.856784 (request id: 20260907160559623799290lx9xrHoVqF1w6)","type":"new_api_error","param":"","code":"insufficient_user_quota"}';
    expect(classifyError({ errorMessage: relayMessage }).kind).toBe("insufficient-balance");
    expect(classifyError({ errorMessage: '403: {"code":"insufficient_quota"}' }).kind).toBe("insufficient-balance");
    expect(classifyError({ errorMessage: "pre-consume quota failed, user quota: $0.7, need quota: $0.8" }).kind).toBe("insufficient-balance");
  });
  it("does NOT treat bare 403 as balance", () => {
    expect(classifyError({ errorMessage: "403: invalid api key" }).kind).toBe("other");
  });
  it("classifies rate limits", () => {
    expect(classifyError({ errorMessage: "429: too many requests" }).kind).toBe("rate-limit");
    expect(classifyError({ errorMessage: "Rate limit exceeded" }).kind).toBe("rate-limit");
    expect(classifyError({ errorMessage: "请求过于频繁" }).kind).toBe("rate-limit");
  });
  it("leaves unrelated errors as other", () => {
    expect(classifyError({ errorMessage: "context_length_exceeded" }).kind).toBe("other");
    expect(classifyError({ errorMessage: "connection reset" }).kind).toBe("other");
  });
});

// ─── Pool + candidates ───────────────────────────────────

describe("pool handling", () => {
  it("normalizes pool with stable ids and dedupes", () => {
    const pool = normalizePool({
      apiKey: "sk-1",
      apiKeys: [{ id: "a", key: "sk-1" }, { key: "sk-2" }, "sk-2"],
    });
    expect(pool.map((k) => k.value)).toEqual(["sk-1", "sk-2"]);
    expect(pool[0]?.id).toBe("a");
    expect(pool[1]?.id).toMatch(/^k_[0-9a-f]{12}$/);
  });

  it("orders active key first and skips unhealthy", () => {
    const pool = resolvePool(normalizePool({ apiKey: "sk-1", apiKeys: [{ id: "k1", key: "sk-1" }, { id: "k2", key: "sk-2" }, { id: "k3", key: "sk-3" }] }));
    const now = 1_000_000;
    const health: Record<string, { status: "cooldown" | "paused"; until?: number; reason: string }> = {
      k1: { status: "cooldown", until: now + 10_000, reason: "rate-limit" },
      k2: { status: "paused", reason: "insufficient-balance" },
    };
    const { candidates, blocked } = pickCandidates(pool, health, now, "k1");
    expect(candidates.map((k) => k.id)).toEqual(["k3"]);
    expect(blocked.map((b) => b.entry.id).sort()).toEqual(["k1", "k2"]);
  });

  it("uses a key again after cooldown expiry", () => {
    const pool = resolvePool(normalizePool({ apiKeys: [{ id: "k1", key: "sk-1" }] }));
    const now = 2_000_000;
    const { candidates } = pickCandidates(pool, { k1: { status: "cooldown", until: now - 1, reason: "rate-limit" } }, now, "k1");
    expect(candidates.map((k) => k.id)).toEqual(["k1"]);
  });

  it("resets provider health fully or per key", () => {
    const state: KeyHealthState = { relay: { k1: { status: "paused", reason: "x" }, k2: { status: "paused", reason: "y" } } };
    expect(resetProviderHealth(state, "relay", "k1")).toEqual({ relay: { k2: { status: "paused", reason: "y" } } });
    expect(resetProviderHealth(state, "relay")).toEqual({});
  });
});

// ─── Stream failover behavior ────────────────────────────

const eligibleCfg: ProviderPoolConfig = {
  autoFailover: true,
  baseUrl: "https://relay.example/v1",
  api: "openai-completions",
  apiKey: "sk-1",
  apiKeys: [
    { id: "k1", key: "sk-1" },
    { id: "k2", key: "sk-2" },
    { id: "k3", key: "sk-3" },
  ],
};

describe("createFailoverStreamSimple", () => {
  it("switches key after a 429 and delivers events exactly once", async () => {
    const { harness, stream } = makeHarness(eligibleCfg, {
      "sk-1": [startEvent, errorEvent("429: too many requests")],
      "sk-2": [startEvent, textEvent, doneEvent()],
    });
    const { events } = await collect(stream(fakeModel, fakeContext, {}));
    expect(harness.usedKeys).toEqual(["sk-1", "sk-2"]);
    // exactly one start, no duplicated prefix from the failed attempt
    expect(events.filter((e) => e.type === "start")).toHaveLength(1);
    expect(events.map((e) => e.type)).toEqual(["start", "text_delta", "done"]);
    expect(harness.health.relay?.k1).toMatchObject({ status: "cooldown", reason: "rate-limit" });
    expect(harness.health.relay?.k1?.until).toBe(1_000_000 + RATE_LIMIT_COOLDOWN_MS);
  });

  it("pauses a key on insufficient balance (even 429 insufficient_quota)", async () => {
    const { harness, stream } = makeHarness(eligibleCfg, {
      "sk-1": [startEvent, errorEvent("429: You exceeded your current quota, please check your plan and billing details.")],
      "sk-2": [startEvent, doneEvent()],
    });
    const { events } = await collect(stream(fakeModel, fakeContext, {}));
    expect(harness.usedKeys).toEqual(["sk-1", "sk-2"]);
    expect(events.at(-1)?.type).toBe("done");
    expect(harness.health.relay?.k1).toEqual({ status: "paused", reason: "insufficient-balance" });
  });

  it("stops rotating when every key fails and propagates the last original error", async () => {
    const { harness, stream } = makeHarness(eligibleCfg, {
      "sk-1": [startEvent, errorEvent("429: too many requests")],
      "sk-2": [startEvent, errorEvent("429: rate limit hit")],
      "sk-3": [startEvent, errorEvent("429: rate limit hit again")],
    });
    const { events } = await collect(stream(fakeModel, fakeContext, {}));
    expect(harness.usedKeys).toEqual(["sk-1", "sk-2", "sk-3"]);
    const last = events.at(-1);
    expect(last?.type).toBe("error");
    if (last?.type === "error") expect(last.error.errorMessage).toBe("429: rate limit hit again");
  });

  it("never retries after content output has started", async () => {
    const { harness, stream } = makeHarness(eligibleCfg, {
      "sk-1": [startEvent, textEvent, errorEvent("429: too many requests")],
    });
    const { events } = await collect(stream(fakeModel, fakeContext, {}));
    expect(harness.usedKeys).toEqual(["sk-1"]); // no second key
    expect(events.map((e) => e.type)).toEqual(["start", "text_delta", "error"]);
  });

  it("propagates unrelated errors without switching", async () => {
    const { harness, stream } = makeHarness(eligibleCfg, {
      "sk-1": [startEvent, errorEvent("500: internal error")],
    });
    const { events } = await collect(stream(fakeModel, fakeContext, {}));
    expect(harness.usedKeys).toEqual(["sk-1"]);
    expect(events.at(-1)?.type).toBe("error");
    expect(harness.health.relay).toBeUndefined();
  });

  it("propagates aborts without switching", async () => {
    const { harness, stream } = makeHarness(eligibleCfg, {
      "sk-1": [startEvent, errorEvent("Request was aborted", "aborted")],
    });
    const { events } = await collect(stream(fakeModel, fakeContext, {}));
    expect(harness.usedKeys).toEqual(["sk-1"]);
    expect(events.at(-1)?.type).toBe("error");
  });

  it("handles thrown errors from the fallback stream", async () => {
    const { harness, stream } = makeHarness(eligibleCfg, {
      "sk-1": [new Error("429: too many requests")],
      "sk-2": [startEvent, doneEvent()],
    });
    const { events } = await collect(stream(fakeModel, fakeContext, {}));
    expect(harness.usedKeys).toEqual(["sk-1", "sk-2"]);
    expect(events.at(-1)?.type).toBe("done");
    expect(harness.health.relay?.k1?.status).toBe("cooldown");
  });
  it("passes through untouched when no longer eligible", async () => {
    const cfg = { ...eligibleCfg, autoFailover: false };
    const { harness, stream } = makeHarness(cfg, {
      "sk-1": [startEvent, errorEvent("429: too many requests")],
      "sk-2": [startEvent, doneEvent()],
    });
    const { events } = await collect(stream(fakeModel, fakeContext, { apiKey: "sk-1" }));
    // Uses the caller's apiKey and does not failover
    expect(harness.usedKeys).toEqual(["sk-1"]);
    expect(events.at(-1)?.type).toBe("error");
  });

  it("uses the active-key ordering from models.json apiKey", async () => {
    const cfg = { ...eligibleCfg, apiKey: "sk-3" };
    const { harness, stream } = makeHarness(cfg, {
      "sk-3": [startEvent, errorEvent("429: rate limit")],
      "sk-1": [startEvent, doneEvent()],
      "sk-2": [startEvent, doneEvent()],
    });
    await collect(stream(fakeModel, fakeContext, {}));
    expect(harness.usedKeys[0]).toBe("sk-3");
  });

  it("delegates to the active key when all keys are unhealthy", async () => {
    const { harness, stream } = makeHarness(eligibleCfg, {
      "sk-1": [startEvent, errorEvent("429: still limited")],
    });
    harness.health = {
      relay: {
        k1: { status: "paused", reason: "insufficient-balance" },
        k2: { status: "paused", reason: "insufficient-balance" },
        k3: { status: "cooldown", until: 9_999_999, reason: "rate-limit" },
      },
    };
    const { events } = await collect(stream(fakeModel, fakeContext, {}));
    // Active key sk-1 delegated to; its error surfaces unchanged.
    expect(harness.usedKeys).toEqual(["sk-1"]);
    expect(events.at(-1)?.type).toBe("error");
  });

  it("clears an expired cooldown entry after the key succeeds again", async () => {
    const { harness, stream } = makeHarness(eligibleCfg, {
      "sk-1": [startEvent, doneEvent()],
      "sk-2": [startEvent, doneEvent()],
      "sk-3": [startEvent, doneEvent()],
    });
    // Cooldown already expired: sk-1 is a candidate again.
    harness.health = { relay: { k1: { status: "cooldown", until: 1_000_000 - 1, reason: "rate-limit" } } };
    await collect(stream(fakeModel, fakeContext, {}));
    expect(harness.usedKeys).toEqual(["sk-1"]);
    expect(harness.health.relay?.k1).toBeUndefined();
  });
});
