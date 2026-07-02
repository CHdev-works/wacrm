# Active Branch Registry

_Remove a row once the branch is merged **and** pruned. Status reflects divergence vs `origin/main` at last update._

| Branch                       | Purpose                                                     | Base | Status                                              | Touches                                                                                     |
| ---------------------------- | ----------------------------------------------------------- | ---- | --------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `main`                       | Production                                                  | —    | —                                                   | everything                                                                                  |
| `feat/inbound-notifications` | Inbound-message notifications (Phases A+B done, C scaffold) | main | Merged via `641852c`; 0 ahead / 3 behind — prunable | `src/app/api/whatsapp/webhook`, notifications lib, `conversations.unread_count`, migrations |
| `feat/clickable-links`       | Clickable links in chat message text                        | main | Merged (`== main`, 0/0) — prunable                  | inbox chat message rendering                                                                |
