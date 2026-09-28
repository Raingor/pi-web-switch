# Progress Log

## Session: 2026-09-23

### Phase 9: Remove the Web Chat module

- **Status:** complete
- Removed the local-pi Web Chat feature cleanly, keeping all unrelated features intact.

#### Deleted
- `src/components/chat/` (ChatPage.tsx, TaskSidebar.tsx, task-list.ts, task-list.test.ts)
- `src/types/chat.ts`
- `src/hooks/useSessionUsage.ts` (Chat-only, unused)
- `server/web-chat.test.ts`

#### Edited
- `src/App.tsx`: removed `ChatPage` lazy import + `/chat` route.
- `src/components/layout/BasicSidebar.tsx`: removed Chat nav item, renumbered codes `01…09`, dropped unused `MessageSquare` import.
- `src/components/layout/AppShell.tsx`: removed `/chat` full-height branch and unused `useLocation`.
- `src/components/sessions/SessionsPage.tsx`: removed "Continue in Chat" link and unused `Link` import.
- `vite.config.ts`: removed `chat/active`, `POST chat`, `chat/stop`, `chat/select-directory`, `sessions/trash-batch`, `session-usage`, `session-history`, `session-message` endpoints.
- `server/pi-reader.ts`: removed `runWebChat`, `stopWebChat`, `listActiveWebChats`, `chooseChatDirectory`, `activeWebChats`, `WebChat*` interfaces, `trashSessions`/`TrashSessionsResult`, `readSessionHistory`, `readSessionUsage`/`SessionUsageSummary`, `lookupContextWindow`, `findSessionById`, `updateSessionUserMessage`; updated the session-cache comment.
- `src/index.css`: stripped all `.codex-*` and `.app-main-full` rules via a PostCSS AST pass (280 rules touched, 2 empty `@media` removed).
- `src/lib/translations/{en,zh-CN,zh-TW,ja}.ts`: removed all `chat.*` keys and `nav.chat` (55 keys each).

#### Kept (verified in use, unrelated to Chat)
- `trashSessionFile`, `/api/pi/trash`, `/api/pi/session/trash`, `auto-trash`, `restoreFromTrash`.
- `readSessionPreview` + `/api/pi/session-preview`.
- Session metadata mtime+size cache in `pi-reader.ts`.
- `agnes-chat`/`chatAgnes`, `chatgpt-usage-range`, `codex-usage-status`.

#### Verification
- `tsc --noEmit`: no errors.
- `npm test -- --run`: 6 files, 101/101 passing.
- `npm run build`: succeeds; no `ChatPage` chunk; `main` 448 kB → 436 kB; CSS 152 kB → ~96 kB.
- `git diff --check`: clean.
- Repo-wide scan: no Chat feature symbols remain (only unrelated `codex-usage`/`chatgpt`/`agnes-chat`/`relay/chat` matches).

---

## Earlier sessions (context)

Phases 1–8 restored and enhanced the Web Chat module (local-pi SSE calling,
model picker, task list, batch/project session trash) and added four performance
optimizations: session metadata cache, task-sidebar component split + `MessageText`
memoization, remove-dialog accessibility, and route-level lazy loading. The
session cache and route lazy loading are general improvements and remain; the
Chat-specific parts were removed in Phase 9 above.
