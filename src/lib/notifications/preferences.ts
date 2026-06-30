/**
 * Notification preferences — types, defaults, and the pure decision
 * helpers for the inbound-message notification system.
 *
 * Everything here is framework-free and unit-testable; the React hooks
 * and the provider import from this file. Mirrors the columns + defaults
 * in `supabase/migrations/027_notification_preferences.sql`.
 */

export interface NotificationPreferences {
  browser_notifications_enabled: boolean;
  sound_enabled: boolean;
  message_preview_enabled: boolean;
  /**
   * When true, only conversations whose `assigned_agent_id` is the
   * current user fire a notification (mutes the unassigned / others
   * queue). When false, the shared-inbox model applies — see
   * `notify_for_shared_inbox`.
   */
  notify_for_assigned_only: boolean;
  /** When NOT assigned-only, also alert for conversations not assigned
   *  to me (unassigned or assigned to someone else). */
  notify_for_shared_inbox: boolean;
  quiet_hours_enabled: boolean;
  /** "HH:MM" 24h, evaluated in the viewer's LOCAL timezone. */
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
}

/**
 * Privacy- and consent-first defaults — identical to the column
 * defaults in migration 027. Used when the user has no row yet.
 */
export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  browser_notifications_enabled: false,
  sound_enabled: false,
  message_preview_enabled: false,
  notify_for_assigned_only: false,
  notify_for_shared_inbox: true,
  quiet_hours_enabled: false,
  quiet_hours_start: null,
  quiet_hours_end: null,
};

/**
 * The ONE gate for "should this user be notified about this
 * conversation?". Today it consults only the user's preferences layered
 * on top of wacrm's shared-inbox model (account membership already
 * gates visibility via RLS — Realtime never delivers another account's
 * events). It is intentionally role-blind: admins/owners are notified
 * per their own preferences, not automatically.
 *
 * EXTENSION POINT: a future per-module, per-agent permission system
 * (e.g. `canUserAccess(module, resource, user)`) plugs in HERE — keep
 * all "is this user allowed to be notified about this resource?" logic
 * behind this single function so the realtime subscription, provider,
 * and UI never need to change. Add the extra check as an early
 * `return false` below without touching callers.
 */
export function shouldNotifyForConversation(
  prefs: NotificationPreferences,
  assignedAgentId: string | null | undefined,
  myUserId: string | null | undefined,
): boolean {
  const assignedToMe = !!assignedAgentId && assignedAgentId === myUserId;

  if (prefs.notify_for_assigned_only) return assignedToMe;
  if (assignedToMe) return true;
  return prefs.notify_for_shared_inbox;
}

/** Parse "HH:MM" → minutes since midnight, or null if malformed. */
function parseHHMM(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Is `date` inside the user's quiet-hours window (their LOCAL time)?
 * Returns false when quiet hours are disabled or the window is
 * malformed. Supports a window that wraps midnight (start > end), e.g.
 * 22:00 → 07:00.
 */
export function isWithinQuietHours(
  prefs: NotificationPreferences,
  date: Date = new Date(),
): boolean {
  if (!prefs.quiet_hours_enabled) return false;
  const start = parseHHMM(prefs.quiet_hours_start);
  const end = parseHHMM(prefs.quiet_hours_end);
  if (start === null || end === null) return false;
  // A zero-length window (start === end) means "never quiet".
  if (start === end) return false;

  const cur = date.getHours() * 60 + date.getMinutes();
  if (start < end) {
    // Same-day window, e.g. 09:00 → 17:00.
    return cur >= start && cur < end;
  }
  // Wraps midnight, e.g. 22:00 → 07:00.
  return cur >= start || cur < end;
}
