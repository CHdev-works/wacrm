"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Shared, ref-counted resolver for chat media URLs.
 *
 * Two URL shapes flow through the inbox (see `message-bubble.tsx`):
 *
 *   1. Inbound (customer) images are stored as a same-origin PROXY url
 *      `/api/whatsapp/media/<mediaId>`. That route authenticates the
 *      caller, decrypts the WhatsApp token SERVER-SIDE, downloads the
 *      bytes from Meta and streams them back. The browser must fetch it
 *      with credentials and wrap the bytes in an object URL — a plain
 *      `<img src>` can't send the auth cookie/headers the route needs.
 *
 *   2. Outbound (agent/bot) images are PUBLIC Supabase Storage urls in
 *      the `chat-media` bucket. Those are used verbatim as `<img src>`.
 *
 * The thumbnail in the bubble AND the full-screen viewer both want the
 * SAME resolved source. Without sharing, opening the viewer would fire a
 * second Meta round-trip and mint a second blob — and unmounting either
 * consumer could revoke the object URL out from under the other. This
 * module keeps one entry per `media_url`, ref-counted, so:
 *
 *   - the proxy fetch happens once and both consumers share the blob URL;
 *   - the object URL is revoked ONLY when the last consumer unmounts;
 *   - public/direct URLs are a pure passthrough (no fetch, no blob).
 *
 * The cache primitives (`acquireMedia` / `releaseMedia`) are exported so
 * they can be unit-tested in the node test env with a mocked `fetch` and
 * `URL.createObjectURL`.
 */

const PROXY_PREFIX = "/api/whatsapp/media/";

/** True for inbound proxy URLs that need a credentialed fetch → blob. */
export function isProxyMediaUrl(url: string): boolean {
  return url.startsWith(PROXY_PREFIX);
}

interface MediaEntry {
  /** Number of live consumers (thumbnail + viewer + …). */
  refCount: number;
  /** Displayable source once resolved: object URL or the direct URL. */
  src: string | null;
  /** The object URL to revoke on eviction; null for passthrough URLs. */
  blobUrl: string | null;
  /** Resolves to the displayable source; rejects on load failure. */
  promise: Promise<string>;
  /** Sticky failure flag so retry can evict a poisoned entry. */
  error: boolean;
}

const cache = new Map<string, MediaEntry>();

function createEntry(url: string, fetchImpl: typeof fetch): MediaEntry {
  // Direct/public URL — nothing to fetch, nothing to revoke.
  if (!isProxyMediaUrl(url)) {
    return {
      refCount: 0,
      src: url,
      blobUrl: null,
      promise: Promise.resolve(url),
      error: false,
    };
  }

  const entry: MediaEntry = {
    refCount: 0,
    src: null,
    blobUrl: null,
    promise: Promise.resolve(""), // replaced synchronously below
    error: false,
  };

  entry.promise = (async () => {
    const res = await fetchImpl(url);
    if (!res.ok) {
      throw new Error(`Failed to load media (${res.status})`);
    }
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    // A consumer may have released while the fetch was in flight; if so
    // the entry was evicted and this blob would leak. Revoke it.
    if (!cache.has(url)) {
      URL.revokeObjectURL(blobUrl);
      return blobUrl;
    }
    entry.blobUrl = blobUrl;
    entry.src = blobUrl;
    return blobUrl;
  })();

  entry.promise.catch(() => {
    entry.error = true;
  });

  return entry;
}

/**
 * Increment the ref-count for `url`, creating (and starting to resolve)
 * a cache entry if this is the first consumer. Returns the entry so the
 * caller can await `promise` / read the already-resolved `src`.
 */
export function acquireMedia(
  url: string,
  fetchImpl: typeof fetch = fetch,
): MediaEntry {
  let entry = cache.get(url);
  if (!entry) {
    entry = createEntry(url, fetchImpl);
    cache.set(url, entry);
  }
  entry.refCount += 1;
  return entry;
}

/**
 * Decrement the ref-count for `url`. When it reaches zero the entry is
 * evicted and any object URL it minted is revoked.
 */
export function releaseMedia(url: string): void {
  const entry = cache.get(url);
  if (!entry) return;
  entry.refCount -= 1;
  if (entry.refCount <= 0) {
    if (entry.blobUrl) URL.revokeObjectURL(entry.blobUrl);
    cache.delete(url);
  }
}

/**
 * Drop a failed entry so the next `acquireMedia` re-fetches from scratch.
 * No-op for entries that resolved successfully or are still in flight.
 */
export function evictFailedMedia(url: string): void {
  const entry = cache.get(url);
  if (entry && entry.error) {
    if (entry.blobUrl) URL.revokeObjectURL(entry.blobUrl);
    cache.delete(url);
  }
}

/**
 * Non-mutating read of an already-cached entry — used during render to
 * show a cached image immediately (no spinner flash) when another
 * consumer already resolved it. Does not touch the ref-count.
 */
export function peekMedia(url: string): { src: string | null; error: boolean } | null {
  const entry = cache.get(url);
  if (!entry) return null;
  return { src: entry.src, error: entry.error };
}

interface ResolvedMedia {
  /** Displayable `<img src>` once resolved, else null. */
  src: string | null;
  loading: boolean;
  error: boolean;
  /** Re-attempt a failed resolve. */
  retry: () => void;
}

/**
 * Resolve a chat `media_url` to something an `<img>` can display, sharing
 * one ref-counted fetch/blob across every consumer of the same URL.
 */
export function useResolvedMedia(
  url: string | null | undefined,
): ResolvedMedia {
  // Only the async resolution result is stored; loading is DERIVED during
  // render (see below) so the effect never calls setState synchronously.
  const [resolved, setResolved] = useState<{
    url: string;
    src: string | null;
    error: boolean;
  }>({ url: "", src: null, error: false });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!url) return;

    let active = true;
    const entry = acquireMedia(url);

    entry.promise
      .then((src) => {
        if (active) setResolved({ url, src, error: false });
      })
      .catch(() => {
        if (active) setResolved({ url, src: null, error: true });
      });

    return () => {
      active = false;
      releaseMedia(url);
    };
  }, [url, attempt]);

  const retry = useCallback(() => {
    if (url) evictFailedMedia(url);
    setAttempt((a) => a + 1);
  }, [url]);

  if (!url) return { src: null, loading: false, error: false, retry };

  // Prefer the state settled for THIS url; otherwise peek the shared cache
  // (another consumer may already hold a resolved blob → no flash); else
  // we're still loading.
  const settled = resolved.url === url ? resolved : peekMedia(url);
  const src = settled?.src ?? null;
  const error = settled?.error ?? false;
  const loading = src === null && !error;

  return { src, loading, error, retry };
}
