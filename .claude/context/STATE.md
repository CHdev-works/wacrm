# Project State — wacrm

_Last updated: 2026-07-02 by session (memory-system bootstrap)_

## Current focus

Standing up the Project Memory & Synchronization System. No feature work in flight.

## Active branches

- `main` — production. Working tree clean except untracked docs (`NOTIFICATIONS_HANDOFF.md`, `docs/PROJECT_MEMORY_SYSTEM.md`) and this new `.claude/` tree.
- `feat/inbound-notifications` — Phases A+B done, C scaffolded. Work already merged to `main` via `641852c`; branch is now **0 ahead / 3 behind** `main`. Safe to prune after confirming.
- `feat/clickable-links` — **merged (== main)**, 0 ahead / 0 behind. Safe to prune.

## Pending queue (priority order)

1. Finish/verify inbound-notifications Phase C → `handoffs/inbound-notifications.md`
2. Prune merged branches (`feat/clickable-links`, `feat/inbound-notifications`) — user action.

## Top risks right now

- Webhook path runs on the service-role admin client and **bypasses RLS** (see RISKS.md).

## Pointers

LEDGER.md · BRANCHES.md · DECISIONS.md · RISKS.md · RULES.md · README.md · handoffs/
Design rationale: `docs/PROJECT_MEMORY_SYSTEM.md`
