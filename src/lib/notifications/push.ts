/**
 * Web Push client helpers — Phase C scaffold.
 *
 * These register the service worker and create a PushSubscription, then
 * persist it to `web_push_subscriptions` (migration 028). They are
 * exported but intentionally **not called anywhere yet** — turning Web
 * Push on is documented in docs/notifications.md → "Enabling Web Push
 * later".
 *
 * Server send-path (not built — outline only):
 *   1. Generate a VAPID keypair: `npx web-push generate-vapid-keys`.
 *      Put the public key in NEXT_PUBLIC_VAPID_PUBLIC_KEY and the private
 *      key in VAPID_PRIVATE_KEY (server-only); set VAPID_SUBJECT
 *      (`mailto:...`).
 *   2. In the inbound webhook (src/app/api/whatsapp/webhook/route.ts),
 *      at the same fan-out point where automations/flows dispatch, load
 *      every active `web_push_subscriptions` row for the account
 *      (service-role client) and send each a VAPID-signed push with the
 *      `web-push` package.
 *   3. On a 404/410 response from the push service, stamp `revoked_at`
 *      on that row so the sender skips it next time.
 *   4. Gate every send through the SAME `shouldNotifyForConversation`
 *      decision used client-side, plus the recipient's stored prefs, so
 *      push honours assigned-only / quiet-hours like the in-app path.
 */

import { createClient } from "@/lib/supabase/client";

/** Convert a base64url VAPID public key to the Uint8Array the
 *  PushManager expects as `applicationServerKey`. */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  // Back the view with a concrete ArrayBuffer so the type is
  // Uint8Array<ArrayBuffer> (a valid BufferSource for applicationServerKey).
  const buffer = new ArrayBuffer(raw.length);
  const output = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

/** Register the service worker. Returns the registration, or null if
 *  service workers are unavailable. */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return null;
  }
  try {
    return await navigator.serviceWorker.register("/sw.js");
  } catch (err) {
    console.error("[push] service worker registration failed:", err);
    return null;
  }
}

/**
 * Subscribe this browser to Web Push and persist the subscription to
 * `web_push_subscriptions`. Requires NEXT_PUBLIC_VAPID_PUBLIC_KEY and a
 * granted Notification permission. Returns true on success.
 */
export async function subscribeToPush(accountId: string): Promise<boolean> {
  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapidPublicKey) {
    console.warn("[push] NEXT_PUBLIC_VAPID_PUBLIC_KEY is not set");
    return false;
  }
  if (typeof window === "undefined" || !("PushManager" in window)) return false;

  const registration = await registerServiceWorker();
  if (!registration) return false;

  try {
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    });

    const json = subscription.toJSON();
    const keys = json.keys ?? {};
    const supabase = createClient();
    // RLS requires the row's user_id to be the caller (auth.uid()).
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return false;
    const { error } = await supabase.from("web_push_subscriptions").upsert(
      {
        user_id: user.id,
        account_id: accountId,
        endpoint: subscription.endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        user_agent:
          typeof navigator !== "undefined" ? navigator.userAgent : null,
        last_seen_at: new Date().toISOString(),
        revoked_at: null,
      },
      { onConflict: "endpoint" },
    );
    if (error) {
      console.error("[push] failed to persist subscription:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[push] subscribe failed:", err);
    return false;
  }
}
