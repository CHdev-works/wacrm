---
description: Record finished work — append to the ledger and refresh state/branch files. Shows a diff; never commits.
---

Record the work just finished. Do **not** commit or push.

1. Append a terse entry to `.claude/context/LEDGER.md`: `## <date> · <branch>` + a
   one-line summary + PR/commit ref (newest last).
2. Edit `STATE.md`: move the item pending → in progress → done; refresh **Current focus**
   and the **Last updated** line.
3. Update the branch's row in `BRANCHES.md` (status + touched files).
4. Add any newly locked decision to `DECISIONS.md` and any new risk to `RISKS.md`.
5. **Show the user the diff.** Leave committing/pushing to them.
