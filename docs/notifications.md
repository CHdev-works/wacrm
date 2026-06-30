# Inbound-message notifications

Real-time alerting for agents when a new **inbound** WhatsApp message
arrives, so they don't have to watch the inbox. This page explains how it
works, how to use it, its limits, and how to turn on full Web Push later.

---

## What you get

- **In-app toast** when a message arrives and the tab is focused.
- **Browser notification** when the tab is in the background (opt-in).
- **Sound** (opt-in) — a short synthesised blip, throttled to once per 3s.
- **Unread indicators** — the sidebar Inbox dot and a **tab-title** badge
  (`● wacrm` for one, `(3) wacrm` for several) plus a **favicon** dot.
- **Per-user preferences** in **Settings → Notifications**.
- **Web Push** scaffolding (tables + service worker) ready to enable.

Everything is **personal to each user** and synced across their devices
(stored in `notification_preferences`).

---

## How it works

### Real-time delivery
A headless `NotificationProvider` is mounted once in the authed dashboard
shell. It opens a single Supabase Realtime subscription to `INSERT`s on
`messages` filtered to `sender_type=eq.customer`:

- **Account isolation is automatic.** Supabase Realtime evaluates the
  table's RLS `SELECT` policy per connected client, so an agent only ever
  receives events for conversations in their own account. This is the
  same join-based-RLS pattern the inbox's `useRealtime` already relies on
  — not a new trust boundary.
- The `sender_type=eq.customer` filter excludes the agent's own outbound
  messages **and** broadcast mirrors (which insert `sender_type:'bot'`),
  so you're only alerted for genuine inbound customer texts.

> **Scaling note.** Because RLS is evaluated per client on each insert,
> the cost is O(connected clients) per inbound message. That's fine at
> normal agent counts. If you ever need to scale it down, switch the
> subscription to `conversations` `UPDATE` (the row carries `account_id`
> directly → a single membership check) and detect "new inbound" by
> diffing an `unread_count` increase.

### Which conversations notify you
A single gate decides whether a given conversation should alert you —
`shouldNotifyForConversation` in `src/lib/notifications/preferences.ts`:

- wacrm is a **shared inbox**: by default **every** agent in the account
  is notified for **every** inbound conversation
  (`notify_for_shared_inbox = true`, `notify_for_assigned_only = false`).
- Turning on **"Only conversations assigned to me"** flips to strict
  mode: you're alerted only for conversations whose `assigned_agent_id`
  is you, and the unassigned/others queue goes silent **for you**.
- The gate is **role-blind**: admins and owners are notified per their
  own preferences, not automatically. There is no "managers get
  everything" behaviour — it's all preferences.

> This single function is the **extension point** for a future
> per-module, per-agent permission system: add the access check there and
> the realtime subscription, provider, and UI need no changes.

### Suppression, dedupe, quiet hours
For each inbound event the provider:
1. **Dedupes** by message id (per tab).
2. **Suppresses** the alert if you're actively viewing that conversation
   (it's `activeConversationId` and the tab is visible) — it's already
   being marked read.
3. Applies the **scope gate** above.
4. Honours **quiet hours**: during your window, toasts/sound/browser
   notifications are muted, but **unread counts and the tab badge still
   update** (visual-but-silent).
5. **Best-effort multi-tab de-dupe** via a `BroadcastChannel` so two open
   tabs don't both pop an OS notification. This is a last-writer race,
   not leader election — under a tight race both tabs can still fire.

### Unread counts
Unread is the existing shared `conversations.unread_count` (incremented
by the webhook on each inbound, reset to 0 when an agent opens the
conversation). There is **no per-user read state** — it's a shared inbox.
The sidebar dot and the tab/favicon badge both read the single
`useTotalUnread` subscription owned by the provider.

---

## Using it

**Settings → Notifications:**
- **Browser notifications** — turning this on asks your browser for
  permission (a one-time prompt). It only fires when the tab is in the
  background.
- **Sound** — play a blip on new messages.
- **Show message preview** — include the sender + a snippet in toasts and
  browser notifications. **Off by default** so message text stays private
  on shared screens.
- **Only conversations assigned to me** / **Shared inbox conversations** —
  see "Which conversations notify you" above.
- **Quiet hours** — a daily mute window in your local time (supports a
  window that crosses midnight, e.g. 22:00 → 07:00).
- **Send test** — fires a toast (and a browser notification + sound if
  those are enabled) so you can confirm it works.

---

## Limits & gotchas

- **Permission is requested on a user action only** — never on page load.
  If you previously **blocked** notifications for the site, the toggle
  can't re-prompt; you must re-allow it in your browser's site settings.
- **HTTPS required.** The browser `Notification` API only works over
  HTTPS (or `localhost`). On plain `http://` the in-app toast and tab
  badge still work; OS notifications won't.
- **iOS Safari** has **no page-level `Notification` support** — the
  background-tab branch silently no-ops there. Only the in-app toast and
  tab title work. Full background push on iOS needs the Phase C service
  worker running inside an **installed PWA** (Add to Home Screen).
- **Autoplay policy** can block the sound until you've interacted with
  the page; it fails silently when blocked.
- On the inbox page two subscriptions see each insert (the inbox's own
  realtime and the notification hook). That's intentional and cheap — the
  notification hook caches one conversation lookup per new conversation.

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| No notification at all | Check **Settings → Notifications** is configured; confirm the message was **inbound** (you aren't notified for your own/bot messages); make sure you're not actively viewing that conversation in a focused tab. |
| Toast shows but no OS notification | Tab was focused (toasts are for focused tabs); or browser permission isn't `granted`; or **Browser notifications** is off; or you're on iOS Safari / `http://`. |
| Permission stuck "Blocked" | You denied it earlier — re-allow notifications for the site in browser settings, then toggle it on again. |
| No sound | **Sound** is off, you haven't interacted with the page yet (autoplay), or quiet hours are active. |
| Unread count looks wrong | Unread is **shared** per conversation (not per-user) and resets when **anyone** opens the conversation — that's by design for a shared inbox. |
| Getting alerts for another agent's chats | That's the shared-inbox default. Turn on **"Only conversations assigned to me"** to mute everything not assigned to you. |
| An agent gets another **account's** messages | Should be impossible — Realtime inherits RLS, which isolates by account. If you see this, check your RLS policies haven't been disabled. |

---

## Enabling Web Push later (Phase C)

The in-app + browser-notification system above needs none of this. Web
Push adds **background OS notifications even when no tab is open**.

The scaffolding already in the repo:
- `supabase/migrations/028_web_push_subscriptions.sql` — storage + RLS.
- `public/sw.js` — service worker handling `push` + `notificationclick`.
- `src/lib/notifications/push.ts` — `registerServiceWorker()` +
  `subscribeToPush()` (exported, **not yet called**).
- `.env.local.example` — commented `NEXT_PUBLIC_VAPID_PUBLIC_KEY`,
  `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.

To turn it on:
1. **Generate VAPID keys:** `npx web-push generate-vapid-keys`. Put the
   public key in `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, the private key in
   `VAPID_PRIVATE_KEY` (server-only), and set `VAPID_SUBJECT`
   (`mailto:...`). Use the **same** keys across environments.
2. **Register + subscribe on the client** — call `registerServiceWorker()`
   then `subscribeToPush(accountId)` from a user gesture (e.g. a "Enable
   background push" button in the notifications settings), after
   permission is `granted`.
3. **Server send-path** — in the inbound webhook
   (`src/app/api/whatsapp/webhook/route.ts`), at the same fan-out point
   where automations/flows dispatch, load each account member's active
   `web_push_subscriptions` rows (service-role client) and send a
   VAPID-signed push with the [`web-push`](https://www.npmjs.com/package/web-push)
   package. Gate each send through the **same**
   `shouldNotifyForConversation` decision plus the recipient's stored
   preferences (quiet hours, assigned-only) so push matches the in-app
   behaviour.
4. **Prune** — on a `404`/`410` from the push service, stamp `revoked_at`
   on that subscription row so the sender skips it next time.

Keep the **private** VAPID key server-only; only the public key is
client-side.
