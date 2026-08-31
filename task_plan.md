# Task Plan: Usage-range audit and Web Pi Chat

## Goal

Verify and correct the usage-statistics date-range calculations, then build a branch-scoped Web Chat module that runs local pi and supports switching sessions.

## Current Phase

Phase 5 — Verification and delivery

## Phases

### Phase 1: Audit current behavior

- [x] Trace the 7-day, 30-day, and custom-range date-boundary calculations.
- [x] Identify the existing session and pi execution APIs that can power Web Chat.
- [x] Record findings and constraints.
- **Status:** complete

### Phase 2: Branch and architecture

- [ ] Create the `codex/web-pi-chat` branch without discarding current worktree changes.
- [ ] Define server routes, session persistence, and Chat UI integration.
- [ ] Decide how to stream pi output and safely stop active runs.
- **Status:** complete

### Phase 3: Usage statistics correction

- [x] Correct the date-window calculation for China-time calendar days.
- [ ] Add focused calendar-boundary unit tests (follow-up).
- **Status:** complete

### Phase 4: Web Chat implementation

- [x] Add a server-side local pi chat endpoint.
- [x] Add a Web Chat page with session list, new-session action, and session switching.
- [x] Add navigation and translations.
- **Status:** complete

### Phase 5: Verification and delivery

- [x] Run unit tests and production build.
- [x] Document outcomes and remaining limitations.
- **Status:** complete

### Phase 6: Real-session validation and session titles

- [x] Identify why the Web Chat list falls back to unnamed sessions.
- [x] Extract a concise title from the first user message and add a stable fallback label.
- [x] Run an actual local Pi request and verify its session appears with a title.
- [x] Verify browser rendering of the session title.
- **Status:** complete

### Phase 7: Codex-style workspace navigation

- [x] Define a chat-first navigation model that keeps legacy routes available.
- [x] Replace the global sidebar with conversation navigation and a Settings entry.
- [x] Build a Settings workspace containing all existing control panels.
- [x] Make the Chat page respond to sidebar session selection.
- [x] Validate desktop rendering, then run tests and build.
- **Status:** complete

### Phase 8: Chat parity foundations

- [x] Diagnose missing session-history loading and flattened project grouping.
- [x] Add a validated full session-history API and hydrate Chat on selection.
- [x] Group the conversation rail by project directory with expand/collapse.
- [x] Add client-visible generation state and a stop control.
- [x] Verify with a real persisted session, browser flow, tests, and build.
- **Status:** complete

### Phase 9: Conversation menu

- [x] Wire the visual three-dot control to a real menu without changing the selected chat.
- [x] Verify menu actions and production build.
- **Status:** complete

### Phase 10: Recoverable session deletion

- [x] Add a confirmed Move to Trash action to the conversation menu.
- [x] Verify the action is exposed without deleting a user session, then build and test.
- **Status:** complete

### Phase 11: History readability

- [x] Identify tool-call rows as the source of noisy historical rendering.
- [x] Collapse consecutive tool rows and add lightweight Markdown reading styles.
- [x] Validate against a real tool-heavy session, then build and test.
- **Status:** complete

### Phase 12: Focused chat background

- [x] Remove the application grid from the full-height Chat workspace.
- **Status:** complete

### Phase 13: Stable project ordering

- [x] Replace activity-based project-group sorting with stable folder ordering.
- **Status:** complete

## Key Questions

1. Do current 7-day/30-day ranges include today and use calendar days rather than rolling 24-hour windows?
2. Can the existing local pi CLI/session format be reused safely for browser-originated chats?
3. Which local transport gives responsive streaming without disrupting Vite HMR?

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| Use a dedicated `codex/web-pi-chat` branch | Keeps the new chat feature isolated while preserving current uncommitted work. |
| Treat all date ranges as China-time calendar dates | Existing usage parser already buckets records in UTC+8. |

## Errors Encountered

| Error | Attempt | Resolution |
|-------|---------|------------|
| None yet | 1 | — |
