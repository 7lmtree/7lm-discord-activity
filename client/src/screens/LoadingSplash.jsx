const STEPS = ["نتصل بديسكورد", "جاري التفويض", "تبادل التوكن", "تأكيد الهوية", "Connecting watch room", "Joined room"];

export default function LoadingSplash({ status, error, outside }) {
  const stepIndex = Math.max(
    0,
    STEPS.findIndex((s) => status?.includes(s.slice(0, 8)) || status === s)
  );

  return (
    <section className="splash" aria-live="polite">
      <div className="splash-stage">
        <div className="splash-glow" aria-hidden />
        <div className="splash-grain" aria-hidden />

        <div className="splash-mark" aria-hidden>
          <span>7</span>
        </div>

        <p className="brand splash-brand">
          7LM<span>WATCH</span>
        </p>
        <p className="tagline">
          غرفة سينما داخل ديسكورد — نفس المشهد، نفس التوقيت، مع اللي معك بالقناة.
        </p>

        {!error && !outside && (
          <div className="splash-progress">
            <div className="spinner" aria-hidden />
            <p className="status">{status || "نجهّز الجلسة…"}</p>
            <div className="splash-dots" aria-hidden>
              {[0, 1, 2, 3].map((i) => (
                <span key={i} className={i <= Math.max(stepIndex, 0) ? "on" : ""} />
              ))}
            </div>
          </div>
        )}

        {outside && (
          <div className="error-box">
            افتح الأكتيفتي من داخل Discord:
            <br />
            Voice channel → Activities → 7LM Watch Party
          </div>
        )}

        {error && !outside && (
          <div className="error-box">
            <strong>ما قدرت نكمّل الدخول</strong>
            <p>{error}</p>
            <p className="error-hint">أقفل الأكتيفتي وافتحه من جديد بعد ثوانٍ.</p>
          </div>
        )}
      </div>
    </section>
  );
}
