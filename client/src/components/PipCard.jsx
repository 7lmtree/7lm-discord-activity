export default function PipCard({ title, poster, peopleCount = 0 }) {
  return (
    <section className="pip-card" aria-label="تصغير الأكتيفتي">
      <img className="pip-card-art" src={poster || "/art/pip.jpg"} alt="" draggable={false} />
      <div className="pip-card-shade" aria-hidden />
      <div className="pip-card-meta">
        <span className="pip-badge">7LM</span>
        <strong>{title || "Watch Party"}</strong>
        {peopleCount > 0 && <em>{peopleCount} يشاهدون</em>}
      </div>
    </section>
  );
}
