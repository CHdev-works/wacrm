import * as React from "react";
import { ExternalLink } from "lucide-react";

/**
 * Turn URLs inside free-form message text into safe, clickable links.
 *
 * Message text is ATTACKER-CONTROLLED (it comes from WhatsApp customers),
 * so this helper never builds HTML strings and never uses
 * `dangerouslySetInnerHTML` — it returns an interleaving of plain strings
 * and `<a>` React nodes. React escapes the string segments, so there is
 * no XSS surface.
 *
 * What becomes a link:
 *   - explicit `http://` / `https://` URLs
 *   - `www.`-prefixed hosts (href gets an `https://` prefix; the visible
 *     text stays exactly as typed)
 *
 * What does NOT (hard requirement — avoids false positives):
 *   - scheme-less bare domains (`example.com`), phone numbers, order
 *     numbers (`#12345`), decimals (`3.14`), filenames (`report.pdf`)
 *
 * Every candidate href is validated with `new URL()` and only `http:` /
 * `https:` protocols are allowed — `javascript:`, `data:`, `file:`, etc.
 * are rejected and rendered as plain text. The regex is a single linear
 * alternation (no nested quantifiers) so adversarial input can't trigger
 * catastrophic backtracking, and the whole thing is wrapped so it can
 * never throw a broken bubble (see {@link LinkifiedText}).
 */

// Linear, no nested quantifiers. `[^\s]+` is a single greedy run.
const URL_PATTERN = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;

// Trailing characters that are almost always sentence punctuation, not
// part of the URL. Peeled back into plain text (e.g. `…example.com.`).
const TRAILING_PUNCT = ".,;:!?\"'“”‘’";

const CLOSERS: Record<string, string> = { ")": "(", "]": "[", "}": "{" };

function countChar(s: string, ch: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s[i] === ch) n++;
  return n;
}

/**
 * Split a raw match into the real URL and any trailing punctuation.
 * A closing bracket is only peeled when it's unbalanced within the URL,
 * so links like `…wiki/Foo_(bar)` keep their closing paren.
 */
function splitTrailingPunctuation(raw: string): {
  url: string;
  trailing: string;
} {
  let end = raw.length;
  while (end > 0) {
    const ch = raw[end - 1];
    if (ch in CLOSERS) {
      const slice = raw.slice(0, end);
      if (countChar(slice, ch) > countChar(slice, CLOSERS[ch])) {
        end -= 1;
        continue;
      }
      break;
    }
    if (TRAILING_PUNCT.includes(ch)) {
      end -= 1;
      continue;
    }
    break;
  }
  return { url: raw.slice(0, end), trailing: raw.slice(end) };
}

/**
 * Build a validated href, or null if the candidate isn't a safe
 * http(s) URL. `www.` candidates are prefixed with `https://`.
 */
function toSafeHref(candidate: string): string | null {
  const href = /^www\./i.test(candidate) ? `https://${candidate}` : candidate;
  try {
    const parsed = new URL(href);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return href;
    }
    return null;
  } catch {
    return null;
  }
}

// Returns a host `<a>` element (not a wrapper component) so its href /
// target / rel are directly inspectable in tests.
function renderAnchor(
  href: string,
  text: string,
  key: number,
): React.ReactElement {
  return (
    <a
      key={key}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={href}
      // Clicking a link inside an image/video caption must open the link,
      // NOT the image viewer the caption sits next to.
      onClick={(e) => e.stopPropagation()}
      className="hover:opacity-80"
    >
      <span className="underline underline-offset-2">{text}</span>
      <ExternalLink
        aria-hidden="true"
        className="ml-0.5 inline h-3 w-3 align-[-0.125em]"
      />
    </a>
  );
}

/**
 * Pure helper: `linkify(text)` → React nodes (strings + `<a>` elements).
 * Returns the input untouched for empty/undefined text.
 */
export function linkify(text: string | null | undefined): React.ReactNode {
  if (!text) return text ?? null;

  const nodes: React.ReactNode[] = [];
  const re = new RegExp(URL_PATTERN.source, "gi"); // fresh state per call
  let lastIndex = 0;
  let key = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(text)) !== null) {
    const raw = match[0];
    const start = match.index;

    if (start > lastIndex) nodes.push(text.slice(lastIndex, start));

    const { url, trailing } = splitTrailingPunctuation(raw);
    const href = toSafeHref(url);

    if (href) {
      nodes.push(renderAnchor(href, url, key++));
      if (trailing) nodes.push(trailing);
    } else {
      // Not a safe link — emit the whole match as plain text.
      nodes.push(raw);
    }

    lastIndex = start + raw.length;
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));

  return nodes;
}

/**
 * Component wrapper with a hard safety net: if `linkify` ever throws on
 * some pathological input, fall back to the raw text so a bad link can
 * never produce a broken message bubble.
 */
export function LinkifiedText({
  text,
}: {
  text: string | null | undefined;
}) {
  // Resolve the nodes inside the try, construct JSX outside it, so a
  // pathological input falls back to raw text instead of a broken bubble.
  let nodes: React.ReactNode;
  try {
    nodes = linkify(text);
  } catch {
    nodes = text ?? null;
  }
  return <>{nodes}</>;
}
