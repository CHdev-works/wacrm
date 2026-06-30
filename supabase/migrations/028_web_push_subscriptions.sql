-- ============================================================
-- 028_web_push_subscriptions.sql — Web Push device registrations
--
-- SCAFFOLD for full Web Push (brief Step 7). This migration creates
-- the storage + RLS so subscriptions can be persisted, but the
-- end-to-end send path (VAPID signing, dispatch from the inbound
-- webhook, expired-endpoint pruning) is intentionally NOT wired yet —
-- see docs/notifications.md → "Enabling Web Push later".
--
-- One row per (user, browser/device) push subscription as returned by
-- the browser's PushManager.subscribe(). The triplet the sender needs
-- is (endpoint, p256dh, auth); the rest is bookkeeping so the user can
-- recognise and revoke a device, and so the sender can prune stale ones.
--
-- Visibility
--   * A user reads/writes ONLY their own subscriptions (own-row RLS).
--   * The server-side sender (a future API route / cron) uses the
--     service-role client, which bypasses RLS — exactly like the
--     inbound webhook and the automation/flow engines already do — to
--     read every account member's active subscription and fan out.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS web_push_subscriptions (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id   UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

  -- The PushSubscription triplet. `endpoint` is globally unique per
  -- browser registration, so it's the natural conflict key for upserts
  -- when the same device re-subscribes (key rotation, re-grant).
  endpoint     TEXT NOT NULL UNIQUE,
  p256dh       TEXT NOT NULL,
  auth         TEXT NOT NULL,

  -- Bookkeeping for the "your devices" UI and for pruning.
  user_agent   TEXT,
  device_name  TEXT,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Soft-delete. The sender skips revoked rows; a 404/410 from the push
  -- service on send should stamp this rather than hard-deleting, so a
  -- device that re-subscribes can be told apart from one that never did.
  revoked_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS web_push_subscriptions_user_idx
  ON web_push_subscriptions(user_id);

-- The sender's hot path: "active subscriptions for the members of this
-- account". Partial index keeps revoked rows out of the scan.
CREATE INDEX IF NOT EXISTS web_push_subscriptions_account_active_idx
  ON web_push_subscriptions(account_id)
  WHERE revoked_at IS NULL;

-- ---- RLS: own rows only ------------------------------------
ALTER TABLE web_push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS web_push_subscriptions_select ON web_push_subscriptions;
DROP POLICY IF EXISTS web_push_subscriptions_insert ON web_push_subscriptions;
DROP POLICY IF EXISTS web_push_subscriptions_update ON web_push_subscriptions;
DROP POLICY IF EXISTS web_push_subscriptions_delete ON web_push_subscriptions;

CREATE POLICY web_push_subscriptions_select ON web_push_subscriptions FOR SELECT
  USING (auth.uid() = user_id);
CREATE POLICY web_push_subscriptions_insert ON web_push_subscriptions FOR INSERT
  WITH CHECK (auth.uid() = user_id AND is_account_member(account_id));
CREATE POLICY web_push_subscriptions_update ON web_push_subscriptions FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id AND is_account_member(account_id));
CREATE POLICY web_push_subscriptions_delete ON web_push_subscriptions FOR DELETE
  USING (auth.uid() = user_id);
