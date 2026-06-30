"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { useAuth } from "@/hooks/use-auth";
import { useTotalUnread } from "@/hooks/use-total-unread";
import { useNotificationPreferences } from "@/hooks/use-notification-preferences";
import { useUnreadTabIndicator } from "@/hooks/use-unread-tab-indicator";
import { useInboundNotifications } from "@/hooks/use-inbound-notifications";
import type { NotificationPreferences } from "@/lib/notifications/preferences";

export type NotificationPermissionState = NotificationPermission | "unsupported";

interface NotificationContextValue {
  totalUnread: number;
  activeConversationId: string | null;
  setActiveConversationId: (id: string | null) => void;
  preferences: NotificationPreferences;
  preferencesLoading: boolean;
  updatePreferences: (
    patch: Partial<NotificationPreferences>,
  ) => Promise<void>;
  /** OS permission for the Notifications API, or 'unsupported'. */
  permission: NotificationPermissionState;
  /** Request OS permission. MUST be called from a user gesture. */
  requestPermission: () => Promise<NotificationPermissionState>;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

/**
 * Headless provider. Mount once inside the authed dashboard shell. Owns
 * the single unread + inbound-notification subscriptions and the tab/
 * favicon indicator, and exposes preferences + permission to the
 * settings UI and the inbox (which publishes the open conversation).
 */
export function NotificationProvider({ children }: { children: ReactNode }) {
  const { user, accountId } = useAuth();
  const { preferences, preferencesLoading, updatePreferences } =
    useNotificationPreferences();

  const [activeConversationId, setActiveConversationId] = useState<
    string | null
  >(null);

  // Lazy initializer (client-guarded) so we read OS permission without a
  // setState-in-effect. On the server it resolves to 'unsupported'; the
  // value isn't rendered into HTML, so there's no hydration mismatch.
  const [permission, setPermission] = useState<NotificationPermissionState>(
    () =>
      typeof window !== "undefined" && "Notification" in window
        ? Notification.permission
        : "unsupported",
  );

  const requestPermission =
    useCallback(async (): Promise<NotificationPermissionState> => {
      if (typeof window === "undefined" || !("Notification" in window)) {
        return "unsupported";
      }
      try {
        const result = await Notification.requestPermission();
        setPermission(result);
        return result;
      } catch {
        return permission;
      }
    }, [permission]);

  // Single source of truth for unread (the sidebar reads it from here).
  const totalUnread = useTotalUnread();
  useUnreadTabIndicator(totalUnread);

  useInboundNotifications({
    preferences,
    activeConversationId,
    userId: user?.id ?? null,
    enabled: !!accountId,
  });

  const value = useMemo<NotificationContextValue>(
    () => ({
      totalUnread,
      activeConversationId,
      setActiveConversationId,
      preferences,
      preferencesLoading,
      updatePreferences,
      permission,
      requestPermission,
    }),
    [
      totalUnread,
      activeConversationId,
      preferences,
      preferencesLoading,
      updatePreferences,
      permission,
      requestPermission,
    ],
  );

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
}

/**
 * Read notification state. Returns a safe inert fallback when used
 * outside the provider so a stray consumer never crashes the page.
 */
export function useNotifications(): NotificationContextValue {
  const ctx = useContext(NotificationContext);
  if (!ctx) {
    return {
      totalUnread: 0,
      activeConversationId: null,
      setActiveConversationId: () => {},
      preferences: {
        browser_notifications_enabled: false,
        sound_enabled: false,
        message_preview_enabled: false,
        notify_for_assigned_only: false,
        notify_for_shared_inbox: true,
        quiet_hours_enabled: false,
        quiet_hours_start: null,
        quiet_hours_end: null,
      },
      preferencesLoading: false,
      updatePreferences: async () => {},
      permission: "unsupported",
      requestPermission: async () => "unsupported",
    };
  }
  return ctx;
}
