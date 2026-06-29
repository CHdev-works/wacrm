import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Mirror sent broadcast messages into each recipient's 1:1 chat thread.
 *
 * Why a background job (not the send request): the send path must stay
 * lean (no per-recipient message inserts / conversation upserts inline).
 * This runs on the same cron mechanism as automations/flows.
 *
 * Idempotency is CLAIM-BASED, mirroring automations/cron's lock pattern:
 * we atomically stamp `mirrored_at` (UPDATE ... WHERE mirrored_at IS NULL
 * RETURNING) and only the rows we actually claimed get a message. A
 * re-run, an overlapping invocation, or a reply that races the job can
 * never double-insert — whoever wins the claim is the sole inserter. No
 * unique index on messages is required.
 *
 * Inbox-safe: conversations created here are stamped
 * `visible_in_inbox = false`, and we never bump `last_message_at` /
 * `visible_in_inbox` — so a broadcast mirror never makes a conversation
 * appear in the inbox list. Only an inbound reply (the webhook) flips it
 * visible.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, any, any>

interface PendingRecipient {
  id: string
  contact_id: string
  whatsapp_message_id: string | null
  rendered_body: string | null
  sent_at: string | null
  // PostgREST embeds the parent broadcast; supabase-js may type it as an
  // array, so we normalise below.
  broadcast:
    | { account_id: string; user_id: string; template_name: string }
    | { account_id: string; user_id: string; template_name: string }[]
    | null
}

const RECIPIENT_SELECT =
  'id, contact_id, whatsapp_message_id, rendered_body, sent_at, ' +
  'broadcast:broadcasts(account_id, user_id, template_name)'

// Recipient statuses for which a message actually went out to WhatsApp.
const SENT_STATUSES = ['sent', 'delivered', 'read', 'replied']

function broadcastOf(r: PendingRecipient) {
  const b = r.broadcast
  return Array.isArray(b) ? (b[0] ?? null) : b
}

/**
 * Claim a set of pending recipients and write their broadcast messages
 * into the matching conversations. Shared by the cron job and the inbound
 * webhook safety-net.
 *
 * Returns the number of messages mirrored.
 */
async function claimAndMirror(
  admin: Admin,
  candidates: PendingRecipient[],
): Promise<number> {
  if (candidates.length === 0) return 0

  // 1) Atomic claim — only rows still un-mirrored come back. This is the
  //    idempotency lock: a racing job/webhook claiming the same id gets
  //    0 rows for it and skips.
  const ids = candidates.map((r) => r.id)
  const { data: claimedRows, error: claimErr } = await admin
    .from('broadcast_recipients')
    .update({ mirrored_at: new Date().toISOString() })
    .in('id', ids)
    .is('mirrored_at', null)
    .select('id')
  if (claimErr) {
    console.error('[broadcast-mirror] claim failed:', claimErr.message)
    return 0
  }
  const claimedIds = new Set((claimedRows ?? []).map((r: { id: string }) => r.id))
  const claimed = candidates.filter((r) => claimedIds.has(r.id))
  if (claimed.length === 0) return 0

  // 2) Resolve a conversation per (account_id, contact_id). Reuse any
  //    existing conversation (prior inbound, a racing reply, etc.);
  //    create the rest hidden from the inbox.
  const convKey = (accountId: string, contactId: string) =>
    `${accountId}:${contactId}`
  const contactIds = [...new Set(claimed.map((r) => r.contact_id))]

  const { data: existingConvs, error: convFetchErr } = await admin
    .from('conversations')
    .select('id, account_id, contact_id')
    .in('contact_id', contactIds)
  if (convFetchErr) {
    console.error('[broadcast-mirror] conversation fetch failed:', convFetchErr.message)
    await rollbackClaim(admin, claimed)
    return 0
  }

  const convByPair = new Map<string, string>()
  for (const c of existingConvs ?? []) {
    convByPair.set(convKey(c.account_id, c.contact_id), c.id)
  }

  // Bulk-create the conversations that don't exist yet, hidden from the
  // inbox list (visible_in_inbox = false). Dedupe by pair first.
  const toCreate = new Map<
    string,
    { account_id: string; user_id: string; contact_id: string }
  >()
  for (const r of claimed) {
    const b = broadcastOf(r)
    if (!b) continue
    const key = convKey(b.account_id, r.contact_id)
    if (!convByPair.has(key) && !toCreate.has(key)) {
      toCreate.set(key, {
        account_id: b.account_id,
        user_id: b.user_id,
        contact_id: r.contact_id,
      })
    }
  }
  if (toCreate.size > 0) {
    const { data: created, error: createErr } = await admin
      .from('conversations')
      .insert(
        [...toCreate.values()].map((c) => ({
          account_id: c.account_id,
          user_id: c.user_id,
          contact_id: c.contact_id,
          visible_in_inbox: false,
        })),
      )
      .select('id, account_id, contact_id')
    if (createErr) {
      console.error('[broadcast-mirror] conversation create failed:', createErr.message)
      await rollbackClaim(admin, claimed)
      return 0
    }
    for (const c of created ?? []) {
      convByPair.set(convKey(c.account_id, c.contact_id), c.id)
    }
  }

  // 3) Build + insert the broadcast messages, stamped with the ORIGINAL
  //    send time so they sort to the right spot in the thread.
  const messageRows: Record<string, unknown>[] = []
  const mirroredOk: string[] = []
  for (const r of claimed) {
    const b = broadcastOf(r)
    if (!b) continue
    const conversationId = convByPair.get(convKey(b.account_id, r.contact_id))
    if (!conversationId) continue
    messageRows.push({
      conversation_id: conversationId,
      sender_type: 'bot',
      content_type: 'template',
      content_text: r.rendered_body ?? `[template: ${b.template_name}]`,
      template_name: b.template_name,
      message_id: r.whatsapp_message_id,
      status: 'sent',
      created_at: r.sent_at ?? new Date().toISOString(),
      source: 'broadcast',
    })
    mirroredOk.push(r.id)
  }

  if (messageRows.length === 0) return 0

  const { error: insertErr } = await admin.from('messages').insert(messageRows)
  if (insertErr) {
    // Couldn't write the messages — release the claim so a later run
    // retries instead of silently dropping them.
    console.error('[broadcast-mirror] message insert failed:', insertErr.message)
    await rollbackClaim(admin, claimed)
    return 0
  }

  return messageRows.length
}

/** Release a failed claim so the rows are retried next run. */
async function rollbackClaim(admin: Admin, rows: PendingRecipient[]) {
  const ids = rows.map((r) => r.id)
  const { error } = await admin
    .from('broadcast_recipients')
    .update({ mirrored_at: null })
    .in('id', ids)
  if (error) {
    console.error('[broadcast-mirror] claim rollback failed:', error.message)
  }
}

/**
 * Cron entry point: mirror up to `limit` pending broadcast recipients.
 */
export async function mirrorPendingBroadcasts(
  admin: Admin,
  limit = 500,
): Promise<{ mirrored: number; scanned: number }> {
  const { data: pending, error } = await admin
    .from('broadcast_recipients')
    .select(RECIPIENT_SELECT)
    .is('mirrored_at', null)
    .in('status', SENT_STATUSES)
    .not('whatsapp_message_id', 'is', null)
    .order('sent_at', { ascending: true })
    .limit(limit)
  if (error) {
    console.error('[broadcast-mirror] pending fetch failed:', error.message)
    return { mirrored: 0, scanned: 0 }
  }
  const candidates = (pending ?? []) as unknown as PendingRecipient[]
  const mirrored = await claimAndMirror(admin, candidates)
  return { mirrored, scanned: candidates.length }
}

/**
 * Inbound safety-net: when a contact replies, mirror any of THEIR
 * still-pending broadcast messages immediately so the reply shows with
 * full context above it (instead of waiting for the next cron tick). The
 * claim lock guarantees this never duplicates with the cron job.
 */
export async function mirrorPendingForContact(
  admin: Admin,
  contactId: string,
): Promise<number> {
  const { data: pending, error } = await admin
    .from('broadcast_recipients')
    .select(RECIPIENT_SELECT)
    .eq('contact_id', contactId)
    .is('mirrored_at', null)
    .in('status', SENT_STATUSES)
    .not('whatsapp_message_id', 'is', null)
  if (error) {
    console.error('[broadcast-mirror] contact fetch failed:', error.message)
    return 0
  }
  const candidates = (pending ?? []) as unknown as PendingRecipient[]
  return claimAndMirror(admin, candidates)
}
