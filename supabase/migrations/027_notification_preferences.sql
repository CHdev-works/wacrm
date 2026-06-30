-- ============================================================
-- 027_notification_preferences.sql — per-user notification settings
--
-- One row per user holding their personal alerting preferences for
-- the inbound-message notification system (in-app toast, browser
-- Notifications API, sound, and — once enabled — Web Push).
--
-- Design
--   * Personal, not account-wide: a row is readable/writable ONLY by
--     its own user. Even an account admin cannot see or change a
--     teammate's preferences (they're a device/person choice, like
--     the theme prefs in localStorage — but synced so they follow the
--     user across devices and drive server-side push later).
--   * account_id is denormalised onto the row so the future server-
--     side push sender can resolve "which members of this account
--     have browser_notifications/quiet-hours set how" without a
--     profiles join on every inbound message.
--   * No realtime publication needed — a tab reads its own row once on
--     mount and re-reads after it writes. Other tabs of the same user
--     reconcile via the BroadcastChannel the client uses for de-dupe.
--
-- Defaults are privacy- and consent-first:
--   * browser_notifications_enabled FALSE — the Notifications API
--     permission is requested only after an explicit user action.
--   * sound_enabled FALSE — opt-in, never surprise-plays audio.
--   * message_preview_enabled FALSE — OS/browser notifications never
--     show message text until the user opts in.
--   * notify_for_assigned_only FALSE — by default you hear about all
--     conversations your account can see (it's a shared inbox).
--   * notify_for_shared_inbox TRUE — see notify_for_assigned_only.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id      UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id   UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

  -- Alert channels
  browser_notifications_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  sound_enabled                 BOOLEAN NOT NULL DEFAULT FALSE,
  message_preview_enabled       BOOLEAN NOT NULL DEFAULT FALSE,

  -- Scoping (layered on top of the shared inbox — see the helper
  -- `shouldNotifyForConversation` in src/lib/notifications/preferences.ts).
  --   notify_for_assigned_only = TRUE  → only conversations whose
  --     assigned_agent_id is the current user fire a notification.
  --   notify_for_shared_inbox          → when NOT assigned-only, also
  --     alert for conversations not assigned to me (unassigned / others).
  notify_for_assigned_only BOOLEAN NOT NULL DEFAULT FALSE,
  notify_for_shared_inbox  BOOLEAN NOT NULL DEFAULT TRUE,

  -- Quiet hours. Times are "HH:MM" 24h strings evaluated in the
  -- viewer's LOCAL timezone (no tz math server-side). A window that
  -- wraps midnight (start > end) is supported by the client helper.
  quiet_hours_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  quiet_hours_start   TEXT,
  quiet_hours_end     TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notification_preferences_account_idx
  ON notification_preferences(account_id);

-- ---- RLS: own row only -------------------------------------
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notification_preferences_select ON notification_preferences;
DROP POLICY IF EXISTS notification_preferences_insert ON notification_preferences;
DROP POLICY IF EXISTS notification_preferences_update ON notification_preferences;

CREATE POLICY notification_preferences_select ON notification_preferences FOR SELECT
  USING (auth.uid() = user_id);

-- INSERT: only your own row, and account_id must be one you belong to
-- (stops a client from stamping a row into an account it can't see).
CREATE POLICY notification_preferences_insert ON notification_preferences FOR INSERT
  WITH CHECK (auth.uid() = user_id AND is_account_member(account_id));

-- UPDATE: only your own row; account_id must stay one you belong to.
CREATE POLICY notification_preferences_update ON notification_preferences FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id AND is_account_member(account_id));

-- ---- updated_at trigger ------------------------------------
DROP TRIGGER IF EXISTS set_updated_at ON notification_preferences;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON notification_preferences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
