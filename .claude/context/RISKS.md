# Known Risks & Footguns

_One line each. Read before touching the related area; flag in `/preflight`._

- **Webhook bypasses RLS.** `src/app/api/whatsapp/webhook` runs on the **service-role
  admin client** — RLS does not apply. Enforce access scoping manually in that path.
- **`conversations.unread_count` is shared, not per-user.** Don't treat it as a single
  agent's unread badge. See [[DECISIONS.md]].
- **Never notify an agent about a chat they can't see.** Notification fan-out must
  respect account-level visibility, or agents get pinged for out-of-scope threads.
- **Migrations must be idempotent.** Guard with `if not exists` / `if exists`; assume
  they may re-run.
