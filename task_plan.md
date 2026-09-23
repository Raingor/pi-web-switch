# Task Plan: Call local pi (Web Chat)

## Goal

Transform pi-web-switch so it calls the local `pi` CLI from the browser — a Web Chat module that spawns `pi --mode json --print --session-id` as a child process, streams structured NDJSON events to the UI as SSE, supports session switching, and can stop in-flight runs. Settings content follows pi-web-switch's existing config structures.

## Current Phase

Phase 6 — Stabilize model picker (complete)

## Phases

### Phase 1: Requirements & Discovery
- [x] Understand the prior Web Chat feature and why it was removed (`381a2da`).
- [x] Record findings.
- **Status:** complete

### Phase 2: Restore server-side local-pi invocation
- [x] Add `runWebChat`, `stopWebChat`, `chooseChatDirectory`, `listActiveWebChats` + interfaces to `server/pi-reader.ts` (`resolvePiBinary` already present).
- [x] Add chat SSE endpoints to `vite.config.ts` (`GET /api/pi/chat/active`, `POST /api/pi/chat`, `POST /api/pi/chat/stop`, `POST /api/pi/chat/select-directory`).
- [x] Verify build typecheck.
- **Status:** complete

### Phase 3: Restore client-side Chat UI
- [x] Restore `src/types/chat.ts`.
- [x] Restore `src/components/chat/ChatPage.tsx`.
- [x] Wire `/chat` route in `src/App.tsx` and nav entry in `BasicSidebar`.
- [x] Add `nav.chat` translation keys (en/zh-CN/zh-TW/ja).
- **Status:** complete

### Phase 4: Verification
- [x] Run `npx tsc --noEmit`, `npx vitest run`, `npx vite build`.
- [x] End-to-end smoke test against local pi 0.87.0 (SSE deltas + done + session persist).
- **Status:** complete

### Phase 5: Reopen Chat and improve reliability
- [x] Reconcile the current working tree against historical commit `a2480cd` (the API, styles and types were present; `ChatPage.tsx` and route/nav were missing).
- [x] Restore the original Chat UI without reverting unrelated local Jev or server changes.
- [x] Re-enable full-height `/chat`, four-language labels and a Sessions preview link to continue existing sessions.
- [x] Add New chat action; use pi's default model when a remembered model is unavailable; report broken streams instead of silently finishing.
- [x] Pin resumed sessions to their original workspace and reject concurrent runs of the same session.
- [x] Verify with fake-pi regression tests, full test suite, build and HTTP smoke test.
- **Status:** complete

### Phase 6: Stabilize model picker
- [x] Inspect screenshot and reproduce the model menu with providers of differing model counts.
- [x] Stop the bottom-anchored menu from changing height when the hovered provider changes; constrain height on short viewports and keep each column scrollable.
- [x] Verify fixed menu bounds in Chrome across provider changes, then run tests/build/diff check.
- **Status:** complete

## Key Questions

1. Should the Chat workspace use the full Codex-style mode toggle? — Kept simple: a standalone `/chat` route + nav entry, fitting the current `main` AppShell.

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| Restore from `a2480cd` commit | Last clean, tested version of the local-pi calling feature. |
| Standalone `/chat` route (no ui-mode toggle) | Fits current `main` AppShell/BasicSidebar without forcing the reverted Codex redesign. |

## Errors Encountered

| Error | Attempt | Resolution |
|-------|---------|------------|
| `timeout` not available on macOSBSD tool | 1 | Dropped the `timeout` wrapper; pi completes within its lifecycle. |
