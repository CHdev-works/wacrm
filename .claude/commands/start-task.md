---
description: Begin a task — load state + the feature handoff, then run preflight and wait for go-ahead.
argument-hint: <feature>
---

Start work on **$ARGUMENTS**.

1. Read `.claude/context/STATE.md` + `RULES.md`.
2. If `.claude/context/handoffs/$ARGUMENTS.md` exists, read it. Otherwise summarize the
   task from `STATE.md`'s pending queue.
3. Run `/preflight` and **wait for the user's go-ahead**. Do **not** write code yet.
