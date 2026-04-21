export default function LoadingScreen() {
  return (
    <div className="loading-overlay rounded-3xl flex flex-col items-center justify-center gap-6 py-20 px-8 anim-fade-up">

      {/* Spinner */}
      <div className="relative">
        <div className="spinner" />
        <div
          className="absolute inset-0 flex items-center justify-center"
        >
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
            <rect x="2" y="2" width="7" height="7" rx="1.5" fill="#0070F3" fillOpacity="0.8"/>
            <rect x="13" y="2" width="7" height="7" rx="1.5" fill="#0070F3" fillOpacity="0.4"/>
            <rect x="2" y="13" width="7" height="7" rx="1.5" fill="#0070F3" fillOpacity="0.4"/>
            <rect x="13" y="13" width="7" height="7" rx="1.5" fill="#0070F3" fillOpacity="0.8"/>
          </svg>
        </div>
      </div>

      {/* Text */}
      <div className="text-center">
        <h2 className="text-xl font-800 mb-2" style={{ fontWeight: 800, color: "#1e293b" }}>
          הבדיקה מתבצעת...
        </h2>
        <p className="text-sm text-slate-500 leading-relaxed max-w-xs">
          זה יכול לקחת כ-2 דקות.
          <br />
          אנא אל תסגור את החלון ואל תרענן.
        </p>
      </div>

      {/* Animated dots */}
      <div className="dot-pulse flex gap-2">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}
