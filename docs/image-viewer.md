# Chat image viewer

A WhatsApp-style lightbox for image messages in the inbox thread. Click
any image bubble to open the full image, centered and uncropped, over a
dimmed full-screen backdrop.

## What it does

- **Click / keyboard to open** — image thumbnails are real `<button>`
  triggers (Enter/Space, `aria-label`, focus ring). The thumbnail's
  existing look and loading/error behavior are unchanged.
- **Zoom & pan** — `+`/`-`/reset buttons, mouse wheel, pinch, and
  double-tap; drag to pan when zoomed. Keyboard: `+`/`-`/`0`.
- **Prev / next** — steps through *only the current conversation's*
  image messages in chronological order (`←`/`→`). The active image is
  keyed by **message id**, so a realtime message arriving while the
  viewer is open never hijacks what's on screen.
- **Download** — fetches the already-resolved bytes and saves them; the
  file extension is inferred from the response `Content-Type` (message
  rows store no MIME), falling back to the URL extension, then `.jpg`.
- **Close** — ✕ button, `Escape`, or clicking the dimmed area outside
  the image (clicks on the image/controls don't close). Focus returns
  to the thumbnail that opened it.
- **States** — spinner while resolving; an error card with **Retry** if
  the image can't load (e.g. expired Meta media).
- **A11y / mobile** — `role="dialog"` + `aria-modal` via Base UI (focus
  trap, scroll lock, focus restore), `aria-live` status, `prefers-
  reduced-motion` respected, full-screen `dvh` sizing, ≥44px touch
  targets, tap-outside-to-close.

## How media resolves (two URL shapes)

| Direction | `media_url` shape | How it loads |
|---|---|---|
| Inbound (customer) | `/api/whatsapp/media/<mediaId>` (same-origin proxy) | Credentialed `fetch` → `blob:` object URL. The route decrypts the WhatsApp token **server-side** and streams Meta's bytes; the token never reaches the browser. |
| Outbound (agent/bot) | Public Supabase Storage `chat-media` URL | Used directly as `<img src>`. |

The thumbnail already loads the full-resolution image (there is no
separate thumbnail asset), so the viewer just displays the same source
larger. Both consumers go through **`src/hooks/use-resolved-media.ts`**,
a module-level ref-counted cache keyed by `media_url`:

- proxy URL → fetched once; the blob URL is shared by thumbnail + viewer;
- public URL → pure passthrough (no fetch, no blob);
- the object URL is revoked only when the **last** consumer unmounts.

## Files

- `src/hooks/use-resolved-media.ts` — shared resolver + ref-counted cache.
- `src/components/inbox/image-viewer.tsx` — `ImageViewerProvider` (thread
  level, derives the image list) + the lightbox.
- `src/components/inbox/message-bubble.tsx` — `MediaImage` now uses the
  resolver and is a clickable trigger.
- `src/components/inbox/message-thread.tsx` — wraps the thread in
  `ImageViewerProvider messages={messages}`.

## Testing

Automated:

```bash
npm run lint && npm run typecheck && npm run test && npm run build
```

`src/hooks/use-resolved-media.test.ts` covers the proxy fetch→blob path,
the direct-URL passthrough, cache reuse across consumers, revoke-only-
when-unused, and the error/retry eviction path.

Manual (in the inbox):

1. Open an **inbound** image — no second network request fires (check
   DevTools ▸ Network; the proxy `/api/whatsapp/media/...` is hit once).
2. Open an **outbound** image — loads directly.
3. Close via ✕, `Escape`, and clicking outside the image — but clicking
   **on** the image does not close.
4. Prev/next + `←`/`→` stay within the conversation's images.
5. Download names the file correctly for both URL types.
6. Loading spinner and the error card (e.g. an expired Meta media id)
   behave; Retry re-fetches.
7. A logged-out or other-account user still cannot load an inbound image
   (the media proxy 401/403s).
8. Mobile: full-screen, no background scroll, controls reachable, not
   trapped under the composer/header.
9. Video / audio / document / template / location bubbles are unchanged.

## Follow-ups (not implemented)

- **Per-media authorization on the proxy.** `GET
  /api/whatsapp/media/[mediaId]` currently authorizes by *authenticated
  + your account has a `whatsapp_config`*; it does not verify the
  specific `mediaId` belongs to a conversation in the caller's account.
  This viewer adds no new access path (it only shows media already in an
  authorized conversation), but tightening the route to check
  message/account ownership of the media id would be a defense-in-depth
  improvement.
- **Server-side thumbnails** for very large threads, to avoid loading
  full-resolution bytes for off-screen images.
