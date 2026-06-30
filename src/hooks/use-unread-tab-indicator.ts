"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

import { setFaviconBadge } from "@/lib/notifications/favicon";

/**
 * Reflects the total unread count in the browser tab title and favicon:
 *   0 → "<base>"
 *   1 → "● <base>"
 *   N → "(N) <base>"
 *
 * Re-applies on route change (Next can reset `document.title` from a
 * page's metadata). Recovers the base title by stripping the EXACT
 * prefix we last applied (tracked in a ref) so a page title that
 * legitimately starts with "(" isn't corrupted; an anchored regex is a
 * fallback for the first run / metadata commits.
 */
export function useUnreadTabIndicator(unreadCount: number): void {
  const pathname = usePathname();
  const lastPrefixRef = useRef("");
  const baseTitleRef = useRef("");

  useEffect(() => {
    if (typeof document === "undefined") return;

    const title = document.title;
    let base = title;
    const lastPrefix = lastPrefixRef.current;
    if (lastPrefix && title.startsWith(lastPrefix)) {
      base = title.slice(lastPrefix.length);
    } else {
      // Fallback: strip a leading "● " or "(N) " we (or a prior mount)
      // may have applied. Anchored so only a leading badge is removed.
      base = title.replace(/^(?:● |\(\d+\) )/, "");
    }
    baseTitleRef.current = base;

    const prefix =
      unreadCount <= 0 ? "" : unreadCount === 1 ? "● " : `(${unreadCount}) `;
    document.title = prefix + base;
    lastPrefixRef.current = prefix;

    setFaviconBadge(unreadCount > 0);
  }, [unreadCount, pathname]);

  // Restore the bare base title when the indicator unmounts (logout).
  useEffect(() => {
    return () => {
      if (typeof document === "undefined") return;
      if (baseTitleRef.current) document.title = baseTitleRef.current;
      setFaviconBadge(false);
    };
  }, []);
}
