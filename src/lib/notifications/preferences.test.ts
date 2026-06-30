import { describe, expect, it } from "vitest";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  isWithinQuietHours,
  shouldNotifyForConversation,
  type NotificationPreferences,
} from "./preferences";

function prefs(
  overrides: Partial<NotificationPreferences> = {},
): NotificationPreferences {
  return { ...DEFAULT_NOTIFICATION_PREFERENCES, ...overrides };
}

const ME = "user-me";
const OTHER = "user-other";

describe("shouldNotifyForConversation", () => {
  it("shared-inbox default: notifies for unassigned conversations", () => {
    expect(shouldNotifyForConversation(prefs(), null, ME)).toBe(true);
  });

  it("shared-inbox default: notifies for conversations assigned to others", () => {
    expect(shouldNotifyForConversation(prefs(), OTHER, ME)).toBe(true);
  });

  it("shared-inbox default: notifies for conversations assigned to me", () => {
    expect(shouldNotifyForConversation(prefs(), ME, ME)).toBe(true);
  });

  it("notify_for_shared_inbox=false mutes unassigned/others but keeps mine", () => {
    const p = prefs({ notify_for_shared_inbox: false });
    expect(shouldNotifyForConversation(p, null, ME)).toBe(false);
    expect(shouldNotifyForConversation(p, OTHER, ME)).toBe(false);
    expect(shouldNotifyForConversation(p, ME, ME)).toBe(true);
  });

  it("assigned_only: only conversations assigned to me notify", () => {
    const p = prefs({ notify_for_assigned_only: true });
    expect(shouldNotifyForConversation(p, ME, ME)).toBe(true);
    expect(shouldNotifyForConversation(p, OTHER, ME)).toBe(false);
    expect(shouldNotifyForConversation(p, null, ME)).toBe(false);
  });

  it("assigned_only wins even when shared_inbox is also true", () => {
    const p = prefs({
      notify_for_assigned_only: true,
      notify_for_shared_inbox: true,
    });
    expect(shouldNotifyForConversation(p, OTHER, ME)).toBe(false);
  });

  it("treats a missing user id as not-assigned-to-me", () => {
    expect(shouldNotifyForConversation(prefs(), ME, null)).toBe(true); // shared default
    expect(
      shouldNotifyForConversation(
        prefs({ notify_for_assigned_only: true }),
        ME,
        null,
      ),
    ).toBe(false);
  });
});

describe("isWithinQuietHours", () => {
  const at = (h: number, m = 0) => new Date(2026, 0, 1, h, m, 0, 0);

  it("returns false when quiet hours are disabled", () => {
    const p = prefs({ quiet_hours_start: "22:00", quiet_hours_end: "07:00" });
    expect(isWithinQuietHours(p, at(23))).toBe(false);
  });

  it("same-day window: inside and outside", () => {
    const p = prefs({
      quiet_hours_enabled: true,
      quiet_hours_start: "09:00",
      quiet_hours_end: "17:00",
    });
    expect(isWithinQuietHours(p, at(12))).toBe(true);
    expect(isWithinQuietHours(p, at(8, 59))).toBe(false);
    expect(isWithinQuietHours(p, at(17))).toBe(false); // end is exclusive
    expect(isWithinQuietHours(p, at(20))).toBe(false);
  });

  it("midnight-wrap window: 22:00 → 07:00", () => {
    const p = prefs({
      quiet_hours_enabled: true,
      quiet_hours_start: "22:00",
      quiet_hours_end: "07:00",
    });
    expect(isWithinQuietHours(p, at(23))).toBe(true);
    expect(isWithinQuietHours(p, at(2))).toBe(true);
    expect(isWithinQuietHours(p, at(6, 59))).toBe(true);
    expect(isWithinQuietHours(p, at(7))).toBe(false); // end exclusive
    expect(isWithinQuietHours(p, at(12))).toBe(false);
    expect(isWithinQuietHours(p, at(21, 59))).toBe(false);
  });

  it("returns false for malformed or empty times", () => {
    expect(
      isWithinQuietHours(
        prefs({ quiet_hours_enabled: true, quiet_hours_start: "nope", quiet_hours_end: "07:00" }),
        at(23),
      ),
    ).toBe(false);
    expect(
      isWithinQuietHours(
        prefs({ quiet_hours_enabled: true, quiet_hours_start: null, quiet_hours_end: null }),
        at(23),
      ),
    ).toBe(false);
  });

  it("returns false for a zero-length window (start === end)", () => {
    const p = prefs({
      quiet_hours_enabled: true,
      quiet_hours_start: "08:00",
      quiet_hours_end: "08:00",
    });
    expect(isWithinQuietHours(p, at(8))).toBe(false);
  });
});
