# Project Memory & Synchronization System — Design & Rollout Plan

> Planning document for **wacrm** (Next.js 16 · React 19 · Supabase · TypeScript · Vitest).
> Goal: make every Claude Code session start *aware* — of project state, active
> branches, done/pending work, risks, decisions, and rules — and keep that state
> in sync automatically, without manual copy-paste between chats.
>
> **Operating split:** Claude **Cowork** plans and writes hand-off briefs; Claude
> **Code** implements, but only after a preflight, and it updates the ledger when done.
>
> The system is deliberately **lightweight**. State files are short and skimmable so
> they cost little context. No secrets ever live in these files. No automation may
> silently commit, push, merge, rewrite branches, or delete files.

---

## 1. Problem summary

Claude Code sessions are stateless. Each new session starts with no memory of prior
chats, branches, or yesterday's work. As wacrm has grown to multiple concurrent
features (`feat/inbound-notifications`, `feat/clickable-links`, …), fixes, and
architecture decisions (account-level RLS shared inbox, a planned centralized
permission gate), that isolation now creates real risk:

- **Rework and drift** — a session re-derives context that was already settled, or
  re-litigates a locked decision, wasting time and sometimes contradicting itself.
- **Blind conflicts** — a session edits files another active branch already touches,
  or works off a branch that is behind `main`, and no one notices until merge.
- **Lost thread** — "what's done vs pending" lives only in a human's head or in
  scattered chat logs; nothing in the repo answers "where are we?"
- **Manual sync tax** — keeping sessions aligned means copy-pasting status between
  chats, which is tedious and quickly goes stale.

The fix is a small, repo-native "project ledger": a handful of concise files that are
the single source of truth, plus commands that force every session to **read state
first, preflight before coding, and write state back after**.

---

## 2. Recommended operating model

Treat the repo itself as shared memory. Two roles, one source of truth.

**Cowork = planner / architect.** Produces hand-off briefs, records locked decisions,
frames scope. Writes into `.claude/context/handoffs/` and seeds `DECISIONS.md`.

**Claude Code = implementer.** On every session it runs the loop:

1. **Bootstrap-read** — load `STATE.md` (the hub) + `RULES.md` (invariants) first.
2. **Preflight** — inspect branch, diff against `main`, check for overlap/conflict
   with other active branches, surface a written risk report, and **wait for a
   go-ahead**. No code before this passes.
3. **Implement** — code the task, honoring the rules and the relevant hand-off brief.
4. **Update ledger** — append what happened, update `STATE.md` / `BRANCHES.md`, record
   any new decision or risk.
5. **Hand off** (optional) — write results back so Cowork can plan the next step.

The invariant: **state is read at the start and written at the end of every session.**
Humans approve anything that mutates git. Everything the automation does on its own is
read-only or additive to Markdown.

---

## 3. Required project memory files

All under `.claude/context/`. Each is short by design — think "index card," not "wiki."

| File | Role | Size target |
|---|---|---|
| `STATE.md` | **The hub.** Live snapshot: current focus, active branches (1 line each), pending queue, top risks, pointers to everything else. Read first, every session. | ≤ 1 screen |
| `LEDGER.md` | Append-only history of completed work: date · branch · summary · PR/commit. Sessions read only the tail. | tail-read |
| `BRANCHES.md` | Active-branch registry: purpose, base, status, files/areas touched, known overlaps. Powers conflict checks. | ≤ 1 screen |
| `DECISIONS.md` | Locked architecture decisions (mini-ADR): decision · why · date. Prevents re-litigation. | grows slowly |
| `RISKS.md` | Known footguns and gotchas with a one-line "so what." | ≤ 1 screen |
| `RULES.md` | Hard invariants every session must honor (security, checks, branch naming). Imperative, terse. | ≤ 1 screen |
| `handoffs/<feature>.md` | Per-feature briefs (mission, decisions, findings, what's left, acceptance, out-of-scope). Big context lives here, **not** in always-loaded files. | per feature |
| `README.md` | How the system works and how to use the commands. | reference |
| `archive/` | Rotated old `LEDGER.md` entries so the live ledger stays small. | as needed |

Why the split matters: only `STATE.md` + `RULES.md` are **always** loaded. Everything
else is **read on demand** (a handoff when starting that feature; `RISKS.md` during
preflight; the ledger tail when updating). That keeps the standing context cost tiny
while still making the full history reachable.

---

## 4. Purpose of each file

**`STATE.md` — the single thing you must read.** A dashboard: what we're working on
right now, which branches are live and their one-line status, the pending queue in
priority order, the 3–5 risks that matter today, and links to the deeper files. If a
session reads only one file, this is it. It is edited (not appended) so it always
reflects *now*.

**`LEDGER.md` — what happened.** Append-only, newest last (or newest first — pick one
and keep it). One compact entry per completed unit of work: date, branch, a one-line
summary, and the PR or commit. It is the durable memory that survives when `STATE.md`
moves on. Sessions read the last ~10 entries, not the whole file.

**`BRANCHES.md` — the map that prevents collisions.** For each active branch: its
purpose, what it branched from, current status (in progress / in review / merged /
abandoned), and the files or modules it touches. Preflight cross-references this to
warn "branch X already edits `use-realtime.ts` — you're about to touch it too."

**`DECISIONS.md` — settled architecture.** Lightweight ADR entries for choices that
should not be re-opened casually: e.g. *account-level RLS shared inbox* (not per-user
isolation), *reuse shared `conversations.unread_count`* (no per-user table), *planned
centralized permission gate* for future per-module/per-agent access. Each entry: the
decision, the reason, the date. Stops sessions from silently contradicting the design.

**`RISKS.md` — the footguns.** Concrete, wacrm-specific hazards with a consequence:
the webhook runs on the **service-role admin client and bypasses RLS**; `unread_count`
is **shared, not per-user**; **never notify an agent about a chat they can't see**;
migrations must be **idempotent / re-runnable**. Read during preflight so risky areas
get extra care.

**`RULES.md` — the invariants.** The short, imperative "always/never" list every
session obeys: run `lint` + `typecheck` + `test` before declaring done; branch names
are `feat/*` or `fix/*`; never commit `.env.local` or any secret; open PRs against
`main`; no destructive git without explicit approval. This is the file most worth
`@import`-ing so it is always in context.

**`handoffs/<feature>.md` — the deep brief.** Where a feature's full context lives
(mission, locked decisions, code findings, what's left, acceptance criteria,
out-of-scope). Cowork writes it; Code consumes it via `/start-task`; Code appends a
results section via `/handoff`. Keeps heavy detail *out* of the files loaded every
session. The existing `NOTIFICATIONS_HANDOFF.md` is exactly this pattern and migrates
straight into `handoffs/inbound-notifications.md`.

**`README.md` / `archive/`** — the usage guide, and a place to rotate old ledger
entries so the live ledger never balloons.

---

## 5. What loads at the start of every session

`CLAUDE.md` is the enforcement point. It keeps the existing `@AGENTS.md` import and
adds a short, mandatory **session protocol** that instructs Claude Code to, before
planning or coding:

1. Read `.claude/context/STATE.md` — the current snapshot and pointers.
2. Read `.claude/context/RULES.md` — the invariants (this file is `@import`-ed so it is
   always present).
3. Skim `BRANCHES.md` for the current branch's row, and the **tail of `LEDGER.md`**.
4. If a hand-off brief exists for the task, read `handoffs/<feature>.md`.
5. **Do not write code yet** — run `/preflight` first (section 8).

Standing context cost stays low: only `STATE.md` (one screen) and `RULES.md` (one
screen) are guaranteed loaded. `DECISIONS.md`, `RISKS.md`, full handoffs, and ledger
history are pulled in *only when relevant*. A `SessionStart` hook echoes this checklist
as a reminder (it only prints text — it changes nothing).

---

## 6. What updates at the end of every session

Run `/update-ledger` when a feature/fix/refactor reaches a stopping point. It:

- **Appends** one entry to `LEDGER.md` (date · branch · summary · PR/commit).
- **Edits `STATE.md`** — moves the item from pending → in progress → done, refreshes the
  "current focus" and "last updated" line.
- **Updates `BRANCHES.md`** — status and touched-files for the active branch.
- **Adds to `DECISIONS.md` / `RISKS.md`** only if something genuinely new emerged.

Entries are terse (one or two lines). A `SessionEnd`/`Stop` hook prints a reminder to
run `/update-ledger` if it looks like edits happened — again, print-only, no writes,
no git. The human still decides when to commit; the command never commits or pushes.

---

## 7. Branch synchronization protocol

Purpose: keep `BRANCHES.md` honest and catch divergence/overlap early. All read-only.

- **Register on create.** A new working branch gets a row in `BRANCHES.md`: purpose,
  base (`main`), status, and the areas it expects to touch.
- **Sync check** (part of preflight and re-run on demand): `git fetch`, then report the
  current branch's **ahead/behind vs `origin/main`** (and `origin/dev` if it ever
  exists), list files changed vs the merge-base, and cross-reference other active
  branches' touched-file lists to flag **overlap**.
- **Report, never rewrite.** The protocol *surfaces* "you're 12 commits behind main"
  or "this file is also being edited on `feat/inbound-notifications`" and *recommends*
  a rebase/merge — but it never runs merge, rebase, reset, force-push, or branch
  deletion on its own. Those are the human's call, with explicit approval.
- **Naming.** Branches follow the repo's existing convention: `feat/*`, `fix/*`,
  `chore/*`; PRs target `main`.

---

## 8. Preflight protocol (before any new coding task)

`/preflight` is a **read-only gate**. Claude Code must complete it and get a go-ahead
**before writing a single line**. It:

1. Reads `STATE.md`, `RULES.md`, `RISKS.md`, and the relevant `handoffs/<feature>.md`.
2. Runs `git status`, `git branch --show-current`, `git fetch`, and computes
   ahead/behind vs `origin/main`.
3. Identifies the current branch and its base; diffs touched files vs the merge-base.
4. Finds **related work** — scans `BRANCHES.md` + `LEDGER.md` and greps the codebase
   for the feature area — so it knows what already exists.
5. **Detects conflicts:** uncommitted changes in the tree (wacrm's `main` currently has
   modified dotfiles — preflight should flag exactly this), files also touched by other
   active branches, being behind `main`, or brushing a known risk area.
6. Emits a short **written risk report** and **stops**, asking the human to confirm
   before coding begins.

Hard rule (in `RULES.md` and `CLAUDE.md`): **no implementation before preflight passes
and the user says go.**

---

## 9. Safe hand-off protocol (Cowork ↔ Claude Code)

File-based, bidirectional, no copy-paste.

**Cowork → Code.** Cowork writes `handoffs/<feature>.md`: mission, locked decisions,
relevant code findings, *what's left to build*, acceptance criteria, and out-of-scope.
It adds a pending line to `STATE.md` pointing at the brief. Claude Code starts with
`/start-task <feature>`, which reads the brief and immediately runs preflight.

**Code → Cowork.** When Code stops, `/handoff` appends a **results** section to the
same brief: what changed, follow-ups, new risks/decisions, and current branch status —
then mirrors the highlights into `STATE.md`. Cowork reads that to plan the next step.

This generalizes the pattern wacrm already uses (`NOTIFICATIONS_HANDOFF.md`, with its
"decisions locked" and "what's left to build" sections) into a repeatable channel.

---

## 10. Automation options (commands / hooks)

**Slash commands** (`.claude/commands/*.md`) — prompt-only, always safe. This is the
backbone:

- `/start-task <feature>` — load state + the feature's handoff, then run preflight.
- `/preflight` — the read-only conflict/divergence gate (section 8).
- `/update-ledger` — append to ledger + refresh `STATE.md`/`BRANCHES.md` (section 6).
- `/handoff` — write the results section back to the handoff + `STATE.md` (section 9).

**Hooks** (`.claude/settings.json`) — **echo-only, non-blocking** in this design:

- `SessionStart` → prints the "read STATE.md + RULES.md, run /preflight first" reminder.
- `PreToolUse` on `Edit|Write|MultiEdit` → prints a one-line "did you preflight?"
  nudge. Non-blocking (exit 0) — it never rejects the edit.
- `SessionEnd`/`Stop` → prints a "run /update-ledger" reminder.

Every hook command is a plain `echo`/`cat` of a reminder — **no git, no network, no
file writes, no destructive shell.** Anything stronger (e.g. a *blocking* pre-edit gate
that hard-stops until preflight ran, or auto-registering branches) is proposed in the
README as opt-in and requires your explicit approval before it's added.

---

## 11. Risks of over-automation

- **Context bloat.** If state files grow, every session pays the token cost forever.
  Mitigation: hard size targets, append-only ledger with `archive/` rotation, deep
  detail confined to on-demand handoffs.
- **Stale/lying ledger.** Auto-updates that drift from reality are worse than none.
  Mitigation: updates are terse, human-reviewed, and tied to real branch/PR facts.
- **False confidence from git automation.** Auto-merge/rebase/push can silently lose
  work or corrupt branches. Mitigation: **all git mutation is human-approved**; the
  system only reports and recommends.
- **Annoying/blocking hooks.** A hook that hard-stops every edit trains people to
  bypass it. Mitigation: hooks are print-only and non-blocking by default.
- **Secret leakage.** State files that quote config can leak tokens. Mitigation: an
  explicit "never paste secrets" rule and no auto-dumping of env/config.
- **Process overtaking product.** Ceremony that costs more than it saves. Mitigation:
  start minimal, keep files short, delete what isn't earning its keep.

---

## 12. Recommended minimal version

The smallest thing that breaks the isolation barrier:

- `CLAUDE.md` bootstrap (keep `@AGENTS.md`, add "read state first + preflight" protocol).
- `.claude/context/STATE.md`, `LEDGER.md`, `RULES.md`.
- `.claude/commands/preflight.md` and `.claude/commands/update-ledger.md`.
- No hooks.

Three state files, two commands. Read `STATE.md` first, preflight before coding, log
after. This alone eliminates most rework and blind-conflict risk.

---

## 13. Recommended advanced version (what we're building)

Minimal, plus:

- `BRANCHES.md`, `DECISIONS.md`, `RISKS.md`, and `handoffs/` with `archive/`.
- `/start-task` and `/handoff` commands (full Cowork↔Code channel).
- **Safe, echo-only** `SessionStart` / `PreToolUse` / `SessionEnd` hooks.
- Ledger rotation, PR-template/CODEOWNERS awareness in preflight, and a
  `.claude/context/README.md` usage guide.

All git-mutating actions remain human-approved; hooks never block or write.

---

## 14. Rollout plan for wacrm

**Phase 0 — Set up (on a branch).** Run the setup prompt on `chore/project-memory-system`.
Claude Code inspects the repo, confirms it won't clobber `CLAUDE.md`/`AGENTS.md`, and
scaffolds `.claude/context/`, `.claude/commands/`, the README, and the safe hooks.
Review the diff before merging.

**Phase 1 — Seed from reality.** Populate `STATE.md` from today: `main` (note the
uncommitted dotfile changes), `feat/inbound-notifications` (Phases A+B done, C
scaffolded), `feat/clickable-links` (merged, == main). Migrate `NOTIFICATIONS_HANDOFF.md`
→ `handoffs/inbound-notifications.md`. Seed `DECISIONS.md` (account-level RLS shared
inbox; shared `unread_count`; planned centralized permission gate) and `RISKS.md`
(webhook on service-role admin client bypasses RLS; shared unread; never notify on
invisible chats; idempotent migrations).

**Phase 2 — Use it on the next task.** Drive the next feature through
`/start-task → /preflight → implement → /update-ledger`. Confirm preflight actually
flags the current uncommitted `main` changes and any branch overlap.

**Phase 3 — Turn on safe hooks; team review.** Enable the echo hooks, review the whole
thing as a PR to `main`, and adjust wording.

**Phase 4 — Maintain.** Rotate `LEDGER.md` into `archive/` when it gets long; prune
stale `BRANCHES.md` rows on merge; keep `STATE.md` to one screen.

---

## Appendix — Claude Code setup prompt

Paste the block below into Claude Code (from the repo root) to build this system.

````text
You are setting up a lightweight "Project Memory & Synchronization System" for THIS
repository (wacrm — Next.js 16, React 19, Supabase, TypeScript, Vitest, ESLint,
Prettier). Goal: every future Claude Code session must (a) load current project state
before planning or coding, (b) run a read-only preflight before writing code, and
(c) update a central ledger after finishing. Keep everything lightweight and safe.

NON-NEGOTIABLE SAFETY RULES — obey for the entire task:
- No destructive or history-rewriting git. NEVER run commit, push, merge, rebase,
  reset, branch -D, checkout that discards changes, or any --force. You MAY run
  read-only git: status, branch, log, diff, fetch, remote -v.
- No risky automation. Any hook you add must ONLY print text (echo/cat), be
  non-blocking, and never write files, commit, push, hit the network, or run
  destructive shell.
- No secrets in any file you create. Never read, echo, or copy .env.local or any
  token/key: Supabase service-role key, Meta/WhatsApp app secret or access tokens,
  VAPID private key, ENCRYPTION_KEY, database passwords. Reference config by variable
  NAME only, never its value.
- No overwriting/deleting existing files without showing me the diff and getting
  explicit approval. Prefer additive edits.
- Keep every state file to about one screen. This system must cost little context.

STEP 0 — INSPECT, then PLAN, then STOP for approval (do not create/edit anything yet):
1. Inspect and report what exists: CLAUDE.md, AGENTS.md, .claude/ (and
   .claude/context, .claude/commands, .claude/settings.json), docs/, and any existing
   memory/handoff/state files (e.g. NOTIFICATIONS_HANDOFF.md). NOTE: CLAUDE.md
   currently only contains `@AGENTS.md` — that import MUST be preserved.
2. Read package.json scripts + .github/workflows/ci.yml so rules reference the real
   commands (expected: npm run lint, npm run typecheck, npm test, npm run format /
   format:check).
3. List local and remote branches (read-only) to seed the branch registry.
4. Present a concise plan: exactly which files you will create or edit, with a content
   outline for each; flag every edit to an existing file. Then STOP and wait for my
   approval.

STEP 1 — After approval, create .claude/context/ (and subdirs handoffs/, archive/) with
these concise files:

  .claude/context/STATE.md
    # Project State — wacrm
    _Last updated: <date> by <session>_
    ## Current focus
    <1-2 lines>
    ## Active branches
    - main — production
    - feat/inbound-notifications — Phases A+B done, C scaffolded
    - feat/clickable-links — merged (== main)
    ## Pending queue (priority order)
    1. <task> -> handoffs/<feature>.md
    ## Top risks right now
    - <one line> (see RISKS.md)
    ## Pointers
    LEDGER.md · BRANCHES.md · DECISIONS.md · RISKS.md · RULES.md · handoffs/

  .claude/context/LEDGER.md   (append-only, newest last; rotate into archive/ when long)
    # Work Ledger
    ## <YYYY-MM-DD> · <branch>
    - <what changed> — PR #<n> / <commit>

  .claude/context/BRANCHES.md   (remove rows when merged & pruned)
    # Active Branch Registry
    | Branch | Purpose | Base | Status | Touches |
    |---|---|---|---|---|

  .claude/context/DECISIONS.md   (mini-ADR: decision · why · date)
    # Architecture Decisions

  .claude/context/RISKS.md
    # Known Risks & Footguns

  .claude/context/RULES.md
    # Session Rules (invariants)
    - Read STATE.md + RULES.md before planning. Run /preflight before writing code — no exceptions.
    - After any feature/fix/refactor, run /update-ledger.
    - Branches: feat/*, fix/*, chore/*. PRs target main.
    - Before coding, check divergence vs origin/main AND overlap with other active
      branches in BRANCHES.md; report only — never auto-merge/rebase/push.
    - Before done: npm run lint, npm run typecheck, npm test.
    - NEVER commit .env.local or any secret (service-role key, Meta/WhatsApp tokens,
      VAPID private key, ENCRYPTION_KEY, DB passwords).

  .claude/context/README.md   (explain the system + how to use the 4 commands)

STEP 2 — CLAUDE.md: PRESERVE the existing `@AGENTS.md` line, then append (additive edit):
    @AGENTS.md
    @.claude/context/RULES.md
    ## Session protocol (read before planning or coding)
    1. Read `.claude/context/STATE.md` (snapshot + pointers).
    2. RULES.md is imported above — honor it.
    3. Skim your branch row in BRANCHES.md and the tail of LEDGER.md.
    4. If a handoff exists, read `.claude/context/handoffs/<feature>.md`.
    5. Run `/preflight` and get my go-ahead BEFORE writing code.
    6. After finishing, run `/update-ledger`.

STEP 3 — create .claude/commands/ prompt files:

  preflight.md  (frontmatter: description) — READ-ONLY gate, must pass before coding:
    1. Read STATE.md, RULES.md, RISKS.md, relevant handoffs/<feature>.md.
    2. git status; git branch --show-current; git fetch; report ahead/behind vs origin/main.
    3. Diff files changed vs merge-base with main.
    4. Cross-reference BRANCHES.md: warn about files also touched by other active branches.
    5. Flag uncommitted changes, being behind main, and any RISKS.md area you'll touch.
    6. Output a short risk report and STOP. Ask me to confirm before coding.

  start-task.md  (frontmatter: description, argument-hint: <feature>):
    1. Read STATE.md + RULES.md.
    2. If handoffs/$ARGUMENTS.md exists, read it; else summarize the task from STATE.md.
    3. Run /preflight and wait for go-ahead. Do not code yet.

  update-ledger.md  (frontmatter: description):
    1. Append a terse entry to LEDGER.md (## <date> · <branch> + 1-line summary + PR/commit).
    2. Edit STATE.md: move item pending->in progress->done; refresh focus + last-updated.
    3. Update the branch row in BRANCHES.md (status + touched files).
    4. Add any new locked decision/risk to DECISIONS.md / RISKS.md.
    5. Do NOT commit or push. Show me the diff.

  handoff.md  (frontmatter: description, argument-hint: <feature>):
    1. Append "## Results — <date>" to handoffs/$ARGUMENTS.md: what changed, follow-ups,
       new risks/decisions, branch status.
    2. Mirror highlights into STATE.md.
    3. Run /update-ledger if not already done. Do NOT commit or push.

STEP 4 — hooks (safe, echo-only). Propose .claude/settings.json below, SHOW it to me,
and get a quick approval before writing it. Do NOT add any blocking or state-changing
hook:
    {
      "hooks": {
        "SessionStart": [{ "hooks": [{ "type": "command", "command": "echo 'wacrm: read .claude/context/STATE.md + RULES.md, then run /preflight before editing.'" }] }],
        "PreToolUse": [{ "matcher": "Edit|Write|MultiEdit", "hooks": [{ "type": "command", "command": "echo 'Reminder: have you run /preflight for this task?'" }] }],
        "SessionEnd": [{ "hooks": [{ "type": "command", "command": "echo 'Session ending — run /update-ledger to record what changed.'" }] }]
      }
    }

STEP 5 — seed from current reality (Markdown only, additive):
- STATE.md: main (note any uncommitted changes you saw), feat/inbound-notifications
  (A+B done, C scaffold), feat/clickable-links (merged == main).
- BRANCHES.md: a row per active branch with the areas it touches.
- DECISIONS.md: account-level RLS shared inbox (assigned_agent_id is a preference, not
  RLS); reuse shared conversations.unread_count (no per-user table); planned
  centralized permission gate (future per-module/per-agent access behind one gate).
- RISKS.md: webhook (api/whatsapp/webhook) runs on the service-role admin client and
  BYPASSES RLS; conversations.unread_count is shared not per-user; never notify an
  agent about a chat they can't see; migrations must be idempotent.
- Migrate NOTIFICATIONS_HANDOFF.md -> handoffs/inbound-notifications.md (copy it; ASK
  before removing or moving the original).

STEP 6 — VERIFY before declaring done:
- Re-read every created/edited file for internal consistency and confirm CLAUDE.md
  still imports AGENTS.md.
- Run prettier on the new files: npm run format (or prettier --write on the created
  paths), then npm run format:check. Run npm run lint if it covers these files.
- Do NOT run the full build or test suite unless I ask.
- Report results.

STEP 7 — SUMMARY: list every file created/edited, confirm NO secrets were written and
NO destructive/ git-mutating actions were taken, and remind me that nothing was
committed. Leave committing and pushing to me.

Enforce in the written files (RULES.md + CLAUDE.md) that: no coding starts until
/preflight has run and I say go; /update-ledger runs after every task; branch conflict
checks (divergence vs origin/main + overlap with other active branches) happen in
preflight and only report, never mutate.
````
