import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { SchoolResultsList, isDirectoryEnabled } from "./meetings/SchoolPickerCell";

// "+ הוסף בית ספר": first look the school up in the national directory ("מאגר בתי ספר"), so
// most of its details are already filled in. A directory school opens its card in onboarding
// mode (?onboard=1 — fill the mandatory fields, then "שמור והוסף לרשימת הלקוחות"); a school
// that is already a client just opens its card. "הוסף בית ספר ידנית" = the blank card as before.
// An org without the directory goes straight to the manual add.
export default function AddSchoolChooserModal({ schools, onManualAdd, onClose }) {
  const navigate = useNavigate();
  const { ref, handleKeyDown } = useFocusTrap(onClose);
  const [enabled, setEnabled] = useState(null);
  const [query, setQuery] = useState("");
  const [pendingId, setPendingId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    isDirectoryEnabled().then(v => {
      if (cancelled) return;
      if (v) setEnabled(true);
      else onManualAdd();
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!enabled) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(15,23,42,0.55)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="add-school-chooser-title"
        onKeyDown={handleKeyDown} dir="rtl"
        className="glass-card rounded-2xl p-6 w-full max-w-md flex flex-col gap-3">
        <h2 id="add-school-chooser-title" className="font-bold text-slate-900">הוספת בית ספר</h2>
        <p className="text-xs text-slate-500">
          חפשו את בית הספר במאגר בתי הספר. הכרטיס שלו ייפתח עם הפרטים שכבר קיימים, ונותר רק להשלים את שדות החובה.
        </p>
        <SchoolResultsList schools={schools || []} query={query} setQuery={setQuery}
          pendingId={pendingId} setPendingId={setPendingId}
          addMode onManualAdd={onManualAdd} confirmLabel="המשך" submittingLabel="פותח..."
          onCancel={onClose}
          onConfirm={s => navigate(s.status === "directory" ? `/school/${s.id}?onboard=1` : `/school/${s.id}`)} />
      </div>
    </div>
  );
}
