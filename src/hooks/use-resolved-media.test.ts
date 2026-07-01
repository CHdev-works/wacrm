import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acquireMedia,
  evictFailedMedia,
  isProxyMediaUrl,
  releaseMedia,
} from "./use-resolved-media";

// The resolver mints/revokes object URLs. jsdom isn't loaded (node env),
// so stub the two DOM APIs the cache touches and count the calls.
let objectUrlSeq = 0;
const revoked: string[] = [];

function installObjectUrl() {
  objectUrlSeq = 0;
  revoked.length = 0;
  URL.createObjectURL = vi.fn(() => `blob:mock-${++objectUrlSeq}`);
  URL.revokeObjectURL = vi.fn((u: string) => {
    revoked.push(u);
  });
}

function okResponse(): Response {
  return {
    ok: true,
    status: 200,
    blob: async () => new Blob(["bytes"]),
  } as unknown as Response;
}

function errResponse(status = 404): Response {
  return {
    ok: false,
    status,
    blob: async () => new Blob([]),
  } as unknown as Response;
}

const PROXY = "/api/whatsapp/media/abc123";
const PUBLIC = "https://cdn.supabase.co/storage/v1/object/public/chat-media/x.jpg";

afterEach(() => {
  // Drain any leftover refs so cross-test state can't leak.
  for (let i = 0; i < 8; i++) {
    releaseMedia(PROXY);
    releaseMedia(PUBLIC);
  }
  vi.restoreAllMocks();
});

describe("isProxyMediaUrl", () => {
  it("flags same-origin proxy URLs and nothing else", () => {
    expect(isProxyMediaUrl(PROXY)).toBe(true);
    expect(isProxyMediaUrl(PUBLIC)).toBe(false);
    expect(isProxyMediaUrl("https://api.whatsapp.com/media/x")).toBe(false);
  });
});

describe("acquireMedia — proxy path", () => {
  it("fetches once, wraps bytes in a blob URL", async () => {
    installObjectUrl();
    const fetchImpl = vi.fn(async () => okResponse());

    const entry = acquireMedia(PROXY, fetchImpl as unknown as typeof fetch);
    const src = await entry.promise;

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(PROXY);
    expect(src).toBe("blob:mock-1");
    expect(entry.src).toBe("blob:mock-1");
    releaseMedia(PROXY);
  });

  it("shares one fetch + blob across two consumers (cache reuse)", async () => {
    installObjectUrl();
    const fetchImpl = vi.fn(async () => okResponse());

    const a = acquireMedia(PROXY, fetchImpl as unknown as typeof fetch);
    const b = acquireMedia(PROXY, fetchImpl as unknown as typeof fetch);
    await Promise.all([a.promise, b.promise]);

    expect(a).toBe(b); // same cached entry
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(objectUrlSeq).toBe(1);
    expect(a.refCount).toBe(2);

    releaseMedia(PROXY);
    releaseMedia(PROXY);
  });

  it("revokes the blob URL only when the LAST consumer releases", async () => {
    installObjectUrl();
    const fetchImpl = vi.fn(async () => okResponse());

    const entry = acquireMedia(PROXY, fetchImpl as unknown as typeof fetch);
    acquireMedia(PROXY, fetchImpl as unknown as typeof fetch);
    await entry.promise;

    releaseMedia(PROXY);
    expect(revoked).toHaveLength(0); // one consumer still holding

    releaseMedia(PROXY);
    expect(revoked).toEqual(["blob:mock-1"]);
  });
});

describe("acquireMedia — direct/public path", () => {
  it("passes the URL through with no fetch and no blob", async () => {
    installObjectUrl();
    const fetchImpl = vi.fn(async () => okResponse());

    const entry = acquireMedia(PUBLIC, fetchImpl as unknown as typeof fetch);
    const src = await entry.promise;

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(src).toBe(PUBLIC);
    expect(entry.blobUrl).toBeNull();

    releaseMedia(PUBLIC);
    expect(revoked).toHaveLength(0); // nothing to revoke
  });
});

describe("error + retry", () => {
  it("marks the entry failed on a non-ok response", async () => {
    installObjectUrl();
    const fetchImpl = vi.fn(async () => errResponse(404));

    const entry = acquireMedia(PROXY, fetchImpl as unknown as typeof fetch);
    await expect(entry.promise).rejects.toThrow(/Failed to load media/);
    expect(entry.error).toBe(true);
    releaseMedia(PROXY);
  });

  it("evictFailedMedia drops a poisoned entry so the next acquire refetches", async () => {
    installObjectUrl();
    const failing = vi.fn(async () => errResponse(410));
    const first = acquireMedia(PROXY, failing as unknown as typeof fetch);
    await expect(first.promise).rejects.toThrow();
    releaseMedia(PROXY);

    evictFailedMedia(PROXY);

    const succeeding = vi.fn(async () => okResponse());
    const second = acquireMedia(PROXY, succeeding as unknown as typeof fetch);
    expect(second).not.toBe(first); // fresh entry
    await expect(second.promise).resolves.toBe("blob:mock-1");
    expect(succeeding).toHaveBeenCalledTimes(1);
    releaseMedia(PROXY);
  });

  it("evictFailedMedia leaves a healthy entry untouched", async () => {
    installObjectUrl();
    const fetchImpl = vi.fn(async () => okResponse());
    const entry = acquireMedia(PROXY, fetchImpl as unknown as typeof fetch);
    await entry.promise;

    evictFailedMedia(PROXY); // no-op — not errored
    const again = acquireMedia(PROXY, fetchImpl as unknown as typeof fetch);
    expect(again).toBe(entry);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    releaseMedia(PROXY);
    releaseMedia(PROXY);
  });
});
