# Clickable links in chat messages

URLs inside message text render as safe, clickable links that open in a
new tab, so agents no longer copy/paste them by hand.

## What gets linked

- Explicit `http://` and `https://` URLs.
- `www.`-prefixed hosts — the href gets an `https://` prefix; the visible
  text stays exactly as typed.

## What does NOT get linked (no false positives)

Scheme-less bare domains (`example.com`), phone numbers, order numbers
(`#12345`), decimals (`3.14`), and filenames (`report.pdf`). Only
explicit `http(s)`/`www.` become links.

## Behavior

- **New tab, safe rel** — every anchor has `target="_blank"` and
  `rel="noopener noreferrer"` (no tab-nabbing, no referrer leak) plus a
  `title={href}` tooltip.
- **Href validation** — each candidate is parsed with `new URL()` and
  only `http:` / `https:` are allowed. `javascript:`, `data:`,
  `vbscript:`, `file:`, or any parse failure → rendered as plain text.
- **Trailing punctuation** — `https://example.com.` links
  `https://example.com` and leaves the `.` as text; `,`/`;`/`:`/`!`/`?`,
  quotes, and unbalanced `)`/`]`/`}` are trimmed too (a balanced closing
  paren, e.g. a Wikipedia `..._(bar)` URL, is kept).
- **Formatting preserved** — surrounding text, spacing, line breaks
  (rendered into the same `whitespace-pre-wrap` containers), and emoji
  are untouched. Multiple URLs in one message all link.
- **Styling** — the link text is underlined with a small external-link
  icon after it; the color inherits the bubble's text color so it reads
  on both inbound and outbound bubbles. Long URLs still wrap.
- **No conflict with the image viewer** — a link in an image/video
  caption stops click propagation, so clicking the link opens the link
  while tapping the image still opens the viewer.

## Where it applies

Applied to free **body text** only: text messages, image/video captions,
template bodies, interactive-reply text, and the default fallback.

Left as **plain text**: document filenames, location labels, the
reply-quote preview, and the conversation-list last-message preview.

## Security

Message text is treated as attacker-controlled (it comes from
customers). The helper returns **React nodes only** — an interleaving of
plain strings and `<a>` elements — and never uses
`dangerouslySetInnerHTML` or builds HTML strings, so React escapes all
text and there is no XSS surface. The URL regex is a single linear
alternation (no nested quantifiers) to avoid catastrophic backtracking,
and `LinkifiedText` wraps the call in a try/catch that falls back to raw
text, so a pathological message can never produce a broken bubble.

## Files

- `src/lib/linkify.tsx` — `linkify(text): React.ReactNode` (pure) +
  `LinkifiedText` wrapper (try/catch fallback).
- `src/components/inbox/message-bubble.tsx` — body-text renders now use
  `<LinkifiedText text={...} />`.

## Testing

Automated:

```bash
npm run lint && npm run typecheck && npm run test && npm run build
```

`src/lib/linkify.test.tsx` covers: single http/https link; `www.` →
`https://` href with visible text preserved; multiple links; query /
fragment preserved; trailing punctuation trimmed; balanced paren kept;
scheme-less domain / phone / order number / decimal / filename NOT
linked; `javascript:`/`data:`/`vbscript:`/`file:` rejected; newlines and
emoji preserved; empty/undefined text; every anchor has `target="_blank"`
+ `rel="noopener noreferrer"`; and that it never throws on adversarial
input.

Manual (in the inbox):

1. Send/receive a message with a link — inbound and outbound both
   clickable, open in a new tab.
2. Multiple links in one message all work.
3. `www.example.com` opens `https://example.com`.
4. `https://example.com.` — the trailing dot is not part of the link.
5. A link in an image caption opens the link; tapping the image still
   opens the viewer.
6. Emoji, line breaks, and spacing are unchanged.
7. Phone numbers / order numbers / `report.pdf` are NOT linked.
8. Reply-quote and conversation-list previews stay plain text.
9. On mobile, links are tappable and long URLs wrap.
10. Reactions, reply, and the image viewer still work.
