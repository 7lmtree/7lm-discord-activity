import { useEffect, useRef } from "react";
import { mediaKey, posterUrl, titleText, metaLine } from "../lib/api.js";
import { IconPlay } from "./Icons.jsx";

/**
 * Horizontal rails inside Discord's iframe often fail native pan (touch-action
 * on tiles, nested grid min-width, no mouse-drag). Bind wheel + pointer drag
 * so the rail scrolls even when the host captures gestures poorly.
 */
function useRailScroll(railRef) {
  useEffect(() => {
    const el = railRef.current;
    if (!el) return undefined;

    const onWheel = (e) => {
      if (el.scrollWidth <= el.clientWidth + 1) return;
      // Map vertical wheel (and shift-wheel) onto the rail; keep native deltaX.
      const dx = e.deltaX !== 0 ? e.deltaX : e.deltaY;
      if (dx === 0) return;
      e.preventDefault();
      el.scrollBy({ left: dx, behavior: "auto" });
    };

    let dragging = false;
    let moved = false;
    let pointerId = null;
    let startX = 0;
    let startScroll = 0;

    const onPointerDown = (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      // Let real touch use native pan-x when available; still support pen/mouse drag.
      if (e.pointerType === "touch") return;
      dragging = true;
      moved = false;
      pointerId = e.pointerId;
      startX = e.clientX;
      startScroll = el.scrollLeft;
      el.classList.add("is-dragging");
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    };

    const onPointerMove = (e) => {
      if (!dragging || e.pointerId !== pointerId) return;
      const dx = e.clientX - startX;
      if (Math.abs(dx) > 4) moved = true;
      el.scrollLeft = startScroll - dx;
    };

    const endDrag = (e) => {
      if (!dragging || (e && e.pointerId !== pointerId)) return;
      dragging = false;
      pointerId = null;
      el.classList.remove("is-dragging");
      if (moved) {
        el.dataset.suppressClick = "1";
        window.setTimeout(() => {
          delete el.dataset.suppressClick;
        }, 0);
      }
    };

    const onClickCapture = (e) => {
      if (el.dataset.suppressClick === "1") {
        e.preventDefault();
        e.stopPropagation();
        delete el.dataset.suppressClick;
      }
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", endDrag);
    el.addEventListener("pointercancel", endDrag);
    el.addEventListener("lostpointercapture", endDrag);
    el.addEventListener("click", onClickCapture, true);

    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", endDrag);
      el.removeEventListener("pointercancel", endDrag);
      el.removeEventListener("lostpointercapture", endDrag);
      el.removeEventListener("click", onClickCapture, true);
    };
  }, [railRef]);
}

export default function MediaRow({
  title,
  items = [],
  loading = false,
  onPick,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
}) {
  const railRef = useRef(null);
  useRailScroll(railRef);

  return (
    <section className="media-row">
      <div className="media-row-head">
        <h2>{title}</h2>
        {hasMore && (
          <button
            type="button"
            className="ghost load-more-btn"
            disabled={loadingMore}
            onClick={() => onLoadMore?.()}
          >
            {loadingMore ? "…" : "المزيد"}
          </button>
        )}
      </div>
      <div className="media-rail" dir="rtl" ref={railRef}>
        {loading &&
          !items.length &&
          Array.from({ length: 8 }).map((_, i) => (
            <div key={`sk-${title}-${i}`} className="tile skeleton-card" aria-hidden>
              <div className="skeleton-poster" />
            </div>
          ))}
        {items.map((item) => {
          const poster = posterUrl(item);
          return (
            <button
              key={mediaKey(item)}
              type="button"
              className="tile"
              onClick={() => onPick?.(item)}
            >
              <div className="tile-art">
                {poster ? (
                  <img src={poster} alt="" loading="lazy" draggable={false} />
                ) : (
                  <div className="skeleton-poster" />
                )}
                <span className="tile-play" aria-hidden>
                  <IconPlay size={18} />
                </span>
              </div>
              <p className="tile-title">{titleText(item)}</p>
              <p className="tile-meta">{metaLine(item)}</p>
            </button>
          );
        })}
      </div>
    </section>
  );
}
