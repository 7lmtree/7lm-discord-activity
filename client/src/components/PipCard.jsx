import { IconPause, IconPlay } from "./Icons.jsx";

export default function PipCard({
  title,
  poster,
  peopleCount = 0,
  season,
  episode,
  playing = false,
  isHost = false,
  onTogglePlay,
}) {
  const ep =
    season != null && episode != null
      ? `م${season} ح${episode}`
      : episode != null
        ? `ح${episode}`
        : "";

  return (
    <section className="pip-card" aria-label="تصغير الأكتيفتي">
      <img className="pip-card-art" src={poster || "/art/pip.jpg"} alt="" draggable={false} />
      <div className="pip-card-shade" aria-hidden />
      <div className="pip-card-meta">
        <span className="pip-badge">7LM Movie</span>
        <strong>{title || "7LM Movie"}</strong>
        {(ep || peopleCount > 0) && (
          <em>
            {[ep, peopleCount > 0 ? `${peopleCount} يشاهدون` : ""].filter(Boolean).join(" · ")}
          </em>
        )}
        {isHost && title && (
          <div className="pip-controls">
            <button
              type="button"
              className="pip-play"
              aria-label={playing ? "إيقاف" : "تشغيل"}
              onClick={(e) => {
                e.stopPropagation();
                onTogglePlay?.(!playing);
              }}
            >
              {playing ? <IconPause size={16} /> : <IconPlay size={16} />}
              <span>{playing ? "إيقاف" : "تشغيل"}</span>
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
