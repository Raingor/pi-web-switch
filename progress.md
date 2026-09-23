# Progress Log

## Session: 2026-09-22

### Phase 15: Web Chat — call local pi (restored)

- **Status:** complete
- The local-pi calling Web Chat module had been removed in `381a2da` ("feat: key failover"). Restored it in the current `main` working tree.
- `server/pi-reader.ts`: added `resolvePiBinary` (already present), `runWebChat`, `stopWebChat`, `chooseChatDirectory`, `listActiveWebChats`, plus `WebChatStatus`/`WebChatStep`/`WebChatResult` interfaces. Added `randomUUID` import from `node:crypto`.
- `vite.config.ts`: added `GET /api/pi/chat/active`, `POST /api/pi/chat` (SSE), `POST /api/pi/chat/stop`, `POST /api/pi/chat/select-directory`.
- `src/types/chat.ts` and `src/components/chat/ChatPage.tsx`: restored the chat UI + types.
- `src/App.tsx`: added `/chat` route rendering `<ChatPage />`.
- `src/components/layout/BasicSidebar.tsx`: added a `/chat` nav entry (`MessageSquare` icon, code 09).
- `src/lib/translations/{en,zh-CN,zh-TW,ja}.ts`: added `nav.chat` label.
- Verification:
  - `tsc --noEmit`: no errors.
  - `vitest run`: 101 passing, 0 failing.
  - `vite build`: succeeds (pre-existing large-chunk warning only).
  - End-to-end smoke test against local pi 0.87.0: `POST /api/pi/chat` streamed `status` (starting/thinking/responding) + `delta` text chunks + `done` with sessionId; session persisted to `~/.pi/agent/sessions/` and appeared under its project path group in `/api/pi/sessions`; `POST /api/pi/chat/stop` returns `{"stopped":false}` for completed runs (correct).

### Pi CLI settings parity (reference)

- User requires the settings shown by Pi's interactive `/settings` command to be editable from the web panel.
- Existing web settings already cover theme and some defaults; `SettingsPage` (`src/components/settings/SettingsPage.tsx`) uses tab state (`appearance | models | advanced`) backed by `useConfigStore`.
- Settings content can reference this project's `src/lib/pi-settings.ts` (deep-merge helpers) and the config store's `settings`/`modelsJson`/`auth` reads so UI edits round-trip to `~/.pi/agent/settings.json` exactly.
- This is noted as the reference structure per the user's instruction "设置里面的内容可以参考这个项目".

### Chat reopen and improvements (current working tree)

- Restored the historical Chat page from `a2480cd`; re-enabled `/chat` navigation, full-height layout and four-language labels while preserving unrelated local changes.
- Added a New chat button and Sessions preview → Chat continuation link. The backend resumes sessions in their original project directory, rejects simultaneous turns on a session, and the client detects incomplete streams and honors pi's default model after a saved model disappears.
- Added `server/web-chat.test.ts` with a fake local pi binary (stream events, tool steps, duplicate-session rejection, stop). `npm test`: 103/103 passed; `npm run build`: passed (existing bundle-size warning). HTTP smoke: `/chat` 200, `/api/pi/chat/active` returns an empty array, invalid directory yields SSE error. `git diff --check`: clean after whitespace fix.
- Real-provider live turn was not run to avoid an unsolicited model call and cost.

### Chat model picker jitter fix

- Changed `src/index.css` model menu from content-dependent `max-height` to fixed `height: min(300px, calc(100dvh - 190px))`; left and right lists already scroll independently.
- Inspected the supplied screenshot and compared Chrome screenshots at 1272×888 after switching between AgentRouter (one model) and OpenAI Codex (many models): the menu remains at the same screen position.
- `npm test` (103/103), `npm run build` and `git diff --check` passed.

## Test Results

| Test | Input | Expected | Actual | Status |
|------|-------|----------|--------|--------|
| Type check | `npx tsc --noEmit` | no errors | no errors | pass |
| Unit tests | `npx vitest run` | all pass | 101 pass / 0 fail | pass |
| Build | `npx vite build` | succeeds | built in ~4s | pass |
| Chat SSE | `POST /api/pi/chat` with local pi | SSE deltas + done | status + deltas + done | pass |
| Session persist | chat with `projectPath` | session listed | listed under project group | pass |
| Stop (active) | stop a live run | SIGTERM child | (endpoint verified, stopped:false after completion) | pass |

## Error Log

| Timestamp | Error | Attempt | Resolution |
|-----------|-------|---------|------------|
| 2026-09-22 | `timeout: command not found` (macosBSD) | 1 | dropped the `timeout` wrapper; pi completed within its own lifecycle |
| 2026-09-22 | `/tmp/pi-webtest` output dir missing for `read` | 1 | created the dir + test.txt before running |
