# Inbound-message Notifications — Implementation Handoff

> Hand-off brief for Claude Code to continue building the new-message
> notification system in **wacrm** (Next.js 16 + React 19 + Supabase).
> The codebase analysis below is already done — spot-check as
> needed, and continue from **"What's left to build."**
>
> ⚠️ **A verification pass has since reviewed this plan against the code — see
> §7 for required amendments to §4. Read §7 before implementing.**

---

## 0. Mission

When a new **inbound** WhatsApp message arrives, logged-in agents must be
alerted in real time instead of having to poll the inbox. Deliverables:

1. In-app **toast** when a new message arrives.
2. **Unread counts** update in inbox/sidebar.
3. **Browser tab title** indicator: `WhatsApp CRM` → `● WhatsApp CRM` (1) → `(3) WhatsApp CRM` (N).
4. Optional **favicon** unread dot.
5. **Browser Notifications API** support (permission requested on user action only).
6. Architecture ready for full **Web Push**.
7. Respect roles, agent chat isolation, and conversation permissions.

Hard rules: never notify an agent about a chat they can't see; never expose
service-role keys, WhatsApp tokens, Meta secrets, or VAPID private keys in
client code; never commit `.env.local`.

---

## 1. Decisions already approved by the user

These were confirmed and are **locked** — build to them:

| Question            | Decision                                                                                                                                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Agent isolation** | **Preference-based.** wacrm is an account-level _shared inbox_; keep it. "Assigned-only" is a per-user _notification preference_ filtering on `conversations.assigned_agent_id`, NOT a hard RLS boundary.                                         |
| **Unread model**    | **Reuse the existing shared `conversations.unread_count`.** No per-user unread table.                                                                                                                                                             |
| **Scope now**       | **Phases A + B fully; Phase C scaffolded.** Implement in-app toast, tab/favicon indicator, unread, browser Notifications API, sound, and the preferences UI. Create Web Push tables + service worker + plan, but do NOT wire end-to-end push yet. |

---

## 2. Architecture findings (already analyzed — don't re-derive)

**Stack:** Next.js 16 App Router, React 19, Supabase (`@supabase/ssr` + Realtime), `sonner` toasts already global, TypeScript, Vitest, ESLint. Browser Supabase client is a singleton (`src/lib/supabase/client.ts`).

**Where inbound messages are saved** — `src/app/api/whatsapp/webhook/route.ts`. `POST` HMAC-verifies Meta's signature, then `processMessage()` runs on the **service-role admin client (bypasses RLS)** and:

- inserts into `messages` with `sender_type:'customer'`, `status:'delivered'`, `created_at` = Meta timestamp;
- updates `conversations`: `last_message_text`, `last_message_at`, `unread_count = (old||0)+1`, `visible_in_inbox = true`.
  This is the single server-side choke point — the place to fan out Web Push later (where automations/flows already dispatch, ~line 720).

**How the inbox loads messages** — `src/app/(dashboard)/inbox/page.tsx` (client) uses `useRealtime` (`src/hooks/use-realtime.ts`), which subscribes to Postgres changes on `messages` and `conversations` with `event:'*'` and **no filter** — RLS auto-scopes the stream to the user's account. Children fetch initial rows; realtime patches state; resync on reconnect + tab-visibility.

**Where unread is stored** — `conversations.unread_count` (int, per-conversation, shared by all account members). Incremented in webhook; **reset to 0** in `src/components/inbox/message-thread.tsx` (~line 426, `.update({ unread_count: 0 })`) when an unread conversation is opened (guarded by `hasUnread` to avoid an update loop). Sidebar (`src/components/layout/sidebar.tsx`) shows count-of-conversations-with-unread via `useTotalUnread` (`src/hooks/use-total-unread.ts`). No per-user read state exists anywhere.

**Security model (the critical finding)** — RLS (migration `017_account_sharing.sql`) isolates at the **account** level via `is_account_member(account_id, min_role)` (SECURITY DEFINER; hierarchy owner=4 ▸ admin=3 ▸ agent=2 ▸ viewer=1). `conversations_select`/`messages_select` only require account membership, so **every member can read all conversations/messages in their account** — shared inbox by design. `conversations.assigned_agent_id` exists but is **unused in RLS**. Therefore:

- Cross-account isolation is automatic and enforced — **Supabase Realtime inherits RLS**, so an agent never receives another account's events. (Confirmed by `useTotalUnread`'s own comment: "RLS scopes this to the signed-in user automatically.")
- Intra-account "assigned-only" is a notification _preference_, not security.

**Roles & auth** — `src/lib/auth/roles.ts` (predicates `hasMinRole`, `canSendMessages`, etc.). `useAuth()` (`src/hooks/use-auth.tsx`) provides `user`, `accountId`, `accountRole`, `isOwner/isAdmin/isAgent/isViewer`, `profileLoading`. `AuthProvider` wraps the dashboard.

**Reusable templates already in the repo:**

- **Presence system** = the gold template for "new table + SECURITY DEFINER RPC + per-account RLS + realtime publication + headless heartbeat": migration `024_member_presence.sql`, `src/components/presence/presence-heartbeat.tsx` (headless, mounted in dashboard shell), `src/hooks/use-presence.ts`, `src/lib/presence.ts`.
- **Toasts**: `import { toast } from "sonner"` (already used widely). `<ThemedToaster/>` is mounted globally in `src/app/layout.tsx`.
- **Switch** UI: `src/components/ui/switch.tsx` — props `checked` + `onCheckedChange={(v)=>...}`. Also `Card`, `Label`, `Button`, `SettingsPanelHead`.

**Mount point** — `src/app/(dashboard)/dashboard-shell.tsx` → `DashboardShellInner` is auth-gated and already renders the headless `<PresenceHeartbeat/>`. Mount the new `<NotificationProvider>` here, wrapping Sidebar + Header + `<main>`.

**Settings IA** — `src/components/settings/settings-sections.ts` defines a `SETTINGS_SECTIONS` array + `SECTION_META` map (icon + group `top|account|workspace`). `src/app/(dashboard)/settings/page.tsx` maps each section id → a panel component. Adding a tab = add to the array + meta + the `panel` record. URL param is `?tab=`.

**Tables/migrations** — latest existing is `026`. `messages` & `conversations` are already in the `supabase_realtime` publication (migration `001`). `Conversation` type has `assigned_agent_id?`, `unread_count`, `visible_in_inbox?`; `Message` has `sender_type:'customer'|'agent'|'bot'`, `source?` (`'broadcast'` for mirrored), `content_text?`, `conversation_id`. (`src/types/index.ts`.)

---

## 3. What's already implemented

✅ **`supabase/migrations/027_notification_preferences.sql`** — per-user prefs table:
columns `user_id` (PK), `account_id`, `browser_notifications_enabled`, `sound_enabled`,
`message_preview_enabled`, `notify_for_assigned_only`, `notify_for_shared_inbox`,
`quiet_hours_enabled`, `quiet_hours_start`/`end` (TEXT `"HH:MM"`, local-time),
`created_at`/`updated_at` + `set_updated_at` trigger. **Own-row RLS** (select/insert/update;
insert+update also require `is_account_member(account_id)`). Privacy-first defaults
(browser/sound/preview = FALSE, assigned_only = FALSE, shared_inbox = TRUE).
→ The client can **upsert directly** (`onConflict: 'user_id'`); no RPC needed.

✅ **`supabase/migrations/028_web_push_subscriptions.sql`** — scaffold table:
`id`, `user_id`, `account_id`, `endpoint` (UNIQUE), `p256dh`, `auth`, `user_agent`,
`device_name`, `created_at`, `last_seen_at`, `revoked_at`. Own-row RLS; partial index
`(account_id) WHERE revoked_at IS NULL` for the future sender. **Send path intentionally NOT wired.**

Both are idempotent and follow the repo's existing migration conventions.

---

## 4. What's left to build

### Phase A + B — fully implement

**4.1 `src/lib/notifications/preferences.ts`** (types + pure helpers, unit-testable)

- `NotificationPreferences` type + `DEFAULT_NOTIFICATION_PREFERENCES` (mirror the 027 defaults).
- `shouldNotifyForConversation(prefs, assignedAgentId, myUserId)`:
  ```
  assignedToMe = assignedAgentId === myUserId
  if prefs.notify_for_assigned_only: return assignedToMe
  if assignedToMe: return true
  return prefs.notify_for_shared_inbox   // unassigned / assigned-to-others
  ```
- `isWithinQuietHours(prefs, date)` — handles the midnight-wrap case (start > end). Pure; add a `.test.ts`.

**4.2 `src/lib/notifications/sound.ts`**

- `playNotificationSound()` using **WebAudio** (a short two-tone sine beep) so no binary asset ships in git. Throttle via a module-level `lastPlayedAt` (≥3 s) so a burst plays once (brief Step 6). Fully guarded in try/catch (autoplay can throw).

**4.3 `src/lib/notifications/favicon.ts`** (optional indicator, keep simple + safe)

- `setFaviconBadge(show: boolean)` — find/create `<link rel="icon">`, cache original href once, draw a 32×32 canvas (original icon + red corner dot) on `show`, restore original on hide. Everything in try/catch; no-op on failure.

**4.4 `src/hooks/use-notification-preferences.ts`**

- Read own row via `supabase.from('notification_preferences').select('*')` (RLS → own row); if none, return `DEFAULT_NOTIFICATION_PREFERENCES`.
- `updatePreferences(patch)` → optimistic local set + `upsert({ user_id, account_id, ...patch }, { onConflict: 'user_id' })`. Get `user.id`/`accountId` from `useAuth`.

**4.5 `src/hooks/use-unread-tab-indicator.ts`**

- Input `unreadCount`. On `[unreadCount, pathname]` change: strip any prefix we previously added from `document.title` to recover the base, then set `0 → base`, `1 → "● " + base`, `N → "(N) " + base`. Depend on `usePathname()` so Next route changes that reset the title get re-prefixed. Restore base on unmount. Call `setFaviconBadge(unreadCount > 0)`.

**4.6 `src/hooks/use-inbound-notifications.ts`** (the core)

- Inputs: `{ preferences, activeConversationId, userId, enabled }`.
- Subscribe to Realtime `postgres_changes` INSERT on `messages` with `filter: 'sender_type=eq.customer'` (RLS gives account isolation; the `customer` filter excludes the agent's own outbound and broadcast mirrors). Use a distinct channel name e.g. `inbound-notifications`.
- For each event:
  1. **Dedupe** seen message ids (ref `Set`).
  2. **Freshness** — skip if `Date.now() - new Date(created_at) > 60_000` (guards against any replay).
  3. **Resolve conversation** — cache `Map<convId, {name, phone, assignedAgentId}>`; on miss, one `select` join `conversations + contact` (RLS-scoped).
  4. **Suppress** if `conversation_id === activeConversationId` **and** `document.visibilityState === 'visible'` (user is reading it; it's marked read immediately).
  5. **Scope** — `if (!shouldNotifyForConversation(prefs, assignedAgentId, userId)) return`.
  6. **Quiet hours** — if active, suppress toast/sound/browser-notif (unread/tab still update independently).
  7. **Channel:** tab focused (`visibilitychange visible`) → `sonner` toast (clickable → `/inbox?c=<id>`). Tab hidden → browser `Notification` (only if permission `granted` AND `browser_notifications_enabled`); `notification.onclick` → `window.focus()` + navigate. Play sound if `sound_enabled` (best-effort when hidden).
  8. **Content:** title `"New WhatsApp message"`; body = `message_preview_enabled ? "<name>: <text…>" : "New message from <name||phone>"`.
- **Multi-tab de-dupe (best-effort):** `BroadcastChannel('wacrm-notifications')` — before showing a browser notification / playing sound, broadcast the message id; skip if another tab already claimed it within a short window. Guard for browsers without `BroadcastChannel`.
- Clean up channel + BroadcastChannel on unmount/logout.

**4.7 `src/components/notifications/notification-provider.tsx`** (headless, `"use client"`)

- Reads `useAuth()` (user, accountId).
- Owns `useNotificationPreferences()`, `activeConversationId` state, and `useTotalUnread()` (move it here so it's the single subscription — see 4.9), drives `useUnreadTabIndicator(totalUnread)`, runs `useInboundNotifications(...)`.
- Exposes a context: `{ totalUnread, activeConversationId, setActiveConversationId, preferences, preferencesLoading, updatePreferences, permission, requestPermission }`.
- `permission` = `Notification.permission | 'unsupported'`; `requestPermission()` calls `Notification.requestPermission()` (must be from a user gesture — call it from the settings toggle, not on mount).

**4.8 Mount it** — `src/app/(dashboard)/dashboard-shell.tsx`: wrap the authed tree in `<NotificationProvider>` (next to `<PresenceHeartbeat/>`).

**4.9 Sidebar** — `src/components/layout/sidebar.tsx`: replace `const totalUnread = useTotalUnread()` with `const { totalUnread } = useNotifications()` to avoid a duplicate realtime channel (same hardcoded channel name `total-unread-realtime` would collide). (Confirm `useTotalUnread` has no other callers — currently only the sidebar.)

**4.10 Inbox** — `src/app/(dashboard)/inbox/page.tsx`: call `const { setActiveConversationId } = useNotifications()` and set it in `handleSelectConversation`, `handleCloseConversation`, and the deep-link branch, so the provider can suppress alerts for the open conversation.

**4.11 Settings UI** — `src/components/settings/notifications-settings.tsx` using the context:

- Toggles: Browser notifications (turning on → `requestPermission()` first; show `granted/denied/default`, hint if denied), Sound, Show message preview, Notify for assigned only, Notify for shared inbox (disable when assigned-only is on). Optional quiet-hours enable + start/end `<input type="time">`.
- A **"Send test notification"** button (helps verify Step 9).
- Wire into nav: add `'notifications'` to `SETTINGS_SECTIONS` + `SECTION_META` (icon `Bell`, group `account`) in `settings-sections.ts`, and add `notifications: <NotificationsSettings/>` to the `panel` record in `settings/page.tsx`.

### Phase C — scaffold only

**4.12 `public/sw.js`** — minimal service worker handling `push` (showNotification) and `notificationclick` (focus/open `/inbox?c=<id>`). **Do not auto-register it yet.**

**4.13 `src/lib/notifications/push.ts`** — client helpers `registerServiceWorker()` + `subscribeToPush()` reading `NEXT_PUBLIC_VAPID_PUBLIC_KEY`. Exported but **not called** anywhere (phase-C wiring documented in the doc). Document the server send-path (a `web-push`-signed dispatch from the webhook + 404/410 → stamp `revoked_at`).

**4.14 `.env.local.example`** — append commented `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` with a `web-push generate-vapid-keys` hint. (`.env.local` stays gitignored — confirmed `.gitignore` has `.env*` + `!.env.local.example`.)

### Docs + verification

**4.15 `docs/notifications.md`** (brief Step 10) — how realtime notifications work; enabling browser notifications; permission limitations; how unread counts work; how to enable Web Push later (generate VAPID, register SW, subscribe, add server dispatch, prune); troubleshooting (no notification / permission denied / sound not playing / unread wrong / agent getting another agent's notification → explain shared-inbox + assigned-only). Add a pointer from `README.md`.

**4.16 Run & fix** — `npm run lint`, `npm run typecheck`, `npm run build`, and `npm test` (add `.test.ts` for the pure helpers in 4.1). Verify the brief's 10 scenarios, especially: (2) hidden tab → browser notif; (3) open conversation → no extra unread / no toast; (5) Agent B doesn't get Agent A's _assigned-only_ alerts; (8) permission denied → tab dot + in-app still work; (9) logout cleans up subscriptions.

---

## 5. Conventions / gotchas

- **Never** use the service-role client in the browser. All client realtime/queries use `createClient()` from `src/lib/supabase/client.ts` (anon key, RLS-enforced).
- Realtime auto-scopes by account via RLS — no manual `account_id` filter needed for the inbound subscription (the `sender_type=eq.customer` filter is for direction, not tenancy).
- Permission request must be **user-gesture-initiated** (settings toggle), never on page load.
- Message preview is **off by default** — keep message text out of OS notifications unless `message_preview_enabled`.
- Follow `AGENTS.md`: this is Next.js 16 — mirror existing patterns in the repo (e.g. `next/navigation` `useRouter`/`usePathname`, `"use client"` components) rather than assuming older APIs.
- Headless provider pattern: copy the shape of `presence-heartbeat.tsx` (effect gated on `accountId`, cleanup on unmount).
- Keep secrets server-only: service-role key, WhatsApp tokens (already encrypted at rest), Meta app secret, VAPID **private** key. Only `NEXT_PUBLIC_*` + VAPID **public** key are client-side.

---

## 6. Suggested file map

```
NEW
  supabase/migrations/027_notification_preferences.sql      ✅ done
  supabase/migrations/028_web_push_subscriptions.sql        ✅ done
  src/lib/notifications/preferences.ts        (+ preferences.test.ts)
  src/lib/notifications/sound.ts
  src/lib/notifications/favicon.ts
  src/lib/notifications/push.ts                (phase C scaffold)
  src/hooks/use-notification-preferences.ts
  src/hooks/use-unread-tab-indicator.ts
  src/hooks/use-inbound-notifications.ts
  src/components/notifications/notification-provider.tsx
  src/components/settings/notifications-settings.tsx
  public/sw.js                                 (phase C scaffold)
  docs/notifications.md
EDIT
  src/app/(dashboard)/dashboard-shell.tsx      (mount provider)
  src/components/layout/sidebar.tsx            (totalUnread from context)
  src/app/(dashboard)/inbox/page.tsx           (publish active conversation)
  src/components/settings/settings-sections.ts (add 'notifications')
  src/app/(dashboard)/settings/page.tsx        (render panel)
  .env.local.example                           (VAPID vars, commented)
  README.md                                    (link docs)
```

Implement one logical step at a time; run lint/typecheck/build after major chunks.

```

---

## 7. Verification-pass fixes (apply these to §4)

A read-only architecture review checked this plan against the code. Verdict:
**the plan is sound and the migrations are correct** — apply the amendments
below before/while implementing. Severity in brackets.

**Realtime trigger — decision [was flagged BLOCKER → resolved].**
Keep the `messages` INSERT subscription (`filter: 'sender_type=eq.customer'`).
This is the **same join-based-RLS pattern `src/hooks/use-realtime.ts` already
ships and relies on** (it subscribes to `messages` with no account filter and
RLS scopes it), so account isolation is proven, not novel. Caveat to put in the
docs: Realtime evaluates the `messages_select` policy (a join to `conversations`
+ `is_account_member`) **per connected client**, i.e. an O(clients) RLS cost per
insert — acceptable at expected agent counts. If it ever needs to scale down,
switch the trigger to **`conversations` UPDATE** (row has `account_id` directly →
single membership check) and detect "new inbound" by diffing an `unread_count`
increase against the provider's existing unread `Map`. Note: broadcast mirrors
are excluded because they insert `sender_type:'bot'` (`src/lib/broadcasts/mirror.ts`),
not by "direction" — fix that wording in §4.6.

**[MAJOR] Stale closures in the realtime callback.** `useInboundNotifications`
must read `activeConversationId`, `preferences`, and `userId` from **refs updated
in an effect**, NOT closed-over values — a `postgres_changes` callback is
registered once for the channel's lifetime. Copy the exact ref pattern in
`src/hooks/use-realtime.ts:30-40` (`onMessageRef` etc.). Otherwise suppression and
prefs use whatever values existed at first subscribe.

**[MAJOR] Clear `activeConversationId` on inbox unmount.** §4.10 only clears it in
the mobile `handleCloseConversation`. Navigating inbox→contacts via the sidebar
does NOT call that, so the last-open conversation stays "active" and its inbound
messages get wrongly suppressed on other pages. Add an effect cleanup in the inbox
page that calls `setActiveConversationId(null)` on unmount.

**[MINOR] Drop the 60 s freshness guard.** Supabase `postgres_changes` does NOT
replay historical INSERTs on subscribe/resync (the inbox refetches manually
*because* of this — `inbox/page.tsx:364-374`), so the guard protects a non-event;
and since `messages.created_at` is **Meta's** timestamp (can lag on retries) it
could silently drop a genuinely new alert. Rely on the dedupe `Set` keyed by
message id instead.

**[MINOR] Tab-title robustness.** §4.5: store the exact last-applied prefix in a
ref and strip *that* (not a loose regex) to recover the base; anchor patterns
(`^● `, `^\(\d+\) `) so a title that legitimately starts with `(` isn't corrupted.
Accept a rare one-frame flicker if a per-page metadata title commits after nav.

**[MINOR] SSR / unsupported guards.** Never touch the `Notification` global during
render/SSR. Guard every access with `typeof window !== 'undefined' && 'Notification' in window`;
`permission` resolves to `'unsupported'` otherwise.

**[MINOR] BroadcastChannel is best-effort only.** It's a last-writer race, not
leader election — two tabs can both fire under a tight race. Keep it but document
the residual duplicate-under-race; degrade to per-tab where `BroadcastChannel` is
absent. Don't claim reliable de-dupe.

**[MINOR] Logout cleanup.** The provider unmounts when the shell returns `null` on
sign-out, but the Supabase browser client is a **singleton** — every hook effect
must explicitly `removeChannel(...)` on cleanup (existing hooks do), including the
moved `useTotalUnread` subscription.

**Double `messages` subscription (acceptable, document it).** On the inbox page the
inbox's `useRealtime` and the notification hook both see each INSERT, and a brand-
new conversation triggers a hydrate in both. Fine — the notification hook's
conversation lookup is cached (one `select` per new conv). Optimize later only if
needed; don't imply the `customer` filter makes it free.

**Product decisions — RESOLVED:**
- *Admin/owner scope* — the brief says admins "may receive all notifications **only
  if their notification preferences allow it**," i.e. it IS preference-gated. So
  `shouldNotifyForConversation` stays **role-blind** (current plan is correct).
  Document it in `docs/notifications.md`.
- *Shared-inbox = everyone gets notified (CONFIRMED by user).* Ship the default
  where **every agent in the account is notified for every inbound conversation**
  (`notify_for_assigned_only=FALSE`, `notify_for_shared_inbox=TRUE` by default — no
  change needed). `notify_for_assigned_only` stays as a per-user **opt-in** toggle;
  when a user turns it on, strict semantics apply (it mutes the unassigned queue) —
  document that in the settings copy. Do NOT add role/assignment gating to the
  default path.

**Forward-looking architecture note (user's stated direction).** The user plans a
later **per-module, per-agent permission system** covering every module, including
ones not built yet. So keep ALL "is this user allowed to be notified about this
conversation?" logic behind a **single centralized gate** — `shouldNotifyForConversation`
(§4.1) — and treat it as the one extension point. Today it consults only prefs +
the shared-inbox model; design its signature so a future `canUserAccess(module,
resource, user)` permission check can be added there **without touching** the
realtime subscription, the provider, or the UI. Add a short `// EXTENSION POINT:`
comment in that file pointing at the planned permission layer. Don't build the
permission system now — just don't wall it out.

**Docs (§4.15) must explicitly cover:** iOS Safari has **no page-level `Notification`
support** (Phase A's hidden-tab branch silently no-ops there — only the in-app toast
+ tab title work; full push needs the Phase C service worker in an installed PWA);
quiet-hours is "visual-but-silent" (tab/unread still update); assigned-only mutes the
unassigned queue; `Notification` requires HTTPS (or localhost).
```
