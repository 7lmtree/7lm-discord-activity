export default function LoadingSplash({ status, error, outside }) {
  return (
    <section className="splash">
      <div>
        <p className="brand">
          7LM<span>MOVIE</span>
        </p>
        <p className="tagline">
          جلسة مشاهدة جماعية داخل Discord — نفس الفيلم، نفس اللحظة، مع أصدقائك في القناة.
        </p>
        {!error && !outside && (
          <>
            <div className="spinner" aria-hidden />
            <p className="status">{status || "Starting…"}</p>
          </>
        )}
        {outside && (
          <div className="error-box">
            هذه صفحة الأكتيفتي. افتحها من داخل Discord (Voice channel → Activities) عشان توثيق الـ SDK يشتغل.
          </div>
        )}
        {error && !outside && <div className="error-box">{error}</div>}
      </div>
    </section>
  );
}
