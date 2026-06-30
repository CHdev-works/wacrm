/*
 * wacrm service worker — Web Push (Phase C scaffold).
 *
 * This handles `push` (show an OS notification) and `notificationclick`
 * (focus an existing tab or open the inbox at the right conversation).
 *
 * It is NOT registered automatically. Full Web Push is wired later — see
 * docs/notifications.md → "Enabling Web Push later". Until then this file
 * just sits in /public, inert, so the registration + server send-path can
 * be turned on without shipping new static assets.
 */

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "New WhatsApp message", body: "" };
  }

  const title = payload.title || "New WhatsApp message";
  const options = {
    body: payload.body || "",
    tag: payload.tag || payload.conversationId || "wacrm-message",
    data: { url: payload.url || "/inbox" },
    icon: payload.icon || "/icon",
    badge: payload.badge || "/icon",
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl =
    (event.notification.data && event.notification.data.url) || "/inbox";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        // Focus an existing wacrm tab and navigate it if possible.
        for (const client of clientList) {
          if ("focus" in client) {
            client.focus();
            if ("navigate" in client) {
              try {
                client.navigate(targetUrl);
              } catch {
                /* cross-origin / navigation blocked — ignore */
              }
            }
            return;
          }
        }
        // No open tab — open a new one.
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
      }),
  );
});
