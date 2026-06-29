import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { mirrorPendingBroadcasts } from '@/lib/broadcasts/mirror'

/**
 * Mirror sent broadcast messages into recipients' 1:1 chat threads.
 * Meant to be hit on a schedule (external pinger / n8n) — requires the
 * shared secret via `x-cron-secret`, matching `AUTOMATION_CRON_SECRET`,
 * exactly like /api/automations/cron and /api/flows/cron.
 *
 * Idempotent + resumable: the mirror claims rows atomically, so
 * overlapping invocations and re-runs never double-insert.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  const supplied = request.headers.get('x-cron-secret')
  if (supplied !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { mirrored, scanned } = await mirrorPendingBroadcasts(supabaseAdmin())
  return NextResponse.json({ mirrored, scanned })
}
