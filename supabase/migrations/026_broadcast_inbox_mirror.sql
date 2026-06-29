-- 026_broadcast_inbox_mirror.sql
--
-- Mirror sent broadcast messages into each recipient's 1:1 chat thread
-- WITHOUT slowing the send path and WITHOUT surfacing broadcast-only
-- conversations in the inbox list until the recipient actually engages.
--
-- Design:
--   * The broadcast send path stays lean — it only records richer data on
--     the broadcast_recipients row it already writes (rendered_body).
--   * A background cron job (/api/broadcasts/mirror/cron) creates the
--     missing conversations + inserts the outbound broadcast messages,
--     stamped with the ORIGINAL send time so they sort correctly in the
--     thread.
--   * Idempotency is claim-based: the job atomically stamps mirrored_at
--     (UPDATE ... WHERE mirrored_at IS NULL RETURNING) before inserting,
--     so a re-run, an overlapping invocation, or a reply that races the
--     job can never double-insert — the same lock pattern automations/cron
--     already uses. No messages unique index is needed (and the existing
--     data has a duplicate message_id that one would choke on).
--   * Inbox visibility is a denormalized flag on conversations. DEFAULT
--     true preserves today's behaviour for every existing/normal
--     conversation (no backfill required); only the mirror job creates
--     conversations with false, and the inbound webhook flips it back to
--     true on the first reply.

-- 1) broadcast_recipients: the message body as actually sent (variables
--    substituted) + mirror progress/idempotency stamp.
ALTER TABLE broadcast_recipients
  ADD COLUMN IF NOT EXISTS rendered_body TEXT,
  ADD COLUMN IF NOT EXISTS mirrored_at TIMESTAMPTZ;

-- Lets the cron job find un-mirrored recipients without scanning the
-- whole table.
CREATE INDEX IF NOT EXISTS broadcast_recipients_pending_mirror_idx
  ON broadcast_recipients (mirrored_at)
  WHERE mirrored_at IS NULL;

-- 2) messages: mark broadcast-origin rows so the thread/UI can tell them
--    apart and the safety-net can recognise them. (Inbox-list visibility
--    is driven by conversations.visible_in_inbox below, not this column.)
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS source TEXT;

-- 3) conversations: inbox-list visibility flag. A broadcast-only thread
--    (created by the mirror job, no inbound, no non-broadcast outbound)
--    is hidden from the list but still openable directly; any real
--    activity (an inbound reply via the webhook) flips it visible.
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS visible_in_inbox BOOLEAN NOT NULL DEFAULT TRUE;

-- New columns inherit the existing table RLS policies (conversations:
-- is_account_member(account_id); messages: via the parent conversation).
-- The cron job uses the service-role client, which bypasses RLS exactly
-- like the webhook and automation engine.
