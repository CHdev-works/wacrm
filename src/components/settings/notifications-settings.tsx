"use client";

import { type ReactNode } from "react";
import { Bell } from "lucide-react";
import { toast } from "sonner";

import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useNotifications } from "@/components/notifications/notification-provider";
import { playNotificationSound } from "@/lib/notifications/sound";
import { cn } from "@/lib/utils";
import { SettingsPanelHead } from "./settings-panel-head";

/** One labelled toggle row. */
function ToggleRow({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  description: ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-4 rounded-lg border border-border bg-card p-4",
        disabled && "opacity-60",
      )}
    >
      <div className="min-w-0">
        <div className="text-sm font-semibold text-foreground">{label}</div>
        <p className="mt-1 max-w-[58ch] text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={(v) => onChange(!!v)}
        disabled={disabled}
        aria-label={label}
      />
    </div>
  );
}

export function NotificationsSettings() {
  const {
    preferences,
    preferencesLoading,
    updatePreferences,
    permission,
    requestPermission,
  } = useNotifications();

  const busy = preferencesLoading;

  const permissionHint = (() => {
    switch (permission) {
      case "granted":
        return "Allowed — browser notifications will show when this tab is in the background.";
      case "denied":
        return "Blocked in your browser. Enable notifications for this site in your browser's site settings, then turn this on again.";
      case "unsupported":
        return "This browser doesn't support notifications (note: iOS Safari only supports them for installed web apps).";
      default:
        return "Your browser will ask for permission when you turn this on.";
    }
  })();

  const onToggleBrowser = async (next: boolean) => {
    if (!next) {
      await updatePreferences({ browser_notifications_enabled: false });
      return;
    }
    // Turning on: request OS permission first (this is the user gesture).
    let perm = permission;
    if (perm !== "granted") perm = await requestPermission();
    if (perm === "granted") {
      await updatePreferences({ browser_notifications_enabled: true });
    } else {
      // Denied / unsupported — leave it off; the hint explains why.
      await updatePreferences({ browser_notifications_enabled: false });
    }
  };

  const sendTest = () => {
    toast("Test notification", {
      description: "In-app toasts look like this.",
    });
    if (
      preferences.browser_notifications_enabled &&
      permission === "granted" &&
      typeof window !== "undefined" &&
      "Notification" in window
    ) {
      try {
        new Notification("Test notification", {
          body: "Browser notifications are working.",
        });
      } catch {
        /* ignore */
      }
    }
    if (preferences.sound_enabled) playNotificationSound();
  };

  return (
    <section className="max-w-3xl animate-in fade-in-50 duration-200">
      <SettingsPanelHead
        title="Notifications"
        description="Choose how you're alerted when a new WhatsApp message arrives. These settings are personal to you and follow you across devices."
        action={
          <Button variant="outline" size="sm" onClick={sendTest} disabled={busy}>
            <Bell className="size-3.5" />
            Send test
          </Button>
        }
      />

      <div className="space-y-3">
        <ToggleRow
          label="Browser notifications"
          description={permissionHint}
          checked={preferences.browser_notifications_enabled}
          onChange={onToggleBrowser}
          disabled={busy || permission === "unsupported"}
        />

        <ToggleRow
          label="Sound"
          description="Play a short sound when a new message arrives."
          checked={preferences.sound_enabled}
          onChange={(v) => updatePreferences({ sound_enabled: v })}
          disabled={busy}
        />

        <ToggleRow
          label="Show message preview"
          description="Include the sender and a snippet of the message in toasts and browser notifications. Off keeps message text private on shared screens."
          checked={preferences.message_preview_enabled}
          onChange={(v) => updatePreferences({ message_preview_enabled: v })}
          disabled={busy}
        />

        <div className="pt-2">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Which conversations
          </h3>
        </div>

        <ToggleRow
          label="Only conversations assigned to me"
          description="When on, you're alerted only for conversations assigned to you — the rest of the shared inbox stays silent."
          checked={preferences.notify_for_assigned_only}
          onChange={(v) => updatePreferences({ notify_for_assigned_only: v })}
          disabled={busy}
        />

        <ToggleRow
          label="Shared inbox conversations"
          description="Be alerted for unassigned conversations and ones assigned to teammates. Ignored while “Only conversations assigned to me” is on."
          checked={preferences.notify_for_shared_inbox}
          onChange={(v) => updatePreferences({ notify_for_shared_inbox: v })}
          disabled={busy || preferences.notify_for_assigned_only}
        />

        <div className="pt-2">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Quiet hours
          </h3>
        </div>

        <ToggleRow
          label="Enable quiet hours"
          description="Mute toasts, sound, and browser notifications during a daily window (your local time). Unread counts and the tab badge still update."
          checked={preferences.quiet_hours_enabled}
          onChange={(v) => updatePreferences({ quiet_hours_enabled: v })}
          disabled={busy}
        />

        {preferences.quiet_hours_enabled && (
          <div className="flex flex-wrap items-end gap-4 rounded-lg border border-border bg-card p-4">
            <label className="flex flex-col gap-1 text-xs font-medium text-foreground">
              From
              <Input
                type="time"
                className="w-32"
                value={preferences.quiet_hours_start ?? ""}
                onChange={(e) =>
                  updatePreferences({ quiet_hours_start: e.target.value || null })
                }
                disabled={busy}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-foreground">
              To
              <Input
                type="time"
                className="w-32"
                value={preferences.quiet_hours_end ?? ""}
                onChange={(e) =>
                  updatePreferences({ quiet_hours_end: e.target.value || null })
                }
                disabled={busy}
              />
            </label>
            <p className="max-w-[40ch] text-xs text-muted-foreground">
              A window that crosses midnight (e.g. 22:00 → 07:00) is supported.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
