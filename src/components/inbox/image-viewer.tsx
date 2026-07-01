"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ImageOff,
  Minus,
  Plus,
  RotateCcw,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Message } from "@/types";
import {
  isProxyMediaUrl,
  useResolvedMedia,
} from "@/hooks/use-resolved-media";

/**
 * WhatsApp-style full-screen image viewer for the inbox.
 *
 * State lives at the thread level (via {@link ImageViewerProvider}) so it
 * can navigate prev/next across ALL image messages in the conversation.
 * The active image is keyed by MESSAGE ID, not array index — a realtime
 * message arriving while the viewer is open reshapes the list without
 * hijacking what's on screen.
 *
 * The viewer reuses the SAME `useResolvedMedia` cache the thumbnail uses,
 * so opening it never triggers a second fetch of a proxied image, and the
 * shared object URL survives until both consumers are gone.
 */

interface ImageItem {
  id: string;
  url: string;
  alt: string;
}

interface ImageViewerContextValue {
  /** Open the viewer at a given image message id. */
  openViewer: (messageId: string) => void;
  /** Whether a given message currently participates in the gallery. */
  isViewable: (messageId: string) => boolean;
}

const ImageViewerContext = createContext<ImageViewerContextValue | null>(null);

/** Thumbnail hook — lets a bubble open the viewer for its own message. */
export function useImageViewer(): ImageViewerContextValue {
  const ctx = useContext(ImageViewerContext);
  if (!ctx) {
    // Rendered outside a provider (e.g. isolated tests / storybook) —
    // degrade to a no-op so the thumbnail still renders, just inert.
    return { openViewer: () => {}, isViewable: () => false };
  }
  return ctx;
}

export function ImageViewerProvider({
  messages,
  children,
}: {
  messages: Message[];
  children: ReactNode;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);

  // Ordered gallery of image messages (chronological — same order as the
  // thread). Recomputed as messages change so realtime arrivals join it.
  const images = useMemo<ImageItem[]>(
    () =>
      messages
        .filter((m) => m.content_type === "image" && Boolean(m.media_url))
        .map((m) => ({
          id: m.id,
          url: m.media_url as string,
          alt: m.content_text?.trim() || "Shared image",
        })),
    [messages],
  );

  const viewableIds = useMemo(
    () => new Set(images.map((i) => i.id)),
    [images],
  );

  const openViewer = useCallback((messageId: string) => {
    setActiveId(messageId);
  }, []);

  const isViewable = useCallback(
    (messageId: string) => viewableIds.has(messageId),
    [viewableIds],
  );

  const value = useMemo<ImageViewerContextValue>(
    () => ({ openViewer, isViewable }),
    [openViewer, isViewable],
  );

  return (
    <ImageViewerContext.Provider value={value}>
      {children}
      <ImageViewer
        images={images}
        activeId={activeId}
        onActiveIdChange={setActiveId}
        onClose={() => setActiveId(null)}
      />
    </ImageViewerContext.Provider>
  );
}

const MAX_SCALE = 4;
const MIN_SCALE = 1;

function ImageViewer({
  images,
  activeId,
  onActiveIdChange,
  onClose,
}: {
  images: ImageItem[];
  activeId: string | null;
  onActiveIdChange: (id: string) => void;
  onClose: () => void;
}) {
  const open = activeId !== null;

  // Resolve the active image by id every render — index math would drift
  // when a realtime message reshapes `images` mid-view.
  const activeIndex = images.findIndex((i) => i.id === activeId);
  const active = activeIndex >= 0 ? images[activeIndex] : null;

  const { src, loading, error, retry } = useResolvedMedia(active?.url);

  // ---- zoom / pan state (reset whenever the shown image changes) -------
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const dragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0, tx: 0, ty: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchStart = useRef<{ dist: number; scale: number } | null>(null);

  const resetTransform = useCallback(() => {
    setScale(1);
    setTx(0);
    setTy(0);
  }, []);

  useEffect(() => {
    resetTransform();
  }, [activeId, resetTransform]);

  const zoomBy = useCallback((delta: number) => {
    setScale((s) => {
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, s + delta));
      if (next === MIN_SCALE) {
        setTx(0);
        setTy(0);
      }
      return next;
    });
  }, []);

  const goPrev = useCallback(() => {
    if (activeIndex > 0) onActiveIdChange(images[activeIndex - 1].id);
  }, [activeIndex, images, onActiveIdChange]);

  const goNext = useCallback(() => {
    if (activeIndex >= 0 && activeIndex < images.length - 1) {
      onActiveIdChange(images[activeIndex + 1].id);
    }
  }, [activeIndex, images, onActiveIdChange]);

  // Keyboard: arrows navigate, +/- zoom. Escape is handled by Base UI.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") goPrev();
      else if (e.key === "ArrowRight") goNext();
      else if (e.key === "+" || e.key === "=") zoomBy(0.5);
      else if (e.key === "-") zoomBy(-0.5);
      else if (e.key === "0") resetTransform();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, goPrev, goNext, zoomBy, resetTransform]);

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? 0.3 : -0.3);
    },
    [zoomBy],
  );

  const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.hypot(a.x - b.x, a.y - b.y);

  const onPointerDown = (e: ReactPointerEvent<HTMLImageElement>) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [p1, p2] = [...pointers.current.values()];
      pinchStart.current = { dist: dist(p1, p2), scale };
    } else if (scale > 1) {
      dragging.current = true;
      dragStart.current = { x: e.clientX, y: e.clientY, tx, ty };
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLImageElement>) => {
    if (pointers.current.has(e.pointerId)) {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    if (pointers.current.size === 2 && pinchStart.current) {
      const [p1, p2] = [...pointers.current.values()];
      const ratio = dist(p1, p2) / (pinchStart.current.dist || 1);
      const next = Math.min(
        MAX_SCALE,
        Math.max(MIN_SCALE, pinchStart.current.scale * ratio),
      );
      setScale(next);
      if (next === MIN_SCALE) {
        setTx(0);
        setTy(0);
      }
      return;
    }
    if (dragging.current) {
      setTx(dragStart.current.tx + (e.clientX - dragStart.current.x));
      setTy(dragStart.current.ty + (e.clientY - dragStart.current.y));
    }
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLImageElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchStart.current = null;
    if (pointers.current.size === 0) dragging.current = false;
  };

  // Double-click / double-tap toggles between fit and 2×.
  const onDoubleClick = () => {
    if (scale > 1) resetTransform();
    else setScale(2);
  };

  // ---- download: fetch the resolved bytes, infer extension from the
  // response Content-Type (no MIME is stored on the message row). -------
  const [downloading, setDownloading] = useState(false);
  const doDownload = useCallback(async () => {
    if (!src || !active) return;
    setDownloading(true);
    try {
      const res = await fetch(src);
      const blob = await res.blob();
      const ext = extForType(blob.type) ?? extFromUrl(active.url) ?? "jpg";
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `image-${active.id.slice(0, 8)}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      // Non-fatal — a failed download just leaves the viewer as-is.
    } finally {
      setDownloading(false);
    }
  }, [src, active]);

  const hasPrev = activeIndex > 0;
  const hasNext = activeIndex >= 0 && activeIndex < images.length - 1;
  const position =
    images.length > 1 ? `${activeIndex + 1} / ${images.length}` : "";

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-[100] bg-black/90 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 motion-reduce:animate-none" />
        <DialogPrimitive.Popup
          aria-label="Image viewer"
          className="fixed inset-0 z-[100] flex h-[100dvh] w-screen flex-col outline-none"
        >
          <DialogPrimitive.Title className="sr-only">
            {active?.alt ?? "Image preview"}
          </DialogPrimitive.Title>

          {/* Top control bar */}
          <div className="flex items-center justify-between gap-2 px-3 py-2 text-white/90">
            <span className="min-h-[44px] px-1 text-sm tabular-nums leading-[44px]">
              {position}
            </span>
            <div className="flex items-center gap-1">
              <ViewerButton
                label="Zoom out"
                onClick={() => zoomBy(-0.5)}
                disabled={scale <= MIN_SCALE}
              >
                <Minus />
              </ViewerButton>
              <ViewerButton
                label="Reset zoom"
                onClick={resetTransform}
                disabled={scale === 1 && tx === 0 && ty === 0}
              >
                <RotateCcw />
              </ViewerButton>
              <ViewerButton
                label="Zoom in"
                onClick={() => zoomBy(0.5)}
                disabled={scale >= MAX_SCALE}
              >
                <Plus />
              </ViewerButton>
              <ViewerButton
                label="Download image"
                onClick={doDownload}
                disabled={!src || downloading}
              >
                <Download />
              </ViewerButton>
              <ViewerButton label="Close" onClick={onClose}>
                <X />
              </ViewerButton>
            </div>
          </div>

          {/* Stage — clicking the empty area (self) closes; clicks on the
              image or controls do not. */}
          <div
            className="relative flex flex-1 items-center justify-center overflow-hidden"
            onClick={(e) => {
              if (e.target === e.currentTarget) onClose();
            }}
            onWheel={onWheel}
          >
            {hasPrev && (
              <ViewerButton
                label="Previous image"
                onClick={goPrev}
                className="absolute left-2 top-1/2 -translate-y-1/2"
              >
                <ChevronLeft />
              </ViewerButton>
            )}
            {hasNext && (
              <ViewerButton
                label="Next image"
                onClick={goNext}
                className="absolute right-2 top-1/2 -translate-y-1/2"
              >
                <ChevronRight />
              </ViewerButton>
            )}

            <div
              aria-live="polite"
              className="pointer-events-none absolute inset-0 flex items-center justify-center"
            >
              {loading && (
                <div
                  role="status"
                  aria-label="Loading image"
                  className="h-8 w-8 animate-spin rounded-full border-2 border-white/40 border-t-white motion-reduce:animate-none"
                />
              )}
              {error && (
                <div className="pointer-events-auto flex flex-col items-center gap-3 text-white/80">
                  <ImageOff className="h-10 w-10" />
                  <p className="text-sm">This image couldn&apos;t be loaded.</p>
                  <button
                    type="button"
                    onClick={retry}
                    className="min-h-[44px] rounded-lg bg-white/10 px-4 text-sm font-medium hover:bg-white/20"
                  >
                    Retry
                  </button>
                </div>
              )}
            </div>

            {src && !error && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={src}
                alt={active?.alt ?? "Shared image"}
                draggable={false}
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={onDoubleClick}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                style={{
                  transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
                  cursor:
                    scale > 1 ? (dragging.current ? "grabbing" : "grab") : "auto",
                  touchAction: "none",
                }}
                className={cn(
                  "max-h-full max-w-full select-none object-contain",
                  "motion-safe:transition-transform motion-safe:duration-100",
                )}
              />
            )}
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function ViewerButton({
  label,
  onClick,
  disabled,
  className,
  children,
}: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      disabled={disabled}
      className={cn(
        "inline-flex h-11 w-11 items-center justify-center rounded-full text-white/90",
        "hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white/70",
        "disabled:pointer-events-none disabled:opacity-40",
        "[&_svg]:h-5 [&_svg]:w-5",
        className,
      )}
    >
      {children}
    </button>
  );
}

// image/jpeg → jpg, image/png → png, etc. Kept tiny on purpose.
function extForType(mime: string): string | null {
  if (!mime) return null;
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/heic": "heic",
    "image/svg+xml": "svg",
  };
  return map[mime.toLowerCase()] ?? null;
}

function extFromUrl(url: string): string | null {
  const clean = url.split("?")[0].split("#")[0];
  const m = /\.([a-z0-9]{2,5})$/i.exec(clean);
  // Proxy URLs end in a numeric media id, not an extension — ignore those.
  if (m && !isProxyMediaUrl(url)) return m[1].toLowerCase();
  return null;
}
