# Session Rules (invariants)

- Read `STATE.md` + `RULES.md` before planning. Run `/preflight` before writing code — **no exceptions**.
- After any feature / fix / refactor, run `/update-ledger`.
- Branches: `feat/*`, `fix/*`, `chore/*`. PRs target `main`.
- Before coding, check divergence vs `origin/main` **and** overlap with other active
  branches in `BRANCHES.md`; **report only — never auto-merge / rebase / push**.
- No coding starts until `/preflight` has run and the user says go.
- Before done: `npm run lint`, `npm run typecheck`, `npm test`.
- **NEVER** commit `.env.local` or any secret — Supabase service-role key, Meta/WhatsApp
  app secret or access tokens, VAPID private key, `ENCRYPTION_KEY`, DB passwords.
  Reference config by variable **NAME** only.
- Committing and pushing are the user's call; commands here never do it.
