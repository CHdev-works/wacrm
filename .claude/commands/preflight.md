---
description: Read-only pre-coding gate — loads state, reports git divergence and branch overlap, then stops for go-ahead.
---

You are running the **preflight** gate. This is **read-only**: report only, never
mutate. Do NOT run any git command that writes (no commit, push, merge, rebase, reset,
branch -D, checkout that discards, or --force). Allowed git: `status`, `branch`, `log`,
`diff`, `fetch`, `remote -v`.

1. Read `.claude/context/STATE.md`, `RULES.md`, `RISKS.md`, and any relevant
   `handoffs/<feature>.md`.
2. Run `git status`; `git branch --show-current`; `git fetch`; then report **ahead/behind
   vs `origin/main`** (`git rev-list --left-right --count origin/main...HEAD`).
3. Diff files changed vs the merge-base with `main`
   (`git diff --name-only $(git merge-base origin/main HEAD)...HEAD`).
4. Cross-reference `BRANCHES.md`: **warn** about any file also touched by another active
   branch.
5. Flag: uncommitted changes, being behind `main`, and any `RISKS.md` area you'll touch.
6. Output a short risk report and **STOP**. Ask the user to confirm before coding.
