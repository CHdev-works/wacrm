/**
 * Substitute positional template variables ({{1}}, {{2}}, …) in a
 * template body with the per-recipient values resolved at send time.
 *
 * Used by the broadcast sender to persist `rendered_body` on each
 * broadcast_recipients row — the exact text the recipient received — so
 * the background mirror job can drop it into their 1:1 chat thread.
 *
 * Pure + dependency-free so it's trivially unit-testable and safe to run
 * client-side during the send loop (no extra round-trips → keeps the
 * send path lean).
 */
export function renderTemplateBody(
  bodyText: string,
  params: readonly string[],
): string {
  if (!bodyText) return '';
  return bodyText.replace(/\{\{\s*(\d+)\s*\}\}/g, (_match, n: string) => {
    const idx = Number(n) - 1;
    const value = params[idx];
    // Missing value → empty string (matches how Meta renders an
    // unsupplied positional parameter); never leave the raw {{n}}.
    return value ?? '';
  });
}
