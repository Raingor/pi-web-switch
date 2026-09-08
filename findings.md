# Findings & Decisions

## Requirements

- Audit usage-statistics custom, 7-day, and 30-day calculations.
- Create a new branch and build a Web Chat module for local pi.
- Web Chat must support selecting and switching sessions.

## Research Findings

- The worktree has uncommitted changes from earlier dashboard, provider-search, and update-flow work; they must be preserved.
- The app already reads local pi session data and exposes session APIs, so those are the first candidates for Chat integration.
- `getUsageByRange` performs an inclusive lexical `YYYY-MM-DD` filter, so custom ranges include both endpoints correctly.
- The 7-day and 30-day range endpoints intend to include today plus the preceding 6 or 29 China-time calendar days, respectively. Their current `Date#setDate` calculation starts in the host timezone and only formats in China time afterwards, which can shift the start date by one day outside UTC+8.
- `pi --help` is unsuitable as a non-interactive capability probe in this environment; inspect the installed CLI source and use explicit documented flags instead.

## Technical Decisions

| Decision | Rationale |
|----------|-----------|
| Audit the current server date-range helper before making changes | Avoid changing range semantics without evidence. |
| Build Web Chat around the local pi CLI rather than a browser-held API key | The product is intended to manage and use the locally installed pi configuration. |
| Compute rolling range boundaries from a China-time date string using UTC calendar arithmetic | Makes the inclusive 7/30-day windows independent of the machine timezone. |
| Use fetch-streamed SSE for Chat output | Keeps the existing POST request shape while rendering each local pi stdout chunk immediately. |
| Use explicit name, then first user message, then timestamp fallback for Web Chat session titles | Pi session files commonly omit `session_info.name`; the first user message is the most useful local title source. |

## Validation

- A real `POST /api/pi/chat` request streamed a `delta` and a `done` event from local pi.
- The generated `web-…` session was returned by `/api/pi/sessions` with its first prompt as `firstMessage`.
- Browser verification at `/chat` found that title visible and found zero occurrences of the old “未命名会话” fallback.

## Codex-style workspace design

- The default workspace should be Chat, with the global left rail dedicated to new and existing conversations.
- Existing operational screens will remain routable but move behind a Settings workspace so the primary navigation stays focused.
- Session selection can use a `session` query parameter, allowing the global sidebar to control the Chat page without introducing a shared store.
- Browser verification confirmed the Chat rail has the new-chat and Settings entries but no legacy-panel navigation; Settings exposes providers, session management, and memory entries.

## Chat parity foundations

- The existing `/api/pi/session-preview` endpoint deliberately limits output to 20 truncated messages, so it cannot restore a chat conversation.
- The global sidebar discarded `ProjectGroup` metadata by flattening all sessions; it must retain groups to display directory boundaries.
- Pi runs in a child process, so an explicit active-run registry is needed to support a safe Stop button from the browser.
- Real browser verification: selecting `web-b7e1fc81-92f3-483b-b210-2b222e96a6ae` rendered both persisted turns; the `pi-web-switch` project group was visible and the idle Stop control was disabled.
- The session overflow button now stops event propagation and reveals Copy ID and Open Session Management actions; browser verification confirmed both items are visible.
- The existing session DELETE endpoint moves JSONL files to the recoverable trash; the overflow menu now uses that endpoint only after a confirmation prompt.
- A representative “拉取最新代码” session has 69 tool rows and 19 text rows; grouping tool rows is essential to make its 94-entry history scannable.

## Issues Encountered

| Issue | Resolution |
|-------|------------|
| None yet | — |

## Resources

- `server/pi-reader.ts`
- `vite.config.ts`
- `src/components/dashboard/DashboardPage.tsx`
- `src/components/sessions/SessionsPage.tsx`

## Visual/Browser Findings

- No visual inspection required yet.

## Pi CLI settings parity

- User requires the settings shown by Pi's interactive `/settings` command to be editable from the web panel.
- The implementation must follow the active local Pi `0.84.4` package rather than inventing unrelated preferences.
- Existing web settings already cover theme and some defaults; the new panel should map the remaining CLI settings to their exact persisted keys and preserve unknown fields.
- Pi `0.84.4` exposes settings for compaction; image display/resize/blocking; skill commands; editor/terminal layout; message steering/follow-up delivery; provider transport and HTTP idle timeout; thinking visibility; Mermaid rendering; cache/changelog/startup/telemetry notices; project trust; escape/tree behavior; warning controls; per-model thinking overrides; TUI/fullscreen behavior; and theme.
- Exact nested keys include `compaction.enabled`, `terminal.showImages`, `terminal.imageWidthCells`, `terminal.clearOnShrink`, `terminal.showTerminalProgress`, `images.autoResize`, `images.blockImages`, `markdown.mermaid`, and `warnings.anthropicExtraUsage`.
- Pi uses `defaultProjectTrust: "ask" | "always" | "never"`; the existing web selector's `"prompt"` fallback is not a valid current Pi value and should be corrected while adding parity.
- HTTP idle timeout choices are 30 seconds, 1 minute, 2 minutes, 5 minutes, and disabled (`0`).
- The web store previously shallow-merged settings; updating one nested terminal/image/warning value could therefore erase its siblings before writing the complete JSON document. `mergePiSettings` now preserves all known nested groups, including nested retry-provider fields.
- The initial per-model picker exposed more than one thousand catalog models at once. A search-first picker now limits the rendered list to 80 matching/pinned models while retaining existing overrides.
- Browser persistence verification changed `terminal.showImages`, confirmed `terminal.showTerminalProgress` remained intact, then restored the exact original settings document. The final settings page has no browser console warnings or errors.

## Key failover (Phase 15)

- Terminal requests go through the Pi model runtime, so the extension's provider stream wrapper covers real CLI model calls. (The Web Chat module was removed on 2026-09-07.)
- `composeModelProvider` (provider-composer.js:305): legacy `registerProvider(id, { api, streamSimple })` WITHOUT models/baseUrl/apiKey intercepts every model whose `model.api === extension.api`; models.json config/models/auth stay authoritative. Validation only requires `api` when `streamSimple` is set.
- Stream errors arrive as `{type:"error", reason, error: AssistantMessage}` events (stopReason/errorMessage), NOT thrown to the consumer; sync throws (e.g. missing apiKey) happen at call time. Abort → reason "aborted".
- `getApiProvider(model.api).streamSimple(model, context, {...options, apiKey})` from `@earendil-works/pi-ai/compat` is the exact fallback the composer itself uses; `lazyStream`/`createAssistantMessageEventStream` export from pi-ai root. `getAgentDir()/getModelsPath()/getSessionsDir()` export from pi-coding-agent root and respect `PI_CODING_AGENT_DIR`.
- model-runtime passes `options.apiKey` (resolved auth) into streamSimple — per-attempt key override works via options.
- Config value semantics (documented): `!cmd` shell command; `$VAR`/`${VAR}` env; `$$`/`$!` literals. `resolveConfigValue` is NOT exported from package root; pi-web-switch re-implements the documented non-command semantics and treats `!command` pool keys as ineligible (no new shell path).
- `pi-web-switch` is NOT in the user's global `packages` settings — terminal coverage requires `pi install` (or `-e` for testing). The Web Chat module was removed on 2026-09-07.
- Event types: start, text_*/thinking_*/toolcall_*, done, error. Only "start" carries no content → retry allowed until any other event is yielded; buffered-prefix strategy gives exactly-once delivery.
- On exhaustion, propagate the LAST original error event unchanged so pi's native retry-with-backoff semantics stay intact.
- State file `pi-web-switch-key-state.json` in agent dir: provider→keyId→{status,until,reason}; key ids only (sha256-derived for hand-edited entries), never raw keys.
