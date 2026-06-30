/**
 * Notification sound — a short two-tone sine "blip" synthesised with the
 * Web Audio API so no binary asset ships in git.
 *
 * Fully best-effort: browsers block audio until the user has interacted
 * with the page (autoplay policy), and AudioContext can be unavailable
 * in some environments — every path is wrapped so a failure is silent,
 * never thrown.
 */

// Reuse one AudioContext across plays — creating one per beep leaks them
// and eventually hits the per-page context limit.
let audioCtx: AudioContext | null = null;

// Throttle bursts: if ten messages land at once we play once, not ten
// times. Module-level so it spans every caller in the tab.
let lastPlayedAt = 0;
const MIN_GAP_MS = 3_000;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return null;
    if (!audioCtx) audioCtx = new Ctor();
    return audioCtx;
  } catch {
    return null;
  }
}

/**
 * Play the notification blip, unless one played within the last 3s.
 * Safe to call from anywhere; no-ops on any failure.
 */
export function playNotificationSound(): void {
  try {
    const now = Date.now();
    if (now - lastPlayedAt < MIN_GAP_MS) return;

    const ctx = getContext();
    if (!ctx) return;
    // A tab that was backgrounded can leave the context suspended;
    // resume is async and best-effort.
    if (ctx.state === "suspended") void ctx.resume();

    lastPlayedAt = now;

    const start = ctx.currentTime;
    // Two short descending sine tones — pleasant, not alarming.
    const tones = [
      { freq: 880, at: 0, dur: 0.12 },
      { freq: 660, at: 0.12, dur: 0.16 },
    ];
    for (const t of tones) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = t.freq;
      // Quick attack + exponential release so it doesn't click.
      const t0 = start + t.at;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.18, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + t.dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + t.dur + 0.02);
    }
  } catch {
    // Autoplay blocked / context error — stay silent.
  }
}
