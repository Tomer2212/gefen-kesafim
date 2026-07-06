export function TimeInput({ id, value, onChange, ariaLabel }) {
  function handleChange(e) {
    const filtered = e.target.value.replace(/[^\d:]/g, "").slice(0, 5);
    onChange(filtered);
  }
  function handleBlur() {
    if (!value) return;
    const digits = value.replace(/\D/g, "");
    if (!digits) { onChange(""); return; }
    let hh, mm;
    if (digits.length <= 2) { hh = digits.padStart(2, "0"); mm = "00"; }
    else if (digits.length === 3) { hh = "0" + digits[0]; mm = digits.slice(1); }
    else { hh = digits.slice(0, 2); mm = digits.slice(2, 4); }
    if (parseInt(hh) > 23) hh = "23";
    if (parseInt(mm) > 59) mm = "59";
    onChange(`${hh}:${mm}`);
  }
  return (
    <input id={id} type="text" inputMode="numeric" maxLength={5}
      className="w-full bg-transparent border-0 outline-none text-sm text-right text-slate-700 hover:bg-slate-100 hover:rounded focus:bg-white focus:ring-1 focus:ring-blue-300 focus:rounded py-0.5 px-0 focus:px-1 transition-all"
      placeholder=""
      value={value} onChange={handleChange} onBlur={handleBlur}
      onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }}
      aria-label={ariaLabel} autoComplete="off" dir="ltr" />
  );
}
