# Task Plan: Remove the Web Chat module

## Goal

Remove the local-pi Web Chat feature from pi-web-switch cleanly: delete the
Chat UI, its route and nav entry, all Chat-only server endpoints and functions,
the Chat-only CSS, and the four-language Chat labels — without touching Sessions,
trash/restore, usage, Jev, or any other unrelated feature.

## Current Phase

Phase 9 — Remove Chat module (complete)

## Scope

### Deleted files
- `src/components/chat/` (ChatPage.tsx, TaskSidebar.tsx, task-list.ts, task-list.test.ts)
- `src/types/chat.ts`
- `src/hooks/useSessionUsage.ts` (Chat-only, unused elsewhere)
- `server/web-chat.test.ts`

### Edited files
- `src/App.tsx` — dropped the `ChatPage` lazy import and `/chat` route.
- `src/components/layout/BasicSidebar.tsx` — removed the Chat nav item, renumbered nav codes, dropped the now-unused `MessageSquare` import.
- `src/components/layout/AppShell.tsx` — removed the `/chat` full-height branch and the now-unused `useLocation` import.
- `src/components/sessions/SessionsPage.tsx` — removed the "Continue in Chat" preview link and the now-unused `Link` import.
- `vite.config.ts` — removed `GET /api/pi/chat/active`, `POST /api/pi/chat`, `POST /api/pi/chat/stop`, `POST /api/pi/chat/select-directory`, `POST /api/pi/sessions/trash-batch`, `GET /api/pi/session-usage`, `GET /api/pi/session-history`, `POST /api/pi/session-message`.
- `server/pi-reader.ts` — removed `runWebChat`, `stopWebChat`, `listActiveWebChats`, `chooseChatDirectory`, `activeWebChats`, the `WebChat*` interfaces, `trashSessions`/`TrashSessionsResult`, `readSessionHistory`, `readSessionUsage`/`SessionUsageSummary`, `lookupContextWindow`, `findSessionById`, and `updateSessionUserMessage`.
- `src/index.css` — removed every `.codex-*` rule and `.app-main-full` via a PostCSS AST pass (mixed selectors kept their non-Chat parts; emptied `@media` blocks removed).
- `src/lib/translations/{en,zh-CN,zh-TW,ja}.ts` — removed all `chat.*` keys and `nav.chat`.

### Kept (shared / unrelated — verified in use)
- `trashSessionFile`, `/api/pi/trash`, `/api/pi/session/trash`, `auto-trash`, `restoreFromTrash` (Sessions trash tab).
- `readSessionPreview` + `GET /api/pi/session-preview` (Sessions preview).
- The mtime+size session metadata cache in `pi-reader.ts` (general `listSessions` optimization).
- `agnes-chat`/`chatAgnes`, `chatgpt-usage-range`, `codex-usage-status`, OpenAI `chat/completions` label — unrelated to the Web Chat module.

## Verification

- `npx tsc --noEmit` — no errors.
- `npm test -- --run` — 6 files, 101/101 passing (Chat's 6 tests removed with the feature).
- `npm run build` — succeeds; no `ChatPage` chunk; `main` chunk 448 kB → 436 kB; CSS 152 kB → ~96 kB.
- `git diff --check` — clean.
- Repository-wide scan — no `web-chat`, `runWebChat`, `WebChat`, `ChatPage`, `TaskSidebar`, `codex-`, `nav.chat`, `trash-batch`, or `/api/pi/chat` references remain (only unrelated `codex-usage`/`chatgpt`/`agnes-chat` matches).

## Notes

Earlier phases (1–8) restored and enhanced Web Chat and applied four performance
optimizations (session cache, sidebar split + memo, dialog a11y, route lazy
loading). The session metadata cache and route lazy loading are general wins and
stay; the Chat-specific work was removed as part of this phase.
