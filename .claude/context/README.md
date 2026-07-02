# Project Memory & Synchronization System

Lightweight, in-repo state so every Claude Code session starts _aware_ — of project
state, active branches, risks, decisions, and rules — without manual copy-paste
between chats. State files are short and skimmable on purpose; they cost little context.
No secrets ever live here. No command here commits, pushes, merges, rebases, or deletes.

Design rationale: `docs/PROJECT_MEMORY_SYSTEM.md`.

## The files (this folder)

| File                    | Role                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------- |
| `STATE.md`              | Snapshot: focus, active branches, pending queue, top risks, pointers. **Start here.** |
| `LEDGER.md`             | Append-only log of what changed, newest last. Rotate into `archive/` when long.       |
| `BRANCHES.md`           | Active branch registry — purpose, base, status, files touched.                        |
| `DECISIONS.md`          | Mini-ADRs: locked decisions + why.                                                    |
| `RISKS.md`              | Known footguns to check before touching related code.                                 |
| `RULES.md`              | Session invariants (imported by `CLAUDE.md`).                                         |
| `handoffs/<feature>.md` | Per-feature deep-dive briefs.                                                         |
| `archive/`              | Rotated-out ledger history.                                                           |

## The 4 commands (`.claude/commands/`)

- **`/preflight`** — read-only gate. Reads state + risks, checks git divergence vs
  `origin/main` and branch overlap, reports, and **stops for your go-ahead**. Run
  before writing any code.
- **`/start-task <feature>`** — loads state + the feature handoff, then runs `/preflight`.
- **`/update-ledger`** — after finishing work: appends to `LEDGER.md`, updates
  `STATE.md` / `BRANCHES.md`, records any new decision/risk. Shows a diff; never commits.
- **`/handoff <feature>`** — appends a results section to the feature handoff, mirrors
  highlights into `STATE.md`, then runs `/update-ledger`.

## Session protocol

1. Read `STATE.md`.
2. Honor `RULES.md` (imported via `CLAUDE.md`).
3. Skim your branch row in `BRANCHES.md` and the tail of `LEDGER.md`.
4. If a handoff exists, read `handoffs/<feature>.md`.
5. Run `/preflight` and get the user's go-ahead **before** writing code.
6. After finishing, run `/update-ledger`.
