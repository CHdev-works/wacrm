/**
 * Favicon unread badge — overlays a small red dot on the page favicon
 * while there are unread messages, and restores the original on clear.
 *
 * Entirely best-effort and guarded: if anything fails (no <link>, canvas
 * blocked, cross-origin icon) it silently no-ops. The tab-title
 * indicator is the primary signal; this is a nice-to-have on top.
 */

// The original icon href, captured once so we can restore it on hide.
let originalHref: string | null = null;
let captured = false;
// Last state we applied, so repeated calls with the same value are cheap.
let currentlyBadged = false;

function findIconLink(): HTMLLinkElement | null {
  if (typeof document === "undefined") return null;
  let link = document.querySelector<HTMLLinkElement>(
    'link[rel~="icon"]',
  );
  if (!link) {
    // No explicit icon link (Next can serve /favicon.ico implicitly) —
    // create one we can drive.
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  return link;
}

function restore(link: HTMLLinkElement): void {
  if (originalHref) link.href = originalHref;
}

/**
 * Show or hide the unread dot on the favicon.
 * @param show true to draw the badge, false to restore the original icon.
 */
export function setFaviconBadge(show: boolean): void {
  try {
    if (typeof document === "undefined") return;
    if (show === currentlyBadged) return;

    const link = findIconLink();
    if (!link) return;

    if (!captured) {
      // Fall back to the conventional path if the link has no href yet.
      originalHref = link.href || "/favicon.ico";
      captured = true;
    }

    if (!show) {
      restore(link);
      currentlyBadged = false;
      return;
    }

    const size = 32;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const drawDot = () => {
      const r = size * 0.28;
      const cx = size - r - 1;
      const cy = r + 1;
      // White ring for contrast against any icon, then the red dot.
      ctx.beginPath();
      ctx.arc(cx, cy, r + 1.5, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = "#ef4444";
      ctx.fill();
      try {
        link.href = canvas.toDataURL("image/png");
        currentlyBadged = true;
      } catch {
        // toDataURL can throw if the canvas is tainted — give up quietly.
      }
    };

    const img = new Image();
    // Draw the badge over the original icon if it loads same-origin;
    // otherwise draw the dot on a transparent canvas as a fallback.
    img.onload = () => {
      try {
        ctx.clearRect(0, 0, size, size);
        ctx.drawImage(img, 0, 0, size, size);
      } catch {
        // cross-origin / decode failure — dot-only fallback.
      }
      drawDot();
    };
    img.onerror = () => drawDot();
    if (originalHref) img.src = originalHref;
    else drawDot();
  } catch {
    // Any DOM/canvas failure — leave the favicon untouched.
  }
}
