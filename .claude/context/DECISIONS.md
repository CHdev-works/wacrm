# Architecture Decisions

_Mini-ADR: decision · why · date. Append new locked decisions; don't rewrite history._

## Account-level RLS for the shared inbox · 2026-07-02

RLS scopes rows to the **account**, not the individual agent. `assigned_agent_id` is a
UI/routing **preference**, not an RLS boundary — every agent in an account can see the
account's conversations. **Why:** it's a shared team inbox; per-agent RLS would hide
threads teammates need and complicate hand-offs.

## Reuse shared `conversations.unread_count` · 2026-07-02

Unread state lives on `conversations.unread_count`, shared across the account — no
per-user unread table. **Why:** keeps the shared-inbox model simple and consistent with
account-level RLS. See [[RISKS.md]] — this count is shared, not per-user.

## Planned centralized permission gate · 2026-07-02

Future per-module / per-agent access control will sit behind **one** centralized gate
rather than scattered checks. **Why:** single choke point is auditable and avoids
drift. Not yet built — design before adding ad-hoc permission checks.
