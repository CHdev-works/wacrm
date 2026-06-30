"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationPreferences,
} from "@/lib/notifications/preferences";

const PREF_COLUMNS: (keyof NotificationPreferences)[] = [
  "browser_notifications_enabled",
  "sound_enabled",
  "message_preview_enabled",
  "notify_for_assigned_only",
  "notify_for_shared_inbox",
  "quiet_hours_enabled",
  "quiet_hours_start",
  "quiet_hours_end",
];

function rowToPreferences(row: Record<string, unknown>): NotificationPreferences {
  const out = { ...DEFAULT_NOTIFICATION_PREFERENCES };
  for (const key of PREF_COLUMNS) {
    if (row[key] !== undefined && row[key] !== null) {
      // The columns are typed booleans / nullable text; trust the row
      // shape (RLS-scoped to the user's own row) and assign through.
      (out as Record<string, unknown>)[key] = row[key];
    }
  }
  return out;
}

export interface UseNotificationPreferences {
  preferences: NotificationPreferences;
  preferencesLoading: boolean;
  updatePreferences: (
    patch: Partial<NotificationPreferences>,
  ) => Promise<void>;
}

/**
 * Reads (and writes) the current user's notification preferences row.
 * RLS scopes the select to the caller's own row; when none exists yet
 * the privacy-first defaults are returned. Writes are optimistic and
 * persisted with an upsert keyed on `user_id`.
 */
export function useNotificationPreferences(): UseNotificationPreferences {
  const { user, accountId } = useAuth();
  const [preferences, setPreferences] = useState<NotificationPreferences>(
    DEFAULT_NOTIFICATION_PREFERENCES,
  );
  const [preferencesLoading, setPreferencesLoading] = useState(true);

  // Live mirrors so updatePreferences can be a stable `[]`-deps callback
  // (the repo's pattern for ref-reading callbacks, e.g. useRealtime's
  // `unsubscribe`) — reading reactive values from the closure would trip
  // the react-hooks manual-memoization rule.
  const preferencesRef = useRef(preferences);
  const userIdRef = useRef<string | undefined>(user?.id);
  const accountIdRef = useRef<string | null>(accountId);
  useEffect(() => {
    preferencesRef.current = preferences;
    userIdRef.current = user?.id;
    accountIdRef.current = accountId;
  });

  useEffect(() => {
    if (!user?.id) return;
    const supabase = createClient();
    let cancelled = false;

    (async () => {
      setPreferencesLoading(true);
      const { data, error } = await supabase
        .from("notification_preferences")
        .select("*")
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        console.error(
          "[useNotificationPreferences] load failed:",
          error.message,
        );
      } else if (data) {
        setPreferences(rowToPreferences(data));
      } else {
        // No row yet — keep the defaults; a row is created on first save.
        setPreferences(DEFAULT_NOTIFICATION_PREFERENCES);
      }
      setPreferencesLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const updatePreferences = useCallback(
    async (patch: Partial<NotificationPreferences>) => {
      const userId = userIdRef.current;
      const accountId = accountIdRef.current;
      if (!userId || !accountId) return;
      // Optimistic: reflect immediately, roll back on failure.
      const previous = preferencesRef.current;
      const next = { ...previous, ...patch };
      setPreferences(next);

      const supabase = createClient();
      const { error } = await supabase
        .from("notification_preferences")
        .upsert(
          { user_id: userId, account_id: accountId, ...patch },
          { onConflict: "user_id" },
        );
      if (error) {
        console.error(
          "[useNotificationPreferences] save failed:",
          error.message,
        );
        setPreferences(previous); // roll back
      }
    },
    [],
  );

  return { preferences, preferencesLoading, updatePreferences };
}
