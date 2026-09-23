import { afterEach, describe, expect, it } from "vitest";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listActiveWebChats, runWebChat, stopWebChat } from "./pi-reader";

const previousBinary = process.env.PI_BINARY;
const tempDirs: string[] = [];

function fakePi(script: string): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-chat-test-"));
  tempDirs.push(dir);
  const binary = join(dir, "pi");
  writeFileSync(binary, `#!/bin/sh\nif [ "$1" = "--version" ]; then echo 0.87.0; exit 0; fi\n${script}\n`);
  chmodSync(binary, 0o755);
  process.env.PI_BINARY = binary;
  return dir;
}

afterEach(() => {
  if (previousBinary === undefined) delete process.env.PI_BINARY;
  else process.env.PI_BINARY = previousBinary;
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("local pi web chat", () => {
  it("streams text and tool steps from JSON events", async () => {
    const dir = fakePi(`printf '%s\\n' '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"Hello "}}' '{"type":"tool_execution_end","toolName":"read","result":{"content":[{"type":"text","text":"done"}]}}' '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"world"}}'`);
    const chunks: string[] = [];
    const steps: string[] = [];
    const result = await runWebChat("test", "web-chat-test-stream", (chunk) => chunks.push(chunk), dir, undefined, undefined, undefined, (step) => steps.push(step.text ?? ""));
    expect(result).toMatchObject({ sessionId: "web-chat-test-stream", text: "Hello world" });
    expect(result.error).toBeUndefined();
    expect(chunks).toEqual(["Hello ", "world"]);
    expect(steps).toEqual(["done"]);
    expect(listActiveWebChats()).not.toContain(result.sessionId);
  });

  it("rejects concurrent turns in the same session and can stop the active one", async () => {
    const dir = fakePi("exec sleep 5");
    const sessionId = "web-chat-test-concurrent";
    const first = runWebChat("first", sessionId, undefined, dir);
    expect(listActiveWebChats()).toContain(sessionId);
    const second = await runWebChat("second", sessionId, undefined, dir);
    expect(second.error).toBe("this session is already running");
    expect(stopWebChat(sessionId)).toBe(true);
    expect((await first).error).toBe("generation stopped");
    expect(listActiveWebChats()).not.toContain(sessionId);
  });
});
