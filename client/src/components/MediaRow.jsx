import { mediaKey, posterUrl, titleText, metaLine } from "../lib/api.js";

export default function MediaRow({ title, items = [], loading = false, onPick }) {
  return (
    <section className="media-row">
      <div className="media-row-head">
        <h2>{title}</h2>
      </div>
      <div className="media-rail" dir="ltr">
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
                {poster ? <img src={poster} alt="" loading="lazy" /> : <div className="skeleton-poster" />}
                <span className="tile-play" aria-hidden>
                  ▶
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
