# Mirrai UI Handoff

This note is for a future Antigravity/front-end pass. The current source tree is a Google Drive sync copy; run and verify from `F:/Code/Mirrai` after syncing with `scripts/sync-local-worktree.ps1`.

## Product Shape

Mirrai is no longer just a chat demo. Treat it as a role social runtime dashboard:

- Chat surface for the persona conversation.
- Runtime diagnostics for planner, hidden reflection, memory recall, source recall, schedule state, temporary life state, and LLM usage.
- Settings for QQ, voice, stickers, proactive messages, model routing, and local/Neon database setup.

The design should be quiet, operational, and readable. Avoid marketing hero layouts inside the app. The user needs to scan state and diagnose behavior quickly.

## Main Routes And Files

- Main chat route: `client/src/pages/Chat.tsx`
- Runtime diagnostics drawer: `client/src/components/PersonaStatePanel.tsx`
- Settings route: `client/src/pages/Settings.tsx`
- Lobby/home after login: `client/src/pages/Lobby.tsx`
- Shared tokens/styles: `client/src/index.css`
- Runtime state API: `server/routers.ts`, `persona.getRuntimeState`
- LLM usage runtime recorder: `server/llm/usage.ts`

## Diagnostics Drawer Requirements

The diagnostics drawer should keep these sections visible and readable:

- Summary cards: current life state, turn intent, active memory count, estimated LLM usage today.
- Current turn: platform, input preview, reply preview, memory/source recall flags, turn risks.
- Life state: schedule segment, reply availability, temporary state if any.
- Hidden reflection: intent, memory recall decision, memory write decision, inner reaction, reply strategy.
- Source library and long-term memory stats.
- LLM usage: calls, estimated input/output tokens, duration, provider/model/purpose buckets, recent calls.
- Backend architecture links/paths.

Do not replace this with vague “inner world” copy. The drawer is a debug tool first.

## Visual Direction

- Use neutral light surfaces, clear borders, compact spacing, and high-contrast text.
- Avoid large black blocks, low-contrast dark chips, oversized decorative cards, gradient orbs, and text-heavy buttons when an icon is enough.
- Keep cards flat and shallow. Use cards only for grouped diagnostics, not nested decorative layouts.
- On mobile, the drawer should occupy most of the viewport and keep text wrapping cleanly.

## Current Verification

As of this pass:

- `corepack pnpm run check` passes from `F:/Code/Mirrai`.
- Focused tests pass for DeepSeek routing, persona turn planning, persona text chat, and reply cleanup.
- `http://localhost:3000/chat/1` opens with the local database.
- The diagnostics drawer renders and shows runtime data, including LLM usage estimates.

## Do Not Break

- Do not run or install dependencies in the Google Drive source tree.
- Do not move local `.env`, `node_modules`, local PostgreSQL data, voice outputs, or Playwright temp files into Google Drive.
- Do not remove the diagnostics data fields unless the server contract is updated at the same time.
- Keep QQ as the primary social platform path for now; WeChat is retained but not the active focus.
