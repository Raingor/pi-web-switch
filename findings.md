# Findings & Decisions

## Requirements

- Transform pi-web-switch to call the local `pi` CLI from the browser (Web Chat module).
- The settings/worksheet content can reference this project's existing structures.

## Research Findings

- The Web Chat + local-pi calling feature WAS previously built (commits `1c0c040` … `a2480cd`) and was REMOVED in commit `381a2da` ("feat: add key failover and native usage menubar"). The latest complete, working version is at `a2480cd`.
- `main` HEAD is `3f8ea11`, which descends from `381a2da` (feature removed). The reverted implementation lives in history, not the working tree.
- Local pi binary resolution: `PI_BINARY` env → PATH → `~/.local/share/pi-node/<version>/bin/pi` → `~/.pi/bin/pi` → standard global bins.
- pi's `--mode json --print --session-id <id>` streams NDJSON events: `tool_execution_start/end`, `message_update` (with `assistantMessageEvent` of types `thinking_start/delta/end`, `toolcall_start/delta/end`, `text_start/delta/end`). The UI consumes these via SSE.
- Active-run registry (`activeWebChats` Map) is required so the browser Stop button can SIGTERM an in-flight pi child process safely.
- macOS folder picker via `osascript choose folder` for explicit chat workspace selection (returns POSIX path).

## Technical Decisions

| Decision | Rationale |
|----------|-----------|
| Re-implement `runWebChat`/`stopWebCharts`/`chooseChatDirectory` in `server/pi-reader.ts` | This is the canonical, tested implementation of "calling local pi"; restoring it directly satisfies the user's request with lowest risk. |
| Add SSE endpoints `POST /api/pi/chat`, `POST /api/pi/chat/stop`, `GET /api/pi/chat/active`, `POST /api/pi/chat/select-directory` in `vite.config.ts` | Matches the reverted endpoint contract; ChatPage SSE consumer is compatible. |
| Restore `src/components/chat/ChatPage.tsx` + `src/types/chat.ts` + `/chat` route + sidebar nav entry | Provides the browser UI to invoke and observe local pi. |
| Reuse `resolvePiBinary` candidate list and NDJSON event handling from `a2480cd` | Already validated against real pi `--mode json` output. |

## Issues Encountered

| Issue | Resolution |
|-------|------------|
| Chat feature removed in `381a2da` | Re-introduce from the last intact commit `a2480cd` (working tree is on `3f8ea11`). |

## Reopening findings

- The current working tree included the prior local-pi backend, SSE API, Chat CSS and `src/types/chat.ts`, but did not include `ChatPage.tsx`, `/chat` routing, sidebar entry or Chat translations. The previous plan recorded an earlier restored UI, but the on-disk state differed; current source was used as the authority.
- `a2480cd:src/components/chat/ChatPage.tsx` is the complete historical page. Existing sessions are grouped by project and `pi --session-id` must be run from that session's original project path to avoid forking conversation state.
- A second request for an active session used to replace the stop handle in `activeWebChats`; it now returns an error instead. Streaming EOF without `done`/`error` is treated as a connection error.
- Existing Jev-related and other unrelated changes in the working tree were preserved.

## Model picker jitter (2026-09-23)

- Screenshot showed the two-column Chat model menu flickering when hovering providers. The menu is bottom-anchored and previously had only `max-height`, so its actual height depended on the right column's model count. Hovering a provider changed that count, moving the menu's top edge and the provider under the cursor; repeated mouseenter events caused the jump.
- Set a stable height for the menu while retaining independent vertical scrolling of both columns. The viewport-based cap leaves space for the mobile command bar. Chrome screenshots confirmed identical menu bounds for providers with one versus many models.

## Resources

- `server/pi-reader.ts` (add `runWebChat`, `stopWebChat`, `chooseChatDirectory`, `listActiveWebChats`, `resolvePiBinary`)
- `vite.config.ts` (add chat SSE endpoints)
- `src/components/chat/ChatPage.tsx` (restored)
- `src/types/chat.ts` (restored)
- `src/App.tsx` + `src/components/layout/BasicSidebar.tsx` (routing + nav)
- `src/lib/translations/{en,zh-CN,zh-TW,ja}.ts` (nav.chat label)
