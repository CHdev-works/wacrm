"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { playNotificationSound } from "@/lib/notifications/sound";
import {
  isWithinQuietHours,
  shouldNotifyForConversation,
  type NotificationPreferences,
} from "@/lib/notifications/preferences";

interface ConversationMeta {
  name: string | null;
  phone: string | null;
  assignedAgentId: string | null;
}

interface UseInboundNotificationsArgs {
  preferences: NotificationPreferences;
  activeConversationId: string | null;
  userId: string | null;
  enabled: boolean;
}

const CHANNEL_NAME = "inbound-notifications";
const BROADCAST_NAME = "wacrm-notifications";
// A claim from another tab within this window suppresses our own
// browser-notification/sound for the same message (best-effort de-dupe).
const CLAIM_TTL_MS = 3_000;

/**
 * Headless. Subscribes to inbound (`sender_type=eq.customer`) message
 * INSERTs and raises an in-app toast (tab focused) or a browser
 * Notification (tab hidden) for messages the user should be alerted
 * about. RLS scopes the realtime stream to the user's account; the
 * `customer` filter excludes the agent's own outbound and broadcast
 * mirrors (which insert `sender_type:'bot'`).
 */
export function useInboundNotifications({
  preferences,
  activeConversationId,
  userId,
  enabled,
}: UseInboundNotificationsArgs): void {
  const router = useRouter();

  // A postgres_changes callback is registered once for the channel's
  // lifetime, so it must read live values from refs — not closed-over
  // props (mirrors src/hooks/use-realtime.ts).
  const prefsRef = useRef(preferences);
  const activeIdRef = useRef(activeConversationId);
  const userIdRef = useRef(userId);
  const routerRef = useRef(router);
  useEffect(() => {
    prefsRef.current = preferences;
    activeIdRef.current = activeConversationId;
    userIdRef.current = userId;
    routerRef.current = router;
  });

  // Per-tab dedupe of message ids we've already handled.
  const seenRef = useRef<Set<string>>(new Set());
  // Ids another tab claimed (id → timestamp) for cross-tab de-dupe.
  const claimedElsewhereRef = useRef<Map<string, number>>(new Map());
  // conversation_id → meta cache, so we do at most one lookup per conv.
  const convCacheRef = useRef<Map<string, ConversationMeta>>(new Map());

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;

    const supabase = createClient();

    // --- cross-tab de-dupe channel (best-effort) ---
    let bc: BroadcastChannel | null = null;
    try {
      if ("BroadcastChannel" in window) {
        bc = new BroadcastChannel(BROADCAST_NAME);
        bc.onmessage = (e: MessageEvent) => {
          const data = e.data as { type?: string; id?: string };
          if (data?.type === "claim" && data.id) {
            claimedElsewhereRef.current.set(data.id, Date.now());
          }
        };
      }
    } catch {
      bc = null;
    }

    const claimedByAnotherTab = (id: string): boolean => {
      const t = claimedElsewhereRef.current.get(id);
      if (t === undefined) return false;
      return Date.now() - t < CLAIM_TTL_MS;
    };

    const resolveConversation = async (
      conversationId: string,
    ): Promise<ConversationMeta> => {
      const cached = convCacheRef.current.get(conversationId);
      if (cached) return cached;
      const { data } = await supabase
        .from("conversations")
        .select("assigned_agent_id, contact:contacts(name, phone)")
        .eq("id", conversationId)
        .maybeSingle();
      const contactRaw = (data as { contact?: unknown } | null)?.contact;
      const contact = Array.isArray(contactRaw) ? contactRaw[0] : contactRaw;
      const meta: ConversationMeta = {
        name: (contact as { name?: string } | null)?.name ?? null,
        phone: (contact as { phone?: string } | null)?.phone ?? null,
        assignedAgentId:
          (data as { assigned_agent_id?: string } | null)?.assigned_agent_id ??
          null,
      };
      convCacheRef.current.set(conversationId, meta);
      return meta;
    };

    const handleInsert = async (row: {
      id?: string;
      conversation_id?: string;
      content_text?: string | null;
    }) => {
      const messageId = row.id;
      const conversationId = row.conversation_id;
      if (!messageId || !conversationId) return;

      // 1) Per-tab dedupe.
      if (seenRef.current.has(messageId)) return;
      seenRef.current.add(messageId);
      if (seenRef.current.size > 500) seenRef.current.clear();

      // 2) Suppress when the user is actively viewing this conversation.
      if (
        conversationId === activeIdRef.current &&
        document.visibilityState === "visible"
      ) {
        return;
      }

      // 3) Resolve conversation meta (cached) and apply the scope gate.
      const meta = await resolveConversation(conversationId);
      const prefs = prefsRef.current;
      if (
        !shouldNotifyForConversation(prefs, meta.assignedAgentId, userIdRef.current)
      ) {
        return;
      }

      // 4) Quiet hours suppress toast/sound/browser-notif (the unread
      //    count + tab title still update on their own channels).
      if (isWithinQuietHours(prefs)) return;

      // 5) Cross-tab claim: if another tab already grabbed this id, let
      //    it own the OS notification/sound; we still showed nothing yet.
      if (claimedByAnotherTab(messageId)) return;
      try {
        bc?.postMessage({ type: "claim", id: messageId });
      } catch {
        /* best-effort */
      }

      const who = meta.name || meta.phone || "a contact";
      const preview = (row.content_text ?? "").trim();
      const title = "New WhatsApp message";
      const body = prefs.message_preview_enabled
        ? `${who}: ${preview.length > 120 ? preview.slice(0, 117) + "…" : preview || "(no text)"}`
        : `New message from ${who}`;
      const target = `/inbox?c=${conversationId}`;

      const tabVisible = document.visibilityState === "visible";

      if (tabVisible) {
        // In-app toast with an Open action.
        toast(title, {
          description: body,
          action: {
            label: "Open",
            onClick: () => routerRef.current.push(target),
          },
        });
      } else if (
        "Notification" in window &&
        Notification.permission === "granted" &&
        prefs.browser_notifications_enabled
      ) {
        try {
          const n = new Notification(title, { body, tag: conversationId });
          n.onclick = () => {
            try {
              window.focus();
            } catch {
              /* ignore */
            }
            routerRef.current.push(target);
            n.close();
          };
        } catch {
          /* Notification construction can throw on some platforms. */
        }
      }

      // Sound (best-effort; throttled internally).
      if (prefs.sound_enabled) playNotificationSound();
    };

    const channel = supabase
      .channel(CHANNEL_NAME)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: "sender_type=eq.customer",
        },
        (payload) => {
          void handleInsert(
            payload.new as {
              id?: string;
              conversation_id?: string;
              content_text?: string | null;
            },
          );
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      try {
        bc?.close();
      } catch {
        /* ignore */
      }
    };
  }, [enabled]);
}
