---
description: Write a feature handoff — append results to the handoff brief, mirror highlights into state, then update the ledger.
argument-hint: <feature>
---

Write the handoff for **$ARGUMENTS**. Do **not** commit or push.

1. Append `## Results — <date>` to `.claude/context/handoffs/$ARGUMENTS.md`: what
   changed, follow-ups, new risks/decisions, and branch status.
2. Mirror the highlights into `.claude/context/STATE.md`.
3. Run `/update-ledger` if it hasn't already run for this work.
