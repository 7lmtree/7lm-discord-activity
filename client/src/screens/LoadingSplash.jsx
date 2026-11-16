const STEPS = [
  { key: "connect", label: "نتصل بديسكورد", match: ["نتصل", "connect"] },
  { key: "auth", label: "جاري التفويض", match: ["تفويض", "authorize"] },
  { key: "token", label: "تبادل التوكن", match: ["توكن", "token"] },
  { key: "identity", label: "تأكيد الهوية", match: ["هوية", "authenticate", "تأكيد"] },
  { key: "room", label: "نجهّز غرفة المشاهدة", match: ["غرفة", "room", "Connecting", "Joined", "watch"] },
];

function resolveStep(status) {
  const s = String(status || "").toLowerCase();
  let idx = 0;
  STEPS.forEach((step, i) => {
    if (step.match.some((m) => s.includes(m.toLowerCase()))) idx = i;
  });
  return idx;
}

export default function LoadingSplash({ status, error, outside }) {
  const stepIndex = resolveStep(status);
  const progress = outside || error ? 0 : Math.round(((stepIndex + 1) / STEPS.length) * 100);

  return (
    <section className="splash" aria-live="polite">
      <div className="splash-bg" aria-hidden>
        <img src="/art/cover.jpg" alt="" />
      </div>
      <div className="splash-stage">
        <div className="splash-glow" aria-hidden />
        <div className="splash-grain" aria-hidden />

        <div className="splash-mark" aria-hidden>
          <img src="/art/icon.jpg" alt="" />
        </div>

        <p className="brand splash-brand">
          7LM<span>WATCH</span>
        </p>
        <p className="tagline">غرفة سينما داخل ديسكورد — نفس المشهد، نفس التوقيت.</p>

        {!error && !outside && (
          <div className="splash-progress">
            <div className="splash-bar" aria-hidden>
              <span style={{ width: `${Math.max(progress, 12)}%` }} />
            </div>
            <p className="status">{status || STEPS[0].label}</p>
            <ol className="splash-steps">
              {STEPS.map((step, i) => (
                <li key={step.key} className={i < stepIndex ? "done" : i === stepIndex ? "on" : ""}>
                  {step.label}
                </li>
              ))}
            </ol>
          </div>
        )}

        {outside && (
          <div className="error-box">
            افتح الأكتيفتي من داخل Discord:
            <br />
            Voice channel / Activities / 7LM Movie
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
