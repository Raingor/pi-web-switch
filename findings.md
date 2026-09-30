# Findings & Decisions

## Requirement

Remove the local-pi Web Chat and Jev structured-evaluation modules cleanly,
while leaving shared Sessions, trash/restore, usage, and Agnes generation
features intact.

## Research Findings

- The Web Chat feature had already been removed once before in history
  (`3ce541c` "chore: 移除 Chat 板块及相关代码", an older architecture based on
  `chat-api-plugin.ts` / `agent-session-manager.ts` / `useAgentSession.ts`) and
  later re-added with the current `runWebChat`-based implementation. This
  confirmed that removing Chat is an established, safe operation for this repo.
- The current Chat implementation is spread across: the `src/components/chat/`
  UI, `src/types/chat.ts`, `src/hooks/useSessionUsage.ts`, the `/chat` route +
  nav entry + AppShell full-height branch, a Sessions "Continue in Chat" link,
  Chat-only SSE/trash/usage/history/message endpoints in `vite.config.ts`, the
  matching functions in `server/pi-reader.ts`, all `.codex-*` CSS, and the
  `chat.*`/`nav.chat` translation keys.
- Careful separation was required to avoid deleting shared code: `trashSessionFile`
  and the `/api/pi/trash*` endpoints back the Sessions trash tab; `readSessionPreview`
  backs the Sessions preview; the mtime+size session cache is a general `listSessions`
  optimization. `session-usage`/`session-history`/`session-message` endpoints turned
  out to be Chat-only (no other frontend caller), so they were removed as dead code.
- False-positive matches that must be kept: `chatgpt-usage-range`,
  `codex-usage-status`, OpenAI `chat/completions` provider label, `relay/chat`
  test fixture, kimi pricing comment, and `agnes-chat`/`chatAgnes`.
- Jev was self-contained: `JevPage` only called `typesafe-config` and
  `typesafe-evaluate`; the corresponding `TypeSafe*` functions/config were only
  consumed by those endpoints. Agnes APIs are separately used by GeneratePage
  and were preserved. `~/.pi/agent/typesafe-config.json` exists locally; it is
  preserved pending explicit confirmation because it may contain a credential.

## Technical Decisions

| Decision | Rationale |
|----------|-----------|
| Delete the whole `src/components/chat/` dir | Entire module is Chat-only. |
| Remove `useSessionUsage.ts` | Chat-only hook with no remaining importers. |
| Remove Chat-only endpoints incl. `session-usage/history/message` | No non-Chat caller after the UI was deleted; leaving them is dead code. |
| Keep `trashSessionFile` + `/api/pi/trash*` + `readSessionPreview` | Used by the Sessions page, unrelated to Chat. |
| Keep the session metadata cache | General `listSessions` optimization, not Chat-specific. |
| Strip `.codex-*` CSS via PostCSS AST | Rules are compressed/mixed on shared lines; AST parsing removes Chat selectors safely and prunes emptied `@media`. |
| Renumber sidebar nav codes after removing Chat | Keep the `01…09` sequence contiguous. |
| Remove TypeSafe APIs/functions with Jev | No other source callers; keep Agnes APIs used by GeneratePage. |
| Preserve the local TypeSafe config file | Avoid deleting a user credential/data file without confirmation. |
